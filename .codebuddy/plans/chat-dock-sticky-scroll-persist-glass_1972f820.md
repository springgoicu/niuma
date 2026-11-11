---
name: chat-dock-sticky-scroll-persist-glass
overview: 让园区聊天框：打开即贴底、任何新消息都强制滚到最下方；发送消息、点击画布/摇杆都不再自动收起，并通过 localStorage 记住展开状态（刷新后恢复且不自动聚焦）；面板底色改为 50-70% 半透明毛玻璃。
todos:
  - id: chat-open-prefs
    content: 新增 chat-prefs 存储，在 game-ui 实现 chatOpen 持久化、恢复与静默打开
    status: completed
  - id: chat-log-sticky
    content: 重写 ChatLog 滚动：打开与新消息始终贴底，按条目 key 判断，保留历史前插锚定
    status: completed
  - id: chat-dock-behavior
    content: 调整 ChatDock：发送后不收起、恢复不聚焦、桌面保焦点、触屏收键盘、Esc 关闭
    status: completed
    dependencies:
      - chat-open-prefs
  - id: glass-panel
    content: 用 [skill:impeccable] 将聊天面板改为半透明毛玻璃并校验小字对比度
    status: completed
    dependencies:
      - chat-dock-behavior
  - id: host-wiring
    content: 取消点画布与摇杆关聊天，保留手机端工牌互斥，补 ADR-0041
    status: completed
    dependencies:
      - chat-open-prefs
  - id: verify-chat
    content: 用 [skill:verification-before-completion] 跑 typecheck/test 并手动验收滚动、常驻、刷新与透明背景
    status: completed
    dependencies:
      - chat-log-sticky
      - glass-panel
      - host-wiring
---

## 产品概述
优化园区游戏内聊天框的打开、滚动与常驻体验，让聊天不再因发送消息或点击画面而意外消失，并让面板以半透明毛玻璃融入游戏画面。

## 核心功能
- 打开即贴底：聊天框每次展开都直接定位到最新一条消息。
- 新消息始终贴底：任何新消息到达都立即滚到最下方，包括用户正在上翻历史时。
- 历史分页保留：上翻加载更早消息时仍按高度差保持当前阅读位置，不被前插内容顶走。
- 常驻：发送消息后不自动收起；点击画布空白、按住摇杆也不再关闭聊天。
- 关闭方式：仅面板头部折叠按钮与 Esc 可关闭聊天。
- 状态记忆：展开/收起状态写入本地存储，刷新页面后仍保持上次状态。
- 恢复不抢焦点：刷新后恢复展开时不会自动聚焦输入框、不弹出手机键盘。
- 半透明毛玻璃：面板底色不透明度降至约 60%-70%，加强背景模糊，文字与边框保持清晰可读。
- 移动端适配：发送后保持面板展开但收起键盘，避免遮挡摇杆。


## 技术栈
- Next.js 15 + React 19 + TypeScript
- 状态管理：Zustand 5（现有 `apps/web/lib/game-ui.ts`）
- 样式：Tailwind CSS v4，沿用现有 `ink / mist / mint` 设计 token
- 存储：现有 `apps/web/lib/storage.ts` 封装，不新增依赖
- 测试：Bun Test（`apps/web/package.json` 的 `bun test lib`）

## 实现方案

### 1. 聊天列表始终贴底
改造 `apps/web/components/game/ChatLog.tsx`：
- 用 `useLayoutEffect` 替换打开时的 `useEffect`，在挂载/展开的同一帧把 `scrollTop` 设为 `scrollHeight`，避免可见的跳动；再用一次 `requestAnimationFrame` 校正布局稳定后的高度。
- 消息变化判断不再依赖 `messages.length` 增长。列表达到 `MAX_MESSAGES = 200` 后长度恒定，现有 `grew` 判断会失效，这正是「有新消息却不滚到底」的根因。改为用 `firstKeyRef / lastKeyRef` 的条目身份判断前插与追加。
- 仅前插历史（`firstKey` 变化且 `lastKey` 未变）时按 `height - previousHeight` 回填 `scrollTop`；其余变化（追加、整表替换、同时前插与追加）一律滚到底。
- 删除 `atBottom`、`atBottomRef`、`newCount`、`jumpToLatest`、「↓ N 条新消息」按钮、`BOTTOM_TOLERANCE` 与 `ArrowDown` 依赖。
- 保留顶部 `TOP_TRIGGER` 与 `onLoadHistory` 逻辑；空态、历史分隔线、加载态样式不变。
- 不引入 `ResizeObserver` 常驻贴底，避免与历史前插锚定互相抢滚动；打开时的一次 `requestAnimationFrame` 足以覆盖面板宽度/高度稳定过程。

### 2. 展开状态持久化
新增 `apps/web/lib/chat-prefs.ts`，复用 `browserStorage('local') / readJson / writeJson`：
- key：`niuma:chat-open:v1`
- 存储结构：`{ open: boolean }`，guard 只接受布尔字段；坏数据按 `readJson` 现有行为清除。
- 默认值 `false`；读写失败静默降级，不影响进入游戏。

改造 `apps/web/lib/game-ui.ts`：
- 新增 `restoreChatOpen()`：只恢复 `chatOpen`，不推进 `chatFocusSeq`、不清未读。
- `setChatOpen` 与 `requestChat` 在状态真正变化时写入存储。
- `requestChat` 仍是唯一推进 `chatFocusSeq` 的动作；`setChatOpen(true)` 不再承担「聚焦」语义。
- `reset()` 保持原样，由 `GameViewport` 在挂载 effect 中 `reset()` 之后调用 `restoreChatOpen()`，避免 reset 清掉持久化状态。
- `setStatusOpen` 不再强制把 `chatOpen` 置为 `false`：桌面端工牌在左上、聊天在左下，可以并存；手机端的空间互斥由 `Hud` 组件显式处理。

`ChatDock` 聚焦策略：
- 聚焦 effect 改用 ref 记录上次 `focusSeq`，仅在序号真正变化时 `focus()`；恢复常驻的首次挂载不聚焦。
- 发送消息后保持展开：桌面端保留输入焦点便于连续聊天；`compact`（触屏）仍 `blur()` 收起键盘，避免遮挡摇杆。
- Esc 关闭：保留输入框内 Esc；补充面板展开时的 window `keydown` 监听，使输入框失焦后 Esc 仍可关闭（参考 `NoticeBoard` 的用法）。

### 3. 常驻与宿主联动
改造 `apps/web/components/game/GameViewport.tsx`：
- `closePanels` 不再调用 `setChatOpen(false)`，只关闭状态面板与他人工牌，并更新注释。
- `Joystick onEngage={closePanels}` 因此不再关聊天；摇杆热区仍在下层，面板自身 `pointer-events-auto` 行为不变。

`apps/web/components/game/Hud.tsx`：
- 手机端「展开工牌即收起聊天」保留，作为窄屏空间互斥的明确例外：聊天面板挂在工牌下方，两者同时展开会超出竖屏可用高度。
- 桌面端工牌与状态编辑不再关闭聊天。
- `ChatDock` 打开时工牌自动折叠的现有 effect 保留。

引导层：
- `WelcomeBanner` 桌面端不再因聊天展开而隐藏（聊天在左下，欢迎条在中上，不重叠）；竖屏仍保持让位，避免横屏底部与浮层重叠。
- `NavCard` 竖屏隐藏条件保持不变，并在实现说明中记录：390px 宽度下 250px 聊天与 196px 导览卡无法并存，这是常驻聊天的已知取舍。

### 4. 半透明毛玻璃
仅改聊天框，不触碰其余 11 处 `bg-ink-900/92`：
- `ChatDock` 根容器：`bg-ink-900/92 backdrop-blur-sm` 改为 `bg-ink-900/65 backdrop-blur-md`，保留 `border-2 border-ink-600` 的像素硬边语言。
- 输入框：`bg-ink-950` 调整为 `bg-ink-950/85`，保证输入文字与占位符可读。
- 面板内 9px 的 `text-mist-500` 次级文案提升为 `text-mist-400`，确保半透明底上仍满足可读性；主消息保持 `text-mist-100`，不再降低。
- 折叠态提示条、hover 态沿用现有颜色。
- 执行时用 `impeccable` 技能做 polish/audit，检查透明度、对比度、边框层级与移动端可读性。

### 5. 文档
新增 `docs/adr/0041-chat-dock-persistent-sticky-glass.md`：
- 记录本次决策：始终贴底、发送/点画布/摇杆不关闭、localStorage 记忆展开、60%-70% 毛玻璃。
- 明确取代 ADR-0033 第 4 节「发送后收起」与 ADR-0039 第 8 节「贴底才跟随」，并保留「历史前插锚定」与「手机端发送后收键盘」。
- 写明回滚路径：滚动策略、持久化 key、面板样式三处可独立回退。

## 架构设计
保持现有分层不变：
- `ChatLog` 只负责列表渲染、滚动与历史分页触发。
- `ChatDock` 只负责面板外壳、输入、聚焦与关闭交互。
- `game-ui` 只负责状态与持久化边界，不感知 DOM 滚动。
- `GameViewport / Hud` 负责宿主级面板互斥与布局让位。
- `chat-prefs` 作为独立存储适配器，可单测、可替换。

## 目录结构
```
apps/web/
├── lib/
│   ├── chat-prefs.ts                         # [NEW] 聊天展开状态读写：key、guard、load/save，复用 browserStorage
│   ├── game-ui.ts                            # [MODIFY] 新增 restoreChatOpen；setChatOpen/requestChat 写盘；调整 setStatusOpen
│   └── __tests__/
│       ├── chat-prefs.test.ts                # [NEW] 内存 Storage 测试默认值、roundtrip、坏 JSON、null storage
│       └── game-ui-history.test.ts           # [MODIFY] 补充 setStatusOpen 不关聊天、reset 后恢复的断言
├── components/game/
│   ├── ChatDock.tsx                          # [MODIFY] 发送后不收起、聚焦序号守卫、Esc 监听、毛玻璃样式
│   ├── ChatLog.tsx                           # [MODIFY] 始终贴底、按条目身份判断追加、保留前插锚定、移除跳底按钮
│   ├── GameViewport.tsx                      # [MODIFY] closePanels 不关聊天；挂载后 restoreChatOpen
│   ├── Hud.tsx                               # [MODIFY] 保留手机端互斥，桌面端不再因状态面板关聊天
│   └── WelcomeBanner.tsx                     # [MODIFY] 桌面端不再因 chatOpen 隐藏
docs/adr/0041-chat-dock-persistent-sticky-glass.md  # [NEW] 记录本次决策与回滚路径
```

## 关键代码结构
```ts
// apps/web/lib/chat-prefs.ts
export const CHAT_OPEN_KEY = 'niuma:chat-open:v1';
export function loadChatOpen(storage?: StorageLike | null): boolean;
export function saveChatOpen(open: boolean, storage?: StorageLike | null): void;
```

```ts
// apps/web/lib/game-ui.ts 新增 action
restoreChatOpen: () => void;
```

## 实现注意事项
- 不要用消息数量增长判断追加；200 条封顶后长度不变，必须用首尾条目 key 判断。
- 历史前插锚定与「始终贴底」是两条不同路径，不能用一个 `atBottom` 标志混在一起。
- `restoreChatOpen` 必须发生在 `GameViewport` 的 `reset()` 之后，否则状态被清空。
- 恢复展开时禁止自动聚焦；只有 `requestChat`（头部按钮、Enter、动作盘打字键）推进 `focusSeq` 并聚焦。
- localStorage 写入只发生在开关状态变化时，不进入每帧或每条消息路径。
- 不改其余面板的 `bg-ink-900/92`，不新增全局 CSS，不引入新依赖。
- 滚动为 O(1) DOM 操作，渲染仍为现有 O(n)；无新增定时器或监听器泄漏，Esc 监听随面板卸载清理。
- 无新增日志需求；存储失败由 `storage.ts` 静默兜底，避免把隐私模式异常带到 UI。

## 验证
- `cd apps/web && bun run typecheck`
- `cd apps/web && bun run test`
- 手动验收：
  - 滚动到顶部后收到新消息立即回到底部；
  - 关闭再打开、刷新后重新打开均在底部；
  - 上翻加载历史时阅读位置不跳；
  - 发送后不收起；点画布、按摇杆不收起；
  - Esc 与头部按钮可关闭；
  - 刷新后保持展开且不弹手机键盘；
  - 面板透出游戏画面，9px 文案仍可读。


## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 对聊天面板的半透明毛玻璃样式做 polish/audit，校验透明度、对比度、层级与移动端可读性，符合项目 UI 规则。
  - Expected outcome: 面板视觉与现有像素 HUD 语言一致，无 primary findings，9px 文案可读。
- **verification-before-completion**
  - Purpose: 在声明完成前运行 typecheck、单测与手动验收清单，确认滚动、常驻、持久化与毛玻璃均符合要求。
  - Expected outcome: 所有验证命令通过，验收项逐条有结果，无未验证的完成声明。
