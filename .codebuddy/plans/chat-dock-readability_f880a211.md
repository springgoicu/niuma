---
name: chat-dock-readability
overview: 放大并加清晰左下角聊天/弹幕面板的桌面端排版与配色：输入框、消息列表、工具栏、标题栏的小字号统一上调，面板底不透明度 65%→85% 左右并降一档模糊；移动端 compact 版维持现状。改动落在 ChatDock / ChatInput / ChatLog / DanmakuHUD 四个组件，并按项目约定补 ADR-0058 与版本工报。
design:
  architecture:
    framework: react
  styleKeywords:
    - 暖墨底像素风
    - 硬边框方角
    - 提高信噪比的可读性
    - 克制的玻璃质感
  fontSystem:
    fontFamily: PingFang SC / JetBrains Mono
    heading:
      size: 11px
      weight: 600
    subheading:
      size: 13px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
    background:
      - "#14100C"
      - "#0F0C09"
      - "#221B16"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#A2917A"
    functional:
      - "#F2C879"
      - "#E06A5A"
      - "#CFE08A"
todos:
  - id: chat-dock-shell
    content: 调整 ChatDock 桌面面板：lg 380px、底色 88% + blur-sm，标题栏字号 11/10px
    status: completed
  - id: chat-input-scale
    content: ChatInput 增加 compact 分支，输入框 14px/44px 去等宽字体，发送键 44px
    status: completed
    dependencies:
      - chat-dock-shell
  - id: chat-log-scale
    content: ChatLog 桌面档正文 13px、昵称 11px、时间与分隔线 10px，列表上限 360px
    status: completed
    dependencies:
      - chat-dock-shell
  - id: danmaku-hud-scale
    content: DanmakuHUD 增加 compact 分支：齿轮 36px、浮层 248px、文案 10/11px
    status: completed
    dependencies:
      - chat-dock-shell
  - id: visual-audit
    content: 用 [skill:impeccable] 校验对比度与命中区域，回归 1024/1280/390 三档并跑 typecheck
    status: completed
    dependencies:
      - chat-input-scale
      - chat-log-scale
      - danmaku-hud-scale
  - id: adr-changelog
    content: 用 [skill:principal-software-architect] 写 ADR-0058，追加 2026-11-12-3 工报并跑 changelog:check
    status: completed
    dependencies:
      - visual-audit
---

## 用户需求
网页端左下角「发送弹幕」的聊天框显示不清、有明显马赛克感，希望放大字号并优化可读性。

## 已确认边界
- 范围：整块聊天面板一起优化（输入框 + 消息列表 + 工具栏 + 标题栏的 9px 小字同步上调）。
- 背景：提高面板底不透明度（65% → 约 88%），模糊降一档，保留玻璃感但仍透出画面。
- 平台：只改桌面端；手机端 compact 窄版维持现状，字号与尺寸按分支隔离。

## 核心功能与视觉结果
- 发送输入框：11px → 14px，输入区高度约 44px，发送按钮 36px → 44px，中文改用与消息正文一致的无衬线字体（不再落到等宽字体的中文回退字形）。
- 工具栏：颜色色块、飞行模式、快捷词条从 9px 提到 10px，点击区域同步放大。
- 消息列表：正文 12px → 13px，昵称 11px，时间戳、分隔线、加载提示 10px，桌面列表高度上限适当放宽。
- 标题栏与设置：频道标题 11px、计数 10px、齿轮按钮 36px，弹幕设置浮层文案 10/11px。
- 面板：桌面宽度 340px → 380px（lg 及以上），底色更实、模糊更轻，像素画噪点不再透字，整体仍是暖墨底 + 硬边框的像素风。
- 不改变任何交互语义：发送、回车、Esc、输入法守卫、未读、历史分页、弹幕偏好全部保持原行为。

## 技术栈
- Next.js 15 + React 19 + TypeScript（现有应用，不新增依赖）
- Tailwind CSS v4 工具类（`@theme` 定义 ink/mist/mint 色板与 font-mono/font-sans）
- lucide-react 图标、zustand 状态（本次不触碰）

## 实现方案
### 核心策略
只在 `ChatDock` / `ChatInput` / `ChatLog` / `DanmakuHUD` 四个组件内部的 className 上做「桌面档 / compact 档」双档尺寸，默认档即桌面档；不改布局结构、不改状态流转、不引入全局字号变量或设置项（用户已排除「字号设置」方案，YAGNI）。

- 是否 compact 由 `ChatDock` 的既有 `compact` prop 统一下传：`ChatInput` 与 `DanmakuHUD` 各新增可选 `compact?: boolean`，二者当前只被 `ChatDock` 引用（已确认无其它调用方），影响面完全封闭。
- 每处尺寸用局部常量集中两档字符串（如 `const inputSkin = compact ? '...' : '...'`），避免同一行出现 4 个三元影响可读性。

### 关键决定与理由
1. **输入框去 `font-mono`**：JetBrains Mono 无中文字形，中文会落到浏览器 monospace 回退字体，小字号下中英混排极易发虚，这正是「马赛克感」的一部分；消息正文本来就是 body 的 `--font-sans`，草稿与正文同字体还能做到所见即所得。计数、时间、标签仍保留 `font-mono`。
2. **背景改 `bg-ink-900/88` + `backdrop-blur-sm`**：像素风画面本身是高对比小色块，12px 模糊会把噪点抹成斑块，透字即显脏。提高不透明度并把模糊降到 4px，画面仍可感知但不干扰文字；同时降低 `backdrop-filter` 采样成本（纯降本，无性能新增）。
3. **宽度分断点**：`w-[340px] lg:w-[380px]`。桌面底栏是「ChatDock + 居中 ActionBar + MiniMap」的 `justify-between`，MiniMap 仅在 lg 出现；md 区间保持 340px，避免把可换行的 ActionBar 挤成三行。
4. **移动端不放大**：所有新增尺寸都写在 `compact === false` 分支，移动端输出与当前完全一致的类名，`ChatLog` 的 `max-h-[min(38dvh,220px)]`、发送后收键盘（`blurOnSend`）均不动（ADR-0033）。

### 具体尺寸（桌面档）
| 位置 | 现状 | 目标 |
|---|---|---|
| 面板底 / 模糊 | `bg-ink-900/65 backdrop-blur-md` | `bg-ink-900/88 backdrop-blur-sm` |
| 面板宽 | `w-[340px]` | `w-[340px] lg:w-[380px]` |
| 标题 / 计数 / 未读 | 10px / 9px / 9px | 11px / 10px / 10px |
| 输入框 | `text-[11px] px-2.5 py-1.5 font-mono` | `text-[14px] leading-6 px-3 py-2`（总高 44px，无 `font-mono`） |
| 发送按钮 / 图标 | `h-9 w-9` / `h-3.5` | `h-11 w-11` / `h-4 w-4` |
| 色块按钮 / 色块 | `h-5 w-5` / `h-4 w-4` | `h-6 w-6` / `h-5 w-5`，间距 `gap-1` |
| 模式键 / 快捷词条 | 9px | 10px，`px-2 py-1.5` |
| 提示条 / 字数 | 9px | 10px |
| 消息正文 / 昵称 / 时间 | 12px / 10px / 9px | 13px / 11px / 10px |
| 系统消息 / 分隔线 / 加载 | 10px / 9px / 9px | 11px / 10px / 10px |
| 列表高度上限 | `min(46dvh,340px)` | `min(48dvh,360px)` |
| 齿轮按钮 / 浮层宽 | `h-7 w-7` / `w-[220px]` | `h-9 w-9` / `w-[248px]`，文案 10/11px |

颜色不改（`mist-400` 在 ink-900 上 6.2:1 已达标），只靠字号与底色解决可读性，避免牵动全站色板。

## 实现注意事项
- 命中区域：输入框 44px、发送键 44px 与现有 HUD 的 `h-9` 按钮保持同一手感，不引入更大的 48px 破坏栅格。
- 不改 `ChatLog` 的贴底、历史前插锚定逻辑（ADR-0041/0047），只动 className。
- 不改 `GameViewport`；桌面与移动两处 `ChatDock` 调用保持原样（移动端已传 `compact`）。
- 中文提示文案、`maxLength=160`、占位文案格式不动。
- 校验：`pnpm --filter @niuma/web typecheck`；组件无单测，样式改动以「1280 / 1440 / 1024 三档宽度 + 390 × 844 移动模拟」人工回归代替，重点看窄窗口底栏是否溢出、移动端是否零变化。
- 文档：新增 ADR 声明对 ADR-0041 第 4 节（65% 玻璃）的部分取代，历史 ADR 原文不改；提交前按 AGENTS.md 追加版本工报并运行 `pnpm changelog:check`。

## 目录结构
```
niuma/
├── apps/web/components/game/
│   ├── ChatDock.tsx      # [MODIFY] 面板底与宽度分档（/88 + blur-sm、lg 380px）；标题栏、未读、计数、折叠态提示字号上调；向 ChatInput / DanmakuHUD 下传 compact
│   ├── ChatInput.tsx     # [MODIFY] 新增可选 compact prop；输入框 14px/44px 且去 font-mono、发送键 44px、色块与模式键、快捷词条、提示与字数按桌面档放大
│   ├── ChatLog.tsx       # [MODIFY] 桌面档正文 13px、昵称 11px、时间/分隔线/加载 10px、系统消息 11px、空态 12/11px、列表上限 min(48dvh,360px)；滚动与分页逻辑不动
│   └── DanmakuHUD.tsx    # [MODIFY] 新增可选 compact prop；齿轮 36px、浮层 248px、内部文案 10/11px、覆盖区域按钮 py-2
├── docs/adr/
│   └── 0058-chat-dock-readability.md  # [NEW] 记录「面板可读性优先于透视感」的决策：背景不透明度、桌面字号阶梯、输入框改用正文无衬线、移动端不跟随；含备选方案与回滚方式
└── apps/web/data/release-notes.json   # [MODIFY] 追加 id 2026-11-12-3 的玩家可感知记录（聊天框字更大更清楚、桌面面板更实）
```


## 设计方向
沿用现有「暖墨底 + 硬边框 + 像素风」的园区气质，只做可读性加档：字号整体上移一档、面板底更实、模糊更轻。不引入圆角、卡片阴影或通用 SaaS 观感。

## 桌面排版
- 面板：380px 宽（lg+），2px 硬边框不变，底色 88% 墨黑 + 4px 模糊，画面仍隐约透出。
- 标题栏：频道名 11px 等宽大写，未读徽标 10px 实心薄荷底，齿轮 36px 方形按钮，右侧留白 `pr-2`。
- 输入区：44px 高输入框，14px 无衬线正文，颜色预览直接体现在文字与占位文案上；发送键 44px 薄荷描边，悬停反色。
- 工具栏：颜色色块 20px（选中外环 + 放大）、模式键与快捷词条 10px，单行横向滚动不折行。
- 消息列表：正文 13px、昵称 11px 等宽大写、时间 10px，行距 `leading-relaxed`，条目间距 10px。

## 交互与动效
保留现有 100–200ms 的 `ease-out` 过渡：色块缩放、折叠箭头旋转、发送键反色。不新增弹跳或弹性缓动，不做整块缩放动画，避免干扰正在进行的游戏操作。

## 响应式
- ≥1024px：380px 面板 + 居中动作条 + 小地图三栏共存。
- 768–1023px：回落到 340px，保证动作条不被挤成多行。
- <768px（触屏 compact）：类名与当前完全一致，尺寸零变化。

## 可访问性
输入框与发送键 44px 命中区域；正文对比度沿用 mist-100 在 88% 墨底上的表现；未读仍同时用视觉徽标与 `sr-only` 文案双通道表达。


## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 在改动落地后对聊天面板执行 polish / audit，检查字号阶梯、命中区域、对比度与响应式回归，避免只放大字号却引入新的视觉失衡。
  - Expected outcome: 输出一份关于对比度、点击目标与窄窗口表现的检查结论，并修掉遗留问题（如过渡过大、层级不清、移动端被误改）。
- **principal-software-architect**
  - Purpose: 按项目 ADR 规范撰写 ADR-0058，明确「可读性优先于透视感」的权衡、备选方案与反向成本，并说明对 ADR-0041 第 4 节的部分取代关系。
  - Expected outcome: 一篇结构化 ADR（背景 / 问题 / 决策 / 备选与反向成本 / 后果 / 回滚 / 复核信号），与历史 ADR 不冲突且可直接落库。
