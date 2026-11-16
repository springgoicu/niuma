# ADR-0113：押送员或被押者失去行动能力时押送当场作废

- 状态：已采纳
- 日期：2026-11-16
- 关联：执法与押送沿用 ADR-0072；执法时限沿用 ADR-0080；NPC 一击即倒与被救护车送医沿用
  ADR-0106（本 ADR 覆盖其第 4 节「押送计时挂起」与第 5 节「康复后续接押送」的口径）；
  伤员交接链沿用 ADR-0109；零持久化沿用 ADR-0004 / ADR-0081

## 背景

ADR-0106 让所有被击倒的实体都进入救护链，其中 `npc/escort.stepEscort` 的第一行是
`if (guard.incapacitated) return null;`：押送计时挂起、任务保留，等保安在急救站被治好后再
`restore` 回来续追。这条口径在纸面上是「不让案子因为押送员住院而白白失败」，实际表现是：

1. 玩家被抓后躺在地上，保安被第三方（或玩家自己）创倒送医，玩家的拖行硬直只续 5 秒，
   但客户端仍拿着 `escortLocked`，于是**原地发呆**等救护车往返 + 3 秒疗程，之后又被同一个人拖走；
2. 押送与被押者自己的昏迷会同时成立：保安被创倒的同时玩家也可能被创倒，
   `stepEscort` 继续按「保安身后 22px」写玩家坐标，`sim/clinic.attachPatient` 又按
   「车尾 26px」写同一个人的坐标，两边逐 Tick 互相拉扯；
3. `detention.abort` 半路放人时无条件 `applyState(POSE.Idle)`，对一个已经昏迷的人等于
   「把躺着的伤员扶起来站着」。

押送是「把人送到反省点就立刻放人」的短流程（ADR-0072），它没有继续等待的语义：
押送员或目标一旦失去行动能力，这一单就已经没有执行者或执行对象了。

## 决策

### 1. 押送员昏迷：当帧中止并撤案

`npc/escort.stepEscort` 把 `guard.incapacitated` 的早退从 `return null` 改为回报事件：

```ts
if (guard.incapacitated) return abort(guard, task, now, 'guard_down');
```

`sim/detention.handleEscort` 走既有 abort 路径：清拖行硬直、广播 `JAIL_PHASE.Released`、
删除案子。**不换其他保安接单、不保留案子、不加免执法冷却**——康复的保安回巡逻，
坐站与打人判定从零重新累计。

### 2. 被押者昏迷：押送让位给救护链

取到目标后新增一条早退：

```ts
if (target.incapacitated) return abort(guard, task, now, 'target_down');
```

坐标所有权就此互斥：中止之后只由 `sim/clinic` 写这个人的位置，不再有「拖行 vs 挂车尾」
的抢写。中止发生在 `npcs.update` 内，早于同一 Tick 的 `clinic.update`，所以当帧就让位。

### 3. 中止原因进联合类型，协议零改动

```ts
export type EscortAbortReason =
  | 'timeout' | 'missing' | 'stuck' | 'cancelled'
  | 'guard_down' | 'target_down';
```

不新增 `JAIL_PHASE`，不解包 9 字节定长 `S2C_JAIL`；客户端仍只认 `Released`。
`guard_down` 额外给被放走的本人发一条系统提示（`SYSTEM_NOTICE_KIND.EscortBroken`），
旁人不发、被押者昏迷时也不发（急救提示已经在播）。

### 4. 收尾不再把昏迷的人扶成站姿

三处「恢复站姿」都加昏迷判断：

| 位置 | 行为 |
|---|---|
| `sim/detention.abort` | 只清 `stunUntil`；`player.incapacitated` 时保留躺姿与位置 |
| `npc/director.finishEscort` | 清任务与行为态；押送员昏迷时不写 `POSE.Idle` |
| `web/session.endEscort` | 无条件解 `escortLocked`；`patientLocked` 时不吸附反省点、不改姿态、不弹「可以自由活动」 |

`escortLocked` 的解除本身必须无条件执行，否则玩家会被一个已作废的案子锁住输入。

### 5. 昏迷者的释放包延后一 Tick

同一 Tick 的执行顺序是 `npcs.update`（产出 abort）→ `clinic.update`（发
`PATIENT Incapacitated`），所以 `Released` 会先于昏迷包到达客户端。客户端那时还不知道
自己已经昏迷，`endEscort` 就会吸附反省点、把人从躺姿扶起来站一帧。

`sim/detention` 因此加了一个一 Tick 的补发队列：`abort` 时若 `player.incapacitated`，
把释放包记进 `pendingReleases`，下一 Tick 的 `observe` 开头补发。等这一 Tick 时
`PATIENT Incapacitated` 已经先到，客户端 `patientLocked` 已为 true，位置与姿态继续归
急救链。清醒者（`guard_down` 但本人没倒）仍然当帧收到 `Released`，没有额外延迟。

队列只存 `playerId + guardId`，补发前复核目标仍在场；玩家断线则直接丢弃，不落盘。

### 6. 删除康复续接押送的分支

`npc/director.restore` 中「押送任务重置回 `chase`」整段删除。撤案后 `agent.escort` 已被
`finishEscort` 清空，这段代码不再可达；留着它会成为第二套「押送可以续追」的口径。
盯梢续接（ADR-0085）保留，它的目标不受押送案影响。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 维持挂起，等保安康复续追（ADR-0106 原口径） | 案子不因住院失败 | 玩家原地发呆数十秒，正是本次要修的体验 | 否决 |
| B. 押送员或目标失能即 abort 并撤案 | 当帧自由，坐标归一处 | 同一轮执法作废，可能被玩成「故意引第三方打保安」 | 采纳 |
| C. 撤回办案子、换空闲保安接单 | 执法不中断 | 玩家刚解锁就可能被第二名保安抓走，体验割裂 | 否决 |
| D. 撤案 + 免执法冷却 | 避免立刻被新单带走 | 多一个计时状态与解释成本；判定本就要从头累计 | 否决 |
| E. 保留 `restore` 的押送续接以兼容旧存档 | 改动更小 | 撤案后不可达，属死代码；保留会漂移出双口径 | 否决 |

## 后果

- 保安被创倒的那一帧，清醒的被押者就收到 `Released`：解锁、恢复站姿、可以立刻走；
  被押者同时昏迷时释放包延后一 Tick，等昏迷包先到再解锁，躺姿与坐标始终归急救链；
- 康复的保安从床尾站起来后直接回巡逻，`/health` 与派单口径不变；
- 被押者自己昏迷时，`clinic` 独占其坐标与姿态，救护车不再与拖行抢人；
- 案件超时（`CASE_TIMEOUT_MS` 90 秒）、排队超时、断线、上擂台撤案等兜底全部保留；
- 玩家视角的提示新增一条：`押送中断：保安被送去急救了，这次先放你一马。`；
- 协议、落盘、客户端阶段分支都没有新增：`Released` 仍是唯一解锁信号；
- 单测：`npc/escort.test.ts`（押送员 / 目标昏迷两条 abort）、`sim/detention.test.ts`
  （撤案、只发本人提示、昏迷者保持躺姿、不重新派单）、`npc/director.test.ts`
  （收尾不扶站、康复后不续追）；
- 回滚：把 `escort.ts` 的两处 abort 改回 `return null`，恢复 `director.restore` 的押送分支，
  删掉 `EscortBroken` 提示、`pendingReleases` 队列与联合类型的两个值；协议与存档零影响。

## 验证

- `npx bun test apps/game-server/src/npc/escort.test.ts apps/game-server/src/sim/detention.test.ts apps/game-server/src/npc/director.test.ts`
- `pnpm -r typecheck`、`pnpm --filter @niuma/game-server test`、`pnpm --filter @niuma/web test`
