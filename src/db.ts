import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALGORITHM_VERSION, HanoiParams, totalMoves } from "./hanoi";
import { AppError } from "./errors";

export interface TaskRecord {
  id: number;
  n: number;
  source: string;
  target: string;
  auxiliary: string;
  algorithmVersion: string;
  totalMoves: string;
  cursor: string;
  createdAt: string;
  updatedAt: string;
}

export class TaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS tasks (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         n INTEGER NOT NULL,
         source TEXT NOT NULL,
         target TEXT NOT NULL,
         auxiliary TEXT NOT NULL,
         algorithm_version TEXT NOT NULL,
         total_moves TEXT NOT NULL,
         cursor TEXT NOT NULL DEFAULT '0',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       );`,
    );
  }

  close(): void {
    this.db.close();
  }

  create(params: HanoiParams): TaskRecord {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO tasks
         (n, source, target, auxiliary, algorithm_version, total_moves, cursor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?);`,
    );
    const result = stmt.run(
      params.n,
      params.source,
      params.target,
      params.auxiliary,
      ALGORITHM_VERSION,
      totalMoves(params.n).toString(),
      now,
      now,
    );
    const id = Number(result.lastInsertRowid);
    return this.getOrThrow(id);
  }

  list(): TaskRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY id ASC;")
      .all() as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  getOrThrow(id: number): TaskRecord {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?;").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `任务 ${id} 不存在`, 404, { id });
    }
    return mapRow(row);
  }

  advanceCursor(id: number, budgetRaw: unknown): { task: TaskRecord; advanced: string; reachedEnd: boolean } {
    const task = this.getOrThrow(id);
    let budget: number;
    if (typeof budgetRaw === "number" && Number.isInteger(budgetRaw) && budgetRaw >= 0) {
      budget = budgetRaw;
    } else if (typeof budgetRaw === "string" && /^\d+$/.test(budgetRaw)) {
      budget = Number(budgetRaw);
    } else {
      throw new AppError("INVALID_BUDGET", "budget 必须是非负整数", 400, { budget: budgetRaw });
    }
    if (budget > 1000000) {
      throw new AppError("BUDGET_TOO_LARGE", "budget 不能超过 1000000", 400, { budget });
    }
    const total = BigInt(task.totalMoves);
    const cursor = BigInt(task.cursor);
    const advancedCount =
      cursor + BigInt(budget) >= total ? total - cursor : BigInt(budget);
    const newCursor = cursor + advancedCount;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db
        .prepare("UPDATE tasks SET cursor = ?, updated_at = ? WHERE id = ?;")
        .run(newCursor.toString(), now, id);
      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
    return {
      task: this.getOrThrow(id),
      advanced: advancedCount.toString(),
      reachedEnd: newCursor === total,
    };
  }
}

function mapRow(row: Record<string, unknown>): TaskRecord {
  return {
    id: Number(row.id),
    n: Number(row.n),
    source: String(row.source),
    target: String(row.target),
    auxiliary: String(row.auxiliary),
    algorithmVersion: String(row.algorithm_version),
    totalMoves: String(row.total_moves),
    cursor: String(row.cursor),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
