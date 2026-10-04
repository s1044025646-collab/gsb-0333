import * as http from "node:http";
import * as path from "node:path";
import { AppError } from "./errors";
import {
  locateMove,
  moveWindow,
  stateAt,
  totalMoves,
  validateParams,
} from "./hanoi";
import { TaskStore, TaskRecord } from "./db";
import { normalizeState, verifyMove, verifyState } from "./verify";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = process.env.HANOI_DB ?? path.join(DATA_DIR, "hanoi.db");

export function createServer(store: TaskStore): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, store).catch((err: unknown) => sendError(res, err));
  });
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_JSON", "请求体不是合法 JSON", 400);
  }
}

function taskParams(task: TaskRecord) {
  return { n: task.n, source: task.source, target: task.target, auxiliary: task.auxiliary };
}

function serializeTask(task: TaskRecord) {
  return {
    id: task.id,
    n: task.n,
    pegs: { source: task.source, target: task.target, auxiliary: task.auxiliary },
    algorithmVersion: task.algorithmVersion,
    totalMoves: task.totalMoves,
    cursor: task.cursor,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  store: TaskStore,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (parts.length === 1 && parts[0] === "health") {
    sendJson(res, 200, { ok: true, service: "hanoi3-optimal" });
    return;
  }

  if (parts[0] === "api" && parts[1] === "tasks") {
    if (parts.length === 2 && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const params = validateParams(body);
      const task = store.create(params);
      sendJson(res, 201, { task: serializeTask(task) });
      return;
    }
    if (parts.length === 2 && method === "GET") {
      sendJson(res, 200, { tasks: store.list().map(serializeTask) });
      return;
    }
    if (parts.length === 3 && /^\d+$/.test(parts[2]) && method === "GET") {
      const task = store.getOrThrow(Number(parts[2]));
      sendJson(res, 200, { task: serializeTask(task) });
      return;
    }
    if (parts.length === 4 && /^\d+$/.test(parts[2])) {
      const id = Number(parts[2]);
      const task = store.getOrThrow(id);
      const params = taskParams(task);
      if (parts[3] === "total" && method === "GET") {
        sendJson(res, 200, { id, totalMoves: totalMoves(task.n).toString() });
        return;
      }
      if (parts[3] === "export" && method === "GET") {
        sendJson(res, 200, {
          task: serializeTask(task),
          initialState: stateAt(params, "0"),
          finalState: stateAt(params, task.totalMoves),
          note: "标准三柱最优解路径；并非所有合法布局都位于该路径上。",
        });
        return;
      }
      if (parts[3] === "advance" && method === "POST") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const result = store.advanceCursor(id, body.budget);
        sendJson(res, 200, {
          task: serializeTask(result.task),
          advanced: result.advanced,
          reachedEnd: result.reachedEnd,
        });
        return;
      }
    }
    if (parts.length === 5 && /^\d+$/.test(parts[2])) {
      const id = Number(parts[2]);
      const task = store.getOrThrow(id);
      const params = taskParams(task);
      if (parts[3] === "moves" && method === "GET") {
        sendJson(res, 200, locateMove(params, decodeURIComponent(parts[4])));
        return;
      }
      if (parts[3] === "states" && method === "GET") {
        sendJson(res, 200, stateAt(params, decodeURIComponent(parts[4])));
        return;
      }
      if (parts[3] === "window" && method === "GET") {
        const start = url.searchParams.get("start") ?? "1";
        const count = url.searchParams.get("count") ?? "10";
        sendJson(res, 200, moveWindow(params, start, count));
        return;
      }
    }
    if (parts.length === 5 && /^\d+$/.test(parts[2]) && parts[3] === "verify-move" && method === "GET") {
      const id = Number(parts[2]);
      const task = store.getOrThrow(id);
      const params = taskParams(task);
      const step = decodeURIComponent(parts[4]);
      const located = locateMove(params, step);
      const before = stateAt(params, BigInt(located.step) - 1n);
      const result = verifyMove(params, before.pegs, {
        step: located.step,
        disk: located.disk,
        from: located.from,
        to: located.to,
      });
      sendJson(res, 200, result);
      return;
    }
    if (parts.length === 4 && /^\d+$/.test(parts[2]) && parts[3] === "verify-state" && method === "POST") {
      const id = Number(parts[2]);
      const task = store.getOrThrow(id);
      const params = taskParams(task);
      const body = (await readJson(req)) as Record<string, unknown>;
      const pegs = normalizeState(params, (body as { pegs?: unknown }).pegs ?? body);
      sendJson(res, 200, verifyState(params, pegs));
      return;
    }
  }

  throw new AppError("NOT_FOUND", `未找到路由 ${method} ${url.pathname}`, 404);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    sendJson(res, err.status, {
      error: { code: err.code, message: err.message, details: err.details ?? null },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { error: { code: "INTERNAL", message } });
}

if (require.main === module) {
  const store = new TaskStore(DB_PATH);
  const server = createServer(store);
  const requested = process.env.PORT ? Number(process.env.PORT) : 0;
  server.listen(requested, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : requested;
    console.log(`LISTENING ${port}`);
    console.log(`数据文件: ${DB_PATH}`);
  });

  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
