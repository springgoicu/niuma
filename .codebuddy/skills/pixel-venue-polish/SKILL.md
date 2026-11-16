---
name: pixel-venue-polish
description: 牛马园区像素场所美化规范。当需要在 apps/web/lib/game 下新增或改造某个场所（工作区、会议室、宿舍、卫生间、影音室、小黑屋、中央广场、祭坛、茶台、赌场、擂台、诊所、公寓、别墅、公园、湖畔、公告栏）的地面材质、陈设细节、灯光氛围或循环微动效时使用；也用于评审某次场景改动是否符合全站像素画风与光照预算。
---

# 像素场所美化

## 用途

把「共用一套地砖的园区」保持成「每走十步换一种气氛的园区」。本 skill 只覆盖 PixiJS 画布上的程序化像素绘制，不做网页 UI 改版。

## 何时使用

- 新增一处场所，或给已有场所加陈设、换地面、加灯、加动效。
- 觉得某处「灰扑扑」「没有场地感」，需要定位该改哪个文件。
- 评审场景改动：配色是否越界、描边是否用了纯黑、光是否超预算、动效是否引入每帧分配。

## 硬约束（违反即打回）

1. **不动玩法**：坐标、碰撞盒、座位、协议、服务端 Tick 一律不改。纯装饰只画在渲染层。
2. **优先零碰撞路线**：墙面与地面陈设走 `flat`（永远在角色下方）与 `place()`（按脚底 y 排序），不要为了挂一幅画去动 `PropKind`。只有「可交互或有碰撞」的新家具才动 `packages/shared-types`。
3. **描边只用色相压暗**：1px 描边取本体色相同一色相压到四成明度，禁止纯黑（`0x000000`）与中性灰。参考 `props.ts` / `interior-art.ts` 的 `COLOR.outline = 0x2a3142`。
4. **明度阶梯只留两三档**：本体 + 一档阴影，最多再加一档高光。地面越花，角色越出不来。
5. **场地靠色温差分区，不靠更花**：相邻场所色相至少错开 90°；全站暖色低饱和 pastel 打底。
6. **每处至少一盏灯、最多两盏焦点光**：光位走 `LightSpec`，其余靠地面提亮与烘焙暖色块表现。`MAX_LIGHTS` 预算见 `references/layering-and-lighting.md`。
7. **微动效必须是纯函数**：`(seed, nowMs) => 值`，相位由种子派生、LUT 查表，零每帧分配、可单测。不要往帧循环里塞 `generateTexture`。
8. **构造期烘焙**：所有贴图在 `buildLayers()` 阶段一次 `bake()`，帧循环只做裁剪与贴图切换。

## 工作流

### 第一步：确认场所与入口

查 `references/venue-map.md` 的映射表，拿到「场所 → 绘制文件 → 坐标常量 → 现有光/动效」。同一个场所可能横跨两处：室内四房在 `props.ts`（地面）+ `interior-art.ts`（陈设），广场在 `terrain.ts`（主体）+ `props.ts`。

### 第二步：取色板

查 `references/palette.md` 的场所锚点色表，直接用它给的三档（主色 / 次色 / 缝隙）与点缀色。不要在绘制函数里新写十六进制魔法数字；新场所先往 `apps/web/lib/game/venue-palette.ts` 的常量表里加一行，再让绘制代码从表里取。

### 第三步：画地面与陈设

- 地面族在 `props.ts` 的 `fillFloorXxx(g, rect)` 里画；色值从 `venue-palette.ts` 取。新增地板家族要同时改 `packages/shared-types/src/world/campus.ts` 的 `BuildingSpec['floor']` 联合类型（`FloorKind`）与 `props.ts` 的 `fillBuildingFloor` 分派。
- 陈设：室内四房走 `interior-art.ts`，其余场所走 `apps/web/lib/game/venue-art.ts` 的 `paintXxx()` / `depthXxx()`。平面装饰进 `base`，立式摆件 `depth.add(脚底 y, root)`。
- 每处至少加一处「生活细节」：桌面冰美式、白板笔迹、晾衣绳、镜面水渍、价目牌、盆栽、灯串。细节要能一眼读懂是什么，不要抽象色块。

### 第四步：加光与动效

- 光：光位一律写进 `apps/web/lib/game/venue-lights.ts` 的 `venueLights()`（纯数据，可单测），由 `VenueArt.lights` 转交 `renderer.ts` 注册。暖灯 `flicker` 0.08–0.16、霓虹 0.02、冷白灯 0。每处只留 1–2 盏焦点光。
- 动效：加进 `apps/web/lib/game/venue-motion.ts` 的纯函数族，由 `VenueFx` 单个图层在既有 `tickBubbles()` 里 `update(nowMs)`，不新增 ticker。
- 每屏同时运动的元素不超过三类，周期 2–4 秒，相位按种子错开。

### 第五步：验收

1. `pnpm typecheck` —— 四包全绿。
2. `pnpm test` —— 渲染纯模块单测（`bun test lib`）与共享契约单测（`vitest run`）全绿。
3. 新增纯函数补单测：色板齐全性（无纯黑、描边为同色相压暗）、动效区间与可复现性、光源总数 ≤ `MAX_LIGHTS`。
4. 浏览器核对：默认视角 + `?venue=0` 关闭新装饰、`?light=0` 关闭光照，确认新旧两套都能看、无漏光与无黑块。
5. 提交前按 `AGENTS.md` 往 `apps/web/data/release-notes.json` 追加一条面向玩家的版本工报，并跑 `pnpm changelog:check`。

## 常见错误

| 症状 | 原因 | 改法 |
|---|---|---|
| 角色在花地砖上糊成一团 | 地面明度阶梯超过三档 | 砍到本体 + 一档阴影 |
| 夜里整片死黑 | 只加了发光体没加 `LightSpec` | 补灯位，或用烘焙暖色块提亮 |
| 某些灯不亮 | 超过 `MAX_LIGHTS` 被静默丢弃 | 先看 `lighting.test.ts` 的预算断言 |
| 装饰压住角色脸 | 贴墙陈设误入 `flat` 之外的层 | 平面装饰进 `flat`，立式摆件进 `place()` |
| 帧率抖动 | 帧循环里 `generateTexture` 或每帧 new 对象 | 挪到构造期烘焙 / 改用 LUT |
| 两个场所在边界上分不清 | 色相没拉开 | 把相邻场所的色相错开 90° 以上 |

## 参考文档

- `references/palette.md` —— 全站色板、同色相压暗算法、每场所锚点色与点缀色。
- `references/layering-and-lighting.md` —— `DepthSink` / `flat` / `place` 分层规则、`LightSpec` 字段、`flickerAt` LUT、`MAX_LIGHTS` 预算与注册点。
- `references/venue-map.md` —— 场所 → 文件 → 坐标常量 → 现有光 → 现有动效的完整映射表。
