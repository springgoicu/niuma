# ADR-0101：公寓收敛为唯一一栋，撤掉的空地留成门前口袋花园

- 状态：已采纳
- 日期：2026-11-15
- 关联：修订 ADR-0095（六栋公寓楼）、ADR-0099（栋间巷道 48px）；沿用 ADR-0098（窗口探头）、
  ADR-0081（落盘范围）、ADR-0087（纯渲染装饰不动契约）、ADR-0100（弱交互只做客户端演出）

## 背景

ADR-0095 把原先西南角一栋公寓拆成六栋（301–306），绕中央广场四向铺开，理由是「住宅要有街区的规模感」。
ADR-0098 又把室内房间撤掉，公寓只剩「门口按 F、从外立面窗口探头」这一件事。

于是六栋楼的实际作用只剩两点：提供 6×20 = 120 个探头窗口，以及占掉生活区西侧 6 块 300×240 的实心地面。
而玩家总数远小于 20，一栋楼的 20 个窗口就够用；多出来的五栋：

- 把生活大街北侧压成两排巷道，斜着贴墙角走容易发黏（ADR-0099 为此把巷道从 40 加到 48）；
- 每栋各挂一条门热区、一盏门廊灯、一条小地图填色，维护成本 ×6，收益却完全相同；
- 站在门口时「按 F 进哪一栋」在画面上几乎分辨不出，六栋读起来只是同一栋楼的复制品。

## 决策

### 1. 只留 301 一栋，`slot` 恒为 0

`APARTMENT_RECTS` 收敛成单条坐标，`APARTMENT_ROOM_COUNT` 改为 `APARTMENT_RECTS.length` 派生，
删除已无意义的 `APARTMENT_ALLEY` 与 `ALLEY_COLUMN_X`：

- `APARTMENT_SPECS` / `APARTMENT_WINDOWS` / `APARTMENT_WALL_SOLIDS` / `doorNoOf` / `apartmentBySlot` /
  `apartmentByDoorNo` / `apartmentWindowAt` 结构全部不动，仍从这一条坐标派生；
- 门牌只剩 301，`apartmentByDoorNo(302)` 起一律返回 `undefined`，越界 `slot` 夹回 0；
- **协议一个字都不改**：`S2C_APARTMENT_PEEK` 的 `slot` 字段保留（恒为 0），
  `Player.roomId` 仍是 `slot + 1`（1 = 在窗里），`0x4d`–`0x50` 继续永久留空。
  将来若要恢复第二栋，仍然只是加一行坐标。

楼体尺寸（300×240）、4 层 × 5 列共 20 个窗口、一窗一人、占满拒客、出门回门口台阶全部不变。

### 2. 收敛靠派生，不逐个改调用点

`districts.ts`（`VENUES` / `NAV_TARGETS`）、`hotspots.ts`、`layout.ts`（`solids` / `buildings` / 种树留白）、
客户端 `apartment-view.ts` / `venue-lights.ts` / `window-peek.ts` / `minimap-draw.ts`
原本都按 `APARTMENT_SPECS` 展开，删楼后自动只剩一处。只有三处需要手改：

- `VENUES` 从「六条 `apartment-N`」合成一条 `apartment`（导览 `navId` 本来就是 `apartment`）；
- 六条门热区自动变一条（`apartment-door-0`）；
- 注释与计数断言从「六栋 / 0..5 / 301–306」改成单栋口径。

### 3. 撤掉的空地做成门前口袋花园，纯装饰零碰撞

原 302–306 的位置不再补楼、也不留荒草，改成一片可自由穿行的绿地：

```ts
export const APARTMENT_GARDEN: WorldRect = { x: 3200, y: 4936, w: 820, h: 356 };
export const APARTMENT_GARDEN_PATH: WorldRect = { x: 3334, y: 4952, w: 32, h: 340 };
```

- **石板小径**：从门口台阶直通花园南沿、正对 301 门牌（中线 x = 3350）；三列 9×7 石板、
  列距 10、行距 8，错缝只由行号奇偶决定，共 126 块，整数纹素、确定性；
- **灌木带**：小径两侧各一条，撒点复用 `street-decor.ts` 的 `propsAllowed` 校验，
  自动让开路缘、花圃、树与碰撞体；
- **花圃**：花园里加一畦花海（`FLOWER_FIELDS`），色块读起来像「有人在打理」；
- **石沿**：南北两缘在小径处各留 40px 缺口，东西两沿整条通到底，取 `TOWN_MATERIALS.stone/stoneDark`，
  描边同色相压暗，不用纯黑；
- **零碰撞**：不写 `PROP_FOOTPRINT`、不进 `WORLD_LAYOUT.solids`、不碰 `PropKind`，
  服务端权威位移与自动寻路完全不知道有这片花园。

装饰仍在同一条管线里：`streetDecorPlan()` 汇总 → `buildStreetDecor()` 构造期一次烘焙，
`?decor=0` 时与小径、灌木、石沿整体退场；`?light=0` 时石沿保留、暖光池退场。

### 4. 树留白与花圃

`isPlantable()` 增加 `APARTMENT_GARDEN` ±12 的排除：石板小径与灌木位不能被随机散树吃掉。
`looseTrees()` 的随机数列按格推进（先取 roll 再判 `isPlantable`），因此撤楼只会让原楼址**新增**散树，
不会重排全岛其余树位——视觉爆炸半径最小。

### 5. 光预算从 6 盏降到 1 盏

公寓门廊灯随 `APARTMENT_SPECS` 循环自动从 6 盏变 1 盏，`venueLights()` 常驻总数 30 → 25。
花园夜里不添灯：小径中段用 `venue-art` 的 `pool()` 烘一层暖色光斑（符合「其余靠地面提亮与烘焙暖色块」）。

## 后果

- 碰撞体 6 → 1、门热区 6 → 1（全场 29 → 24）、常驻光源 −5：20Hz 移动裁决与最近热区查询都更轻；
- 生活区西侧从「两排楼 + 48px 巷道」变成「一栋楼 + 一片花园」，玩家从广场回家只有一条正对门牌的路；
- 小地图公寓填色只剩一块，区域名仍统一显示「牛马公寓」；
- 测试口径改为单栋：`apartment-layout.test.ts` 钉「门牌只剩 301 / 一条门热区 / 20 窗口 / 花园与小径几何 /
  花园内无树」，`street-decor.test.ts` 钉「石板全在小径内 / 花园灌木不压楼体与小径」，
  `lighting.test.ts` 预算改 [21,27]，服务端 `apartment.test.ts` 改 slot 0 与夹取。

## 备选方案

- **保留两到三栋**：仍要维护多条门热区与多份小地图填色，收益只是「街区更宽」，不如把地面还给绿地。
- **一栋楼放大到 600×480**：窗口数会变成 8×10 = 80，容量远超实际人数；立面比例也会与相邻建筑脱节。
- **撤楼后什么都不加**：六栋实心楼撤掉后西侧会剩一块没有内容的空草地，从广场看过去像「没做完」，
  且冬季雪面上一片空白；口袋花园是成本最低的收尾。
- **把花园做成可交互（长椅、摇钱树）**：那要进 `WORLD_HOTSPOTS` 与 `PropKind`，双端发版，
  与本次「只做视觉收尾」的目标不符。
