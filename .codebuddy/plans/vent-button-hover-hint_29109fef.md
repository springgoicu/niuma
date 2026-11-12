---
name: vent-button-hover-hint
overview: 给桌面动作条的「发泄 [E]」按钮添加悬停提示「走到同事面前按 E 即可击倒」，用纯 CSS hover tooltip 实现，样式对齐现有 HUD（ink/mint/font-mono），不影响现有降级 title 提示。
todos:
  - id: load-impeccable
    content: 使用 [skill:impeccable] 加载 UI 技能，按 polish 流程确认悬浮提示的样式细节与反模式自检
    status: completed
  - id: vent-tip-impl
    content: 在 ActionBar.tsx 为发泄按钮加 tip 字段并实现纯 CSS 悬浮提示「走到同事面前按 E 即可击倒」
    status: completed
    dependencies:
      - load-impeccable
  - id: verify-checks
    content: 运行 pnpm typecheck 验证类型，并复查 hover 显隐、无指针遮挡与无障碍属性
    status: completed
    dependencies:
      - vent-tip-impl
---

## User Requirements
- 鼠标悬停在桌面动作条的「发泄 [E]」按钮上时，显示提示文案「走到同事面前按 E 即可击倒」（文案取用户原话，键位书写沿用项目惯例「按 Z 坐下 / 按 F 互动」式空格写法）
- 鼠标移开后提示消失，不影响按钮点击与现有交互

## Product Overview
牛马游戏桌面端动作条（ActionBar）中的发泄按钮增加悬停教学提示，让新玩家在把鼠标移到「发泄」按钮上时立即明白：需要走近同事再按 E 才能击倒对方。

## Core Features
- 「发泄 [E]」按钮 hover 时向上弹出提示气泡「走到同事面前按 E 即可击倒」（动作条贴屏幕底部，气泡向上弹）
- 气泡样式对齐现有 HUD 视觉语言（ink 深底、mint 描边、font-mono 小字）
- 鼠标移开即隐藏；气泡不拦截指针、不撑破动作条布局
- 其它按钮、触屏动作盘（TouchControls）行为完全不变；现有降级原因 `title` 提示保持不变

## Tech Stack
- 现有项目：`apps/web` 为 Next.js + React + TypeScript + Tailwind CSS（自定义 ink/mint/mist 色板）
- 零新增依赖：纯 CSS `group-hover` 实现悬浮提示

## Implementation Approach
- 在 `apps/web/components/game/ActionBar.tsx` 的 `ACTIONS` 静态配置数组中，为 vent 项新增可选 `tip?: string` 字段承载提示文案，数组类型签名同步补充 `tip?: string`
- 按钮根元素已有 `group` class：tooltip 用按钮内绝对定位子元素 + `group-hover:opacity-100` 纯 CSS 显隐，无 JS state、无重渲染，运行时零开销
- 按钮 root 补 `relative`；气泡用 `absolute bottom-full left-1/2 -translate-x-1/2 z-10 pointer-events-none whitespace-nowrap` 向上弹出且不挡指针
- 气泡样式对齐 HUD：`bg-ink-900/95`、`border border-mint-400/60`、`font-mono text-[10px] text-mist-300`，加 `transition-opacity duration-150` 微动效
- 保留现有 `title={view?.reason}`：vent 在 `actionPresentation` 中永不降级（`apps/web/lib/game/actions.ts`），两者无冲突
- 取舍说明：原生 `title` 属性约 1s 延迟才显示且样式不可控，易被忽略；自定义气泡即时显示、风格统一，故选自定义实现。项目尚无 Tooltip 组件，本次按 KISS 内联在 vent 按钮内，不为单处需求抽公共组件（YAGNI）；未来多个按钮需要提示时再抽 `Tip` 子组件

## Implementation Notes
- 提示文案是纯展示层信息，不改 `actions.ts` 的交互裁决逻辑（SoC，避免 UI 文案渗入裁决层）
- 不改 `TouchControls.tsx`：触屏无 hover 概念，超出用户需求范围（改动范围控制）
- 无障碍增强：气泡加 `role="tooltip"`，按钮加 `aria-describedby`；可按 impeccable 检查结果补 `group-focus-visible` 让键盘焦点同样可见

## Architecture Design
- 单文件、单组件内部改动：`ActionBar.tsx`（ACTIONS 配置 → map 渲染按钮的既有结构不变）
- 数据流不变：ACTIONS 静态配置 + `actionPresentation` 状态 → 按钮渲染；`tip` 仅是展示层新增可选字段，不进入交互意图链路

## Directory Structure
```
apps/web/
└── components/game/
    └── ActionBar.tsx  # [MODIFY] ACTIONS 数组类型与 vent 项新增 tip 字段；按钮内新增纯 CSS 悬浮提示气泡（relative 定位、group-hover 显隐）
```

## Verification
- `pnpm typecheck`（turbo run typecheck）确认类型通过
- 手动验证：hover 气泡即时出现、移开消失、不遮挡点击、动作条布局无跳动

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按用户 UI 规则，动手改 UI 前加载该技能并走 polish 流程，对小改动做反模式自检（字体/配色/间距/显隐动效）
  - Expected outcome: 气泡提示样式符合项目 HUD 视觉语言与 impeccable 质量要求，检测无 primary findings
