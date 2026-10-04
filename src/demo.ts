import { Store } from "./store.js";
import { moveAt, moveWindow, stateAfter, totalMoves, verifyState } from "./hanoi.js";

const pegs = { source: "A", target: "C", auxiliary: "B" };

console.log("=== 演示 1：3 盘全部 7 步 ===");
for (let k = 1n; k <= 7n; k++) {
  const { move } = moveAt(3, pegs, k);
  const s = stateAfter(3, pegs, k);
  console.log(`第 ${k} 步: 盘 ${move.disk} ${move.from} -> ${move.to}  状态 A=[${s.A}] B=[${s.B}] C=[${s.C}]`);
}

console.log("\n=== 演示 2：60 盘随机访问（总步数 " + totalMoves(60) + "）===");
const total = totalMoves(60);
for (const k of [total / 2n, total - 2n, total - 1n, total]) {
  const { move, trace } = moveAt(60, pegs, k);
  console.log(`第 ${k} 步: 盘 ${move.disk} ${move.from} -> ${move.to}（递归下降 ${trace.length} 层）`);
}
const sMid = stateAfter(60, pegs, total / 2n);
console.log(`中点状态核验: ${JSON.stringify(verifyState(60, sMid))}`);
console.log(`中点各柱盘数: A=${sMid.A.length} B=${sMid.B.length} C=${sMid.C.length}`);

console.log("\n=== 演示 3：SQLite 游标推进与重启续进 ===");
const fs = await import("node:fs");
const dbFile = "data/demo.db";
try { fs.unlinkSync(dbFile); } catch {}
let store = new Store(dbFile);
const t = store.createTask(3, pegs);
console.log("创建任务:", t.id, "总步数", totalMoves(3).toString());
console.log("推进 3 步, 游标 =", store.advance(t.id, 3).task.cursor);
store.close();
store = new Store(dbFile); // 模拟重启
console.log("重启后游标 =", store.getTask(t.id).cursor);
const r = store.advance(t.id, 100);
console.log("继续推进(预算100截断), 游标 =", r.task.cursor, "新增移动", moveWindow(3, pegs, r.from, Number(r.to - r.from + 1n)).length, "条");
store.close();
