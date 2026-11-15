# ADR-0093：入座类玩法统一「必须先坐在对应座位上」

- 状态：已采纳
- 日期：2026-11-15
- 关联：扩展 ADR-0087（热区注册表与四座建筑）、ADR-0088（工位搬砖）、
  ADR-0073 / 0076（八角笼押注与提前结算）

## 背景

摸鱼大赌场的两张骰宝桌在改造前只校验「站在这一桌的热区里」就能下注，
而同样属于「一张桌子 / 一条长椅 / 一个工位」的玩法各自是另一套规则：

- 八角笼观战押注要求坐在长椅上，但组名 `'arena-bench'` 在服务端、客户端提示、
  座位常量里各写了一遍字面量；
- 工位搬砖要求坐在本工位椅上，判定走 `isWorkDeskSeat` + `workDeskIndexOfSeat`，
  提示侧还得单独传一个 `seatDeskIndex` 旁路；
- 赌桌热区虽然早在 ADR-0087 就预留了 `seatGroupId: table.group`，全仓无人读取。

结果是玩法口径不一致（站着也能押注）、硬编码散落三处、提示与服务端拒绝对不上：
玩家在桌边按 F 能开面板，但在长椅旁按 F 什么都不显示。

## 决策

### 1. 一把尺：`seatMatchesHotspot`

新增 `packages/shared-types/src/world/seat-gate.ts`，导出：

- `seatInGroup(seatId, group)`：座位是否属于某组，`0` / 越界 id 恒为 `false`；
- `hotspotRequiresSeat(def)`：热区是否声明了座位门槛；
- `seatMatchesHotspot(def, seatId)`：按 `def.seatGroupId` 比对 `SeatInstance.group`，
  工位热区按 `def.deskIndex` 比对 `workDeskIndexOfSeat`；不带门槛的热区恒为 `true`。

服务端传 `player.seat`（`SeatRegistry` 权威），客户端传 `localSeat`（预测 + 广播校正），
`0` 一律表示未入座。长椅组名收敛为 `RING_BENCH_SEAT_GROUP`，热区表、座位草稿与押注校验共用。

不新增座位字段：工位椅 id 区间已被 ADR-0088 钉死，再加 `group` 只会让
`niuma:session:v1` 旧档的 seatId 语义变复杂。

### 2. 服务端权威 + 双层校验

- `DiceHallRuntime.placeBet` 在热区距离门之前增加座位门：任何入口都绕不过；
- `server.ts` 的 `C2S_DICE_BET` 分支再前置一次（与八角笼押注同样的廉价早退）；
- `sim/work.ts` 与 `C2S_ARENA_BET` 改用同一函数，语义不变。

拒绝保持静默，不新增日志：入座瞬间客户端预测与服务端广播可能短暂不一致，
拒绝是正常路径，回复只会变成刷屏。

距离门保留：坐姿解决「资格」，位置仍要落在热区半径 + `HOTSPOT_SERVER_SLACK` 内，
挡的是坐下后远程伪造包。

### 3. 坐下即入局（不新增协议）

赌局面板不再由按键事件驱动，而是由**当前座位组**派生：

- `GameSession.emitLocalState` 增 `seatGroup`（`pose` / `seated` / `seatKind` / `seatGroup`
  一起参与去重，避免每帧一条 Worker 消息）；
- Worker 通道 `localState` 消息透传该字段，主线程 `GameViewport` 用
  `diceTableByGroup(seatGroup)` 得到桌号，只在座位组变化那一次写 `diceOpen`；
- 离座、换桌、坐进非赌桌座位 → 写 `null`，面板自动收起。

F 保留为「面板被手动关掉后再开一次」；站着按 F 只 `showHint`，不发包也不开面板。

### 4. 提示与服务端同源

`selectContextHint` / `GameSession.interact` 不再把入座类热区过滤掉，而是原地换成
「按 Z 坐进本桌凳子再押注」「按 Z 坐到观战长椅上再押注」「按 Z 坐到自己工位上再搬砖」
这类只有文字、没有按钮的提醒。过滤掉的话，提示条会退回「按 Z 坐下」，
玩家看不出「按 F 没反应」是因为没入座。

## 影响

- 座位 id 与 `DICE_HALL_SEAT_IDS` / `RING_BENCH_SEAT_IDS` 不变，旧存档照旧可用。
- 已下注后起身不退注：注额在结算前一直冻结在彩池里，起身只是关掉面板。
- 可见改动：赌桌旁、长椅旁、工位旁的提示措辞，以及「坐下自动弹面板」，
  已按 AGENTS.md 记入版本工报。
- 新增 `seat-gate` 单测与服务端 `dice-hall` 单测，覆盖站着 / 坐错桌 / 坐对桌 / 离桌太远 /
  窗口关闭五种情形。
