# ADR-0033：手机摇杆改成「行程即满力」，聊天改浮层并避让输入法

- 状态：已采纳
- 日期：2026-11-11
- 关联：细化 ADR-0022（紧凑世界与视野）、ADR-0023（动作与叫唤）；
  沿用现有 HUD 的墨底 / 薄荷冷光 / 2px 硬边语言，不换肤

## 背景

两条线上反馈：

1. **「手机端走路感觉速度不一样，斜着走的时候和左右走」**；
2. 手机横屏下摇杆、动作盘与聊天输入互相抢空间。

## 问题

### 1. 摇杆的行程与视觉对不上，斜向与直行的手感不一致

旧实现从 DOM 反推半径：`radius = Math.max(rect.width, rect.height) / 2`，124px 基座 → 62。
视觉上唯一的范围提示是 30px 内缩的虚线环（半径 32）。玩家把拇指推到虚线环边缘时实际只用了 52% 的行程；
斜向去够对角时拇指往往推得更远，力度更大——于是「斜着走比左右走快」。
数学上输出是圆对称的（`hypot` 钳制 + 死区重标定），错的是**视觉半径与逻辑半径不是同一个数**，
再加上方形基座的一次 `getBoundingClientRect()` 与每帧 `setState`，低端机上还会抖。

### 2. 动作盘有空洞、打字键在最容易误触的位置

`grid-cols-3` 放 7 个按钮，最后一格是空的，整体 190×190，占横屏 390px 高度的 52%。
「打字」落在左下第一列，紧邻摇杆热区，是全盘误触率最高的位置。

### 3. 聊天面板把底部操作区顶出屏幕

HUD 是 `flex-col justify-between`：工牌（≈95）+ 展开的聊天（≈223）+ 底部操作行（190）+ 安全区，
合计超过横屏的 390，被根节点 `overflow-hidden` 裁掉。发送后不 `blur`、不收面板，手机键盘常驻，
iOS 的 `dvh` 又不会随键盘变化，摇杆会被直接盖住。

## 备选方案

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 只把摇杆改成固定热区、其余不动 | 改动最小 | 速度手感与聊天遮挡都没修 | 低 |
| B. 摇杆行程对齐视觉 + 动作盘重排 + 聊天浮层 + 可视视口（采纳） | 一次性收口手感与遮挡，桌面布局零改动 | 摇杆组件重写、HUD 层级显式化 | 低 |
| C. 引入虚拟摇杆库 | 少写代码 | 与现有像素 HUD 语言不一致，多一个运行时依赖 | 中 |

选 B。手感问题必须靠「视觉半径 = 逻辑半径」这个不变量解决，不能靠调死区补偿。

## 决策

### 1. 摇杆数学抽成纯函数，行程即满力

新增 `apps/web/lib/game/joystick.ts`：

```ts
export const STICK_BASE = 112;                        // 基座直径
export const STICK_KNOB = 44;                         // 摇杆头直径
export const STICK_RADIUS = (STICK_BASE - STICK_KNOB) / 2;  // 34：头的行程
export const STICK_DEAD_ZONE = 0.18;
```

- 输出向量 = `方向单位 × (力度 - 死区) / (1 - 死区)`，**模长只取决于行程，与角度无关**；
- 半径外钳到半径，推到圆外不会突然加速；
- 旋转舞台的屏幕 → 舞台换算（`dx = sy, dy = -sx`）也在这里做；
- `joystick.test.ts` 锁住 16 个方向同速、45° 与 0° 等长、死区、圆外钳制、旋转后长度不变、摇杆头只钳半径。

### 2. 浮动摇杆：左半屏热区，落点生成

- `Joystick` 铺满左半屏（`inset-y-0 left-0 w-[54%]`），在 HUD 之下；HUD 的 `pointer-events-none`
  让空白处的按压穿透到热区，`pointer-events-auto` 的子元素（工牌、聊天、动作盘）照常拦截；
- 按下才在落点生成摇杆，未按下时左下角只留一枚虚线基座作提示；
- `pointermove` 只写 `knobRef.style.transform` 并直接算向量，不触发 React 渲染；
- 悬停元素常挂载（用 `opacity` 切换），拖动中途不会因为重挂载丢 `ref`。

### 3. 动作盘 3×2 + 独立打字键，扩大命中区

- 6 个动作压成 3 列 × 2 行，单键 60px（原 58），总高从 190 降到 128；
- 「打字」单独做成 68px 大圆钮，放在右手主位（动作盘右侧）；
- 按下即 `navigator.vibrate?.(8)`（有则调用），保留 `aria-pressed` / `aria-disabled` / `title` 原因；
- 图标与标签一起保留，不改快捷键映射。

### 4. 聊天浮层化 + 输入法避让

- `compact` 下聊天改为绝对定位浮层（`left-0 right-0 top-[92px] z-30`），不再参与 HUD 的纵向 flex；
- 消息区高度改为 `min(30dvh, 180px)`，小屏不溢出；
- 发送成功后 `inputRef.blur()` 并收起面板，键盘不常驻；
- 输入框补 `enterKeyHint="send"` / `autoComplete="off"` / `autoCapitalize="off"` / `spellCheck={false}`，
  并在 `globals.css` 里恢复 `user-select: text` 与 `-webkit-touch-callout: default`（覆盖根节点的 `no-callout`）；
- 新增 `useVisualViewportSize`：非旋转时用 `visualViewport.height` 覆盖根容器的 `h-dvh`，
  `layout.tsx` 的 viewport 增加 `interactiveWidget: 'resizes-content'`；
  旋转舞台（竖屏 CSS 90°）不参与，键盘在旋转坐标里位于另一条边，摇杆本来就不在那一侧。

### 5. 触屏判定与全屏白名单

- `useIsTouch` 放宽为「`pointer: coarse` 或 `any-pointer: coarse`」：带触屏的二合一设备不再被判成桌面端；
- 自动全屏的白名单补上「打卡下班」Link 与聊天折叠头（`data-no-immersive`），点退出不会先被拉进全屏。

## 后果

- 正面：
  - 斜向与直行在同样行程下同速，摇杆头推到内环就是满力，手感可预测；
  - 左半屏盲按可用，不用低头找固定圆；
  - 动作盘少占 62px 高度，打字键离开摇杆；
  - 聊天不再顶掉操作区，发完即收键盘，iOS 上摇杆不被键盘盖住。
- 负面：
  - 摇杆行程只有 34px，比旧实现的 62px 理论上限短；靠「内环 = 满力」的视觉提示补偿；
  - 二合一设备会同时显示摇杆与键盘提示（可接受，键盘仍可用）；
  - 聊天浮层与 HUD 的层级需要显式维护（`z-30` / 动作盘在 HUD 内）。
- 回滚：低。`TouchControls.tsx` 与 `GameViewport.tsx` 的聊天浮层可单独退回；
  `joystick.ts` 是纯函数，可整体删除并恢复旧组件。

## 复核信号

- 出现「斜着走仍然更快」：查 `stickVector` 是否还按 DOM 尺寸算半径，以及 `STICK_RADIUS` 是否与内环一致；
- 出现「摇杆头跑出基座」：查 `STICK_RADIUS + STICK_KNOB / 2` 是否仍小于 `STICK_BASE / 2`；
- 出现「聊天面板顶掉动作盘」：查 ChatDock 是否又被放回 HUD 的纵向 flex；
- 出现「键盘挡住摇杆」：查根容器是否仍读 `visualViewport.height`，以及 `interactiveWidget` 是否被移除；
- 出现「点打卡下班先进全屏」：查该 Link 是否仍带 `data-no-immersive`。
