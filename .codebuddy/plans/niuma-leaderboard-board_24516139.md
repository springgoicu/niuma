---
name: niuma-leaderboard-board
overview: 在中央广场北缘新增实体「牛马榜」公告栏，靠近按 F 打开榜单；榜单由服务端内存按需聚合，提供本次在岗、本周工时、摸鱼、击倒、搬砖步数五个全园榜，保持零持久化与协议追加式兼容。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素木牌
    - 深色工业 HUD
    - 纸签与黄铜钉
    - 克制的霓虹
    - 清晰层级
  fontSystem:
    fontFamily: Oswald / JetBrains Mono / PingFang SC
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 10px
      weight: 500
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
      - "#F2C879"
    background:
      - "#0F0C09"
      - "#14100C"
      - "#1B1611"
      - "#F4E3C1"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#857463"
      - "#2A3142"
    functional:
      - "#4FE3C1"
      - "#F2C879"
      - "#E06A5A"
      - "#6FB6C9"
todos:
  - id: shared-contract
    content: 用 [skill:test-driven-development] 扩展 shared-types：榜单协议、board 契约、公告栏地标与碰撞、单测
    status: completed
  - id: server-board
    content: 实现服务端榜单聚合与 0x24 分发：距离门、限频、五个指标与单测
    status: completed
    dependencies:
      - shared-contract
  - id: web-transport
    content: 打通 NetClient、GameSession、Worker 与主线程的榜单通道，接入靠近提示与 F 打开
    status: completed
    dependencies:
      - shared-contract
  - id: world-board-art
    content: 在 welcome.ts 绘制木框纸签公告栏并烘焙进深度层，复用现有中文 Text 与色板
    status: completed
    dependencies:
      - shared-contract
  - id: board-ui
    content: 用 [skill:impeccable] 实现 LeaderboardDialog 与格式化模块，接入视口并完成响应式、键盘、空态
    status: completed
    dependencies:
      - web-transport
      - world-board-art
  - id: adr-readme
    content: 用 [skill:principal-software-architect] 写 ADR-0054，并更新 README 的功能、协议与边界说明
    status: completed
    dependencies:
      - server-board
      - board-ui
  - id: verify
    content: 用 [skill:verification-before-completion] 跑 typecheck、三包测试、build 与双客户端手工验收
    status: completed
    dependencies:
      - server-board
      - board-ui
      - adr-readme
---

## 产品概述
在中央广场北缘、出生点正北新增一块实体「牛马榜」公告栏。玩家靠近后出现「按 F 查看牛马榜」提示，按互动键打开榜单面板；面板展示本园区当前在岗牛马的五个排行榜与实时园区状态。

## 核心功能
- 实体公告栏：木框、纸签、像素中文，位于中央广场北缘并正对出生点；带底座碰撞，不侵入出生 56px 圈，也不阻塞北向主路。
- 靠近与打开：96px 内提示「按 F 查看牛马榜」，按 F 打开面板，不冒聊天气泡；关闭后立即回到游戏。
- 五个榜单：本次在岗时长（服务端权威）、本周工时、摸鱼次数、击倒次数、搬砖步数；默认展示在岗榜。
- 榜单内容：前三名领奖台、4–10 名列表、自己名次；自己不在前十时在底部固定一行「我的位置」。
- 实时园区条：本园区在岗人数与当前摸鱼人数；打开时拉取一次，每 20 秒自动刷新，支持手动刷新。
- 榜单统计口径标注：只统计当前在线玩家，离线即离榜；工时、摸鱼、击倒、步数为本人自报，最多 60 秒延迟，面板内明确标注。
- 状态与降级：加载中显示骨架；空榜给出「先坐下摸一会儿鱼」；断线保留最后快照并提示；旧客户端不显示入口且不受影响。
- 视觉：与现有像素园区 HUD 一致，深色 ink 底、木框纸签、mint 实时高亮、amber 头名；桌面与手机均可操作，键盘可完整操作。

## 技术栈
- 复用现有技术栈：pnpm 10 + Turborepo 2 + TypeScript 5 strict；Next.js 15 App Router + React 19 + Tailwind CSS v4 + Zustand 5；PixiJS 8；Bun WebSocket + 20Hz Tick；`packages/shared-types` 二进制协议。
- 不引入新依赖、不引入数据库、不改变 Worker 渲染架构。

## 方案选择
| 方案 | 结论 | 理由 |
|---|---|---|
| A 服务端按需聚合，新增 0x24/0x25 | 选用 | 覆盖本园区全部在线玩家；在线时长用服务端 joinedAt，不可伪造；请求只发生在打开榜单时，不进入 Tick 热路径，也不占常驻下行；旧端天然忽略未知 opcode |
| B 客户端用视野内 career 聚合 | 不选 | 只有视野内玩家，和现有「同屏劳模榜」重复；在线时长会随进出视野重置；会被误读成本园区榜 |
| C 服务端周期性广播全园榜 | 不选 | 无人查看时也占下行，与去脏和带宽预算冲突；60 人乘 5 榜的广播放大不划算 |
| D 持久化全服历史榜 | 本期不选 | 需要账号、存储与隐私评估，推翻 ADR-0004；本期只需要本园区当前在岗 |

## 数据与统计口径
- 在岗时长：`floor((now - Player.joinedAt) / 1000)`，服务端权威；重连会重新计时，UI 文案写「本次在岗」。
- 本周工时：`Player.career.weekMinutes` 加本次会话增量；增量公式从 web 的 `withCareerDelta` 抽到 shared-types 的 `careerSessionDeltaMinutes`，服务端与客户端共用一份。
- 摸鱼、击倒、步数：直接读 `Player.career` 的 `slackCount`、`knockdownCount`、`steps`；只用于展示，不参与任何权威判定。
- 资格：在岗榜包含全部在线玩家；其余四榜只包含已上报 career 的玩家（`firstJoinDate` 非空），未上报者显示「尚未上报」而不是 0。
- 统计范围：`World.players` 是单个游戏进程的全部在线玩家，因此天然是「本园区」口径，不跨园区。
- 排序：数值降序，并列时按 `joinedAt` 升序（先来的靠前），再按 id 升序，保证结果稳定可测。

## 协议布局
```text
C2S_BOARD (0x24)
[op u8][metric u8]
metric: 0=全部, 1=在岗, 2=本周工时, 3=摸鱼, 4=击倒, 5=步数

S2C_BOARD (0x25)
[op u8][metric u8][online u16][slacking u16][count u8][selfRank u16][selfValue u32]
+ count × [id u16][value u32][nameLen u8][name nB]
```
- `BOARD_TOP_N = 10`，`count ≤ 10`，`nameLen ≤ 48`，单包约 560 字节以内。
- `selfRank = 0` 表示未上榜或未上报；`selfValue` 同步为 0。
- 未知 metric、截断包、超限条目：解码返回 undefined，服务端静默丢弃，客户端保留上一帧，不抛错给 UI。
- 协议纯追加；旧客户端在 `NetClient.handle` 的 default 分支忽略，旧服务端 `dispatch` 也不识别新 opcode，不影响入场。

## 数据流
1. 玩家进入公告栏 96px 范围，`GameSession` 的提示变为「按 F 查看牛马榜」。
2. 按 F，`interact()` 识别 `rankBoard`，调用 `callbacks.onBoardOpen()`，不冒气泡、不播设施音效。
3. `GameViewport` 打开 `LeaderboardDialog`，通过 `GameClient.requestBoard(0)` 请求全部指标。
4. 请求经主线程或 Worker 到 `NetClient`，发送 `C2S_BOARD`。
5. 服务端校验 240px 距离门与 1500ms 限频，按五个指标各生成一条 `S2C_BOARD`。
6. `NetClient` 解码后经 `GameSession.onBoard` 回到 `GameViewport`，缓存五条快照；页签切换只读本地缓存。
7. 打开时请求一次，之后每 20 秒自动刷新；手动刷新 1.5 秒冷却；断线保留最后快照并显示离线条。

## 性能与可靠性
- 聚合只发生在请求时：P 个在线玩家乘 5 个指标，排序 O(P log P)；P 默认不超过 60，微秒级；Tick 零新增。
- 下行：每包最多 10 条乘 48 字节名字加定长头，约 560 字节；一次打开 5 包约 2.8KB；20 秒刷新平均低于 0.2KB/s。
- 服务端不落库、不写磁盘，进程重启即清空，符合 ADR-0004。
- 距离门、限频、Top N、名字与数值上限四道约束，避免恶意客户端把榜单当放大器。
- 地图新增底座碰撞：shared-types、game-server、web 必须一起发版；回滚时三端同时撤回，避免客户端有碰撞、服务端没有的漂移。

## 架构设计
- 契约层：`shared-types/src/board.ts` 是唯一定义（指标、包体、上限、编解码）；坐标仍在 `world/layout.ts`，不新增第二份。
- 服务端：`sim/board.ts` 是纯聚合模块，输入玩家列表，输出快照；`server.ts` 只做解码、距离门、限频与发送。
- 客户端：`net/client.ts` 只解析字节；`session.ts` 只做转发与交互判定；`leaderboard.ts` 只做展示格式化；React 不碰二进制。
- 渲染：`welcome.ts` 负责公告栏美术与中文 Text；不新增 props kind，不复制坐标。
- UI：`LeaderboardDialog` 是唯一榜单面板；`GameViewport` 只负责开关与数据缓存。

## 目录结构
```text
packages/shared-types/src/
├── types.ts                  # [MODIFY] OpCode 增加 C2S_BOARD 0x24 / S2C_BOARD 0x25
├── board.ts                  # [NEW] 指标常量、包体类型、TopN/距离/限频/名字上限、encode/decode
├── career.ts                 # [MODIFY] 抽出 careerSessionDeltaMinutes，供服务端与 web 共用
├── index.ts                  # [MODIFY] 导出 board
├── world/layout.ts           # [MODIFY] WELCOME_LANDMARKS.rankBoard 与 HUB_SOLIDS 底座
└── __tests__/
    ├── board.test.ts         # [NEW] 往返、中文名、截断、超限、未知 metric
    └── layout-hub.test.ts    # [MODIFY] 公告栏在广场内、出生圈无碰撞、底座挡人

apps/game-server/src/
├── sim/world.ts              # [MODIFY] Player.lastBoardAt 与 reset
├── sim/board.ts              # [NEW] buildBoardSnapshot：五指标、资格、排序、自己名次、在岗/摸鱼统计
├── sim/board.test.ts         # [NEW] 指标值、并列、未上报排除、selfRank、slacking
└── server.ts                 # [MODIFY] dispatch C2S_BOARD：解码、240px 距离门、1500ms 限频、5 包发送

apps/web/
├── lib/net/client.ts         # [MODIFY] onBoard、sendBoard、S2C_BOARD 路由
├── lib/game/interactions.ts  # [MODIFY] isNearRankBoard、BOARD_INTERACT_RANGE
├── lib/game/session.ts       # [MODIFY] 提示分支、interact 分支、requestBoard、handleBoard、回调
├── lib/game/badge.ts         # [MODIFY] withCareerDelta 改用 shared 增量函数
├── lib/game/leaderboard.ts   # [NEW] 指标文案、单位、格式化、self 行模型
├── lib/game/welcome.ts       # [MODIFY] buildRankBoard / drawRankBoard，Text 与纹理
├── lib/game/client/game-client.ts        # [MODIFY] requestBoard(metric)
├── lib/game/client/worker-client.ts      # [MODIFY] post board、处理 board/boardOpen
├── lib/game/client/main-thread-client.ts # [MODIFY] requestBoard 转 session
├── lib/game/runtime/worker-protocol.ts   # [MODIFY] MainToWorker board、WorkerToMain board/boardOpen
├── lib/game/runtime/worker-host.ts       # [MODIFY] session 回调与 board 消息
├── components/game/LeaderboardDialog.tsx # [NEW] 榜单弹窗
├── components/game/GameViewport.tsx      # [MODIFY] boardOpen/boards 状态、回调、渲染
├── app/globals.css                       # [MODIFY] 如需 board-in 动画或纸面纹理，复用现有 token
└── lib/game/__tests__/
    ├── leaderboard.test.ts               # [NEW] 时长/工时/步数格式化与 self 行
    ├── interactions.test.ts              # [MODIFY] 公告栏距离判定
    └── leaderboard-dialog.test.tsx       # [NEW] Esc、页签键盘、空态与断线态

docs/adr/0054-leaderboard-board.md          # [NEW] 架构决策记录
README.md                                   # [MODIFY] 功能、协议、边界与双端发版说明
```

## 实施注意
- 所有数值在 shared-types 钳制；昵称复用现有审核结果，不新增自由文本，不重复审核。
- 日志只记 `wsId`、metric 与原因；不打印完整昵称或整包载荷。
- 不重构现有「同屏劳模榜」；它与公告栏并存，文案分别标注「视野内」与「本园区当前在岗」。
- 中文 Text 使用 `devicePxPerTexel`，在 `setTextResolution` 中随 DPR 更新；纹理在 `WelcomeView.destroy` 释放。
- 沿用 `BadgeArchiveDialog` 的 capture 阶段吞游戏键、焦点陷阱、Esc 关闭与关闭后 canvas 聚焦，不另造键盘模型。
- UI 不引入新字体、新色系、紫蓝渐变、纯黑或 bounce 缓动；使用现有 `panel`、ink/mist/mint/amber 与 2px 直角边框。

## ADR 与回滚
- 新增 `docs/adr/0054-leaderboard-board.md`：记录零持久化下的本园区榜边界、自报数据只展示、距离门与限频、五指标扩展策略、回滚与复核信号。
- 回滚：撤掉 `GameViewport` 入口与 `LeaderboardDialog`；撤掉 0x24/0x25 分支与 `Player.lastBoardAt`；公告栏地标与碰撞同版本撤回；无数据迁移。
- 复核信号：需要跨园区或跨会话历史榜时，重新评估 ADR-0004 与持久化身份；榜单被用于奖励或准入时，必须改为服务端可验证数据源。

## 设计方向
沿用园区现有的「深色工业 HUD 加像素木牌」视觉世界，不做另起一套皮肤。公告栏在世界里是一块真的立在广场北缘的木框纸签板；面板则像把这块板拉近到屏幕上：深 ink 底、2px 直角边框、木色上梁、纸签页签、黄铜钉、mint 实时高亮。关键词是「像园区里长出来的排行榜」，不是通用的游戏排行榜弹窗。

## 页面与区块
单页模态，桌面 440px 宽、手机 94vw，最大高度 88dvh。

1. 顶部木梁：左侧自绘 3 格像素柱状标记加「牛马榜」标题与英文微标签；右侧 LIVE 状态与关闭按钮；下方一条「在岗 N · 摸鱼 M」实时条。
2. 页签：五张纸签（在岗、工时、摸鱼、击倒、步数），激活态 mint 描边并上抬 1px；支持左右方向键与 Home/End。
3. 榜单主体：前三名领奖台，第一名 amber、第二名 mist、第三名 ember；每行左侧名次、中间昵称、右侧等宽数字与单位；4–10 名用细分隔线列表；自己上榜时整行 mint 底、左侧 2px 竖条与「你」小签。
4. 我的位置：不在前十时固定在列表底部，显示「你 · 第 N 名 · 数值」；未上报时显示「尚未上报」。
5. 底部：左侧「仅统计本园区当前在岗 · 离线即离榜」，右侧快照时间与刷新按钮；下一行小字说明自报数据最多 60 秒延迟。

## 交互与状态
- 进入：面板 180ms 从下往上 4px 落定，内容 120ms 轻推；遵循 `prefers-reduced-motion`。
- 加载：纸签区域显示 3 行骨架与「正在读取公告栏…」；空榜显示「还没有人上榜，先坐下摸一会儿鱼」。
- 断线：保留最后快照，顶部出现 ink 与 amber 的「连接中断，显示上次快照」条；刷新按钮禁用。
- 关闭：Esc、点遮罩、右上角关闭；关闭后焦点回到 canvas；打开时焦点落在第一个页签。
- 键盘：方向键切页签；Tab 焦点陷阱；游戏键在 capture 阶段吞掉，角色不会顶着面板走路。
- 响应式：手机端页签 5 列等分、列表滚动、底部说明折行；面板不超出 88dvh。

## 世界公告栏
- 128×96 木框纸签板，立在广场北缘 (4096, 3832)，顶部与广场北缘对齐，底座 120×18 碰撞。
- 画面：两根深木柱、奶油纸面、顶部 18px「牛马榜」中文、8px 等宽「NIOMA · LEADERBOARD」、底部 7px「按 F 查看」；纸面钉 3 张小便签并画 3 根像素柱状条，暗示榜单。
- 色板复用 welcome.ts 的 wood、paper、mint、ink；中文用 Pixi Text，resolution 跟 devicePxPerTexel，DPR 变化时随 setTextResolution 更新。

## Agent 扩展
### Skill
- **impeccable**
  - Purpose: 在现有园区视觉世界内完成公告栏弹窗的形状、细节与收尾，并运行检测与可访问性审查。
  - Expected outcome: 一个有木框纸签质感、响应式完整、键盘可操作、无 primary findings 的榜单面板。
- **principal-software-architect**
  - Purpose: 校验零持久化下的本园区榜单边界、协议追加式兼容、距离门与限频的权衡，并产出 ADR。
  - Expected outcome: 含质量场景、备选方案、基线与对抗审查的 ADR-0054，以及明确的回滚与复核信号。
- **test-driven-development**
  - Purpose: 先用测试锁定协议往返、排序规则、增量公式、距离判定与格式化边界。
  - Expected outcome: shared-types、game-server、web 三包的新模块都有可复现的单元测试。
- **verification-before-completion**
  - Purpose: 在声称完成前跑通类型检查、三包测试与构建，并完成双客户端手工验收。
  - Expected outcome: 有命令输出与验收记录支撑的完成结论，而不是口头判断。

### 使用说明
- 先跑协议与聚合的测试，再接 UI；UI 完成后用 impeccable 做一次 polish 或 audit，最后用 verification 收口。
- 不引入未提供的扩展，不新增依赖。
