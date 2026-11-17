# ADR-0115：救护车按场所门洞寻路，不再盲瞬移

- 状态：已采纳
- 日期：2026-11-16
- 关联：救护车四态与固定航点沿用 ADR-0084（本 ADR 补充其 §3「不做寻路」口径）；航点走向沿用 ADR-0097；站内伤员南侧通道口沿用 ADR-0092；围合场所清单沿用 ADR-0103；救护车继续走 `resolveMotionInto`、不走步行门禁沿用 ADR-0107；共享导航抽取自 ADR-0072 的押送寻路

## 背景

玩家反馈「救护车出任务会卡墙，进了别的场所就卡住」。核查 `AmbulanceManager.advanceCar`
确认了根因：ADR-0084/0097 为救护车设计了「两段固定绕行航点 + 从路口直线追伤员坐标」，
碰撞只用单轴滑行的 `resolveMotionInto`（无寻路、无门洞概念），且只对急救站做了入口特判
（`CLINIC_VEHICLE_ENTRY`）。

ADR-0103 把园区改成开放布局后仍保留了数处围合场所（小黑屋西门、卫生间北门、别墅院墙、
擂台围栏）。伤员倒在这些场所内时，车从路口直线冲过去顶在墙上、滑行找不到门；8 秒
`UNSTUCK_MS` 又把车盲瞬移到 `patient.x + 36`（固定 `dirX = -1`），落点常常在墙里或别的
房间，下一帧被 `resolveMotionInto` 的起点脱困弹回，形成反复「卡墙」。送回段同样是直线，
会二次卡住。基线测试显示：伤员倒在卫生间内时，旧实现 8/8 次都无法完成接人。

## 决策

### 1. 抽出共享导航工具，押送与出警共用一份寻路

把原先私藏在 `npc/escort-path.ts` 的 24px 网格 BFS + 4px 视线简化下沉到
`game-server/src/nav/path.ts`：

```ts
export function findPath(from, to, radius = PLAYER_RADIUS): NavPoint[] | null;
export function warmNavGrid(radius = PLAYER_RADIUS): void;
export function nearestFreePoint(x, y, radius = PLAYER_RADIUS): NavPoint | null;
```

- `escort-path.ts` 退成薄封装，保留 `findEscortPath` / `warmEscortGrid` 签名，`npc/escort.ts`
  零改动；
- `sim/clinic.ts` 与 `npc/escort.ts` 是平等消费者，**都向内依赖 `nav/`**。这样避免了
  `sim → npc` 的反向依赖（clinic 若直接 import escort-path 会踩 ADR-0106 的边界）；
- 网格按 `radius` 缓存。`isBlocked` 支持半径膨胀，门洞净宽下限 38px（2×PLAYER_RADIUS + 20，
  见 `door-clearance.test`）在车与保安共用 `PLAYER_RADIUS=9` 时均可通过，无需为车另建网格。
  `clearance` 参数留给未来车身变大时按半径多建一张网格。

选 BFS 而非 A*：无障碍启发、无权图、单次约 2.8 万格、地图静态只建一次、任务级调用（每次
出警规划 1–2 条路径），BFS 已足够且复用了押送侧久经检验的实现。

### 2. 出警追人 / 送回 / 返航改为按路线逐点推进

`Ambulance` 增加 `route / routeIndex / routeGoalX / routeGoalY / lastProgressAt`。追人段不再
直线 `moveCar(patient)`，而是 `findPath` 出路线后逐点推进；昏迷伤员坐标固定，一次出警通常
只规划一次，目标位移超过 24px 或被清空才重算。送回第一段（从伤员所在场所出来到主路口）
同样走路线，避免出场所时二次顶墙；返航、固定航段到达后的贴点也改用 `nearestFreePoint`
保证落点合法。

两段固定绕行航点（东侧空地 → 南向主路）与站内伤员的南侧通道口特判保留——它们是可见的
观感设计与既有回归断言，不是卡墙来源。

### 3. 盲瞬移改为碰撞安全落点

任何一段的兜底都不再写 `patient.x + 36` 这类可能落进墙里的坐标，统一经 `nearestFreePoint`
落到最近可走格；装人后 `attachPatient` 的车尾点（车头反方向 26px）先用 `isBlocked` 校验，
落在障碍里就就近挪到空地。中途完全不动超过 `NAV_STALL_MS`（2.2s）也会提前兜底，而不是
原地磨满 8 秒。

### 4. 不加运行时 feature flag

回滚走 git revert 即可。加 flag 会在 `advanceCar` 里长期保留「旧直线 / 新寻路」两套分支，
违背 YAGNI；本改动边界清晰（导航工具 + 三个推进段），直接回退即可恢复 ADR-0084 行为。

## 备选方案（未采纳）

- **泛化入口航点**：仿 `CLINIC_VEHICLE_ENTRY` 给每个围合场所配一个车辆入口点，按
  `venueAt` 选点走「主路 → 入口 → 直线追人」。改动更小，但每新增场所都要手工配点，且场所
  内部有院墙/多房间时最后一段仍会卡；ADR-0103 后各场所内部布局各异，单入口无法保证可达。
- **只改安全脱困、不改路线**：仅把盲瞬移换成合法落点。能消除「瞬移进墙又被弹出」的抖动，
  但车仍会顶墙磨满数秒、深处伤员依旧无法真正抵达，不满足「看得见地开过来」。

## 后果

- 导航能力成为共享工具层，未来任何「从 A 点走到 B 点」的服务端实体（护士护送、新 NPC）
  都可复用，不必再各自写寻路。
- 出警路径不再是人为指定的两段直线，而是网格最短路 + 视线简化；绕行观感由「固定航点」
  转为「障碍驱动」，路径可能比原走廊更短。
- 车内伤员仍以拖拽姿态跟随，不新增瞬移；本改动不改变 ADR-0004 的零持久化口径。

## 回滚

删除 `nav/path.ts`、`escort-path.ts` 恢复原实现、`clinic.ts` 回退到 ADR-0084 的直线追人 +
盲瞬移即可。地图几何与非急救链行为不受影响。30 天内若出现异常，可整体 revert 本 ADR 的
提交，无需迁移数据。
