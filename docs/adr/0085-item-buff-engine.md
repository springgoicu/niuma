# ADR-0085：道具与 Buff 走统一状态表，特效用一条广播包

- 状态：已采纳
- 日期：2026-11-15
- 关联：[ADR-0051](0051-vent-knockdown-and-state-bit6.md)（发泄与倒地硬直）、
  [ADR-0061](0061-server-side-npcs.md)（服务端权威 NPC）、
  [ADR-0072](0072-jail-detention-and-escort.md)（保安押送）、
  [ADR-0082](0082-niubi-coin-economy.md)（牛马币经济）、
  [ADR-0083](0083-challenge-bus.md)（互动包限频）

## 背景

经济系统上线后，`Player` 上出现了两个孤立的截止时间戳：`hasteUntilMs`（能量饮料改冷却）
与 `shieldUntilMs`（续命奶茶免击倒）。它们在三个地方各写一遍判定（`sim/vent`、`sim/movement`、
`server.ts` 的道具分支），再加两件道具就要出现第三、第四个时间戳，以及第四份「过期怎么算」。

同时，社群需要的是一整套「可整蛊、可自保、可见」的道具：

- 自用增益（移速、冷却、护盾）与一次性表演（彩带）；
- 点人释放的负面效果（滑倒、降薪贴、雇佣保安盯梢）；
- 全服广播（大喇叭）。

这些效果共同的特征是：**有时长、有可视表现、可能被护盾抵消、可能被保护冷却挡住**。
只靠 Tick 同步里的 state 位表达不了，只靠「道具 id + 谁对谁」也表达不了时长与抵消。

## 决策

### 1. 一张 `activeBuffs` 表 + 两个乘子缓存

- `Player.activeBuffs: Map<BuffType, expiresAt>`，键值都来自 `packages/shared-types/src/buffs.ts`
  的 `BUFF` 表（只追加不复用）。
- 乘子（移速、发泄冷却）在状态变更时重算成两个标量 `speedMul` / `ventCdMul`；
  `applyMove`（20Hz）与 `resolveVents` 只读标量，不在热路径上遍历 Map。
- 过期清理集中在 Tick 末尾的 `pruneBuffs`（单遍、条目上限 5）。
- `Player.reset()` 与 `applyEconomy()` 必须同时清空这三项——对象池复用不能继承上一个人的贴纸。

`sim/buffs.ts` 是唯一能改这些字段的模块；`sim/items.ts` 只描述「哪件道具做了什么」。

### 2. `S2C_PLAYER_EFFECT` 取代 `S2C_ITEM_EFFECT`

`[op][effect u8][sourceId u16][targetId u16][extraId u16][durationMs u16][flags u8]`，11 字节定长：

- `durationMs` 是客户端表现时长的唯一来源，本地不另算过期；
- `flags bit0` = 接收者就是目标（决定要不要镜像本地硬直）；
- `flags bit1` = 被护盾抵消 / 未生效，只播被挡表现、不挂状态；
- `extraId` 携带接单保安的实体 id，客户端据此在保安头顶喊「盯紧你了！」。

旧的 `S2C_ITEM_EFFECT`(0x3d) 停止发送，编号永久留空。新号段从 `0x41` 起：
`C2S_SHOUT` / `S2C_SHOUT_REJECT` / `S2C_LOUDSPEAKER` / `S2C_PLAYER_EFFECT` / `S2C_ITEM_REJECT`。

### 3. 道具目录收敛为 7 件，覆盖与保护都靠服务端

| id | 道具 | 价格 | 目标 | 效果 |
|---|---|---|---|---|
| 2 | 彩带礼花 | 40 | 点人 | 纯演出 |
| 4 | 冰美式 | 30 | 自用 | 60s 移速 +15%、发泄冷却 ×0.7 |
| 5 | 摸鱼护盾 | 80 | 自用 | 1 层，挡下一次撞飞或整蛊 |
| 6 | 全服大喇叭 | 100 | 自用 | 30 字金色置顶横幅 |
| 7 | 香蕉皮 | 40 | 点人 | 滑倒躺地 2s |
| 8 | 摸鱼降薪贴 | 60 | 点人 | 20s 贴纸，移速 ×0.8 |
| 9 | 雇佣保安卡 | 150 | 点人 | 最近保安 1.3 倍速尾随 15s |

- id 1（能量饮料）与 id 3（续命奶茶）下线并永久留空：`冰美式`、`摸鱼护盾` 分别取代它们。
- 控制类（香蕉皮 / 降薪贴）共用一条 60 秒整蛊保护：命中后写 `trickGuardUntil`，
  保护期内直接拒绝且在**扣库存之前**返回，操作者不会白花一件道具。
- 护盾先于状态写入结算：挡下时只广播 `blocked`，不挂贴纸、不写硬直、也不占整蛊保护。
- 保安卡派单失败（园区无可用保安）原路退币，并在 `WALLET_REASON` 追加 `ItemRefund`。

### 4. 保安盯梢是独立任务，不与押送抢人

`NpcAgent.follow` 与 `escort` 互斥：`dispatchFollow` 只挑「既没押送、也没在盯人」的最近保安，
允许打断 `walk/pause`；`dispatchEscort` 反向跳过 `follow` 中的保安。盯梢速度复用押送的
`chaseSpeed`（1.3 倍并保底比玩家常速快 10%），追到 18px 内站定面向目标，到期自动收工；
目标断线由 `handleClose` 立刻 `cancelFollow`。

### 5. 入口分工

- HUD 购物车按钮（`ShopButton`）→ 消耗品页；金币徽标 → 属性页；茶台 F → 属性页。
- 茶台原本的「喝枸杞茶恢复硬直」下线：它清的是 `stunUntil`，本质上是一个不需要同步的
  本地状态，而茶台更该承担「永久成长」的入口。
- 点人菜单的「使用道具」改名「整蛊」，只列点人类道具；自用道具在商店里点「使用」。

### 6. 大喇叭走独立上行包

`C2S_USE_ITEM` 是 4 字节定长，塞不下文本。`C2S_SHOUT = [op][len u8][utf8]`（≤ 30 字 / 90 字节）：

- 审核沿用聊天的词表：政治类整条拒绝，污言秽语按打码文本广播；
- 被拒（空串 / 审核 / 无道具 / 3 秒冷却）一律**不扣道具**；
- 广播遍历 `world.players` 找 `wsId !== 0`，是全服而不是 AOI；
- 不写聊天历史、不占聊天限频窗口：发一条大喇叭不该顺手把人禁言 5 秒。

## 后果

- 新增第 8、9 件道具只需要改 `ITEM_SKUS` 与 `sim/items.ts` 的一个 `case`，网络层不动。
- 客户端表现层新增 `BuffFx`（一个 Graphics 重画全场，按 `(实体, 类型)` 存）。
- 移速与冷却的判定从此只有 `speedMultiplier` / `ventCooldownMultiplier` 两份实现，
  服务端与客户端预测读同一组系数。
- 代价：`activeBuffs` 是每名玩家一份 Map（条目 ≤ 5），Tick 末尾多一次单遍扫描；
  `sim/items.ts` 承载了全部规则，文件会比同类模块长，但换来「规则只有一处」。
