# ADR-0047：聊天列表贴底改为「贴底意图 + 有条件跟随」

- 状态：已采纳
- 日期：2026-11-12
- 关联：修正 ADR-0041 第 1 节中拒绝 ResizeObserver（方案 C）的结论；
  保留 ADR-0039 第 8 节「历史前插锚定」与 ADR-0041「任何新消息立即贴底」

## 背景

用户反馈：聊天面板展开后不是最新一条，列表离底部总有一段距离，必须手动滑到底
才能看到最新消息。ADR-0041 已经修过同一症状（追加判断从「长度变长」改为首尾条目
身份），线上仍然复现，说明当时定位的是并列缺陷之一，不是全部。

## 问题

### 1. 贴底是「一次性快照」

`ChatLog` 只在 `[open]` 与 `[messages]` 变化时写 `scrollTop = scrollHeight`，
再加一次 rAF 兜底。赋值之后发生的任何高度变化都没有人跟随：

- 滚动容器的 `max-h` 用 `dvh`：视口变矮、移动端地址栏收展 → `clientHeight` 变小，
  底部距离凭空多出来；
- 容器宽度变化（父级 flex、窗口缩放、滚动条出现）→ 中文重新换行 → 行数与总高变化；
- `font-display: swap` 的等宽字体晚到，时间戳与名字的度量变化，含长消息时可能改变换行；
- 桌面窗口缩放、`compact` 换档切换 `max-h`。

### 2. 程序化贴底被误判成「用户上翻」

`handleScroll` 只看 `scrollTop < TOP_TRIGGER`。打开面板时 `scrollTop = scrollHeight`
触发的 scroll 事件，如果列表只比一屏高不到 16px，就会被当成用户上翻：立刻请求更早
一页 → 顶部插入「正在加载更早的消息…」→ 前插按高度差锚定 → 视图被留在上方。
首屏补发 10 条历史的高度刚好落在这个区间，这是本次反馈最可复现的主路径。

### 3. 空页上翻会拉回底部

`applyHistory` 在非 replace 且去重后没有新条目时仍返回新数组。`ChatLog` 的首尾身份键
都没变，落到 `else` 分支无条件 `scrollTop = scrollHeight`：用户上翻到底，反而被拉回底部。

## 决策

1. **单一贴底入口** `pinToBottom()`：写滚动位置、对齐前插高度基准、记录 `scrollTop`
   基准、置 `followLayout = true`。所有「该看最新一条」的路径都走它。
2. **消息三分支**（仍是 O(1) 首尾身份键）：
   - 尾部变化 → 无条件贴底（ADR-0041 的契约不变）；
   - 仅头部前移 → 按高度差回填锚定（ADR-0039 的契约不变）；
   - 首尾都没变 → 不碰滚动，只刷新高度基准。
3. **有条件跟随布局变化**：`ResizeObserver` 只观察滚动容器自身的 content-box，
   配合 `followLayoutRef`（用户滚开后为 false，贴底后为 true）。容器变矮、变宽或
   `max-h` 换档时按需重新贴底。

   **修正 ADR-0041 拒绝 ResizeObserver 的理由**：那次否决针对的是「无条件贴底」。
   内容超出 `max-h` 之后，追加与前插都不会改变容器尺寸，观察容器不会与前插锚定互抢；
   叠加 `followLayout` 条件后，上翻时根本不进入贴底分支。ADR-0041 方案 C 的失效场景
   是「观察内容高度 + 无条件贴底」，与本次实现不是同一件事。
4. **字体就绪补一次**：`document.fonts.ready` 后，若仍在挂载且 `followLayout` 为真，
   贴一次。这是唯一「内容高度变化但容器尺寸不变」的来源。
5. **上翻只认「向上滚」**：`handleScroll` 记录上一次 `scrollTop`，只有变小才可能是
   用户上翻；程序化贴底与前插回填都是增大，天然不会误触发。同时要求
   `scrollHeight > clientHeight`，内容不足一屏时不自动请求。
6. **空页不换引用**：`applyHistory` 在 `fresh.length === 0` 时只更新 `history`
   （清掉 loading、更新 hasMore），`messages` 与游标保持原状，既消除误贴底，
   也省掉一次 200 条列表的重渲染。

## 备选方案与反向成本

| 方案 | 收益 | 代价 / 失效场景 | 不可逆性 |
|---|---|---|---|
| A. 只把 rAF 兜底延长（双帧 / 定时器） | 改动最小 | 覆盖不到视口变化与迟到的字体；靠猜时机 | 低 |
| B. 有条件跟随（采纳） | 覆盖全部已知晚到变化；上翻不被打断 | 多一个 ResizeObserver 与三个 ref，`followLayout` 语义要维护 | 低 |
| C. 无条件 ResizeObserver 贴底 | 实现更短 | 前插/字体变化会把正在读的句子顶走（ADR-0041 已否决） | 中 |
| D. `flex-direction: column-reverse` 原生贴底 | 几乎不写贴底代码 | 渲染顺序反转，前插锚定与上翻逻辑全要重写 | 高 |

选 B。A 不解决本次可复现主路径（误触发上翻），C 会重演 ADR-0041 的失效场景，
D 的回滚成本与本次缺陷不匹配。

## 后果

- 正面：
  - 打开、刷新恢复、断线重连都在最底部；视口与窗口变化后不再多出底部空隙；
  - 打开面板不再因为「刚好略超一屏」自动多发一次历史请求；
  - 上翻返回空页不再被拉回底部，也不再触发整表重渲染。
- 负面：
  - `followLayoutRef` 是命令式状态，读代码时要同时看 `handleScroll` 与两处 effect；
  - `ResizeObserver` 的回调合并到下一帧，理论上仍有一帧旧位置（可接受）。
- 回滚（30 天内）：
  - 滚动：`apps/web/components/game/ChatLog.tsx` 单文件还原到 ADR-0041 版本；
  - 空页：删除 `game-ui.applyHistory` 的 `fresh.length === 0` 分支即回到旧行为。
  两者互不依赖，可分开回滚。

## 复核信号

- 「打开后还差一截」：先看 `pinToBottom` 是否仍是唯一入口，ResizeObserver 是否被改成观察内容层；
- 「上翻一页立刻弹回底部」：查 `handleScroll` 的 `top >= previousTop` 早退是否被删、
  前插分支是否误走 `pinToBottom`；
- 「打开面板就发历史请求」：查 `handleScroll` 是否又回到只看 `scrollTop < TOP_TRIGGER`；
- 「上翻到底列表跳到底部」：查 `applyHistory` 的空页分支是否被移除；
- 「窗口缩放后消息被裁」：确认 ResizeObserver 的 `followLayout` 条件没有被写成恒真。

## 基线

```text
BASELINE | apps/web/components/game/ChatLog.tsx | expected: 滚动策略集中在单一入口，组件只消费 messages/history 展示模型 | observed: pinToBottom 统一贴底；三分支判定基于首尾 entryKey；ResizeObserver 只观察容器且受 followLayout 约束；上翻要求 scrollTop 递减且内容可滚 | fit: align | patterns: [P-Ports-Adapters, G-Strategy] | violations: [] | suggestion: 将来做「只看发言」过滤时在 applyHistory 之前按 kind 过滤，不要在滚动层加分支
BASELINE | apps/web/lib/game-ui.ts | expected: 状态层只负责合并与分页游标，不制造无效引用变化 | observed: 空页上翻只更新 history，messages 与 cursor 保持原状 | fit: align | patterns: [P-Policy] | violations: [] | suggestion: 若服务端改为可跳页游标，把语义在同层扩成 { before, hasMore }，不要散到组件里
```
