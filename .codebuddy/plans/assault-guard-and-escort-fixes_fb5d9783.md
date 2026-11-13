---
name: assault-guard-and-escort-fixes
overview: 修复「攻击保安不触发逮捕」的根因（执法统计只认真人受害者），按确认改为袭警 1 次直接建案，只对保安生效；同时修掉执法链路上四个会让逮捕失效的阻塞缺陷：保安追不上逃跑玩家、拖行 15 秒必超时、保安被创飞时任务计时停摆、被拖者裸写坐标穿墙。配套改测试、新增 ADR 与版本工报。
todos:
  - id: assault-guard
    content: 用 [skill:test-driven-development] 在 detention.ts 增加袭警分支并补 detention 测试
    status: completed
  - id: escort-deadlines
    content: 用 [skill:test-driven-development] 修 escort 追击速度、动态拖行截止、超时前置、硬直续期与穿墙落点
    status: completed
  - id: regression
    content: 用 [skill:verification-before-completion] 跑 game-server 全量测试与类型检查并修回归
    status: completed
    dependencies:
      - assault-guard
      - escort-deadlines
  - id: docs-release
    content: 新增 ADR 0080 登记袭警口径与未修边界项，追加版本工报并跑 changelog:check
    status: completed
    dependencies:
      - assault-guard
      - escort-deadlines
---

## 产品概述
修复「攻击保安不触发逮捕」的功能缺陷，并清理同一执法链路上会让逮捕失效的阻塞问题。玩家用发泄（E）命中保安一次即被视为袭警，立即建案并派保安押送；普通同事被打仍不触发执法。修复后，逃跑的玩家会被追上、远端逮捕能真正送进小黑屋、保安被踹倒不会让押送永久停摆、被拖者不会穿墙。

## 核心功能
- 袭警零容忍：命中保安 1 次直接建案，广播「被保安请进小黑屋：园区内不许动手」，就近派单
- 只认保安：普通同事（非 guard）被打仍不计数、不警告、不派单
- 同一攻击者已在押送流程中时不重复建案，避免刚放出来又被第二张单带走
- 修复保安追击速度可能低于玩家常速、导致 12 秒追不上就放人的问题
- 修复远端（西北角等）拖行超过 15 秒被半路放人的问题，拖行截止按实际路线长度与速度派生
- 修复保安被创飞时每帧提前返回、超时判定永远走不到的问题，并让被押者硬直只覆盖拖行进行期
- 修复被拖者坐标绕过碰撞求解导致穿墙、落进陈设的问题
- 已知但本次不修的边界项（反省点复用、隔墙目击、abort 无条件广播 Released、cancelEscort 时基、入座挡老板、ventPending 先清后判等）在决策记录中登记，避免后续重复排查
- 出现时机、键盘/鼠标触发方式、协议与客户端表现保持不变


## 技术栈
- 语言/运行时：TypeScript + Bun（`apps/game-server`，`bun test` / `tsc --noEmit`）
- 共享协议与常量：`@niuma/shared-types`（`ENTITY_ROLE_GUARD`、`MOVE_SPEED`、`resolveMotionInto`、`isBlocked`）
- 现有模块：`sim/detention.ts`（执法判定与建案）、`sim/vent.ts`（命中结算）、`npc/escort.ts`（押送状态机）、`npc/brain.ts`（任务类型）、`npc/director.ts`（派单）
- 测试：bun test 现有夹具（`detention.test.ts` 的 `Harness`/`hit()`、`escort.test.ts` 的 `setup()` 与 `warmEscortGrid()`）

## 实现方案

### 1. 袭警判定：在执法层放行保安受害者（主修复）
`onVentHit` 目前第二行就把所有 NPC 受害者挡掉，导致保安永远不计数。改为「先挡攻击者与在案者，再分受害者类型」：

```ts
onVentHit(attacker, victim, now) {
  if (attacker.isNpc || attacker.wsId === 0) return;
  if (this.cases.has(attacker.id)) return;
  // 袭警零容忍：保安是 NPC，命中一次直接建案
  if (victim.isNpc) {
    if (victim.role !== ENTITY_ROLE_GUARD) return;
    this.attacks.delete(attacker.id);
    this.openCase(attacker, now, SYSTEM_NOTICE_KIND.DetainedFight);
    return;
  }
  if (victim.wsId === 0) return;
  // …原有 2 分钟窗口、2 次警告、3 次建案逻辑不变
}
```

关键决策与取舍：
- 复用 `openCase()`，不新写建案路径：占反省点、`cases` 闸门、`tryDispatch`、通知广播全部沿用，避免两套执法逻辑漂移；
- 复用 `SYSTEM_NOTICE_KIND.DetainedFight`（文案「${name} 被保安请进了小黑屋：园区内不许动手。」），协议零改动；不为袭警单独加一种通知编号，收益不抵一次协议扩展；
- 只认 `victim.role === ENTITY_ROLE_GUARD`，不放开所有 NPC：普通同事仍按现有产品语义不触发执法；
- 建案前清掉该攻击者对真人的账本，与「第 3 次命中建案即清账」保持一致，避免押送结束后旧账立刻再生效；
- 被打倒的保安 `stunUntil` 内不会被 `dispatchEscort` 选中，会自然派给其他空闲保安；若全部在忙则走既有 12 秒排队超时。

### 2. 押送链四个阻塞缺陷

| 缺陷 | 修复 |
|---|---|
| 慢保安追不上逃跑玩家 | 追击速度改为 `max(agent.speed * 1.3, MOVE_SPEED * 1.1)`，保证任何保安追击都至少比玩家常速快 10%；常量集中在 `ESCORT` |
| 远端拖行 15 秒必超时 | 抓取时按实际路线长度与拖行速度算截止：`deadline = now + max(15s, pathLen / dragSpeed * 1.6 + 4s)`，上限 60s；路径总长在 `beginDrag` 一次性累加 |
| 保安被创飞时计时停摆 | 把 chase / drag 的超时判定提到 `stepEscort` 最前面（硬直只跳过「推进」，不跳过「计时」）；拖行中每帧把被押者 `stunUntil` 刷新为 `now + 5s`，任何停摆都会在 5 秒内恢复行动，不再出现躺 40 秒 |
| 被拖者裸写坐标穿墙 | `placeTargetBehind` 改用 `resolveMotionInto` 从保安脚下求合法落点；若结果仍被挡则保持上一合法位置，不把非法坐标写进 `grid` |

配套调整：
- `EscortTask` 增加 `dragDeadlineAt`（0 表示未进入拖行），`director.ts` 创建任务时初始化；
- `DETENTION.DRAG_LOCK_MS` 从 45s 降为 5s（拖行期间由 escort 每帧续期），`CASE_TIMEOUT_MS` 提到 75s 作为硬上限，确保「硬直尾巴 < 拖行截止 < 案子上限」；
- 拖行恢复时若目标已跑出抓取半径两倍，按 `missing` 中止，避免把人瞬移拉回。

### 3. 性能与可靠性
- `onVentHit` 新增分支 O(1)，无新增遍历；账本仍是按攻击者/受害者两级 Map；
- 追击速度只多一次 `max`；拖行路径长度只在 `beginDrag` 计算一次 O(path)，稳态每 Tick 无额外分配；
- 不给 HUD/客户端加任何逻辑，回滚只需还原上述常量与分支；
- 不改协议、不改 `resolveVents` 的 observer 端口，`GAME_JAIL_ENABLED=false` 与 `npc.count=0` 的回滚路径保持有效。

### 4. 测试策略
- `sim/detention.test.ts`：把「打 NPC 不计数」改为「打普通同事不计数」；新增「打保安 1 次立即派单 + 广播 DetainedFight + 不发 AssaultWarn」「已在案中再打保安不重复建案」；
- `npc/escort.test.ts`：新增慢保安（`speedFactor=0.62`）追击持续逃跑目标能在超时前抓到、远端长路径拖行不被 15 秒提前中止、保安长时间硬直时首帧即返回 `abort('timeout')`、拐角拖行后被押者落点 `isBlocked === false`；
- 全量 `bun test` 与 `tsc --noEmit`，重点确认擂台豁免、断线清理、窗口过期、正常押送到达用例仍绿。

## 目录结构

```
niuma/
├── apps/game-server/src/
│   ├── sim/
│   │   ├── detention.ts            # [MODIFY] onVentHit 增加袭警分支（1 次建案、只认 ENTITY_ROLE_GUARD、清账本）；ASSAULT 注释更新；DRAG_LOCK_MS 5s、CASE_TIMEOUT_MS 75s；保持 openCase/tryDispatch/broadcast 不变
│   │   └── detention.test.ts       # [MODIFY] 原「打 NPC 不计数」改为普通同事用例；新增打保安立即建案、已建案不重复、通知类型与派单断言
│   └── npc/
│       ├── escort.ts               # [MODIFY] 追击速度下限 MOVE_SPEED*1.1；超时判定前置；beginDrag 计算路径长度与 dragDeadlineAt；placeTargetBehind 改用 resolveMotionInto；拖行中续期 stunUntil；目标逃离两倍抓取半径按 missing 中止
│       ├── brain.ts                # [MODIFY] EscortTask 增加 dragDeadlineAt 字段与注释，说明由 beginDrag 写入、0 表示未拖行
│       ├── director.ts             # [MODIFY] dispatchEscort 创建任务时初始化 dragDeadlineAt: 0；其余派单规则不变
│       └── escort.test.ts          # [MODIFY] 新增慢保安追击、远端长拖行、硬直中超时、拐角落点不穿墙四组用例，保留原有抓取-按肩-到达测试
├── docs/adr/
│   └── 0080-assault-guard-and-escort-deadlines.md  # [NEW] 记录袭警零容忍口径、四个阻塞缺陷根因与修复、与 ADR-0074「真人之间」口径的覆盖关系、未修边界项清单与回滚方式
└── apps/web/data/release-notes.json # [MODIFY] entries 首位新增 2026-11-13-26：玩家可感知的袭警与押送修复说明，跑 changelog:check
```

## 关键接口

```ts
// npc/brain.ts：新增字段，其余字段不变
export interface EscortTask {
  // …
  /** 拖行截止时刻：beginDrag 按路径长度与拖行速度计算；0 表示还没进入拖行 */
  dragDeadlineAt: number;
}

// npc/escort.ts：追击速度的唯一出口，便于单测
function chaseSpeed(guardSpeed: number): number {
  return Math.max(guardSpeed * ESCORT.CHASE_SPEED_FACTOR, MOVE_SPEED * ESCORT.CHASE_MIN_FACTOR);
}
```

## 实现注意事项
- `onVentHit` 中 `cases.has` 必须保留在最前（原在受害过滤之后），否则袭警分支会在押送途中重复建案；
- 保安是 `isNpc=true` 且 `wsId=0`，不要用 `wsId` 判断受害者是否有效；判定保安只认 `role`；
- `stepEscort` 里 `guard.pose === POSE.Lie` 的起床逻辑要保留，但必须放在超时判定之后；
- 拖行截止用 `task.dragDeadlineAt`，不要复用 `stageUntil`（后者语义是按肩停顿结束时刻）；
- 不要在 `detention` 里 import `npc/*`（依赖方向是 npc → sim）；共享硬直时长由 `escort` 从 `sim/detention` 读取常量，或使用各自的具名常量并在 ADR 中写明约束关系；
- 日志只保留既有 `[jail] abort` 一条，新增分支不要打印玩家名或坐标明细；
- 历史 ADR 不改写；本次规则变更写入新 ADR 0080，并显式说明覆盖 ADR-0074 的「真人之间」口径；
- 版本工报不写文件名、常量名、坐标与内部机制，只写玩家可感知结果。


## Agent Extensions
### Skill
- **systematic-debugging**
  - Purpose: 在动手前用失败用例复现「打保安不计数」，确认根因在 `onVentHit` 的 NPC 过滤而非命中几何或 AOI
  - Expected outcome: 一条先红后绿的袭警用例，以及被排除的误判路径清单
- **test-driven-development**
  - Purpose: 袭警判定与四个押送缺陷均先写失败测试，再改实现
  - Expected outcome: `detention.test.ts` 与 `escort.test.ts` 新增用例先失败后通过，覆盖远端拖行、慢保安追击、硬直中超时、拐角落点
- **verification-before-completion**
  - Purpose: 交付前跑全量 `bun test` 与 `tsc --noEmit`，确认既有擂台豁免、断线清理、正常押送用例未回归
  - Expected outcome: 测试与类型检查输出全绿，并在结论中给出实际命令与结果
