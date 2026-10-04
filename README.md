# 三柱汉诺塔最优解序列 · 随机访问与状态核验后端

TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖）实现的纯后端服务，仅提供 HTTP API 与 CLI，无网页、无 Docker、无外部服务。

## 支持范围与索引约定

- **只支持标准三柱最优解路径**：初态为 `n` 个盘全部按大小叠在起始柱，终点为全部移到目标柱。不处理任意布局间最短路、不支持四柱。
- 并非任意合法布局都位于这条最优路径上；本服务只回答该路径上的移动与状态。
- 盘号 `1` 为最小盘；移动编号从 `1` 开始（不存在 0 号移动）；状态编号从 `0` 开始（未移动），最大状态号为 `2^n - 1`。
- 总步数与步号一律使用 BigInt，在 API 与 SQLite 中以十进制字符串保存，支持超过 `Number.MAX_SAFE_INTEGER` 的序列（如 60 盘总步数 `1152921504606846975`），相邻两步不会被浮点近似混淆。

## 核心原理

`n` 盘解分为三个区段：移动上方 `n-1` 盘（长 `2^(n-1)-1`）、移动最大盘（1 步）、再移动 `n-1` 盘（长 `2^(n-1)-1`）。查询第 `k` 步或第 `k` 步后的状态时，按 `k` 落在哪个区段整体跳过无需展开的子问题，递归下降 `O(n)` 层即得结果，**绝不从头逐步模拟**。`move` 接口返回的 `trace` 字段列出经过的每个递归区段及累计跳过步数，便于核对随机访问。逐步列举仅限用户请求的有限窗口（上限 1000 条）。

## 命令

```powershell
npm install        # 安装开发依赖（typescript、@types/node）
npm run build      # 编译到 dist/
npm test           # 编译并运行全部测试
npm start          # 启动 HTTP 服务（默认绑定空闲端口；PORT 环境变量可指定）
npm run demo       # 演示：3 盘全 7 步、60 盘中段/近末尾随机访问、游标重启续进
```

CLI（`npm run cli -- <命令>` 或 `node dist/src/cli.js <命令>`）：

```
serve [port]                       启动 HTTP 服务
create <n> [src] [dst] [aux]       创建任务
list                               列出任务
total <id>                         查询总步数
move <id> <k>                      定位第 k 步（含递归区段解释）
state <id> <k>                     完成 k 步后的各柱状态（含核验结果）
window <id> [from] [limit]         读取有限移动窗口
advance <id> [budget]              按预算原子推进演示游标
export <id>                        导出任务参数与当前游标状态
```

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/tasks` | 创建任务 `{n, source, target, auxiliary}` |
| GET | `/tasks` / `/tasks/:id` | 任务列表 / 详情（含总步数与游标） |
| GET | `/tasks/:id/total` | 总步数 |
| GET | `/tasks/:id/move/:k` | 第 k 步移动 + 递归区段 trace |
| GET | `/tasks/:id/state/:k` | 第 k 步后状态 + 合法性核验 |
| GET | `/tasks/:id/moves?from=&limit=` | 有限移动窗口（limit ≤ 1000，越界自动截断） |
| POST | `/tasks/:id/advance` | `{budget}` 原子推进游标（单次 ≤ 10000），返回实际执行的移动 |
| GET | `/tasks/:id/export` | 导出任务与当前游标状态 |
| POST | `/tasks/:id/verify-move` | `{k}` 独立核验第 k 步移动合法性 |

每条移动形如 `{k, disk, from, to}`；状态为 `{柱名: [从底到顶的盘号]}`。

## 错误码

`INVALID_N`（非法盘数）、`DUPLICATE_PEG`（柱名重复）、`INVALID_PEG`、`INVALID_STEP`（负步号/非法预算）、`OUT_OF_RANGE`（0 号移动、越界查询）、`LIMIT_EXCEEDED`（窗口/预算超限）、`NOT_FOUND`、`CONFLICT`（游标并发冲突）、`BAD_REQUEST`。失败请求不会修改游标或已有进度。

## 持久化与核验

- SQLite 数据库默认保存在项目内 `data/hanoi.db`，记录任务参数、算法版本（`hanoi-3peg-optimal-v1`）与演示游标（十进制字符串）。
- 游标推进在 `BEGIN IMMEDIATE` 事务内以条件更新原子完成；重启后从同一位置继续，已完成的推进不会重复计为新移动；只读跳转查询（move/state/moves）不修改游标。
- 独立核验器：状态中每个盘恰好出现一次、柱内从底到顶严格变小；合法移动只能取柱顶、且不能压在更小的盘上。
- 测试用朴素递归全量模拟（n ≤ 8）逐步对照随机访问结果，并覆盖零盘、单盘、首尾状态、窗口截界、柱名重命名、跨 `2^53` 大整数边界、游标重启续进等场景。

## 限制

- 盘数上限 1024（`2^1024` 量级的步号仍以 BigInt 精确处理）；窗口单次上限 1000 条，推进单次预算上限 10000 步。
- Node.js 的 `node:sqlite` 目前带 Experimental 警告，不影响功能。
