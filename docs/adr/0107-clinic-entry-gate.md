# ADR-0107：护士急救站只收救护车送来的伤员

- 状态：已采纳
- 日期：2026-11-16
- 关联：急救链与工伤保护沿用 ADR-0084；西侧人行门 / 南侧救护车通道的几何沿用 ADR-0092；
  NPC 进入救护链沿用 ADR-0106；零持久化沿用 ADR-0004 / ADR-0081

## 背景

ADR-0092 为了「柜台背后的伤员也能被接走」，在护士站围挡西侧留了 56px 人行门、南侧整段敞开当
救护车通道。门洞是真开口，于是**所有步行角色**都能顺着铺装走进站内：

1. 玩家可以自己走进急救站，站内既没有玩法也没有门禁，看起来像一块漏出来的后门；
2. 巡逻 NPC 的采样点落在站内时会反复撞柜台、卡在床沿，`findFreePoint` 脱困会把它们甩到墙外；
3. 击退（`sim/vent`）与老板冲击波（`sim/boss-shock`）是直写坐标，能把人一拳推进站里。

产品口径是「只有被打倒后由救护车送医的伤员才进站」，并且**治好的伤员必须自己走出去**。

## 决策

### 1. 门禁做成方向性规则，不做实体墙

新增 `packages/shared-types/src/world/clinic-gate.ts`，只导出两个纯函数：

```ts
/** 站内地面（不含围挡带）。边界不算站内：门线上的下一步会被夹回来 */
export function isInClinicInterior(x: number, y: number): boolean;

/** 步行求解 = 地形求解 + 护士站门禁；返回 true 表示这一帧被门禁挡下 */
export function resolveWalkInto(out, fromX, fromY, toX, toY, radius?): boolean;
```

`resolveWalkInto` 先跑既有 `resolveMotionInto`（4px 子步、单轴滑动、1px 内角侧移全部保留），再做裁决：

- `from` 严格在 `CLINIC_RECT` 内 → 原样放行（只挡进不挡出）；
- `from` 在外、结果在内 → 用 slabs 法求线段与矩形边界的**入点参数** `tEntry`，把结果落到门线上，
  切向分量按入点保留，斜着走会贴着门框滑行而不是整步回退（整步回退会把门角走成死胡同）；
- 夹取后若仍严格在站内（碰撞求解把切向分量挤进围挡）→ 回退到起点。

`isInClinicInterior` 取**严格内点**：夹取会把脚底落在门线上，若边界算站内，下一帧就重新获得向内走的
许可，形成「夹一次、进一寸」的漏门。

### 2. 只作用于「步行位移求解」这一条路径

| 位置 | 接法 |
|---|---|
| `sim/movement.applyMove` | 改调 `resolveWalkInto`，忽略返回值（速度截断口径不掺入门禁） |
| `web/lib/game/session` 本地预测 | 同函数预测，被挡时按 3s 节流弹 `HINT.clinicGate` |
| `npc/brain`（漫游）、`npc/follow`（跟随）、`npc/escort`（保安行走） | 改调 `resolveWalkInto` |
| `npc/escort.placeTargetBehind`（被拖者 26px 跟随位移） | 保持 `resolveMotionInto`：保安永远在站外，被拖者落在保安身后，套门禁反而会在门口把人拽过栏杆 |
| `sim/vent` 击退、`sim/boss-shock` 冲击波 | 改调 `resolveWalkInto`：`from` 在站内放行，刚治好的伤员不会被卡住 |
| `sim/clinic` 的 `moveCar` / `attachPatient` / `admit` / `advanceBeds` | 不动：救护车继续直接用 `resolveMotionInto`，否则送医链路当场掐死 |
| `findFreePoint` / `isBlocked` / 寻路网格 | 不动：站内塞进 `isBlocked` 会让站内伤员的寻路起点被 `snapCell` 甩到墙外，`findFreePoint` 也会把人抬出站 |

### 3. 满员逻辑保持现状

两张床都占用时救护车照常进站，`admit` 用 `seatId = 0` 只走 3s 治疗计时，伤员在落点
`CLINIC_DROP` 的地面治好，`advanceBeds` 不挪坐标；随后由玩家自己的移动包走出站门
（`from` 在站内一律放行）。

### 4. NPC 采样与导览绕开门线

- `npc/spots.pickWaypoint` / `pickSpawnPoint` 用 `isInClinicInterior` 排掉站内点：NPC 不会把
  漫游目标选在站里，再反复撞门；
- `NAV_ARRIVALS.clinic` 移到西门外的 `CLINIC_ACCESS_PAVING` 上（仍在 `CLINIC_REGION_RECT` 内，
  区域名照旧显示「护士急救站」）：导览不再把玩家送进站内，`pathfinding` 的网格不需要改。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 用实体墙封住门洞 | 规则天然统一 | 同时挡住救护车；`findFreePoint` 还会把站内伤员当「卡在墙里」传送出站，直接违反「自己走出去」 | 否决 |
| B. 把站内塞进 `isBlocked` | 一处开关 | 寻路网格、出生采样、脱困搜索全受影响，站内伤员的第一步就会被甩出站 | 否决 |
| C. 方向性步行门禁（本 ADR） | 零几何变更、零协议变更、可回滚；双端同一份规则 | 多一层求解包装，返回值只给客户端提示用 | 采纳 |
| D. 门禁下沉到每个调用方各自判 | 不改共享层 | 玩家 / NPC / 击退 / 冲击波四处口径漂移，客户端预测也会与服务端分叉 | 否决 |
| E. 只在服务端挡，客户端照常预测 | 服务端仍权威 | 客户端「先穿门再被拉回」，观感是瞬移 | 否决 |

## 后果

- 站外观感不变：西门洞与南通道照旧敞开，救护车照常进站、照常把伤员放在落点；
- 步行角色贴到门线会被挡住并可按切向滑行，客户端弹一句「护士站只收救护车送来的伤员」（3s 节流）；
- 治好的伤员自己走出门线后立刻恢复门禁，出去之后再往里走会被夹在门外；
- 权威仍在服务端：客户端只是同规则预测，失步由既有位置同步收敛；协议与 `world-state.json`
  的落盘范围都没有改动（ADR-0004 / ADR-0081）；
- 新增单测：`clinic-gate.test.ts`（只挡向内、切线滑行、斜穿门角、站内自由行走、NaN 防御）、
  `movement.test.ts`（西门被夹回门外 / 站内可自由走）、`clinic.test.ts`（两床满员时第三名伤员
  地面治疗、位置仍在落点、治好后能自己走出站）；
- 回滚：把六处 `resolveWalkInto` 调用改回 `resolveMotionInto` 并删掉 `clinic-gate.ts` 与其导出，
  即可恢复旧行为——没有任何实体几何、协议字段或持久化需要一并回滚。

## 已登记、本次不修的边界项

1. 传送类落位（`seats.occupy`、`advanceBeds` 写床尾）不受门禁约束：它们不是步行，也不是「玩家自己走进去」；
2. 擂台与野外切磋仍是独立战斗域（ADR-0073），场内淘汰者不会进急救站；
3. 门禁文案只解释「为什么不让我进」，不解释「谁能进」的完整分级——完整分级交给 ADR-0106 的救护链。
