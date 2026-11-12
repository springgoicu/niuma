# ADR-0047: 中央迎宾广场、去河流化与三湖树簇

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（需求确认）、客户端渲染、服务端模拟
- **Tags:** world-layout, terrain, spawn, minimap, collision
- **Supersedes / superseded by:** 部分取代 ADR-0015（河流几何）、ADR-0028（桥与码头）、ADR-0036（北门出生点）、ADR-0045（护园溪、环河四桥、河道小鱼）；ADR-0030（水域可涉水）继续有效

## Context

《牛马 NIOMA》的旧地图以「四角院落 + 周报河 / 晨会溪 / 护园溪 + 六桥两码头 + 十片加班林」为核心（ADR-0015 / 0028 / 0045）。玩家从北门出生，沿桥进入院落，线性水系把内陆切成了几块；林地是整块矩形碰撞区，树缝与走廊容易卡人。

本轮需求要求在不改 3805×4212 海岛与外海边界的前提下，做一次「去河流化 + 中央枢纽化」的重构：

- 出生点移到岛心，周围是开阔的圆形/圆角石砖迎宾中庭；
- 中心设「牛马园区 / NIOMA」霓虹像素拱门、园区导览地图立牌、打卡签到处，广场边缘对称摆售货机、咖啡机与长椅；
- 删除周报河、晨会溪、护园溪与全部木桥、码头，内陆保持完整一块；
- 湖收到 2–3 处自然圆润的内嵌景观湖，岸边有浅滩与碎石；
- 废除「加班林」整块碰撞区，改成每簇 2–5 棵的树丛与林荫道，任意两棵树间隙 ≥80px；
- 以中央广场为原点铺放射状土路，路缘保留草齿与暗边；
- 草地点缀花海、三叶草、雏菊与林间落叶，沿路放复古路灯。

**本轮已确认的需求让步：** 原始需求写「湖体仅作通行阻挡（碰撞体）」，但用户在二选一中明确选择「保持可涉水」。因此本次**不把湖面注册为碰撞体**，ADR-0030 继续有效；交付说明与本文都记录这一处冲突，避免被误判为漏做。

现状约束：

- `layout.ts` 禁止 `Math.random` / `Math.sin` / `Math.cos`，否则 Bun(JSC) 与浏览器(V8) 的末位差异会让双端各画一张地图；
- `WORLD_WIDTH/HEIGHT` 是 8192，海岛多边形 16 点手写在 x 2146–5951 / y 1956–6168；
- 四角院落的房间、门、工位、座位与 `NAV_ARRIVALS` 保持不变；
- 服务端出生、客户端预测、自动寻路与小地图必须继续共用同一份碰撞/材质真相。

## Quality scenarios and invariants

- `QUALITY | 出生可站立 | source: 新玩家入场 | stimulus: spawnPoint(56) | environment: 中央广场 | artifact: shared-types + game-server | response: 56px 圆内无 solid / prop / planter / tree / lake | measure: 400 次采样零拒绝 | priority: 高`
- `QUALITY | 通行连续 | source: 玩家从广场去四区 | stimulus: 沿放射路行走 | environment: 四角院落 | artifact: terrain + collision | response: 路径不落水、不出岛、不压墙 | measure: 中心线与带面顶点测试 | priority: 高`
- `QUALITY | 穿行开阔 | source: 树丛与林荫道 | stimulus: 玩家穿过树间 | environment: 全岛草地 | artifact: layout.ts | response: 任意两棵树 ≥80px | measure: 全树两两距离断言 | priority: 高`
- `QUALITY | 单一定义 | source: 布局改动 | stimulus: 改一条路/一片湖 | environment: 双端 + 小地图 | artifact: layout.ts / ribbon.ts | response: 只改一处，三端同步 | measure: 全仓无第二份坐标 | priority: 高`
- 不变量：
  - 海岛 16 点与外海边界一字不改，`ISLAND.bounds = {x:2146, y:1956, w:3805, h:4212}`；
  - 0 条河流、0 座桥、0 个码头；
  - 恰好 3 处景观湖，湖面可涉水；
  - 中央广场直径 720，出生点 (4096,4096)，56px 内无碰撞；
  - 树丛每簇 2–5 棵，树间隙 ≥80px；
  - 路径中心线与带面都在陆地上、不穿房间；
  - 拱门立柱让开 112px 南向主路，导览牌/打卡柱不压支路。

## Decision

我们**把世界从「环河四角院落」改为「中央石砖圆庭 + 四向放射动线 + 三处内嵌景观湖 + 散落树丛」**：

1. 中央 720px 石砖圆庭（`PLAZA_RADIUS = 360`），出生点移到圆庭正中 (4096,4096)；四角院落、门、工位、座位与导览点保持原位。
2. 删除 `WorldLayout.rivers/bridges/docks` 与 `isOnBridge`，删除周报河、晨会溪、护园溪、六桥、两码头；内陆连成整块。
3. 保留三湖：东南扩大版「摸鱼湖」、东北「沉思浅塘」、西侧「涟漪湖」。湖面仍可涉水（ADR-0030），不注册碰撞体。
4. 路径升级为「中心线 + 半宽」的 `PathShape`（`ribbon.ts` 的 miter 带状几何），四条主路 + 四条房间支路，转弯是平滑带面而不是 90° 矩形。
5. 植被改为 `TreeCluster`：24 簇、每簇 2–5 棵，簇间 ≥220、全树 ≥86（测试按 80 断言）；主路两侧补林荫道；道具与花箱占地也进入 `isPlantable` 留白。
6. 中央地标：`WELCOME_LANDMARKS = { arch, directory, checkin }`，`welcome.ts` 负责霓虹拱门、导览牌与打卡柱；北门旧横幅/指路牌删除，北门只留普通入口与土路。
7. 碰撞与边界：`WORLD_BOUNDS = ISLAND.bounds`；`isOnLand` 读它；三湖不注册 blocker；树丛/散树/花箱/地标立柱进 blocker 与 `solids`。
8. 渲染：`MATERIAL.bridge` 删除，新增 `MATERIAL.stone`；新增石砖纹理、落叶贴花、复古路灯；小地图删河/桥/码头层，改画石砖圆庭、带状路与树丛点。

## Options considered

### Option A — 保留四角房，720px 圆庭 + 三湖 + 树丛（chosen）

- Shape：四角房原位；圆庭利用房间之间的十字空档；四条主路从圆庭边缘出园后弯向四象限；四条支路接四间房门；河/桥/码头删净。
- Pros：房间、门、工位、座位、导览点与大部分测试不动；碰撞与通行风险最低；改动集中在 `layout.ts` 与渲染层；能完整满足「开阔、无河流、3 湖、树隙」。
- Cons：圆庭直径受房间角点限制（最大约 780），不能做到 1000+；四角房仍占据中心四角。
- Reverse cost：低。数据字段删除是破坏性变更，但回滚只需还原 `layout.ts` / `ribbon.ts` / `terrain.ts` / `welcome.ts` 一组文件。
- Evidence / experiment：`layout-hub.test.ts` 锁定出生圈、3 湖、树隙、路径带面；`collision.test.ts` 锁定可涉水与海岛边界。

### Option B — 四角房外移，1000px 广场 + 斜向放射路

- Shape：房间沿对角线外移 300–500px，中央做 900–1100px 圆庭，四条斜路直达房门。
- Pros：更接近「大广场 + 放射路」的视觉想象。
- Cons：要重排 `campus.ts` 的房间、门、工位、座位、南庭院与 `NAV_ARRIVALS`；导览、寻路、座位与大量测试随之重写；本轮需求明确「主要修改 layout.ts」，收益不抵风险。
- Reverse cost：高。

### Option C — 只改中庭外观，保留 600×520 与四向直路

- Shape：不扩广场，只铺石砖、加拱门与陈设。
- Pros：改动最小。
- Cons：与「开阔的圆形/圆角石砖迎宾中庭」不符；树丛/三湖仍然要做，整体收益低。
- Reverse cost：低。

## Consequences

### Positive

- 出生即站在岛心石砖圆庭，南向可见霓虹拱门与导览牌，第一眼有明确的空间锚点；
- 内陆不再被河流切成四块，四角房之间的十字空档变成真正的中央枢纽；
- 三湖替代线性河道，湖岸浅滩/碎石/芦苇集中，视觉密度更高；
- 树丛 + 林荫道把「整块加班林碰撞墙」拆成可穿行的树间空隙，走廊卡位消失；
- 路径几何与材质判定共用 `ribbon.ts`，斜路不再出现 90° 硬拼；
- 小地图与主视图共享同一份石砖/湖/路/树数据。

### Negative / risks

- `layout-density` 的纯草阈值从 ADR-0028 的 20% / 45% 重新标定为 48% / 85%：密林拆成 2–5 棵树簇后，纯草比例必然上升；这是「开阔呼吸感」的直接代价，已在 `layout-density.test.ts` 注明依据。
- 中央圆庭受四角房角点限制，直径只能到 720，未达到部分需求描述中的「大圆形广场」。
- 湖面保持可涉水，与原始需求「湖体仅作通行阻挡」冲突；这是本轮用户明确选择。
- 拱门是单张精灵，牌面底边已抬到离地 50px，但玩家站在拱门正下方时仍会有几像素遮挡；若要完全消除，需要把横梁/牌面拆到独立顶层容器。
- 鱼群从河道迁到三湖，浅塘面积有限，鱼间距从 120 降到 100；多 Seed 测试保证仍是 18 条。

### Neutral

- 「牛马园北门」区域名保留，北门不再是出生点，只是普通入口。
- `bridgeWood` / `bridgeSeam` 调色板键仍被花箱木色复用，未随桥删除而清理。
- `isWadingAt` 语义退化为 `isWaterAt`，保留导出以免破坏消费方。

## Adversarial review and fixes

按 `ARCH-PRIMARY → ARCH-ADVERSARY → ARCH-SYNTH` 跑了一轮只读对抗审查，采纳并修复：

- 林荫道偏移 96px 小于 `isPlantable` 的 55px 路缘 + 56px 半宽，导致 `AVENUE_TREES` 恒为空 → 偏移改为 `halfWidth + 96`，新增 `AVENUE_TREE_COUNT > 0` 断言；修复后 17 棵。
- 拱门牌面底边离地只有 20px，玩家穿门时被整块盖住 → 牌面上移，底边离地 50px，文本重新排布。
- 拱门立柱 solid 与 `drawArch` 的 18px 柱身错位 10px → solid 改为与纹理同坐标（3936+10 / 4256-28），宽 18。
- 导览牌/打卡柱压在东南/西南支路上 → 地标下移到圆庭外缘 y 4432，新增「迎宾带」区域（圆庭外扩 120）保证区域名仍是中央迎宾广场。
- `isPlantable` 不排除道具/花箱 → 生成顺序改为「先摆家具，再种树」，树与道具/花箱最小距离 ≥20px 并加测试。
- 会议室南墙被支路带面咬进 4px → 中间站下移 26px；宿舍/卫生间支路带面咬进房间 2px → 两条支路整体上移 10px；测试新增「带面顶点不进房间」。
- 南向主路终点 5140 与南庭院铺装 5160 之间 20px 草缝 → 主路终点延到 5160。
- 涟漪湖西岸野餐桌压水线 → 西移到 x 2220。
- `isWaterAt` 与 `materialAt` 对湖岸边界 1px 的判定不一致 → `materialAt` 补「边界距离 0 也算水」。
- 鱼群多种子可能少鱼、巡逻只验 4 点 → 巡逻采样加密到 9 点，新增 12 个种子的满员测试。

## Revisit triggers

We will reopen this ADR if:

- [ ] 出生圈或拱门/导览牌/打卡柱再次被碰撞体侵入；
- [ ] 纯草比例超过 48% 或任意 512 窗口超过 85%，或玩家反馈「岛上太空」；
- [ ] 树间隙 <80px 或树木与道具/花箱距离 <20px 的回归；
- [ ] 湖面碰撞需求重新出现（把三湖注册为 blocker 会推翻 q-1 的让步）；
- [ ] 海岛尺寸或外海边界变化（本 ADR 的 3805×4212 前提失效）；
- [ ] 需要 900px 以上中央广场（需重排 campus.ts，转 Option B）。

## Delivery and validation

- First reversible slice：`layout.ts` + `ribbon.ts` 数据契约 → collision/server → terrain/welcome → minimap/critter → 测试。
- Compatibility / migration：协议与网络包零改动；世界布局是静态内容，双端一起发版。
- Rollback：还原 `layout.ts`、`ribbon.ts`、`terrain.ts`、`terrain-edge.ts`、`welcome.ts`、`MiniMap.tsx`、`critter-spawn.ts` 与测试；`?flat=1` 可在不还原数据的情况下退回旧地形画法（石砖/带状路关闭，路缘保留）。
- Tests / fitness functions：
  - `pnpm --filter @niuma/shared-types test`（194）
  - `pnpm --filter @niuma/web test`（355）
  - `pnpm --filter @niuma/game-server test`（127）
  - `pnpm typecheck`（4 包）
- Security / reliability / data / ownership：本 ADR 不涉及持久化、网络契约或权限边界，只改静态世界几何与渲染；无新增依赖、无数据库、无服务拆分。

## Baselines

```text
BASELINE | packages/shared-types/src/world/layout.ts | expected: 纯几何与数据契约，服务端/客户端/小地图共用唯一真相 | observed: 删 rivers/bridges/docks；3 湖、10 条带状路、24 树丛 + 85 散树（含 17 棵林荫道）、720px 广场、SPAWN_CENTER=(4096,4096)、WORLD_BOUNDS=ISLAND.bounds | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 后续地形只扩展 layout.ts / ribbon.ts，渲染层不得手写第二份坐标
BASELINE | packages/shared-types/src/world/ribbon.ts | expected: 无框架依赖的纯带状几何 | observed: buildRibbon 复用 miter 偏移产出 polygon/leftBank/rightBank/centerline/rect，路径与材质共用 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 保持禁止 sin/cos 与像素取整
BASELINE | apps/web/lib/game/terrain.ts | expected: 只消费 WORLD_LAYOUT，不复制布局 | observed: 删 addRivers/addBridges/addDocks/addDeck；新增石砖圆庭、带状路、树丛地面、落叶贴花；桥材质删除 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 新增地景先扩展 MATERIAL 与 paintRegion，避免再写一套遮罩
BASELINE | apps/web/lib/game/welcome.ts | expected: 只读 WELCOME_LANDMARKS，构造期烘焙 | observed: 中央拱门/导览牌/打卡柱三组地标，中文走 Pixi Text，牌面底边离地 50px | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 若仍见遮挡，把横梁/牌面拆到独立顶层容器
BASELINE | apps/game-server/src/sim/resume.ts | expected: 出生裁决只读 shared-types | observed: spawnPoint 以 SPAWN_CENTER=(4096,4096)、SPAWN_RADIUS=56 拒绝采样，兜底 findFreePoint | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 改出生点只改 layout.ts，不在服务端写第二份坐标
BASELINE | apps/web/lib/game/critter-spawn.ts | expected: 撒点纯函数，水面/路径/广场同源 | observed: 鱼群迁三湖、多种子 18 条、整段巡逻采样；地面动物经 isOutdoorGround 排除石砖广场 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 新增生境时复用 isOutdoorGround，不复制排除规则
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```

## References

- Code: `packages/shared-types/src/world/layout.ts`, `packages/shared-types/src/world/ribbon.ts`, `packages/shared-types/src/world/collision.ts`
- Code: `apps/web/lib/game/terrain.ts`, `terrain-edge.ts`, `terrain-textures.ts`, `welcome.ts`, `critter-spawn.ts`, `components/game/MiniMap.tsx`
- Code: `apps/game-server/src/sim/resume.ts`, `src/config.ts`
- Related ADRs: ADR-0012（海岛边界）、ADR-0015（河流几何，部分取代）、ADR-0028（桥/码头，部分取代）、ADR-0030（可涉水，继续有效）、ADR-0036（北门出生点，部分取代）、ADR-0044（四角院落，保留）、ADR-0045（护园溪/环河/河道小鱼，部分取代）、ADR-0046（冬季层，保留）
- User requirement: 2026-11-12《牛马 NIOMA》世界地图重构需求与四问确认
