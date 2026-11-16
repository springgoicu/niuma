# ADR-0104：牛马币钱包与互动托管改为服务端账本

- 状态：已采纳，**取代 [ADR-0082](0082-niubi-coin-economy.md) 第 1 节「浏览器是永久层」**，
  并将 [ADR-0081](0081-server-clock-and-persistent-world-state.md) 第 4 节的落盘范围放宽到
  「按匿名设备号的钱包与互动托管」；ADR-0004 的身份与会话边界继续有效
- 日期：2026-11-16
- 关联：[ADR-0004](0004-no-persistence.md)（无账号）、[ADR-0043](0043-multi-park-deployment.md)（多园区）、
  ADR-0081（共享运行态落盘）、ADR-0082（牛马币）、ADR-0087（热区建筑）、ADR-0093（入座门禁）、
  ADR-0102（协议读端容错）

## 背景

互动玩法已经全部走服务端裁决，但「裁决」与「记账」之间还有四个口子：

1. **钱包的永久层在浏览器**。`C2S_HELLO` 的经济段只过 `sanitizeEconomyProfile` 做上下限钳制，
   客户端把 `coins` 写成 `999_999_999` 服务端照收；重启后余额又回到浏览器。
2. **托管只有一个桶**。`Player.escrowedCoins` 被赌桌、擂台与挑战巴士共用，
   `refundEscrow` / `payoutFromPool` / `settleEscrow` 都会清空整桶。任一玩法结算时，
   另一玩法冻结中的赌注会被一起清掉或一起退回。
3. **赌桌结果可预测**。骰面由 `roundId` 确定性推导，而 `roundId` 在投注期随
   `S2C_DICE_STATE` 下发；改包客户端能在开奖前算出大 / 小 / 豹子与查岗。
   同时 `snapshot` 在 Rolling 阶段就带点数，1.5 秒摇骰演出被提前揭晓。
4. **擂台费用靠闭包变量**。报名费直接 `trySpendCoins` 扣走，`arenaPot` 只活在
   `server.ts` 的闭包里：Award 阶段离场也退费（此时 pot 已清零，凭空造币）；
   等待期断线不退费也不清 pot；夺冠瞬间断线则名次奖励与奖牌一起丢。

这些不是表现层的小问题，而是「谁拥有账本」的问题。互动面板点下去没反应，
只是账本不在服务端时最容易被玩家看到的那一面。

## 决策

### 1. 钱包按匿名设备号落盘，服务端是唯一权威

新增 `apps/game-server/src/economy/wallet.ts` 的 `Wallet` 聚合与
`apps/game-server/src/persist/wallets.ts` 的 `WalletBook`：

- 键是 `C2S_HELLO` 已校验的 16 位小写 hex 设备号，与点赞 / 擂台奖牌同一把钥匙；
- 值包含余额、四维等级、背包、已解锁装扮、分 key 托管、导入时刻与最近进园时刻；
- `world-state.json` 升到 v3，新增 `wallets` 段，仍走 tmp + rename 的原子快照；
- 钱包容量由 `GAME_STATE_MAX_WALLETS` 控制（默认 1024），只按 `lastSeenAt` 淘汰
  「不在线且托管为零」的记录，不设 90 天 TTL——资产不能因为一段时间没来就消失；
- 写盘沿用 `markDirty()` 的 1 秒防抖，20Hz Tick 内不做同步 IO；`stop()` 的
  `flushSync` 必须覆盖钱包；
- 落盘增加上一份 `.bak` 轮转：主档读失败时先尝试备份，再走坏档隔离。

`Player` 持有一个 `Wallet` 引用，`coins / stats / inventory / unlockedCosmetics`
保留为访问器，既有调用点不改语义。同一设备开两个标签页时共享同一份钱包对象，
消费与入账仍是单线程 O(1)，不会各自拿到一份可透支的副本。

### 2. 存量玩家一次性导入，导入后 HELLO 经济段不再采信

- 首次见到某设备号：把本次 `C2S_HELLO` 经济段清洗后导入，余额上限由
  `GAME_WALLET_IMPORT_MAX` 控制（默认 100000），并记录 `importedAt`；
- 之后同一设备号再进园：忽略 HELLO 经济段，回一条 `S2C_WALLET_SYNC(reason=init)`
  把服务端账本盖回客户端；
- 无有效设备号的会话使用临时钱包，不落盘、不导入，保留匿名体验；
- `GAME_WALLET_PERSIST=0` 回到「浏览器是永久层」的旧行为，作为回滚开关。

这是无账号架构的已知边界：清空站点数据会换一个设备号，可能再导入一次。
用导入上限与开关限制影响面，不假装能识别同一个人。

### 3. 托管按玩法分账本

`freezeEscrow / refundEscrow / settleEscrow / clearEscrow` 全部带 key：

| 玩法 | 托管 key |
|---|---|
| 摸鱼大赌场 | `dice:<桌号>:<玩家实体>` |
| 绩效八角笼报名费 | `ring:<玩家实体>` |
| 八角笼观战押注 | `ring:bet:<玩家实体>` |
| 挑战巴士 | `p2p:<matchId>` |

把玩家实体放进 key 是必要的：同一设备开两个标签页时共享同一份钱包，
两笔注额共用一个 key 会让任一笔结算顺手清掉另一笔的本金。

任一玩法只清自己的 key。结算时先确认本局双方的托管都在，缺一条就整局退款而不是照发派彩。
服务端启动恢复钱包后，把所有残留托管原路退回：崩服不丢冻结中的赌注与报名费。

### 4. 离线与离线也按设备号结算

`RingRuntime` 的成员记录设备号与报名费；结算条目带 `deviceId` 与名次。
冠军奖金、前三名奖励与奖牌通过 `WalletBook` / `ProfileBook` 按设备号入账，
玩家下次登录看到新余额与奖牌，不再因为夺冠瞬间断线就白打一局。

报名费只在「比赛未开始」时退：Waiting 期离场与断线退款；
Running / Award 期不退，冠军队拿走全部 `ring` 托管。外部 `arenaPot` 删除。

### 5. 失败必须有回执

新增下行 `S2C_INTERACT_REJECT = 0x5a`，定长 `[op][action u8][reason u8]`：

- `action`：擂台报名 / 离场、赌桌下注、观战押注、买院 / 锁门 / 收币、搬砖结算、
  悬赏领取、红包领取；
- `reason`：未入座、距离过远、阶段不对、名额已满、已参与、余额不足、注额非法、
  忙碌、冷却中、目标无效、库存不足、仅房主、已售出、暂无可收、未知。

客户端只做「编号 → 中文」的映射，服务端不写玩家可见文案。
拒绝包 3 字节、只在明确失败时发送，不进入高频移动路径。

### 6. 数据正确性优先于表现

- 赌桌：构造注入服务端随机源（默认 `crypto.randomInt`），局号不再决定骰面与查岗；
  `S2C_DICE_STATE` 在 Betting / Rolling 下发零骰面，Reveal 才带真实点数与查岗标记。
- 擂台：报名与取消先显示「报名中 / 取消中」，等快照确认；观战面板按座位门禁
  禁用，离座自动关闭。
- 别墅：`VillaPacket` 增加 `owned` 与 `mine`，归属按设备号判定；
  `ownerId` 只表示在线实体，不再承担归属语义。房主离线时仍显示「已拥有」。
- 提示：入座时也先走 `selectContextHint` 的热区 / 场所 / 陈设优先级，
  座位专属文案只做兜底，保证「提示什么、按 F 就是什么」。

### 7. 协议硬切

允许 Web 与 game-server 同版本发布：

- 新 OpCode 从 `0x5a` 起（`0x59` 是当前最大下行编号）；
- `S2C_WALLET_SYNC` 尾部追加可选段：装扮数量 u8 + 逐件 id u8，
  解码器读到剩余字节才解析，旧客户端忽略尾段；
- `VillaPacket` 追加两个布尔字段；
- README 的协议字节数与玩法说明同版本更新。

## 备选方案

- **只补拒绝包与资格复核，钱包仍留在浏览器**：能改善体感，但改包仍能填满余额，
  重启仍回浏览器，不满足「服务端作为数据校验」的目标。
- **把钱包字段塞进现有 `ProfileBook`**：`ProfileBook` 有 90 天 TTL、512 容量，
  语义是匿名口碑；把资产放进去会让「一段时间没来」变成「资产清零」，
  也会让点赞容量挤压钱包容量。
- **引入 SQLite / 数据库**：能解决容量与查询，但违反 ADR-0043 的零数据库、
  一机一园区的部署边界，收益与迁移成本不匹配当前体量。

## 后果

- 正面：
  - 钱包、托管与玩法结算只有一个权威，改包不能凭空造币；
  - 断线、重启、跨玩法同时下注都不再吞币或重复退款；
  - 每次被拒绝的互动都有原因，玩家知道差什么；
  - 多标签页共享同一份钱包，不再各自拿到可透支副本。
- 负面：
  - `world-state.json` 体积增加（1024 个钱包约数百 KB），写盘仍是整档覆盖；
  - 换浏览器 = 新设备号 = 新账本，不提供找回；
  - 同一浏览器进入不同园区是两本账，符合 ADR-0043，但玩家需要知道；
  - 首次导入存在一次性窗口，清空站点数据可再导入一次。
- 回滚成本：低。`GAME_WALLET_PERSIST=0` 回到浏览器永久层；
  `GAME_STATE_PATH=''` 关闭全部持久化；新 OpCode 与包尾段随版本一起回退。

## 复核信号

- [ ] 钱包文件超过规划体积或写盘耗时进入 Tick 采样 → 拆分钱包文件或改增量。
- [ ] 出现跨设备 / 跨园区余额诉求 → 需要账号或共享存储，与 ADR-0004 / 0043 一起重估。
- [ ] 一次性导入被反复利用 → 收紧上限或改为不可导入的新园区。
- [ ] 单设备多标签页出现余额回退 → 检查钱包引用是否被 `Player.reset()` 复制。

## 验证

- `apps/game-server/src/economy/wallet.test.ts`：导入只发生一次、二次 HELLO 不覆盖、
  托管分 key、上限钳制。
- `apps/game-server/src/persist/wallets.test.ts`：恢复、容量淘汰、启动退款、坏条目隔离。
- `apps/game-server/src/sim/dice-hall.test.ts`：注入随机源、Rolling 不揭晓、分 key 托管。
- `apps/game-server/src/sim/ring.test.ts`：Waiting 退费、Award 不退、断线退款、离线冠军入账。
- `apps/game-server/src/persist/world-state.test.ts`：v1 / v2 升 v3、备份恢复。
- `packages/shared-types/src/__tests__/interact-reject.test.ts`：拒绝包与钱包装扮尾段往返。
- Web：入座提示与 F 分发一致、观战面板离座禁用、别墅离线房主显示已拥有。
- 全量 `pnpm typecheck` / `pnpm test` / `pnpm changelog:check`。
