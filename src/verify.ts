import { AppError } from "./errors";
import { HanoiParams, Move, PegState } from "./hanoi";

export interface VerificationIssue {
  code: string;
  message: string;
}

export interface StateVerification {
  valid: boolean;
  issues: VerificationIssue[];
  diskCount: number;
  pegCount: number;
}

function initPegs(params: HanoiParams): PegState {
  return {
    [params.source]: [],
    [params.target]: [],
    [params.auxiliary]: [],
  };
}

export function normalizeState(params: HanoiParams, raw: unknown): PegState {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("INVALID_STATE", "state.pegs 必须是对象", 400);
  }
  const record = raw as Record<string, unknown>;
  const pegs = initPegs(params);
  for (const label of Object.keys(pegs)) {
    const stack = record[label];
    if (!Array.isArray(stack)) {
      throw new AppError("INVALID_STATE", `柱 ${label} 的圆盘列表缺失或不是数组`, 400, { label });
    }
    pegs[label] = stack.map((d) => {
      if (typeof d !== "number" || !Number.isInteger(d)) {
        throw new AppError("INVALID_STATE", `柱 ${label} 上存在非整数盘号`, 400, { value: d });
      }
      return d;
    });
  }
  const unknown = Object.keys(record).filter((key) => !(key in pegs));
  if (unknown.length > 0) {
    throw new AppError("UNKNOWN_PEG", "状态中出现任务柱名之外的柱", 400, { unknown });
  }
  return pegs;
}

export function verifyState(params: HanoiParams, pegs: PegState): StateVerification {
  const issues: VerificationIssue[] = [];
  const seen = new Map<number, string>();
  for (const label of [params.source, params.target, params.auxiliary]) {
    const stack = pegs[label] ?? [];
    for (let i = 0; i < stack.length; i++) {
      const disk = stack[i];
      if (disk < 1 || disk > params.n) {
        issues.push({ code: "DISK_OUT_OF_RANGE", message: `盘号 ${disk} 不在 1..${params.n}` });
      }
      if (seen.has(disk)) {
        issues.push({
          code: "DISK_DUPLICATE",
          message: `盘号 ${disk} 同时出现在 ${seen.get(disk)} 与 ${label}`,
        });
      } else {
        seen.set(disk, label);
      }
      if (i > 0 && stack[i - 1] <= disk) {
        issues.push({
          code: "STACK_ORDER_INVALID",
          message: `柱 ${label} 自底向顶未严格变小：${stack[i - 1]} 压在 ${disk} 之上/同层顺序非法`,
        });
      }
    }
  }
  for (let disk = 1; disk <= params.n; disk++) {
    if (!seen.has(disk)) {
      issues.push({ code: "DISK_MISSING", message: `盘号 ${disk} 未出现` });
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    diskCount: seen.size,
    pegCount: 3,
  };
}

export interface MoveVerification {
  valid: boolean;
  issues: VerificationIssue[];
  move: Move;
  before: PegState;
  after: PegState;
}

function clonePegs(pegs: PegState): PegState {
  const copy: PegState = {};
  for (const key of Object.keys(pegs)) copy[key] = pegs[key].slice();
  return copy;
}

export function verifyMove(
  params: HanoiParams,
  before: PegState,
  move: Move,
): MoveVerification {
  const issues: VerificationIssue[] = [];
  if (move.disk < 1 || move.disk > params.n) {
    issues.push({ code: "DISK_OUT_OF_RANGE", message: `盘号 ${move.disk} 不在 1..${params.n}` });
  }
  for (const label of [move.from, move.to]) {
    if (![params.source, params.target, params.auxiliary].includes(label)) {
      issues.push({ code: "UNKNOWN_PEG", message: `移动涉及未知柱名 ${label}` });
    }
  }
  if (move.from === move.to) {
    issues.push({ code: "MOVE_SAME_PEG", message: "来源柱与目标柱不能相同" });
  }
  const after = clonePegs(before);
  const fromStack = after[move.from];
  const toStack = after[move.to];
  if (Array.isArray(fromStack) && fromStack.length > 0) {
    const top = fromStack[fromStack.length - 1];
    if (top !== move.disk) {
      issues.push({
        code: "NOT_TOP_DISK",
        message: `盘 ${move.disk} 不是柱 ${move.from} 的柱顶（柱顶为 ${top}）`,
      });
    }
  } else {
    issues.push({ code: "SOURCE_EMPTY", message: `柱 ${move.from} 为空，无法取盘` });
  }
  if (Array.isArray(toStack) && toStack.length > 0) {
    const destTop = toStack[toStack.length - 1];
    if (destTop < move.disk) {
      issues.push({
        code: "PLACED_ON_SMALLER",
        message: `盘 ${move.disk} 不能压在更小的盘 ${destTop} 上`,
      });
    }
  }
  if (issues.length === 0 && Array.isArray(fromStack) && Array.isArray(toStack)) {
    fromStack.pop();
    toStack.push(move.disk);
  }
  return { valid: issues.length === 0, issues, move, before, after };
}
