# ADR-0005：像素栅格以设备像素为基准，缩放只取整数倍

- 状态：已采纳（文中「48 的整数倍」与「82px / 0.55 倍」的举例已被 ADR-0010 的 64 网格取代；取整与采样的原则不变）
- 日期：2026-10-29

## 背景

《牛马》的角色图集是 48×48 的程序化像素图，客户端用 PixiJS 放大显示。反馈是「像素块不明显、看着发糊」，
而不是「不够清晰」——说明问题在取整与采样，不在分辨率。

原实现已经设了 `scaleMode = 'nearest'`、`roundPixels: true`、`resolution: min(DPR, 2)`，看起来该做的都做了。

## 问题

`roundPixels` 在 PixiJS v8 里是把**顶点**吸附到设备像素（见 `roundPixelsBit.mjs`），它保证边缘落在整像素上，
但不改变「一个纹素有多宽」。

当 `CSS 缩放 × DPR` 不是整数时——Windows 的 125% / 150% 缩放正好命中——相邻纹素会轮流占 3 个和 4 个设备像素。
在这种亚像素栅格上，再正确的 nearest 采样也只能得到忽宽忽窄的块，视觉上就是糊。
`roundPixels` 对这种情况无能为力，它吸附的是位置，不是宽度。

另外三处也在漏像素栅格：

- 地台用 `renderer.generateTexture(graphics)` 生成，默认 linear + renderer 分辨率，1px 网格线被插值抹成灰带；
- 昵称与气泡的 `Text` 固定 `resolution: 3`，但它在 `world`（缩放 3）里，DPR 2 时位图被放大 2 倍；
- 落地页角色按 82px 显示（48 的 1.708 倍），捏人配件按 0.55 倍缩放，都是亚像素缩放。

## 决策

1. **缩放以设备像素为准**：新增 `apps/web/lib/game/pixel-scale.ts` 作为唯一入口。
   `devicePxPerTexel = round(baseCssPerTexel × dpr)`，`cssScale = devicePxPerTexel / dpr`。
   世界基准 3、捏人预览基准 6，因此 DPR 1 / 1.25 / 1.5 / 2 下每纹素分别是 3 / 4 / 5 / 6 与 6 / 8 / 9 / 12 个设备像素，全部为整数。
2. **位置吸附分层**：相机中心吸附到设备像素（`snapCss`），角色世界坐标吸附到整纹素（`snapTexel`）。
   插值仍留在世界坐标里，只在写渲染层时取整。
3. **纹理一律 nearest，且 1:1 生成**：地台 `generateTexture({ resolution: 1, textureSourceOptions: { scaleMode: 'nearest' } })`；
   所有 `Assets.load` 后的纹理统一在 `atlas.ts` 的一个加载口里设 nearest。
4. **文字按最终设备纹素重建**：昵称与气泡的 `Text.resolution = devicePxPerTexel`，DPR 变化时重建；气泡背景改 `rect` + 1px 硬边。
5. **DOM 侧只允许 48 的整数倍**：`SpriteMask` 内部 `zoom = round(size/48)` 推导实际尺寸，mask 的 size/position 全为整数；
   软光晕改 0 模糊的硬投影；落地页 144（3×）、物种卡 144 / 窄屏 96、入场缩略图 96。
6. **图集侧提升可读性**（不改协议）：描边改到最后绘制（斑纹不再吃掉轮廓）、斑纹禁绘面部矩形、
   明暗 luma 阶梯拉开（body 255/176/112，描边 56）、眼睛用 2×3 的 L 形留 1px 身体色高光、
   描边后补对角针孔、配件 16×16 按 0.75 落到 12×12 并 1:1 叠加。

## 后果

- 正面：任意 DPR 下纹素宽度恒定，像素块明显；地面网格线与文字不再发虚；配件不再是糊状。
- 负面：缩放被钳到整数设备像素后，同一窗口在不同 DPR 屏上观感尺寸略有差异（如 1.25 下 3.2 CSS px/纹素）；
  镜头按整纹素吸附，低速移动时世界以 1 纹素为步进（3–4 设备像素），这是像素游戏的常规取舍。
  高 DPR（3×）下 `resolution` 不再截断到 2，backing store 更大，显存与填充率随之上升。
- 回滚成本：低。把 `pixelMetrics` 的 `devicePxPerTexel` 退回 `baseCssPerTexel × dpr`（不求整）即恢复旧缩放，
  其余 nearest 与吸附可以保留；图集侧重跑一次旧版生成器即可。

## 复核信号

- 出现「同一角色在 125% 与 100% 缩放下观感不一致」的投诉，说明整数钳制的取舍需要重新评估。
- WebGPU 初始化失败时（无可用 adapter）`preference: 'webgpu'` 目前不会回落到 WebGL2，与 README 的描述不符；
  这条属于渲染后端问题，不在本决策范围内，但一旦触发就应单独处理。
