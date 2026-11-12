# ADR-0048：局部动态光影——低清 Lightmap 与合批点光源

- 状态：已采纳
- 日期：2026-11-12
- 关联：细化 ADR-0013 第 6 条（屏幕空间乘算柔光）、ADR-0046（冬季锚点）、ADR-0005（整数栅格与 nearest 采样）
- 替换：`apps/web/lib/game/ambient-light.ts` 的单 quad 柔光层

## 背景

园区已经到了「白天好看、夜里只是整张图偏蓝」的阶段：旧 `AmbientLight` 是一个全屏
`Texture.WHITE` + `multiply` 的 Sprite，夜间 alpha 只有 0.12，等于只把画面压暗 6%。
灯柱、会议室投屏、宿舍壁灯、售货机与咖啡机在贴图里各自画了一圈光晕，但光晕不会
随距离衰减，也不受环境光影响——夜里看起来像「贴纸发光」，而不是灯照亮了地面。

需求同时给了三条硬约束：

1. 光图必须是独立的 1/2 或 1/4 视口低清纹理，放大后保留像素颗粒；
2. 主场景渲染后，光图以 Multiply + Screen 叠上去，夜间冷蓝底下灯仍要暖；
3. 场景可能有 30–50 个光源，**严禁**每个光源一次全屏 Pass，必须每帧收集后一次合批，
   视口外的光源不提交。

旧实现还有一个已确认的缺陷：`AmbientLight` 调 `lightToneAt(hour)` 时漏传 `this.winter`，
冬季锚点从未生效；`winter-art.ts` 却传了 `true`，两个图层在冬天读出不同的时段。

## 备选方案

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 每个光源一个全屏 additive Pass | 光源数量与画面质量解耦，容易调 | 30–50 次全屏混合，直接违反约束；移动端填充率撑不住 | 高 |
| B. 保留旧 `AmbientLight`，另加一张 lights-only RT 做 Screen | 改动最小，旧昼夜层不动 | 夜间环境仍接近 0.94 亮度，暖光没有暗底可穿透；环境光有两个 owner，冬季锚点还会继续分叉 | 低 |
| C. 双 RT：环境+光做 Multiply，纯光做 Screen | 物理上最标准，灯心可以超过原亮度 | 同一批光源要提交两次，或额外做一次 RT 拷贝；与「一次性合批」冲突 | 中 |
| **D. 单 RT（环境底 + 点光源）+ Multiply + 低 alpha Screen（采纳）** | 一次 RT Pass、一次合批、两张全屏 quad；环境底与点光源共用一个 owner | 灯心亮度上限是光图本身，靠暗环境底形成冷暖/明暗对比 | 低 |

选 D。理由是「所有点光源一次性合批」比「灯心能超过 1.0」更硬；D 用同一张 RT 同时承担
环境压暗与灯心提亮，不需要第二个 RT，也不需要对同批光源提交第二次。
Screen 不是再叠一张光图，而是对同一张图做低 alpha 的暗部抬升，因此不增加光源提交次数。

## 决策

1. **光图尺寸与内容**。默认 `1/4` CSS 视口：`rtW = ceil(screen.width / 4)`，
   `?lm=2` 切 `1/2`，非法值回落 4。`scaleMode: 'nearest'`、`antialias: false`、不生成 mipmap；
   RT 只在视口/DPR 变化时 `resize`，帧循环不创建纹理。
   每帧一次 RT Pass：以当前时段的环境乘子作为**不透明**清屏色，再把视口内所有可见点光源
   以 `blendMode = 'add'` 画进去。清屏 alpha 必须为 1，Multiply 才是纯乘算。

2. **合成**。两个全屏 Sprite 共用这张 RT，加在 `world` 与雪层之后：
   - `ambientSprite`：`blendMode = 'multiply'`，alpha 1；
   - `screenSprite`：`blendMode = 'screen'`，alpha 约 0.18（随环境深度缩放），抬暗部、让灯心更暖。
   全屏合成是常量开销（两张 quad），与光源数量无关。

3. **环境光与昼夜**。把 `ambient-light.ts` 的时段锚点迁到 `lighting/tone.ts`，
   `LightTone` 的 `alpha` 改为 `ambient`（0..1 深度）：环境乘子 = `mix(white, color, ambient)`。
   夜间取 `0x5f739e @0.68`（约 `(0.57, 0.63, 0.74)`），黄昏暖橙、白昼纯白；
   冬季夜更深一档（`0x566a94 @0.72`）。`AmbientLight` 的职责并入光图，
   `?light=0` 仍然一键全关。
   **顺带修复**：构造光图时把 `winter` 显式传给 `lightToneAt`，冬季锚点第一次真正生效。

4. **局部光增益与白昼跳过**。`localLightGain(tone) = clamp((ambient - 0.05) / 0.45, 0, 1)`：
   深夜 1、黄昏约 0.6、黎明约 0.3、白昼 0。环境深度 `< 0.01` 时隐藏合成层并跳过 RT Pass；
   白昼没有额外的光照开销。

5. **光源注册与合批**。`LightRegistry` 支持 `add / addAll / update / remove / clear / collect`，
   容量 64；`update` 接收 `LightPatch`。每帧 `collect` 用圆与相机矩形的最近点距离剔除，
   O(总数)；30–50 个全遍历，只有可见的写入复用的 `Light[]`，不排序、不分配。
   可见光源共享一张 32×32 的抖动径向光斑（4 阶量化 + Bayer 4×4），
   每个光源一个池化 Sprite，同纹理、同 `add` 混合，由 Pixi 批处理器合并为一次 draw call。
   光源位置与尺寸取整到 RT 像素，避免相机移动时亚像素抖动。

6. **Flicker**。64 项确定性 LUT（90ms 一档、两条正弦叠加）+ 每光源种子（`id` 派生）：
   灯柱约 0.16、壁灯 0.1、落地灯 0.08、售货机 0.02、其余 0。每帧只改 alpha，不重建几何。

7. **地标光源的单一事实源**。
   - 外景：`scene-lights.ts` 的 `propLights(WORLD_LAYOUT.props)` 派生灯柱、售货机、咖啡机，
     不复制任何坐标；光心按贴图高度从脚底上抬（灯柱 −34、售货机 −30、咖啡机 −16）。
   - 室内：`InteriorArt.build()` 在绘制大屏、投影仪、壁灯、落地灯时把光位写进
     `lights: LightSpec[]`，渲染器只消费这个数组；禁止在光源模块复制 `x+138 / x+396 / screenX`。
   - 合计：29 灯柱 + 2 售货机 + 3 咖啡机 + 5 室内 = 39 个，落在 30–50 区间。

8. **灰度开关**。`?light=0` 关闭整层（保留旧行为）；`?lm=2` 切 1/2 光图看细节。
   两者都在 `buildLayers()` 读取一次，与 `?flat=1` / `?season=` 同一套惯例。

## 后果

- 正面：
  - 夜间从「整张图压 6%」变成真正的冷蓝暗调，灯柱、壁灯、机器与投屏各自形成局部光池；
  - 一帧只有一次低清 RT Pass + 一次点光源合批 + 两张全屏 quad，与 30–50 个光源数量解耦；
  - 视口外的光源不提交；白昼整层跳过；光源位置/尺寸的量化让光池落在像素栅格上，符合粗颗粒观感；
  - 环境光、局部光、冬季判定收敛到 `tone.ts` 一处，不再出现两套时间锚点。
- 负面：
  - 夜间整体亮度比现状低一档（约 0.6–0.7），这是让暖光「穿透」的前提；数值集中在
    `tone.ts` 的锚点表，接受不了可以单点抬高 `ambient`；
  - 灯心亮度上限是光图本身，不会出现 HDR 溢出式的过亮灯心；
  - 光图是屏幕空间全屏覆盖，昵称与气泡也会被环境底压暗（与旧柔光层一致）；
  - 不做光源遮挡/阴影投射：光会穿过墙体（例如宿舍壁灯会漏到墙外）。
    本期以氛围光池为目标，遮挡需要额外的距离场或遮罩通道，属于下一期；
  - 光斑纹理与 RT 是新增的手工资源，销毁顺序要先于 `app.destroy`。
- 回滚成本：低。`?light=0` 可线上关闭整层；代码回滚只需恢复 `ambient-light.ts`
  与 `renderer.ts` 的接线，`lighting/` 目录独立，不触碰协议与服务端。

## 验证与验收

已执行（2026-11-12）：

- `bun test lib/game/__tests__/lighting.test.ts`：14 pass / 0 fail，覆盖时段锚点、冬季更深、
  白昼增益 0、flicker 确定性与区间、圆-矩形剔除、注册表 CRUD/容量、`propLights` 派生。
- `bun test lib`：392 pass / 0 fail（含既有测试）。
- 隔离 `tsc --noEmit`（`lighting/*` + `interior-art.ts`）：通过。
- 外景光源实测 34 个（29 灯柱 + 2 售货机 + 3 咖啡机），加室内 5 个共 39 个。
- 三时段逻辑验收：11:00 → `#ffffff` / gain 0（整层隐藏）；18:00 → `#ffe8d3` / gain 0.60；
  00:00 → `#92a0bd` / gain 1.00（冷蓝底 + 暖光池）。
- 全量 `tsc` 仍被并行进行中的 `session.ts` / `RendererInit` 重构阻塞，与本次光影改动无关；
  在合并那条改动前，不能把「全量 typecheck 通过」写成已验证。

待浏览器验收：

- 正午（无灯、环境底接近白）、黄昏（暖底 + 灯渐亮）、深夜（冷蓝 + 暖光池）；
- `?season=winter` 更深一档；`?light=0` 完全关闭；`?lm=2` 光图更细；
- WebGPU 与 WebGL 各看一次 `multiply` / `screen` 是否正确；`lightmap.visibleCount`
  应通常为 2–10，且每帧只有一次 RT Pass。

## 复核信号

- 画面整体偏亮/偏灰：先确认 `multiply` 在对应后端生效（WebGPU 走 `GpuBlendModesToPixi.multiply`，
  WebGL 走 Pixi 的扩展路径），再查清屏 alpha 是否被写成 0。
- 夜间太暗、看不清地面：把夜间锚点的 `ambient` 从 0.68 降到 0.55–0.60，不要直接抬 `SCREEN_ALPHA`；
  抬 screen 会把冷蓝底洗灰。
- 灯下有色阶/条纹：先查光斑的 4 阶 + 抖动是否被 mipmap 或线性采样抹平；
  `scaleMode` 必须是 `nearest`，RT 不能开 `antialias`。
- 灯池边缘发糊或出现光斑漂移：检查光源位置是否被取整到 RT 像素、光图尺寸是否随视口正确 resize。
- 帧率下降：先看 `lightmap.visibleCount` 是否异常（应通常 2–10），再确认每帧只有一次 RT Pass；
  不要为了「更细」把默认分辨率从 1/4 抬到 1/2。
- 冬季夜里比夏季更蓝更暗：这是 ADR-0046 + 本 ADR 的预期行为；若冬季过暗，
  调 `WINTER_ANCHORS` 的 `ambient`，不要动夏季锚点。
