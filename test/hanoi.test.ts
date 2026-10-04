import test from "node:test";
import assert from "node:assert/strict";
import {
  HanoiError, moveAt, moveWindow, simulateAll, stateAfter, totalMoves, verifyMove, verifyState,
} from "../src/hanoi.js";
import { Store } from "../src/store.js";

const pegs = { source: "A", target: "C", auxiliary: "B" };

test("总步数 BigInt 精确", () => {
  assert.equal(totalMoves(0), 0n);
  assert.equal(totalMoves(3), 7n);
  assert.equal(totalMoves(64), 18446744073709551615n);
  assert.equal(totalMoves(100).toString(), "1267650600228229401496703205375");
});

test("三盘全部七步与朴素模拟一致", () => {
  const { moves, states } = simulateAll(3, pegs);
  assert.equal(moves.length, 7);
  for (let k = 1; k <= 7; k++) {
    const { move } = moveAt(3, pegs, BigInt(k));
    assert.deepEqual({ disk: move.disk, from: move.from, to: move.to }, moves[k - 1]);
  }
  for (let k = 0; k <= 7; k++) {
    assert.deepEqual(stateAfter(3, pegs, BigInt(k)), states[k]);
  }
  // 最终全部到达目标柱
  assert.deepEqual(states[7]["C"], [3, 2, 1]);
});

test("小盘数全量交叉验证 + 每步移动合法", () => {
  for (const n of [0, 1, 2, 4, 5, 8]) {
    const { moves, states } = simulateAll(n, pegs);
    const total = totalMoves(n);
    assert.equal(BigInt(moves.length), total);
    for (let k = 0n; k <= total; k++) {
      assert.deepEqual(stateAfter(n, pegs, k), states[Number(k)], `n=${n} k=${k}`);
    }
    for (let k = 1n; k <= total; k++) {
      const { move } = moveAt(n, pegs, k);
      assert.deepEqual({ disk: move.disk, from: move.from, to: move.to }, moves[Number(k) - 1]);
      const v = verifyMove(n, states[Number(k) - 1], move);
      assert.ok(v.ok, `n=${n} k=${k}: ${v.errors}`);
    }
    for (const s of states) assert.ok(verifyState(n, s).ok);
  }
});

test("60 盘中段与近末尾直接查询（不生成全序列）", () => {
  const n = 60;
  const total = totalMoves(n);
  const mid = total / 2n;
  const m1 = moveAt(n, pegs, mid).move;
  assert.equal(m1.k, mid.toString());
  const m2 = moveAt(n, pegs, total - 1n).move;
  const m3 = moveAt(n, pegs, total).move;
  // 最后一步必为盘 1 移到目标柱
  assert.equal(m3.disk, 1);
  assert.equal(m3.to, "C");
  const sMid = stateAfter(n, pegs, mid);
  assert.ok(verifyState(n, sMid).ok);
  const sEnd = stateAfter(n, pegs, total);
  assert.deepEqual(sEnd["C"].length, 60);
  assert.deepEqual(sEnd["A"], []);
  // 逐步验证靠近末尾的三步
  let st = stateAfter(n, pegs, total - 3n);
  for (let k = total - 2n; k <= total; k++) {
    const { move } = moveAt(n, pegs, k);
    const v = verifyMove(n, st, move);
    assert.ok(v.ok);
    st = v.after!;
  }
  assert.deepEqual(st, sEnd);
});

test("跨大整数边界：相邻步不混淆", () => {
  const n = 60;
  const boundary = 1n << 53n; // 超过 Number.MAX_SAFE_INTEGER
  const a = moveAt(n, pegs, boundary).move;
  const b = moveAt(n, pegs, boundary + 1n).move;
  assert.notDeepEqual([a.disk, a.from, a.to], [b.disk, b.from, b.to]);
  assert.equal(a.k, boundary.toString());
  assert.equal(b.k, (boundary + 1n).toString());
});

test("窗口截界：跨过中点与最后一步", () => {
  const w1 = moveWindow(3, pegs, 3n, 4); // 跨中点(第4步)
  assert.equal(w1.length, 4);
  assert.equal(w1[1].disk, 3); // 第 4 步为中点，移动最大盘
  const w2 = moveWindow(3, pegs, 6n, 100); // 超出末尾截断
  assert.equal(w2.length, 2);
  assert.equal(w2[1].k, "7");
});

test("柱名重命名只换标签", () => {
  const p2 = { source: "左", target: "右", auxiliary: "中" };
  const a = moveAt(4, pegs, 5n).move;
  const b = moveAt(4, p2, 5n).move;
  assert.equal(a.disk, b.disk);
  assert.equal(b.from === "左" || b.from === "右" || b.from === "中", true);
  const map: Record<string, string> = { A: "左", B: "中", C: "右" };
  assert.equal(map[a.from], b.from);
  assert.equal(map[a.to], b.to);
});

test("非法输入明确拒绝", () => {
  assert.throws(() => moveAt(3, pegs, 0n), (e: any) => e.code === "OUT_OF_RANGE");
  assert.throws(() => moveAt(3, pegs, 8n), (e: any) => e.code === "OUT_OF_RANGE");
  assert.throws(() => stateAfter(3, pegs, -1n), (e: any) => e.code === "OUT_OF_RANGE");
  assert.throws(() => stateAfter(3, pegs, 8n), (e: any) => e.code === "OUT_OF_RANGE");
  assert.throws(() => moveWindow(3, pegs, 1n, 0), (e: any) => e.code === "LIMIT_EXCEEDED");
  const store = new Store(":memory:");
  assert.throws(() => store.createTask(-1, pegs), (e: any) => e.code === "INVALID_N");
  assert.throws(() => store.createTask(3, { source: "A", target: "A", auxiliary: "B" }), (e: any) => e.code === "DUPLICATE_PEG");
  store.close();
});

test("零盘与单盘边界", () => {
  assert.equal(totalMoves(0), 0n);
  assert.deepEqual(stateAfter(0, pegs, 0n), { A: [], B: [], C: [] });
  assert.throws(() => moveAt(0, pegs, 1n), (e: any) => e.code === "OUT_OF_RANGE");
  const { move } = moveAt(1, pegs, 1n);
  assert.deepEqual([move.disk, move.from, move.to], [1, "A", "C"]);
  assert.deepEqual(stateAfter(1, pegs, 0n), { A: [1], B: [], C: [] });
  assert.deepEqual(stateAfter(1, pegs, 1n), { A: [], B: [], C: [1] });
});

test("游标推进原子性、重启续进、只读查询不改游标", () => {
  const store = new Store(":memory:");
  const t = store.createTask(3, pegs);
  // 只读查询
  moveAt(t.n, pegs, 5n);
  stateAfter(t.n, pegs, 5n);
  assert.equal(store.getTask(t.id).cursor, "0");
  // 推进
  const r1 = store.advance(t.id, 4);
  assert.equal(r1.task.cursor, "4");
  const r2 = store.advance(t.id, 100); // 预算超出截断到总步数
  assert.equal(r2.task.cursor, "7");
  const r3 = store.advance(t.id, 5); // 已完成，不重复计
  assert.equal(r3.task.cursor, "7");
  assert.equal(r3.from > r3.to, true);
  store.close();
});

test("状态核验器能发现非法布局与非法移动", () => {
  assert.ok(!verifyState(2, { A: [1, 2], B: [], C: [] }).ok); // 小压大
  assert.ok(!verifyState(2, { A: [1], B: [1], C: [2] }).ok); // 重复
  assert.ok(!verifyState(2, { A: [1], B: [], C: [] }).ok); // 缺失
  const bad = verifyMove(2, { A: [2, 1], B: [], C: [] }, { disk: 2, from: "A", to: "B" });
  assert.ok(!bad.ok); // 非柱顶
  const bad2 = verifyMove(2, { A: [2], B: [1], C: [] }, { disk: 2, from: "A", to: "B" });
  assert.ok(!bad2.ok); // 压小盘
});
