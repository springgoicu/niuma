---
name: mobile-hint-copy
overview: 把园区里的按键型提示（按 Z 坐下 / 按 X 上床躺平 / 按 F 互动等）在触屏端换成按钮名说法（点「坐下」等），桌面端文案保持不变；只改提示文案，不做可点击提示条。
todos:
  - id: hint-copy-table
    content: 新增 hint-copy 文案表与 touchHint，并补触屏文案单测
    status: completed
  - id: engine-copy-refs
    content: session.ts 与 actions.ts 引用 HINT 常量，桌面文案保持原样
    status: completed
    dependencies:
      - hint-copy-table
  - id: viewport-touch-copy
    content: GameViewport 渲染触屏映射文案，TouchControls 标题兜底；Use [skill:impeccable] 校对文案与按钮标签一致
    status: completed
    dependencies:
      - hint-copy-table
  - id: verify-web
    content: Use [skill:verification-before-completion] 运行 web 类型检查、bun 测试与手机视口自测
    status: completed
    dependencies:
      - engine-copy-refs
      - viewport-touch-copy
  - id: release-note
    content: 追加版本工报 2026-11-12-2 并运行 pnpm changelog:check
    status: completed
    dependencies:
      - viewport-touch-copy
---

## 产品概述
「牛马园」是一座像素办公园区：桌面端用键盘移动和操作，手机端用左下摇杆与右下动作盘。目前靠近工位、床位、公告栏时，提示仍沿用键盘说法，触屏用户照做会找不到 Z / X / F 键。本次把手机端提示改成「点『按钮名』」的说法，桌面端保持不变。

## 核心功能
- 手机端站在空工位旁：提示「点『坐下』」；马桶旁：「点『坐下』使用马桶」
- 手机端站在空床旁：提示「点『躺平』」
- 手机端在公告栏旁：「点『互动』查看牛马榜」；在售货机 / 饮水机 / 咖啡机旁：「点『互动』」
- 手机端被拦下的提示同步改写：座位上点躺平 →「座位上不能躺，先点『起身』」；床上点坐下 →「床上只能躺，点『起身』」；床边点坐下 →「床上只能躺，点『躺平』」
- 桌面端继续显示「按 Z 坐下」「按 X 上床躺平」「按 F 互动」等按键提示
- 提示条保持只读，不拦截操作；位置、字号、颜色、出现与消失时机、横竖屏布局均不变
- 文案只说按钮名，不带「右下」等方位描述


## 技术栈
- 前端：Next.js 15 + React 19 + TypeScript + Tailwind CSS 4（沿用现状）
- 状态：zustand（`useGameUi`）
- 引擎：Pixi，`GameSession` 跑在 Worker（`?render=main` 时回退主线程）
- 测试：bun:test（`apps/web` 的 `bun test lib`）

## 实现策略
新增纯常量模块 `apps/web/lib/game/hint-copy.ts`，把 8 条带按键的提示集中成「桌面原文 → 触屏说法」一张表。引擎侧（`session.ts`、`actions.ts`）只引用桌面原文常量，字符串值保持字节不变；触屏说法只在 React 渲染层（`GameViewport`）投影。因此不改 `GameSessionOptions`、不改 Worker `init` / `hint` 消息、不改主线程回退实现。

设备判定留在视图层：复用现有 `useIsTouch()`（任意粗指针即为触屏，与摇杆 / 动作盘同一条 ADR-0032 判定），混合设备（触屏 + 鼠标）看到的文案与实际显示的动作盘一致。

## 关键决策与取舍
1. **文案表 vs 引擎内分支**：引擎分支方案需要把触屏标记穿过 `GameClientOptions` → `worker-protocol` → `worker-host` → `GameSession`，并同步改主线程回退，跨 6 个文件与跨线程协议；文案表方案只新增一个纯模块，回滚只需撤掉一处映射。
2. **用桌面原文当查表键**：同一模块导出的常量既是引擎的唯一事实源，也是映射键，避免两条文案各自漂移；`Record<HintCopy, string>` 让 TypeScript 在编译期强制每条原文都有触屏说法。
3. **未命中映射原样透传**：`已到达食堂`、`说得太快`、`附近没有可互动的设施` 等无按键提示不受影响,不用正则做通用替换。
4. **不新增 ADR**：纯呈现层文案，不改变模块边界、数据契约与线程协议。

## 性能与可靠性
- 查表 O(1)；提示最多约 6.7 次/秒（150ms 扫描）且仅在文案变化时更新 store，渲染层每次重渲染多一次对象读取，可忽略。
- 不新增网络、存储或线程消息；不动提示条的 1.6s 保留窗口与 150ms 扫描逻辑。
- 桌面路径零改动，`actions.test.ts` 中 `intent.hint` 包含 `按 X` 的断言继续成立。

## 实现注意事项
- `apps/web/lib/game/__tests__/actions.test.ts` 依赖桌面原文，禁止改桌面字符串（含标点）。
- 触屏文案必须引用动作盘真实标签：`坐下` / `躺平` / `互动`；`起身` 来自 `actionPresentation` 的激活态 label，两处保持一致。
- `hint-copy.ts` 不写 `'use client'`、不引用 DOM，保证 Worker 与 React 两侧都能导入。
- 不改动 `WelcomeBanner`（已有 compact 文案）、`ActionBar`（桌面专用，带 `[Z]` 键帽）与提示条样式。
- 提交前按 AGENTS.md 追加版本工报并跑 `pnpm changelog:check`。

## 目录结构
```
apps/web/
├── lib/game/
│   ├── hint-copy.ts                     # [NEW] 带按键提示的唯一事实源：HINT 常量、HintCopy 类型、触屏映射表与 touchHint()。纯常量模块，无副作用。
│   ├── session.ts                       # [MODIFY] updateSeatHint() 的 4 条环境提示改用 HINT.seat / toilet / bed / board / interact，字符串值不变；不感知设备。
│   ├── actions.ts                       # [MODIFY] HINT_LIE_ON_SEAT / HINT_SIT_ON_BED / HINT_BED_ONLY 改为引用 HINT.lieOnSeat / sitOnBed / bedOnly，blocked 意图与按钮 reason 共用同一份文案。
│   └── __tests__/
│       └── hint-copy.test.ts            # [NEW] 断言每条带按键提示都有触屏说法、说法里不再出现「按 」、引用的按钮名在允许集合内、无按键文本原样透传。
├── components/game/
│   ├── GameViewport.tsx                 # [MODIFY] 提示条渲染改为 isTouch ? touchHint(hint) : hint；其余布局、定位、role="status" 不动。
│   └── TouchControls.tsx                # [MODIFY] 动作按钮 title 用 touchHint(view.reason) 兜底，混合设备悬停时不再显示键盘说法。
└── data/
    └── release-notes.json               # [MODIFY] 追加 2026-11-12-2 版本工报记录（面向玩家的提示语言变化）。

不改动：worker-protocol.ts、worker-client.ts、worker-host.ts、main-thread-client.ts、game-client.ts、game-ui.ts、ActionBar.tsx、WelcomeBanner.tsx。
```

## 关键代码结构
```ts
/** 带按键的提示：桌面原文是引擎唯一事实源，触屏说法以它为键 */
export const HINT = {
  seat: '按 Z 坐下',
  toilet: '按 Z 使用马桶',
  bed: '按 X 上床躺平',
  board: '按 F 查看牛马榜',
  interact: '按 F 互动',
  lieOnSeat: '座位上不能躺，先按 Z 起身',
  sitOnBed: '床上只能躺，按 X 起身',
  bedOnly: '床上只能躺，按 X 上床',
} as const;

export type HintCopy = (typeof HINT)[keyof typeof HINT];

/** 触屏把「按 X」换成动作盘按钮名；无按键的提示原样返回 */
export function touchHint(hint: string): string;
```


## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 校对触屏提示的 UX 文案，确认只用按钮名、语气与动作盘标签一致、没有残留键盘说法。
  - Expected outcome: 8 条触屏提示全部为「点『…』」句式，按钮名与触屏动作盘实际标签逐条对齐，桌面文案未受影响。
- **verification-before-completion**
  - Purpose: 在宣称完成前用真实命令校验改动，而不是凭推断。
  - Expected outcome: 给出 `pnpm --filter @niuma/web run typecheck`、`pnpm --filter @niuma/web run test`、`pnpm changelog:check` 的实际通过结果。
