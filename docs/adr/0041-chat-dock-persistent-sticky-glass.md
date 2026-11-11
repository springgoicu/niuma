# ADR-0041：聊天面板常驻、始终贴底与半透明毛玻璃

- 状态：已采纳
- 日期：2026-11-11
- 关联：取代 ADR-0033 第 4 节「发送后收起」、ADR-0039 第 8 节「贴底才跟随」；
  保留 ADR-0033 的「手机端发送后收键盘」与 ADR-0039 的「历史前插锚定」

## 背景

线上反馈集中在三件事：

1. 打开聊天面板时偶尔不是最新一条，需要自己往下拉；
2. 列表到 200 条上限之后，新消息到达不会把滚动条带到最下方；
3. 发送一条消息、或点一下画面，面板就收起，想连着说几句要反复重新打开。

同时，原来的 `bg-ink-900/92` 几乎是不透明墨块，展开后会把左下角游戏画面整块盖住。

## 问题

### 1. 追加判断依赖「长度变长」

旧实现用 `messages.length > countRef.current` 判断是否有新消息。列表封顶 200 条后
`pushMessage` 会同时裁掉队首，长度恒定，`grew` 永远为假——新消息进了数组，但滚动条不动。
这是「有新消息却不滚到底」的根因，不是容差或时序问题。

### 2. 「贴底才跟随」与用户诉求相反

ADR-0039 为了避免打断回看，选择「用户上翻时不抢滚动，只累计 ↓N 条新消息」。
本次用户明确要求任何新消息都立刻跟到最下方，接受回看被打断。

### 3. 收起动作过多

发送成功、点击画布空白、摇杆落下都会调用 `setChatOpen(false)`。面板不是用户关的，
却反复消失。

## 决策

### 1. 始终贴底，按首尾条目身份判断

`ChatLog` 改用 `useLayoutEffect`，在绘制前落位：

- 展开 / 挂载：`scrollTop = scrollHeight`，再用一次 `requestAnimationFrame` 校正首帧后的高度变化；
- 消息变化：用 `entryKey(messages[0])` 与 `entryKey(messages.at(-1))` 判断，不再看长度；
- 只有「尾部未变、头部前移」判定为历史前插，按 `height - previousHeight` 回填，正在读的句子不动；
- 其余情况（追加、整表替换、前插同时夹带新消息）一律贴底；
- 删除 `atBottom` / `newCount` / 「↓ N 条新消息」按钮与 `BOTTOM_TOLERANCE`。

历史不是新消息。保留前插锚定，上翻功能才不会被自己的贴底逻辑立刻顶回底部。

### 2. 常驻：只有 Esc 与头部按钮能收起

- `ChatDock.submit` 不再 `setOpen(false)`；触屏仍 `blur()` 收键盘（ADR-0033 的键盘遮挡约束不变）；
- `GameViewport.closePanels`（点画布 / 摇杆 engage）只收状态编辑与他人工牌，并 `blur` 当前焦点，
  不碰 `chatOpen`；
- `ChatDock` 在展开态监听 window `keydown` 的 Escape；输入框自己的 Esc 先 `preventDefault`，靠
  `defaultPrevented` 去重；
- 手机端打开工牌时仍收起聊天（`Hud`）：250px 聊天挂在工牌下方，竖屏没有并存的垂直空间。
  这是布局互斥，不是隐式自动关闭。

### 3. 展开状态写入 localStorage

新增 `apps/web/lib/chat-prefs.ts`：

```ts
export const CHAT_OPEN_KEY = 'niuma:chat-open:v1';
loadChatOpen(): boolean;
saveChatOpen(open: boolean): void;
```

- 只存 `{ open: boolean }`，走现有 `browserStorage / readJson / writeJson`，隐私模式与配额满静默降级；
- `GameViewport` 挂载时 `reset()` 之后调用 `restoreChatOpen()`，否则会被 `reset` 清掉；
- `restoreChatOpen` 只改 `chatOpen`，不推进 `chatFocusSeq`：刷新后恢复展开不能自动聚焦输入框，
  否则手机端一进页面就弹键盘；
- `requestChat` 是唯一推进聚焦序号的路径（头部按钮 / Enter / 动作盘打字键）；
- `setChatOpen` 与 `requestChat` 只在状态真正变化时写盘，不进入消息/帧路径。

### 4. 半透明毛玻璃

- 面板底：`bg-ink-900/92` → `bg-ink-900/65`，`backdrop-blur-sm` → `backdrop-blur-md`；
- 输入框：`bg-ink-950/85`，并显式给 `placeholder:text-mist-400`；
- 面板内 9px 次级文案从 `text-mist-500` 提到 `text-mist-400`，半透明底上仍满足可读性；
- 只改聊天框。其余 11 处 `bg-ink-900/92` 不动，避免全站换肤。

## 备选方案与反向成本

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 只补「长度封顶」判断，其余不动 | 改动最小 | 仍会被发送 / 点画布收起，透明度问题没解 | 低 |
| B. 始终贴底 + 取消隐式收起 + localStorage + 65% 毛玻璃（采纳） | 一次收口三条反馈 | 回看历史会被新消息打断；手机端常驻占左上空间 | 低 |
| C. 加 ResizeObserver 无条件贴底 | 高度变化也能跟到底 | 与历史前插锚定互抢滚动，上翻功能失效 | 中 |

选 B。C 的失效场景是确定的：用户滚到顶部触发分页，前插回填后 ResizeObserver 立刻把
`scrollTop` 拉回底部，等于关掉了上翻。

## 后果

- 正面：
  - 打开、刷新、收到新消息都在最下方，不再需要手动拉；
  - 发送后可以连续输入，点画布 / 摇杆不会把面板弄丢；
  - 面板透出游戏画面，左下角不再是一块实心墨块。
- 负面：
  - 回看历史时新消息会把视图拉走（用户明确选择接受）；
  - 手机端聊天常驻会占用左上区域，竖屏导览卡在聊天展开期间仍隐藏；
  - 桌面端发送后保留输入焦点，WASD 需要先点一下画面或按 Esc（发送后不再自动 blur）。
- 回滚：
  - 滚动：`ChatLog` 单独恢复 `atBottom` 分支即可，不涉及存储；
  - 常驻：`ChatDock.submit` 加回 `setOpen(false)`，`closePanels` 加回 `setChatOpen(false)`；
  - 持久化：删除 `chat-prefs.ts` 与 `restoreChatOpen` 调用，`reset()` 即回到默认收起；
  - 样式：面板根节点改回 `bg-ink-900/92 backdrop-blur-sm`。

## 复核信号

- 「有新消息但没到底」：先查 `ChatLog` 是否又按 `messages.length` 判断追加；
- 「上翻一页立刻弹回底部」：查前插回填分支的 `lastKey === previousLast` 条件是否被改坏；
- 「刷新后自动弹键盘」：查 `restoreChatOpen` 是否推进了 `chatFocusSeq`；
- 「发送后面板消失」：查 `ChatDock.submit` 是否又调用了 `setChatOpen(false)`；
- 「点画面聊天没了」：查 `GameViewport.closePanels` 是否还写 `chatOpen`；
- 「面板小字看不清」：查聊天框内是否还有 `text-mist-500`，以及背景是否被改回 92%。
