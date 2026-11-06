---
name: grass-organic-ground
overview: 参照现有草地纹理的「有机斑块 + 无接缝」生成方式重做全部地面材质：广场地面改为纯草地（仅保留石色路缘、围栏与花箱），土路保留土色但去掉大矩形拼块，水面/海面收敛成有机波纹，且不出现白色方块。
design:
  architecture:
    framework: react
  styleKeywords:
    - cozy pastel
    - pixel art
    - organic
    - warm
    - low contrast
    - seamless
  fontSystem:
    fontFamily: JetBrains Mono, Noto Sans SC
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 12px
      weight: 500
    body:
      size: 11px
      weight: 400
  colorSystem:
    primary:
      - "#6F9B57"
      - "#7AA862"
      - "#8FBD72"
      - "#3D5C33"
      - "#C9B998"
      - "#B3A284"
    background:
      - "#C8A27A"
      - "#D9C096"
      - "#4F9FB0"
      - "#2F6F86"
    text:
      - "#2B2118"
      - "#F4EDE1"
    functional:
      - "#4FE3C1"
      - "#D6C9AD"
      - "#7A5F3C"
todos:
  - id: remove-plaza-paving
    content: 移除广场地砖与 plaza 材质（terrain-edge / terrain / textures），广场只留石色路缘并更新单测
    status: completed
  - id: organic-ground-textures
    content: 用 [skill:layer-pixel-art] 提取共享有机斑块函数，重写土路/水面/海面纹理
    status: completed
    dependencies:
      - remove-plaza-paving
  - id: sync-palette-minimap
    content: 清理 plaza 调色板、放开广场贴花、小地图改草色加路缘描边
    status: completed
    dependencies:
      - remove-plaza-paving
  - id: adr-and-verify
    content: 用 [skill:domain-modeling] 补 ADR-0017，并用 [skill:verification-before-completion] 跑测试与类型检查
    status: completed
    dependencies:
      - organic-ground-textures
      - sync-palette-minimap
---

## 用户需求
- 参照当前草地已经采用的「有机斑块 + 平铺无缝」生成方式，重做全部地面材质，画面中不再出现白色或浅色方块。
- 广场那一大片浅奶油色地砖（64×32 错缝砖）必须整体消失，广场地面变成纯草地。
- 广场的辨识度靠保留的一圈石色路缘、现有围栏与花箱来维持。
- 土路保留土色，但纹理改为有机色斑，不再有 40–64×24–40 的大矩形拼块；水面、海面同样去掉直杠式重复。
- 小地图与主视图保持一致：广场不再显示为浅色块。
- 碰撞、网络同步、世界布局坐标与既有交互不变。

## 产品概述
全岛地面统一为暖绿草地：广场只由一圈石色路缘、围栏与花箱标出，脚下一整片连续草纹，没有任何铺装格线；土路是一条边缘长草的暖棕土面，近看是大小不一的色簇与石子，不再是一块块方砖；水面与海面是短波纹与泡沫点组成的柔和表面。整体仍是暖色 pastel 像素画，明度对比低，角色依旧是画面第一层。

## 核心特性
- 广场铺装移除：地砖、砖缝、广场专属地表材质与相应边缘处理全部删除，草地直接露出，零接缝。
- 路缘保留：广场轮廓外一圈石色路缘（外缘压一档深色缝），与围栏、花箱共同构成「办公区」。
- 土路有机化：暖棕底 + 单像素行色簇 + 石子/车辙噪点，平铺跨界不露直切边。
- 水面有机化：短波纹、浪脊与泡沫点，96px 平铺周期不变，滚动节奏不变。
- 小地图同步：广场只画路缘描边，不再填浅色矩形。
- 决策留档与验证：新增 ADR 说明本次取代关系，单测与类型检查覆盖材质判定变更。


## 技术栈
- Next.js 15 + React 19 + TypeScript 5.7（现有 `apps/web`）
- PixiJS 8.6（WebGPU/WebGL），纹理全部在 `renderer.init()` 后程序化烘焙，`antialias:false` + `nearest`
- 测试：`bun test`（`apps/web/lib/game/__tests__`）+ `tsc --noEmit`
- 不新增依赖、不引入外部美术资源

## 实现方案
1. **广场从「材质」降级为「装饰路缘」**：`materialAt` 在办公区返回 `grass`，`MATERIAL` 去掉 `plaza`，`MaterialId` 收敛为 0..6；`addGrass()` 本来就铺满整个世界矩形并用岛多边形遮罩，因此只要删掉广场平铺层，草地天然连续、零接缝、零额外填充。`addPlaza()` 只保留路缘：12px `plazaSeam` 打底 + 10px `plazaCurb` 面层（`alignment: 0` 外侧、整数像素），围栏与花箱不动。
2. **有机纹理共用一套生成器**：把 `makeGrassTexture` 里的 `grassPatch` 提为模块内 `organicBlob`（单像素行 + `wrappedRect` 跨界补画 + 固定 `seeded` 种子），草/土/水/海各自传半径与行高。土路 128px、水与海 96px 尺寸保持不变，避免动到 `WATER_TILE`/`SEA_TILE` 的滚动回绕。
3. **同步消费方**：`terrain-palette.ts` 删除只服务于地砖的 `plazaBase/plazaAlt/plazaHighlight/plazaEdge` 与 `EDGE_TINT.plaza`；`MiniMap` 去掉广场填充、保留 `plazaEdge` 描边；`grassDecorAllowed` 去掉广场矩形排除（它已经是草地），花海/野花规则不变。
4. **留档**：新增 `docs/adr/0017-grass-only-ground.md`，写明取代 ADR-0013 的广场铺装与 ADR-0016 的「广场压草」优先级、`edgeOutset=10`，以及回滚路径（`git revert` 本次提交；`?flat=1` / `?edge=0` 语义不变）。

### 关键取舍
- **移除材质而不是「保留浅色但去砖缝」**：用户明确「地面纯草」，任何浅色铺装面仍然会被读成白色方块；移除后还少一张 256×256 纹理、一个 TilingSprite、一个遮罩与一个 EdgeJob。
- **复用生成器而不是每材质各写一套随机**：平铺跨界与种子纪律只维护一份；差异全部通过显式参数（半径、行高、配色、图元密度）表达，避免隐式耦合。
- **不改 `WORLD_LAYOUT` 几何**：广场矩形仍是区域名、花箱与围栏的锚点，碰撞、出生点、AOI、单测全部零影响。
- **沙滩保持纯色带**：它没有重复图案、不存在方块感；为颗粒感新增贴花种类会打乱 `BLOOM_KIND_BASE` 与图集帧序，收益不抵风险。
- **材质 ID 重排是安全的**：`MaterialId` 只写进客户端 `Uint8Array` 采样格，不落库、不上协议；已确认消费方仅 `terrain-edge.ts`、`terrain.ts` 与该单测。

### 性能与可靠性
- 构造期一次性成本：删广场图层为净减少；土/水/海仍只生成数百至数千个 1px `rect`，与现状同量级。运行时不变：`update` 只改 `tilePosition`，`cull` 只翻 `renderable`，无新增每帧分配。
- 全部随机走 `seeded()` 或 `hashCell()`，无 `Math.random`；`wrappedRect` 保证四种平铺纹理在 128/96/512 边界无缝。
- 类型安全：`Record<MaterialId, EdgeStyle>` 强制删除 plaza 条目后仍穷尽；`paintRegion` 去掉只为广场存在的 `edgeOutset` 参数。

## 关键代码结构
```ts
export type MaterialId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const MATERIAL = {
  sea: 0, shallow: 1, sand: 2, grass: 3, dirt: 4, water: 5, bridge: 6,
} as const satisfies Record<string, MaterialId>;
```
```ts
// terrain-textures.ts 内共享的平铺有机斑块（由 grassPatch 提升而来）
function organicBlob(
  g: Graphics, centerX: number, centerY: number,
  radiusX: number, radiusY: number, size: number,
  color: number, random: () => number,
): void;
```

## 实施要点
- `materialAt` 优先级变为：桥 > 水（湖/河）> 土路 > 岸沙带 > 草地 > 浅滩 > 海；同步改注释与单测标题。
- `terrain.ts` 需清理：`makePlazaTexture` 导入、`TerrainTextures.plaza`、`PLAZA_TILE`、`destroy()` 中的 plaza 纹理、类注释里的层序说明。
- `addPaths` 仍走 `paintRegion`（轮廓遮罩 + 世界相位 `tilePosition`），草缘仍由 `flushEdges` 最后统一压上，草齿继续朝土路内侧长。
- 路缘宽度改动后不要引入浮点宽度；`alignment: 0` 在 Pixi 8 表示描边落在外侧，保持现有语义。
- 贴花允许长进广场后，仍受 64px 栅格与 12% 命中率约束，不新增种类、不改编排。
- 回滚边界：只动纹理工厂、地形视图、材质表、调色板、小地图与单测；不碰 `packages/shared-types`、服务端与协议。

## 目录结构
```
apps/web/lib/game/
├── terrain-textures.ts   [MODIFY] 删除 makePlazaTexture；将 grassPatch 提为 organicBlob；重写 makeDirtTexture（暖棕底 + 有机色簇 + 1px 石子/车辙，去掉 40–64×24–40 大矩形）、makeWaterTexture / makeSeaTexture（短波纹 + 浪脊 + 泡沫点，96px 不变）
├── terrain-edge.ts       [MODIFY] MATERIAL/MaterialId 收敛为 0..6；PAINT_ORDER、EDGE_DRAW_ORDER 移除 plaza；materialAt 不再返回 plaza；删除 EDGE_STYLE.plaza 条目并更新优先级注释
├── terrain.ts            [MODIFY] addPlaza 只画 12px 深缝 + 10px 面层路缘；移除 plaza 纹理/常量/paintRegion 与 EdgeJob；paintRegion 去掉 edgeOutset；grassDecorAllowed 放开广场；destroy 与类注释同步
├── terrain-palette.ts    [MODIFY] 删除 plazaBase/plazaAlt/plazaHighlight/plazaEdge 与 EDGE_TINT.plaza；保留 plazaSeam/plazaCurb；MINIMAP_COLORS 去掉 plaza 填充色
├── decals.ts             [MODIFY] 仅更新注释中「非广场」的说明，逻辑不变
└── __tests__/terrain-edge.test.ts [MODIFY] 「广场压草」用例改为广场点判定为 grass，标题与断言同步
apps/web/components/game/MiniMap.tsx [MODIFY] 广场不再 fill 浅色块，改为 1px 路缘描边（M.plazaEdge）
docs/adr/0017-grass-only-ground.md   [NEW] 记录「地面只剩草 + 土路、广场只留路缘」、材质 ID 收敛、对 ADR-0013/0016 的取代点、正负后果与回滚路径
```


## 设计风格
暖色 pastel 像素画（cozy pixel art）：低饱和的奶油绿地面、暖棕土路、浅沙与浅湖绿水面，全部颜色带色相，不使用纯白与纯黑；画面靠色温统一，不靠高对比。

## 地面语言
- 全岛一张 512px 草地纹理：圆润色簇 + 1px 草尖颗粒，无格线、无砖缝，广场位置与野地完全连续。
- 广场只保留一圈石色路缘：外缘一档深缝、面层浅石色，12px/10px 整数像素，配合围栏与花箱形成「办公区」边界。
- 土路 128px：暖棕底色上叠大小不一的浅棕/深棕斑簇，1px 石粒与短车辙，边缘 2px 草色骑线 + 朝内草尖。
- 水面/海面 96px：短波纹、浪脊与泡沫点，横向滚动 1px 步进，节奏与现在一致。

## 可读性与一致性
- 地面细节一律低对比，角色与树冠仍是最高对比层；草缘只在材质交界出现，广场内部不再有第二条边。
- 小地图与主视图同色系：草色底、路缘描边，不再出现浅色方块。
- 保持整数像素与 nearest 采样，放大 3 倍后仍是干净像素边，不出现半像素模糊。

## Agent Extensions
### Skill
- **layer-pixel-art**
  - Purpose: 指导土路/水面/海面三种平铺纹理的像素栅格、色簇与无缝边界处理，避免出现新的方块感
  - Expected outcome: 三种纹理在 128/96px 平铺下看不到接缝与重复格，全部图元落在整数像素
- **domain-modeling**
  - Purpose: 按项目既有 ADR 结构落成 0017 决策记录，写清取代点与回滚路径
  - Expected outcome: `docs/adr/0017-grass-only-ground.md` 可独立解释本次变更，不改写历史 ADR
- **verification-before-completion**
  - Purpose: 在收尾阶段以实际命令输出证明单测与类型检查通过，并核对 `?flat=1` / `?edge=0` 分支未被破坏
  - Expected outcome: `bun test lib/game/__tests__` 与 `tsc --noEmit` 全绿，附命令与结果
