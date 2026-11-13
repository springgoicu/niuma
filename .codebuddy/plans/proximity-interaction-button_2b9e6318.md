---
name: proximity-interaction-button
overview: 把所有「靠近设施自动出现」的互动提示改成可点击的按钮：走近椅子、床、马桶、牛马榜、放假告示板、财神供案、茶台、滑梯、自动售货/饮水/咖啡设施时，自动弹出的提示本身就是一个按钮，点击即可完成对应互动，同时保留原有 Z / X / F 键盘快捷键。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素终端 HUD
    - 暖褐墨底 + 冷光薄荷
    - 硬边描边
    - 键帽徽标
    - 克制的微动效
  fontSystem:
    fontFamily: JetBrains Mono / PingFang SC
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 11px
      weight: 600
    body:
      size: 10px
      weight: 400
  colorSystem:
    primary:
      - "#4fe3c1"
      - "#2fb59a"
    background:
      - "#14100c"
      - "#1b1611"
      - "#0f0c09"
    text:
      - "#f4ede1"
      - "#c8b8a2"
      - "#857463"
    functional:
      - "#2e241d"
      - "#f2c879"
todos:
  - id: hint-action-map
    content: 用 [skill:test-driven-development] 在 hint-copy 增加 hintButton 映射表与文案修正，并补齐单测
    status: completed
  - id: interaction-hint-component
    content: 用 [skill:test-driven-development] 新建 InteractionHint 双形态组件、入场动画与静态渲染测试
    status: completed
    dependencies:
      - hint-action-map
  - id: wire-game-viewport
    content: 在 GameViewport 用 InteractionHint 替换旧提示渲染并接上 handleAction
    status: completed
    dependencies:
      - interaction-hint-component
  - id: adr-and-release-notes
    content: 新增 ADR-0067 记录可点提示决策，并在 release-notes 追加玩家可感知版本记录
    status: completed
    dependencies:
      - wire-game-viewport
  - id: verify
    content: 用 [skill:verification-before-completion] 跑 typecheck、test 与 changelog:check 并确认全部通过
    status: completed
    dependencies:
      - adr-and-release-notes
---

## 用户需求
玩家靠近有互动动作的设施时（座椅、马桶、床、牛马榜、放假告示板、财神供案、茶台、滑梯、售货机 / 饮水机 / 咖啡机），屏幕上出现的提示要直接变成可点按钮，点击即完成互动；键盘快捷键与之前完全一致。

## 产品概述
把底部居中的纯文字按键提示升级为「设施互动按钮」：提示出现时自带键帽、动作名与「点击」提示；鼠标点一下或手指轻点一下，等同于按下对应快捷键。不属于互动动作的文案（移动即可起身、滑梯中…、被拦下的劝阻提示、已到达某地）仍保持纯文字，不渲染按钮。

## 核心功能
- 9 类设施的提示变为按钮：坐下（含马桶）、上床躺平、查看牛马榜、查看放假倒计时、互动（售货 / 饮水 / 咖啡）、上香祈福、续杯养生茶、滑滑梯
- 点击即执行：按钮绑定已有的坐下 / 躺平 / 互动动作，不新增任何互动规则或判定条件
- 双端说法：桌面显示键帽 Z / X / F 与「点击」；触屏不显示键帽，右侧显示「轻点」
- 键盘不受影响：Z / X / F 触发时机与结果不变；鼠标点击不抢键盘焦点，也不误触角色点选
- 位置沿用现状：通用提示在底部居中，放假告示板提示仍在右下角，不改为世界里跟着设施飘的浮层
- 出现与消失时机不变：离开感应范围按钮自动消失，提示优先级与出现条件全部保持原样
- 顺手修正放假告示板提示中「查解」为「查看放假倒计时」
- 视觉表现：暖褐底 + 冷光薄荷强调，键帽方块 + 动作名 + 提示语，悬停提亮、按下轻微下压、出现时从下方轻微落定，并尊重系统「减少动态效果」设置


## 技术栈
沿用现有栈，不引入新依赖：Next.js 15（App Router）+ React 19 + TypeScript + Tailwind CSS v4（主题令牌在 `apps/web/app/globals.css` 的 `@theme` 中）+ zustand（`useGameUi`）+ lucide-react（可选图标）+ bun:test 测试。

## 实现方案

### 总体策略
提示仍以**字符串**经既有 `onHint` 通道从 Worker 传到主线程（`hint-copy.ts` → `session.ts` → `worker-host.ts` → `worker-client.ts` → `useGameUi.hint`），协议与 session 判定零改动。新增一层「文案 → 动作」的纯映射，放在 `hint-copy.ts` 这张唯一事实源表里；React 层据此决定渲染按钮还是纯文字，点击复用已有的 `handleAction(action)` → `client.perform(action)`。

### 关键决策
1. **映射表而非字符串解析**：不按正则从「按 Z 坐下」里抠键帽，而是用常量表把每条提示映射到 `action + label + key`，这样文案改字不会破坏点击行为，也能被单元测试穷举覆盖。
2. **只映射真正可执行的提示**：`HINT.seat` / `toilet` → `sit`；`HINT.bed` → `lie`；`board` / `bulletin` / `interact` / `shrine` / `tea` / `slide` → `interact`；`lieOnSeat` / `sitOnBed` / `bedOnly` 三条劝阻文案返回 `null`，保持纯文本。
3. **按钮落在现有 HUD 位**，不做世界空间锚定浮层：Worker 里没有投影能力，主线程没有每帧设施坐标，坐标同步成本远高于收益，需求也未要求。
4. **焦点与误触**：按钮用 `onClick` 触发（保证键盘 Tab/Enter 可达），同时 `onMouseDown` 里 `preventDefault` 阻止鼠标点击抢焦点；HUD 外层继续 `pointer-events-none`，只有按钮本身 `pointer-events-auto`。底层点选角色挂在兄弟节点（`hostRef` 上 `onPointerUp`），不是父级，点击不会穿透。
5. **动画**复用 `globals.css` 的 utilities 模式新增一条 `hint-in`（transform + opacity，180ms `var(--ease-out-expo)`），文件末尾全站 `prefers-reduced-motion` 规则自动兜底。

### 性能与可靠性
- 提示只在**变化时**回调（`updateSeatHint` 内有 `hint === this.seatHint` 去重），按钮渲染是事件驱动的 O(1)，无每帧开销。
- 动画只跑 transform / opacity，不触发布局；用 `key={hint}` 让换设施时重播一次入场，不引入 `requestAnimationFrame` 轮询。
- 状态仍由 Worker 权威，点击只是「代按快捷键」，与键盘走同一条 `perform` 路径，不会出现两套互动逻辑。

## 实现要点
- `hint-copy.ts` 必须保持纯常量模块：只允许 `import type { ActionKey } from './input'`，不引 DOM / React / Pixi。
- 修正 `HINT.bulletin` 的「查解」时，`TOUCH_HINTS`（以 `HINT` 为键）与 `session.ts` 判定（`hint === HINT.bulletin` 的引用比对在 `GameViewport`）自动跟随；`touchHint()` 继续作为**纯文本提示**与 `TouchControls` 的 `title` 投影来源。
- 不改 `updateSeatHint()` 的优先级顺序、`SIT_RANGE`、告示板「64px 内 + 面朝板面」感应规则。
- 无障碍：按钮带 `aria-label`（含动作名）、`aria-keyshortcuts="Z"`、`title`（「点击或按 Z 坐下」）；纯文本分支保留 `role="status"`，不再给按钮套 `role="status"`。
- 视觉令牌直接复用既有类（`border-2`、`bg-ink-900/92`、`mint-400` 强调、`mist-300/500` 文本、`font-mono` 小字），不新建色板。
- 触屏点击后给一记 8ms 震动（`navigator.vibrate?.(8)`），与 `TouchControls` 手感对齐。

## 目录结构

```
apps/web/
├── lib/game/hint-copy.ts                    # [MODIFY] 新增 HintButton 类型与 hintButton() 映射表（9 条互动提示 → sit/lie/interact + label + 键帽），三条劝阻文案返回 null；顺手修正 bulletin 文案为「查看放假倒计时」及其触屏投影
├── lib/game/__tests__/hint-copy.test.ts      # [MODIFY] 追加用例：每条 HINT 的映射覆盖与降级（劝阻文案为 null）、label 与 touchHint 里「」内按钮名一致、键帽与文案中的按键字面量一致
├── components/game/InteractionHint.tsx      # [NEW] 提示组件双形态：可互动提示渲染为按钮（键帽 + 动作名 + 点击/轻点 + 悬停/按下反馈 + animate-hint-in），非互动提示保留原纯文本胶囊；内聚 bulletin 的右下角定位与通用底部居中定位（portrait / isTouch 两套偏移），外层 pointer-events-none、按钮 pointer-events-auto
├── lib/game/__tests__/interaction-hint.test.tsx  # [NEW] 静态渲染测试：可互动提示产出 button、aria-keyshortcuts、点击与轻点文案差异、键帽在触屏下不出现；劝阻文案与「滑梯中…」不产出 button；告示板定位类仍在
├── components/game/GameViewport.tsx         # [MODIFY] 第 722–740 行旧提示块替换为 InteractionHint，传 hint / isTouch / portrait / onAction={handleAction}；导入改为 InteractionHint（HINT 若不再直接使用则从导入中移除）
├── app/globals.css                          # [MODIFY] @layer utilities 追加 .animate-hint-in 与 @keyframes hint-in（下方 6px + 淡入，180ms ease-out-expo）
├── data/release-notes.json                  # [MODIFY] entries 头部追加一条玩家可感知记录（facility 提示可点、双端说法、键盘不变）
docs/adr/
└── 0067-facility-hint-buttons.md            # [NEW] 记录决策：提示可点、文案到动作的映射表归属 hint-copy、落位复用 HUD、劝阻文案不按钮化、键鼠同路径与可访问性约束
```

## 关键结构

```ts
// apps/web/lib/game/hint-copy.ts（仅接口约定）
import type { ActionKey } from './input';

export interface HintButton {
  action: ActionKey;
  /** 按钮上的动作名：「坐下」「使用马桶」「查看牛马榜」… */
  label: string;
  /** 键帽字面量：Z / X / F，同时用于 aria-keyshortcuts */
  key: string;
}

/** 可互动提示返回按钮描述，纯状态 / 劝阻文案返回 null */
export function hintButton(hint: string): HintButton | null;
```

```ts
// apps/web/components/game/InteractionHint.tsx（props 约定）
interface InteractionHintProps {
  hint: string;
  isTouch: boolean;
  portrait: boolean;
  onAction: (action: ActionKey) => void;
}
```


## 设计范围
单个游戏内 HUD 交互控件（设施互动按钮），不新增页面。沿用园区既有终端 / 像素风 HUD：暖褐墨底 + 唯一冷光薄荷强调，方形硬边、2px 描边、微颗粒小字，不使用外部组件库，直接复用 `ink / mint / mist` 主题令牌与 `font-mono` 微文案体系。

## 视觉结构
从左到右：`kbd` 键帽方块（`border-2 border-ink-600 bg-ink-800`，`font-mono` 10px，`text-mist-300`）→ 动作名（`font-mono` 11px、字距 0.12em、`text-mint-400`）→ 分隔细线 → 右侧提示语（桌面「点击」、触屏「轻点」，`font-mono` 9px、`text-mist-500`）。外框 `border-2 border-mint-400/60 bg-ink-900/92 backdrop-blur-sm`，带一层极淡外发光把按钮从满屏像素背景里拎出来。

## 交互与动效
悬停时外框与动作名提亮至 `mint-400`、底色叠 `mint-400/8`；按下轻微下压（`scale-[0.97]`）并配合触屏 8ms 震动；出现时从下方 6px 落定淡入 180ms，用 `ease-out-expo`，换设施时重播一次；`prefers-reduced-motion` 下动画自动归零。纯文本提示保持现状的 2px 描边小胶囊，不做悬停与下压，视觉上明确「不可点」。

## 版式与响应式
桌面：底部居中、与动作条保持 24 间距，按钮高度约 30px；触屏：底部居中收在动作盘上方，高度不低于 40px 保证拇指命中；竖屏继续把告示板提示压在右下角，横屏按现有偏移；文本不换行，超长时截断并保留动作名完整。

## Agent Extensions
### Skill
- **test-driven-development**
  - Purpose: 先为「文案到动作」映射与按钮形态写 bun:test 用例，再落实现，避免映射漏项或双端说法漂移
  - Expected outcome: `hint-copy` 与 `InteractionHint` 两组测试先红后绿，覆盖 9 条可互动提示、3 条劝阻文案与触屏 / 桌面差异
- **verification-before-completion**
  - Purpose: 在声明完成前实跑类型检查、单测与版本记录校验
  - Expected outcome: `pnpm --filter @niuma/web typecheck`、`pnpm --filter @niuma/web test`、`pnpm changelog:check` 全部通过并留痕输出
