# ADR-0080：袭警零容忍与押送链路的四个时间/落点修复

- 状态：已采纳
- 日期：2026-11-13
- 关联：小黑屋处置与押送沿用 ADR-0072；打人触发执法沿用 ADR-0074（本 ADR 覆盖其
  「只统计真人受害者」的口径）；擂台豁免沿用 ADR-0075；保安 NPC 与 role 字段沿用
  ADR-0061 / ADR-0063；零持久化沿用 ADR-0004；通知通道沿用 ADR-0038

## 背景

玩家反馈「攻击保安不会触发逮捕」。排查确认不是命中几何或 AOI 的问题：
`sim/vent` 的 `nearestInCone` 能选中保安，擂台外命中也会回调 `VentHitObserver`，
但 `sim/detention` 的 `onVentHit` 在第二行就把所有 NPC 受害者挡掉了：

```ts
if (attacker.isNpc || attacker.wsId === 0) return;
if (victim.isNpc || victim.wsId === 0) return;   // ← 保安 isNpc = true
```

保安走 `world.createNpc(..., role)` 生成，`isNpc = true`、`wsId = 0`，
所以打保安永远进不了账本，也就不会有警告与派单。原注释「只统计真人命中」是
按「NPC 都是同事」写的，保安加入后这条前提不再成立。

顺着押送链排查，还有四个会让逮捕「抓不到 / 送不到 / 卡死 / 穿墙」的阻塞缺陷：

1. 追击速度是「保安基础速度 × 1.3」，而基础速度是 `MOVE_SPEED × speedFactor`
   （0.62–0.95）→ 最慢只有 133px/s，低于玩家常速 165px/s，目标一直跑就追不上，
   12 秒后按证据不足放人；
2. 拖行超时固定 15 秒，拖行速度只有 87–133px/s，只够走 1300–2000px，
   西北角抓到的人必然在半路被放走；
3. `stepEscort` 在函数最前面判断硬直并 `return null`，超时判定排在它后面，
   保安被反复创飞时计时器整体停摆；被押者的 45 秒硬直还比 40 秒的案子上限长；
4. 被拖者落点直接写 `guard - tow * 22px`，绕过碰撞求解器，拐角处会写进墙体，
   随后又被 `grid.update()` 写进空间索引。

## 决策

### 1. 袭警零容忍：只认保安，命中一次即建案

`onVentHit` 改为「先挡攻击者与在案者，再分受害者类型」：

- 攻击者是 NPC / 离线，或已在押送流程中（`cases.has`）→ 直接返回；
- 受害者是 NPC 且 `role === ENTITY_ROLE_GUARD` → 清掉该攻击者的打人账本，
  调 `openCase(attacker, now, SYSTEM_NOTICE_KIND.DetainedFight)`，不再累计；
- 受害者是普通同事（role 0）或离线实体 → 仍不进入执法；
- 受害者是真人 → 原 2 分钟窗口、2 次警告、3 次建案的规则完全不变。

复用 `openCase` 而不是另写建案路径：占反省点、`cases` 闸门、`tryDispatch`、
通播文案都在这一段里，两套建案逻辑迟早会漂移。通知复用
`SYSTEM_NOTICE_KIND.DetainedFight`（「… 被保安请进了小黑屋：园区内不许动手。」），
协议零改动。

被打倒的保安在 `stunUntil` 内不会被 `dispatchEscort` 选中，会自然派给其他空闲保安；
全部在忙时走既有 12 秒排队超时。

### 2. 追击速度加下限

```ts
chaseSpeed(guardSpeed) = max(guardSpeed × 1.3, MOVE_SPEED × 1.1)
```

快保安保持原倍率，慢保安至少比玩家常速快 10%（181.5px/s）。倍率集中在 `ESCORT`，
出口是一个纯函数，单测直接验边界。

### 3. 拖行截止按路线长度派生

`EscortTask` 增加 `dragDeadlineAt`，在 `beginDrag` 算完两段路线后一次写入：

```ts
deadline = now + clamp(pathLength / dragSpeed × 1.6, DRAG_TIMEOUT_MS, DRAG_TIMEOUT_MAX_MS)
```

短途仍保底 15 秒，长途按 1.6 倍路程给足余量，上限 60 秒防异常路径。
`dragDeadlineAt === 0`（旧任务对象）时退回固定 15 秒，绝不出现「永不超时」。

### 4. 超时只看时间，硬直只跳过推进

- `chase` / `drag` 的超时判定提到 `stepEscort` 最前面，被创飞期间照常计时；
- 原地「起床」逻辑保留，但排在超时之后；
- 拖行每帧把被押者 `stunUntil` 续到 `now + DETENTION.DRAG_LOCK_MS`，
  任何停摆都会先让被押者恢复行动；
- `DRAG_LOCK_MS` 从 45 秒降到 5 秒（不再是「一次写死、等别人清」的长硬直）；
- `CASE_TIMEOUT_MS` 从 40 秒提到 90 秒，覆盖「排队 12s + 追击 12s + 拖行 60s」，
  作为任务丢失时的硬兜底；它不影响被押者自由，因为硬直只有 5 秒。

共享常量由 `npc/escort` 从 `sim/detention` 读取 `DETENTION.DRAG_LOCK_MS`，
不再两处各写一个 45 秒字面量（依赖方向仍是 npc → sim，没有反向导入）。

### 5. 被拖者落点走碰撞求解

`placeTargetBehind` 用 `resolveMotionInto` 从保安脚下求 `guard - tow × 22px`：
拐角处会被截停在墙边，宁可贴住保安，也不产生非法坐标；写完后才 `markDirty`，
`director` 的 `grid.update()` 拿到的就是合法位置。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 所有 NPC 被打都计入执法 | 规则统一 | 打普通同事也会被抓，改变现有产品语义 | 否决（用户确认只保安） |
| B. 袭警也走 3 次累计 | 复用现有账本 | 与「袭警零容忍」的产品预期相反 | 否决（用户确认 1 次建案） |
| C. 新增一种袭警通知编号 | 文案更贴切 | 要扩协议枚举与客户端模板，收益不抵 | 否决 |
| D. 拖行超时固定放宽到 30 秒 | 改动最小 | 最远路径仍可能超时，且近距离要白等 | 否决 |
| E. 被抓后直接传送到小黑屋 | 绝不超时 | 破坏 ADR-0072 的步行押送演出 | 否决 |
| F. 本 ADR 的组合（采纳） | 判定权威、改动集中在执法层、协议零改动 | 新增一个任务字段与两个纯函数 | 采纳 |

## 后果

- `onVentHit` 的 NPC 过滤从「一律排除」变成「只放行保安」，账本仍是两级 Map；
- `EscortTask` 多一个 `dragDeadlineAt`，`director` 建任务时初始化为 0；
- 新增单测：打保安立即建案、已在案中不重复、普通同事不计数、
  最慢保安追击快过玩家常速、拖行截止按长度派生、硬直中超时仍中止、拖行落点不穿墙；
- `escort.test.ts` 的夹具补 `dragDeadlineAt`，`detention.test.ts` 原
  「打 NPC 不计数」改成「打普通同事不计数」；
- 回滚：还原 `onVentHit` 的 NPC 分支、`chaseSpeed` / `dragDeadline` 两个函数与
  `DETENTION` 的两个常量即可；协议、客户端与持久化都没有改动。

## 已登记、本次不修的边界项

以下问题在同一链路排查中发现，但不在本次范围内，记录在此避免重复排查：

1. 反省点只有 3 个，第 4 个并发案子会复用 1 号位，落位也不检查是否已有人；
2. `hasWitness` 只看 56px 距离、不做视线判定，隔墙的 NPC 也算目击；
3. `abort` 对 `pending` 案子也无条件广播 `Released`，客户端可能收到没 Dispatch 过的解锁包；
4. `finishEscort` 无条件把保安置回站姿，不检查 `stunUntil`，观感与状态可能短暂不一致；
5. `cancelEscort` 用 `Date.now()` 作时基，与 Tick 的 `now` 不同源（测试/回放可见）；
6. 入座者挡住老板的受击判定（是否设计意图待确认）；
7. `ventPending` 先清后判 `vent` 位，极端包序下可能丢一次出招（待验证）；
8. 保安名册在名额耗尽时 `break`，极端情况下 `guardCount = 0` 会让执法整体不创建。
