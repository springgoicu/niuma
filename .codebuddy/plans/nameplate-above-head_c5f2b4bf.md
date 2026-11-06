---
name: nameplate-above-head
overview: 把角色昵称从脚底上方 3 纹素挪到头顶外侧，并把聊天气泡改为叠在昵称上方、留固定间距，使两者都不再压住人物立绘；名字样式保持不变，坐/躺姿态仍按站立头顶高度定位。
todos:
  - id: nameplate-geometry
    content: 新增 nameplate.ts 几何模块与 bun:test 单测，锁定头顶解析与间距公式
    status: completed
  - id: renderer-nameplate
    content: 改造 renderer EntityView：昵称贴头顶、气泡叠在名字上方、换装即时重排
    status: completed
    dependencies:
      - nameplate-geometry
  - id: verify-build-tests
    content: 用 [skill:verification-before-completion] 运行 pnpm typecheck 与 pnpm test 验证
    status: completed
    dependencies:
      - renderer-nameplate
  - id: visual-acceptance
    content: 用 [skill:impeccable] 目视验收戴帽/发型/角、坐躺、长消息与多人同屏的间距与遮挡
    status: completed
    dependencies:
      - renderer-nameplate
---

## Product Overview
这是一款多人在线像素牧场小游戏：每个角色头顶显示昵称，发言时在角色旁弹出聊天气泡。当前昵称底边只离脚底 3 纹素、气泡底边只离脚底 10 纹素，正好压在角色腿部和躯干上，且两者本身也相互重叠。

## Core Features
- **昵称移到头顶外侧上方**：以角色站立时的头顶高度为基准，向上留出固定间隙，任何朝向都不与身体、牛角、马鬃、发型、帽子重叠。
- **聊天气泡叠在昵称正上方**：气泡底边与昵称文字上沿保持固定间隙，形成"头顶 → 昵称 → 气泡"的清晰层级，两者永不重叠、也不压住人物。
- **样式保持不变**：沿用现有暖白文字 + 深褐描边的昵称外观，本次只调整位置与间距。
- **坐/躺不跟随**：昵称始终按站立头顶定位，人物坐下或躺下时昵称维持不动，避免姿态切换时上下跳动。
- **换装即时生效**：角色更换帽子、发型、角时，昵称与气泡立即重新避让到新的头顶高度，不需要重新入场。
- **多人与长消息稳定**：同屏多个角色、多次发言、长消息自动换行到多行时，气泡仍完整位于昵称上方，不向人物方向回落；新人入场、断线重连、窗口缩放后位置保持一致。

## 验收标准
- 任意物种、任意朝向、戴帽/戴发型/带角/光头，昵称与气泡都不与角色立绘重叠。
- 昵称与气泡之间有明显可见间隙，气泡不会盖住昵称。
- 坐、躺、叫唤动作期间，昵称位置稳定，不出现遮挡或抖动。
- 连续发送长消息时，气泡向上堆叠，始终不压住人物与昵称。

## 技术栈
- 现有栈：Next.js（`apps/web`）+ Pixi.js v8 渲染 + TypeScript strict + `@niuma/shared-types` 共享类型。
- 测试：仓库已有 `bun:test` 的渲染纯模块单测（`autotile` / `decals` / `pony-motion`），本次沿用同一模式。
- **不新增依赖**，不改图集生成器 `packages/pixel-assets/scripts/generate.ts`，不重跑 `pnpm assets`（客户端已可读到 `manifest.cosmeticAnchors`）。

## 实现方案
把"角色上方多远"的唯一真相从错误的帧底余量推导，改为 `manifest.cosmeticAnchors` 中已经产出、且相对脚底原点的 `head` 锚点；再按外观叠加安全余量，最后把气泡挂在昵称上沿。

### 关键决策与取舍
1. **头顶基线来自 manifest，而不是常量**：`cosmeticAnchors[species][direction]["0"].head[1]` 就是站立头顶相对脚底的 y（牛 -46 / -47，马 -47 / -48）。只取 idle 列，天然满足"坐躺不跟随"的决策。
2. **余量按外观分档**：裸头 1 纹素；有角/鬃 6 纹素（实测角尖高出头顶约 4.8）；有发型 6 纹素（最高约 5）；有帽子 10 纹素（礼帽/安全帽顶约高出 9）。用少量档位而不是逐件测量美术像素，避免与美术常量强耦合；未知外观走最保守档。
3. **描边算进间距**：昵称 stroke 宽 4，向外各溢出 2 纹素，必须计入文字上沿，否则描边仍会压到头顶。`NAME_STROKE_WIDTH` 由新模块导出，`NAME_STYLE` 引用，保证样式与间距同源。
4. **气泡只做"贴名字上沿"的局部坐标计算**：不引入屏幕空间钳制、不改 labels 层的独立渲染（昵称仍需永不被树冠遮挡）。若后续出现小屏顶边裁切，再单独做屏幕空间夹取。
5. **纯函数独立成模块**：渲染器依赖 pixi，无法直接单测；把几何计算抽到无渲染依赖的 `nameplate.ts`，用 `bun:test` 锁住"昵称必须在头顶之上"这条回归线。

### 性能与可靠性
- 计算是 O(1)：每物种最多 4 次锚点查找，只在实体创建与换装时执行；帧循环零新增开销。
- 气泡重排只记录上次测量的气泡高度，不在 `tick` 里重新测量文本。
- 锚点缺失（旧版 manifest）时回退到站立头顶近似值，避免昵称退回脚底。

## 实施要点
- 删除 `renderer.ts` 顶部的 `HEAD_ROOM` / `LABEL_OFFSET_Y` / `BUBBLE_OFFSET_Y`，避免新旧两套坐标并存。
- `EntityView` 已接收 `atlas`，把它存为字段，用于按物种解析头顶；`setAppearance` 除更新本体外观外，还要重算昵称基线并重排可见气泡。
- `showBubble` 中气泡位置改为"昵称上沿 - 描边余量 - 气泡间隙 - 气泡高度"，并把本次高度记录下来供换装时重排。
- 保留 `labels` 容器独立于 y 排序层，昵称与气泡始终浮在最上层。
- 不改动现有内容保护与性能策略：`MAX_CHAT_LENGTH 80`、`MAX_LINES 3`、`BUBBLE_UPDATE_THROTTLE 300`、`FADE_DURATION 400`、`MAX_VISIBLE_BUBBLES 10`。
- DPR 变化只重建文字位图，昵称局部坐标不变，无需额外重排。

## 关键结构
```ts
// apps/web/lib/game/nameplate.ts
export const NAME_STROKE_WIDTH = 4;
export function headTopYOf(manifest: AnchorSource, species: string): number;
export function nameBaselineY(headTopY: number, appearance: CharacterAppearance): number;
export function bubbleTopY(labelBaselineY: number, labelHeight: number, bubbleHeight: number): number;
```

## 目录结构
```
apps/web/lib/game/
├── nameplate.ts                 # [NEW] 昵称/气泡几何：头顶解析、外观余量分档、气泡堆叠公式、描边宽度常量。无 pixi 依赖，纯函数，可单测。
├── renderer.ts                  # [MODIFY] 删除错误的 HEAD_ROOM 推导；EntityView 构造时按头顶定位昵称；showBubble 把气泡叠到昵称上方并记录高度；setAppearance 重算基线并重排可见气泡；NAME_STYLE 的 stroke 宽度改为引用常量。
└── __tests__/
    └── nameplate.test.ts        # [NEW] bun:test 覆盖：锚点解析与缺失回退、裸头/角/发型/帽子四种余量顺序、气泡底边严格高于昵称上沿、牛裸头基线必须高于头顶（防止退回 -3 的回归）。
```

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 对改造后的头顶昵称与聊天气泡做视觉验收，检查间距、层级、对比度与遮挡关系，确认"头顶 → 昵称 → 气泡"读起来清晰且不显得漂浮。
  - Expected outcome: 给出可执行的间距/层级调整结论，确认无重叠与视觉回归。
- **verification-before-completion**
  - Purpose: 在声明完成前，用真实命令输出（`pnpm typecheck`、`pnpm test`）验证类型与单测通过。
  - Expected outcome: 提供类型检查与测试的实际结果证据，而非主观判断。
