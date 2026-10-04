export const ALGO_VERSION = "hanoi-3peg-optimal-v1";

export const MAX_WINDOW = 1000;
export const MAX_N = 1024;

export type PegName = string;

export interface Pegs {
  source: PegName;
  target: PegName;
  auxiliary: PegName;
}

export interface Move {
  k: string; // 1-based move number, decimal string
  disk: number;
  from: PegName;
  to: PegName;
}

export interface SegmentTrace {
  depth: number; // recursion depth, 0 = top-level n
  segment: "left" | "move" | "right";
  skipped: string; // steps skipped to reach this segment start (decimal)
  note: string;
}

export class HanoiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function validatePegs(pegs: Pegs): void {
  const names = [pegs.source, pegs.target, pegs.auxiliary];
  for (const p of names) {
    if (typeof p !== "string" || p.length === 0 || p.length > 64) {
      throw new HanoiError("INVALID_PEG", "柱名必须是非空且不超过 64 字符的字符串");
    }
  }
  if (new Set(names).size !== 3) {
    throw new HanoiError("DUPLICATE_PEG", "起始柱、目标柱、辅助柱名称必须互不相同");
  }
}

export function validateN(n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new HanoiError("INVALID_N", "圆盘数必须是非负整数");
  }
  if (n > MAX_N) {
    throw new HanoiError("INVALID_N", `圆盘数超过上限 ${MAX_N}`);
  }
}

export function totalMoves(n: number): bigint {
  return (1n << BigInt(n)) - 1n;
}

export function parseStep(raw: string | number, what = "步号"): bigint {
  let v: bigint;
  try {
    v = typeof raw === "number" ? BigInt(raw) : BigInt(String(raw).trim());
  } catch {
    throw new HanoiError("INVALID_STEP", `${what}必须是十进制整数字符串`);
  }
  if (v < 0n) throw new HanoiError("INVALID_STEP", `${what}不能为负`);
  return v;
}

/** k-th move, k in [1, 2^n - 1]. O(n) via recursion-segment skipping. */
export function moveAt(n: number, pegs: Pegs, k: bigint): { move: Move; trace: SegmentTrace[] } {
  const total = totalMoves(n);
  if (k < 1n || k > total) {
    throw new HanoiError("OUT_OF_RANGE", `移动编号必须在 1..${total} 之间（0 号移动不存在）`);
  }
  const trace: SegmentTrace[] = [];
  let src = pegs.source, dst = pegs.target, aux = pegs.auxiliary;
  let disks = n;
  let offset = 0n; // steps skipped before current subproblem
  let kk = k;
  while (true) {
    const half = 1n << BigInt(disks - 1);
    if (kk < half) {
      trace.push({ depth: n - disks, segment: "left", skipped: offset.toString(), note: `进入左区段：${disks - 1} 盘从 ${src} 移到 ${aux}` });
      const t = aux; aux = dst; dst = t;
      disks--;
    } else if (kk === half) {
      trace.push({ depth: n - disks, segment: "move", skipped: (offset + half - 1n).toString(), note: `第 ${offset + half} 步：盘 ${disks} 从 ${src} 移到 ${dst}` });
      return { move: { k: (offset + half).toString(), disk: disks, from: src, to: dst }, trace };
    } else {
      trace.push({ depth: n - disks, segment: "right", skipped: (offset + half).toString(), note: `跳过左区段与最大盘移动共 ${half} 步，进入右区段：${disks - 1} 盘从 ${aux} 移到 ${dst}` });
      offset += half;
      kk -= half;
      const t = src; src = aux; aux = t;
      disks--;
    }
  }
}

/** State after k moves, k in [0, 2^n - 1]. Returns peg -> disks bottom-to-top. O(n). */
export function stateAfter(n: number, pegs: Pegs, k: bigint): Record<PegName, number[]> {
  const total = totalMoves(n);
  if (k < 0n || k > total) {
    throw new HanoiError("OUT_OF_RANGE", `状态编号必须在 0..${total} 之间`);
  }
  const result: Record<PegName, number[]> = { [pegs.source]: [], [pegs.target]: [], [pegs.auxiliary]: [] };
  let src = pegs.source, dst = pegs.target, aux = pegs.auxiliary;
  let kk = k;
  for (let disks = n; disks >= 1; disks--) {
    const half = 1n << BigInt(disks - 1);
    if (kk < half) {
      result[src].push(disks);
      const t = aux; aux = dst; dst = t;
    } else {
      result[dst].push(disks);
      kk -= half;
      const t = src; src = aux; aux = t;
    }
  }
  return result;
}

/** Finite window of moves [from, from+limit), 1-based. */
export function moveWindow(n: number, pegs: Pegs, from: bigint, limit: number): Move[] {
  const total = totalMoves(n);
  if (from < 1n) throw new HanoiError("INVALID_STEP", "窗口起始步号必须 >= 1");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WINDOW) {
    throw new HanoiError("LIMIT_EXCEEDED", `窗口大小必须在 1..${MAX_WINDOW} 之间`);
  }
  if (from > total) throw new HanoiError("OUT_OF_RANGE", `窗口起始步号超出总步数 ${total}`);
  const moves: Move[] = [];
  const end = from + BigInt(limit) - 1n > total ? total : from + BigInt(limit) - 1n;
  for (let k = from; k <= end; k++) moves.push(moveAt(n, pegs, k).move);
  return moves;
}

/** Verify a state: every disk exactly once, each peg strictly decreasing bottom-to-top. */
export function verifyState(n: number, state: Record<string, number[]>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Map<number, number>();
  for (const [peg, disks] of Object.entries(state)) {
    if (!Array.isArray(disks)) { errors.push(`柱 ${peg} 的状态不是数组`); continue; }
    for (let i = 0; i < disks.length; i++) {
      const d = disks[i];
      if (!Number.isInteger(d) || d < 1 || d > n) { errors.push(`柱 ${peg} 含非法盘号 ${d}`); continue; }
      if (seen.has(d)) errors.push(`盘 ${d} 出现多次（柱 ${peg} 与柱 ${seen.get(d)}）`);
      seen.set(d, errors.length);
      if (i > 0 && disks[i - 1] <= d) errors.push(`柱 ${peg} 从底到顶未严格变小：${disks[i - 1]} 在 ${d} 之下`);
    }
  }
  for (let d = 1; d <= n; d++) if (!seen.has(d)) errors.push(`盘 ${d} 缺失`);
  return { ok: errors.length === 0, errors };
}

/** Verify a single move against the state before it; returns new state if legal. */
export function verifyMove(
  n: number,
  before: Record<string, number[]>,
  move: { disk: number; from: string; to: string }
): { ok: boolean; errors: string[]; after?: Record<string, number[]> } {
  const errors: string[] = [];
  const check = verifyState(n, before);
  if (!check.ok) return { ok: false, errors: check.errors };
  const fromPeg = before[move.from];
  const toPeg = before[move.to];
  if (!fromPeg) errors.push(`来源柱 ${move.from} 不存在`);
  if (!toPeg) errors.push(`目标柱 ${move.to} 不存在`);
  if (errors.length) return { ok: false, errors };
  if (fromPeg.length === 0 || fromPeg[fromPeg.length - 1] !== move.disk) {
    errors.push(`盘 ${move.disk} 不在柱 ${move.from} 顶部`);
  }
  if (toPeg.length > 0 && toPeg[toPeg.length - 1] < move.disk) {
    errors.push(`盘 ${move.disk} 不能压在更小的盘 ${toPeg[toPeg.length - 1]} 上`);
  }
  if (errors.length) return { ok: false, errors };
  const after: Record<string, number[]> = {};
  for (const [p, ds] of Object.entries(before)) after[p] = [...ds];
  after[move.from].pop();
  after[move.to].push(move.disk);
  return { ok: true, errors: [], after };
}

/** Independent naive recursive full simulation (small n only) for cross-checking. */
export function simulateAll(n: number, pegs: Pegs): { moves: Array<{ disk: number; from: string; to: string }>; states: Array<Record<string, number[]>> } {
  const state: Record<string, number[]> = { [pegs.source]: [], [pegs.target]: [], [pegs.auxiliary]: [] };
  for (let d = n; d >= 1; d--) state[pegs.source].push(d);
  const states: Array<Record<string, number[]>> = [JSON.parse(JSON.stringify(state))];
  const moves: Array<{ disk: number; from: string; to: string }> = [];
  const rec = (m: number, s: string, d: string, a: string) => {
    if (m === 0) return;
    rec(m - 1, s, a, d);
    state[s].pop();
    state[d].push(m);
    moves.push({ disk: m, from: s, to: d });
    states.push(JSON.parse(JSON.stringify(state)));
    rec(m - 1, a, d, s);
  };
  rec(n, pegs.source, pegs.target, pegs.auxiliary);
  return { moves, states };
}
