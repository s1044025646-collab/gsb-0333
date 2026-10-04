import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { ALGO_VERSION, HanoiError, Pegs, totalMoves, validateN, validatePegs } from "./hanoi.js";

export interface TaskRow {
  id: number;
  n: number;
  source: string;
  target: string;
  auxiliary: string;
  algo_version: string;
  cursor: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const file = dbPath ?? path.join(process.cwd(), "data", "hanoi.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        n INTEGER NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        auxiliary TEXT NOT NULL,
        algo_version TEXT NOT NULL,
        cursor TEXT NOT NULL DEFAULT '0',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createTask(n: number, pegs: Pegs): TaskRow {
    validateN(n);
    validatePegs(pegs);
    const stmt = this.db.prepare(
      "INSERT INTO tasks (n, source, target, auxiliary, algo_version, cursor) VALUES (?, ?, ?, ?, ?, '0')"
    );
    const r = stmt.run(n, pegs.source, pegs.target, pegs.auxiliary, ALGO_VERSION);
    return this.getTask(Number(r.lastInsertRowid));
  }

  getTask(id: number): TaskRow {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    if (!row) throw new HanoiError("NOT_FOUND", `任务 ${id} 不存在`);
    return row;
  }

  listTasks(): TaskRow[] {
    return this.db.prepare("SELECT * FROM tasks ORDER BY id").all() as unknown as TaskRow[];
  }

  /** Atomically advance cursor by up to budget steps. Returns moves actually made [oldCursor+1 .. newCursor]. */
  advance(id: number, budget: number): { task: TaskRow; from: bigint; to: bigint } {
    if (!Number.isInteger(budget) || budget < 1) {
      throw new HanoiError("INVALID_STEP", "推进预算必须是正整数");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(id);
      const total = totalMoves(task.n);
      const cur = BigInt(task.cursor);
      const next = cur + BigInt(budget) > total ? total : cur + BigInt(budget);
      const r = this.db
        .prepare("UPDATE tasks SET cursor = ? WHERE id = ? AND cursor = ?")
        .run(next.toString(), id, task.cursor);
      if (Number(r.changes) !== 1) throw new HanoiError("CONFLICT", "游标并发更新冲突");
      this.db.exec("COMMIT");
      return { task: this.getTask(id), from: cur + 1n, to: next };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function taskInfo(t: TaskRow) {
  return {
    id: t.id,
    n: t.n,
    pegs: { source: t.source, target: t.target, auxiliary: t.auxiliary },
    algoVersion: t.algo_version,
    totalMoves: totalMoves(t.n).toString(),
    cursor: t.cursor,
    done: BigInt(t.cursor) === totalMoves(t.n),
    createdAt: t.created_at,
  };
}
