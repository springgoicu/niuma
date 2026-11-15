---
name: f2-code-studio-overlay
overview: 在园区内按 F2 打开一屏静态仿 VS Code 的只读「代码工位」彩蛋界面（文件树可点切换、代码只读），按 Esc 关掉并回到游戏画面；打开期间游戏键被完全吞掉，角色不移动。
design:
  architecture:
    framework: react
  styleKeywords:
    - VS Code 复刻
    - 深色 IDE
    - 等宽代码
    - 像素收边
    - 克制的入场动效
  fontSystem:
    fontFamily: JetBrains Mono
    heading:
      size: 13px
      weight: 600
    subheading:
      size: 12px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#007ACC"
      - "#0E639C"
      - "#1F9CF0"
    background:
      - "#1E1E1E"
      - "#252526"
      - "#333333"
      - "#181818"
    text:
      - "#D4D4D4"
      - "#CCCCCC"
      - "#858585"
      - "#FFFFFF"
    functional:
      - "#569CD6"
      - "#CE9178"
      - "#4EC9B0"
      - "#6A9955"
      - "#F14C4C"
      - "#4FE3C1"
todos:
  - id: studio-content
    content: 新建代码工位静态数据与高亮器，含文件树与只读源码
    status: completed
  - id: studio-overlay
    content: 实现全屏仿 VS Code 只读界面与键盘接管，Esc 退出
    status: completed
    dependencies:
      - studio-content
  - id: f2-wiring
    content: 在 GameViewport 接 F2 开关、收回移动并挂载彩蛋层
    status: completed
    dependencies:
      - studio-overlay
  - id: discover-tests
    content: 欢迎条补 F2 提示，并补数据与界面的 bun 测试
    status: completed
    dependencies:
      - f2-wiring
  - id: changelog-check
    content: 补版本工报条目并跑 changelog:check、类型检查与测试
    status: completed
    dependencies:
      - discover-tests
---

## 用户需求

在园区页面里，玩家随时按 **F2** 全屏切换到一屏「VS Code 界面」，按 **Esc** 回到游戏页面。界面只需要做**最简单、最静态**的那一档，不联网、不嵌入外部编辑器。

补充澄清后的边界：

- 园区内**任意位置**都能按 F2，不需要先坐回工位、没有距离判定，属于全局彩蛋。
- 界面打开期间**完全接管键盘**：WASD、E、Z、X、C、空格、回车都不再传给游戏，角色原地不动、不弹聊天、不误触动作；Esc 退出后立即恢复游戏操作。
- 代码区**只读**：界面里展示一段固定的「牛马项目」源码；左侧文件树**可点击切换**，切到别的文件只是换一段只读内容，不能编辑，也不保存。
- 打开时不暂停世界与连接：其他玩家的移动和聊天广播照常，只是本人不移动。
- 触屏端不做入口（没有 F2 键），只在电脑端生效。

## 产品概述

进入园区后按 F2，画面会像「低头看自己工位上的电脑屏幕」一样整个切换成一块深色代码编辑器：左侧资源管理器列着几份牛马项目文件，中间是带行号和语法高亮的只读代码，下面是终端输出，顶部是标题栏与菜单，底部是 VS Code 蓝色状态栏。按 Esc 后瞬间回到像素园区，角色仍站在原来的位置。

## 核心功能

- **F2 全屏进入**：任意位置、任意姿态按下都立即切换到代码界面，界面上没有加载、没有网络请求。
- **仿 VS Code 静态布局**：标题栏（红黄绿灯 + 项目名）、菜单行、左侧活动栏图标、资源管理器文件树、面包屑、页签、行号代码区、右侧 minimap、底部终端面板、底部状态栏（分支、错误数、行列、编码、语言）。
- **文件树点击切换**：点不同文件，代码区内容与页签标题一起变化，只读展示，可选中复制。
- **Esc 一步返回**：按 Esc（或点右上角关闭按钮）收起整层，焦点回到画面，角色位置与姿态不变。
- **键盘不穿透**：界面开着时所有游戏键与浏览器滚动键都被吞掉；打字输入框或取名框正聚焦时按 F2 不会被抢占。
- **发现入口**：入场欢迎条在电脑端补一条 F2 提示，让玩家知道有这个彩蛋。


## 技术栈

沿用仓库现有技术栈，不新增任何依赖：

- Next.js 15 App Router + React 19 + TypeScript 5（strict）
- Tailwind CSS v4（`apps/web/app/globals.css` 的 `@theme` 调色板）+ `lucide-react` 图标
- 本地已声明的字体：`--font-mono`（JetBrains Mono，代码天然合适）、`--font-display`（Oswald）、系统中文栈
- 测试：`bun test lib`（`bun:test` + `renderToStaticMarkup` 做 SSR 结构断言，参考 `lib/game/__tests__/interaction-hint.test.tsx`）
- 类型检查：`pnpm --filter @niuma/web typecheck`（`tsc --noEmit`）

**纯客户端改动**：不碰 `apps/game-server`、`packages/shared-types`、协议与存档，不需要双端发版。

## 实现方案

### 1. 纯数据模块承载「只读代码」

新增 `apps/web/lib/game/code-studio.ts`（纯模块，不写 `'use client'`、不碰 DOM，组件与测试共用）：

- `CODE_STUDIO_FILES`：5–6 个固定文件（如 `README.md`、`src/overtime.ts`、`src/slack-detect.ts`、`src/punch-clock.ts`、`src/boss-hp.ts`、`package.json`），每个含 `id / name / path / language / lines / status`（status 用于文件树右侧的 `M` / `U` 角标，纯装饰）。
- `tokenizeSource(lines, language)`：轻量确定性高亮器（注释 / 字符串 / 关键字 / 数字 / 类型 / 函数名 / 纯文本），在**模块加载时一次性**对全部文件运行，产出 `CodeFile`。运行期切换文件只做数组读取，零解析开销。
- `resolveStudioFile(files, id)`：越界 id 回落到第一个文件，避免状态异常时渲染空屏。
- 终端面板文案（`CODE_STUDIO_TERMINAL`）、状态栏常量也放这里，文案集中一处。

### 2. 受控的全屏界面组件

新增 `apps/web/components/game/CodeStudio.tsx`，props 仅 `{ onClose(): void }`，自身只管「当前选中文件」这一份本地状态：

- 结构自上而下：标题栏（三个圆点 + `niuma-park — Visual Studio Code` + 右上 `Esc 返回园区` 键帽与关闭按钮）→ 菜单行（文件 / 编辑 / 选择 / 查看 / 转到 / 运行 / 终端 / 帮助）→ 主体三栏（活动栏图标 / 资源管理器文件树 / 编辑器：页签 + 面包屑 + 行号代码 + minimap）→ 底部终端面板（问题 / 输出 / 调试控制台 / 终端）→ 状态栏。
- 文件树是原生 `<button>`，点击切换；当前文件高亮，键盘 Tab + Enter/Space 也能切。
- 代码区 `<pre>` + `select-text`，无 `<textarea>`、无 `contentEditable`，彻底只读；行号用独立列，选中复制不会带上行号。
- 整层 `fixed inset-0 z-[120]`（高于现有最高 `z-[110]` 的 `BulletinModal`），背景完全不透明，天然挡住画布、摇杆与 HUD。
- 无障碍：`role="dialog"` + `aria-modal="true"` + `aria-label="代码工位"`、打开时聚焦容器、关闭后 `document.activeElement.blur()` 把焦点还给游戏（与 `GameViewport.closePanels` 同一纪律）。
- 配色是**局部**的 VS Code 色板（`#1E1E1E` / `#252526` / `#333333` / `#007ACC` / `#569CD6` / `#CE9178` / `#4EC9B0` / `#6A9955` / `#D4D4D4`），用任意值类名写在组件内，不改全局 `@theme`——VS Code 的冷灰不能污染园区暖褐调。
- 入场动画：在 `globals.css` 新增 `.animate-code-studio-in` + `@keyframes code-studio-in`（180ms、`var(--ease-out-expo)`、透明度 + 4px 位移 + 0.99 缩放），命名与既有 `animate-board-in` / `animate-bulletin-in` 对齐；全站末尾的 `prefers-reduced-motion` 规则会自动关掉它，无需额外处理。

### 3. 两层 capture 按键路由（关键点，已核对现状）

`apps/web/lib/game/input-keyboard.ts` 的 `KeyboardInput` 监听的是 `window` 的 **bubble** 阶段，且它只判 `event.target` 是否可编辑、不认识界面状态；而 `GAME_KEYS`（`lib/game/game-keys.ts`）里没有 F2，`keyBit('F2')` 为 0、`actionForKey` 也没有映射，所以 F2 当前是空操作，不会和既有按键冲突。

- **打开**：在 `GameViewport` 里挂 `window` capture 的 keydown：
  - 只在 `entering`（已有工牌、真正进了园区）后生效；`event.repeat` 忽略；
  - `isEditableTarget(event.target)` 为真时不抢（聊天输入框、取名框正在打字时按 F2 不该被劫持）——为此把 `input-keyboard.ts` 里的私有 `isEditableTarget` 改为 `export`，行为不变，避免写第二份；
  - 命中后 `preventDefault()` + `stopPropagation()`，再 `clientRef.current?.clearMovement()`（沿用 `openChat` / `openBoard` / `openBulletin` 的同一条纪律：按住 W 时开面板不能继续滑行），顺手收起 `statusOpen` / 牛马榜 / 放假日历 / 他人工牌，再 `setCodeStudioOpen(true)`。
- **打开期间**：组件挂 `window` capture keydown：
  - `Escape` → `onClose()` 并吞键；
  - `Ctrl` / `Meta` / `Alt` 组合键放行给浏览器（与游戏内规则一致，不劫持刷新、地址栏）；
  - `Tab` 放行，焦点在层内循环；
  - 焦点在层内按钮上按 `Enter` / `Space` 时，先 `preventDefault + stopPropagation` 再手动 `click()`，保证「能切文件」而游戏收不到回车（否则会触发背后的 `openChat`）；
  - 其余一律 `preventDefault()` + `stopPropagation()`，停在 window capture 后事件到不了 `KeyboardInput` 的 bubble 监听。
- **关闭**：再次 `clearMovement()`（释放仍按住的掩码），`blur()` 焦点，解绑监听。

状态放在 `GameViewport` 的 `useState` 而不是 `useGameUi`：只有这一个宿主消费，放全局 store 会白白多一份 `reset()` / SSR 首帧默认值要维护的字段。

### 4. 发现入口

`apps/web/components/game/WelcomeBanner.tsx` 桌面端那行键位提示尾部追加 `· F2 写代码`（触屏那行不动，触屏没有 F2）。

### 5. 性能与可靠性

- 高亮只在模块加载时算一次（5–6 个文件、几 KB），切换文件 O(1)；遮罩是纯 CSS/DOM，不进 Pixi、不进 Worker、不产生每帧开销，也不新增任何消息或网络请求。
- 监听器只在「园区内」与「界面打开期间」存在，关闭即解绑，不在帧循环里读状态。
- `select-none` 是 `GameViewport` 根节点继承下来的，层内必须显式 `select-text`，否则代码复制不出来。
- 打开期间 HUD 只是被不透明层盖住，不卸载：往返若干次不会重建 WebSocket 或渲染线程。

## 目录结构

```
apps/web/
├── lib/game/
│   ├── code-studio.ts                  # [NEW] 只读代码内容与高亮器
│   │   · CODE_STUDIO_FILES：固定文件树 + 源码（牛马主题），含 name/path/language/lines
│   │   · tokenizeSource()：一次性产出 CodeToken[]，覆盖注释/字符串/关键字/数字/类型/函数名
│   │   · resolveStudioFile()：未知 id 回落到第一个文件
│   │   · CODE_STUDIO_TERMINAL / 状态栏常量：终端与状态栏文案集中一处
│   ├── input-keyboard.ts               # [MODIFY] 把私有 isEditableTarget 改为 export（无行为变化），供 GameViewport 复用
│   └── __tests__/
│       ├── code-studio.test.ts         # [NEW] 数据完整性：id 唯一、每个文件有行、高亮行数不丢、未知 id 回落
│       └── code-studio-overlay.test.tsx # [NEW] SSR 断言：dialog 语义、文件树全量渲染、只读（无 textarea/contentEditable）、Esc 提示、select-text
├── components/game/
│   ├── CodeStudio.tsx                  # [NEW] 全屏仿 VS Code 只读层：标题栏/菜单/活动栏/资源管理器/页签/行号代码/
│   │   · minimap/终端/状态栏；文件树点击切换；capture 阶段接管键盘（Esc 退出、Tab 内部循环）
│   ├── GameViewport.tsx               # [MODIFY] 新增 codeStudioOpen 本地状态；window capture 监听 F2；
│   │   · 打开前 clearMovement + 收起其它面板；条件渲染 <CodeStudio onClose=… />；关闭后归还焦点
│   └── WelcomeBanner.tsx              # [MODIFY] 桌面端键位提示追加「F2 写代码」
├── app/globals.css                     # [MODIFY] 新增 .animate-code-studio-in 与 @keyframes code-studio-in
└── data/release-notes.json             # [MODIFY] 追加 2026-11-15-1 记录（玩家可感知的 F2 彩蛋说明）
```

## 关键结构

```ts
// apps/web/lib/game/code-studio.ts —— 组件与测试共用的唯一数据契约
export type CodeTone =
  | 'plain' | 'comment' | 'string' | 'keyword'
  | 'number' | 'type' | 'function' | 'muted';

export interface CodeToken { text: string; tone: CodeTone }
export interface CodeFile {
  id: string;
  name: string;          // 文件树与页签显示名
  path: string;          // 面包屑用
  language: string;      // 状态栏与高亮规则
  lines: CodeToken[][];  // 已高亮好的逐行 token
  status?: 'M' | 'U';    // 文件树右侧角标，纯装饰
}
export function resolveStudioFile(files: readonly CodeFile[], id: string): CodeFile;
```

## 实施注意

- 不改 `game-ui.ts` / 不改协议 / 不动 `GAME_KEYS` 内容；F2 不在其中，无需扩表。
- 打开与关闭都要 `clearMovement()`，否则会出现「开着界面角色还在走」或「Esc 后角色自己往前冲」。
- 层内不要出现 `INPUT` / `TEXTAREA` / `contentEditable`：既是需求（只读），也避免 `KeyboardInput` 的可编辑判定与我们的拦截规则打架。
- 文案不写真实文件路径、域名、端口；版本工报沿用现有 `kind: "feat"` 口径。



## 设计风格

**像素园区里的一块真屏幕**：整体 1:1 复刻 VS Code 的信息架构（标题栏、菜单、活动栏、资源管理器、页签、行号代码、minimap、终端、状态栏），但用本仓库的「直角、2px 描边、硬阴影」语汇收边，读起来像游戏里工位显示器被放大，而不是跳出到另一个网站。

## 布局与区块

1. **标题栏与菜单行**：高 36px，三枚红黄绿圆点、项目名 `niuma-park — Visual Studio Code`；右侧 `Esc` 键帽 + 「返回园区」+ 关闭按钮，永远可见，是第一眼就能看到的退出路径。菜单行 8 个文字项，只做视觉，不可展开。
2. **活动栏**：48px 窄条，文件 / 搜索 / 源代码管理 / 运行 / 扩展五个线性图标纵向排布，选中项左侧一道蓝色指示条；底部账户与设置图标。
3. **资源管理器**：240px，标题「资源管理器」带折叠箭头，下面是项目树：文件夹行浅色、文件行可点，悬停整行提亮，选中行深蓝底；右侧 `M` 角标橙色、`U` 绿色。点击时页签、面包屑、代码区同步切换。
4. **编辑器**：页签栏（当前文件浅底、顶部一条蓝线）、面包屑、左侧行号列（灰、右对齐）、代码区（等宽字体、语法高亮、每行 20px）、右侧 60px minimap 用半透明色块模拟代码密度（只装饰，不滚动）。
5. **终端面板**：高约 160px，页签「问题 / 输出 / 调试控制台 / 终端」，终端页签带下划线；内容是几行固定日志（启动园区、老板血量、摸鱼告警），等宽字体、绿与黄着色。
6. **状态栏**：高 24px 的 VS Code 蓝 `#007ACC`，左侧分支 `main*` 与同步图标、错误 0 / 警告 3；右侧 `Ln 12, Col 4`、`Spaces: 2`、`UTF-8`、`LF`、`{} TypeScript`、一个薄荷色呼吸点「牛马在线」。
7. **入场动效**：整层 180ms 从 0.99 缩放 + 4px 上移淡入，像显示器点亮；文件切换只做 120ms 轻微位移，不做弹跳。窄屏（<1100px）隐藏 minimap，<900px 收起资源管理器宽度到 190px，代码区仍可滚动。

## 交互

文件树用原生按钮，鼠标点选与键盘 Tab + Enter 等价；代码可选中复制；Esc、右上关闭按钮都可退出，退出后焦点回到画布，角色不动。全屏遮罩不透明，背后的 HUD、摇杆、小地图全部被盖住，不存在误点。

