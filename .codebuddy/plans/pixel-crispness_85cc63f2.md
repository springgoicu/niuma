---
name: pixel-crispness
overview: 统一「像素块明显」的渲染契约：Pixi 世界/预览改为设备像素整数倍缩放并按设备像素对齐、地面与文本改 nearest 采样；DOM 侧角色一律 48 的整数倍显示且去掉模糊光晕；同时提升 48×48 图集的明暗对比与轮廓可读性（轮廓不再被斑纹覆盖、斑纹避开面部、配件改 1:1 尺寸）。
todos:
  - id: pixel-metrics
    content: 新建 pixel-scale.ts：实现 DPR 到整数设备像素纹素、cssScale、snapCss/snapTexel
    status: completed
  - id: renderer-crisp
    content: 改造 renderer/atlas/character：地面 nearest、相机与实体吸附、文字按设备纹素重建
    status: completed
    dependencies:
      - pixel-metrics
  - id: preview-crisp
    content: 预览台改用 pixel-scale 缩放，用 [skill:impeccable] 把 blur-2xl 换成硬阶梯光晕
    status: completed
    dependencies:
      - pixel-metrics
  - id: dom-sprite-zoom
    content: SpriteMask/Hero/Sections/JoinGate 统一 48 整数倍显示与硬阴影，用 [skill:impeccable] 收尾版式
    status: completed
    dependencies:
      - pixel-metrics
  - id: atlas-readability
    content: 用 [skill:layer-pixel-art] 校验：拉开明暗阶梯、斑纹后描边、面部禁绘、描边补缺口
    status: completed
  - id: cosmetic-1to1
    content: 配件改 12×12 与 1:1 叠加，manifest 增 cosmeticSize，锚点取整
    status: completed
    dependencies:
      - atlas-readability
  - id: regen-verify
    content: 重跑 assets 与 typecheck/test，按 DPR 1/1.25/1.5/2 核验并补 ADR 0005
    status: completed
    dependencies:
      - renderer-crisp
      - preview-crisp
      - dom-sprite-zoom
      - cosmetic-1to1
---

## 产品概述
《牛马》是一款 48×48 程序化像素图集驱动的 2D 多人在线像素游戏。当前问题：屏幕上「像素块不明显」，角色、地面、配件、文字看起来发糊、边缘不硬，像被插值抹平过。

## 核心功能
- **渲染层像素完美**：Pixi 世界与捏人预览按设备像素计算缩放，保证每 1 个纹素（texel）恒占整数个设备像素（DPR 1、1.25、1.5、2 都成立），所有纹理使用最近邻采样，相机与角色位置吸附到纹素栅格。
- **地面与文字去模糊**：程序化地台纹理改为 nearest + 原始分辨率后平铺；昵称与头空气泡按最终设备像素重建位图，气泡背景改成硬边方框。
- **配件不再亚像素缩放**：配件图重绘为 12×12 并按 1:1 叠加到角色上，替代当前 0.55 倍缩放的糊状效果。
- **页面侧整数倍展示**：落地页 Hero、物种卡、入场缩略图、捏人预览台中的角色统一按 48 的整数倍显示（1×/2×/3×），去掉 10px 软光晕，改硬像素投影。
- **图集可读性提升**：拉大明暗阶梯；斑纹不再覆盖描边、不再压住眼睛与口鼻；描边补齐对角缺口，轮廓更干净；眼睛加 1px 高光。

## 视觉结果
同样的暗黑工业办公风与配色不变，但放大后能清楚看到一个个方块像素：角色轮廓硬、斑纹边界利落、配件边缘不再发虚，地台格线与文字也不再是灰蒙蒙的过渡色。

## 技术栈
沿用现有栈，不新增依赖：Next.js 15 + React 19 + TypeScript 5（strict）+ Tailwind v4 + PixiJS 8.22（WebGPU 优先）+ pnpm/Turborepo。图集由 `packages/pixel-assets` 的零依赖生成器产出（`pnpm assets`）。

## 实现策略

### 1. 统一的像素度量单一真相
新增 `apps/web/lib/game/pixel-scale.ts`，把「1 个纹素要占多少设备像素」变成唯一入口：

- `devicePxPerTexel = clamp(Math.round(baseCssPerTexel × dpr), 2, 8)`
- `cssScale = devicePxPerTexel / dpr`
- `snapCss(v) = Math.round(v × dpr) / dpr`（相机、舞台坐标按设备像素吸附）
- `snapTexel(v) = Math.round(v)`（世界坐标按纹素吸附，1 世界像素 = 1 纹素）

游戏世界 `baseCssPerTexel = 3`（DPR 2 时仍是每纹素 6 设备像素，观感不变；DPR 1.25 时从 3.75 纠正为 4）；捏人预览 `baseCssPerTexel = 6`。

关键取舍：当前 `roundPixels: true` 在 v8 中只把顶点吸附到设备像素（`roundPixelsBit.mjs`），无法修正「纹素宽度 3.75 像素」这类非整数宽度，所以必须钳制缩放而不只是吸附位置。吸附带来世界像素级的抖动（3–4 设备像素），这是像素艺术的常规取舍，插值仍保留在世界坐标里，只在写入渲染层时吸附。

### 2. 渲染管线（`renderer.ts` / `atlas.ts` / `character.ts`）
- `resolution` 直接用 `devicePixelRatio`（上限 2.5，仅极端高 DPR 才截断并记录代价），避免 backing store 与设备像素错位后由浏览器重采样。
- 地面：`generateTexture(g, { resolution: 1, textureSourceOptions: { scaleMode: 'nearest' } })`，128×128 纹理与世界像素 1:1 平铺，1px 网格线变成清晰的 3–4px 硬线。
- 相机 `updateCamera` 用 `snapTexel` 后的世界偏移换算，实体 `root.position` 在 `updateEntity` 里吸附；`roundPixels` 保留。
- 昵称/气泡 `Text.resolution` 改为 `devicePxPerTexel`（如 6），解决 DPR 2 下 2× 放大导致的发虚；气泡背景由 `roundRect` 改为 `rect` + 1px 硬描边，文字与边距取整。
- 地面纹理尺寸固定，不随窗口变化重建；每帧只多几次整数取整，实体 200 时开销可忽略；文本位图内存约 ×4，仍在可接受范围。

### 3. 捏人预览（`preview.ts` / `PreviewStage.tsx`）
角色缩放改由 `pixelMetrics(6, dpr)` 计算，舞台位置按设备像素吸附；预览台背后的 `blur-2xl` 径向光换成硬停止的阶梯光晕（`repeating-radial-gradient`、无 blur），避免柔光把角色边缘糊掉。

### 4. 页面侧（`SpriteMask.tsx` / `Hero.tsx` / `Sections.tsx` / `JoinGate.tsx`）
- `SpriteMask` 内部按 `zoom = clamp(round(size/48), 1, 4)` 推导真实尺寸 `48 × zoom`，`maskSize = 384 × zoom`、`maskPosition = -col × 48 × zoom`，全部整数，保证 CSS mask 采样不落在半像素上。
- 软阴影 `drop-shadow(0 0 10px …)` 改为 `drop-shadow(2px 2px 0 …)`（0 模糊），保留原有荧光色但边缘变硬。
- 展示尺寸：Hero 82 改为 144（3×）；物种卡 96 改为 144（3×，窄屏回落 96=2×，两个都是整数倍）；入场缩略图 48 改为 96（2×）。

### 5. 图集生成器（`packages/pixel-assets`）
- `palette.ts`：拉开 luma 阶梯（示例：body 255/176/112，pattern 255/160，hoof 236/150，eyes 255/120，extra 255/158，snout 255/168，outline 64），让 3–4 设备像素的明暗台阶看得出来。
- `quadruped.ts`：绘制顺序改为 `bottomShade → stampPattern → outline`，描边永不被斑纹覆盖；`stampPattern` 增加面部禁绘区（按姿态与朝向传入排除矩形），避免斑块压住眼睛与口鼻；`outline()` 后补一次「对角缺口填充」，消除阶梯状毛边；眼睛增加 1px `EyeShade` 高光。
- `cosmetics.ts`：`SIZE` 16 改为 12，图标坐标整体平移（-2, -1），内容完整落在 12×12 内；`character.ts` 配件 `scale` 由 0.55 改为 1，锚点与位置取整。
- `generate.ts`：manifest 增加 `cosmeticSize` 字段（纯新增，向后兼容），`cosmeticAnchors` 保持世界像素整数。

### 6. 约束与风险控制
- 20 字节外观协议、5 色 RGB565 槽位不动，所以不新增可着色图层：轮廓继续留在 body 层，用绘制顺序保证完整。
- `manifest.json` 仅新增字段，旧客户端读取不受影响；图集文件名不变。
- 不改服务端、协议、AOI 与 tick 逻辑；不做无关重构。
- 回滚路径：把 `pixel-scale.ts` 的 `devicePxPerTexel` 退回 `baseCssPerTexel × dpr`（不取整）即可恢复旧缩放；图集侧回退为重新执行一次旧版生成器。
- 验证：`pnpm assets`、`pnpm typecheck`、`pnpm test`；在 DevTools 设备模拟下按 DPR 1 / 1.25 / 1.5 / 2 截图取色，确认边缘无中间色、每块像素等宽。

## 目录结构

```
apps/web/
├── lib/game/
│   ├── pixel-scale.ts    # [NEW] 像素度量单一真相：DPR→整数设备像素纹素、cssScale、snapCss/snapTexel、文本分辨率推导。禁止在别处硬编码 3 或 6。
│   ├── renderer.ts       # [MODIFY] 用 pixel-scale 计算 world.scale；地面 generateTexture 改 resolution 1 + nearest；updateCamera/updateEntity 吸附；Text resolution 跟随设备纹素；气泡改硬边方框。
│   ├── atlas.ts          # [MODIFY] SpriteManifest 增加 cosmeticSize；nearest 设置收敛到一个 load 辅助函数，地面/角色/配件共用。
│   ├── character.ts      # [MODIFY] 配件 scale 改 1、位置取整；默认 scale 参数移除，改由调用方传 pixel-scale 结果。
│   └── preview.ts        # [MODIFY] 角色缩放与舞台位置走 pixel-scale，按设备像素吸附。
├── components/
│   ├── site/SpriteMask.tsx   # [MODIFY] zoom 取整推导尺寸，maskSize/maskPosition 全整数，软阴影改硬像素阴影。
│   ├── site/Hero.tsx         # [MODIFY] 角色 size 82 → 144（3×）。
│   ├── site/Sections.tsx     # [MODIFY] 物种卡 96 → 144（3×），窄屏回落 96。
│   ├── game/JoinGate.tsx     # [MODIFY] 缩略图 48 → 96（2×）。
│   └── creator/PreviewStage.tsx # [MODIFY] blur-2xl 光晕换硬阶梯光晕，避免柔化角色边缘。
packages/pixel-assets/
├── src/palette.ts        # [MODIFY] 拉开明暗 luma 阶梯，强化 outline 与 shade 对比。
├── src/quadruped.ts      # [MODIFY] 斑纹→描边顺序、面部禁绘区、描边缺口补齐、眼睛高光。
├── src/canvas.ts         # [MODIFY] 新增 fillNotches（对角缺口填充）与 clearRegion（面部遮罩）两个纯函数。
├── src/cosmetics.ts      # [MODIFY] SIZE 16 → 12，坐标平移，保证 1:1 叠加。
└── scripts/generate.ts   # [MODIFY] manifest 增加 cosmeticSize；anchors 校准。
apps/web/public/sprites/  # [REGENERATE] pnpm assets 重新产出全部 PNG 与 manifest.json。
docs/adr/0005-pixel-grid.md # [NEW] 记录纹素→设备像素整数倍与吸附层级的决策、代价与回滚路径。
```

## 关键接口

```ts
export interface PixelMetrics {
  dpr: number;
  devicePxPerTexel: number;
  cssScale: number;
}

export function pixelMetrics(baseCssPerTexel: number, dpr: number): PixelMetrics;
export function snapCss(value: number, dpr: number): number;
export function snapTexel(worldValue: number): number;
```

## Agent Extensions
### Skill
- **layer-pixel-art**
  - Purpose: 用其「明确网格 + 硬边 + 无抗锯齿 + 一格一像素」的口径校验改后的 48×48 图集与 12×12 配件，确认没有半像素与柔边残留。
  - Expected outcome: 图集每个像素均为纯色块，描边完整闭合，配件在 1:1 下清晰可辨。
- **impeccable**
  - Purpose: 对 `SpriteMask`、Hero、Sections、JoinGate、PreviewStage 这几处 DOM 视觉做 polish，确保尺寸改成整数倍后版式不塌、硬阴影与阶梯光晕融入既有暗黑工业风。
  - Expected outcome: 页面在 1440 与窄屏下布局稳定，角色像素块清晰且不破坏原有设计语言。
