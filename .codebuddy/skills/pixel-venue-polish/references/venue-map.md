# 场所 → 文件映射

坐标常量一律来自 `@niuma/shared-types`；渲染层只读不写。

## 汇总表

| 场所 | 绘制入口 | View 类 | 坐标常量 | 现有光 | 现有动效 |
|---|---|---|---|---|---|
| 工作区 | `props.ts`（地板）+ `interior-art.ts`（陈设） | `PropsView` / `InteriorArt` 共用 | `WORKROOM` `campus.ts:232` | `InteriorArt.lights`（`:727`、`:935`） | 无 update，靠光图 flicker |
| 会议室 | 同上 | 共用 | `MEETING_ROOM` `campus.ts:234` | `InteriorArt.lights:779` | 无 |
| 宿舍区 | 同上（`fillFloorCarpet`） | 共用 | `LOUNGE` `campus.ts:241` | `InteriorArt.lights:935` | 无 |
| 卫生间 | 同上（`fillFloorTile`） | 共用 | `RESTROOM` `campus.ts:248`、`RESTROOM_STALLS:521` | 无 | 无 |
| 家庭影音室 | 同上（`fillFloorCinema`） | 共用 | `HOME_THEATER` `campus.ts:270` | `InteriorArt.lights:873/887` | 无 |
| 小黑屋 | 同上（`fillFloorConcrete`） | 共用 | `JAIL` `campus.ts:309`、`JAIL_ANCHOR:316` | `InteriorArt.lights:1050` | 无 |
| 中央广场 | `terrain.ts` `addPlaza()` `:453` + `welcome.ts` + `props.ts` | `TerrainView` / `WelcomeView` | `PLAZA_CENTER` `layout.ts:221`、`PLAZA_RADIUS:220` | `propLights`（路灯/售货机/咖啡机） | `TerrainView.update` `terrain.ts:842` |
| 摸鱼亭 | `pavilion.ts` | `PavilionView` | `MOPING_PAVILION` `layout.ts:291`、`PAVILION_CENTER:294` | 4×`LANTERN_LIGHT` `pavilion.ts:204` | 无 |
| 上香祭坛 | `shrine.ts` | `ShrineView` | `SHRINE_ALTAR` `layout.ts:343` | 2 盏 `shrine.ts:70-87` | `update` `:129`（青烟 + 光晕） |
| 茶台 | `tea-station.ts` | `TeaStationView` | `TEA_STATION` `layout.ts:360` | 无 | `update:81`（蒸汽三缕） |
| 摸鱼大赌场 | `dice-hall-view.ts` | `DiceHallView` | `DICE_HALL` `dice-hall.ts:16`、`DICE_HALL_CENTER:19` | 无 LightSpec | 无 |
| 绩效八角笼 | `ring.ts` + `ring-art.ts` | `RingView` | `RING_ARENA` `ring.ts:18`、`RING_BENCHES:93` | 无 | `update:252`（领奖台/彩带） |
| 牛马诊所 | `clinic-view.ts` | `ClinicView` | `CLINIC_RECT` `layout.ts:1581`、`CLINIC_BEDS:1592` | 无 | `update(now):328`（救护车灯 + 爱心） |
| 牛马公寓 | `apartment-view.ts` | `ApartmentView` | `APARTMENT` `apartment.ts:17`、`APARTMENT_DOOR:40` | 无 | 无 |
| 两栋小院 | `villas-view.ts` | `VillasView` | `VILLA_SPECS` `villas.ts:71` | 无 | 无 |
| 公园 | `park.ts` | `ParkView` | `AMUSEMENT_PARK` `park.ts:26` | 2 盏 `park.ts:417-427` | 无 |
| 湖畔 | `terrain.ts` `addLake()` `:596` | `TerrainView` | `LAKES` `layout.ts:781` | 无 | `waterFrame` + `WaterFx` |
| 发泄区 | `boss.ts` + `boss-art.ts` | `BossView` | `BOSS_ARENA`（`boss.ts:72` 使用） | 无 | `update:184` |
| 公告栏 | `bulletin.ts`（板体在 `props.ts`） | `BulletinView` | `BULLETIN_BOARD` `layout.ts:269` | 无 | `update:111`（跑马灯） |
| 迎宾拱门 / 宫灯 | `lighting/lanterns.ts` | `LanternView` | `ARCH_LANTERN_POSTS` `layout.ts:445`、`DOOR_LANTERN_POSTS:479` | 6 盏 `lanterns.ts:84` | 靠 `flickerAlpha` LUT |
| 节日装饰 | `festival-art.ts` + `festival-decor.ts` | `FestivalArt` | `festivalDecorPlan()` `festival-decor.ts:303` | 6 盏 `festival-art.ts:118` | `update:159`（720ms 两帧） |
| 冬季装饰 | `winter-art.ts` | `WinterArt` | `SNOWMEN`（`winter-art.ts:64` 使用） | 无 | `update:77`（灯串 alpha） |
| 门牌 / 牌坊 | `plaques.ts` | `PlaqueView` | `DOOR_PLAQUES`（`plaques.ts:143` 使用） | 无 | 无 |
| 小动物 / 鱼 | `critters.ts` / `fish.ts` | `CritterField` / `FishField` | `critter-spawn.ts` / `planFish(seed)` | 无 | `update` `critters.ts:140` / `fish.ts:64` |

## 本轮收口的四个前端模块（ADR-0094）

| 文件 | 职责 |
|---|---|
| `apps/web/lib/game/venue-palette.ts` | 场所四色表 + `darken` / `mixColor` / `outlineOf` / `seamOf` / `lighten` |
| `apps/web/lib/game/venue-art.ts` | 地面氛围、檐下小件、`VenueFx` 微动效层；`?venue=0` 整层不构造 |
| `apps/web/lib/game/venue-lights.ts` | 场所焦点光纯数据 `venueLights()`，可直接单测预算 |
| `apps/web/lib/game/venue-motion.ts` | 烛火 / 霓虹 / 水光 / 落叶 / 旗帜的纯函数 |

## 地面族分派

`props.ts` 的 `fillBuildingFloor(g, building)`（`:962-968`）按 `BuildingSpec['floor']` 分派：

| floor | 绘制函数 | 当前使用者 |
|---|---|---|
| `wood` | `fillFloorWood` `:851` | 工作区、会议室、赌场、两栋小院 |
| `tile` | `fillFloorTile` `:864`（兜底） | 卫生间 |
| `carpet` | `fillFloorCarpet` `:876` | 宿舍区 |
| `cinema` | `fillFloorCinema` `:890` | 家庭影音室 |
| `rubber` | `fillFloorRubber` `:901` | 公园 |
| `concrete` | `fillFloorConcrete` `:918` | 小黑屋、牛马公寓 |

`BuildingSpec` 定义 `packages/shared-types/src/world/campus.ts:207-211`；`WORLD_LAYOUT.buildings` 组装在 `layout.ts:1752-1758`。

## 装配入口

`renderer.ts:982` 的 `buildLayers(search)`。新增视图按现有顺序挂载：

- 陈设：`this.sortLayer`（立式）+ `this.props.base`（平面）
- 光源：`renderer.ts:950-957` 的注册区
- 微动效：`renderer.ts:1561` 的 `tickBubbles(dtMs)`

## 改一处场所的清单

1. 在 `venue-palette.ts` 找到/新增该场所的「主 / 次 / 缝 / 点缀」四色。
2. 地面：`props.ts` 的 `fillFloorXxx`；需要新家族时先改 `BuildingSpec['floor']` 与 `layout.ts:1752` 的分配。
3. 平面装饰：`interior-art.ts` 或对应 View 的 `base` 层。
4. 立式摆件：对应 View 的 `build(depth, ...)`，用 `depth.add(y, sprite)`。
5. 光：视图 `lights` + `renderer.ts:950` 注册 + `lighting.test.ts` 预算。
6. 动效：`venue-motion.ts` 纯函数 + `VenueFx.update(nowMs)`。
7. 灰度：确认 `?venue=0` 能整层关掉。
