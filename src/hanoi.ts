import { AppError } from "./errors";

export const ALGORITHM_VERSION = "hanoi3-optimal-v1";
export const MAX_DISKS = 1000;
export const MAX_WINDOW = 1000;

export interface HanoiParams {
  n: number;
  source: string;
  target: string;
  auxiliary: string;
}

export interface Move {
  step: string;
  disk: number;
  from: string;
  to: string;
}

export interface TraceEntry {
  subproblemN: number;
  subproblemFrom: string;
  subproblemTo: string;
  subproblemAux: string;
  segment: "first" | "middle" | "last";
  segmentStart: string;
  segmentLength: string;
  skippedBefore: string;
  localStep: string;
}

export interface LocatedMove extends Move {
  totalMoves: string;
  trace: TraceEntry[];
  totalSkipped: string;
}

export interface PegState {
  [peg: string]: number[];
}

export interface StateResult {
  stateIndex: string;
  totalMoves: string;
  complete: boolean;
  pegs: PegState;
}

export function validateParams(input: {
  n: unknown;
  source: unknown;
  target: unknown;
  auxiliary: unknown;
}): HanoiParams {
  const { n, source, target, auxiliary } = input;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new AppError("INVALID_N", "圆盘数 n 必须是整数", 400, { n });
  }
  if (n < 0 || n > MAX_DISKS) {
    throw new AppError("N_OUT_OF_RANGE", `圆盘数 n 必须在 0..${MAX_DISKS} 之间`, 400, { n });
  }
  for (const [key, value] of Object.entries({ source, target, auxiliary })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new AppError("PEG_LABEL_EMPTY", `柱名 ${key} 必须是非空字符串`, 400, { key, value });
    }
  }
  const labels = [source as string, target as string, auxiliary as string];
  if (new Set(labels).size !== 3) {
    throw new AppError("PEGS_DUPLICATE", "起始柱、目标柱、辅助柱名称必须互不相同", 400, { labels });
  }
  return { n, source: source as string, target: target as string, auxiliary: auxiliary as string };
}

export function totalMoves(n: number): bigint {
  return (1n << BigInt(n)) - 1n;
}

function parseNonNegativeBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new AppError("INVALID_STEP", `${field} 必须是十进制整数字符串`, 400, { value });
    }
    value = String(value);
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new AppError("INVALID_STEP", `${field} 必须是十进制整数字符串`, 400, { value });
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new AppError("INVALID_STEP", `${field} 不是合法的十进制整数`, 400, { value });
  }
  return parsed;
}

export function parseStep(value: unknown): bigint {
  const k = parseNonNegativeBigInt(value, "k");
  if (k < 0n) {
    throw new AppError("STEP_NEGATIVE", "移动编号不能为负", 400, { k: String(k) });
  }
  if (k === 0n) {
    throw new AppError("STEP_ZERO", "移动编号从 1 开始；第 0 个状态请使用状态接口", 400);
  }
  return k;
}

export function parseStateIndex(value: unknown): bigint {
  return parseNonNegativeBigInt(value, "stateIndex");
}

function locateRec(
  n: number,
  a: string,
  b: string,
  c: string,
  k: bigint,
  trace: TraceEntry[],
  cumulativeSkipped: bigint,
): { disk: number; from: string; to: string; totalSkipped: bigint } {
  const subLen = (1n << BigInt(n - 1)) - 1n;
  if (k <= subLen) {
    trace.push({
      subproblemN: n,
      subproblemFrom: a,
      subproblemTo: b,
      subproblemAux: c,
      segment: "first",
      segmentStart: "1",
      segmentLength: subLen.toString(),
      skippedBefore: cumulativeSkipped.toString(),
      localStep: k.toString(),
    });
    return locateRec(n - 1, a, c, b, k, trace, cumulativeSkipped);
  }
  const middleStart = subLen + 1n;
  if (k === middleStart) {
    trace.push({
      subproblemN: n,
      subproblemFrom: a,
      subproblemTo: b,
      subproblemAux: c,
      segment: "middle",
      segmentStart: middleStart.toString(),
      segmentLength: "1",
      skippedBefore: (cumulativeSkipped + subLen).toString(),
      localStep: "1",
    });
    return { disk: n, from: a, to: b, totalSkipped: cumulativeSkipped + subLen };
  }
  const lastStart = subLen + 2n;
  const skipped = cumulativeSkipped + subLen + 1n;
  trace.push({
    subproblemN: n,
    subproblemFrom: a,
    subproblemTo: b,
    subproblemAux: c,
    segment: "last",
    segmentStart: lastStart.toString(),
    segmentLength: subLen.toString(),
    skippedBefore: skipped.toString(),
    localStep: (k - subLen - 1n).toString(),
  });
  return locateRec(n - 1, c, b, a, k - subLen - 1n, trace, skipped);
}

export function locateMove(params: HanoiParams, rawK: unknown): LocatedMove {
  const total = totalMoves(params.n);
  if (params.n === 0) {
 throw new AppError("STEP_OUT_OF_RANGE", "零盘任务没有任何移动", 400, { totalMoves: "0" });
  }
  const k = parseStep(rawK);
  if (k > total) {
    throw new AppError("STEP_OUT_OF_RANGE", `第 ${k} 步超出总步数 ${total}`, 400, {
      k: k.toString(),
      totalMoves: total.toString(),
    });
  }
  const trace: TraceEntry[] = [];
  const found = locateRec(params.n, params.source, params.target, params.auxiliary, k, trace, 0n);
  return {
    step: k.toString(),
    disk: found.disk,
    from: found.from,
    to: found.to,
    totalMoves: total.toString(),
    trace,
    totalSkipped: found.totalSkipped.toString(),
  };
}

function placeRec(
  n: number,
  a: string,
  b: string,
  c: string,
  k: bigint,
  pegOf: string[],
): void {
  if (n === 0) return;
  const subLen = (1n << BigInt(n - 1)) - 1n;
  if (k <= subLen) {
    pegOf[n] = a;
    placeRec(n - 1, a, c, b, k, pegOf);
  } else if (k === subLen + 1n) {
    pegOf[n] = b;
    placeRec(n - 1, a, c, b, subLen, pegOf);
  } else {
    pegOf[n] = b;
    placeRec(n - 1, c, b, a, k - subLen - 1n, pegOf);
  }
}

export function stateAt(params: HanoiParams, rawIndex: unknown): StateResult {
  const total = totalMoves(params.n);
  const index = parseStateIndex(rawIndex);
  if (index > total) {
    throw new AppError("STATE_OUT_OF_RANGE", `状态编号 ${index} 超出最大状态编号 ${total}`, 400, {
      stateIndex: index.toString(),
      totalMoves: total.toString(),
    });
  }
  const pegOf: string[] = new Array(params.n + 1);
  placeRec(params.n, params.source, params.target, params.auxiliary, index, pegOf);
  const pegs: PegState = {
    [params.source]: [],
    [params.target]: [],
    [params.auxiliary]: [],
  };
  for (let disk = 1; disk <= params.n; disk++) {
    pegs[pegOf[disk]].push(disk);
  }
  for (const label of Object.keys(pegs)) {
    pegs[label].sort((x, y) => y - x);
  }
  return {
    stateIndex: index.toString(),
    totalMoves: total.toString(),
    complete: index === total,
    pegs,
  };
}

export function moveWindow(
  params: HanoiParams,
  rawStart: unknown,
  rawCount: unknown,
): { start: string; count: number; totalMoves: string; moves: Move[] } {
  const total = totalMoves(params.n);
  const start = parseStep(rawStart);
  let count: number;
  if (typeof rawCount === "string" && /^\d+$/.test(rawCount)) {
    count = Number(rawCount);
  } else if (typeof rawCount === "number" && Number.isInteger(rawCount)) {
    count = rawCount;
  } else {
    throw new AppError("INVALID_COUNT", "count 必须是非负整数", 400, { count: rawCount });
  }
  if (count < 0) {
    throw new AppError("INVALID_COUNT", "count 不能为负", 400, { count });
  }
  if (count > MAX_WINDOW) {
    throw new AppError("WINDOW_TOO_LARGE", `窗口最多 ${MAX_WINDOW} 条，请求了 ${count} 条`, 400, {
        maxWindow: MAX_WINDOW,
        count,
      });
  }
  if (params.n === 0 || start > total) {
    throw new AppError("STEP_OUT_OF_RANGE", `窗口起点 ${start} 超出总步数 ${total}`, 400, {
      start: start.toString(),
      totalMoves: total.toString(),
    });
  }
  const moves: Move[] = [];
  for (let i = 0; i < count; i++) {
    const step = start + BigInt(i);
    if (step > total) break;
    const found = locateMove(params, step);
    moves.push({ step: found.step, disk: found.disk, from: found.from, to: found.to });
  }
  return { start: start.toString(), count: moves.length, totalMoves: total.toString(), moves };
}
