---
name: niuma-badge-likes
overview: 在他人牛马考勤档案中加入点赞：服务端内存记录每人收到的赞、一个连接对同一目标只能点一次，并新增「人气」榜；点赞数随 spawn 与 S2C_LIKE 同步，进程重启或离园即清零。
todos:
  - id: shared-contract
    content: 用 [skill:test-driven-development] 扩展 shared-types：like 契约、0x26/0x27、spawn 点赞尾段、人气指标与单测
    status: completed
  - id: server-like
    content: 实现服务端 Player 点赞字段、sim/like 深模块、0x26 分发、spawn 点赞与单测
    status: completed
    dependencies:
      - shared-contract
  - id: web-data
    content: 打通 NetClient、GameSession、Worker 与主线程点赞通道，扩展 PlayerBadge、BadgeArchive 与 myLikes
    status: completed
    dependencies:
      - shared-contract
  - id: badge-ui
    content: 用 [skill:impeccable] 在 BadgeArchiveDialog 实现赞数、点赞按钮与本人/他人状态，并接入视口
    status: completed
    dependencies:
      - web-data
  - id: board-ui
    content: 用 [skill:impeccable] 为牛马榜增加第 6 个「人气」页签并完成计数格式化与空态
    status: completed
    dependencies:
      - web-data
      - server-like
  - id: adr-readme
    content: 用 [skill:principal-software-architect] 写 ADR-0055，更新 README 的点赞、人气榜、协议与清零口径
    status: completed
    dependencies:
      - server-like
      - badge-ui
      - board-ui
  - id: verify
    content: 用 [skill:verification-before-completion] 跑 typecheck、三包测试、构建与双客户端点赞验收
    status: completed
    dependencies:
      - server-like
      - badge-ui
      - board-ui
      - adr-readme
---

## 产品概述
在园区里查看他人工牌时，可以直接给对方的工牌点赞。点赞数会被记录，并作为「人气」进入牛马榜，让玩家能看见本园区当前最受欢迎的牛马。

## 核心功能
- 他人档案点赞：打开他人工牌后，头部显示「N 赞」与「点赞」按钮；点击后变为「点赞中…」再到「已点赞」，计数同步增加。
- 本人档案：显示「收到的赞」计数，不提供给自己点赞的按钮。
- 点赞规则：只能给当前视野内、正在查看的在线玩家点赞；同一次进入园区对同一块工牌只能点一次；禁止自赞。
- 人气榜：牛马榜新增第 6 个页签「人气」，按收到的点赞数排序；在岗榜与 人气榜都覆盖本园区全部在线玩家。
- 记录边界：点赞数只在本园区本次运行期间有效，目标离园或服务端重启后清零；界面明确标注「本园区本次运行」，不伪装成历史总榜。
- 状态完整：点赞按钮有普通、进行中、已点赞、目标离开四种状态；点赞失败短暂提示后可重试；空榜、断线、加载态沿用现有面板。
- 视觉一致：沿用现有工牌档案与牛马榜的木框纸签、ink 底、mint 高亮与 amber 强调，不另起一套皮肤。

## 边界说明
- 点赞不产生聊天、私信或通知，不新增自由文本。
- 点赞数只用于展示与排行榜，不参与奖励、准入或任何权威判定。
- 人气榜只统计当前在线玩家，离线即离榜。


## 技术栈
沿用现有技术栈，不新增依赖：pnpm + Turborepo + TypeScript strict；Next.js 15 + React 19 + Tailwind CSS v4 + Zustand 5；PixiJS 8；Bun WebSocket + 20Hz Tick；shared-types 二进制协议；localStorage 只承载原有考勤/行为统计，不承载点赞。

## 方案选择
| 方案 | 结论 | 理由 |
|---|---|---|
| A 服务端内存记录，新增 0x26/0x27 | 选用 | 点赞是跨玩家行为，必须由服务端裁决；内存计数符合 ADR-0004；可做一人一次、可见性门与限频；点赞数可直接进人气榜 |
| B 客户端 localStorage 记录后随 career 上报 | 不选 | 可伪造、跨设备不一致；点赞会污染「本人自报」语义，且需要升 CareerSummary 版本 |
| C 引入数据库持久化点赞 | 本期不选 | 推翻 ADR-0004，需要账号、存储与隐私评估；本期只要本园区在线期间的记录 |
| D 只做按钮动画不计数 | 不选 | 无法进入排行榜，不满足「记录」要求 |

## 数据与规则
- 服务端 `Player` 增加 `likes: number`、`likedBy: Set<number>`、`lastLikeAt: number`；`reset()` 与 `World.destroy` 负责清理。
- 一个连接对同一目标只能点一次：`likedBy.has(likerId)` 命中时只回一条「你已点赞」的确认，不增加计数、不广播。
- 只能给 `player.known` 内的目标点赞；禁止自赞；`lastLikeAt` 做 400ms 限频，防止伪造包刷广播。
- 点赞数上限 u16（65535）；计数只增不减；目标离园即随 Player 回收清零。
- 点赞者离开时，从所有在线玩家的 `likedBy` 中移除其 id，避免实体 id 复用后新玩家无法点赞。
- 点赞数进入 spawn 尾段与 `S2C_LIKE`，客户端维护 `likesById` 与 `likedTargets`；本地玩家收到的赞另存 `localLikes`，随 2Hz stats 推给 HUD。

## 协议布局
```text
C2S_LIKE (0x26)
[op u8][targetId u16]

S2C_LIKE (0x27)
[op u8][targetId u16][likes u16][flags u8]
flags bit0 = 接收者就是点赞者，用于点亮「已点赞」

S2C_ENTITY_SPAWN 尾部追加段
[0xfb][likes u16]   仅在 likes 大于 0 时追加
```

- 三处都是纯追加；旧客户端读完已知段停止，旧服务端不认 0x26，互不影响。
- `decodeSpawn` 读取状态段时要把 `0xfb` 与 `0xfe`、`0xfc` 一起排除，避免把点赞魔数当成状态长度。
- 广播路径：目标本人收到 flag0；目标视野内其他人收到 flag0；点赞者单独收到 flag1。重复点赞只回点赞者 flag1。
- 单包固定 6 字节，不进 Tick 热路径；spawn 只多 3 字节。

## 数据流
1. 玩家点选可见角色，打开他人工牌；`PlayerBadge` 携带 `likes` 与 `liked`。
2. 点击「点赞」→ `GameViewport` → `GameClient.like(id)` → Worker 或主线程 → `GameSession.like(id)` → `C2S_LIKE`。
3. 服务端 `sim/like.ts` 校验可见性、自赞、重复与限频，增加 `target.likes`，按上述路径广播 `S2C_LIKE`。
4. `NetClient` 解码 → `GameSession.handleLike` 更新 `likesById`、`likedTargets`、`localLikes` → 2Hz 工牌推送刷新 `BadgeArchive`。
5. 人气榜：`buildBoardSnapshot` 读 `Player.likes`，按值降序 → `joinedAt` 升序 → id 升序；客户端一次请求拿全部 6 个榜。

## 架构设计
- 契约层：新增 `shared-types/src/like.ts` 放点赞常量与包体类型；编解码放 `protocol.ts`，避免与 ByteWriter/ByteReader 形成循环依赖；board 只扩展指标枚举。
- 服务端：新增 `sim/like.ts` 作为深模块，输入 player、targetId、now、world、transport，内部完成可见性/重复/限频/广播；`server.ts` 只负责解码与调用。
- 客户端：`session.ts` 只做数据归并与转发；`badge.ts`/`archive.ts` 只做展示模型；React 不解析二进制。
- UI：点赞入口收敛在 `BadgeArchiveDialog` 头部身份带，本人/他人共用；人气页签收敛在 `LeaderboardDialog` 与 `leaderboard.ts` 元数据。
- 不新增 prop kind、不新增自由文本、不新增异步任务或定时器轮询；点赞由用户点击驱动。

## 目录结构
```text
packages/shared-types/src/
├── like.ts                    # 新增：点赞常量、LikePacket、上限、flags
├── types.ts                   # 修改：OpCode 0x26/0x27；SpawnPacket 增加 likes
├── protocol.ts                # 修改：点赞编解码、spawn 点赞尾段、状态段魔数排除
├── board.ts                   # 修改：BOARD_METRIC 增加 Likes=6、指标列表与校验
├── index.ts                   # 修改：导出 like
└── __tests__/
    ├── like.test.ts           # 新增：点赞包往返、坏包、spawn 尾段兼容
    ├── protocol.test.ts       # 修改：spawn 带点赞/不带点赞/截断
    └── board.test.ts          # 修改：6 个指标与人气包往返

apps/game-server/src/
├── sim/world.ts               # 修改：Player.likes/likedBy/lastLikeAt、reset、destroy 清理
├── sim/like.ts                # 新增：handleLike 深模块
├── sim/like.test.ts           # 新增：点赞、重复、自赞、不可见、限频、广播 flags
├── sim/view.ts                # 修改：spawn 传入 player.likes
├── sim/board.ts               # 修改：人气指标取值与资格
├── sim/board.test.ts          # 修改：人气榜排序与 0 赞
└── server.ts                  # 修改：dispatch C2S_LIKE

apps/web/
├── lib/net/client.ts          # 修改：sendLike、onLike、S2C_LIKE 路由
├── lib/game/session.ts        # 修改：likesById/likedTargets/localLikes、like、badgeOf、stats
├── lib/game/badge.ts          # 修改：PlayerBadge 增加 likes/liked
├── lib/game/archive.ts        # 修改：BadgeArchive 增加 likes/liked，自他档案共用
├── lib/game/leaderboard.ts    # 修改：增加人气指标元数据与计数格式化
├── lib/game/game-ui.ts        # 修改：myLikes，setStats 同步
├── lib/game/client/game-client.ts        # 修改：like
├── lib/game/client/worker-client.ts      # 修改：like 消息与回调
├── lib/game/client/main-thread-client.ts # 修改：like 转 session
├── lib/game/runtime/worker-protocol.ts   # 修改：like 消息
├── lib/game/runtime/worker-host.ts       # 修改：like 转 session
├── components/badge/BadgeArchiveDialog.tsx   # 修改：赞数、点赞按钮、三种状态
├── components/badge/RemoteArchiveDialog.tsx  # 修改：透传 onLike
├── components/badge/SelfArchiveDialog.tsx    # 修改：读取 myLikes
├── components/game/LeaderboardDialog.tsx     # 修改：6 列页签
├── components/game/GameViewport.tsx          # 修改：handleLike 透传
└── lib/game/__tests__/
    ├── archive.test.ts               # 修改：自他档案的 likes/liked
    ├── archive-dialog.test.tsx       # 修改：收到的赞、点赞按钮
    ├── leaderboard.test.ts           # 修改：6 个指标与计数格式
    └── leaderboard-dialog.test.tsx   # 修改：人气页签

docs/adr/0055-badge-likes.md    # 新增：点赞的零持久化边界、协议、回滚
README.md                       # 修改：工牌点赞、人气榜、协议与清零口径
```

## 实施注意
- `encodeSpawnInto` 新增 `likes` 参数放在 `careerSegment` 之后，服务端 `spawnPacketOf` 传入 `player.likes`；`encodeSpawn` 传 `packet.likes` 时中间补 `undefined`，避免参数错位。
- `decodeSpawn` 的状态段排除集合必须加入 `0xfb`；否则「只有点赞、没有状态/在线秒/考勤」的包会把魔数读成状态长度。
- `UNKNOWN opcode` 与坏包继续静默丢弃；不要向 UI 抛协议错误。
- 点赞广播只发给目标与 `target.known`，点赞者单独补一条 flag1；不要在 `World` 全量广播。
- 工牌 2Hz 推送是最终真相；按钮的 pending 态最多 2 秒，超时用现有 toast 提示「点赞没送到，稍后再试」，目标切换时清理计时器。
- 人气榜值与在岗榜一样包含全部在线玩家；其余四榜仍按 `hasCareerReport` 过滤，不要误把 0 赞当成「未上报」。
- 不修改 ADR-0054；新增 ADR-0055 说明第 6 个指标与点赞边界。
- 不写入 localStorage；页面刷新或换园区后点赞计数以服务端当前内存为准。

## 回滚
- 撤掉 `BadgeArchiveDialog` 的点赞行、`LeaderboardDialog` 的人气页签与 `BOARD_METRIC.Likes`。
- 撤掉 `C2S_LIKE`/`S2C_LIKE` 分支与 spawn 的 `0xfb` 尾段；旧端读不到点赞段时按 0 展示。
- 撤掉 `Player.likes/likedBy` 与 `sim/like.ts`；无数据迁移、无本地存档变更。


## Agent Extensions
### Skill
- **principal-software-architect**
  - Purpose: 校验点赞的数据所有权、零持久化边界、一人一次与可见性门，并产出 ADR-0055。
  - Expected outcome: 含质量场景、备选方案、基线与对抗审查的 ADR，明确离园清零与回滚信号。
- **impeccable**
  - Purpose: 在现有工牌档案与牛马榜视觉世界内完成点赞按钮、人气页签的细节与状态，并跑一次机械检测。
  - Expected outcome: 与现有 ink/mint/amber 语言一致、键盘可达、移动端不溢出的点赞与榜单界面。
- **test-driven-development**
  - Purpose: 先用测试锁定点赞包往返、spawn 兼容、重复/自赞/不可见/限频、人气榜排序与 UI 静态渲染。
  - Expected outcome: shared-types、game-server、web 三包的新模块都有可复现的单测。
- **verification-before-completion**
  - Purpose: 在声称完成前跑通类型检查、三包测试、构建与双客户端端到端点赞验收。
  - Expected outcome: 有命令输出与验收记录支撑的完成结论。
