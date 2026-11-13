---
name: hud-dock-and-install-fix
overview: 把园区右上角六个操作入口重排成一条统一尺寸、分组清晰的游戏式 HUD 工具栏，并修好「存到桌面」：安装事件在根布局接管、安装弹窗失败后可重试、补齐缺失的品牌图与反馈。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素 HUD
    - 终端冷光
    - 单条工具栏
    - 等距方钮
    - 硬边框
  fontSystem:
    fontFamily: Oswald
    heading:
      size: 14px
      weight: 600
    subheading:
      size: 10px
      weight: 500
    body:
      size: 11px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
    background:
      - "#14100C"
      - "#1B1611"
      - "#221B16"
      - "#2E241D"
    text:
      - "#F4EDE1"
      - "#A2917A"
      - "#857463"
    functional:
      - "#E06A5A"
      - "#E07A4A"
      - "#CFE08A"
todos:
  - id: hud-dock-primitives
    content: 在 Hud.tsx 新增统一的 HUD 按钮样式函数、工具栏、分隔线与单行状态段，并重写 OnlineBadge
    status: completed
  - id: topbar-dock
    content: 将 GameViewport 右上角改为一条分段工具栏，同步改造公告、存到桌面、音效与竖屏导览卡偏移
    status: completed
    dependencies:
      - hud-dock-primitives
  - id: install-boot
    content: 新增根级 InstallBoot 提前接管安装事件，initInstallPrompt 改为幂等，并显式声明 manifest
    status: completed
  - id: install-ux
    content: 修复 promptInstall 事件丢失与连点，面板增加安装失败提示、再试一次与准确状态
    status: completed
    dependencies:
      - install-boot
  - id: assets-and-release
    content: 运行 pnpm assets 生成品牌图标，完成三档尺寸与安装流程验收，补版本工报
    status: completed
    dependencies:
      - topbar-dock
      - install-ux
---

## 用户需求

园区页面（`/play`）右上角目前堆着六个各自为政的控件：44×44 的图标方钮、36 高的文字胶囊混排，每个控件都单独描 2px 边框，窄屏下还会 `flex-wrap` 折成参差的两行，加上单独一块「在线徽标」，整体显得杂乱。

需要完成两件事：

## 产品概述

把右上角改造成一条符合游戏 HUD 习惯的系统工具栏，并让「存到桌面」真正可用。

## 核心功能

- **统一工具栏**：右上角六个入口收进同一条外框，只保留一层边框，控件尺寸、图标大小、hover/焦点态完全一致；按用途分段：在线状态 ｜ 公告、存到桌面、音效 ｜ 切换园区 ｜ 打卡下班。
- **状态段内联**：「视野内 N」收成工具栏左端的一枚单行状态段，不再单独浮一块；去掉 `aoi 900px` 这类实现细节，只保留人数与在线/离线指示灯。
- **主次分明**：「打卡下班」用警示红 hover 与工具段区分；下拉面板仍从各自按钮下方右侧展开，点画面或 Esc 收起。
- **响应式收敛**：桌面一条横向工具栏，不再出现折行参差；触屏横屏同样一条；触屏竖屏收成规整的两行图标格，导览卡顺延到工具栏下方，不被遮挡。
- **存到桌面可用**：任意页面进入园区后点击「装到桌面」能弹出浏览器原生安装框；安装成功后按钮变为「已在桌面」；浏览器不支持或本次被拒时，面板就地给出提示与手动添加步骤，并能重试、复制链接。
- **安装资源齐全**：安装清单引用的品牌图标全部可访问，浏览器能识别本园区为可安装应用。

## 技术栈

沿用现有栈，不引入新依赖：Next.js 15 App Router + React 19 + TypeScript、Tailwind CSS v4（`globals.css` 的 `@theme` 设计令牌）、lucide-react 图标、zustand（`useGameUi`）。

## 实现方案

### 1. 抽出 HUD 工具栏原语（单一事实源）

在 `apps/web/components/game/Hud.tsx` 内新增三个可复用件与一个样式函数，供 NoticeBoard / InstallAppButton / SfxToggle / GameViewport 的 Link 共用，避免五处各写一套尺寸：

- `hudButtonClassName({ compact, active, danger })`：纯函数返回类名。桌面 `h-9 w-9`（36×36），触屏 `h-11 w-11`（44×44，满足触屏最小命中区）；`grid place-items-center`、图标 `h-4 w-4`、`text-mist-500`，hover 与 `active` 用 `bg-mint-400/10 text-mint-400`，`danger` 用 `bg-signal-500/10 text-signal-500`，焦点态沿用全局 `:focus-visible` 薄荷描边。
- `HudDock`：`flex items-center border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm` 的外框容器；只画这一层边框，内部不再各自描边。
- `HudDivider`：`h-5 w-px bg-ink-700` 的静态分隔，把「状态 / 工具 / 导航 / 危险」四段分开。
- `HudStatus`：替换现有 `OnlineBadge` 的双行版式——单行「● 视野 12」，保留在线/离线灯色（`mint-400` / `amber-400`）与 `title` 里的补充说明，删除 `aoi 900px` 与状态详情这类调试文本。

`SfxToggle`、`NoticeBoard`、`InstallAppButton` 的触发按钮改为消费 `hudButtonClassName`，各自只保留 `active`（面板展开）与 `danger` 语义；按钮内部内容、`aria-label`、`title`、`data-*-trigger`、点击外部收起、Esc 回焦逻辑全部不动，把改动限制在样式层。

### 2. 重排 GameViewport 右上角

把 `GameViewport.tsx` 现有的 `OnlineBadge` + `flex flex-wrap` 六控件块替换为一条 `HudDock`：

```
[● 视野 12] │ [公告][存到桌面][音效] │ [切换园区] │ [下班]
```

- 工具段、导航段、危险段之间插 `HudDivider`；触屏全屏按钮保留并归入工具段（手机唯一全屏入口）。
- 竖屏改为 `grid grid-cols-3` 的两行图标格（6 个 44×44），状态段作为独立一行放在格子上方，同样使用外框风格；`OnlineBadge` 的 `compact` 分支保留。
- 图标按钮一律只留 `aria-label` + `title`（原生悬停提示），不再混排 9px 文字胶囊——这是消除折行参差的根本手段；图标语义不足的「切换园区」在 `title` 中补全「切换到哪座园区」。
- 下拉面板仍在各按钮的 `relative` 包裹层内 `absolute right-0 top-full mt-1.5`，工具栏容器不设 `overflow-hidden`，避免裁掉面板。

### 3. 竖屏偏移去魔法值

`NavCard.tsx` 现有的 `calc(max(0.75rem, env(safe-area-inset-top)) + 11.5rem)` 是按旧三行控件估的。改为从 `Hud.tsx` 导出 `HUD_DOCK_PORTRAIT_REM`（状态行 + 两行 44px 按钮 + 间距 + 外框），`NavCard` 直接引用该常量拼接 `calc(...)`，并同步更新注释，保证今后改按钮尺寸只改一处。

### 4. 「存到桌面」修复（四个根因逐一收口）

- **监听太晚（主因）**：`install-prompt.ts` 只在 `/play` 的客户端 chunk 求值，而 `beforeinstallprompt` 每次页面加载只发一次；首页 `/` 加载时事件已发过，`Link`/`router.push` 跳到 `/play` 后 `deferred` 永远是 `null`。新增 `apps/web/components/InstallBoot.tsx`（`'use client'`，`useEffect` 内调 `initInstallPrompt()`，渲染 `null`），挂进 `app/layout.tsx` 与 `BuildWatcher` 并列，使任何入口页面首次加载就接管事件。
- **SW 重复注册**：`initInstallPrompt()` 增加模块级 `started` 幂等标记（`bind()` 已有 `bound`），`PlayShell` 里的调用可保留（幂等）或删除。
- **事件被提前消费**：`promptInstall()` 改为「先 `await event.prompt()` 与 `userChoice`，settled 后再清空 `deferred`」；`prompt()` 抛错时把事件放回 `deferred` 并 `emit()`，让按钮可重试；增加 `prompting` 互斥，防止连点二次弹窗。
- **静默失败**：`InstallAppButton` 接住 `promptInstall()` 的返回值，`'unavailable'` 时在面板内显示一行「这次浏览器没允许安装，可以按下面的步骤手动添加」，并在 Chromium 手动引导里补一枚「再试一次」按钮；保留「复制链接」。

### 5. 安装资源与清单

`apps/web/public/brand/` 目录当前不存在（被 `.gitignore` 忽略，由 `packages/pixel-assets/scripts/brand.ts` 在 `pnpm assets` 时生成），而 `app/manifest.ts` 的 192/512/maskable 图标指向该目录 —— 图标 404 会让 Chrome 的安装性检查直接失败，`beforeinstallprompt` 根本不发。交付时必须运行 `pnpm assets` 生成 `/brand/logo-*.png`，并在 `apps/web/app/layout.tsx` 的 `metadata` 显式补 `manifest: '/manifest.webmanifest'`（Next 虽会自动注入，显式声明可避免路由级 metadata 覆盖时丢链）。

## 实现要点

- **性能**：改动纯展示层。`HudStatus` 只订阅 `nearby` / `status` 两个原语字段（与现有一致），不新增 store、不新增定时器；图标为既有 lucide 静态组件，`optimizePackageImports` 已开启。
- **破坏半径**：只动 HUD 顶层与三个下拉入口的样式层；`useGameUi` 的 `noticeOpen` / `installOpen` 互斥逻辑、面板内容、`RemoteArchiveDialog` 等一律不碰。`PlayShell` 的探活与重连链路零改动。
- **兼容**：`data-install-trigger` / `data-notice-trigger` 保留，Esc 回焦与「点外部收起」的 `querySelector` 选择器继续有效；下拉不抢焦点、不拦游戏输入的行为不变。
- **验证**：`pnpm --filter @niuma/web typecheck`、`pnpm --filter @niuma/web test`（`lib/__tests__/install-guide.test.ts` 已覆盖 UA 分档）；手动验证 `/brand/logo-192.png` 返回 200、`/manifest.webmanifest` 可解析、DevTools Application 里 SW 为 activated、Chrome 地址栏出现安装图标。
- **发布纪律**：按 `AGENTS.md`，在 `apps/web/data/release-notes.json` 的 `entries` 顶部追加 `2026-11-13-1`，只写玩家可感知的结果（工具栏、装到桌面、手机两行图标格），随后跑 `pnpm changelog:check`。

## 架构设计

仍是「Server Component 外壳 → 客户端 HUD 组件 → zustand store」三层，不新增架构模式：

- 展示层：`GameViewport` 只负责工具栏的排布与分组，尺寸/态样式全部下沉到 `Hud.tsx` 的原语。
- 能力层：`lib/install-prompt.ts` 继续做浏览器安装能力的唯一单例（仍在模块求值时 `bind()`），新增一个零渲染的根级 `InstallBoot` 负责「尽早接管」，职责边界清晰。
- 资源层：`manifest.ts` + `public/sw.js` + `public/brand/*` 构成可安装三件套，无需服务端参与。

## 目录结构

```
apps/web/
├── app/
│   ├── layout.tsx                     # [MODIFY] 挂载 InstallBoot；metadata 显式补 manifest 字段
│   └── manifest.ts                    # [KEEP] 图标仍指向 /brand/*，确保 assets 已生成
├── components/
│   ├── InstallBoot.tsx                # [NEW] 零渲染客户端组件：挂载即 initInstallPrompt()，保证任意页面首次加载就接住 beforeinstallprompt
│   └── game/
│       ├── Hud.tsx                    # [MODIFY] 新增 hudButtonClassName / HudDock / HudDivider / HudStatus 与 HUD_DOCK_PORTRAIT_REM；OnlineBadge 改单行状态段；SfxToggle 改用共享尺寸
│       ├── GameViewport.tsx           # [MODIFY] 右上角替换为一条 HudDock：状态 │ 公告/存桌面/音效 │ 切换园区 │ 下班；竖屏 3 列两行；全屏按钮归入工具段
│       ├── NoticeBoard.tsx            # [MODIFY] 触发按钮消费 hudButtonClassName，去掉文字胶囊与 ChevronDown，面板与收起逻辑不变
│       ├── InstallAppButton.tsx       # [MODIFY] 触发按钮同上；接住安装结果，unavailable 时就地提示 + 「再试一次」，保留复制链接
│       └── NavCard.tsx                # [MODIFY] 竖屏 top 偏移改为引用 HUD_DOCK_PORTRAIT_REM，同步注释
├── lib/
│   └── install-prompt.ts              # [MODIFY] initInstallPrompt 幂等（SW 只注册一次）；promptInstall 失败不丢事件、加互斥、settled 后再清 deferred
└── data/
    └── release-notes.json             # [MODIFY] 顶部追加 2026-11-13-1 版本工报
```

## 设计风格

沿用园区既有的「像素办公 + 冷光终端」HUD 语言：暖墨底、2px 硬边框、无圆角、等宽小字、单点薄荷冷光。本次只重排右上角，视觉权重从「六个各自浮起的盒子」收敛为「一条工具栏」，读作游戏里的系统菜单栏。

## 工具栏结构

横向一条，自左至右四段，段间用 1px 竖分隔线：

1. 状态段（不可点）：薄荷色呼吸点 + 「视野 12」，离线时转琥珀色；
2. 工具段：公告（喇叭）、存到桌面（显示器）、音效（喇叭/静音），触屏再加全屏；
3. 导航段：切换园区（交叉箭头）；
4. 危险段：打卡下班（出口箭头），hover 转警示红。

整条只有一层 2px 外框，按钮之间不画边；桌面按钮 36×36、触屏 44×44，图标 16px，全部方形等距，天然对齐、不会折行。

## 状态与动效

- 默认图标 `mist-500`；hover 与键盘焦点转 `mint-400` 并叠一层 10% 薄荷底；
- 下拉已展开的按钮保持薄荷底 + 薄荷图标，与外框形成「按下」的可信反馈；
- 「打卡下班」hover 只转 `signal-500` 与 10% 红底，不与工具段共用颜色；
- 过渡统一 `transition-colors`，时长 150ms，不做位移与缩放，避免像素边缘抖动。

## 响应式

- 桌面：一条横栏贴右上，右侧留 16px 安全边距，永不断行；
- 触屏横屏：同样一条横栏，按钮放大到 44×44，状态段保留在最左；
- 触屏竖屏：状态段独立一行，其下 3 列 × 2 行图标格，整体仍是一层外框；导览卡顺延到工具栏下方，不与图标格重叠；
- 下拉面板依旧从触发按钮右下展开，宽度维持 240–268px，不因工具栏收窄而改变版式。

## 可读性

按钮仅用图标 + 原生 title 悬停提示 + `aria-label`，取消 9px 文字胶囊，消除桌面窄屏的折行错位；危险动作靠颜色而非字号区分，扫描路径更短。
