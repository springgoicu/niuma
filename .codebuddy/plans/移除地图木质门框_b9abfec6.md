---
name: 移除地图木质门框
overview: 删除五座区门木门架、企业楼木构牌坊与企业楼铭牌木柱，并同步清理它们的匾额、门灯、门垫、门槛石、门楣彩旗、区门灯光、小地图地标与相关测试断言；保留迎宾拱门、铁艺院门等非木质门形物，以及作为导航/路网锚点的区门坐标。
todos:
  - id: remove-plaque-gate
    content: 删除 plaques.ts 门架与匾额绘制、DoorPlaque.frame 及 workroom 门牌，更新 place-signs 测试
    status: completed
  - id: remove-venue-gate-art
    content: 删除 venue-art 的区门门架、企业铭牌、门垫门槛石与区门光池，保留走廊地面
    status: completed
  - id: remove-gate-lights
    content: 移除企业楼门架挂灯与五区区门灯光，删除 WORKROOM_GATE，更新灯光测试预算
    status: completed
    dependencies:
      - remove-plaque-gate
      - remove-venue-gate-art
  - id: remove-bunting-minimap-snow
    content: 删除区门门楣彩旗、小地图区门地标与雪堆避让项，修正彩旗索引并更新测试
    status: completed
    dependencies:
      - remove-gate-lights
  - id: verify-scene
    content: 运行测试与类型检查，并用 [skill:pixel-venue-polish] 复核删改后场景与灯光预算
    status: completed
    dependencies:
      - remove-bunting-minimap-snow
---

## 产品概述
把园区地图上所有木质门框类陈设整建制拆除，让这些位置回归纯粹的路面与墙面，不再有木柱、横梁、匾额与门灯悬空残留。

## 核心功能
- 拆除五座区门（生活、服务、景观、游乐、企业前庭）的木门架：木柱、石柱础、横枋、区色匾额、门灯亮核一并消失。
- 拆除企业楼唯一一座木构牌坊及其匾额，企业楼入口只保留地面走廊与导览到达点。
- 拆除企业楼铭牌的两根立木柱、牌面与顶部亮灯。
- 拆除上述门框的附属物：门垫、门槛石、门架落地阴影、地面区色光池、门架上的挂灯。
- 拆除派生装饰：门楣彩旗、五区门灯、小地图上的区门标记、冬季雪堆在门架处的避让开口。
- 保留迎宾拱门、铁艺院门、游乐园门头、急救站门柱、卫生间隔间门扇等非木质门形物；门的通行、碰撞、导览与指路牌照常工作。

## 视觉结果
地图上原本“凭空立在路面上的木框”消失，区门位置只留下街面铺装与路面；企业楼东门变成一条干净的走廊开口。夜景中不再有区门暖光与门头亮点，小地图不再出现五枚区门色点。


## 技术栈
沿用现有栈：TypeScript + PixiJS（`apps/web/lib/game`）+ `@niuma/shared-types` 世界数据层；测试为 `bun:test`（web）与 `vitest`（shared-types）。

## 实现策略
1. **只删渲染与派生，不动功能锚点**：`DISTRICTS[].gate` 同时被导览（`session.ts`）、路网（`road-graph.ts`）、指路牌（`signpost.ts`）、街面拼花（`road-dressing.ts`）使用，**保留字段与坐标**，只删视觉派生；避免破坏导航与寻路。
2. **数据驱动收敛**：企业楼牌坊由 `DOOR_PLAQUES` 的 `frame:'gate'` 单条驱动。删除该条后其余 12 条全为入口小门牌，因此把 `DoorPlaque.frame` 字段与其分支一起删除，`PlaqueView` 只保留 `drawBoardSign` 路径；`DOOR_PLAQUES` 从 13 条变 12 条。
3. **按依赖顺序清理**：先删绘制，再删常量与派生，最后统一验证。删 `WORKROOM_GATE` 必须等 `venue-art.ts` 的铭牌/门垫、`winter-art.ts` 的避让项全部移除后，否则会留下悬空引用。

### 关键陷阱（已核实）
- `DOOR_LANTERN_POSTS` 第 0 条是门架挂灯；删除后数组从 4 条变 3 条，`festival-decor.ts` 里写死的 `DOOR_LANTERN_POSTS[3]`（卫生间）必须改为索引 2 或 `.at(-1)`。
- `lighting.test.ts` 硬编码 `LANTERN_LIGHT_COUNT = 6` 需改为 5；`venueLights()` 当前 25 盏（含区门 5 盏），删后 20 盏，现有下界 `>=21` 会失败，需调为 18–22 并删掉「区门每座一盏」断言。
- `paintCompanyGate` 里走廊地面、中线与箭头保留，只删 454–463 的门垫与门槛石；`gateChevron` 仍被走廊使用，不能连带删除。
- `festival-decor` 的卫生间短彩旗保留（它明确不依赖门架），只修索引；五座区门彩旗整段删除，`district-bunting` 类型、常量、纹理烘焙与渲染分支一并删除。
- `welcome.ts` 拱门、`paintArchThreshold`、`ARCH_LANTERN_POSTS` 全部保留。

### 性能与可靠性
纯删除：减少 5 个区门容器 + 1 个铭牌容器 + 5 处贴图与 5 盏灯 + 5 条彩旗精灵，帧循环与构造期开销只降不升，不新增分配、不改变碰撞与协议。测试作为回归护栏，先改断言再跑全量测试，避免静默留下死代码。

## 实施说明
- 逐文件清理因删除而失效的 import（`venue-art.ts` 的 `DISTRICTS`/`WORKROOM_GATE`、`venue-lights.ts` 的 `DISTRICTS`/`mixColor`、`winter-art.ts` 的 `DISTRICTS`/`WORKROOM_GATE`、`festival-art.ts` 的 `DISTRICT_BUNTING_W`）。
- 同步改写被删逻辑的注释与文档串（`districts.ts` 的「门头牌匾」、`layout.ts` 的 gate/board 二分、`lanterns.ts` 的「门柱 4」、`minimap-draw` 的区门说明），避免留下指向不存在物件的注释。
- 不改 `props.ts` 的墙体绘制、`campus.ts` 的 `roomWalls`/`DoorSpec`、碰撞层与协议；灰阶开关 `?light=0`、`?festival=0` 行为保持一致。
- 不新增补偿性装饰；删完后按 `pixel-venue-polish` 规范复核空出来的地面是否有突兀硬边与灯光断层，只做必要的地面衔接，不新造构筑物。
- 不主动提交；若用户要求提交，按 `AGENTS.md` 在 `apps/web/data/release-notes.json` 追加一条面向玩家的记录并运行 `pnpm changelog:check`。

## 架构设计
自上而下三层保持原样，仅收敛渲染与派生：
- 数据层（`shared-types`）：`DISTRICTS[].gate` 保留为导览/路网锚点；`DOOR_PLAQUES` 去掉 workroom 与 `frame`；删除 `WORKROOM_GATE`/`COMPANY_GATE_X` 与门架挂灯。
- 渲染层（`apps/web/lib/game`）：`plaques.ts` 只剩小门牌；`venue-art.ts` 去掉区门/铭牌/门槛石绘制；`venue-lights.ts`、`festival-decor.ts`、`festival-art.ts`、`minimap-draw.ts`、`winter-art.ts` 去掉对应派生。
- 使用方（`session.ts`/`nav.ts`/`road-graph.ts`/`signpost.ts`/`road-dressing.ts`）：零改动。

## 目录结构
```
niuma/
├── packages/shared-types/src/
│   ├── world/
│   │   ├── layout.ts          # [MODIFY] 删除 workroom 门牌条目与 DoorPlaque.frame；删除 COMPANY_GATE_X/WORKROOM_GATE；删除 DOOR_LANTERN_POSTS 门架挂灯；改写注释
│   │   └── districts.ts       # [MODIFY] gate 字段与坐标保留，仅把注释从「门头牌匾与指路牌共用」改为导览/指路牌/路网锚点
│   └── __tests__/
│       └── place-signs.test.ts # [MODIFY] 改为 12 条门牌 + 2 小院；workroom 无门牌；删除 frame 断言
└── apps/web/lib/game/
    ├── plaques.ts             # [MODIFY] 删除 drawGate/drawPlaqueBoard/门架几何/spacedLabel 与 gate 分支，只保留 drawBoardSign
    ├── venue-art.ts           # [MODIFY] 删除 depthDistrictGates、depthCompanySign、paintGateThresholds 及调用；paintDistrictStreets 去掉区门光池；paintCompanyGate 只删门垫与门槛石
    ├── venue-lights.ts        # [MODIFY] 删除五座区门灯光循环，清理 DISTRICTS/mixColor 导入
    ├── festival-decor.ts      # [MODIFY] 删除 district-bunting 类型/常量/布点与企业楼 gate 彩旗循环；保留卫生间短彩旗并修正索引
    ├── festival-art.ts        # [MODIFY] 删除 district-bunting 纹理烘焙与渲染分支及 DISTRICT_BUNTING_W 导入
    ├── minimap-draw.ts        # [MODIFY] 删除 MINIMAP_GATE_MARKS 与绘制循环，保留区块填色使用的 DISTRICTS
    ├── winter-art.ts          # [MODIFY] 雪堆避让列表移除五区门与 WORKROOM_GATE，保留门牌与拱门
    ├── lighting/lanterns.ts   # [MODIFY] 固定挂灯注释由「拱门 2 + 门柱 4」改为 3
    └── __tests__/
        ├── festival-decor.test.ts # [MODIFY] gate-bunting 期望 2→1；删除两个区门彩旗测试与相关导入
        ├── lighting.test.ts       # [MODIFY] 挂灯 6→5；venueLights 区间调为 18–22；删除区门灯光断言并改标题
        └── minimap-marks.test.ts  # [MODIFY] 删除区门标记测试与 DISTRICTS 导入，保留场所图标断言
```

## 验证
- `pnpm --filter @niuma/shared-types test`
- `pnpm --filter @niuma/web test`
- `pnpm typecheck`
- 目视检查：五座区门与企业楼东门只剩路面；夜景无区门暖光；小地图无区门色点；导览仍可走到 workroom；迎宾拱门、院门、游乐园门头、急救站门柱保持原样。


## Agent Extensions
### Skill
- **pixel-venue-polish**
  - Purpose: 按牛马园区像素美化规范复核删改后的场景：空出来的街口/企业楼东门是否有突兀硬边、地面衔接与区色是否失衡，以及删除 6 处光源后夜景亮度是否仍连贯。
  - Expected outcome: 输出一份只针对本次删改的复核结论，确认无需补偿性新增；如发现地面硬边，仅做最小地面收边，不新增构筑物。
