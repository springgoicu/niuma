# ADR-0054：中央广场「牛马榜」公告栏，按需聚合的本园区在线榜

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（需求与指标设计授权）、客户端渲染、服务端模拟、协议层
- **Tags:** world-layout, protocol, leaderboard, zero-persistence, ui
- **Supersedes / superseded by:** 无；继续遵守 ADR-0004（零持久化）、ADR-0047（中央枢纽）、ADR-0052（考勤摘要）

## Context

园区已经有「牛马考勤档案」与「同屏劳模榜」：前者由本人浏览器上报考勤与行为累计，服务端只做内存转发；后者是 `GameSession` 用当前视野内 `careerById` 算出的前 5 名，UI 明确标注「视野内」（ADR-0052 第 6 条）。

本轮需求是在地图中间加一块「牛马榜」实体公告栏：靠近提示按互动键查看，按在线时长排名，并补充好玩的统计。直接后果是：

1. 公告栏必须读起来像**本园区**的榜，而不是又一块「视野内」榜；否则玩家走到广场中心只会看到附近几个人，与公告栏的空间语义冲突。
2. 「在线时长」若用客户端视野首见时间，会随进出视野重置；必须用服务端 `Player.joinedAt` 的会话口径。
3. 榜单数据不能在无人查看时占用下行预算，也不能进入 20Hz Tick 热路径。
4. 继续零持久化：不做数据库、不做全服历史榜、不引入账号。

现状约束：

- `World.players` 是单进程内存里的全部在线玩家；`Player.joinedAt` 是重连即重置的会话入场时刻。
- `Player.career` 是本人自报的展示数据（周工时、摸鱼、击倒、步数等），服务端只钳制与转发，不能用于权威判定。
- 协议纯追加，旧客户端在 `NetClient.handle` 的 default 分支忽略未知 opcode，旧服务端 `dispatch` 也不识别。
- 中央广场北缘 y=3736 是广场边界；北向主路从 `(4096,3736)` 向北，宽 112px；出生点 `(4096,4096)` 的 56px 圈内不能有碰撞。
- 渲染循环在 Dedicated Worker，请求必须同时经过 Worker 与主线程回退两条路径。

## Quality scenarios and invariants

```text
QUALITY | 本园区口径 | source: 玩家 | stimulus: 走到广场中心打开公告栏 | environment: 60 人在线、部分人不在视野内 | artifact: C2S_BOARD / S2C_BOARD | response: 榜单覆盖本进程全部在线玩家 | measure: 视野外已上报玩家的入榜率 = 100% | priority: 高
QUALITY | 在线时长可信 | source: 被排名者 | stimulus: 打开在岗榜 | environment: 正常 / 重连 | artifact: Player.joinedAt | response: 只按服务端会话秒数排名，客户端无法改写 | measure: 伪造 C2S_BOARD 不改变名次 | priority: 高
QUALITY | 下行预算 | source: 服务端 | stimulus: 一人每 20 秒刷新、60 人同屏 | environment: 压测 | artifact: 榜单包 | response: 按需发送，不进 Tick 广播 | measure: 平均新增下行 < 0.5KB/s/人；Tick p95 无回归 | priority: 高
QUALITY | 兼容性 | source: 旧客户端 / 旧服务端 | stimulus: 新旧混部 | environment: 灰度与回滚窗口 | artifact: 0x24 / 0x25 | response: 旧端忽略未知 opcode，正常入场与移动 | measure: 旧端入场失败率 = 0 | priority: 高
QUALITY | 诚实降级 | source: 断线玩家 | stimulus: 面板打开时断线 | environment: 网络中断 | artifact: LeaderboardDialog | response: 保留最后快照并标注「连接中断」 | measure: 不出现假 0 或空白面板 | priority: 中
```

不变量：

- 服务端不写磁盘、不接数据库；进程重启后榜单自然清空（ADR-0004）。
- 自报的工时 / 摸鱼 / 击倒 / 步数只用于展示，不参与奖励、准入、碰撞、发泄等任何权威判定。
- 榜单查询只在请求分支排序，不进入 Tick 循环。
- 协议纯追加；未知 opcode / 未知 metric / 截断包一律静默丢弃，不向 UI 抛错。
- 公告栏底座不侵入出生 56px 圈，不压北向主路（含两侧余量）。
- 同一份坐标只在 `WELCOME_LANDMARKS.rankBoard` 定义，服务端距离门、客户端提示与渲染共用。

## Decision

我们采用 **服务端按需聚合 + 新增 `C2S_BOARD (0x24)` / `S2C_BOARD (0x25)`**：

1. **世界对象**：`WELCOME_LANDMARKS.rankBoard = { x: 3960, y: 3832, width: 128, height: 96 }`，底座碰撞 120×18，顶部与广场北缘 y=3736 齐平。刻意偏西 136px：128px 宽的牌面横在 112px 的北向主路上（测试通道按 128px 计）会把出口堵死，靠路西侧既保住通道，又让从出生点向北走的玩家第一眼看到。美术由 `welcome.ts` 用 Graphics + Pixi Text 画成木框纸签板，不新增 prop kind，不复制坐标。
2. **交互**：`isNearRankBoard` 以底座中心判定 96px，优先于设施提示；F 直接打开面板，不冒气泡、不播机器音。服务端再做 240px 距离门 + 1500ms 限频，只挡「离开后仍刷请求」的伪造包。
3. **五个指标**：本次在岗（`joinedAt`，服务端权威）、本周工时（`career.weekMinutes` + `careerSessionDeltaMinutes`，自报）、摸鱼次数、击倒次数、搬砖步数（后三项直接读 `career`，自报）。在岗榜包含全部在线玩家；其余四榜只含已上报摘要的人（`firstJoinDate` 非空或 `reportedOnlineSec > 0`）。
4. **一次拉全部**：`metric = 0` 表示五榜全要，服务端按指标各回一条 `S2C_BOARD`。页签切换只读本地缓存，避免为每次切页产生往返；打开面板与 20 秒自动刷新各拉一次。
5. **包体上限**：`BOARD_TOP_N = 10`，每榜前十名 + `online` / `slacking` / `selfRank` / `selfValue`；名字按 UTF-8 截到 48B（不切坏 emoji）；单包 ≤ 563B。自己排在前十之外时仍返回真实名次与数值。
6. **排序**：数值降序 → `joinedAt` 升序（先来的靠前）→ id 升序；结果稳定可测。
7. **UI**：新增 `LeaderboardDialog`：深 ink 底 + 木色上梁 + 纸签页签 + 三根像素柱标记；前三名领奖台（amber / mist / ember），4–10 名细分隔线列表，自己整行 mint 底 + 「你」小签；不在前十时底部钉一条「我的位置」。明确标注「仅统计本园区当前在岗 · 离线即离榜」与「工时 / 摸鱼 / 击倒 / 步数由本人自报，最多 60 秒延迟」。
8. **共用格式化**：`formatBoardValue` 一处负责 `HH:MM:SS` / `36h 30m` / 千分位；服务端与客户端共用 `careerSessionDeltaMinutes`，不再各写一份增量公式。
9. **兼容**：旧端忽略 0x24/0x25；新端对坏包整条丢弃并保留上一帧。世界坐标与碰撞是静态内容，**双端必须一起发版**。

### 协议布局

```text
C2S_BOARD (0x24)   [op u8][metric u8]        metric: 0=全部, 1=在岗, 2=本周工时, 3=摸鱼, 4=击倒, 5=步数

S2C_BOARD (0x25)   [op u8][metric u8][online u16][slacking u16][count u8]
                   [selfRank u16][selfValue u32]
                   + count × [id u16][value u32][nameLen u8][name nB]
```

- 全部小端；`selfRank = 0` 表示未上榜或该项未上报，`selfValue` 同步为 0。
- `metric = 0` 时服务端连续回五条包，顺序固定为 `[Duty, Week, Slack, Knockdown, Steps]`。
- 解码器校验长度、条目数（≤10）、名字长度（1–48）与尾随字节；任何一处越界整条丢弃。

## Options considered

### Option A — 服务端按需聚合 + 新 opcode（chosen）

- Shape：客户端靠近 → F → 一次 `C2S_BOARD(0)` → 服务端在请求分支按五个指标各排序一次 `World.players` → 五条 `S2C_BOARD` → `GameSession` 归并 → React 面板。
- Pros：本园区口径；在线时长服务端权威；下行只发生在打开面板时；旧端天然忽略；与 career / queue / status 的「内存转发 + 追加式协议」是同一种模式。
- Cons：新增协议与双端代码；只有在线玩家；自报指标仍可伪造（只影响展示）；世界坐标改动需要双端同发版。
- Reverse cost：低。撤掉 UI 入口、0x24/0x25 分支与 `Player.lastBoardAt`，并把地标/碰撞同版本撤回；无数据迁移。
- Evidence：`board.test.ts`（协议往返 / 截断 / 上限）、`sim/board.test.ts`（指标 / 并列 / 资格 / 自己名次）、`layout-hub.test.ts`（出生圈、北向通道、牌面不出广场）、`leaderboard-dialog.test.tsx`（静态渲染 / 空态 / 断线 / 我的位置）。

### Option B — 客户端用视野内 career 聚合（rejected）

- Shape：复用 `ensureBoard`，把现有同屏劳模榜搬进公告栏。
- Pros：零协议改动，最快。
- Cons：只有视野内玩家，和现有「同屏劳模榜」重复；在线时长只能按本地首次看到起算，玩家进出视野会重置；公告栏读作全园榜会误导。
- Reverse cost：低，但产品语义错误，不采用。

### Option C — 服务端周期性广播全园榜（rejected）

- Shape：每 N 秒把五个榜推给所有人。
- Pros：打开即最新，无需请求。
- Cons：没人看的时候也占下行；60 人 × 5 榜 × 每 N 秒与仓库的去脏、带宽预算直接冲突；榜单是低频查看行为，不适合广播。
- Reverse cost：中（要回收广播路径与预算评估）。

### Option D — 持久化全服历史榜（本期不选）

- Shape：账号 + 数据库 + 跨会话累计。
- Pros：真正的历史榜与离线榜。
- Cons：推翻 ADR-0004，需要账号、存储、隐私与运营评估；本期只要求本园区当前在岗。
- Reverse cost：高。

反向成本（不做 / 晚做）：玩家在广场中心没有「看全园」的落点，只能靠聊天问；在线时长榜继续停留在视野内，重连即归零；未来若要加榜，每个入口都得再写一套聚合。

## Consequences

### Positive

- 公告栏成为广场北缘的空间锚点：从出生点向北走第一眼看到，靠近即有明确按键提示。
- 在岗榜不可伪造，能真实反映「谁挂在园区里」；其余四榜明确标注自报，不假装权威。
- 打开一次只花约 2.8KB，页签切换零往返；Tick 路径零新增。
- 协议、聚合、格式化、UI 各自收在一个文件里，新增指标只改 `BOARD_METRIC` 与 `BOARD_METRICS` 元数据。

### Negative / risks

- 只有在线玩家：掉线即离榜，重连后在岗时长从零开始；UI 用「本次在岗」写清楚。
- 自报指标可被改包伪造；只用于展示，UI 明确写「本人自报」。
- 本园区口径依赖「一座园区 = 一个 game-server 进程」；跨园区对比不在本期。
- 世界地标与碰撞是静态内容，双端必须一起发版；只发一端会出现「客户端看得到公告栏、服务端却没有碰撞」的漂移。
- 前十里并列值较多时，名次按 `joinedAt` 与 id 稳定排序，玩家可能看到自己「并列但排后面」；这是可复现的确定性排序，不是随机。

### Neutral

- 现有「同屏劳模榜」保留不动：它是工牌档案的一部分，服务于「看看身边的人」；公告栏服务于「看看全园」。
- 公告栏不进入导览卡 `NAV_TARGETS`：它就在出生点北侧，走两步就到，不需要自动寻路入口。
- 小地图不单独画公告栏：它是广场内的家具尺度，不改变地形判读。

## Revisit triggers

We will reopen this ADR if:

- [ ] 需要跨园区或跨会话的历史榜 / 离线榜 → 重新评估 ADR-0004、账号与持久化身份。
- [ ] 榜单被用于奖励、准入、排名发币等权威用途 → 必须改为服务端可验证的数据源，自报指标不得参与。
- [ ] 60 人压测下榜单请求把 Tick p95 或出口带宽推过水位 → 改为单指标请求、延长刷新间隔或做缓存。
- [ ] 玩家反馈「重连后时长归零」不可接受 → 引入会话累计或持久化身份，推翻本 ADR 的零持久化前提。
- [ ] 公告栏需要承载活动 / 维护公告等自由文本 → 必须走审核与截断，不能复用昵称之外的自由文本通道。

## Delivery and validation

- **First reversible slice**：shared-types 的 `board.ts` + 布局地标与碰撞 + 协议单测 → 服务端 `sim/board.ts` 与 dispatch → Web 传输层 → 世界美术 → 面板。
- **Compatibility / migration**：协议纯追加；旧端忽略 0x24/0x25；旧服务端不识别查询，客户端保持加载态。无数据迁移。
- **Rollback**：撤掉 `GameViewport` 的入口与 `LeaderboardDialog`、`0x24/0x25` 分支、`Player.lastBoardAt`；公告栏地标与底座碰撞同版本撤回。30 天内可回滚。
- **Tests / fitness functions**：
  - `pnpm --filter @niuma/shared-types test`（241）
  - `pnpm --filter @niuma/game-server test`（147）
  - `pnpm --filter @niuma/web test`（491）
  - `pnpm typecheck`（4 包）
  - 手工：双客户端靠近公告栏按 F；对比在岗榜与工牌「本次在岗」；页签切换；断线保留快照；移动端 390×844 不溢出。
- **Security / reliability / data / ownership**：不新增持久化、不新增自由文本、不新增外部依赖；榜单数据只读；服务端限频 + 距离门 + Top N + 名字/数值上限四道约束。下行只含审核后的昵称、数值、在线/摸鱼人数与实体 id；省份、工号、外观等工牌资料不进榜单包。

## Baselines

```text
BASELINE | packages/shared-types（协议与布局契约） | expected: 只做类型 / 编解码 / 静态世界真相，追加式兼容 | observed: board.ts 定长头 + 上限 + 名字截断；坐标只在 WELCOME_LANDMARKS.rankBoard；careerSessionDeltaMinutes 双端共用 | fit: align | patterns: [P-Single-Source, G-Adapter] | violations: [] | suggestion: 新增指标只扩展 BOARD_METRIC 与 BOARD_METRICS，不再造第二份坐标或第二套增量公式
BASELINE | apps/game-server（World / dispatch） | expected: 内存唯一真相，客户端输入重新裁决，热路径零额外排序 | observed: dispatch 新增 C2S_BOARD 分支，距离门 + 1500ms 限频后按指标排序 World.players；Tick 无改动 | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 榜单缓存留给压测数据说话，不在本期提前加
BASELINE | apps/web（session / net / client） | expected: 网络聚合与展示分离，React 不解析二进制 | observed: NetClient 解码，GameSession 只转发回调，Worker 与主线程共用一条 requestBoard；React 只读 BoardPacket | fit: align | patterns: [P-Ports-Adapters] | violations: [] | suggestion: 后续新增榜单指标只动 leaderboard.ts 元数据与 shared-types
BASELINE | 公告栏 UI | expected: 现有 ink/mint 语言、键盘可达、移动端可用、状态齐全 | observed: LeaderboardDialog 复用 GAME_KEYS/TAB_KEYS/焦点陷阱/Esc；空态、加载、断线、我的位置都有；前三领奖台用 amber/mist/ember | fit: align | patterns: [G-Composite] | violations: [] | suggestion: 真实浏览器跑一遍 390×844 与 1280×720，确认 5 列页签不折行
```

```text
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```

对抗审查摘要：

- ARCH-PRIMARY：服务端按需聚合是当前约束下唯一同时满足「本园区口径」「在线时长权威」「零持久化」「旧端兼容」的方案。
- ARCH-ADVERSARY：伪造包刷榜、自报数据被误读成权威、公告栏堵住北向主路、重生圈被碰撞侵入、断线后面板显示假 0、世界坐标只发一端造成碰撞漂移。处置：距离门 + 限频 + Top N、UI 标注自报、坐标偏西 136px 并加通道测试、出生圈断言、保留最后快照并标注断线、明确双端同发版。
- ARCH-SYNTH：保留方案 A；把「历史榜 / 账号 / 跨园区」明确排除，写入复核信号。

## References

- Code: `packages/shared-types/src/board.ts`、`packages/shared-types/src/world/layout.ts`、`packages/shared-types/src/career.ts`
- Code: `apps/game-server/src/sim/board.ts`、`apps/game-server/src/server.ts`
- Code: `apps/web/lib/game/session.ts`、`interactions.ts`、`leaderboard.ts`、`welcome.ts`
- Code: `apps/web/components/game/LeaderboardDialog.tsx`、`GameViewport.tsx`
- Related ADRs: ADR-0004（零持久化）、ADR-0047（中央枢纽与三湖）、ADR-0052（考勤摘要与同屏劳模榜）、ADR-0049（渲染线程拆分）
- User requirement: 2026-11-12《在地图中间增加一个牛马榜的榜单公告栏》
