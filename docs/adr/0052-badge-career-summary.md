# ADR-0052：工牌考勤摘要由本人上报，服务端内存转发，档案视图统一

- 状态：已采纳
- 日期：2026-11-12
- 关联：ADR-0004（零持久化）、ADR-0035（常驻状态）、ADR-0037（在线时长与点击查看他人工牌）、ADR-0049（渲染线程拆分）

## 背景

ADR-0037 让工牌回答了「你在线多久、在哪、在干嘛」，但只是会话级信息。真正的「牛马考勤档案」——工龄、累计工时、日均、职级、首次入职日、今日/本周工时、行为统计——全部由 `apps/web/lib/game/attendance.ts` 写在**被查看者自己的浏览器**里，服务端没有任何一份副本。

本次需求要求：查看他人工牌时，信息完整度与本人档案一致；同时继续扩充考勤、行为、社交与分享内容。直接后果是：

1. 他人工牌不再是一个 240px 的小卡，而是与本人同一套「牛马考勤档案」弹窗；
2. 档案需要的跨会话数据必须离开本人浏览器，否则永远无法对齐；
3. 出勤地点来自 IP 归属地，他人工牌只应显示到省。

ADR-0037 留下的两条复核信号同时被触发：

- 「工牌详情需要展示外观/背包等完整资料（此时应抽独立的玩家资料查询接口，而不是继续扩 SPAWN）」；
- 「在线时长需要跨重连累计或跨会话保留（此时要引入服务端身份与持久化，重新评估 ADR-0004）」。

## 质量场景与不变量

```text
QUALITY | 信息完整度 | source: 围观者 | stimulus: 点选园区角色 | environment: 桌面/移动端、双客户端在线 | artifact: 他人工牌档案 | response: 展示与本人同字段的完整档案 | measure: 本人档案有的字段，他人工牌缺失数 = 0（数据未上报时显示「未上报」而不是 0） | priority: 高
QUALITY | 隐私 | source: 被查看者 | stimulus: 他人打开自己的工牌 | environment: 任意 | artifact: 出勤地点 | response: 只显示省级，city/isp 永不下发 | measure: 下行包里不出现 city/isp 字节 | priority: 高
QUALITY | 兼容性 | source: 旧客户端/旧服务端 | stimulus: 新旧混部 | environment: 灰度与回滚窗口 | artifact: HELLO/SPAWN | response: 旧端正常入场，忽略未知尾部段 | measure: 旧端入场失败率 = 0 | priority: 高
QUALITY | 下行预算 | source: 服务端 | stimulus: 200 人同屏 + 60s 补报 | environment: 压测 | artifact: S2C_CAREER/SPAWN | response: 广播量低于现有 20Hz 同步预算 | measure: 新增下行 < 50KB/s，帧率无回归 | priority: 中
```

不变量：

- 服务端不接数据库、不写磁盘；`World` 仍是唯一真相，进程重启即清空（ADR-0004）。
- 客户端输入一律不可信：职业摘要只用于展示，不参与移动、碰撞、座位、发泄等任何权威判定。
- 旧客户端读到未知 opcode 直接丢弃；旧解码器读完已知尾部段就停止。
- 本人的考勤历史仍以本地浏览器为唯一真相，服务端不做回写。

## 决策

采用 **客户端自报考勤摘要 + 服务端会话内存转发**：

1. 进园前从 `attendance`、`career`、`readCachedGeo()` 组装固定长度的 `CareerSummary`，随 `C2S_HELLO` 的 `[0xfc]` 尾部段上报；`geo` 异步就绪后与在线每 60 秒用 `C2S_CAREER (0x22)` 补报一次。
2. 服务端在 `handleHello` 与 `C2S_CAREER` 做结构钳制与省份审核，写入 `Player.career`，仅存在内存；`reset()` 清空。`spawnPacketOf` 把摘要追加到 `S2C_ENTITY_SPAWN` 尾部；补报向 `player.known` 广播 `S2C_CAREER (0x23)`。
3. `reportedOnlineSec` 由服务端在入场或补报时写入 `floor((now - joinedAt)/1000)`。观看侧的「今日/本周/累计」增量 = 服务端 `onlineSec` − `reportedOnlineSec`，避免重连与两端时钟偏差造成重复计时。
4. 观看侧 `GameSession` 维护 `careerById` 与 `appearanceById`，`badgeOf` 把 career、appearance、视野内榜单与名次一并交给 `PlayerBadge`。
5. 本人档案不走网络：`SelfArchiveDialog` 直接订阅本地 store；本人与他人都通过 `buildSelfArchive` / `buildRemoteArchive` 产出同一个 `BadgeArchive`，再由同一个 `BadgeArchiveDialog` 渲染。
6. 「本周工时榜」在零持久化下只能是**视野内在线玩家**的快照榜，UI 必须写「同屏劳模榜 · 本周工时（视野内 N 人）」，不伪装成全服榜。
7. 部门与班次由昵称哈希稳定派生，与工号共用 djb2，不占协议字段。

### 协议布局

```text
C2S_HELLO (0x10)
[...既有字段...][status 0xff][sync 0xfd]?[career 0xfc：len u8 + 定长摘要]?

S2C_ENTITY_SPAWN (0x05)
[...既有字段...][onlineSec 0xfe]?[career 0xfc：len u8 + 定长摘要]?

C2S_CAREER (0x22)      [op u8][len u8][career nB]
S2C_CAREER (0x23)      [op u8][id u16][len u8][career nB]
```

- 段追加在末尾；旧服务端 `decodeHello` 读完能力段即返回，旧客户端 `decodeSpawn` 读完在线时长段即返回，多余字节天然忽略。
- 新解码器缺段返回 `undefined`，UI 显示「未上报」，不阻塞入场。
- 摘要是定长数值 + 一个短省份字符串，v2 约 36–66 字节；`spawnWriter` 的 320 字节缓冲足够。
- 省份是唯一自由文本：截断到 10 字 / 30 字节，走现有 moderation；拒绝则空串并显示「保密」。

### Rev 2（2026-11-12）：击倒数

- `CareerSummary` 在 `ventedCount` 后增加 `knockdownCount u16`，v2 定长部分 36 字节、上限 66 字节。
- `CAREER_VERSION = 2`、`CAREER_VERSION_LEGACY = 1`：新解码器同时支持 v1/v2，v1 的击倒数回退 0；旧 v1 解码器看到版本 2 时整段丢弃并显示「未上报」，不会把省份读成乱码。
- 信封层（`readCareerSegment` / `decodeCareerReport` / `decodeCareerBroadcast`）的长度下限改用 `CAREER_MIN_BYTES = 34`，否则 v1 包在进入 `decodeCareer` 前就会被拒。
- 计数口径：只认 `S2C_VENT` 且 `attackerId === localId && targetId !== 0`；空放、被击倒、旁观互殴都不增加。服务端只提供权威归因，不保存累计值。
- 回滚：`CAREER_VERSION` 调回 1 并移除字段；v2 摘要被 v1 解码器按版本拒绝，本地存档中的 `knockdownCount` 可保留并被旧代码忽略，无数据迁移。

## 备选方案

| 方案 | 结论 | 理由 |
|---|---|---|
| A 客户端自报 + 0xfc 尾部段 | 选用 | 保持零持久化、一包拿全、无额外往返、旧端天然忽略；代价是数据可伪造、只覆盖在线玩家 |
| B 点选时按需查询资料 | 不选 | 多一次往返与加载态；服务端仍需保存摘要；工牌详情会闪烁 |
| C 服务端身份与持久化 | 本期不选 | 需要账号、存储与隐私评估，推翻 ADR-0004；本期不需要跨设备与全服榜 |
| D 只显示会话数据 | 不选 | 无法满足「和本人一样全」 |

反向成本（不做 / 晚做）：他人工牌永远停在「在线多久 + 在哪」，工龄、职级、工时、行为统计只能靠聊天问；档案弹窗继续与本地 store 耦合，字段每加一项就要在本人/他人两条 UI 路径各改一遍。

ADR-0037 曾建议完整资料走独立查询接口。本决策的边界是：career 是约 70–90 字节的紧凑身份卡数据，且每次查看都需要；「外观/背包等完整资料」仍不在本期范围，未来仍应走独立查询接口。

## 后果

### 正面

- 本人与他人工牌同源：同一份 `BadgeArchive`、同一个弹窗、同一套印章/条码/分享。
- 服务端仍零持久化；进程重启只丢失展示用摘要，不影响入场与权威状态。
- 协议纯追加，旧端可混部；30 天内回滚只需撤掉双端读写分支。
- 工牌模型收敛为纯函数模块，后续加字段只改 `archive.ts` 与一个展示组件。

### 负面 / 风险

- 摘要由客户端自报，改包即可伪造；只影响展示，不影响任何权威判定。
- 只覆盖在线玩家；离线玩家的本周工时不在榜内。
- 省级地点是自由文本，必须审核与截断；city/isp 永不下发。
- 他人工牌的「今日/累计」是「上次上报 + 服务端在线增量」的口径，存在最多 60 秒的补报延迟。
- 行为统计与考勤存档分两个 localStorage key，需要各自处理 30 秒批量落盘与 `pagehide` 补写。

### 回滚

- 30 天内回滚路径：撤掉 `career` 段的 encode/decode、`C2S_CAREER`/`S2C_CAREER` 分支与 `Player.career`；UI 回退到会话级小卡。无数据迁移，本地存档不受影响。
- 灰度策略：先发 shared-types 与服务端（只读、下发空摘要），再发 Web；旧端始终忽略未知段。

## 复核信号

出现以下任意一条时重新评估：

- [ ] 需要跨设备/跨会话保留考勤，或需要全服历史榜 → 重新评估 ADR-0004 与持久化身份端口；
- [ ] 摘要被用于任何权威判定（排行奖励、准入）→ 必须改为服务端可验证的数据源；
- [ ] 下行预算被 60 秒补报打穿，或 200 人压测帧率回归 → 改为按需查询或延长补报间隔；
- [ ] 他人工牌需要展示外观/背包等完整资料 → 抽独立玩家资料查询接口，停止扩 SPAWN。

## 交付与验证

- 第一刀：shared-types 的 `CareerSummary` + 0xfc 段 + 兼容测试 → 服务端内存转发 → Web 数据层 → 统一档案弹窗 → 分享/印章。
- 兼容性：旧包缺段回退、旧解码器忽略、缓存 `spawnBody` 与整包字节一致。
- 回滚：见上；协议无迁移。
- 测试：协议往返、截断保护、旧包回退；纯函数（周工时、连续天数、部门班次、档案视图模型、行为统计）单测；双客户端互看；旧服务端回退；200 bot 压测。
- 安全：省份审核、数字 clamp、日志只输出 `wsId` 与原因，不打印完整载荷。

## 基线

```text
BASELINE | packages/shared-types | expected: 契约层只做类型与编解码，无运行时依赖 | observed: 既有状态/在线秒数/能力段均按「尾部追加 + 魔数 + 缺段回退」扩展；career 沿用同一模式 | fit: align | patterns: [P-Adapter] | violations: [] | suggestion: 保持 0xfc 为唯一定长身份卡段，完整资料不要再塞进 SPAWN
BASELINE | apps/game-server（Player/view/server） | expected: 内存为唯一真相，客户端输入一律重新裁决 | observed: Player 已持有 appearance/status/joinedAt 与 spawnBody 缓存；career 只作为展示字段存入内存并在 reset 清空 | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 补报限频与审核收口在 dispatch，不污染 Tick 热路径
BASELINE | apps/web（session/archive/UI） | expected: 网络聚合与展示模型分离，UI 不直接解析协议 | observed: 当前 badgeOf 聚合会话数据，但 BadgeDetailModal 直接读 useAttendance 与 geo；本次抽 buildSelfArchive/buildRemoteArchive + BadgeArchiveDialog | fit: partial | patterns: [P-Ports-Adapters, G-Strategy] | violations: [X-Dependency-Leak] | suggestion: 所有工牌字段先进 BadgeArchive，再进 UI
BASELINE | 数据所有权 | expected: 单一真相 + 明确回写边界 | observed: 考勤历史与行为累计只在本人浏览器；服务端只做会话内转发；观看侧只读并计算增量 | fit: align | patterns: [P-Repository] | violations: [] | suggestion: 未来若引入持久化，把 career 放到 PlayerRepository 端口后，而不是让客户端继续自报
```

## 对抗审查

- ARCH-PRIMARY：自报 + 尾部段是当前约束下唯一能同时满足「信息全」「零持久化」「旧端兼容」的方案。
- ARCH-ADVERSARY：伪造、省份文本注入、60 秒补报放大、榜单被误读成全服榜、`reset()` 未清 career 导致对象池串数据。对应处置：只用于展示、省份审核 + 截断、60 秒限频 + 仅 `known` 广播、UI 标注「视野内」、`reset()` 显式清空。
- ARCH-SYNTH：保留方案 A；把「完整资料查询」与「持久化排行」明确排除在本期之外，写入复核信号。

```text
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```
