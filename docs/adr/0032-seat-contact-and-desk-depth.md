# ADR-0032：桌子让到人后、角色坐上椅面，四向工位用同一套座位接触契约

- 状态：已采纳
- 日期：2026-11-11
- 关联：修订 ADR-0029（桌子深度键与椅子四向几何）、ADR-0031（坐姿贴图与椅子贴合度）；
  沿用 ADR-0024（渲染分桶）、ADR-0005（禁负缩放 / 整数纹素）、ADR-0027（座位朝向 = 家具朝向）

## 背景

ADR-0027 把工位桌做成四向、ADR-0029 让桌子随朝向转置、ADR-0031 重画了坐姿，但线上仍有同一句话：
**「侧坐工位还是有问题」**。这次点名的是「都有」：人被桌面切、人陷进椅子、桌子像一块平板。

## 问题

三处缺陷都能用常量算出来，且都只在东西两列（facing = Left / Right）成立：

### 1. 桌子深度键恒取占地南边，东西向把坐着的人压在下面

`props.ts` 原来用 `bottom = desk.y + footprint.h / 2` 当深度键。南北向 `footprint.h = 40` → 桌 `desk.y + 20`，
人 `seat.y = desk.y ± 40`，遮挡关系由人所在的一侧决定，物理正确。

东西向 `footprint.h = 88` → 桌 `desk.y + 44`；而 `campus.ts` 的 `workstation()` 只沿 x 让开座位，
`seat.y === desk.y`，椅子排在 `seat.y - 1`、人排在 `desk.y`。于是**桌子永远压在椅子与人之上 44 纹素**，
靠近桌子的那一侧（侧视的吻部）被桌沿切掉。同一个引擎四向拿到三种不同的遮挡关系。

### 2. 坐姿贴图按「坐在空地上」画，家具的 `sink` 只挪家具不挪人

ADR-0031 的坐姿用 `hipBottom = FEET`，渲染后臀底在 `seat.y - 1`。
椅子四向的座面顶面却各画各的：Down `seat.y - 11`、Up `seat.y - 16`、Left/Right `seat.y - 9`。
两边之间没有任何契约，于是**四向分别陷进去 10 / 15 / 8 纹素**，同一把椅子转 90° 贴合度就变一次。
侧视时椅子只剩 `stem`(4×4) + `base`(14×2) 露在剪影外，读成「坐在一根杆子上」。

### 3. 侧放桌的显示器画在桌面平面内部

横桌 `monitor y 2..24` 位于 `top y 28` 之上（立在桌面北缘、支架落在桌面）；
竖桌 `monitor y 34..56` 完全落在 `top y 6..78` 之内，读成「桌面上的平板」。
同一个游戏两套投影约定，侧放桌因此没有「桌沿高度」与「屏幕」两条线索。

## 备选方案

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 只调桌子深度键 | 修掉「桌面切人」，改动一行 | 人仍陷在椅子里、侧放桌仍是平板 | 低 |
| B. 重画坐姿，把臀底抬到椅面 | 一次解决贴合 | 牵动图集列与所有姿势，`sit-silhouette` 的贴地指标全部作废 | 高 |
| C. 桌深按朝向派生 + 座位接触契约 + 竖桌立面化（采纳） | 三处一起收口，四向共用一套数值；不改协议、不改服务端 | 竖桌帧加高 18、四向椅面重排、渲染层新增一次抬升 | 低 |
| D. 四向椅子都改成更难被遮住的大靠背 | 侧视更显眼 | 26×30 帧装不下，会与「共用帧」契约冲突；且不解决人陷进去 | 中 |

选 C。B 会把 ADR-0031 的可读性成果推翻；D 只改剪影，治不了贴合。

## 决策

### 1. 桌子深度键按朝向派生，不再恒取占地南边

`campus.ts` 新增纯函数，布局层就是唯一真相：

```ts
export function deskDepthOffset(facing: Direction): number {
  const horizontal = facing === DIRECTION.Left || facing === DIRECTION.Right;
  return horizontal ? -2 : DESK_H / 2;   // 南北 +20（占地南边）；东西 -2
}
```

- 精灵锚点仍是占地南边（`bottom`），桌子不陷地、不浮空；
- 东西向键取 `-2` 而不是 `-1`：椅子在 `seat.y - 1`、人在 `seat.y`，三者的顺序必须是显式全序，
  不能依赖 Pixi 同 `zIndex` 的插入顺序；
- `seats.test.ts` 遍历全部工位，断言东西向 `depth < seat.y - 1`、南北向仍是 `desk.y + DESK_H / 2`。

### 2. 座位接触契约：椅子四向同高，角色按座面抬升

新增 `apps/web/lib/game/seat-art.ts`（纯函数，不 import pixi）：

- `SIT_HIP_Y = -1`：坐姿臀底相对脚底锚点的高度；
- `seatArtFor(kind, facing)`：帧尺寸、`sink`、座面接触高度 `contactY`（相对座位锚点，负值向上）；
- `seatLift(kind, facing)`：`max(0, SIT_HIP_Y - contactY)`；没有座面契约的座位返回 0。

`chair-art.ts` 把四向座面顶统一到帧内 `SEAT_TOP = 13`（世界 `seat.y - 11`），帧仍 26×30：

| 朝向 | 座面（帧内） | 靠背 / 立柱调整 |
|---|---|---|
| 朝南 | `13..23` | 不变 |
| 朝北 | `13..21` | 靠背下移到 `19..30`，贴住帧底 |
| 朝西 / 朝东 | `13..21` | 立柱上提到 `21..27`，接住座面 |

于是四向 `contactY = 6 - 30 + 13 = -11`，`seatLift('chair', 任意朝向) = 10`。

### 3. 抬升落在渲染层，不动座位锚点与深度键

- `PonyRenderer` 分别记 `bobTexels`（≤ 0）与 `seatLiftTexels`（≥ 0），合成 `container.y = bob - lift`；
  阴影与水线在 container 之外，留在地面；
- `EntityView.setSeatLift` 同步抬高昵称与气泡；`setPosition` / `applyJump` 都减掉 `seatLift`；
- `session.ts` 维护 `entitySeat: netId → seatId`（服务端座位广播是全园广播，入场另有全量快照），
  `sitAt` / `standUp` / `handleSeatState` / `despawn` / `clearWorld` 同步；每帧 `syncSeatLift` 只在
  姿态是 Sit / Lie 时读一次映射，`setSeatLift` 值不变即早退；
- 深度键仍用脚底 y：抬升只改画面，不改「人 > 椅子 > 桌子」的顺序。

### 4. 竖桌立面化：帧 48×110，显示器立在桌面北缘

`desk-art.ts` 的 `VERTICAL_BODY`：

```ts
frame: 48 × 110     // 桌面北侧 24 + 桌面 72 + 前挡板 14
top:   y 24..96
front: y 96..110
monitor: y 2..24    // 底边贴桌面北缘，支架落在桌面上
```

- 帧只向北加高，帧底仍是占地南边，桌心与碰撞盒不动；
- 桌面陈设（绿植 / 马克杯 / 便签）整体下移 18；
- 背对镜头的南向桌（facing = Down）不改投影约定：显示器贴在桌面南半部，只断言「不越过桌面中线」。

### 5. 回归线

- `seat-art.test.ts`：四向 `contactY` 同值、抬升后臀底等于座面顶、非椅子座位抬升 0；
- `chair-art.test.ts`：四向座面顶同高、靠背仍在朝向反侧；
- `desk-art.test.ts`：竖桌 48×110、显示器不铺在桌面里、陈设不压显示器；
- `seats.test.ts`：东西向桌子深度键低于椅子与人。

## 后果

- 正面：
  - 东西两列的桌子退到人与椅子之后，角色压住桌沿、正对桌面；
  - 四向座面同高，角色臀底落在椅面上，侧视能看到座面、立柱与五星脚；
  - 侧放桌有立起来的显示器与桌沿高度，读得出「这是一张工位」；
  - 三处缺陷都由纯函数 + 单测锁住，位图里看不出的回归 CI 能挡住。
- 负面：
  - 竖桌帧从 48×92 变 48×110，一次性多烘焙约 1.7k 像素/张，可忽略；
  - 角色坐在任何椅子上都会整体上移 10 纹素，昵称与气泡同步上移，头顶空间变紧；
  - 远端角色的抬升依赖座位广播；地面坐 / 躺没有座位，抬升为 0（旧行为）。
- 回滚：低。删掉 `seat-art.ts` 与 `syncSeatLift` 调用、把 `chair-art.ts` 的 `SEAT_TOP` 与
  `desk-art.ts` 的竖桌几何退回，跑一次 `pnpm test` 即可；布局、协议、服务端零改动。

## 调参旋钮

| 现象 | 先调 |
|---|---|
| 东西向仍被桌沿切人 | `deskDepthOffset` 的东西向值（当前 -2），不要动精灵锚点 |
| 人坐在椅面上仍悬空 / 陷进去 | `chair-art.ts` 的 `SEAT_TOP`，再核 `seat-art.ts` 里的椅子 `sink` |
| 侧视椅子仍只剩一根杆 | 先确认 `seatLift` 是否真的应用到了远端角色（`entitySeat` 是否有该 netId） |
| 竖桌显示器又像平板 | `VERTICAL_BODY` 的 `top.y` 与 `monitor` 是否仍满足 `monitor.y + h <= top.y` |
| 桌子与椅子抢排序 | 东西向深度键必须严格小于 `seat.y - 1`，不要靠同键插入顺序 |

## 复核信号

- 出现「侧向工位的人被桌面切掉」：查 `props.ts` 的 `depth.add` 是否仍读 `deskDepthOffset`；
- 出现「人陷进椅子」：查 `session.syncSeatLift` 是否在 `setPose` 之后调用，以及 `entitySeat` 是否被
  `standUp` / `handleSeatState` 正确清理；
- 出现「转身时人忽高忽低」：查 `chair-art.ts` 四向 `SEAT_TOP` 是否被单独改过；
- 出现「竖桌显示器浮空」：查 `monitor.y + monitor.h` 是否仍 `<= top.y`；
- 出现「桌子和人同键闪烁」：查是否又把桌子键改回 `seat.y - 1`。
