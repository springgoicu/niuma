# ADR-0094：场所美学分四层收口（色板 / 地面族 / 陈设与光 / 微动效）

- 状态：已采纳
- 日期：2026-11-15
- 关联：沿用 ADR-0013（暖色低饱和与「同色相压暗」）、ADR-0017（地面材质纪律）、
  ADR-0048（局部动态光图）、ADR-0061（摸鱼亭与固定宫灯）、ADR-0063（节日装饰）；新增
  `.codebuddy/skills/pixel-venue-polish`（项目级设计规范）

## 背景

园区十余处场所的地面各写各的：赌场、两栋小院都用 `wood`，六栋公寓用 `concrete`，
诊所干脆走 `WORLD_LAYOUT.paved` 的通用铺装，于是「走十步换一种气氛」这件事做不出来——
场地之间的差别只剩建筑本体，地面全是同一块灰。同时：

- 色值散在 `props.ts` 的 `COLOR`、各 View 的私有常量与 `fillFloorXxx` 三处，
  改一次要翻三个文件，还容易把「相邻场所色相至少错开 90°」踩掉；
- 赌场、诊所、擂台、公寓、小院、茶台、卫生间七处**一盏 `LightSpec` 都没有**，
  入夜全靠光图的环境色，暗到读不出细节；
- 落叶、水光、霓虹这类「让画面不死」的小动效没有统一写法，散落各处且各自维护状态。

难点在于：往 `WORLD_LAYOUT.props` 加家具要动双端契约、过碰撞单测；
而本次要加的绝大多数是**无碰撞的墙面与地面陈设**。

## 决策

### 1. 色板单点：`venue-palette.ts`

`VenueId` → `{ main, alt, seam, accent, glow }` 一张表，外加 `darken` / `mixColor` /
`outlineOf` / `seamOf` / `lighten` 五个纯函数。地面、陈设、灯色全部从这张表取，
禁止在绘制函数里写新的十六进制。相邻场所的色相在这里一眼可查。

### 2. 地面族扩三档：`BuildingSpec['floor']` 加 `felt | walnut | plaster`

`felt`（赌场墨绿绒）、`walnut`（会议室与两栋小院胡桃拼花）、`plaster`（公寓暖灰抹面）。
三档都是**纯表现枚举**：服务端只搬运、不解释，协议与碰撞一格不动。

不加到 `PropKind`：无碰撞陈设走 `interior-art.ts` 已验证的 `flat` / `place()` 路线，
贴墙位置本来就在墙体碰撞盒内，玩家站不进去，因此不需要补碰撞，也不需要双端发版。

### 3. 陈设与光：`venue-art.ts` + `venue-lights.ts`

`VenueArt.build(depth, base)` 与 `InteriorArt` / `PavilionView` 接口同形：
地面光池与落地小物进 `base`（永远在角色脚下），檐下挂件与角标进 `depth.add(脚底 y)`。

光位单独抽成 `venue-lights.ts` 的**纯数据**函数 `venueLights()`——不碰 Pixi，
因此能在 `bun:test` 里直接数数量。原因见第 5 条。

### 4. 微动效：`venue-motion.ts` 纯函数 + 单个 `VenueFx` 图层

`torchFlicker` / `neonPulse` / `waterGlint` / `bannerSway` / `screenFlicker` /
`leafX` / `leafY` / `leafAlpha` 全部是 `(seed, nowMs) => number`：

- 只看绝对时间，掉帧、切标签页回来都不错位（与 `police-beacon.ts` 同源）；
- 相位由 `seedUnit(seed)` 派生，同屏的落叶不会整排一起飘；
- 零状态、零分配，`VenueFx.update(nowMs)` 只写 `x/y/alpha/rotation`。

落叶（广场 14 + 公园 14）、水光（三湖各 8）、赌场霓虹（1）共 53 个精灵，
每屏同时运动不超过三类，周期 2.4–9s。

### 5. 光源预算 64 → 96，并加断言

新增 24 盏焦点光后，场景常驻约 62 盏，加上节日 6 盏已逼近 64。
`LightRegistry` 超限是**静默丢弃**（`add` 返回 -1），灯一多就会「某些灯不亮」且不报错。
因此：`MAX_LIGHTS` 提到 96，并在 `lighting.test.ts` 加「道具 + 场所 + 节日 + 室内定额」
的总数断言，加灯时测试先炸，而不是线上先黑。

### 6. 灰度：`?venue=0`

与 `?flat=1` / `?light=0` / `?bands=0` 同一套惯例，只关新装饰与微动效层，
地面族与既有 View 保留。出问题线上秒退，不必回滚发版。

## 后果

**收益**

- 场地靠色温分区：赌场墨绿、诊所与卫生间冷白、公寓暖灰、小院胡桃、广场暖石、
  擂台沙土，相邻场所色相至少错开 90°；
- 七处无灯场所有了 1–2 盏焦点光，入夜能读出细节又不糊成一片；
- 画面不再是一张死图：落叶、水光、霓虹呼吸都用同一套纯函数推进；
- 三处颜色来源收敛成一处，后续加场所照表填色即可。

**取舍**

- `BuildingSpec['floor']` 多了三档枚举，服务端类型跟着变宽（但只是搬运，无分支）；
- 光图填充率略有上升，验证时用 `?lm=2` 对比帧时间；
- `venue-palette.ts` 成为新的「必须一起改」的点，改色忘了改它会不一致——
  这条纪律写进了 `.codebuddy/skills/pixel-venue-polish/references/palette.md`。

## 验证

- `pnpm typecheck`：四包全绿；
- `apps/web` 的 `bun test lib`：新增 `venue-palette.test.ts`（无纯黑纯白、明度阶梯有序、
  压暗只动明度）、`venue-motion.test.ts`（区间、可复现、相位错开、落叶不出带），
  `lighting.test.ts` 增加预算与光位合法性断言；
- 浏览器：默认视角、`?venue=0`、`?light=0` 三套对照，确认新旧都能看、无漏光与黑块。
