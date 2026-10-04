import { Store, taskInfo } from "./store.js";
import { moveAt, moveWindow, parseStep, stateAfter, totalMoves, verifyState } from "./hanoi.js";
import { startServer } from "./server.js";

function pegsOf(t: { source: string; target: string; auxiliary: string }) {
  return { source: t.source, target: t.target, auxiliary: t.auxiliary };
}

function print(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store();

  switch (cmd) {
    case "serve": {
      const port = args[0] ? Number(args[0]) : undefined;
      const { port: p } = await startServer(port);
      console.log(`服务已启动: http://localhost:${p}`);
      return; // keep process alive
    }
    case "create": {
      const [n, source = "A", target = "C", auxiliary = "B"] = args;
      print(taskInfo(store.createTask(Number(n), { source, target, auxiliary })));
      break;
    }
    case "list":
      print(store.listTasks().map(taskInfo));
      break;
    case "total": {
      const t = store.getTask(Number(args[0]));
      print({ id: t.id, totalMoves: totalMoves(t.n).toString() });
      break;
    }
    case "move": {
      const t = store.getTask(Number(args[0]));
      print(moveAt(t.n, pegsOf(t), parseStep(args[1], "移动编号")));
      break;
    }
    case "state": {
      const t = store.getTask(Number(args[0]));
      const k = parseStep(args[1], "状态编号");
      const state = stateAfter(t.n, pegsOf(t), k);
      print({ k: k.toString(), state, verify: verifyState(t.n, state) });
      break;
    }
    case "window": {
      const t = store.getTask(Number(args[0]));
      print(moveWindow(t.n, pegsOf(t), parseStep(args[1] ?? "1"), Number(args[2] ?? "10")));
      break;
    }
    case "advance": {
      const t = store.getTask(Number(args[0]));
      const budget = Number(args[1] ?? "1");
      const { task, from, to } = store.advance(t.id, budget);
      const moves = to >= from ? moveWindow(t.n, pegsOf(t), from, Number(to - from + 1n)) : [];
      print({ task: taskInfo(task), moves });
      break;
    }
    case "export": {
      const t = store.getTask(Number(args[0]));
      const state = stateAfter(t.n, pegsOf(t), BigInt(t.cursor));
      print({ ...taskInfo(t), state, verify: verifyState(t.n, state) });
      break;
    }
    default:
      console.log(`用法: node dist/src/cli.js <命令> [参数]
  serve [port]            启动 HTTP 服务（默认空闲端口）
  create <n> [src] [dst] [aux]  创建任务
  list                    列出任务
  total <id>              查询总步数
  move <id> <k>           定位第 k 步（含递归区段解释）
  state <id> <k>          查询完成 k 步后的状态
  window <id> [from] [limit]  读取有限移动窗口
  advance <id> [budget]   按预算推进演示游标
  export <id>             导出任务与当前状态`);
  }
  store.close();
}

main().catch((e) => {
  console.error(e.code ? `[${e.code}] ${e.message}` : e);
  process.exit(1);
});
