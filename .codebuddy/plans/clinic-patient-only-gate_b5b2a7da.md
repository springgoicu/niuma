---
name: clinic-patient-only-gate
overview: 给护士急救站加"只挡进、不挡出"的门禁：除昏迷伤员由救护车送入外，玩家与 NPC 的步行位移都不能跨进 CLINIC_RECT，治好的伤员仍能自己走出；救护车链路与满员地面治疗保持不变，导览到达点移到西门外并补提示。
todos:
  - id: clinic-gate-rule
    content: 新增 shared/clinic-gate.ts 方向门禁与单测，只挡向内、站内放行 [skill:tdd]
    status: completed
  - id: wire-walkers
    content: 双端与 NPC 步行改接 resolveWalkInto，补节流提示与采样排除站内
    status: completed
    dependencies:
      - clinic-gate-rule
  - id: nav-arrival-outside
    content: 护士站导览到达点移到西门铺装，更新 nav-arrival 与几何断言措辞
    status: completed
    dependencies:
      - clinic-gate-rule
  - id: full-beds-exit
    content: 补满员第三名伤员地面治疗用例，并证明治好后能自己走出站
    status: completed
    dependencies:
      - wire-walkers
      - nav-arrival-outside
  - id: docs-release
    content: 写 ADR-0107 与 README 段落，追加版本工报并跑 changelog:check [skill:domain-modeling] [skill:verification-before-completion]
    status: completed
    dependencies:
      - full-beds-exit
---

## 用户需求

护士急救站设置门禁：除「被打倒后由救护车送医」这一条链路外，任何角色都不能进入站内；同时要兼顾两张病床满员时的处理。

## 产品概览

护士急救站外观不变：西侧 56px 人行门洞与南侧救护车通道照旧敞开，救护车照常进站、照常把伤员放在落点。变化只发生在规则层：步行角色（真人玩家、巡逻 NPC、保安、护士）走到门线时会被稳稳挡住，贴着门框仍能左右滑行，并给一句短提示；已经在站内的伤员（治疗结束站到床尾的、满员时在落点地面治好的）可以自由走动、自己走出站门，出去的瞬间不再受门禁影响。

## 核心功能

- 只挡向内：站外走向站内被夹回门线，站内走向任意方向放行；不新增实体墙，救护车不受影响。
- 全角色覆盖：真人、会走路的 NPC、押送保安、击退与老板冲击波造成的位移都走同一把尺，不再出现「被一拳推进站内」。
- 满员逻辑保持现状：两张床都占用时救护车照常进站，伤员在站内落点地面完成治疗，随后自行走出。
- 导览不再把人送进站内：护士站到达点移到西门外的无障碍铺装上，区域名仍显示「护士急救站」。
- 视觉反馈：被挡住时弹出一句节流提示，避免「看得见的门洞 + 看不见的墙」被当成 bug。

## 技术栈

- 沿用现有仓库：TypeScript 单仓 + pnpm/turbo；共享几何与规则在 `packages/shared-types`；服务端 `apps/game-server`（bun + bun:test）；客户端 `apps/web`（Next.js + 纯函数预测，vitest/bun:test）。
- 不新增依赖，不新增协议字段，不改 `world-state.json` 落盘范围。

## 实现路径

把「谁能进站」做成共享层的**方向性步行门禁**，与 `resolveMotionInto` 的几何求解同层：

1. 新增 `packages/shared-types/src/world/clinic-gate.ts`，只依赖 `world/clinic`（几何）与 `world/collision`（求解器），不含运行期状态，双端与 NPC 读到同一份规则。
2. 核心函数 `resolveWalkInto`：先跑既有 `resolveMotionInto`（4px 子步 + 单轴滑动 + 1px 内角侧移全部保留），再做门禁裁决：
   - `from` 严格在 `CLINIC_RECT` 内 → 直接放行（只挡进不挡出，治好的伤员才能走出去）；
   - `from` 在外、结果在内 → 用 slabs 法求线段与矩形边界的**入点参数** `tEntry`，把结果落到门线上（保留切向分量，斜着走贴着门框滑行，不整步回退，否则门角会卡死）；
   - 夹取后若仍严格在站内（数值兜底）→ 回退到起点。
3. 所有步行求解改接 `resolveWalkInto`；救护车继续直接用 `resolveMotionInto`，卡死脱困继续用 `findFreePoint`。
4. 客户端与服务端逐字一致地调用同一函数，预测不会「先穿门再被拉回」；返回值仅供客户端做节流提示，服务端不消费（不污染 `moveSampler` 的速度截断口径）。

关键决策与权衡：

- **不做实体墙**：实体会同时挡住救护车，还会让 `findFreePoint` 把站内伤员「自动脱困」传送出站，直接违反「自己走出去」。方向性规则零几何变更，可回滚。
- **不把站内塞进 `isBlocked`**：`isBlocked` 是寻路网格、出生采样与脱困搜索的共同输入，一改会让站内伤员寻路起点被 `snapCell` 甩到墙外，也会让 `findFreePoint` 把人抬出去。门禁只作用于「步行位移求解」这一条路径。
- **边界判定取严格内点**：夹取会把脚底落在门线上，若边界算「站内」，下一帧就获得向内走的许可（夹一次、进一寸的漏门）。因此 `isInClinicInterior` 必须严格（不含边界）。
- **导航不改地形网格**：`findPath` 只被 `planRoute` 调用，站内没有可点的寻路入口；只把 `NAV_ARRIVALS.clinic` 移到站外即可，不动 `pathfinding.ts`。

性能与可靠性：门禁裁决是常数级（几次比较 + 一次线性插值），不分配对象，沿用调用方传入的 `MotionTarget` 复用槽；移动包热路径每秒约 4000 次，增量开销可忽略。权威仍在服务端，客户端只是同规则预测，失步由既有位置同步收敛。

## 执行注意事项

- `CLINIC_RECT` 与围挡、铺装、落点、床位的相对关系一个字都不改；`clinic-layout.test.ts` 的几何断言必须继续通过（它证明「门洞几何无阻挡」，与「规则只出不进」并不矛盾，只调措辞与注释）。
- 救护车 `moveCar`、`attachPatient`、`admit`、`advanceBeds` 的直写坐标一处都不碰；给救护车加门禁会把送医链路直接掐死。
- 押送侧只给保安的行走路径套门禁；`placeTargetBehind` 的 26px 跟随位移保持原样（保安永远在站外，被拖者落在保安身后，套门禁反而会在门口把人拽过栏杆）。
- 击退与冲击波套门禁是为了「不被推进站内」；`from` 在站内一律放行，治疗刚结束的伤员不会被卡在站里。
- 提示只在真的被挡时出现并节流（约 3s），文案放 `hint-copy.ts` 的 `HINT` 常量，时间口径用 `performance.now()`（纯本机 UI 节流，与玩法时钟无关）。
- NPC 采样（`pickWaypoint` / `pickSpawnPoint`）排除站内点，避免 NPC 反复撞门进入卡住循环。
- 收尾按 AGENTS.md：`release-notes.json` 追加一条并跑 `pnpm changelog:check`；新决策写 ADR-0107，不修改历史 ADR。

## 架构与数据流

- 共享层：`clinic.ts`（几何唯一事实源）→ `clinic-gate.ts`（方向规则，纯函数）→ `index.ts` 汇总导出。
- 调用方：`sim/movement.ts`（服务端裁决）、`lib/game/session.ts`（客户端预测 + 提示）、`npc/brain|follow|escort`（NPC 步行）、`sim/vent|boss-shock`（非步行的位移写入）。
- 绕开门禁的合法链路：`sim/clinic.ts` 的救护车与 `seats.occupy`（传送）、`advanceBeds`（床尾与落点直写）。

## 目录结构

```
packages/shared-types/
├── src/
│   ├── index.ts                                   # [MODIFY] 追加 `export * from './world/clinic-gate'`
│   ├── world/
│   │   ├── clinic-gate.ts                         # [NEW] 方向门禁：isInClinicInterior / resolveWalkInto。
│   │   │                                          #   严格内点判定；slabs 求入点参数夹到门线；
│   │   │                                          #   夹后仍在内则回退起点；返回是否被挡。
│   │   └── districts.ts                           # [MODIFY] NAV_ARRIVALS.clinic 移到西门外铺装
│   │                                              #   （仍落在 CLINIC_REGION_RECT 内，区域名不变）
│   └── __tests__/
│       ├── clinic-gate.test.ts                    # [NEW] 只进不出、门洞切线滑行、对角线、救护车落点、
│       │                                          #   站内自由行走与向外走、NaN 防御
│       ├── nav-arrival.test.ts                    # [MODIFY] clinic 从「室内房间」断言改为
│       │                                          #   「站外可站立、仍在急救站区域」
│       └── clinic-layout.test.ts                  # [MODIFY] 仅调措辞/注释：门洞几何无阻挡，规则另算
apps/game-server/src/
├── sim/
│   ├── movement.ts                                # [MODIFY] 156 行改 resolveWalkInto；忽略返回值
│   ├── movement.test.ts                           # [MODIFY] 补「西门被夹回门外」「站内可自由走」
│   ├── vent.ts                                    # [MODIFY] 两处击退位移改 resolveWalkInto
│   ├── boss-shock.ts                              # [MODIFY] 冲击波击退改 resolveWalkInto
│   └── clinic.test.ts                             # [MODIFY] 补两床全满第三名伤员地面治疗、
│                                                  #   位置仍在 CLINIC_DROP、结束后可走出
└── npc/
    ├── brain.ts                                   # [MODIFY] 262 行步行改 resolveWalkInto
    ├── follow.ts                                  # [MODIFY] 128 行步行改 resolveWalkInto
    ├── escort.ts                                  # [MODIFY] 保安行走 288 行改 resolveWalkInto；
    │                                              #   placeTargetBehind 保持原样并注明原因
    └── spots.ts                                   # [MODIFY] pickWaypoint / pickSpawnPoint 排除站内点
apps/web/lib/game/
├── session.ts                                     # [MODIFY] 2866 行改 resolveWalkInto；
│                                                  #   被挡时节流 showHint（新增 clinicGateHintAt）
└── hint-copy.ts                                   # [MODIFY] HINT 增加 clinicGate 文案
apps/web/data/release-notes.json                   # [MODIFY] 追加一条玩家可感知记录
docs/adr/0107-clinic-entry-gate.md                 # [NEW] 决策、备选方案、后果与回滚
README.md                                          # [MODIFY] 360-371 诊所段、481 服务区、
                                                   #   525 场所表备注、561 导览目标说明
```

## 关键结构

```ts
/** 站内地面（不含围挡带）。边界不算站内：门线上的下一步会被夹回来 */
export function isInClinicInterior(x: number, y: number): boolean;

/** 步行求解 = 地形求解 + 护士站门禁；返回 true 表示被门禁挡下（仅供客户端提示） */
export function resolveWalkInto(
  out: MotionTarget,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius?: number,
): boolean;
```

## Agent Extensions

- **tdd**：先写 `clinic-gate.test.ts` 的红灯用例（只挡向内、切线滑行、斜穿门角、站内自由出入），再实现 `resolveWalkInto` 转绿。
- **domain-modeling**：按 `docs/adr/0106` 的格式与措辞风格撰写 ADR-0107，并确保与 ADR-0092 的「西侧人行门」口径衔接、只登记新决策不改历史 ADR。
- **verification-before-completion**：收尾前跑 `pnpm test`、`pnpm typecheck`、`pnpm changelog:check`，以真实输出确认门禁未破坏救护车链路与既有几何断言。
