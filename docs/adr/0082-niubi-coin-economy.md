# ADR-0082：牛马币经济以浏览器为永久层，服务端只认本次进园

- 状态：已采纳
- 日期：2026-11-15
- 关联：[ADR-0004](0004-no-persistence.md)（不做账号与身份持久化）、
  [ADR-0034](0034-client-session-snapshot.md)（浏览器会话快照）、
  [ADR-0081](0081-server-clock-and-persistent-world-state.md)（共享运行态才写盘）

## 背景

园区需要一个能花、能赚、能升级的货币闭环，但不能引入账号、数据库或迁移流程。
ADR-0004 明确了「服务端不记得你是谁」，ADR-0081 又把落盘范围限定为「园区公共设施」，
因此玩家资产只能有一个永久层：浏览器自己。

同时，经济必须防作弊：余额不能为负、等级不能越界、道具不能凭空出现、发包不能放大。

## 决策

### 1. 资产档案放 `localStorage`，服务端进程内存是本次进园的权威

- 键名 `niuma:economy:v1`，版本号进键名而不是进结构；读盘过 `sanitizeEconomyProfile`。
- 进园时随 `C2S_HELLO` 尾部追加经济段上报；服务端清洗后立刻回一条 `S2C_WALLET_SYNC(reason=init)`，
  客户端以这条快照覆盖本地值。此后每次发币 / 扣币 / 升级 / 背包变动都只按事件推一条完整快照。
- 断开即回收，不写 `world-state.json`，也不写 `persist/profiles.ts`：
  重启后每位玩家回到自己浏览器里的余额。这正是「不做账号」的直接后果，不是遗漏。

### 2. 协议只追加，不动旧字节

- 经济段魔数 `0xf7`：`0xf8–0xff` 均已被既有尾段占用，`0xf7` 大于 `MAX_STATUS_BYTES`，
  不可能是合法状态长度，不会与旧段混淆。
- 段格式 `[0xf7][len u8][coins u32][4×stats u8][houseTier u8][count u8][id u8][count u16]×N`，
  `count` 与 id 升序，未知 id 吃掉长度后丢弃。
- `decodeHello` 的 resume 窥视排除列表加入 `0xf7`，否则尾段会被误读成落点。
- 新 OpCode 从 `0x33` 起（`0x31/0x32` 已被既有包占用），全部登记进 `guard.ts` 的定长表，
  未刷新客户端遇到新包由 `PACKET_UNKNOWN` 静默丢弃，不会断线。

### 3. `EconomyService` 是唯一入口

`grantCoins / trySpendCoins / upgradeStat / buyItem / consumeItem / freezeEscrow /
settleEscrow / refundEscrow` 全部 O(1)，并在同一个 `applyChange` 钩子统一发钱包快照。

- 扣币先判后减，余额永不为负；道具先扣库存再上效果。
- 钱包快照带**完整背包**而不是增量：包体 ≤ 60 字节、幂等、没有合并 bug。
- 托管（Escrow）是「冻结」而不是「扣款」：`escrowedCoins` 单独记，结算 / 退款只会发生一次。

### 4. 收益挂点全部靠上游语义保证幂等

| 来源 | 挂点 | 幂等依据 |
|---|---|---|
| 擂台前三 | `RingRuntime` 的 settle 回调 | 一局只 settle 一次，按名次发 |
| 击倒他人 | `vent.ts` 的 `onKnockdown`，仅场外分支 | 每次有效命中只回调一次 |
| 踹倒老板 | `vent.ts` 的 `onBossKill` | 只在 `justDied` 回调 |
| 每日任务 / 对局 | `EconomyService` 调用方 | 同一局 / 同一天只调用一次 |

NPC 不进入发币路径：`wsId === 0` 的实体只参与玩法，不拥有钱包。

### 5. 属性影响玩法，但两端同一把尺子

`effectiveVentCooldownMs(atkSpeedLv, hasted)`：基础 1200ms，每级 −70ms，下限 500ms。
服务端 `sim/vent.ts` 按等级读冷却，客户端只做展示；真正裁决仍在服务端。

## 后果

- 正面：
  - 零数据库、零账号，发版重启不丢玩家资产；
  - 所有发币 / 扣币共用一个钩子，前端只需处理一种钱包包；
  - 旧客户端被新服务端忽略经济段，不崩、不断线。
- 负面：
  - 换浏览器 / 清缓存 = 资产归零，这是「不做账号」的已知代价；
  - 断线时服务端退款只存在内存，客户端要等重新进园才拿到权威快照；
  - 钱包包不能带外观与每日任务，客户端必须做「本地字段 + 服务端字段」的合并。
- 回滚成本：低。移除 HELLO 尾段与新 OpCode 路由即可回到无经济版本，旧客户端不受影响。

## 复核信号

- [ ] 出现「换设备继续余额」或「资产找回」诉求 → 需要账号或可迁移凭据。
- [ ] 出现跨园区共享钱包 → 需要共享存储，与 ADR-0043 一起重估。
- [ ] 钱包包超过 200 字节或背包种类超过 20 → 改增量或分页。
- [ ] 玩家通过断线 / 重连刷币 → 需要把结算与托管搬到可审计的持久层。

## 验证

- 协议：`packages/shared-types/src/__tests__/economy-protocol.test.ts`（HELLO 尾段往返、
  段缺失兼容、钱包同步、各互动包往返、钳制边界）。
- 存储：`apps/web/lib/__tests__/economy-storage.test.ts`（空档、往返、坏档清洗）。
- 服务端：`sim/vent.test.ts` 的冷却断言改为按等级量取；`economy/service` 的扣币与托管路径由单测覆盖。
