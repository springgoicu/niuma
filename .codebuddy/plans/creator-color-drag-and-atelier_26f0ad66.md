---
name: creator-color-drag-and-atelier
overview: 修复捏人页 H/S/V 滑块在拖到末端（或把饱和度/明度拖到 0）时因 RGB565 回读导致滑块跳回最前端的问题，让取色全程顺滑并给出即时数值/色彩反馈；同时在保持 ink/mist/mint 主视觉的前提下，为 /create 增加一层克制的女性化「妆造」装饰（玫瑰金细线、柔粉光晕、花瓣、整妆配色）。
design:
  architecture:
    framework: react
  styleKeywords:
    - 加班妆造间
    - 玫瑰金细线
    - 柔粉光晕
    - 镜框式面板
    - 克制的女性化
    - 工业终端骨架
  fontSystem:
    fontFamily: Oswald, PingFang SC
    heading:
      size: 24-38px
      weight: 700
    subheading:
      size: 15-18px
      weight: 600
    body:
      size: 16px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
    background:
      - "#0F0C09"
      - "#14100C"
      - "#1B1611"
      - "#221B16"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#A2917A"
      - "#857463"
    functional:
      - "#E79AAD"
      - "#F0B6C3"
      - "#B96B83"
      - "#D8B48E"
      - "#F2C879"
      - "#E06A5A"
todos:
  - id: color-draft
    content: 在 lib/color.ts 增加 resolveHsvDraft，并补 color 单测覆盖 360 折返与 565 量化
    status: completed
  - id: slider-rewrite
    content: 重写 ColorConsole 的 Track 与 ColorControls：本地 HSV draft、同色跳过、实时色块与 HSV 读数
    status: completed
    dependencies:
      - color-draft
  - id: palette-store
    content: creator-store 增加四套 LOOK_PALETTES 与单次 set 的 applyPalette，并补单测
    status: completed
  - id: atelier-tokens
    content: 用 [skill:impeccable] 定妆造层方向，在 globals.css 加 blush/gilt 令牌、panel-atelier、分隔线与花瓣关键帧，新建 Atelier.tsx
    status: completed
  - id: atelier-wiring
    content: 把妆造层接入 CreatorShell、NamePlate、PartRail 与 PreviewStage 的柔光与花瓣
    status: completed
    dependencies:
      - atelier-tokens
  - id: palette-ui
    content: ColorConsole 增加整妆配色四张卡，常用主色加高光与星芒激活态
    status: completed
    dependencies:
      - slider-rewrite
      - palette-store
      - atelier-tokens
  - id: verify
    content: 跑 typecheck、bun test 与 [skill:impeccable] detect，补版本工报并跑 changelog:check
    status: completed
    dependencies:
      - slider-rewrite
      - palette-ui
      - atelier-wiring
---

## 用户需求

### 产品概述
捏人工作台（`/create`）是玩家进园区前唯一的角色外观编辑入口，由「工牌名 + 三栏工作台」组成：左栏选工种与配件、中间实时预览、右栏调色控制台。当前调色控制台的 H/S/V 滑块存在交互缺陷，且整页视觉语言偏工业终端、缺少精致的妆造感。

### 核心功能
- **修复色相滑块末端回跳**：把色相滑轨拖到最右端时，滑块不再从末端弹回最前端；饱和度为 0、明度为 0 时色相滑轨也不再被重置。
- **拖动全程无跳动**：三条滑轨（色相、饱和度、明度）在拖动过程中位置只跟随手指或指针，不因颜色写入后的取整而抖动、回拉或跳格。
- **取色反馈即时且连续**：拖动时实时色块、十六进制读数、H/S/V 数值同帧变化，不出现"松手才更新"的滞后；数值用等宽字体，不因位数变化而左右跳动。
- **女性化妆造元素（仅捏人页）**：在不改变 ink 暖褐底、mist 米白字、mint 状态色的前提下，加入一层克制的玫瑰金与柔粉装饰——细框"镜框"、渐变细线加菱形分隔、预览台柔粉光晕与极慢上浮花瓣、色板内部高光与星芒选中标记，以及一行四套"整妆配色"（晨樱、蜜桃奶、暮玫、燕麦奶）一键套用整套协调配色。
- **可用性同步提升**：数值可读、当前取色一眼可见、整套配色一键成型；触屏命中区、键盘操作与屏读播报保持现状不退化。

### 视觉与体验效果
页面从"纯工业调色台"变为"加班妆造间"：骨架仍是 2px ink 描边、直角、等宽微文案，但每个面板内侧多一道 1px 玫瑰金细框，像给工位挂了一面化妆镜；标题上方一行 Georgia 斜体 `Atelier` 与中文小字点题；面板之间的硬分隔线换成两端淡出、中点菱形金饰的细线；预览台脚下由单色 mint 光晕变为 mint 内芯 + 柔粉外环的双色光，五片 3px 斜方块花瓣以 14–22 秒的周期极慢上浮。

调色台本身更像一个化妆盘：滑轨滑块带上当前色的描边与柔光，底部出现实时色块和三格 H/S/V 读数（正在拖的那一格描淡 mint 边框）；12 个常用主色块加一层内侧高光，当前色块右下角用 CSS 裁出的小星芒标记；新增的四张整妆卡片各带一条三色迷你条，悬停时上浮 1px、边框转玫瑰金。所有装饰性粉色只用于氛围与点缀，选中态、焦点环、主按钮仍由 mint 承担，整体不跳脱、不甜腻、不抢操作。

## 技术栈与现状
- Next.js 15 App Router + React 19 + TypeScript、Tailwind CSS v4（`@theme` 令牌）、zustand 5（`subscribeWithSelector`）、pixi.js 8 预览、测试为 `bun test lib`。
- 颜色链路的既有硬约束：`setColor` 走 `sanitizeAppearance`，其中 `normalizeColor = rgb565ToHex(hexToRgb565(hex))`（`packages/shared-types/src/appearance-codec.ts:52-54`），即**每次写入都被量化到 RGB565**。

## 根因（已验证）
1. `apps/web/components/creator/ColorConsole.tsx:68-110`：`ColorControls` 每帧从 store 反推 HSV，`const hsv = hexToHsv(color)`，滑块位置完全由 store 颜色决定。
2. `apps/web/lib/color.ts:41`：`hsvToHex` 中 `hh = (((h % 360) + 360) % 360) / 60`，h=360 折回 0。
   → 色相拖到最右：h=360 写成 h=0 的红 → `hexToHsv` 读回 0 → 滑块从末端跳回最前端。这就是用户报告的循环回跳。
3. 同类失效：饱和度拖到 0（灰无色相）、明度拖到 0（黑无色相）时 h 归零；565 量化让反推的 H/S/V 每步都有偏差，低饱和度时抖动被放大。

## 实现策略
### A. 交互真值与滑轨解耦（核心）
- `ColorControls` 内维护本地 `Hsv` draft（state + ref），拖动只写 draft 并输出颜色；store 不再是滑轨位置的来源。
- 新增纯函数 `resolveHsvDraft(storeColor, emitted, draft)`：当 store 颜色等于"我方刚发出的颜色"时原样返回 draft（含 h=360 的原样保留）；只有外部改色（预设色块、hex 输入、切换槽位、hydrate、套用整妆）才重算 `hexToHsv`。判等用 `normalizeColor(hsvToHex(...))` 归一后的整数比较，避免量化误差误判。
- 提交策略：**同步提交**，不做 rAF 合并。理由是从原生 range 的 `input` 事件本身已按帧合并，再套一层 rAF 只会把预览推迟一帧，与"反馈更即时"的目标相反；同时省掉 pending/flush/unmount 三类易漏写的边界。
- 同色跳过：归一后与上次发出的颜色相同就不写 store，避免空 set 引发的无意义重渲染与 `dirty` 抖动。
- 组件生命周期：`FocusCard` 的容器已用 `key={part}` 强制重挂载；`GlobalRow` 槽位固定，另用 `slot` 进依赖数组兜底重置 `emitted`。

### B. 反馈增强
- 底部行改为「36px 实时色块（内侧高光）+ hex 输入 + 565 回显」，拖动时色块轻微放大并带自身颜色描边。
- 新增 H/S/V 三格读数条：等宽数字 + `tabular-nums`，正在拖动的轴加淡 mint 边框；`aria-hidden`，屏读播报仍由原生 range 的 `aria-valuetext` 承担。
- 滑块加当前色 1px 描边与 12px 柔光（内联 `boxShadow`，避免为每个色值生成类名）。

### C. 妆造层（仅 `/create`）
- 令牌层：`globals.css` 的 `@theme` 增加 `--color-blush-100/300/400`、`--color-rose-500`、`--color-gilt-400`、`--font-editorial`（Georgia 拉丁衬线，仅用于 `Atelier` 一个词，规避 Windows SimSun 在中文小字上的粗糙）。
- 组件层：新增 `Atelier.tsx` 导出 `AtelierRule`（渐变细线 + 菱形）、`AtelierStar`（`clip-path` 四角星，不用 emoji）、`AtelierEyebrow`。
- 样式层：`.panel-atelier` 用独立 `::before` 在 `inset: 5px` 画 1px 玫瑰金内框（不复用 `::after`，避免与 `.panel-scan::after` 冲突）；`@keyframes petal-drift` 只动 transform/opacity，写入既有 `prefers-reduced-motion` 兜底范围。
- 数据层：`creator-store.ts` 增加 `LOOK_PALETTES`（4 套，每套 body/pattern/hoof/eyes/extra 等槽位的协调色）与 `applyPalette`，**单次 `set` + 单次 `sanitizeAppearance`**，只触发一次渲染与一次 tint 下发（对应色板 4 次 `setColor` 的写法会重渲染 4 次）。

## 性能与可靠性
- 拖动热路径：每次 `input` 一次 store `set`（浏览器按帧合并，上限约 60 次/秒）；预览侧 `pony.ts:263-272` 在变体键不变时只改 `sprite.tint`，不重建纹理，`ColorControls` 子树为唯一重渲染范围。
- 装饰动效只有 5 个绝对定位元素、纯 transform/opacity，`pointer-events-none` + `aria-hidden`，不使用 `will-change` 以免层爆炸；reduced-motion 由现有全站规则统一归零。
- 不新增依赖、不改协议、不改服务端、不动 `sanitizeAppearance` 与 565 存储语义（玩家端显示与本地预览必须继续一致）。
- 可回滚：妆造层全部是新类名与新组件，删除调用点即恢复原视觉；交互修复集中在单个组件与一个纯函数。

## 架构与数据流
```
Track（纯展示：滑轨/滑块/数值）
  ↑ value/percent/accent
ColorControls（draft 所有者：draft → normalizeColor → setColor）
  ↑ slot
FocusCard / GlobalRow（各自订阅一个色槽）
  ↑
ColorConsole（分区、常用主色、整妆配色）
```
`Atelier.tsx` 只在 creator 目录内复用；store 仅新增一个动作，不触碰 hydrate / saveProfile / 保存链路。

## 目录结构
```
apps/web/
├── app/globals.css                                  # [MODIFY] @theme 追加 blush-100/300/400、rose-500、gilt-400、--font-editorial；新增 .panel-atelier（::before 内嵌 1px 玫瑰金框）、.atelier-rule、.atelier-star、@keyframes petal-drift。只追加，保留工作区已有未提交改动。
├── lib/color.ts                                     # [MODIFY] 新增 resolveHsvDraft(storeColor, emitted, draft)：自己发出的颜色不回灌，其余情况重算 hexToHsv。纯函数、无 React 依赖。
├── lib/creator-store.ts                             # [MODIFY] 新增 LookPalette 类型、LOOK_PALETTES（晨樱/蜜桃奶/暮玫/燕麦奶）、applyPalette（单次 set + 单次 sanitizeAppearance，dirty: true）。
├── lib/__tests__/color.test.ts                      # [NEW] 覆盖：h=360 与 h=0 同色、draft 在自发出颜色时原样保留、外部预设重同步、565 量化导致低饱和色反推偏差（断言偏差存在以固化"必须保留 draft"的理由）。
├── lib/__tests__/creator-store.test.ts              # [NEW] applyPalette 只改指定槽位、其余槽位不动、dirty 置真、颜色已被 565 归一。
├── components/creator/Atelier.tsx                   # [NEW] AtelierRule / AtelierStar / AtelierEyebrow 三个纯展示件，无状态、无副作用，className 透传。
├── components/creator/ColorConsole.tsx              # [MODIFY] 主战场：Track 增加 accent/active 视觉与数值语义；ColorControls 改为 draft 驱动并加实时色块与 H/S/V 读数；SectionHead 换 atelier 分隔；常用主色加高光与星芒；新增整妆配色 section；面板挂 panel-atelier。
├── components/creator/PreviewStage.tsx              # [MODIFY] 脚底柔光改为 mint 内芯 + blush 外环；新增 5 片花瓣层（aria-hidden、pointer-events-none）；四角括号保留 mint，顶部加一道玫瑰金细线；面板挂 panel-atelier。
├── components/creator/CreatorShell.tsx              # [MODIFY] 页面底部加两处极淡粉雾径向光；标题上方加 Atelier 眉标；面板间距与既有栅格不动。
├── components/creator/NamePlate.tsx                 # [MODIFY] 挂 panel-atelier，右上角加一处菱形金饰，其余结构不动。
├── components/creator/PartRail.tsx                  # [MODIFY] 挂 panel-atelier，分组标题分隔线换 atelier 细线。
└── data/release-notes.json                          # [MODIFY] 提交前在 entries 最前追加一条（当日序号顺延，当前最新为 2026-11-12-3），只写玩家可感知的变化。
```

## 关键结构
```ts
/** 由 store 颜色决定滑轨是否重同步：emitted 是我们刚发出的（已 565 归一）颜色 */
export function resolveHsvDraft(storeColor: number, emitted: number | null, draft: Hsv): Hsv;
```
`LookPalette` 用文字约定即可：`id`、`name`（中文名）、`hint`（拉丁小字）、`colors` 为 `ColorSlot` 到 hex 的部分映射；四套主色分别取 0xF6DFE4 / 0xF7E2CF / 0x6D4A55 / 0xEFE6D6 作 body 基调，配 pattern、hoof、eyes、extra 的协调值（写入时仍会被 565 归一，属预期）。

## 实施注意
- 工作区存在大量他人未提交改动：只改捏人相关文件；`globals.css` 与 `release-notes.json` 只在文件内追加，不重排既有内容。
- 视觉红线：不加圆角、不加新依赖、不引入远程字体、不用 emoji、不用紫蓝渐变、不用 bounce 缓动；粉色绝不替代 mint 的状态语义。
- 触屏命中区继续 44px（移动端 `h-11`），`xl` 紧凑模式（`xl:h-6` / `xl:h-7`）不因新增读数行而溢出面板滚动区。
- 对比度：blush-400（#E79AAD）与 gilt-400（#D8B48E）在 ink-900 上的对比度分别约 8.7:1 与 9.8:1，可安全用于 10–15px 文字，但仅限微文案与标题，不铺大面积。
- 不要试图"修掉" 565 量化：它是本地预览与远端玩家一致性的契约，本次只在 UI 层解耦，不改存储语义。

## 设计方向：加班妆造间（Vanity Atelier）

保留既有工业终端的骨架——2px ink 描边面板、直角、Oswald 标题、JetBrains Mono 微文案、mint 作为唯一状态色——在其上叠一层极薄的"玫瑰金妆造层"，像给工位挂了一面化妆镜。女性的精致感来自克制：细线、柔光、极慢的花瓣、带香气的命名，而不是换掉整个视觉世界。

### 页面结构
- **氛围**：ink-900 底上两处极淡粉雾径向光（左上约 0.08、右下约 0.05），不参与任何状态表达。
- **标题区**：h1「捏一头能加班的牛/马」保持 Oswald 700；上方一行 `Atelier`（Georgia 斜体、0.32em 字距、blush-300）与中文小字「妆造间 · 换身皮再上班」形成粗细与冷暖的对照。
- **面板**：`.panel-atelier` 在 2px ink 外框内侧 5px 处补一道 1px 玫瑰金细框，四角各一枚 2px 金点，读作镜框；工牌条、左栏、预览台、调色台四处统一，页脚不加。
- **分隔**：`.atelier-rule` 为两端淡出、中点 5px 菱形的金色细线，替代部分硬 `border-b`。

### 调色台（核心区域）
- 区域眉标 `ATELIER / 妆造间`，标题仍用 Oswald，右侧保留 `rgb565` 微文案。
- 三条滑轨：滑轨本体保持 8px 细条与 1px 描边，滑块改为当前色 1px 描边 + 12px 同色柔光，拖动时纵向微放大；命中区仍为 44px。
- 底部一行：36px 实时色块（内侧高光 + 自身色描边）+ hex 输入 + 565 回显；下方三格 H/S/V 读数，等宽数字右对齐，正在拖动的轴描淡 mint 边框。
- 常用主色：12 个色块加内侧高光，选中色块右下角一枚用 `clip-path` 裁出的四角星，边框转 gilt。
- 整妆配色：四张卡片（晨樱 SAKURA / 蜜桃奶 PEACH / 暮玫 DUSK / 燕麦奶 LINEN），每张一条三色迷你条 + 中文名 + 拉丁小字；悬停上浮 1px、边框转玫瑰金，点击整只角色换装。

### 预览台
- 脚底光改为 mint 内芯 + blush 外环的双色柔光；四角 mint 括号保留，顶部加一道玫瑰金细线与一枚小星芒。
- 五片 3px 斜方块花瓣在角色后方以 14–22 秒周期极慢上浮，透明度 0→0.5→0，`prefers-reduced-motion` 下静止。

### 动效与响应式
- 所有装饰动效只动 transform/opacity，起落用 `--ease-out-expo`，不使用弹跳曲线；交互反馈控制在 120–200ms。
- 移动端（小于 640px）保留单列与页签结构，装饰降为 3 片花瓣、面板内框缩到 4px；桌面端三栏并保持右侧调色台独立滚动。

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 妆造层属于新增视觉世界，需要先定方向与工艺底线，再在收尾阶段做确定性检测；同时把捏人页纳入 `.impeccable` 上下文的产品事实与既有视觉真相，避免与全站气质冲突。
  - Expected outcome: 产出可执行的妆造层视觉规范（颜色、层次、动效幅度），并在实现后用 `impeccable detect` 对改动文件扫描，确认无 primary findings，附上一份 `polish` 结论说明哪些地方被收紧了。
