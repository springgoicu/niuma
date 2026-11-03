---
name: map-terrain-redesign
overview: 重做世界地图地形：把 5 段阶梯矩形河流改成「中心线 + 河宽」生成的连续自然河道（带河岸沙滩、南北通海、木桥对齐），并在地面百分之百为草地的基础上增加零散孤树、成片花海等元素，同步更新碰撞、小地图与测试。
design:
  architecture:
    framework: react
  styleKeywords:
    - cozy pastel
    - meadow-first
    - pixel art
    - organic edges
    - layered depth
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 700
    subheading:
      size: 16px
      weight: 600
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#6F9B57"
      - "#7AA862"
      - "#8FBD72"
      - "#A9C98A"
    background:
      - "#1B1611"
      - "#2F2621"
      - "#4F9FB0"
    text:
      - "#F4EDE1"
      - "#8A8578"
    functional:
      - "#D9C096"
      - "#86CCD8"
      - "#E8B44A"
      - "#E0A9A0"
      - "#3D5C33"
todos:
  - id: river-data
    content: 新增 river.ts 河道几何，改造 layout.ts 的河道、孤树、花田数据与区域边界
    status: completed
  - id: collision-tests
    content: 更新 collision.ts 与碰撞测试，覆盖河道多边形、孤树阻挡与河口通海 [skill:test-driven-development]
    status: completed
    dependencies:
      - river-data
  - id: decal-textures
    content: 扩展贴花图集与调色板：新增三种花朵帧、花田过滤与草地叠层色 [skill:layer-pixel-art]
    status: completed
  - id: terrain-water
    content: 重写 terrain.ts 河道渲染：沙岸、遮罩水面、芦苇，并统一草底叠层 [skill:impeccable]
    status: completed
    dependencies:
      - river-data
      - decal-textures
  - id: terrain-decor
    content: 渲染全岛孤树与成片花海，接入视口裁剪、树冠遮挡与花田色层
    status: completed
    dependencies:
      - terrain-water
      - collision-tests
  - id: minimap
    content: 小地图绘制新河道多边形、孤树点与花田色块
    status: completed
    dependencies:
      - terrain-decor
  - id: verify-doc
    content: 补 ADR-0014，跑 turbo 类型检查与测试并复核画面回归 [skill:verification-before-completion]
    status: completed
    dependencies:
      - collision-tests
      - minimap
---

## 用户需求
地图显示异常，河流明显错位，需要重新设计整张地图的视觉。地面以草地为绝对主体，在草地之上叠加树木、花朵等自然元素。

## 产品概述
俯视角像素风园区地图：陆地地面百分之百是草地，广场、土路、湖、河、树林、花田都作为「建在草地上」的叠层元素。河流改为一条从北海岸贯穿到南海岸的连续自然河道，带沙滩河岸与芦苇，木桥仍是唯一过河口。

## 核心需求
- 河流重画：用中心线加河宽的折线河道替换现有 5 段阶梯矩形，消除 90 度断口、2px 错位与「凭空出现又消失」的两端；南北两端真正接入海面。
- 河岸过渡：河道两岸有沙滩带、浅色岸缘与芦苇点缀，和湖泊岸线的质感一致；水面顺流缓慢滚动。
- 草地为底：海岛与海岸线保持现状，岛内陆地全部以草地为基底，不允许出现草底以外的空地；林下与花田只是草地上的半透明色层。
- 树木：保留现有三片大林，新增散布全岛的孤树；孤树参与碰撞，树冠仍会在角色经过时半透明让路。
- 花朵：草地随处有小花簇，并新增若干片成片花海（白雏菊、金色、暖粉三组配色）；花海成片、有边界感，不是随机噪点；花朵纯装饰，不阻挡行走。
- 小地图同步：新河道按多边形绘制，孤树与花田有极简表达，和主视图始终一致。
- 不改变：出生点、广场、花箱、四门洞、围栏、土路、湖泊的位置与手感；木桥仍横跨河道并与西侧土路对接。

## 视觉目标
温暖低饱和的 cozy pastel 像素风：草地占画面约七成，河面是冷色呼吸点，花海是小面积色彩高潮，树林提供层次与阴影；所有边界都是有机曲线或细碎草缘，不出现硬直角与纯黑描边。


## 技术栈
- 沿用现有栈：pnpm workspace + turbo；`packages/shared-types`（纯 TS，同构契约）、`apps/web`（Next.js + Pixi 8 + React）、`apps/game-server`（Bun）、Vitest。
- 不引入新依赖、不新增渲染框架、不改协议与世界常量（8192×8192）。

## 实现策略
把「河流」从「若干矩形」升级为**中心线驱动的带状多边形**，几何在 `shared-types` 内一次性确定生成，碰撞、主视图、小地图三方继续共用同一份数据；渲染端统一用「多边形遮罩 + 世界相位平铺」画水，取代逐段矩形铺贴。草地保持铺满全岛，其它地面一律降级为半透明叠层与装饰层。

关键决策与理由：
1. **新增 `world/river.ts`，用 miter 偏移生成左右岸**：每个站点取相邻两段单位法线的角平分线，按 `halfWidth / dot(miter, normal)` 缩放后取整。只使用 `+ - * /` 与 `Math.sqrt`（IEEE-754 正确舍入，JSC/V8 一致），输出整数坐标，满足 layout 的「禁止 Math.sin/cos/random」纪律；相比逐站点独立法线，miter 保证外弯不裂口、内弯不自交。
2. **`RiverShape` 同时给出 `polygon / leftBank / rightBank / centerline / rect`**：碰撞与小地图用闭合多边形，渲染用两条开口岸线画沙滩（河口不封口，避免沙带横在海面上），`rect` 供平铺与空间索引。
3. **保留 `rivers: RiverShape[]` 数组形态**：未来加支流不用改消费方；删除 `RiverSegment` 与 `flow` 字段（全仓已确认仅 5 处引用）。
4. **桥与河的解耦靠「直段约束」**：中心线在 y 4006..4186 保持 x=2488 直行、半宽 112，水面恒为 x 2376..2600，现有木桥 2336..2640 两侧各余 40px，`isOnBridge` 放行逻辑完全不动。
5. **孤树与花田进入 `WorldLayout`**：`wildTrees: TreeInstance[]`（参与碰撞）与 `flowerFields: FlowerPatch[]`（不参与碰撞）。用 260px 栅格 + `isPlantable` 过滤（广场/围栏/土路/河/湖/桥/森林/花田/出生圈），保证不与现有 500 余棵树重复堆叠。
6. **花朵复用贴花图集**：`DECAL_KINDS` 从 4 种扩到 7 种，图集从 64×16 扩到 112×16，仍是一张纹理；`scatterDecals` 增加 `{ chance, kinds }` 选项，基础层低概率混入花簇，花田层高概率只撒花。纹理只生成一次，不新增 texture handle。
7. **「草地百分之百」落在渲染层**：`addGrass` 的岛形遮罩保持不变；林下地面改为 alpha 0.55 的草地色层 + organicContour 细碎边缘；花田额外叠一层 alpha 0.35 的暖绿草色，再撒花。任何新地面都不得使用不透明实色矩形。

性能与可靠性：
- 河面改为 1 个遮罩 `TilingSprite`（原 5 个矩形），draw call 减少；遮罩与湖面同款，属已验证路径。
- 孤树约 100–120 棵、花海贴花约 250–350 个精灵，全部进 `cullables`，离屏 `renderable=false`；`cull` 是 O(n) 的布尔赋值，总量从约 2500 增到约 2900，帧成本可忽略。
- 碰撞障碍增加约 110 个圆，仍走 128px 网格索引，单次查询只碰邻近桶；`resolveMotion` 的 4px 子步与滑行逻辑不变。
- 帧循环零分配纪律不变：河道与花田均为构造期生成，`update` 只滚 `tilePosition`。
- 服务端只用 `isBlocked / findFreePoint / isOnLand`，孤树自动生效，无需改协议或服务端代码。

## 架构与数据流
```
layout.ts（唯一真相）
  ├─ river.ts 生成 RiverShape（岸线 + 多边形 + 包围盒）
  ├─ collision.ts → 河道多边形 + 孤树圆 作为 water / solid 障碍
  ├─ terrain.ts  → 沙岸 stroke + 多边形遮罩水面 + 孤树/花海精灵
  └─ MiniMap.tsx → 多边形河道 + 孤树 1px 点 + 花田色块
```
职责边界：`shared-types` 只描述「世界是什么」，不依赖 Pixi/DOM；配色、贴图、滚动速度留在 `apps/web/lib/game`；小地图只消费布局，不采样主视图。

## 实施要点
- 河道中心线手写站点，锚点：北河口 (2500, 90) → 海岸 y=150 → 中段摆动幅度 ≤ 64px → 桥段 x=2488 直行 → 南河口 (2488, 7960)；`y > 4400` 段中心线 x ≥ 2452，保证西岸沙带外缘离岛岸仍有 50px 以上草地。
- 水域多边形向海内延伸约 60px，岸线沙滩只画岛内站点，杜绝「沙坝横在海面」。
- `isPlantable` / `decalAllowed` 改用 `isWaterAt(x, y)`（湖泊多边形 + 河道多边形）替代矩形判断；新增导出 `isWaterAt` 供两处复用，避免第三份水面判定。
- `regionAt` 的「周报河」改用 `rectExpanded(river.rect, 30)`，与西侧森林矩形保持 20px 净距，既有区域测试不回归。
- 河口顶点在海里，原测试「所有静态地形都在岸线以内」必须改为「岛内岸线站点在岸线以内，且两个河口站点在岸线之外」，否则会误报。
- 贴图新增帧必须底对齐画在 y=16，`anchor(0.5,1)` 不变；新颜色写入 `TERRAIN_COLORS`，禁止纯黑与中性灰。
- `destroy()` 无需新增纹理释放，但新增 Container/Graphics 需随 `ground` 一并销毁。

## 目录结构
```
packages/shared-types/src/
├── index.ts                                  # [MODIFY] 追加 export * from './world/river'
├── world/
│   ├── river.ts                              # [NEW] 河道几何：站点法线、miter 偏移、左右岸、闭合多边形、包围盒；纯函数、整数输出、无三角函数
│   ├── layout.ts                             # [MODIFY] 删除 RiverSegment，新增 RiverShape/FlowerPatch/wildTrees/flowerFields/RIVER_HALF_WIDTH/RIVER_SHORE；重写 RIVERS 数据、isPlantable、REGIONS、isWaterAt
│   ├── collision.ts                          # [MODIFY] 河段改用 river.polygon；孤树注册 circle blocker；保持 water+isOnBridge 放行
│   └── __tests__/
│       ├── river.test.ts                     # [NEW] 河宽恒定、左右岸不交叉、桥段水面落在桥内、两河口在岛外、河道不穿广场与土路
│       └── collision.test.ts                 # [MODIFY] 河段挡人、树木不落水/不压路、静态地形离岸 24px、孤树数量与花田不阻挡
apps/web/lib/game/
├── decals.ts                                 # [MODIFY] DECAL_KINDS 增加 bloomWhite/bloomGold/bloomRose；scatterDecals 支持 chance 与 kinds 过滤
├── terrain-textures.ts                       # [MODIFY] makeDecalAtlas 扩到 112×16，新增三帧 16×16 花朵（底对齐、1px 暗边）；图集宽度由 DECAL_KINDS.length 推导
├── terrain-palette.ts                        # [MODIFY] 新增 petalRose/meadowTint/meadowShade 与 MINIMAP_COLORS.meadow；forestFloor 调亮一档
├── terrain.ts                                # [MODIFY] addRiver（沙岸 + 遮罩水面 + 沿岸芦苇）、addGrass/林下层叠、addWildTrees、addFlowerFields、decalAllowed 改用 isWaterAt、destroy 兜底
apps/web/components/game/
└── MiniMap.tsx                               # [MODIFY] 河道 polygon 绘制、孤树小点、花田半透明色块
docs/adr/0014-river-meadow-terrain.md         # [NEW] 决策记录：中心线河道、草地叠层、孤树与花海、桥段约束与回滚方式
```

## 关键数据结构
```ts
export interface RiverShape {
  /** 闭合水面多边形：碰撞、小地图、水面遮罩唯一来源 */
  readonly polygon: Point[];
  /** 顺流方向左侧岸线（开口，不闭合），仅用于画沙滩 */
  readonly leftBank: Point[];
  /** 顺流方向右侧岸线（开口，不闭合） */
  readonly rightBank: Point[];
  /** 中心线站点，供测试取样与后续支流扩展 */
  readonly centerline: Point[];
  readonly rect: WorldRect;
}

export interface FlowerPatch {
  readonly rect: WorldRect;
  /** 0 白雏菊 / 1 金盏 / 2 暖粉 */
  readonly palette: 0 | 1 | 2;
}

export const RIVER_HALF_WIDTH = 112;
export const RIVER_SHORE = 24;
```


## 设计方向
温暖低饱和的 cozy pastel 俯视像素风，主体是「一片会呼吸的草地」。画面用 70% 草地做底，暖沙色广场与土路作为人造痕迹，河流提供唯一的大面积冷色，花海提供小面积色彩高潮，树林负责纵深与遮挡。

## 构图与层次
由下至上：深海 → 浅滩 → 沙滩 → 岛形草地（满铺）→ 林下草色层 / 花田草色层 → 广场与土路 → 湖与河 → 岸线沙带与芦苇 → 树、花、花箱、围栏、角色。所有自然边界用有机曲线 + 2px 草缘 + 1px 碎草齿，禁止直角切口与纯黑描边。

## 河道语言
河道是一条宽窄稳定的缓弯缎带：中心线在桥段保持笔直，上下游各做两到三次缓弯，摆动幅度小于半个河宽；两岸是 24px 沙带 + 4px 浅沙岸缘，沙带在河口自然断开，让河水直接汇入海面。水面用 48px 波纹图块顺流滚动，河湾内侧放芦苇，外侧放碎石，形成「水在流」的第一眼印象。

## 树木与花海
三片大林保留为深一档的草色块 + 高密度树冠；草地上每隔一段距离出现一棵孤树，作为行走时的地标与遮挡点。花海是 3–4 片不规则草甸色块，内部花朵密度约为普通草地的四倍，按白、金、暖粉分组，边缘用递减密度自然收口，避免出现矩形花圃。

## 动效与响应
只保留三种动效：水面整数像素滚动、树冠遮挡时淡到 0.85、角色呼吸。相机缩放下所有纹理保持 1:1 nearest 采样，不出现模糊；小地图 4Hz 刷新，河道、孤树、花田与主视图同形同色系。HUD 文字保持高对比暖白，重要信息不依赖颜色单独传达。

## Agent Extensions
### Skill
- **test-driven-development**
  - Purpose: 先写河道几何与碰撞的失败测试，再实现 `river.ts` 与 `collision.ts` 改动
  - Expected outcome: 河宽、桥段通行、河口通海、孤树阻挡等用例全部由红转绿
- **layer-pixel-art**
  - Purpose: 设计 16×16 花朵贴花帧与花海配色，保证像素对齐、底对齐与 1px 暗边纪律
  - Expected outcome: 三帧花朵在 112×16 图集中无抗锯齿、无错位，可直接被 `frames[]` 采样
- **impeccable**
  - Purpose: 复核地形改版后的色彩层次、河岸过渡与 HUD 小地图视觉一致性（遵循 ADR-0013 暖色体系）
  - Expected outcome: 无硬直角、无纯黑描边、草地为绝对主体，形成可交付的视觉结论
- **verification-before-completion**
  - Purpose: 在收尾阶段实际运行类型检查与测试并核对输出，再声明完成
  - Expected outcome: turbo 类型检查与 Vitest 全绿，附实际命令结果
