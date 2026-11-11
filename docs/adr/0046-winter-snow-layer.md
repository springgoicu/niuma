# ADR-0046：冬季雪景层与室内陈设补完

- 状态：已采纳
- 日期：2026-11-11
- 关联：沿用 ADR-0005（像素网格）、ADR-0013（图层与色温纪律）、ADR-0024（y 分桶）、ADR-0026 / ADR-0032（座位与家具契约）、ADR-0044（四角院落）

## 背景

需求是「现在是冬天，增加冬季元素、雪等元素」，并在澄清中选定：

1. **完整冬景**：飘雪、草地覆雪、树冠积雪、水面冷调与岸边薄冰、角色脚印；
2. **冬季道具**：雪人与雪堆、松树挂灯串、屋檐冰棱；
3. **启用方式**：本地日期 12–2 月自动入冬，`?season=winter` 强制开启，`?snow=0` 关闭；
4. 同一轮要求「把宿舍区、工作区、卫生间画得好看些、内容丰富些」。

## 问题

- **季节不能进服务端。** 服务端权威结算碰撞，地形是双端共用的静态几何（`packages/shared-types/src/world/layout.ts`）。
  一旦季节变成服务端状态，冬夏的可行走区域就会不同，必须双端同版本发版、还要处理「同一屏里两个玩家看到不同地形」；
  而这条收益为零——玩家对雪景没有任何玩法诉求。
- **雪人不能当障碍。** 同上：把雪人写进 `WORLD_LAYOUT.solids` 会让冬季的可走区域比夏季小，
  服务端不知道谁在看雪。所以冬季道具只能是无碰撞装饰。
- **地面材质是构造期烘焙的。** 草地 512 平铺 + 海岸线遮罩、土路圆角轮廓 + 遮罩、水面 96 平铺，
  都在 `TerrainView` 构造时一次画完。重画每种材质的冬季版本意味着 4 套纹理、一套新的遮罩规则。
- **草缘会把雪地出卖。** `flushEdges` 在土路、水面、沙带的轮廓上长绿草齿，覆雪后这些齿会变成
  「雪地上冒出的绿草尖」，整层覆雪立刻失真。
- **贴花会被雪面顶穿。** 贴花层在 `base` 之上，约 900–1200 个精灵；雪压在 `base` 里，花会浮在雪上。
- **帧循环不能分配对象。** 飘雪若每帧 new 粒子、或每次落屏外读 `Math.random`，会在热路径上制造短命对象。
- **室内本来就空。** 宿舍区只有上下铺与两张凳、工作区只有八张桌、卫生间只有马桶与洗手台，
  460×360 的房间里大片空地，站进去像进了毛坯房。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 只加屏幕飘雪 + 冷色柔光 | 改动最小、零地形风险 | 地面仍是盛夏草地，「冬天」只成立在画面前景，用户明确否决 | 否决 |
| B. 重画全部地面材质的冬季版本 | 雪景最真实 | 4 套新纹理 + 一套新遮罩规则，且土路/沙滩/水面的「雪化了一半」还得逐材质调 | 否决 |
| C. 季节进服务端，雪人参与碰撞 | 冬夏玩法真正不同 | 破坏「地形不进协议」与「服务端零持久化」，双端强耦合 | 否决 |
| D. 客户端季节布尔量 + 一层覆雪平铺 + 草缘换色（采纳） | 一处改动覆盖草地/林地/花海/广场；零协议、零服务端 | 雪面细节全由这一张 512 平铺承担 | 采纳 |
| E. 冬季道具全部进共享布局 | 遮挡更可信 | 需要双端发版，且冬季与非冬季的可行走区域不一致 | 否决 |

## 决策

### 1. 季节收敛成一个客户端布尔量

`apps/web/lib/game/season.ts` 是唯一入口：

- `isWinterMonth(month)` / `isWinterDate(date)`：12、1、2 月（0 基月份 11/0/1）；
- `readSeason(search, now)`：返回 `{ winter, snow, source }`，`source` 区分 `date` / `url-on` / `url-off`；
- `?season=winter|1|on|冬` 强制入冬，`?season=off|0|summer|夏` 强制关冬，非法值回落日期；
- `?snow=0|off` 只关飘雪粒子，覆雪地面与冬季道具保留。

`GameRenderer.buildLayers()` 只调用一次，其余模块一律接收 `winter: boolean`，不自己读 `new Date()`——
否则跨月那一分钟会出现「地面还在夏天、雪已经在飘」。

### 2. 覆雪层：一张平铺 + 内缩海岸线遮罩

- `makeSnowTexture()` 512 平铺（与草地同尺寸，平铺相位不用重算）：`snowBase` 底 + 46 个受光/雪影色簇 +
  极淡 1px 颗粒 + 26 条浅雪沟 + 54 根探头草尖，全部走 `wrappedRect` 保证无缝。
- `TerrainView.addSnowCover()` 插在 `addFlowerMeadow()` 之后、`addPlaza()` 之前：
  草地、林地、花海被盖住；广场路缘、土路、水面、桥、码头压在其上，读作「被踩过 / 被浪打过」。
- 遮罩用 `offsetContour(ISLAND.points, -ISLAND_SAND)`：沙带是以海岸线为中线的 52px 描边，
  内缩 26px 正好接住它的内缘，雪不会盖到沙滩。

### 3. 草缘换雪缘

`terrain-edge.ts` 新增 `WINTER_EDGE_STYLE` 与 `WINTER_GRASS_FRINGE`，`edgeGlyphs` 增加可选 `fringe` 覆盖：

- 对面是草的那套齿色整体换成雪色（`snowBase` / `snowShade` / `snowLight`）；
- 贴着土路轮廓的 2px 地被线从 `grassTuft` 换成 `snowLight`；
- 缺省行为完全不变，`terrain-edge.test.ts` 与既有调用方零改动。

### 4. 冬季贴花整层不生成

花与草叶本就被雪埋了，留着只会浮在雪面上；顺带省掉 900–1200 个精灵，
覆雪层的开销正好被这一条抵掉。

### 5. 水面冷调与岸边薄冰

- `makeWaterTexture` / `makeSeaTexture` 增加 `winter` 参数，换一套冷调色表。
  **不用 `tint`**：multiply 只能压亮部，调不出「更冷更淡」的水。
- `addIceRim()` 沿湖与河的轮廓画 4px `iceEdge` + 3px `iceBase` 内缩冰带，
  再撒十几粒碎冰。**不整片盖水面**——整片结冰会把「湖」读成「另一种地面」，
  而「岸边先冻、水面还在动」才是冬季真正读得出来的信号。

### 6. 树冠雪帽在 `makeTreeParts` 内参数化

树冠是自下而上逐行画的，行几何收进 `rows[]` 后，在循环结束按行宽铺雪：

- 上半部（`rows.length * 0.66` 以上）逐行铺 `snowBase`，越靠顶越厚；
- 下半部只在外沿枝尖点雪，中间留出叶色——逐行都盖满会在 3px 行距上拉出横纹；
- 雪帽下沿压一道 `snowShade` 雪线；树根补一圈积雪。

不额外叠精灵：雪帽与树冠共用同一套行宽算法，天然对齐，也不会多出第二套锚点。

### 7. 飘雪是屏幕空间的对象池

`snow-fx.ts` 的 `SnowField`：

- 两种纹理（1×1 雪粒、2×2 缺角雪花），靠 alpha 与速度分远近，不逐粒切纹理打断批次；
- 数量 = `clamp(视口面积 / 16000, 48, 200)`，`resize` 只改坐标不重建；
- 帧循环只累加 `y` 与 `baseX`、算一次三角波，落屏外重置坐标；
- 随机数用自带 LCG，不调 `Math.random`；
- 挂在 `stage` 上、柔光层之下：雪被柔光染一层冷色，才和整张图在同一光环境里。

### 8. 脚印复用同一条触地通路

`GroundFx` 增加 96 个脚印精灵的对象池，`spawnFootprint(x, y, flip)` 由 `EntityView` 的 `onFootfall`
回调触发（与扬尘、涉水涟漪同一条通路）。条件：冬季 **且** `isOutdoorGround(x, y)`——
土路、桥、沙岸、铺装与室内都不留印子。三档 alpha 淡出，寿命 9s。

### 9. 冬季道具全部无碰撞

`winter-art.ts`：

- 雪人 ×3、雪堆 ×7（手写坐标，只压中庭四角与庭院边缘），进 y 排序层，会被树冠与角色正确遮挡；
- 灯串按树序号每 9 棵挂一串，挂在树冠下三分之一；亮度按 `lightToneAt(hour, true)` 分三档，
  30s 采样一次只改 alpha；
- 屋檐冰棱沿横向墙的下沿挂 3–6px 冰柱，位置来自坐标哈希（同一面墙每次都长在同一处），
  合进一张 `Graphics`，门洞因为墙体本来就是拆开的两段而天然断开。

### 10. 室内陈设补完（宿舍 / 工作区 / 卫生间）

`interior-art.ts` 只读 `WORLD_LAYOUT.buildings` 与 `solids`，**不碰 `packages/shared-types`**：

- 工作区（开放木地板）：走线槽 + 7 个接线盒、纸箱堆、打印机、零食推车、落地灯、白板立架；
- 宿舍区（地毯）：南墙两扇窗外是雪夜、窗台积雪、暖气片、北墙挂钟与两盏壁灯、衣柜、书架、
  行李架、圆毯、床边小毯、拖鞋；
- 卫生间（瓷砖）：三面墙裙、洗手台上方两面镜子、洗手液与纸巾盒、烘手机、防滑垫、地漏、
  两扇半掩的隔间门与厕纸架。
- 所有新增家具**贴墙摆放**：贴墙位置本来就落在墙体的碰撞盒里，玩家站不进去，
  因此不需要为它们补碰撞，也不会改变寻路可达性。

### 11. 开关与回退

与 `?flat=1` / `?light=0` 同一套灰度惯例：

| 参数 | 作用 |
|---|---|
| `?season=winter` | 强制入冬（7 月也能验收与截图） |
| `?season=off` | 强制关冬（1 月退回改动前的常夏园区） |
| `?snow=0` | 只关飘雪粒子，覆雪地面与冬季道具保留 |

## 后果

- 正面：
  - 冬季是纯客户端表现层，**不改协议、不改碰撞、不需要双端发版**；
  - 覆雪只加一张 512 平铺，同时净减 900–1200 个贴花精灵；
  - 草缘、贴花、水面、树冠四处「会出卖雪景」的细节都有对应处理；
  - 室内从「毛坯房」变成有窗、有暖气、有柜子的房间，且没有新增任何碰撞体。
- 负面：
  - 雪面细节全由一张 512 平铺承担，凑近看颗粒偏稀（贴花层在冬季被关掉了）；
  - 飘雪不参与世界深度排序，雪永远在角色之上；
  - 室内家具无碰撞，走到衣柜里会显示为「被衣柜挡住」，视觉可接受但没有物理反馈；
  - 灯串亮度与柔光层各自采样一次 `lightToneAt`，两处若改了配色需要一起改。
- 回滚成本：低。`?season=off` 等价于线上关闭冬季；室内陈设要单独回退需删掉
  `GameRenderer.buildLayers()` 里的 `new InteriorArt()` 一行。服务端与 `packages/shared-types` 零改动。

## 基线

```text
BASELINE | apps/web/lib/game/season.ts | expected: 季节只判定一次，其余图层只消费布尔量 | observed: readSeason 在 GameRenderer.buildLayers() 调用一次，TerrainView/AmbientLight/SnowField/WinterArt 全部接收 winter | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 新增图层需要季节时再加字段，不要在模块里读 new Date()
BASELINE | apps/web/lib/game/terrain.ts | expected: 覆雪复用既有平铺 + 遮罩管线 | observed: addSnowCover 用 TilingSprite + offsetContour(-ISLAND_SAND)，层序插在花海之后、路缘之前 | fit: align | patterns: [P-Reuse] | violations: [] | suggestion: 雪的观感问题先调纹理与齿色，不要动层序
BASELINE | apps/web/lib/game/terrain-edge.ts | expected: 冬季换色不改默认行为 | observed: edgeGlyphs 新增可选 fringe，缺省仍用 EDGE_STYLE / GRASS_FRINGE；terrain-edge.test.ts 未改 | fit: align | patterns: [P-Open-Closed] | violations: [] | suggestion: 新材质要冬季色时加进 WINTER_EDGE_STYLE，不要 if (winter) 分支散射
BASELINE | apps/web/lib/game/renderer.ts | expected: 冬季图层按需构造，非冬季零开销 | observed: SnowField 仅 season.snow 时构造并挂 stage，WinterArt 仅 season.winter 时 attach | fit: align | patterns: [P-Lazy] | violations: [] | suggestion: 再加季节内容时沿用同一条 if (season.winter) 判断
BASELINE | apps/web/lib/game/interior-art.ts | expected: 室内陈设不进共享契约、不产生碰撞 | observed: 只读 WORLD_LAYOUT.buildings/solids，家具全部贴墙且无 solid | fit: align | patterns: [P-Client-Only] | violations: [] | suggestion: 需要真障碍的家具必须回到 shared-types 并双端发版
BASELINE | packages/shared-types | expected: 本轮零改动 | observed: 协议、布局、碰撞全部未动 | fit: align | patterns: [P-Boundary] | violations: [] | suggestion: 任何「冬季改变可行走区域」的需求都先回到本 ADR 重新评估
```

## 复核信号

- 出现「雪地上一圈绿草尖」：先查 `flushEdges` 的 `fringe` 覆盖是否传到了 `edgeGlyphs`，不要改草缘宽度；
- 出现「沙滩被雪盖住」：遮罩必须用 `offsetContour(ISLAND.points, -ISLAND_SAND)`，不是原始海岸线；
- 出现「花浮在雪上」：贴花层冬季必须整层不生成，不要在贴花上叠 alpha；
- 出现「水面像结了整片冰」：`addIceRim` 只允许内缩 3–4px，不要加大宽度或换成整片平铺；
- 出现「雪粒贴着镜头不动」：`SnowField` 必须挂在 `stage`，不能进 `world`；
- 出现「土路上也有脚印」：判定必须是 `isOutdoorGround`，不要另写一份地面判断；
- 出现「1 月进不去园区 / 走位被挡住」：说明有东西被塞进了 `solids`，冬季道具必须无碰撞；
- 出现「衣柜能穿过去」：这是既定取舍；要真障碍就回 `shared-types` 加 solid 并双端发版。
