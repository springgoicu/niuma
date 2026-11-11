# ADR-0039：园区频道的历史补发（进程内环形缓冲 + 上翻分页）

- 状态：已采纳
- 日期：2026-11-11
- 关联：ADR-0004（服务端零持久化）、ADR-0028（内容审核）、ADR-0033（聊天浮层与摇杆）、ADR-0034（客户端会话快照）、ADR-0038（系统播报）

## 背景

频道只有「进园之后收到的消息」：`World` 与消息列表都在内存里，玩家 A 说完话，新进园的 B 看到的是一个空面板，无从判断园里有没有人、刚才在聊什么。同时列表上限是 40 条，进出园播报一多，正常发言就被挤掉。

需求是「进园就能看到前文、能继续往上翻」，但项目的前提是不引数据库、不写盘、关掉即清空（ADR-0004）。

## 决策

### 1. 历史存在进程内的环形缓冲

`apps/game-server/src/sim/history.ts` 新增 `ChatHistory`：预分配定长数组，容量 200 条、TTL 60 分钟（`GAME_CHAT_HISTORY_CAPACITY` / `GAME_CHAT_HISTORY_TTL_MS` 可覆盖）。写入覆盖最旧格，内存上界约 200 × 540B ≈ 108KB，恒定，不随在线人数增长。

- 进程重启即清空，与 `World` 同一生命周期，不触碰 ADR-0004 的「零持久化」；
- 只在 `admit()` 与显式上翻两条路径上读取，20Hz Tick 不碰它；
- 不缓存编码后的 `Uint8Array`：整个下行都依赖「`transport.send` 同步拷贝」这一前提，复用同一块缓冲会让后发的包覆盖前一条。

### 2. 新开一对 opcode，而不是复用聊天包

```
C2S_CHAT_HISTORY (0x1e)：[op][beforeMsgId u16][limit u8]
S2C_CHAT_HISTORY (0x1f)：[op][flags u8][count u8] + count ×
                          [msgId u16][entityId u16][ageSec u32][nameLen u8][name][textLen u16][text]
```

- `flags` 是位标记：bit0 `Replace`（首屏快照，客户端整表替换）、bit1 `HasMore`（还有更早的）。
- 为什么不复用 `S2C_CHAT_BROADCAST`：那个包的 `entityId` 会被用来弹头顶气泡、查名字表，回放要额外打「这是历史」的洞，还会和 `msgId` 计数、限速、审核纠缠——与 ADR-0038 拒绝哨兵值的理由相同。
- 为什么不挂在 `S2C_WELCOME` 尾巴上：welcome 是定长 12 字节且没有长度字段（ADR-0034 只给 HELLO 加过可选尾段），塞历史等于改 welcome 的语义。
- 旧客户端 `handle()` 是 `default: break`，收到未知 opcode 直接丢弃，协议纯新增、不需要版本协商。

### 3. 条目自带昵称快照，时间用「距今秒数」

- 发送者可能已经离场，客户端名字表里查不到，只靠 `entityId` 会退化成「匿名牛马」；
- `ageSec` 让客户端用自己的时钟还原时间，服务端与用户设备时钟不一致也不会出现「历史比现在还新」的倒流。

### 4. 一页一包，超出预算由编码器自己置 `HasMore`

历史会走 `transport.send` 的出口计量并参与准入带宽水位，所以单包不能无限膨胀。`encodeChatHistory` 累计到 `CHAT_HISTORY_PACKET_BUDGET`（2048B）就停止追加，**并把 `HasMore` 置真**——只靠调用方判断的话，「这页没装完」会静默退化成「没有更早的消息了」，用户再也翻不上去。

首屏与每页默认 10 条（`GAME_CHAT_HISTORY_PAGE`，上限 `CHAT_HISTORY_MAX_PAGE`）。进园额外下行最坏约 5.4KB，典型 < 500B。

### 5. 历史是「频道公共回放」，范围从 AOI 扩到全园

实时聊天仍只发给 `player.known`（1000px AOI），**历史补发不看 AOI**。理由：

- 严格按 AOI 过滤需要保存发送坐标，而且刚进园时附近往往没人，补发依然是空面板，解决不了本次痛点；
- 频道语义本来就是「园区频道」而不是「附近频道」。

代价是语义变化：玩家会看到自己看不见的人说的话。UI 因此在历史与实时之间画一条 `— 以上为进入园区前的消息 —` 分隔线，明确这是回放，不是「一直能收到全园消息」。

### 6. 系统播报不进历史

进园 / 离园的播报是按 `player.known` 逐个裁剪的 per-viewer 事件（ADR-0038）。把它们的全局版本回放给所有人，等于泄露「某个你看不见的人刚进园」，而且这类瞬时事件在历史里也没有阅读价值。历史只收玩家发言。

### 7. 补发与分页都不走发送路径

`handleChat` 之外的补发不占 5s/3 条的发送窗口、不做二次词表审核（进历史前已经审过，存的是打码后的文本）、不弹头顶气泡。只有 `handleChat` 会写历史：政治类命中在写之前就 return，打码后的文本照写——回放必须和当时广播出去的一字不差。

### 8. 客户端：首屏替换、上翻前插

- `session.handleChatHistory` 把包转成 `ChatEntry { history: true }`，`at = Date.now() - ageSec * 1000`，不调用 `renderer.showBubble`；
- `game-ui.applyHistory`：`Replace` 整表替换且**不增加未读**（否则一进园就显示「10 条未读」）；否则按 `msgId` 去重后前插，按时间兜底排序，裁剪到 `MAX_MESSAGES`；
- `MAX_MESSAGES` 40 → 200：与服务端缓冲容量对齐，「往上翻到底」与「列表被裁掉」变成同一件事；
- 滚动改为「贴底才跟随」：用户上翻时新消息只累计，面板右下角出现「↓ N 条新消息」；前插更早一页时按 `scrollHeight` 差值回填 `scrollTop`，正在读的那句话不跳走；
- 面板收起时累计未读数，标题栏用它替代没有信息量的总条数。

## 备选方案与反向成本

| 方案 | 形态 | 收益 | 代价 / 不做的理由 |
|---|---|---|---|
| A（采用）进程内环形缓冲 + 新 opcode | 全在内存，重启清空 | 刷新、重连、换标签页都能看到前文；零持久化不变；协议纯新增 | 双端需同版本发布；重启后历史归零 |
| B 只在客户端用 localStorage 留自己看过的 | 零服务端改动 | 改动最小 | 刚进园依然空白，解决不了本次痛点；换设备就丢 |
| C 落盘 / 接数据库 | 跨重启保留 | 能真正「保留聊天记录」 | 违背 ADR-0004，部署、迁移、合规成本跳变；本次没有审核留证之类的诉求 |
| D 复用 `S2C_CHAT_BROADCAST` 加回放标记 | 少一个 opcode | 协议表面更少 | 气泡、名字表、限速、审核全部要打特例；与 ADR-0038 的教训重复 |

反向成本（不做 / 晚做）：频道永远是一张空表，新玩家无法判断园区的活跃度，老玩家刷新一次就丢掉全部上下文。

## 后果

- 正面：
  - 进园、刷新、断线重连都能立刻看到最近 10 条，且能往上翻到最近 200 条；
  - 系统播报不再把发言挤掉（列表上限 40 → 200）；
  - 上翻时新消息不再抢滚动条，「未读」从不可见变成可见；
  - 历史回放不重发审核、不占发送窗口、不弹气泡，几乎是纯读路径。
- 负面：
  - 历史范围从 AOI 扩到全园，与实时口径不同，靠 UI 分隔线说明；
  - 进园首帧多一次 ≤5.4KB 的下行，会计入出口计量并影响准入带宽水位（典型 < 500B，可接受）；
  - 每页 10 条意味着最多 20 次上翻才能走完 200 条，翻到底的交互成本比一次性拉全量高；
  - 进程重启后历史清空，回到空态文案。
- 回滚成本：低。服务端撤掉 `admit()` 的补发与 `C2S_CHAT_HISTORY` 分支即可停发；协议是纯新增，旧客户端不受影响。客户端可以单独退回原来的列表渲染，`game-ui` 的 200 条上限与未读数都是独立字段。

## 基线

```text
BASELINE | packages/shared-types | expected: 契约层只管编号、分页语义与编解码，不依赖运行时 | observed: 0x1e/0x1f + CHAT_HISTORY_FLAG；编码器在预算截断时自行置 HasMore；解码对越界长度回空串而不是抛错 | fit: align | patterns: [P-Adapter] | violations: [] | suggestion: 将来加「按类型过滤」继续用 flags 位，不要新增包
BASELINE | apps/game-server（sim/history + admit） | expected: 历史是内存里的旁路状态，不参与 tick 热路径，不改变广播口径 | observed: ChatHistory 只在 handleChat 写入、admit 与 C2S_CHAT_HISTORY 读取；补发在 refreshView 之前，空页也发 Replace | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 若进出园播报变密，先给历史加类型位，不要把它扩成全景事件日志
BASELINE | apps/web（session/game-ui/ChatLog） | expected: 历史与实时共用一条展示管道，滚动策略集中在一处 | observed: handleChatHistory 转 ChatEntry{history} 后走 onChatHistory → applyHistory；滚动与上翻逻辑集中在 ChatLog | fit: align | patterns: [P-Ports-Adapters, G-Strategy] | violations: [] | suggestion: 将来做「只看发言」过滤时在 applyHistory 之前按 kind 过滤，不要藏渲染
```

## 复核信号

- 出现「历史里有人在说话但我看不见他」：这是本 ADR 有意的作用域选择；要改成 AOI 口径，需在 `ChatHistory.add` 里存发送坐标并给 `before/latestPage` 加距离参数，同时接受补发变稀疏。
- 出现「翻到顶一直转圈」：先查 `C2S_CHAT_HISTORY` 的 500ms 节流是否吞掉了重试，再查客户端 `setHistoryLoading` 的超时兜底是否还在。
- 出现「上翻到底却说没有更早的」：查 `encodeChatHistory` 的预算截断是否仍会自动置 `HasMore`，以及 `server.ts` 是否把 `page.hasMore` 传了进去。
- 出现「重连后消息重复」：查服务端是否仍以 `Replace` 发首屏，以及 `applyHistory` 的去重键是否被改成只比 `id`（`msgId` 是 u16，会回绕）。
- 出现「进园首帧明显变慢」：先量 `admit()` 里的历史页大小，再考虑把补发延后到第一个 sync 之后；不要改 AOI。
- 出现「想跨重启保留聊天」：那是 ADR-0004 的复核信号（审核留证），需要单独重审持久化，不要在这里偷偷加磁盘写入。
