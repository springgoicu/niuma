# ADR-0060：在岗计时跨重连续算，三处显示同源

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（反馈「计时不准 / 很多人时间一样」）、客户端会话层、服务端模拟、协议层
- **Tags:** session-clock, protocol, leaderboard, zero-persistence, ui
- **Supersedes / superseded by:** 不推翻 ADR-0054，只关闭它的 Revisit trigger「重连后时长归零不可接受」；继续遵守 ADR-0004（零持久化）、ADR-0052（考勤摘要）、ADR-0057（人气榜）

## Context

玩家反馈两件事：

> 为什么在榜单点击互动会闪一下
>
> 并且总感觉计时的功能不准确  为什么有那么多时间一样 总体检查

第二个问题在代码里能落到三处**互相不一致的时钟**：

| 显示位置 | 计时起点 | 断线重连 |
|---|---|---|
| 左上角工牌「在岗时长」 | 浏览器 `AttendanceTracker.sessionStartTime`（进园时刻） | **不归零** |
| 工牌档案弹窗「本次在岗」 | `GameSession.welcomeAt`（WELCOME 时刻） | **归零** |
| 牛马榜「在岗」 | 服务端 `Player.joinedAt`（`admit()` 时刻） | **归零** |

再叠上三个粒度问题：

1. 榜单是 20 秒一次的快照，但在岗按秒显示 → 数字每 20 秒整块跳一次，看起来"不走秒"；
2. 「工时」= 上次上报的整分钟数 + `floor((会话秒 − 上报秒) / 60)`，客户端 60 秒才上报一次 → 一分钟跳一格，同一分钟内多人必然显示完全相同的 `Xh Ym`；
3. `<1 分钟` 与「没有工时」共用 `0m`，新进园的一排 `0m` 被读成"没在计时"。并列时名次仍按 4/5/6 排，读起来像排序出错。

ADR-0054 当时接受「掉线即离榜，重连后在岗时长从零开始」，并把「玩家反馈归零不可接受」写成复核信号。本轮信号已触发。

现状约束：

- 服务端零持久化：不能引入账号，也不能把会话时长写盘；
- 进程重启后世界清空，凭旧值虚增的时长必须一起失效；
- 协议纯追加：旧客户端 / 旧服务端混跑期间不能错位，也不能丢已有字段；
- 「在岗」是展示型榜单，不参与奖励、准入、碰撞等任何权威判定。

## Quality scenarios and invariants

```text
QUALITY | 三处一致 | source: 玩家 | stimulus: 同时看工牌、档案与牛马榜 | environment: 在线 / 短暂掉线 | artifact: GameUi.onlineSec / BadgeArchive.sessionDuration / S2C_BOARD(Duty) | response: 三处显示同一个秒数 | measure: 刷新窗口内差值 ≤ 1s | priority: 高
QUALITY | 断线不归零 | source: 掉线玩家 | stimulus: 网络抖动后自动重连 | environment: 正常负载 | artifact: HELLO(0xfa) / WELCOME(0xf9) | response: 在岗时长接着算，而不是从 00:00:00 重来 | measure: 重连前后差值 ≤ 离线秒数 + 1 | priority: 高
QUALITY | 工时不被双计 | source: 被排名者 | stimulus: 重连后继续挂机 | environment: 连续两次上报跨越重连 | artifact: careerSessionDeltaMinutes | response: 只增加重连之后的时间 | measure: 重连后首测工时增量 = 0 | priority: 高
QUALITY | 伪造不可刷榜 | source: 伪造客户端 | stimulus: HELLO 里上报 30 天秒数 | environment: 进程刚重启 | artifact: clampSessionCarry | response: 只认「一天 / 进程已运行秒数 / 上报值」最小值 | measure: 榜首时长 ≤ 进程运行时长 | priority: 中
QUALITY | 多标签页不倒退 | source: 同浏览器开两页 | stimulus: 两页交替挂机 | environment: 30 秒批处理错开 | artifact: niuma:attendance:v1 | response: 工时只增不减 | measure: 任一次落盘后 `totalOnlineMs` 不小于上一次 | priority: 中
```

不变量：

- 服务端不写磁盘、不接数据库；会话时长只活在 `Player.joinedAt` 里。
- `joinedAt` 前移量只影响展示口径，不影响移动、座位、击倒等任何权威判定。
- 协议段永远追加在尾部；旧解码器读完已知段就停止，行为逐字节不变。
- 工时的增量基线只由服务端写，客户端上报的 `reportedOnlineSec` 一律不采信。

## Decision

采用 **HELLO 尾部会话续算段 + WELCOME 回显 + 三处同源 + 客户端本地走秒**：

1. **协议（纯追加）**
   - `SESSION_EXTENSION_MAGIC = 0xfa`：HELLO 尾部 `[0xfa][sec u32]`，排在 career 段之后。
   - `WELCOME_SESSION_MAGIC = 0xf9`：WELCOME 尾部 `[0xf9][sec u32]`，排在可选格式字节之后。
   - 0xfb 已被点赞段占用，所以不复用；0xf9 / 0xfa 此前未用，且都大于 `MAX_STATUS_BYTES(48)`，不可能被读成状态长度。
   - WELCOME 的会话段**必须排在格式字节之后**：旧客户端读完 `state + syncFormat` 就停，格式仍然读得到 1；若排在前面，旧客户端会把 0xf9 当成格式字节，退化成 7 字节解析而错位。
   - `decodeWelcome` 的格式判定从「消费一个字节」改成「先窥视再消费」，否则会把会话段魔数吃掉。

2. **服务端**
   - `handleHello`：`sessionSec = clampSessionCarry(hello.sessionSec, 进程已运行秒数)`，取「上报值 / 一天 / 进程运行秒数」三者最小；同一值写进 `career.reportedOnlineSec` 与 `HelloPayload.sessionSec`。
   - `admit`：`world.create(..., joinedAt = now - sessionSec * 1000)`，并把同一个 `sessionSec` 放进 WELCOME 回显。排队等待不计入在岗（续算值在 HELLO 那一刻定住）。
   - `career.reportedOnlineSec` 与 `joinedAt` **必须同基线**：只前移其中一个，会让 `careerSessionDeltaMinutes` 把上一段会话再算一遍，工时直接双计。

3. **客户端**
   - `GameSession.handleWelcome`：`welcomeAt = performance.now() - sessionSec * 1000`，`localCareer.reportedOnlineSec = sessionSec`，并用 `advanceOnDuty(sessionSec, 0).cursor` 预热在岗提醒游标（重连回来不再重播「在岗 8 小时」）。
   - `NetClient.onClose`：只在**第一次**断开时把当时的 `onlineSec` 记进 `reconnectCarrySec` 并下发 `setSessionSec`；重连反复失败不会把离线时间也算成在岗。WELCOME 后归零，下一次断开重新取。
   - 旧服务端不回显 → `sessionSec` 缺席 → 退化成今天的行为（重连归零）；旧客户端不写段 → 服务端按 0 处理。

4. **显示同源**
   - 左上角工牌 `SessionClock` 改读 `useGameUi.onlineSec`，断线显示 `--:--`（不再用浏览器时钟继续走）。
   - 档案弹窗（本人 / 他人）同样读 `onlineSec`，断线显示 `--:--`。
   - 牛马榜「在岗」本来就读服务端会话秒数，天然同源。

5. **可读性**
   - 面板收到快照时按指标记 `receivedAt`，之后每秒本地推进 `advanceBoardValue(metric, value, elapsed)`：在岗按秒 +1，工时按整分钟 +1，计数类不动；20 秒快照只做校准。
   - `formatMinutes` 把 `0 < minutes < 1` 显示成 `<1m`，与「没有工时」的 `0m` 区分。
   - 与相邻行数值相同就标一枚「并列」小签：并列是真实并列，不是排序错误。
   - 工时上报间隔 `CAREER_REPORT_INTERVAL_MS` 60s → 20s（服务端限频 10s），副标题写明「工时按本浏览器累计，换设备或清缓存会重来」。

6. **多标签页**
   - `AttendanceTracker.persist()` 落盘前先读存储，`dailyRecords` 按天取 max、`totalOnlineMs` 取 max、`firstJoinDate` 取更早，再写回；`storage` 事件把别的标签页的写入并进内存。
   - 取舍：不做 `BroadcastChannel` 选主（YAGNI）。merge-max 保证「不会倒退、不会少记」，代价是极端并发下可能少记一小段。

### 协议布局

```text
C2S_HELLO  … [0xff][status]? [0xfd][format]? [0xfc][len][career]? [0xfa][sec u32]?
S2C_WELCOME[op u8][entityId u16][tick u32][x u16][y u16][state u8] [format u8]? [0xf9][sec u32]?
```

## Options considered

### Option A — 客户端上报上次会话秒数（chosen）

- Shape：断线时记住 `onlineSec` → 下次 HELLO 尾部带上 → 服务端钳制后前移 `joinedAt` → WELCOME 回显结算值 → 客户端以它为基准继续走秒。
- Pros：零持久化不变；不需要身份；协议纯追加；进程重启天然失效；与既有 0xfc / 0xfd / 0xfe / 0xff 尾段是同一套写法。
- Cons：多 5+5 字节；客户端上报值不可信（只影响展示榜）；需要在服务端两处（`joinedAt` 与 `reportedOnlineSec`）同基线，写错就双计工时。
- Reverse cost：低。去掉 HELLO/WELCOME 的段与 `clampSessionCarry` 调用即可回到重连归零。
- Evidence：`protocol.test.ts`（五段互不串位 / 截断回落 / 旧包逐字节不变）、`career.test.ts`（钳制上限）、`board.test.ts`（续算后工时不被双计）。

### Option B — 服务端按「昵称 + 外观」维持短暂会话表

- Shape：连接断开时在内存里留一条 5 分钟的记录，重连时按昵称匹配并续上 `joinedAt`。
- Pros：不碰协议；客户端零改动。
- Cons：同名玩家会串号；需要额外的清理与容量上限；昵称可改，续算会丢；跨园区互不可见。
- Reverse cost：低，但语义不可靠。
- 结论：不选。

### Option C — 不续算，只把三处统一并改名「本次连接」

- Shape：保留重连归零，把三处显示都改成 `welcomeAt` 口径，文案写「本次连接」。
- Pros：改动最小，没有任何伪造面。
- Cons：直接违背玩家直觉（挂机两小时断一次线就剩 3 分钟），也没有解决「工牌不归零、榜单归零」导致的"计时不准"观感。
- Reverse cost：低。
- 结论：不选，作为本次 30 天内的回滚目标保留。

### Option D — 持久化身份与会话累计

- Shape：账号 + 数据库 + 服务端计时。
- Pros：真正的历史在岗与离线榜。
- Cons：推翻 ADR-0004，需要账号、存储与隐私评估；本轮需求只是"别归零"。
- Reverse cost：高。
- 结论：本期不选。

## Consequences

### Positive

- 短暂掉线不再清零：在岗时长跨重连连续，工牌 / 档案 / 榜单三处同一数字。
- 在岗在面板里按秒走，20 秒刷新只校准，不再"每 20 秒跳 20 秒"。
- 工时数字不再一排 `0m`，并列有「并列」签，玩家能分辨"真并列"和"数据坏了"。
- 多标签页不再互相覆盖，工时不会被写小。

### Negative / risks

- 客户端可虚报 `sessionSec`：只影响展示榜，服务端按「一天 / 进程运行时长」钳制，重启后失效；仍建议后续在 UI 上保留「本次在岗」的措辞。
- 协议多两段：混跑期间旧服务端会忽略续算（退化为归零），旧客户端会忽略回显，都不报错。
- WELCOME 的解析顺序变成"先窥视"，若以后有人在 `state` 与 `format` 之间插段，必须同步改 `decodeWelcome`。
- 多标签页 merge-max 在极端并发下可能少记一小段（宁可少记，不可倒退）。

### Neutral

- 「同屏劳模榜」与工牌点赞不受影响。
- `getCurrentSessionDuration` 保留给考勤用例，但不再驱动任何"在岗"展示。

## Revisit triggers

- [ ] 有玩家把虚报的在岗时长当作炫耀 / 排名依据 → 改为服务端可验证的会话累计（Option D）。
- [ ] 出现「工牌显示 --:-- 但还在园区里走动」→ 查 `useGameUi.status` 与服务端 `onStatus` 是否脱节。
- [ ] 多次重连后时长出现跳变 → 查 `reconnectCarrySec` 是否在 WELCOME 后正确归零。
- [ ] 工时仍被反映"别人数字一样" → 考虑把工时展示提高到「小时 + 十分钟」以外的最小单位，或换成「累计工时」指标。

## Delivery and validation

- **First reversible slice**：`shared-types` 的两段魔数与编解码 → 服务端 `clampSessionCarry` 与 `admit` → 客户端 `NetClient` / `GameSession` → 三处显示同源 → 面板走秒与文案。
- **Compatibility / migration**：协议纯追加；旧端两类都静默忽略。无数据迁移。
- **Rollback（30 天）**：删掉 `encodeHello` / `encodeWelcome` 的尾段与 `clampSessionCarry` 调用；`GameSession.handleWelcome` 的 `carrySec` 固定 0；`SessionClock` 回读 attendance。前端一次发版即可，服务端不需要跟随。
- **Tests / fitness functions**：
  - `pnpm --filter @niuma/shared-types test`（270）
  - `pnpm --filter @niuma/game-server test`（165）
  - `pnpm --filter @niuma/web test`（595）
  - `pnpm typecheck`（4 包）
- **Security / reliability / data / ownership**：不新增持久化、不新增自由文本、不新增依赖；`sessionSec` 属不可信输入，只影响展示型榜单并被钳制；`joinedAt` 仍是服务端唯一时钟源。

## Baselines

```text
BASELINE | packages/shared-types（协议与共享纯函数） | expected: 只做类型 / 编解码 / 静态契约，纯追加兼容 | observed: 0xfa 会话段排在 career 之后、0xf9 回显排在格式字节之后；clampSessionCarry 与 careerSessionDeltaMinutes 同居 career.ts；decodeWelcome 改为先窥视再消费 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 以后新增尾段一律排在最后，并在 decode 侧用长度定位而不是顺序假设
BASELINE | apps/game-server（admit / dispatch） | expected: 内存唯一真相，客户端输入重新裁决，热路径零额外工作 | observed: carry 在 HELLO 分支钳制，admit 用它同时前移 joinedAt 与 reportedOnlineSec；Tick、AOI、榜单排序均未改 | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 若后续要做会话累计，先把 carry 抽成独立策略对象，别在 admit 里继续堆分支
BASELINE | apps/web（session / net / 展示） | expected: 网络聚合与展示分离，展示层不各自造时钟 | observed: 工牌、档案、榜单三处统一读服务端会话秒数；面板 1Hz 本地推进只作用于展示值；attendance 落盘改 merge-max | fit: align | patterns: [P-Ports-Adapters, G-Observer] | violations: [] | suggestion: 再有"计时"入口一律走 useGameUi.onlineSec，禁止新增浏览器时钟源
```

```text
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```

对抗审查摘要：

- ARCH-PRIMARY：零持久化下让在岗跨重连续算，只能由客户端携带上次秒数、服务端钳制后回写，协议尾段是唯一不破坏兼容的通道。
- ARCH-ADVERSARY：伪造刷榜、工时双计、旧客户端错位解析、排队时间被算进在岗、多标签页覆盖。处置：三方取最小钳制、`joinedAt` 与 `reportedOnlineSec` 同基线、会话段排在格式字节之后、carry 在 HELLO 定住、merge-max。
- ARCH-SYNTH：保留方案 A；把「持久化身份 / 历史榜」继续排除，写进复核信号；30 天回滚目标锁定为方案 C（统一但归零）。

## References

- Code: `packages/shared-types/src/constants.ts`、`career.ts`、`protocol.ts`、`board.ts`、`types.ts`
- Code: `apps/game-server/src/server.ts`、`admission/controller.ts`、`sim/board.ts`
- Code: `apps/web/lib/net/client.ts`、`lib/game/session.ts`、`lib/game/leaderboard.ts`、`lib/game/attendance.ts`、`lib/game/archive.ts`
- Code: `apps/web/components/BadgeCard.tsx`、`components/game/LeaderboardDialog.tsx`、`components/badge/SelfArchiveDialog.tsx`
- Related ADRs: ADR-0004（零持久化）、ADR-0052（考勤摘要）、ADR-0054（牛马榜）、ADR-0057（人气榜）
- User requirement: 2026-11-12《为什么在榜单点击互动会闪一下 / 并且总感觉计时的功能不准确》
