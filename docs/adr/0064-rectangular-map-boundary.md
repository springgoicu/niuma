# ADR-0064：地图边界改为矩形——取消海岸线与外海，四边用密林封口

- 状态：已采纳
- 日期：2026-11-13
- 关联：取代 ADR-0012（海岛边界）的「海岸线即边界」形态，沿用其「边界由 shared-types 单一真相裁定」的结论；沿用 ADR-0028（3805×4212 的岛界尺寸）、ADR-0030（水域可涉水）、ADR-0047（中央枢纽与三湖）、ADR-0013 / ADR-0016（边缘层与双网格）

## 背景

需求是「删除地图四边的不可移动区域 / 水域，改成四个边界，地图大小不变」。

澄清后确定四件事：

1. **尺寸不动**：沿用 ADR-0028 的岛界包围盒 `x 2146–5951 / y 1956–6168`（3805×4212），只是把不规则海岸线换成四条直边；
2. **边界形态**：四边用一圈不可通行的深色密林封口，贴边看到的是林墙而不是海面或黑边；
3. **三湖保留**：摸鱼湖 / 沉思浅塘 / 涟漪湖仍在原地，仍可涉水；
4. **沙带保留**：边界内侧留一圈沙滩装饰带，海与浅滩全部删除。

## 问题

- **边界不能有两份。** `isOnLand` 是服务端权威碰撞、客户端预测、出生点、NPC 与 A\* 的共同入口；边界一旦在渲染侧另写一份，玩家会看到海却走得过去，或者相反。
- **尺寸变了就全崩。** 协议坐标是 u16 × 1/8px，紧凑同步条目把 x/y 压到 15 bit；岛界一旦放大到 8192 世界矩形，AOI 视野、相机夹紧、A\* 网格与同步带宽全部要重算。
- **海湾填平后是空地。** 北湾（1056×1202）、东湾（353×1616）、南中湾（1383×179）合计约 2.1M px² 会变成纯草地，密林围边与既有散树撒点必须接住这块空地，否则会出现「走半屏什么都没有」的走廊。
- **边缘层是位掩码驱动的。** 沙带以前是「以海岸线为中线的 52px 描边」，两条边都在同一条折线上；改成矩形后，沙 / 草交界变成一条直边，材质判定必须跟着换算法，否则草尖会沿旧海岸线长。
- **相机夹在岛界上。** 贴边时最多能看到边界外半个视口（< 1300px），外侧必须有东西接住，不能露出画布底色。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 保留海岸线，只把海换成陆地纹理 | 改动最小 | 边界仍是锯齿折线，玩家仍会被看不见的海湾挡住 | 否决 |
| B. 扩到 8192×8192 的世界矩形 | 「地图」字面最大化 | 需重算 AOI / 相机 / A\* / 同步位宽，可玩面积翻四倍且园区居中显小 | 否决 |
| C. 无形空气墙，边界外留空 | 实现最简 | 贴边是一面纯色背景，观感廉价，也读不出「这里是尽头」 | 否决 |
| D. 矩形陆地 + 内侧沙带 + 矩形外两排密林（采纳） | 尺寸不变、边界单一真相、边界可读 | 需要新增一层密林树影，并重标密度阈值 | 采纳 |

## 决策

### 1. 边界是同一个包围盒的四条直边

`packages/shared-types/src/world/layout.ts`：

```ts
const ISLAND_POINTS: Point[] = [
  [2146, 1956],
  [5951, 1956],
  [5951, 6168],
  [2146, 6168],
];

export const ISLAND: IslandShape = { points: ISLAND_POINTS, bounds: polygonBounds(ISLAND_POINTS) };
export const WORLD_BOUNDS: WorldRect = ISLAND.bounds;
```

保留 4 点多边形而不是换成 `WorldRect`：`pointInPolygon` / `polygonBounds` / 小地图 / 贴花撒点等既有消费方零改动即可继续工作，`ISLAND.bounds` 数值与 ADR-0028 完全一致，协议、AOI、相机与 A\* 网格全部不用改。

`isOnLand` 从「多边形内外 + 到折线距离」退化成 O(1) 的内缩矩形比较，`radius` 仍是净空语义：

```ts
export function isOnLand(x: number, y: number, radius = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return false;
  const { x: bx, y: by, w, h } = WORLD_BOUNDS;
  const inset = radius > 0 ? radius : 0;
  if (w <= inset * 2 || h <= inset * 2) return false;
  return x > bx + inset && x < bx + w - inset && y > by + inset && y < by + h - inset;
}
```

`radius = 0` 时与旧实现严格等价（边界点不算陆地），因此 `isBlocked` 的边界短路、`findFreePoint` 的夹回逻辑、`resolveMotionInto` 的脱困逻辑一行都不用改。

### 2. 沙滩带改成边界内侧的环

`ISLAND_SAND = 26` 的数值没变，语义从「以海岸线为中线的带」改成「矩形边界内侧的带宽」。`materialAt` 不再跑多边形距离，直接比到最近一条边的距离：

```ts
if (x <= bx || y <= by || x >= bx + w || y >= by + h) return MATERIAL.outside;
const edge = Math.min(x - bx, bx + w - x, y - by, by + h - y);
return edge <= ISLAND_SAND ? MATERIAL.sand : MATERIAL.grass;
```

`MaterialId` 随之收敛：删掉 `shallow`，`sea` 改名为 `outside`（矩形以外 = 密林）。数值只用于 `Uint8Array` 存格，不参与渲染顺序。

### 3. 四边密林是纯渲染层

`apps/web/lib/game/border-forest.ts` 只产出树位（`ForestTree[]`），不含 Pixi 对象：

- 每条边两排，近排离边界 22px、远排 96px，沿切线步长 64px、远排错开半格；
- 抖动全部是整像素、种子固定（mulberry32），不用 `Math.random` / `Math.sin`；
- 单边 `w / 64 ≈ 60` 组，四边合计约 500 棵，上限 `FOREST_MAX_TREES = 640`。

`TerrainView.addBorderForest()` 负责贴图：复用现有树冠纹理，近排 `0xc8d8c0`、远排 `0x7d9678` 两档着色，全部进 `cullables`。树影**不注册碰撞、不进深度层**——角色永远走不到这一带，压在地形底色之上即可，也不需要树冠遮挡。

### 4. 海与浅滩下线，林地铺底

- `addSea` → `addWild`：`makeSeaTexture` 换成 `makeWildTexture`（深绿底 + 叶簇 + 叶隙暗点），仍外扩 `WILD_EXTENT = 2048`，相机贴边时不会露出画布底色；
- 删除 `addShoreShelf`（浅滩）与 `ISLAND_SHALLOW`；
- `addGrass` 不再用多边形遮罩，直接把 `TilingSprite` 定位到矩形（`position = bounds`，尺寸 = `bounds.w/h`）；
- 冬季覆雪遮罩从 `offsetContour(ISLAND.points, -ISLAND_SAND)` 改成内缩矩形，雪止于沙带内缘。

### 5. 密度基线重标

三个海湾填成陆地后多出约 13% 的可通行面积，且几乎全是空草地。第一道阈值（纯草格 ≤ 48%）仍成立；第二道「任意 512×512 窗口 ≤ 85%」被顶到 0.859，按新地形重标为 90%，保留「不允许整片无内容」这条底线。

## 后果

- 正面：
  - 边界从 16 点折线收敛成四条直边，`isOnLand` 从多边形判定变成几次比较，服务端每 tick 的碰撞开销下降；
  - 地图尺寸、协议、AOI、相机、A\* 网格、同步位宽全部不变，不需要双端发版；
  - 三个海湾变成可走的草地，园区可玩面积约 +13%，边界观感从「海」变成「林」，与国风园林更协调；
  - 小地图、出生点、NPC 行走范围自动跟随同一个矩形，不存在第三份边界。
- 负面：
  - 新增约 500 个纯渲染精灵（无碰撞、无深度排序、可裁剪），构造期多烘一张 96px 林地纹理；
  - 原海湾区域是开阔草地，密度阈值放宽到 90%，那片区域的「内容感」弱于园区中心；
  - 「牛马园北门」区域仍留在 y 3184–3476，名字里的「门」不再对应水边，只是北向主路的尽端；
  - 删除海岸线后，任何依赖「到海岸线距离」的旧逻辑都不再成立（目前只剩渲染侧，已全部替换）。
- 回滚：把 `ISLAND_POINTS` 还原成 16 点折线、`isOnLand` 恢复多边形版本，并还原 `terrain.ts` 的 `addSea` / `addShoreShelf` / `addShoreSand` 三个方法即可；`MaterialId` 的数值只有内存语义，回滚不需要协议配合。

## 基线

```text
BASELINE | packages/shared-types/world/layout.ts | expected: 边界单一真相、尺寸不变 | observed: ISLAND.bounds 仍为 {x:2146,y:1956,w:3805,h:4212}，points 收敛为 4 点，isOnLand 为 O(1) 内缩矩形 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 需要改边界时只改 ISLAND_POINTS，不要在渲染侧写第二份
BASELINE | apps/web/lib/game/border-forest.ts | expected: 纯函数、确定性、整像素 | observed: buildBorderForest 两次调用深比较一致，全部树根落在矩形外，数量 ≤ 640 | fit: align | patterns: [P-Determinism] | violations: [] | suggestion: 新增排数或间距时同步 FOREST_MAX_TREES 与测试里的最大间距
BASELINE | apps/web/lib/game/terrain.ts | expected: 构造期烘焙，帧循环零分配 | observed: 密林在 build() 内一次性建精灵并登记 cullables，update 只滚水面偏移 | fit: align | patterns: [P-Budget] | violations: [] | suggestion: 树影不要进深度层，也不要每帧改 tint
BASELINE | 服务端碰撞 | expected: 与客户端共用边界 | observed: isBlocked 只经 isOnLand 判边界，协议与 clampWorldX/Y 未改 | fit: align | patterns: [P-Shared-Truth] | violations: [] | suggestion: 边界语义变化必须先改 shared-types 再动渲染
```

## 复核信号

- 出现「能走进林子里」：先查 `isOnLand` 是否仍以内缩矩形为准，不要靠渲染遮罩兜底；
- 出现「贴边露黑边」：先查 `WILD_EXTENT` 是否被改小，或林地纹理是否没铺到 `-WILD_EXTENT`；
- 出现「草地铺到林子里」：先查 `addGrass` 的矩形是否仍取 `ISLAND.bounds`，不要再用整幅世界平铺；
- 出现「沙带里长出树」：先查 `isPlantable` 的留白是否仍是 `ISLAND_SAND + 36`；
- 出现「小地图把陆地画成海」：先查 `MINIMAP_COLORS.wild` 与 `drawTerrain` 的矩形填充是否同步；
- 出现「角落两棵树叠在一起」：四边各自铺满端点，角上允许重叠一棵，属预期；
- 出现「密度测试又红」：按新地形重标阈值，不要靠加坐标把窗口填满。
