---
name: niuma-ring-canal-trees-fish
overview: 绕四角院落开一圈 64px 宽的「护园溪」：北、西、东三面新开，南面由晨会溪自然闭合；四个方向各一座木桥。园区四周补三片林带、桥头花箱与河岸芦苇碎石；周报河、晨会溪与护园溪里加入纯客户端游动的小鱼。
todos:
  - id: canal-layout
    content: layout.ts 开护园溪、三座新桥、出生点与横幅、三片林带与八个花箱
    status: completed
  - id: river-decor
    content: terrain.ts 沿三条河撒芦苇碎石，确认新河与桥自动渲染
    status: completed
    dependencies:
      - canal-layout
  - id: fish-client
    content: 用 [skill:layer-pixel-art] 扩鱼图集，新增撒点、游动与 FishField 图层
    status: completed
    dependencies:
      - canal-layout
  - id: tests-sync
    content: 更新河、桥、密度、出生点、图集与鱼测试并补新断言
    status: completed
    dependencies:
      - canal-layout
      - river-decor
      - fish-client
  - id: adr-readme
    content: 用 [skill:principal-software-architect] 写 ADR-0045 并更新 README
    status: completed
    dependencies:
      - canal-layout
      - fish-client
  - id: verify
    content: 用 [skill:verification-before-completion] 跑测试与类型检查，验收环河四桥与鱼
    status: completed
    dependencies:
      - tests-sync
      - adr-readme
---

## 用户需求
在牛马园四角院落外围增加树木、河流等装饰，并让河流里出现游动的小鱼。

## 产品概述
从北门进入时，四角院落四面环水：北、西、东三面新开一条「护园溪」，南面由既有晨会溪自然闭合，四个方向各有一座木桥；桥外三片新林带、桥头花箱与河岸芦苇把园区围出层次。周报河、晨会溪与护园溪里各有小鱼来回游动，纯氛围表现，不影响玩法与网络同步。

## 核心功能
- 环形护园溪：约 64px 宽的 U 形小溪，北、西、东三段，两端汇入晨会溪；北门桥、西桥、东桥新建，南向复用既有晨会溪桥，形成四向环水。
- 北门适配：出生点移到溪内侧，欢迎布幡挂到北岸，指路牌保留；玩家从北门桥进入园区。
- 绿化装饰：西北、西岸、东岸各补一片林带；四座桥头共补八个花箱；沿三条河岸撒芦苇与碎石；上一轮与环河冲突的西北花海移到西岸。
- 小鱼：周报河、晨会溪、护园溪各 6 条，共 18 条；沿河道往返游动、两帧摆尾、到端点转身；不同玩家看到的个体不同。
- 视觉：水面、桥面、河岸沙带沿用现有像素材质；鱼在水面之上、角色与道具之下，活动范围避开桥面，不挡路、不参与碰撞。


## 技术栈
- 沿用现有 Monorepo：pnpm + Turborepo、TypeScript 5.7。
- 共享布局：`@niuma/shared-types` 纯 TS，不依赖 Pixi / DOM / Bun。
- 客户端：Next.js 15 + Pixi.js 8；水面、桥、河岸继续走 `TerrainView` 的构造期烘焙与 TilingSprite。
- 服务端：Bun + TS；本轮不改协议、不改模拟，只复用共享布局里的新河与新桥。
- 测试：shared-types 用 vitest，web / game-server 用 bun test；不新增依赖。

## 实现方案

### 1. 环河几何：U 形三段，南面由晨会溪闭合

在 `packages/shared-types/src/world/layout.ts` 增加一条折线河，半宽 32（水宽 64，比晨会溪窄一档）：

| 段 | 中心线 | 水面范围 |
|---|---|---|
| 西臂 | x = 3200，y 4960 → 3260 | x 3168–3232 |
| 北臂 | y = 3230，x 3200 → 4992 | y 3198–3262 |
| 东臂 | x = 4992，y 3260 → 4960 | x 4960–5024 |

- 两端落在晨会溪水面内（y 4868–5012），与既有河网连通，不另做缺口。
- 与院落外墙的间距：西/东 104px，北 214px，南侧 152px 到晨会溪北岸。
- 新增 `PARK_CANAL_HALF_WIDTH = 32`；`RIVERS` 追加第三项，名称「护园溪」。
- 桥三座（南向复用既有晨会溪桥，共四向）：
  - 北门桥 `{ x: 3984, y: 3180, w: 224, h: 100 }`，跨北臂并托住门洞通道；
  - 西桥 `{ x: 3120, y: 4004, w: 160, h: 168 }`、东桥 `{ x: 4912, y: 4004, w: 160, h: 168 }`；
  - 桥面覆盖水面并留 18px 以上余量，`isOnBridge`、材质网格、小地图自动生效。

### 2. 出生点与北门地标

- `SPAWN_CENTER` 从 (4096, 3300) 移到 (4096, 3352)，`SPAWN_RADIUS` 72 → 56：出生圈 3296–3408，落在北臂内侧（3262）与院落北缘（3476）之间，不碰水。
- `WELCOME_LANDMARKS.banner` 从 y 3404 移到 y 3290：柱子落在北岸，布幡覆在水面上方；`signpost` 保留 (4280, 3396)。
- 北门区域仍为 `{ 3824, 3184, 544, 292 }`，出生与地标继续报「牛马园北门」。

### 3. 绿化与河岸装饰

- 新增三片林地（`FOREST_RECTS` 7 → 10）：
  - 西北 `{ x: 2900, y: 2860, w: 420, h: 300 }`；
  - 西岸 `{ x: 2900, y: 3450, w: 220, h: 520 }`；
  - 东岸 `{ x: 5240, y: 3480, w: 300, h: 500 }`。
- 上一轮补的西北花海 `{ 3168, 3204, 300, 220 }` 与环河西北角冲突，移到 `{ 2880, 3260, 240, 150 }`，花海总数仍为 6。
- 桥头花箱 8 个（`PLANTERS` 6 → 14）：北桥 (3950, 3300)/(4240, 3300)，西桥 (3080, 3990)/(3080, 4200)，东桥 (5100, 3990)/(5100, 4200)，南桥 (3920, 4780)/(4270, 4780)。
- `apps/web/lib/game/terrain.ts` 的 `addDecor()` 增加河道版：沿每条 river 的多边形外侧 15–55px 撒芦苇/碎石，复用 `addDecalSprite`，每河上限约 30 个；落点要求 `!isWaterAt` 且不压任何 PATHS / BRIDGES。

### 4. 小鱼：纯客户端、共用小动物图集

- 图集：`critter-art.ts` 的 12×10 共 120 格，已用 114 格；新增 1 物种 × 3 配色 × 2 帧（尾左/尾右）= 恰好 6 格，`fishCell(variant, frame)` 从 114 起，图集刚好画满。
- 撒点：`critter-spawn.ts` 新增 `planFish(seed)`：
  - 沿每条 river 中心线每 32px 取候选点，要求 `isWaterAt`；
  - 离所有 `BRIDGES` / `DOCKS` 矩形至少 110px，同河鱼间距至少 120px；
  - 每条河 6 条，共 18 条；每条鱼带 home、沿河切向 dir、60–120px 往返 range；
  - range 端点与 1/2、1/4 处都必须 `isWaterAt`，否则对半收缩。
- 游动：`critter-motion.ts` 新增 `Fish` / `createFish` / `stepFish`：沿 dir 在 ±range 间往返，到端点翻转；3px 侧向摆尾（客户端允许 sin/cos）；两帧尾摆 140ms；落屏只取整数纹素。
- 渲染：新增 `apps/web/lib/game/fish.ts` 的 `FishField`，与 `CritterField` 同构：
  - 构造期一次性建满精灵，运行期不增删；
  - 视口外不跑状态机，只置 `visible = false`；
  - 帧内零分配，坐标/纹理/镜像先比较再写；
  - 鱼层插在 `props.base` 之后、`fx` / `waterFx` 之前（水面之上、角色和树之下），不参与 y 排序、不写 depth；精灵 `alpha` 约 0.9。
- 图集所有权：`bakeCritterArt` 由 renderer 持有并传给 `CritterField` 与 `FishField`；两个 Field 的 `destroy` 只销毁自己的精灵，art 由 renderer 统一销毁；`?critters=0` 同时关闭鱼，另加 `?fish=0` 只关鱼。
- 鱼只撒在 `WORLD_LAYOUT.rivers`，湖与水塘不撒。

### 5. 区域名与包围盒陷阱

- 不能用 `river.rect` 生成护园溪区域：U 形包围盒会覆盖整个院落，`regionAt` 会把办公区报成「护园溪」。
- `REGIONS` 改为显式水体区域：周报河、晨会溪仍用 `rectExpanded(river.rect, 30)`；护园溪只用西臂 `{ 3160, 3260, 90, 1700 }` 与东臂 `{ 4950, 3260, 90, 1700 }` 两条窄矩形，北臂交给「牛马园北门」命中。
- 房间区域仍排在办公区之前，护园溪水体区域排在林地与北门之前。

### 6. 性能与可靠性

- 新增内容：1 条河、3 座桥、3 片林地（约 20–30 棵树）、8 个花箱、约 90 个芦苇/碎石贴花、18 条鱼；无新协议、无服务端模拟。
- 鱼共用同一张 384×320 图集与同一个 `TextureSource`，稳定合批；同屏通常 2–5 条，屏外零状态机。
- 河岸芦苇/碎石在构造期一次性生成，帧循环不分配；水面仍只有 TilingSprite 的相位滚动。
- 水全域可涉水（ADR-0030），新河不会改变寻路可达性；桥只负责表现与材质优先级。

## 架构设计

- `shared-types` 仍是唯一真相：护园溪加入 `WORLD_LAYOUT.rivers`，三座桥加入 `BRIDGES`；服务端碰撞、客户端渲染、小地图、指路牌与寻路自动复用。
- 渲染层只新增一个 `FishField` 图层；鱼复用 ADR-0042 的小动物图集、视口裁剪与零分配纪律。
- 服务端零改动；不新增模块边界，不改变既有数据流。

## 目录结构

```text
niuma/
├── packages/shared-types/src/world/layout.ts      # [MODIFY] 新增护园溪折线、三座桥、出生点/横幅、三片林地、
│                                                  #   八个桥头花箱、花海迁移、护园溪窄臂区域、留白判定
├── packages/shared-types/src/world/river.ts       # [不变] buildRiver 已支持折线，无需改
├── packages/shared-types/src/__tests__/
│   ├── river.test.ts                              # [MODIFY] 三条河、护园溪自交/区域、桥面按 PATHS 方向验证
│   ├── collision.test.ts                          # [MODIFY] 桥索引、出生点/横幅、静态地形岸线内、跨路桥
│   └── layout-density.test.ts                     # [MODIFY] rivers 3、forests 10，实测密度窗口
├── apps/game-server/src/sim/resume.test.ts        # [MODIFY] 出生中心/半径变化后的采样断言（如写死）
├── apps/web/lib/game/terrain.ts                   # [MODIFY] addDecor 增加河道芦苇/碎石，校验新河渲染
├── apps/web/lib/game/critter-art.ts               # [MODIFY] fishCell + 6 格鱼帧，图集恰好 120 格
├── apps/web/lib/game/critter-spawn.ts             # [MODIFY] FISH_POPULATION / planFish
├── apps/web/lib/game/critter-motion.ts            # [MODIFY] Fish / createFish / stepFish
├── apps/web/lib/game/fish.ts                      # [NEW] FishField：精灵、视口裁剪、零分配更新
├── apps/web/lib/game/critters.ts                  # [MODIFY] 不再销毁共享图集，只销毁自己的精灵
├── apps/web/lib/game/renderer.ts                  # [MODIFY] 共享图集、fishLayer、?fish=0、destroy 顺序
├── apps/web/lib/game/__tests__/
│   ├── critter-art.test.ts                        # [MODIFY] touched 120 格
│   ├── critter-spawn.test.ts                      # [MODIFY] 鱼撒点可复现、全在水里、避开桥
│   ├── critter-motion.test.ts                     # [MODIFY] 鱼往返、转身、尾摆帧
│   └── nav.test.ts                                # [MODIFY] 出生点移动后的八向断言（如写死）
├── apps/web/components/game/MiniMap.tsx           # [不变] 自动读取 rivers/bridges
├── docs/adr/0045-ring-canal-and-river-fish.md     # [NEW] 环河、四桥、林带、鱼与回滚路径
└── README.md                                      # [MODIFY] 地图段补护园溪、三片林带与河鱼
```

## 测试与验收

- 更新 `river.test.ts`：河道循环加入护园溪；护园溪多边形闭合、无自交；桥面覆盖测试改为「按桥中心所在 PATHS 的长轴判断通行方向，量垂直方向的水面跨度，要求桥面两侧各留 16px 以上」，不再用 `bridge.h > bridge.w` 与固定 `RIVER_HALF_WIDTH`。
- 更新 `collision.test.ts`：「晨会溪两座桥」改用明确索引；出生点/横幅/指示牌按新常量；新增桥头花箱与护园溪跨路断言。
- 更新 `layout-density.test.ts`：rivers 3、forests 10、花海 6；跑完若某个 512 窗口超过 45%，优先补孤树或草甸，不放宽阈值。
- 更新 `critter-art.test.ts`（120 格）与 `critter-spawn/motion.test.ts`（鱼共 18 条、全在水里、避开桥、往返不越界、转身翻转）。
- 服务端 `resume.test`、`movement.test`、`seats.test` 与客户端 `pathfinding.test`、`nav.test`、`terrain-edge.test` 全量回归。
- 验收：`pnpm test`、`pnpm typecheck` 全绿；本地从北门进入，能过北门桥、绕行护园溪、看到四座桥与三片林带，河里的小鱼来回游动且不上桥。

## 实现注意

- `shared-types` 的世界坐标仍然禁止 `Math.random` / `Math.sin` / `Math.cos`；鱼摆尾的 sin 只允许在客户端 `critter-motion.ts`。
- 护园溪北臂距北湾海岸仅 40px，桥、岸线、布幡都要确认不落进海水；出生圈与水面只余 34px，必须跑 400 次出生采样。
- 区域名必须用窄臂矩形，不能用 U 形包围盒；否则整个院落会被报成「护园溪」。
- 鱼层在桥面之上，撒点必须避开 `BRIDGES` / `DOCKS`，否则会出现「鱼在桥板上游」。
- 图集只剩 6 格：鱼严格按 1 物种 × 3 配色 × 2 帧，不加第三种帧；新增鱼先看 `critter-art.test` 的越界断言。
- 共享坐标是双端唯一真相，本轮仍需客户端与服务端同版本发布。


### Skill
- **principal-software-architect**
  - Purpose: 按项目 ADR 惯例写 ADR-0045，列出完整矩形环河、双桥、独立鱼图集、服务端同步鱼等备选方案与回滚路径。
  - Expected outcome: 一份可复核的决策记录，明确 U 形环河、出生点搬迁、鱼共用图集与双端发布约束。
- **layer-pixel-art**
  - Purpose: 在小动物图集最后 6 格绘制 3 配色 × 2 帧的 32px 小鱼，保持 1:1 硬边、统一调色板与不越界。
  - Expected outcome: 图集恰好 120 格、鱼帧可辨识、`critter-art.test` 全绿。
- **verification-before-completion**
  - Purpose: 在声明完成前跑全量测试与类型检查，并核对出生点、四座桥、三片林带与鱼群。
  - Expected outcome: `pnpm test` 与 `pnpm typecheck` 全绿，附带环河与鱼群的验收证据。
