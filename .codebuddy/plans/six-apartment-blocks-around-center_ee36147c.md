---
name: six-apartment-blocks-around-center
overview: 把西南角单独一栋「牛马公寓」拆成 6 栋门牌 301–306 各一栋的小公寓楼，绕中央迎宾广场四向草地散开（栋间距 300–600px），每栋有独立楼体、外墙、门口热区、室内坐标与家具网格，并同步导览、门牌、小地图、服务端进出与房间频道逻辑。
todos:
  - id: audit-consumers
    content: 用 [subagent:code-explorer] 清点公寓常量、热区 id 与网格常量的全部消费点及测试断言
    status: completed
  - id: apartment-specs
    content: 重写 apartment.ts 为 6 栋规格表：网格 6×4、楼体 300×240、按 rect 派生墙门窗与室内
    status: completed
    dependencies:
      - audit-consumers
  - id: layout-hotspots
    content: 同步 layout.ts 与 hotspots.ts：区域、建筑、铺装、碰撞、树带、导览与每栋热区
    status: completed
    dependencies:
      - apartment-specs
  - id: server-rooms
    content: 服务端按房间楼栋传送进出，热区校验改为任意门进、本栋出口出
    status: completed
    dependencies:
      - apartment-specs
  - id: client-view
    content: ApartmentView 画 6 栋并按当前楼栋绘制室内，提示谓词补本栋判断
    status: completed
    dependencies:
      - layout-hotspots
  - id: layout-tests
    content: 新增 apartment-layout 测试：互不重叠、净空、门线可站、栋距与中心距离
    status: completed
    dependencies:
      - layout-hotspots
  - id: docs-changelog
    content: 新增 ADR-0092 与版本工报 2026-11-15-12，跑 typecheck/test/changelog:check
    status: completed
    dependencies:
      - layout-tests
      - server-rooms
      - client-view
---

## 用户需求

园区里现在的「牛马公寓」是西南角孤零零一栋楼（`2620,5240`，380×300），楼内 6 个房间频道共用同一块室内坐标。用户要求把公寓改成**绕地图中心散开分布**，不要再挤在一处。

## 产品概述

牛马公寓由「一栋楼装 6 户」改为**6 栋小公寓楼，每栋一户**：门牌 301–306 各一栋，各自有独立楼体、外墙、门口感应区与室内户型空间。6 栋楼绕中央迎宾广场四周的草地铺开，整体仍在园区中心区域，玩家出生后往四个方向走几步就能看到自己的楼。

## 核心功能

- 6 栋独立公寓楼（门牌 301–306），每栋一套楼体、四面墙、南门热区、室内矩形与家具网格
- 绕中心广场四向分布，楼与楼之间留出明显间距（净距 300px 级），不再堆成一栋
- 每栋门口按 F 都能进屋（进的是自己那间房所在的那栋楼），屋内出口只在本栋生效
- 门前牌匾显示本栋门牌号（301–306），自己进屋后叠加房主名
- 导览「牛马公寓」、小地图建筑块、区域名、树丛留白、冬季覆雪同步到 6 栋
- 室内户型（纸箱 / 隔断 / 一居室 / 大平层）与家具摆放能力保持不变


## 技术栈

沿用现有技术栈，不引入新依赖：pnpm monorepo + TypeScript；`packages/shared-types` 为双端唯一真相源；服务端 Bun WebSocket（20Hz）；客户端 Next.js + React + PixiJS 8；测试 Vitest；校验脚本 `pnpm typecheck` / `pnpm test` / `pnpm changelog:check`。

## 实施思路

核心策略：**把「一栋楼」升级成「一栋楼 = 一个 slot 的规格表」，所有派生量自动跟着走**，房间频道协议与存档语义完全不变。

1. **单一真相源重构**（`apartment.ts`）
   - 新增 `ApartmentSpec { slot, doorNo, rect, interior, wallSolids, door, doorRange, spawn, exit, exitRange, outside, gridOrigin }`，导出 `APARTMENT_SPECS: readonly ApartmentSpec[]`（下标即 slot 0..5）。
   - `APARTMENT_ROOM_COUNT = 6`、`APARTMENT_DOOR_BASE = 301`、`doorNoOf(slot)` 语义保留；`rect / interior / wallSolids / door / spawn / exit / outside / gridOrigin` 全部在 spec 内由 `rect` 派生（内缩 8、南墙正中、台阶 +24/+26），**不留第二份手写坐标**。
   - `cellCenter(cell, spec)`、`clampToRoom(x, y, spec)`、`isNearApartmentDoor(spec, x, y)`、`isNearApartmentExit(spec, x, y)` 改为按 spec 取参；旧的无参版本删除而不是保留双份实现。
   - 家具网格由 8×6 收成 **6×4（24 格，`ROOM_CELL` 仍 44）**，楼体随之缩到 **300×240**，才能把 6 栋塞进中心空地；`houseTierSpec` 最高档 20 槽 < 24 格，档位规则不变，`sanitizePlacements`/`cellCenter`/`ApartmentDialog` 全部由常量派生自动适配。

2. **落点选择（几何约束优先）**
   - 6 栋整体落在以 `(4096,4096)` 为中心、半径约 ≤1700px 的环带内（现状约 1824px），避开：游乐园 `3556,2560,1080×600`、四角院落 `3336,3476,1520×1240`、广场圆 `r=360`、赌场 + 门前铺装、急救站 + 无障碍铺装、两栋小院、影音室、小黑屋、南院、八角笼、发泄区、三湖多边形、摸鱼亭、四条主路与各支路（半宽 56/48）、花海、花箱、竹林。
   - 起始坐标表（`x,y` 为左上角，300×240；执行时按碰撞与取整核验，允许 ±80px 微调以凑够间距）：301 `2980,4200`（西，西主路以南）、302 `3210,3160`（校园北侧草带）、303 `2700,2560`（西北坡）、304 `5160,3180`（东偏北）、305 `5160,3720`（东）、306 `4900,4560`（东南，需同时挪走 `4900,4560` 那片花海）。
   - 每栋门线落点 `outside` 必须 `isBlocked === false` 且 `isOnLand`，门前不压路、不压水；楼体四面墙外留 ≥40px 站立净空（尤其 306 要避开摸鱼亭 x≥5250、305/306 要避开东向主路的弯道）。
   - 不新增路网；若发现某栋门前是窄缝，用 ±80px 平移解决，而不是改 `PATHS`（避免牵动 `nav-arrival`/`campus-layout` 的既有断言）。

3. **热区按楼展开**
   - `WORLD_HOTSPOTS` 生成 6 条 `apartment-door-{slot}`（radius 64）与 6 条 `apartment-exit-{slot}`（radius 56），坐标取 spec；删除原固定 `apartment-door`/`apartment-exit`；`APARTMENT_RECT` 改为导出 spec 列表或首栋（确认无外部消费者后删掉）。
   - 服务端进入校验：站在**任意一栋**门口热区内即可（遍历同 kind 的 6 条）；离开校验：只认**自己房间那栋**的出口热区（`slot === player.roomId - 1`），防止用别栋出口穿墙。
   - 客户端 `selectContextHint` 谓词同步：`apartmentDoor` 仅 `roomId === 0`；`apartmentExit` 需 `roomId !== 0` 且是本人楼栋。

4. **服务端进出**
   - `sim/apartment.ts`：`enter()` 传送 `APARTMENT_SPECS[room.slot].spawn`，`exit()` 传送同 spec 的 `outside`；`allocate()` 逻辑不变（slot ⇔ 楼栋）；`stateFor()` 仍发 `doorNoOf(room.slot)`，因此客户端能反查楼栋。
   - `server.ts` 三处热区校验改成上面第 3 条的形式，其余（`broadcastRoom`、`refreshRoomPairing`、邀请）不动。协议零变更：`C2S_APARTMENT` 的 `arg` 保持保留位。

5. **客户端表现**
   - `ApartmentView.build()` 循环 6 个 spec，复用同一份楼体绘制函数（5 层楼带 + 门厅 + 霓虹门牌），每栋一个 depth 键（`rect.y + rect.h`）、一块静态牌匾「牛马公寓 · 301…306」。
   - `setRoomState(state)`：用 `doorNo - 301` 反查 spec，室内地板/家具按该 spec 的 `interior`/`gridOrigin` 绘制；牌匾只改当前这栋（有房主时显示「301 名字」）。`interiorLayer` 仍是单层容器，挂在 world 下用绝对坐标，渲染路径不变。
   - `renderer.ts` 只确认 `build()`/`setRoomState()` 签名兼容；`minimap-draw.ts`、`props.ts`、`ground.ts`、`interior-art.ts` 走 `WORLD_LAYOUT.buildings` 通用逻辑，6 条同名的「牛马公寓」条目会自动画出，无需改（若小地图标签重叠，只调标签尺寸）。

6. **性能与可靠性**
   - 静态碰撞从 4 条墙变 24 条墙，仍在既有网格索引里，20Hz 移动裁决无新增遍历；热区表 +12 条只在线性扫描提示/交互时命中，不进 tick 热路径。
   - 室内绘制仍是「只画当前楼栋」，6 栋外立面是构建期一次性 Graphics，无每帧开销。
   - 房间频道、AOI 过滤、深度排序、相机跟随全部复用；未落盘状态不变（房间仍是本运行周期临时空间）。

## 关键代码结构

```ts
export interface ApartmentSpec {
  readonly slot: number;            // 0..5，同时是房间频道下标
  readonly doorNo: number;          // 301..306
  readonly rect: WorldRect;         // 楼体（含 8px 墙）
  readonly interior: WorldRect;     // rect 内缩 8
  readonly wallSolids: ReadonlyArray<SolidRect>;
  readonly door: Point;             // 南墙正中 +24
  readonly spawn: Point;            // 室内落点
  readonly exit: Point;             // 室内出口热区心
  readonly outside: Point;          // 出门台阶
  readonly gridOrigin: Point;       // 6×4 家具网格原点
}
export const APARTMENT_SPECS: readonly ApartmentSpec[];
export function apartmentByDoorNo(doorNo: number): ApartmentSpec | undefined;
export function apartmentBySlot(slot: number): ApartmentSpec;
export function cellCenter(spec: ApartmentSpec, cell: number): Point;
export function clampToRoom(spec: ApartmentSpec, x: number, y: number, padding?: number): Point;
```

## 目录结构

```
packages/shared-types/src/
├── world/apartment.ts                    # [MODIFY] 由单栋常量改为 6 栋 ApartmentSpec 表：rect/interior/wallSolids/door/spawn/exit/outside/gridOrigin 派生、网格 6×4、cellCenter/clampToRoom/门出口判定按 spec 取参、apartmentByDoorNo/apartmentBySlot
├── world/layout.ts                        # [MODIFY] import 改为 APARTMENT_SPECS：REGIONS 6 条「牛马公寓」、buildings 6 条（floor:'concrete'）、paved 6 块、solids 展开 6 组墙、isPlantable 逐栋 40px 树带、NAV_ARRIVALS.apartment 指 301 栋台阶、NAV_SOURCES 取 6 栋并集中心、DOOR_PLAQUES.apartment 仍只保留一条（指 301 栋，place-signs 测试要求 12 项唯一）
├── world/hotspots.ts                      # [MODIFY] 由 APARTMENT_SPECS 生成 6 条 apartment-door-{slot} 与 6 条 apartment-exit-{slot}，删除固定 id 与 APARTMENT_RECT
└── __tests__/apartment-layout.test.ts     # [NEW] 断言：6 栋两两不相交、不与任何 building/paved/lake/path/solid 相交、四面 40px 净空、门线与 outside 可站（isBlocked=false / isOnLand）、相邻栋净距 ≥200（目标 300）、中心距 ≤1700、slot↔doorNo 一一对应

apps/game-server/src/
├── sim/apartment.ts                       # [MODIFY] enter/exit 按 room.slot 对应 spec 的 spawn/outside 传送，其余逻辑不动
└── server.ts                              # [MODIFY] C2S_APARTMENT 进出校验改为「任意门热区」/「本栋出口热区」

apps/web/
├── lib/game/apartment-view.ts             # [MODIFY] 循环 6 栋绘制外立面与静态牌匾，setRoomState 用 doorNo 反查楼栋绘制室内，家具宽度改用 ROOM_CELL 派生
├── lib/game/interactions.ts               # [MODIFY] apartmentDoor/apartmentExit 谓词补「本栋」判断
├── components/game/ApartmentDialog.tsx    # [MODIFY] 仅在硬编码网格尺寸/文案时同步为 6×4
└── data/release-notes.json                # [MODIFY] 追加 2026-11-15-12 一条面向玩家的说明

docs/adr/0092-six-apartment-blocks.md      # [NEW] 记录「一栋 6 频道」→「6 栋一栋一户」的取舍：每栋独立室内矩形、Player.roomId 1..6 与协议不变、楼体缩到 300×240 换取中心圈落位
```

## 执行注意

- `place-signs.test.ts` 强制 `DOOR_PLAQUES` 的 id 与 12 个导览目标一一对应且唯一：公寓门牌**只能一条**，其余 5 栋靠楼体自带牌匾显示门牌号。
- 手写坐标、禁 `Math.random`：落点一旦写死，服务端与浏览器必须逐像素一致。
- 树丛/花海与新区块冲突时用 `isPlantable` 留白与挪动花海矩形解决，不要靠删测试；`GROVE_CENTERS` 命中新楼体的簇会被自动拒种，注意别让某片林带被整片清空。
- 行为回归面：进出公寓、邀请串门、家具摆放与升级、小地图、区域名、冬季覆雪。


### SubAgent
- **code-explorer**
  - Purpose: 在动手重构前做一次「公寓常量全量消费点清点」，覆盖 `APARTMENT_*`/`doorNoOf`/热区 id/`ROOM_GRID_*` 在 shared-types、game-server、web 与全部测试断言中的引用，避免漏改导致「服务端放行、客户端不提示」这类隐性回归。
  - Expected outcome: 输出一份精确的文件+行号清单，作为改造范围基线，并与计划中的目录结构逐一比对确认。
