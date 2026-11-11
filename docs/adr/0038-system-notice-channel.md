# ADR-0038：园区频道的系统播报（进园 / 离园 / 本地提醒）

- 状态：已采纳
- 日期：2026-11-11
- 关联：ADR-0004（服务端零持久化）、ADR-0028（内容审核）、ADR-0033（聊天层与移动摇杆）、ADR-0036（出生点与 HUD 引导）

## 背景

园区频道目前只有玩家发言，界面上也只有「谁说了什么」。三件事因此不可见：

1. 有人进园、离园时，视野内的人毫无感知，园区像一张静止的截图；
2. 聊天没有时间，回看时无法判断某句话是刚才还是十分钟前；
3. 缺少「系统会自己说话」的位置——后续想加在岗提醒、活动通知、维护通告，没有落脚点。

需求是：进园 / 离园自动播报、所有消息带时间、把文案做成模板，以后新增自动化提示不用再改协议与 UI。

## 决策

### 1. 新增一个协议包，而不是复用聊天

```
S2C_SYSTEM_NOTICE (0x1d)
[op u8][kind u8][entityId u16][len u16][utf8 text]
```

- `text` 是**已经套好模板的成品文案**：发送方负责措辞，客户端只负责显示。
- `kind` 只用于样式（进园 `+` / 离园 `−` / 本地提醒 `·`）与将来的静音开关，不参与渲染文案。
- `entityId` 是主语实体，`0` 表示没有具体对象（例如本地在岗提醒）；今天只用于将来「点名字看工牌」。
- 旧客户端的 `handle()` 是 `default: break`，收到未知 opcode 直接丢弃，天然向前兼容；
  旧服务端不发这个包，新客户端只是没有系统消息。
- 不复用 `S2C_CHAT_BROADCAST`：聊天包的 `entityId` 会被用来弹头顶气泡与查名字，塞一个哨兵值
  等于在既有语义里打洞，将来还会和 `msgId` 计数、限速、审核纠缠。

### 2. 文案集中在共享层的模板注册表

`packages/shared-types/src/notice.ts` 提供 `SYSTEM_NOTICE_KIND`、`formatSystemNotice(kind, params)`：

```ts
Enter  → `${name} 进入了园区`
Leave  → `${name} 离开了园区`
OnDuty → `你已经在岗 ${时长}，起来走动两步。`
```

新增一种提示只要三步：加编号 → 加模板 → 在服务端事件或客户端本地事件里调用触发函数；
协议不改、UI 不改、渲染样式自动继承。未知 `kind` 或参数不足时返回 `null`，调用方直接跳过，
不会给玩家看半句话。

离园统一用中性的「离开了园区」：主动退出、关标签页与掉线在服务端不可区分，
写成「打卡下班」在网络抖动时会失真。

### 3. 播报范围与时机是硬约束

- 只发给 `player.known`（900px AOI），与聊天同口径：**不刷屏、不跨区打扰**。
- 进园必须在 `refreshView()` **之后**播报：那一刻双方的 `known` 才建立，早发等于发给零个人。
- 离园必须在 `broadcastDespawn()` **之前**播报：它内部会 `known.clear()`，晚发同样没人收。
- 系统播报不发给本人，不进聊天限速窗口，也不走词表审核（文案不含玩家输入）。

### 4. 客户端复用现有的消息管道

`session.handleSystemNotice` 把包转成 `ChatEntry { kind: 'system', systemKind, id: 负数 }` 后
调用既有的 `callbacks.onChat`，因此 `GameViewport` 与 `game-ui.messages` 一行都不用改：

- 不调用 `renderer.showBubble`：系统消息不该在头顶冒泡；
- `id` 用会话内递减的负数，与聊天 `msgId`（1–65534）分开，React key 不会撞；
- 仍受 `MAX_MESSAGES = 40` 约束，列表长度固定，不新增订阅。

### 5. 本地自动化走同一条管道

在岗提醒（30 / 60 / 120 分钟）在 `session.tick` 的 500ms 统计分支里检查 `onlineSecOf(localId)`，
跨过一档推一条本地系统消息，`handleWelcome` 归零游标。后台标签页会停掉渲染循环，
恢复时可能一次跨过好几档——只播最高那一档，不补发一串过时提醒。

### 6. 时间在客户端生成，格式是纯函数

每条消息带 `HH:MM`（本地时钟，24 小时制），悬停 `title` 给出完整日期时间。
`formatClock` / `formatFullClock` 手写补零、不依赖 `Intl`：一次渲染 40 行不必建 40 个格式化器，
也避免服务端与浏览器 locale 不一致带来的水合差异。时间只用于展示，不参与排序。

## 备选方案与反向成本

| 方案 | 形态 | 收益 | 代价 / 不做的理由 |
|---|---|---|---|
| A（采用）新 opcode + 服务端成品文案 | 约 60 字节/次，只发视野内 | 语义独立、样式可控、将来能加静音；旧客户端自动忽略 | 双端需同版本发布；服务端持有一份中文文案 |
| B 复用聊天包 + `entityId = 0` 哨兵 | 零协议改动 | 改动最小 | 头顶气泡、名字表、限速、审核全部要打特例；哨兵值会污染既有语义 |
| C 纯客户端从 spawn/despawn 推断 | 零协议、零服务端 | 最快落地 | 分不清「刚进园」与「走进视野」，走位就会误报「进入了园区」 |

反向成本（不做 / 晚做）：园区里人员流动完全不可感知，聊天没有时间线，
以后每加一种自动提示都要在聊天包里塞一次特例。

## 后果

- 正面：进出园可感知且口径准确（服务端裁决）；系统消息与聊天共用一条列表与一套消息上限；
  新增自动化提示的成本降到「一个编号 + 一条模板 + 一处触发」。
- 负面：
  - 上下线高峰期（例如活动开场）视野内可能连续出现多条进出园播报，暂时没有聚合与静音开关；
  - 系统消息与聊天共用 40 条上限，人多时普通发言会被系统行挤掉一部分；
  - 服务端多一次 per-viewer 发送循环（只在进 / 离园时发生，不进 20Hz Tick）。
- 回滚成本：低。撤掉 `server.ts` 的两处调用即不再播报；客户端可以继续渲染旧数据
  （`kind` 缺省视为普通聊天），协议为纯新增，不与既有包冲突。

## 基线

```text
BASELINE | packages/shared-types | expected: 契约层只管编号、模板与编解码，不依赖运行时 | observed: SYSTEM_NOTICE_KIND/formatSystemNotice 与 encode/decode 同层，未知 kind 返回 null、长度越界回空串 | fit: align | patterns: [P-Adapter] | violations: [] | suggestion: 新提示继续复用同一张模板表，不要在服务端就地拼字符串
BASELINE | apps/game-server（sim/notice） | expected: 广播范围与聊天同口径，发送时机不依赖隐式顺序 | observed: announceEnter 在 refreshView 后、announceLeave 在 broadcastDespawn 前，注释写明原因 | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 若进出园频率升高，在 notice.ts 内做 1–2s 聚合，别改 AOI
BASELINE | apps/web（session/ChatDock） | expected: UI 只消费展示模型，消息上限与滚动由一处控制 | observed: 系统消息复用 onChat 管道与 game-ui.messages，ChatDock 仅按 kind 分支渲染 | fit: align | patterns: [P-Ports-Adapters, G-Strategy] | violations: [] | suggestion: 静音开关落地时按 systemKind 在 pushMessage 前过滤，而不是在渲染层藏起来
```

## 复核信号

- 视野内连续出现多条进出园播报、把玩家发言顶掉：在 `sim/notice.ts` 加时间窗聚合（「3 位牛马进入了园区」），不要改 AOI；
- 玩家反馈「不想看系统消息」：按 `systemKind` 增加客户端过滤开关，服务端不必感知；
- 系统消息的文案需要按玩家语言变化：把模板表下沉到带 locale 的资源模块，协议保持只有 `text`；
- 进 / 离园有一条没播报：先查调用时机（refreshView 前后、broadcastDespawn 前后），再查 `known` 是否为空。
