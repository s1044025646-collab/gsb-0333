import http from "node:http";
import { Store, taskInfo } from "./store.js";
import {
  HanoiError, MAX_WINDOW, moveAt, moveWindow, parseStep, stateAfter, verifyMove, verifyState,
} from "./hanoi.js";

const MAX_ADVANCE = 10000;

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1_000_000) reject(new HanoiError("BAD_REQUEST", "请求体过大"));
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { reject(new HanoiError("BAD_REQUEST", "请求体不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer(store: Store) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }

      if (method === "POST" && url.pathname === "/tasks") {
        const body = await readBody(req);
        const t = store.createTask(Number(body.n), {
          source: body.source, target: body.target, auxiliary: body.auxiliary,
        });
        return send(res, 201, taskInfo(t));
      }

      if (method === "GET" && url.pathname === "/tasks") {
        return send(res, 200, store.listTasks().map(taskInfo));
      }

      if (parts[0] === "tasks" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new HanoiError("BAD_REQUEST", "任务 id 非法");
        const task = store.getTask(id);
        const pegs = { source: task.source, target: task.target, auxiliary: task.auxiliary };
        const sub = parts[2];

        if (method === "GET" && parts.length === 2) return send(res, 200, taskInfo(task));

        if (method === "GET" && sub === "total") {
          return send(res, 200, { id, totalMoves: taskInfo(task).totalMoves });
        }

        if (method === "GET" && sub === "move" && parts.length === 4) {
          const k = parseStep(parts[3], "移动编号");
          const { move, trace } = moveAt(task.n, pegs, k);
          return send(res, 200, { move, trace });
        }

        if (method === "GET" && sub === "state" && parts.length === 4) {
          const k = parseStep(parts[3], "状态编号");
          const state = stateAfter(task.n, pegs, k);
          return send(res, 200, { k: k.toString(), state, verify: verifyState(task.n, state) });
        }

        if (method === "GET" && sub === "moves") {
          const from = parseStep(url.searchParams.get("from") ?? "1", "窗口起始步号");
          const limit = Number(url.searchParams.get("limit") ?? "10");
          return send(res, 200, { moves: moveWindow(task.n, pegs, from, limit) });
        }

        if (method === "POST" && sub === "advance") {
          const body = await readBody(req);
          const budget = Number(body.budget ?? 1);
          if (budget > MAX_ADVANCE) throw new HanoiError("LIMIT_EXCEEDED", `单次推进预算上限 ${MAX_ADVANCE}`);
          const { task: updated, from, to } = store.advance(id, budget);
          const moves = to >= from ? moveWindow(task.n, pegs, from, Math.min(Number(to - from + 1n), MAX_WINDOW)) : [];
          const advanced = to >= from ? to - from + 1n : 0n;
          return send(res, 200, { task: taskInfo(updated), advanced: advanced.toString(), moves });
        }

        if (method === "GET" && sub === "export") {
          const cursor = BigInt(task.cursor);
          const state = stateAfter(task.n, pegs, cursor);
          return send(res, 200, {
            ...taskInfo(task),
            state,
            verify: verifyState(task.n, state),
          });
        }

        if (method === "POST" && sub === "verify-move") {
          const body = await readBody(req);
          const k = parseStep(String(body.k), "移动编号");
          const before = stateAfter(task.n, pegs, k - 1n);
          const { move } = moveAt(task.n, pegs, k);
          const result = verifyMove(task.n, before, move);
          return send(res, 200, { move, ...result });
        }
      }

      throw new HanoiError("NOT_FOUND", `路由不存在：${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof HanoiError) {
        const status = e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400;
        return send(res, status, { error: { code: e.code, message: e.message } });
      }
      return send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
    }
  });
}

export function startServer(port?: number): Promise<{ server: http.Server; port: number }> {
  const store = new Store();
  const server = createServer(store);
  const p = port ?? (process.env.PORT ? Number(process.env.PORT) : 0); // 0 = 空闲端口
  return new Promise((resolve) => {
    server.listen(p, () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : p });
    });
  });
}
