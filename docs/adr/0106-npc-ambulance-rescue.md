# ADR-0106：所有被击倒的实体都进入救护链

- 状态：已采纳
- 日期：2026-11-16
- 关联：急救站、救护车与工伤保护沿用 ADR-0084；护士站桩与硬直回位沿用 ADR-0090（本 ADR 覆盖其
  「护士不触发救护车」的口径）；执法链沿用 ADR-0080；擂台独立战斗域沿用 ADR-0073；
  零持久化沿用 ADR-0004

## 背景

玩家反馈「击打其他角色时护士的逻辑不生效」。ADR-0090 把 `sim/clinic` 的
`observeHit` 里 `if (target.isNpc ...) return` 留成了登记边界：NPC 被打中只进入
1.5 秒硬直，由 `npc/brain` 的「硬直结束自己爬起来」接手。结果是：

1. 园区里只有真人会昏迷、会被救护车接走，打同事、保安、护士看不到任何急救反应；
2. 护士被打倒后由 ADR-0090 的 `advanceNurses` 自动回位，看起来像「瞬移站起来」，
   与「重伤」的视觉预期相反；
3. 同一个命中在 `sim/detention` 里已经按角色建案，执法与急救两套口径不一致。

## 决策

### 1. NPC 一击即倒

`AmbulanceManager.observeHit` 去掉 `target.isNpc` 早退：

```ts
if (target.incapacitated) return;
if (now < target.immunityUntilMs) return;

if (target.isNpc) {
  this.downPlayer(target, now);
  return;
}
// 真人：15 秒窗口内累计 3 次，保持原有手感
```

NPC 被打中一次就 `incapacitated`，复用既有的出警、挂车尾、病床治疗与 15 秒工伤保护，
不新增状态机。真人仍是 15 秒 3 次，避免混战被一拳放倒。

### 2. 归位通过窄端口交还 npc 层

`sim/clinic` 不应该认识 `NpcAgent`、押送路径与巡逻路点，因此新增：

```ts
export interface NpcRestorePort {
  restore(playerId: number, spot: { x: number; y: number }, now: number): boolean;
}
```

`server.ts` 在 `createNpcDirector` 之后注入 `clinic.setNpcRecovery(...)`；
端口缺失或实体不在名册时，clinic 退化为原地站起，救护链不会卡死。

### 3. 归位点取倒地瞬间的坐标

`downPlayer` 对非护士 NPC 记下 `npcReturn: Map<id, {x, y}>`，康复后从这里续接任务。
护士不记账：她们有固定站位，直接复用 ADR-0090 的 `resetNurse`。

- 不用出生点：普通同事的出生点是全岛随机采样，跨岛瞬移会被玩家看到「凭空消失」；
- 不用床尾：保安被送医时押送目标可能已经跑开，回床尾再追会绕远路。

### 4. 昏迷期间冻结 NPC 行为

| 位置 | 改动 |
|---|---|
| `npc/brain.updateAgent` | 最前面 `if (player.incapacitated) return;`，硬直结束后也不起身 |
| `npc/social.updateSocial` | 昏迷期间不做对视 / 让路 / 招手 |
| `npc/follow.stepFollow` | 昏迷期间暂停盯梢推进，`until` 仍照常收工 |
| `npc/escort.stepEscort` | 最前面 `if (guard.incapacitated) return null;`，押送计时挂起 |
| `npc/director` 派单 | 押送与盯梢都排除 `incapacitated` 的保安 |

押送计时挂起是有意的：ADR-0080 的「硬直不冻结计时」只针对 1.5 秒硬直，
住院 3 秒 + 排队 6 秒会直接吃满案子超时。`restore` 时把 `startedAt` 重置为归位时刻，
所以案子不会因为押送员住院而白白失败。

### 5. 康复后恢复被打断的任务

`npc/director.restore` 做四件事：

1. 写回倒地坐标、清 `incapacitated` / `stunUntil` / `carriedBy`、落 `Idle` 站姿并刷新 AOI；
2. 行为态回到 `pause`（600ms），复位卡住计数与进度基准；
3. 押送任务重置为 `chase`、清路径与拖行截止、`startedAt = now`；
4. 盯梢任务清路径并立即重算，保留原 `until`。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. NPC 沿用 3 次累计 | 规则统一 | 与「只要被击倒就要出救护」的产品预期相反 | 否决 |
| B. NPC 一击即倒、复用 `incapacitated` | 不新增状态机，客户端协议零改动 | 送医频率上升，两车两床更容易排队 | 采纳 |
| C. 新增 `npcDowned` 独立状态 | 语义更纯 | 与 `vent` / `brain` / `escort` 三处重复，回归面更大 | 否决 |
| D. 归位点用出生点 | 实现最简单 | 跨岛瞬移，视觉断裂 | 否决 |
| E. 归位点用倒地坐标 + 窄端口 | 视觉连续，押送可原地续追 | clinic 多存一张 Map 与一个端口 | 采纳 |
| F. 住院期间照常跑押送计时 | 不改 ADR-0080 字面口径 | 案子会在病床上超时失败，玩家看不懂 | 否决 |

## 后果

- `sim/clinic` 的伤员从「真人会话」泛化为「任意实体」，但状态仍只在进程内存（ADR-0004 / ADR-0081）；
- 护士被击倒后不再由 `advanceNurses` 提前回位，改为「等救护车送回来再站岗」；
- 保安住院期间不接新单，被押者硬直自然到期后可以离开；案子 90 秒上限仍是唯一硬兜底；
- 客户端协议零改动：`encodePatientStatus` 本来就按 `entityId` 生效，昏迷星星、治疗爱心、
  绿色十字盾牌对 NPC 自动生效，新入场者的 `sendSnapshot` 也会补发在途伤员；
- 频率上升后的容量兜底不变：两辆车都忙时队列最多等 6 秒，超时就地包扎并回位；
- 新增单测：`clinic.test.ts`（一击即倒、全链路送医归位、护士不被提前回位、真人 3 次不变）、
  `brain.test.ts`（昏迷不起身）、`escort.test.ts`（住院挂起计时）、`director.test.ts`（派单排除与归位）；
- 回滚：把 `observeHit` 的 NPC 分支还原为 `if (target.isNpc) return`，删掉 `NpcRestorePort`、
  `npcReturn`、`restoreNpc`、`director.restore` 与四处 `incapacitated` 早退即可；
  协议、客户端与持久化都没有改动。

## 已登记、本次不修的边界项

1. 擂台与野外切磋仍是独立战斗域（ADR-0073）：场内命中不派救护车，淘汰者躺到本局结算；
2. 老板冲击波（`sim/boss-shock`）仍只作用于真人，NPC 不会被震趴；
3. 打老板走 `onBossHit` 独立链路，不经过 `onVentHit`，因此「踢老板」永远不会触发急救；
4. 两名护士同时被打倒时可能一起被送医，站内短时间无人挥手——属于可接受的表现损失，
   不额外加「至少留一名护士」的约束。
