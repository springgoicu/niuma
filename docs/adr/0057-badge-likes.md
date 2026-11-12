# ADR-0057：工牌点赞由服务端内存记账，作为「人气」进入牛马榜

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（需求确认）、客户端数据层、服务端模拟、协议层
- **Tags:** badge, social, protocol, zero-persistence, leaderboard
- **Supersedes / superseded by:** 无；扩展 ADR-0054（牛马榜）与 ADR-0052（考勤摘要）

## Context

牛马考勤档案已经能展示本人与他人的完整资料，牛马榜也能按五个指标排序（ADR-0054）。本轮需求是：

> 查看他人工牌可以点赞，并且记录，在排行榜中加入。

点赞有三个不同于现有数据的特点：

1. 它是**跨玩家行为**：A 点 B，B 的计数要涨；不能靠本人自报；
2. 它需要一个**防重复**的口径：同一个人不能把同一块工牌刷成 100 赞；
3. 它要进排行榜，就必须能被服务端排序，而不是只存在某个浏览器里。

项目仍遵守 ADR-0004：服务端不接数据库、不写磁盘。因此本 ADR 的关键取舍不是「怎么持久化」，而是「在零持久化下，点赞能承诺到什么」。

现状约束：

- `Player` 在 `World` 内存里，断开即回收；`known` 是 AOI 对称可见集合；工牌只能点选可见角色打开。
- `S2C_ENTITY_SPAWN` 支持尾部追加段：状态 `0xff`、在线秒 `0xfe`、考勤 `0xfc`、能力 `0xfd`；`0xfb` 空闲。
- 旧客户端读完已知尾部段就停止，未知 opcode 在客户端与服务端都静默忽略。
- `C2S_BOARD (0x24)` 的 metric 字段是 u8，0 表示全部；扩展第 6 个指标不需要改包结构。
- 工牌面板已有 2Hz 推送、焦点陷阱与游戏键拦截；点赞按钮不该另造一套键盘模型。

## Quality scenarios and invariants

```text
QUALITY | 一人一次 | source: 点赞者 | stimulus: 连续点击 / 伪造 C2S_LIKE | environment: 正常 / 恶意客户端 | artifact: S2C_LIKE / Player.likes | response: 同一连接对同一目标只涨一次 | measure: 重复请求的计数增量 = 0 | priority: 高
QUALITY | 可见性 | source: 点赞者 | stimulus: 给看不见的人点赞 | environment: 伪造包 | artifact: player.known | response: 只允许给视野内的目标点赞 | measure: 视野外目标的点赞数不变 | priority: 高
QUALITY | 兼容性 | source: 旧客户端 / 旧服务端 | stimulus: 新旧混部 | environment: 灰度窗口 | artifact: 0x26 / 0x27 / spawn 0xfb | response: 旧端忽略未知段与未知 opcode，正常入场 | measure: 旧端入场失败率 = 0 | priority: 高
QUALITY | 下行预算 | source: 服务端 | stimulus: 60 人在线、连续点赞 | environment: 压测 | artifact: 点赞广播 | response: 只发给目标、目标视野内的人与点赞者，不进 Tick | measure: 单次点赞广播 ≤ 3 包；Tick p95 无回归 | priority: 中
QUALITY | 口径诚实 | source: 玩家 | stimulus: 打开本人 / 他人工牌 | environment: 目标离园 / 服务端重启 | artifact: BadgeArchive / 人气榜 | response: 明确标注「本园区本次运行」，不伪装历史总榜 | measure: UI 文案与清零行为一致 | priority: 中
```

不变量：

- 服务端不写磁盘、不接数据库；点赞随 `Player` 回收或进程重启清零。
- 点赞只用于展示与「人气」榜，不参与奖励、准入、碰撞、发泄等任何权威判定。
- 点赞数不进 Tick 循环；广播只发生在用户点击时。
- 协议纯追加；坏包与未知 opcode 静默丢弃。
- 昵称沿用 `C2S_HELLO` 已审核的结果，点赞不新增自由文本。

## Decision

我们采用 **服务端内存记账 + 新增 `C2S_LIKE (0x26)` / `S2C_LIKE (0x27)` + spawn `0xfb` 尾段**：

1. `Player` 增加 `likes: number`、`likedBy: Set<number>`、`lastLikeAt: number`；`reset()` 与 `World.destroy` 清理。`likedBy` 只记点赞者 id，用于「一个连接对同一目标一次」；点赞者离开时从所有目标里移除其 id，避免实体 id 复用后新玩家无法点赞。
2. `sim/like.ts` 是深模块：校验 400ms 限频、目标存在、禁止自赞、`player.known.has(targetId)` 可见性、`likedBy` 重复；成功后 `likes = min(65535, likes + 1)`，按「目标本人 + 目标视野内其他人收 flag0，点赞者单独收 flag1」广播。重复请求只回点赞者一条 flag1，不涨数、不广播。
3. 协议：
   ```text
   C2S_LIKE (0x26)   [op][targetId u16]

   S2C_LIKE (0x27)   [op][targetId u16][likes u16][flags u8]
   flags bit0 = 接收者就是点赞者

   S2C_ENTITY_SPAWN 尾部
   [0xfb][likes u16]  仅在 likes > 0 时追加
   ```
   `decodeSpawn` 读状态段时把 `0xfb` 与 `0xfe` / `0xfc` 一起排除；`decodeLike` 长度固定 6 字节，坏包返回 `undefined`。
4. 客户端：`NetClient` 只解码；`GameSession` 维护 `likesById`、`likedTargets`、`localLikes`，`badgeOf` 输出 `likes` / `liked`；本人收到的赞随 2Hz stats 推到 `game-ui.myLikes`。React 只读 `PlayerBadge` / `BadgeArchive`，不解析二进制。
5. 工牌 UI：`BadgeArchiveDialog` 头部身份带显示「N 赞」与按钮；他人档案为「点赞 / 点赞中… / 已点赞」，本人档案只显示「收到的赞 · 本次在园」。pending 最多 2 秒，超时用现有 toast 提示「点赞没送到，稍后再试」；换人时清计时器。
6. 排行榜：`BOARD_METRIC.Likes = 6`，榜值读 `player.likes`；与在岗榜一样包含全部在线玩家，未上报 career 也能入榜；其余四榜仍按 `hasCareerReport` 过滤。`BOARD_METRIC_LIST`、`isBoardMetric`、`buildBoardSnapshot`、`BOARD_METRICS` 与 UI 页签同步扩展为 6 个。
7. **清零口径**：点赞只在本园区本次运行期间有效；目标离园或服务端重启即清零。UI 的计数 title 与「人气」榜说明都写清楚，不做补偿、不做本地回写。

### 为什么不把点赞写进 CareerSummary

`CareerSummary` 的语义是「本人自报的考勤/行为展示数据」，服务端只做钳制与转发；把点赞塞进去会有三个问题：

- 计数可被本人改包伪造；
- 需要升 `CAREER_VERSION`，旧解码器会整段丢弃，牵连工牌全部字段；
- 点赞的真相在服务端，和「本人浏览器」这条数据所有权冲突。

因此点赞单独走 opcode 与 spawn 尾段，不污染 career。

## Options considered

### Option A — 服务端内存记账（chosen）

- Shape：客户端 `C2S_LIKE` → `sim/like.ts` 校验 → `Player.likes` 增长 → `S2C_LIKE` 定向广播；spawn 带当前计数；`C2S_BOARD` 的第六个指标读 `player.likes`。
- Pros：跨玩家一致；在线时长/点赞数都是服务端权威；一人一次与可见性门可执行；零持久化；旧端兼容；不新增依赖。
- Cons：目标离园或重启清零；点赞者重连后可再点一次；只覆盖当前在线玩家。
- Reverse cost：低。撤掉 UI 行、0x26/0x27 分支、spawn 0xfb 与 `Player.likes` 即可，无数据迁移。
- Evidence：`like.test.ts`（协议 / 尾段）、`sim/like.test.ts`（重复 / 限频 / 自赞 / 不可见）、`sim/board.test.ts`（人气榜）、`archive.test.ts` / `archive-dialog.test.tsx`（档案与按钮）。

### Option B — 客户端 localStorage 记录后随 career 上报（rejected）

- Pros：不需要新 opcode，刷新后自己还看得到。
- Cons：可伪造、跨设备不一致；点赞数会进入「本人自报」语义，榜单失去可比性；需要升 career 版本。
- Reverse cost：中（已写进本地的数据要清理）。

### Option C — 数据库持久化点赞（rejected for now）

- Pros：跨会话、跨园区、历史总榜。
- Cons：推翻 ADR-0004，需要账号、存储、隐私与运营评估；本期需求只要求本园区在线期间的记录。
- Reverse cost：高。

### Option D — 只做按钮动画、不计数（rejected）

- Pros：改动最小。
- Cons：不满足「记录」与「排行榜中加入」，也无法展示人气。

## Consequences

### Positive

- 点赞是真正的社交动作：别人能看到自己的赞数，人气榜能反映本园区当前谁最受欢迎。
- 一人一次 + 可见性门 + 400ms 限频，把伪造包的放大面压到「最多给视野内每人点一次」。
- 点赞不进 Tick、不进常驻下行；一次点赞最多 3 条 6 字节包，spawn 只多 3 字节。
- 清零边界明确：不承诺历史，UI 不撒谎，符合零持久化。

### Negative / risks

- 目标离园 / 服务端重启后点赞清零；玩家可能误以为是 bug。已用「本次在园」「本园区本次运行」与 title 说明。
- 点赞者重连后可以再次点赞（`likedBy` 随旧 Player 清理）；这是「按连接」口径的必然结果。
- 昵称与在线状态仍可被伪造包影响展示（与 ADR-0052 相同的边界），点赞不改变这一点。
- 没有点赞通知 / 点赞者列表；需求未要求，避免新增通知协议与自由文本。
- 世界地图与碰撞本轮无改动，**不需要**双端同发版；但协议与 UI 仍需按灰度顺序发布。

### Neutral

- 「同屏劳模榜」与「牛马榜」保留各自口径：前者视野内、后者本园区当前在岗；人气榜沿用后者。
- 分享卡暂不带点赞数，避免改分享卡版式；后续若要带，读同一个 `BadgeArchive.likes`。

## Revisit triggers

We will reopen this ADR if:

- [ ] 需要跨会话 / 跨园区保留点赞，或需要「历史总赞」→ 重新评估 ADR-0004 与持久化身份。
- [ ] 点赞被用于奖励、准入、排名发币 → 必须改为服务端可验证的数据源，并加反 Sybil 设计。
- [ ] 出现「给视野外的人刷赞」或重复点赞绕过 → 检查 `known` 对称性、`likedBy` 清理与限频。
- [ ] 60 人压测下点赞广播把 Tick p95 或出口带宽推过水位 → 改为批量/节流或只回点赞者。
- [ ] 产品需要「谁赞了我」列表或通知 → 另开协议与隐私评估，不复用本 ADR 的最小包。

## Delivery and validation

- **First reversible slice**：shared-types 的 `like.ts` + 0x26/0x27 + spawn 0xfb + 单测 → 服务端 `Player` / `sim/like.ts` / dispatch → Web 数据层 → 工牌 UI → 人气榜 → 文档。
- **Compatibility / migration**：协议纯追加；旧端忽略 0x26/0x27 与 spawn 尾段；旧服务端不下发 likes，客户端按 0 展示。无数据迁移。
- **Rollback**：撤掉 `BadgeArchiveDialog` 点赞行、`LeaderboardDialog` 人气页签与 `BOARD_METRIC.Likes`；撤掉 0x26/0x27 分支、spawn 0xfb 与 `Player.likes/likedBy`。无本地存档变更。
- **Tests / fitness functions**：
  - `pnpm --filter @niuma/shared-types test`（254）
  - `pnpm --filter @niuma/game-server test`（160）
  - `pnpm --filter @niuma/web test`（520）
  - `pnpm typecheck`（4 包）
  - 手工：双客户端互看工牌点赞；重复点击不涨；目标离园后计数清零；人气榜排序；移动端按钮不溢出。
- **Security / data / ownership**：点赞数只读展示；服务端限频 + 可见性门 + 一人一次 + u16 上限；不新增自由文本、不写 localStorage、不接数据库。

## Baselines

```text
BASELINE | packages/shared-types（like 契约） | expected: 追加式协议 + 定长包 + 上限 + 无运行时依赖 | observed: like.ts 只放常量/类型；protocol.ts 负责 0x26/0x27 与 spawn 0xfb 尾段；坏包返回 undefined | fit: align | patterns: [P-Single-Source, G-Adapter] | violations: [] | suggestion: 未来点赞若需通知，另开 opcode，不要往 6 字节包里塞文本
BASELINE | apps/game-server（Player / sim/like） | expected: 内存唯一真相，客户端输入重新裁决，热路径零广播 | observed: Player.likes/likedBy/lastLikeAt；handleLike 做自赞/可见/重复/限频；World.destroy 清去重 id | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 若点赞量级变大，先把广播收成按 AOI 批量，不要进 Tick
BASELINE | apps/web（badge / data） | expected: 网络聚合与展示分离，React 不解析二进制 | observed: NetClient 解码 decodeLike；GameSession 维护 likesById/likedTargets/localLikes；BadgeArchive 只读 likes/liked | fit: align | patterns: [P-Ports-Adapters] | violations: [] | suggestion: 点赞失败态继续走 UI 本地超时，不新增错误包
BASELINE | 工牌与榜单 UI | expected: 现有 ink/mint/amber 语言、键盘可达、移动端不溢出 | observed: 点赞行进头部身份带；pending/已赞/本人三态；人气页签 6 列；沿用 focus trap 与 toast | fit: align | patterns: [G-Composite] | violations: [] | suggestion: 真实浏览器跑 390×844，确认 6 列页签与头部点赞行不挤压姓名
```

```text
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```

对抗审查摘要：

- ARCH-PRIMARY：点赞必须服务端记账；零持久化下「本园区本次运行」是唯一诚实口径；人气榜是低成本、高可读性的落点。
- ARCH-ADVERSARY：自赞、重复点赞、给视野外的人刷赞、实体 id 复用导致新玩家点不了、重连后重复点赞、离园清零被当成 bug、`0xfb` 被旧解码器当状态长度。处置：自赞/可见性/重复三重校验、`World.destroy` 清 `likedBy`、UI 标注「本次在园」、`decodeSpawn` 排除 `0xfb`、限频与 u16 上限。
- ARCH-SYNTH：保留方案 A；把「历史总赞 / 跨园区 / 奖励」明确排除，写入复核信号。

## References

- Code: `packages/shared-types/src/like.ts`、`protocol.ts`、`board.ts`、`types.ts`
- Code: `apps/game-server/src/sim/like.ts`、`world.ts`、`view.ts`、`server.ts`
- Code: `apps/web/lib/game/session.ts`、`badge.ts`、`archive.ts`、`leaderboard.ts`
- Code: `apps/web/components/badge/BadgeArchiveDialog.tsx`、`RemoteArchiveDialog.tsx`、`SelfArchiveDialog.tsx`、`apps/web/components/game/LeaderboardDialog.tsx`
- Related ADRs: ADR-0004（零持久化）、ADR-0052（考勤摘要与同屏劳模榜）、ADR-0054（牛马榜与公告栏）
- User requirement: 2026-11-12《查看他人工牌可以点赞，并且记录，在排行榜中加入》
