---
name: mobile-hud-compact-badge
overview: 手机端游戏 HUD 收口：把左上角「工牌」折叠成单行名字条（点按展开完整 FPS/PING/POS），右侧在线人数与按钮压紧成一行，桌面端布局完全不变。
todos:
  - id: hud-card-collapse
    content: 用 [skill:impeccable] 改造 Hud.tsx：工牌手机端单行折叠与展开，压紧在线徽标
    status: completed
  - id: hud-top-strip
    content: 重排 GameViewport 手机顶栏为单行，聊天浮层 top 校准为 56px
    status: completed
    dependencies:
      - hud-card-collapse
  - id: verify-mobile-hud
    content: 用 [skill:impeccable] 审计手机端 HUD，并跑 typecheck 与 bun test
    status: completed
    dependencies:
      - hud-top-strip
---

## 产品概述
面向手机端的园区游戏 HUD 空间优化：把左上角偏大的「工牌」收成一条随时可展开的名字条，并压紧右上角控件，让横屏画面把更多面积还给游戏世界。桌面端布局与信息密度保持原样。

## 核心功能
- 手机端工牌默认折叠为单行名字条：物种图标、名字（超长省略）、物种标签与展开指示；高度与顶栏按钮齐平，不再占用约五分之一屏高。
- 点击名字条展开完整工牌：工牌标题、物种、名字、FPS、PING、POS 与渲染器信息；再次点击收起，展开内容宽度受控、不会撑破小屏。
- 工牌与聊天浮层互斥：展开工牌时自动收起聊天；打开聊天时工牌回到折叠态，两者不抢同一块左上角区域。
- 右上角在线人数、音效、全屏、打卡下班在手机端压成一行并同步缩小字号与内边距，顶栏整体高度明显下降，与左侧名字条视觉齐平。
- 手机聊天浮层下移到新顶栏之下，展开面板不遮住名字条，也不影响摇杆热区与右下动作盘。
- 桌面端保持 268px 常显工牌与原有顶栏排布，无折叠按钮、无行为变化。


## 技术栈
- Next.js 15 App Router + React 19 + TypeScript
- Tailwind CSS v4（颜色/字体 token 在 `apps/web/app/globals.css`）
- zustand `useGameUi`（已有 `chatOpen` / `setChatOpen`）
- lucide-react 图标
- 不新增依赖，不改服务端与协议，不改 `ChatDock` / `TouchControls` / 全局样式

## 实现策略
1. **工牌折叠由组件内部状态驱动**：`PlayerCard` 增加本地 `open` 状态，`compact`（触屏）时默认折叠；桌面端继续走原分支，永远展开且尺寸不变。只在 `compact` 下渲染折叠条与折叠按钮，桌面 DOM 结构尽量少动。
2. **展开态复用现有工牌内容**：保留「工牌」标题、物种 tag、FPS/PING/POS 与 renderer 页脚；触屏展开时整体缩窄、字号下调（名字 20px → 16px，统计 10px → 9px），宽度约 184px，桌面仍为 268px / 20px。
3. **折叠态是独立的一行按钮**：CPU 图标 + 名字（`truncate`）+ 物种 tag + `ChevronDown`，`h-9`、`max-w-[200px]`、`min-w-0 shrink`，与右侧 36px 按钮同高；按钮带 `aria-expanded` / `aria-controls` / `aria-label` 与 `data-no-immersive`，保证自动全屏的首次 pointerdown 不抢这次点击。
4. **顶栏重排只在触屏生效**：`GameViewport` 右侧列在 `isTouch` 时改为 `flex-row items-center gap-2`（在线徽标 + 音效 + 全屏 + 打卡下班），桌面保持 `flex-col items-end`；顶栏行在触屏下 `items-center`。`OnlineBadge` 的 compact 变体收紧到 `px-2 py-1`、9px 文本、1.5 圆点；音效/全屏维持 36px 命中区，打卡下班压到 `min-h-9 px-2`。
5. **聊天浮层随之校准**：手机聊天浮层 `top-[92px]` 改为 `top-[56px]`（安全区 12px + 折叠条 36px + 8px 间隔），与新的顶栏高度对齐；该浮层仍只作用于 `isTouch`。
6. **互斥规则**：展开工牌时调用 `setChatOpen(false)`；`PlayerCard` 订阅 `chatOpen`，当其变为 true 时用 effect 把本地 `open` 复位，避免聊天关闭后工牌又突然弹开。全局状态不新增字段。
7. **视觉语言不变**：沿用 `bg-ink-900/92`、`border-2 border-ink-600`、`mint-400` 冷光、mono 小字 uppercase tracking，不引入圆角、渐变或新字体。

## 性能与可靠性
- 不新增每帧订阅、定时器或 DOM 测量：折叠状态是本地布尔值，FPS/PING/POS 已由现有 store 驱动；展开/收起只触发一次组件渲染。
- 折叠条与按钮全部使用固定像素，与现有 HUD 保持一致，避免运行时 `getBoundingClientRect` 与布局抖动。
- 桌面分支零改动，风险面仅限 `isTouch` 的两条路径。
- 内容始终可截断：名字 `truncate`、卡片 `max-w` 与 `min-w-0`，568×320 舞台上「名字条 + 右侧单行控件」仍可并排放下（约 200 + 274 + 间距 < 568）。

## 落地细节
- `pointer-events-auto` 只保留在工牌与右侧控件上，HUD 其余区域继续 `pointer-events-none`，左半屏摇杆热区不受影响。
- `aria-controls` 指向始终挂载的详情容器（折叠时用 `hidden`），避免 id 在展开后才出现；折叠条与展开头部分别是独立按钮，不嵌套。
- 安全区继续沿用 `.game-safe` / `.game-safe-rotated`；聊天浮层的 56px 与现有 92px 一样按 12px 顶部内边距估算，不新增 CSS 工具类。
- 不调整 `ConnectionBanner`（居中、`top-20`）与 hint（`bottom-40`）；展开工牌在超矮屏上与横幅/提示的瞬时重叠属于可接受的边缘情况，不做额外层级处理。
- 不修改 ADR-0033 历史文档；本次为布局收口，不新增全局状态或新模块。

## 架构设计
- 变化集中在展示层：`PlayerCard` 负责「工牌自身的折叠形态」，`GameViewport` 负责「顶栏排布与聊天浮层定位」。
- 数据流：点击折叠条 → 本地 `open` 状态 → 条件渲染；与聊天的协调只通过已有的 `chatOpen` 单向信号，不引入新的跨组件状态或事件总线。
- 组件边界保持现有 `compact` prop 语义（触屏 / 桌面），不新增 variant 枚举，避免过度抽象。

## 目录结构
```
apps/web/
├── components/game/
│   ├── Hud.tsx                    # [MODIFY] PlayerCard 增加手机端折叠/展开（默认单行名字条，展开含 FPS/PING/POS，
│   │                              #   桌面 268px 常显不变）；折叠条与展开头部补 aria-expanded/aria-controls/
│   │                              #   data-no-immersive；订阅 chatOpen 并在聊天打开时复位折叠；OnlineBadge compact
│   │                              #   收紧为 px-2 py-1、9px 文本；保持既有配色与 2px 硬边语言。
│   └── GameViewport.tsx           # [MODIFY] 触屏下顶栏右侧改为单行（在线徽标 + 音效 + 全屏 + 打卡下班）并 items-center；
│                                  #   桌面右侧维持竖排；手机聊天浮层 top 从 92px 调到 56px，与折叠条高度对齐。
└── lib/
    └── game-ui.ts                 # [READ ONLY] 复用 chatOpen / setChatOpen，不新增字段
```

## 验证
- `pnpm --filter @niuma/web typecheck`
- `cd apps/web && bun test lib`（确认现有逻辑无回归）
- 手动检查横屏 844×390 与 568×320、竖屏 CSS 旋转舞台：工牌折叠/展开、长名字截断、聊天与工牌互斥、聊天浮层不压名字条、摇杆左半屏热区、安全区、全屏与打卡下班可点；桌面端 1440 宽下工牌仍为 268px 常显。


## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 在改动 HUD 前按其 shape 流程确定折叠条与顶栏的间距、字号与命中区；完成后用 `/impeccable polish` 与 `/impeccable audit` 检查响应式、可访问性与视觉一致性。
  - Expected outcome: 手机端工牌与顶栏在 844×390、568×320 与旋转舞台下无溢出、无遮挡，键盘可达、aria 状态正确，且不引入圆角/渐变等与像素 HUD 语言冲突的样式。
