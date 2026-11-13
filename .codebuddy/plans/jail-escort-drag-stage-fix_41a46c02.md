---
name: jail-escort-drag-stage-fix
overview: 修复保安押送永远停在「按肩」阶段、被押者原地不动的问题：拖行开始时缺少阶段切换，并补一条能拦住该回归的服务端测试。
todos:
  - id: add-escort-regression-test
    content: 新增 escort.test.ts，覆盖抓取、按肩、拖行、到达的坐标与阶段断言
    status: completed
  - id: fix-drag-stage-transition
    content: 修正 beginDrag：算路成功后切换 stage 为 drag 并重置拖行计时
    status: completed
    dependencies:
      - add-escort-regression-test
  - id: verify-and-changelog
    content: 运行 bun test 与类型检查，补版本工报并跑 changelog:check
    status: completed
    dependencies:
      - fix-drag-stage-transition
---

## 问题现象

玩家被判定违规后，客户端只出现提示文字「被保安按住了，正押往小黑屋…」，但角色始终原地躺着，看不到保安按肩、拖行和进屋的过程，直到超时后提示松手。

## 期望结果

- 保安追上后先按肩停顿，再把人沿门口路线拖进小黑屋，全程有连续的位移。
- 被押者本人与旁观者都能看到这段押送过程。
- 送到反省点后立即放人，维持现有「不设禁足时长」的设定。
- 半路不可达或超时时仍按原设计原地松手，不传送、不穿墙。


## 技术栈

- 服务端：Bun + TypeScript，`apps/game-server`，测试用 `bun:test`。
- 共享布局与碰撞：`@niuma/shared-types`（`JAIL_ANCHOR`、`isBlocked`、`resolveMotionInto`）。
- 客户端：TypeScript 帧循环，无需改动。

## 根因（已实测确认）

`apps/game-server/src/npc/escort.ts` 的 `beginDrag()` 只写了 `task.path / task.index / task.startedAt`，从未把 `task.stage` 从 `'hold'` 切到 `'drag'`（全仓搜索 `'drag'` 仅命中 `brain.ts` 的类型定义）。

后果链：

1. 抓取后每 Tick 都进入 `stage === 'hold'` 分支，`now >= stageUntil` 后再次调用 `beginDrag()`，重算路线并把 `index` 重置为 0，然后 `return null`；
2. `placeTargetBehind()` 永远不执行，被押者坐标停在抓取点；
3. `beginDrag()` 每 Tick 把 `startedAt` 刷成 `now`，`DRAG_TIMEOUT_MS(15s)` 永远不会触发，只能等 `detention.CASE_TIMEOUT_MS(40s)` 兜底 abort 才广播 `Released`。

本地只读复现结果：

- 原样：`0 grab ... stage hold`，120 Tick 后 `guard 4270,4950 / target 4290,4950`，坐标完全不变；
- 手动补上 `stage='drag'`：约 50 Tick（2.5 秒）走到 `4626,4944` 并触发 `arrive`，被押者跟随至身后 22px。

## 实现方案

### 1. 修复阶段切换（核心）

在 `beginDrag()` 中，路线计算成功后再切阶段，保证失败路径仍走 `abort('stuck')`：

- 先算 `toDoor` / `toDrop`，任一为空则保持 `task.path = []` 并返回，由 `hold` 分支的 `path.length === 0` 触发中止；
- 成功后依次写入 `task.stage = 'drag'`、`task.path = [...toDoor, ...toDrop.slice(1)]`、`task.index = 0`、`task.startedAt = now`、拖行方向向量。

只改这一处即可恢复「追击 → 按肩 → 拖行 → 到达」全链路；`detention.ts`、`director.ts`、协议与客户端均不需要改动。

### 2. 回归测试

新增 `apps/game-server/src/npc/escort.test.ts`（bun:test），沿用 `escort-path.test.ts` 的真实地图坐标：

- 夹具：`World` + 保安 `(4270, 4950)`、目标 `(4290, 4950)`，两者 `wsId != 0`；任务起点为 `chase`；
- 按 50ms 步进 `stepEscort`：断言先收到 `grab`，且 `player.pose === POSE.Lie`；
- 跨过 `GRAB_HOLD_MS(600ms)` 后断言 `task.stage === 'drag'`（这条就是本次回归的守门断言）；
- 继续步进，断言保安坐标确实变化、目标始终落在保安身后约 `TOW_OFFSET_PX(22)`、最终返回 `arrive` 且保安已进入小黑屋范围；
- 用超时上限（例如 300 Tick）兜底，避免未来再出现「永远 hold」时测试挂死。

### 3. 版本工报

按仓库约定在 `apps/web/data/release-notes.json` 顶部插入一条 `fix` 记录，id 用 `2026-11-13-18`（当前最新为 `2026-11-13-17`），文案只写玩家可感知结果，不写实现细节。

### 4. 验证

- `apps/game-server` 下运行 `bun test`（本机 PATH 无 bun，用 `d:\other\project\niuma\node_modules\.bin\bun.cmd`）；
- `apps/game-server` 下 `tsc --noEmit`；
- 仓库根 `pnpm changelog:check`。

## 性能与可靠性

- 现状是每 Tick 执行两次 BFS（约 2.8 万格）并整段重算路线；修复后整趟押送只算一次，属于净收益。
- 无新增字段、无协议版本变更、无客户端改动，失败路径与超时兜底逻辑保持原样，回滚只需删除阶段赋值。
- 拖行仍复用 `resolveMotionInto` 的地形求解，不会穿墙；中途保安被踹倒时 `stepEscort` 提前返回，路径保留，起身后继续。

## 目录结构

```text
apps/game-server/src/npc/
├── escort.ts          # [MODIFY] beginDrag 算路成功后切到 drag 阶段并初始化计时
└── escort.test.ts     # [NEW] 押送状态机回归测试：抓取→按肩→拖行→到达的坐标与阶段断言
apps/web/data/
└── release-notes.json # [MODIFY] 追加一条玩家可感知的修复记录 2026-11-13-18
```

## 关键代码结构

```ts
// escort.ts beginDrag() 成功分支：阶段切换必须在路径算好之后
task.stage = 'drag';
task.path = [...toDoor, ...toDrop.slice(1)];
task.index = 0;
task.startedAt = now;
```

