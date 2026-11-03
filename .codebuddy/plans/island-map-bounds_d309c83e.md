---
name: island-map-bounds
overview: 把 8192×8192 的无限感园区改造成一座有明确边界的海岛：陆地收缩到现有地形内容包围盒，海岸线外是深海与沙滩，玩家被海岸线挡住，相机与小地图同步表达"地图到此为止"。
todos:
  - id: island-contract
    content: 用 [skill:principal-software-architect] 复核边界归属，在 shared-types 落地海岛折线与 isOnLand
    status: completed
  - id: island-collision
    content: 海岸网格接入 isBlocked 与 findFreePoint，补边界及地形全在陆地的单测
    status: completed
    dependencies:
      - island-contract
  - id: island-render
    content: 深海纹理、草地遮罩、沙滩浅滩浪花与海面滚动落地 terrain 三件套
    status: completed
    dependencies:
      - island-contract
  - id: camera-minimap
    content: 相机按岛屿包围盒 clamp，小地图补海色、岛形与海岸线
    status: completed
    dependencies:
      - island-render
  - id: docs-adr
    content: 新增 ADR-0012 并更新 README 地图与地形章节
    status: completed
    dependencies:
      - island-collision
      - island-render
      - camera-minimap
  - id: verify
    content: 用 [skill:verification-before-completion] 跑 typecheck/test/build 并沿岸走查
    status: completed
    dependencies:
      - docs-adr
---

## 用户需求
当前园区是 8192×8192 的草地铺满整个世界，边缘没有任何可视阻挡：玩家会撞上看不见的墙，走到尽头还会看到世界外的黑色。需要让地图有明确范围。

## 产品概述
把园区改造成一座有边界的小岛：陆地收缩到现有森林、河流、湖泊、道路所在的范围，外侧是一圈沙滩、浅滩与深海。玩家走到岸边会被海岸线自然挡住，看到的是海而不是虚空；小地图也能看出岛的形状。

## 核心功能
- **海岛边界**：陆地范围收缩到现有地形内容包围盒，海岸线为手写折线，含北、东、南、西南四处海湾，避免方盒子岛。
- **海岸阻挡**：玩家无法走进海里，贴岸行走可沿滑动，不会卡死；出生点、脱困点始终落在陆地。
- **海岸视觉**：沙滩、浅滩、浪花三层过渡，深海水面缓慢流动，保持像素风与现有暗色苔绿基调。
- **镜头表现**：相机被限制在岛屿范围内，靠近海岸时玩家仍在画面中心，画面上只出现海与岛，不露出黑色虚空。
- **小地图**：底色改为海色，绘制岛屿陆地与海岸线，靠近海岸时能看出海陆边界。
- **玩法不变**：移动速度、协议、AOI、服务端权威结算、既有地形与出生点均不改。

## 技术栈
- 复用现有 monorepo：TypeScript 5 strict、pnpm + Turborepo、`@niuma/shared-types` 同构地形契约。
- 渲染保持 PixiJS 8 + 程序化 1:1 纹理；小地图保持 Canvas 2D；服务端保持 Bun 权威 Tick。
- 不新增依赖，不改移动协议，不改 `WORLD_WIDTH` / `WORLD_HEIGHT`。

## 实现思路
核心是"海岸线即边界"：在 `packages/shared-types/src/world/layout.ts` 增加一份海岛折线，服务端碰撞、客户端预测、主视图与小地图全部消费同一份数据。`isBlocked` 在原有障碍物之外增加"不在陆地上"的判定，玩家天然走不出去；渲染侧用海面铺底 + 草地多边形遮罩，把原来的满屏草地裁成一座岛。

### 关键决策与权衡
1. **多边形海岸线（推荐） vs 矩形边界**：多边形能贴住现有内容并切出四处海湾，避免"方盒子岛"；矩形实现最省，但会在北侧、西南、南中、东侧留下大片空草地，与"收缩到内容包围盒"的目标冲突。为控制热路径成本，海岸线用 128px 网格预分类，内陆与深海 O(1)，只有边界格做多边形精确判定。
2. **世界常量不变（推荐） vs 缩小世界**：改 8192 会牵动 u16 定点量化、移动包、AOI 与服务端压测脚本，收益只是坐标变小；保持常量、只收缩可活动陆地，风险最低。
3. **草地多边形遮罩（推荐） vs 逐格判定贴图**：遮罩复用湖面已有做法，一次 draw 完成；逐格贴图会产生上千个 sprite。风险是 WebGPU 下依赖 stencil，湖面已有先例，需在低端机实测。

### 海岛几何
陆地范围约为内容包围盒外扩 50–80px，四周海面，四处海湾切掉空草地。坐标全部手写、轴对齐、落在像素栅格上：

```ts
// packages/shared-types/src/world/layout.ts
export const ISLAND_POINTS: Point[] = [
  [780, 150],   [2500, 150], [2500, 2700], [5100, 2700], [5100, 150],
  [7680, 150],  [7680, 2560], [7050, 2560], [7050, 5900], [7680, 5900],
  [7680, 7930], [5250, 7930], [5250, 7150], [2900, 7150], [2900, 7930],
  [2260, 7930], [2260, 4400], [780, 4400],
];
export const ISLAND_BOUNDS: WorldRect = polygonBounds(ISLAND_POINTS);
```

四处海湾与内容的净距必须满足：北湾（x 2500–5100，y 小于 2700）离北向土路 200px；东湾（x 7050–7680，y 2560–5900）离摸鱼湖 136px、离南北森林各 76px 以上；南中湾（x 2900–5250，y 大于 7150）离周报河末端 99px、离东南森林 102px；西南湾（x 小于 2260，y 大于 4400）离桥头 214px、离河西岸 116px。所有围栏、道路、河段、湖面、森林、花箱、桥必须落在折线内部且距海岸至少 24px，由单测守住。

## 实现细节
### 1. 契约层
- `layout.ts`：新增 `IslandShape { points: Point[]; bounds: WorldRect }`、`ISLAND`、`ISLAND_SAND = 26`、`ISLAND_SHALLOW = 72`、`ISLAND_FOAM = 2`，并加入 `WorldLayout.island`。
- 导出 `isOnLand(x, y, radius = 0)`：先用 `bounds` 快速排除，再做 `pointInPolygon` + `distanceSqToPolygon` 精确判定，半径按玩家碰撞半径内缩。
- 数据保持手写、确定性，禁止在布局里使用 `Math.random` / `Math.sin` / `Math.cos`。

### 2. 碰撞层
- `collision.ts`：`isBlocked` 开头增加岛外判定；保留原有 blockers 逻辑，顺序为"先判陆地，再判围栏/树/水"。
- 在同文件建立 128px 海岸网格：单元格中心距折线超过"半对角 + 玩家半径"的标记为纯陆或纯海，其余标记为边界格；纯陆/纯海走 O(1)，只有边界格做精确几何。
- `insideWorld` 改为 `isOnLand` 语义，`findFreePoint` 的环形搜索同时受陆地约束；起点在岛外时先夹回岛屿包围盒再搜，最终兜底仍为 `WORLD_CENTER`。
- 服务端 `applyMove` 与客户端 `session.ts` 的 `resolveMotion` 不改签名，自动继承海岸阻挡；协议与量化保持原样。

### 3. 渲染层
- `terrain-textures.ts`：新增 `makeSeaTexture`，96px 深海平铺，稀疏波纹，比湖面更安静。
- `terrain-palette.ts`：新增 `seaBase` / `seaMid` / `seaCrest` / `seaFoam` / `shoreShallow`，保持低饱和暗蓝绿；`MINIMAP_COLORS` 增加 `sea`、`seaShallow`、`shore`。
- `terrain.ts` 的 `build()` 顺序改为：`addSea()` → `addGrass()` → `addForestFloor()` → 既有图层。
  - `addSea()`：海面 `TilingSprite` 按世界矩形外扩 2048px（12288×12288，位置 -2048,-2048），保证超宽视口也不露黑；沿岛线画 144px 浅滩描边（半宽 72）。
  - `addGrass()`：草地仍铺 8192，但用岛屿多边形 `Graphics` 做 mask；随后画 52px 沙滩描边、56px 浪花描边（2px 露在沙边两侧）。
  - `WaterSurface` 增加 `tile` 字段，海面 96、湖河 48，避免回绕模数用错导致水面跳变；海面每 10 个时间片滚 1px。
  - `destroy()` 补销毁海面纹理与遮罩。
- 所有纹理仍在构造期一次性生成，帧循环只改 `tilePosition`，不产生新对象。

### 4. 相机与小地图
- `renderer.ts` 的 `updateCamera` 把相机中心夹到 `WORLD_LAYOUT.island.bounds`；视口大于岛屿时按中心对齐，NaN 回落到世界中心。玩家在海岸仍居中，画面只出现海。
- `MiniMap.tsx` 的 `drawTerrain` 改为：填海色 → 岛屿多边形填陆地色 → 浅滩/沙滩描边 → 既有森林/路/广场/湖/河/桥/围栏/树点。仍只画 900px 视野，不引入全图缩放。

### 5. 测试与文档
- `collision.test.ts` 新增：各海湾采样点 `isBlocked` 为真；从岸边向海移动被挡且可沿滑动；所有静态地形在陆地内且离岸不小于 24px；`findFreePoint` 从岛外输入返回陆地。
- 更新 `regionAt(600,600)` 用例为陆地采样点 `regionAt(1200,3000)`。
- 新增 `docs/adr/0012-island-boundary.md`，记录海岸线归属、世界常量不变、遮罩方案与回滚路径；更新 `README.md` 的"地图与地形"章节。

## 性能与可靠性
- 碰撞热路径：内陆与深海为格子查表，只有海岸带做 18 顶点几何；200 人 × 20Hz × 4px 子步仍落在既有 Tick 预算内。
- 渲染增量：一张海面 quad、一次草地遮罩、三条描边，全部初始化期完成；海面滚动复用既有 `surfaces` 循环。
- 可靠性：海面外扩 2048px + 相机夹岛屿包围盒，任意视口都不露世界外黑色；`findFreePoint` 与 `resolveMotion` 的陆地约束保证不会把玩家放进海里。
- 回滚：删除 `isBlocked` 的岛外判定与 `addSea`/遮罩，恢复全图草地即可；海面纹理可保留不影响。

## 目录结构
```
packages/shared-types/src/
├── world/layout.ts                 # [MODIFY] 海岛折线、ISLAND 常量、isOnLand、WorldLayout.island
├── world/collision.ts              # [MODIFY] isBlocked 岛外判定、海岸网格、findFreePoint 陆地兜底
└── __tests__/collision.test.ts     # [MODIFY] 海湾阻挡、地形全在陆地、出生点兜底用例

apps/web/lib/game/
├── terrain.ts                      # [MODIFY] addSea、草地遮罩、沙滩/浅滩/浪花、WaterSurface.tile
├── terrain-textures.ts             # [MODIFY] makeSeaTexture 深海 96px 平铺
├── terrain-palette.ts              # [MODIFY] 海面与海岸配色、小地图海色
└── renderer.ts                     # [MODIFY] updateCamera 按岛屿包围盒 clamp

apps/web/components/game/
└── MiniMap.tsx                     # [MODIFY] 海色底、岛屿填充与海岸描边

docs/adr/0012-island-boundary.md    # [NEW] 海岛边界决策记录
README.md                           # [MODIFY] 地图与地形章节
```

## 关键代码结构
```ts
export interface IslandShape {
  points: Point[];
  bounds: WorldRect;
}

/** 半径内是否完全落在陆地上 */
export function isOnLand(x: number, y: number, radius?: number): boolean;

export interface WorldLayout {
  // ...既有字段
  island: IslandShape;
}
```

## 验收标准
- `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- 沿东、南、西、北四个方向走到海岸，均被自然挡住，画面只出现沙滩与海，无黑色边缘。
- 小地图在海岸附近能看出海陆分界；出生与压测 `GAME_SPAWN_RADIUS=3000` 不会把人放进海里。

## Agent Extensions
### Skill
- **principal-software-architect**
  - Purpose: 复核"海岛边界放在同构契约、碰撞热路径用海岸网格"这一决策的边界归属、性能预算与回滚路径，避免把地图边界散落到渲染层。
  - Expected outcome: 形成一份可并入 ADR-0012 的轻量决策结论，明确推荐项、反向成本与 30 天回滚方式。
- **verification-before-completion**
  - Purpose: 在交付前跑通 typecheck、单元测试、构建与压测冒烟，确认岛界、碰撞与渲染没有回归。
  - Expected outcome: 输出实际命令与结果证据，包含海岸走查与 3000 出生半径的压测结论，而不是口头声明完成。
