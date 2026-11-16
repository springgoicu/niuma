---
name: guard-down-escort-release
overview: 保安在押送途中被创倒送医时，押送立即中止并撤案，玩家当帧解除拖拽锁定、恢复自由移动；同时补上被押者自己昏迷上救护车时押送中止、急救链优先的口径，并同步改写受影响的单测与 ADR。
todos:
  - id: escort-abort
    content: 扩展押送中止原因，保安或目标昏迷时当帧发出 abort
    status: completed
  - id: detention-release
    content: 执法层处理两种新原因：清硬直、广播 Released、撤案，昏迷者保持躺姿，并补本人提示
    status: completed
    dependencies:
      - escort-abort
  - id: director-cleanup
    content: 删除康复后押送续接分支，收尾时不给昏迷保安写站姿
    status: completed
    dependencies:
      - escort-abort
  - id: client-release
    content: 客户端 Released 立即解锁；昏迷接管期间不改姿态、不吸附反省点
    status: completed
    dependencies:
      - detention-release
  - id: tests-update
    content: 改写挂起用例，补双向昏迷、姿态、撤案与提示断言
    status: completed
    dependencies:
      - escort-abort
      - detention-release
      - director-cleanup
      - client-release
  - id: adr-changelog
    content: 用 [skill:domain-modeling] 写 ADR-0110，追加版本工报并跑 changelog:check
    status: completed
    dependencies:
      - tests-update
  - id: verify
    content: 跑 typecheck 与 game-server、web 单测，确认无回归
    status: completed
    dependencies:
      - tests-update
      - adr-changelog
---

## 用户需求
押送过程里保安被创倒送医时，被押玩家会原地干等保安康复再被拖进小黑屋，体验很差。需要改为：保安倒下即放人，并一并修正相关链路。

## 产品概述
把「押送」从「等人治好再继续」改为「押送员或目标失去行动能力就当场作废」。玩家在保安倒下的同一帧解除拖拽锁定、恢复自由移动与操作；已送医的保安康复后回到巡逻，不再续追这一单。

## 核心功能
- 保安在押送任一阶段（追击、按肩、拖行）被创倒送医，立即中止押送并撤销案子，被押者当帧解锁，可自由移动、聊天、坐下。
- 被押者本人在途中被第三方创倒时也中止押送，由救护车完整接管，康复即自由，避免押送与救护车同时抢写坐标。
- 案子撤销后本轮不再追、不换其他保安接单，坐站与打人判定从头重新累计。
- 被放走时给本人一条系统提示，说明押送作废的原因；被放走者若正在昏迷，不强制改成站姿、不被吸附进小黑屋。
- 旁人与客户端解锁沿用现有 Released 包，不新增协议阶段，不写存档。


## 技术栈
- 沿用现有 TypeScript + Bun test + pnpm monorepo；服务端为 `apps/game-server`，客户端为 `apps/web`，共享常量在 `packages/shared-types`。
- 不改网络协议：继续复用 `S2C_JAIL` 的 `JAIL_PHASE.Released` 作为唯一解锁信号；`S2C_SYSTEM_NOTICE` 只加一个编号与文案。

## 实现方案
### 总体策略
保持「押送行为层产出事件、执法层唯一裁决」的既有分工，把 `stepEscort` 里「保安昏迷就挂起任务」改成「保安昏迷就回报中止」，由 `detention` 走既有 abort 路径清锁、撤案、广播 `Released`。不在 `Player` 上新增押送状态，不新增状态机。

```mermaid
flowchart LR
  A[resolveVents 命中] --> B[clinic 置 incapacitated]
  B --> C[npcs.update 推进 stepEscort]
  C -->|guard_down / target_down| D[detention abort：清硬直 + 撤案 + Released]
  D --> E[session endEscort 解锁]
```

### 关键决策与权衡
1. **撤案而不是换保安接单**：按已确认口径，玩家彻底自由；康复保安不续追。代价是同一轮执法作废，收益是消除「原地干等」这一核心痛点。
2. **押送与急救的坐标所有权互斥**：押送中止后坐标只由 `sim/clinic` 写，避免拖行写「保安身后 22px」与挂车尾写「车尾 26px」互相拉扯。
3. **中止原因只做服务端联合类型**：`EscortEvent` 的 reason 扩为 `'timeout' | 'missing' | 'stuck' | 'cancelled' | 'guard_down' | 'target_down'`，不新增 `JAIL_PHASE`、不改 9 字节定长包。
4. **提示走系统提示而非阶段包**：`SYSTEM_NOTICE_KIND` 新增编号 9（押送中断），模板写在 `packages/shared-types/src/notice.ts`，只发被放走的本人，旁人不刷屏。
5. **删除死代码**：`npc/director.restore` 里「押送重置回 chase」在撤案后不再可达，删除以免留下第二套口径；盯梢续接保留。

### 性能与可靠性
- 每个押送保安每帧只多两次布尔读取（`guard.incapacitated` / `target.incapacitated`），复杂度不变；abort 事件只在状态跃迁时分配一次，属低频路径。
- 不新增 Map、不新增每帧遍历、不新增落盘字段；`DETENTION.CASE_TIMEOUT_MS` 仍是唯一硬兜底。
- 错误兜底不变：目标断线、无路可走、拖行超时、上擂台撤案全部保留。

### 执行细节（防回归）
- 三处「恢复站姿」必须跳过昏迷者：`detention.abort`、`director.finishEscort`、客户端 `session.endEscort`。否则会出现「昏迷的人被扶起来站着」或「伤员被吸进小黑屋」。
- `director.update` 的事件转发顺序不变（先 `escortListener` 再 `finishEscort`）；`detention.abort` 里的 `escort.cancel` 与 director 的收尾幂等，不要新增去重状态。
- 日志沿用现有 `[jail] abort player=... phase=... reason=... guard=...`，新增 reason 直接落进同一行，不输出坐标与个人信息。
- 客户端 `endEscort` 仅在 `!patientLocked` 时做姿态回正与反省点吸附；`escortLocked` 的解锁本身必须无条件执行。
- 改动集中在执法/押送/急救边界，不动擂台、老板、经济与落盘逻辑。

## 架构设计
### 模块职责
- **押送行为层** `npc/escort.ts`：只回答「能不能继续押」，不能继续就产出 abort 事件，不碰案子。
- **执法层** `sim/detention.ts`：案子的唯一事实源，决定清锁、站姿、广播与删案。
- **NPC 门面** `npc/director.ts`：转发事件、收尾任务、康复复位；不认识 `Detention`。
- **急救层** `sim/clinic.ts`：保持不变，继续独占昏迷实体的坐标与治疗。
- **客户端** `session.ts`：只按 `Released` 解 `escortLocked`，不猜服务端原因。

### 数据流
命中 → `clinic` 置 `incapacitated` → 同帧 `npcs.update` 的 `stepEscort` 产出 abort → `director` 转发 → `detention.abort` 清 `stunUntil`、恢复站姿、广播 `Released`、删案 → 客户端 `endEscort` 解锁。全程单向，无回写。

## 目录结构
```
apps/game-server/src/
├── npc/
│   ├── escort.ts          # [MODIFY] stepEscort 把 incapacitated 挂起改为 abort：
│   │                      #   保安昏迷返回 reason='guard_down'；
│   │                      #   取到目标后新增 target.incapacitated → reason='target_down'；
│   │                      #   本地 abort() 的 reason 联合类型同步扩展；
│   │                      #   保留 timeout / missing / stuck 分支与顺序，昏迷判断仍在最前。
│   ├── director.ts        # [MODIFY] finishEscort 只在 !player.incapacitated 时写 POSE.Idle；
│   │                      #   restore 删除「escort.stage 重置回 chase / 清路径 / 重置 startedAt」分支，
│   │                      #   保留 incapacitated/stunUntil/carriedBy 清理、pause 复位与 follow 续接；
│   │                      #   更新注释：押送已在保安倒地当帧中止，不再有康复续追。
│   └── escort.test.ts     # [MODIFY] 删除「昏迷送医期间计时挂起」用例，
│                          #   改为「保安昏迷当帧 abort(guard_down)」「目标昏迷当帧 abort(target_down)」；
│                          #   保留 stunUntil 超时用例与抓取/拖行/落点用例。
├── sim/
│   ├── detention.ts       # [MODIFY] EscortEvent 的 abort reason 扩为六个值；
│   │                      #   abort() 参数类型同步；dragging 阶段清 stunUntil 与 POSE.Idle 前判断 !incapacitated；
│   │                      #   guard_down 时给本人补发一条 EscortBroken 系统提示（wsId 为 0 时跳过）；
│   │                      #   删案与 Released 广播顺序不变；更新 DETENTION 注释说明不再挂起等治疗。
│   └── detention.test.ts  # [MODIFY] 新增 guard_down（拖行中）用例：清硬直、站姿、本人+旁人各一份 Released、cancelled 一次、
│                          #   update 下一帧不再重新派单；新增 guard_down（追击中）用例；
│                          #   新增 target_down 用例：incapacitated 保持 true、姿态保持 Lie、不吸附反省点；
│                          #   新增提示断言：guard_down 只发本人 EscortBroken，target_down 不发。
├── npc/director.test.ts   # [MODIFY] 新增：派单后把保安置为 incapacitated + Lie，推进 update，
│                          #   断言任务被收尾、保安仍是 Lie（不被 finishEscort 扶成站姿）、无回归巡逻续追。
apps/web/lib/game/
└── session.ts             # [MODIFY] endEscort：先无条件 escortLocked=false；
                           #   patientLocked 时不 snapToJailAnchor、不 setLocalPose(Idle)、不显示「可以自由活动」，
                           #   只清移动缓存；仅清醒时做原有关联动作。
packages/shared-types/src/
└── notice.ts              # [MODIFY] SYSTEM_NOTICE_KIND 新增 EscortBroken=9；
                           #   TEMPLATES 增加文案「押送中断：保安被送去急救了，这次先放你一马。」；
                           #   params 仍只用现有字段，不改包结构。
docs/adr/
└── 0110-escort-aborts-on-down.md  # [NEW] 记录本次口径：押送员或目标失去行动能力即中止并撤案；
                                   #   写明与 ADR-0106 第 4 节「计时挂起」、第 5 节「康复续接押送」的取代关系；
                                   #   列备选方案（换人接单 / 继续挂起 / 保留续接）与代价、回滚路径。
apps/web/data/
└── release-notes.json     # [MODIFY] 按 AGENTS.md 在最前面追加一条玩家可感知记录
                           #   （当前最新 id 为 2026-11-16-12，同日顺延为 2026-11-16-13，条目不超过 6 条改动）。
```

## 关键代码结构
```ts
// apps/game-server/src/sim/detention.ts
export type EscortAbortReason =
  | 'timeout'
  | 'missing'
  | 'stuck'
  | 'cancelled'
  | 'guard_down'
  | 'target_down';

export type EscortEvent =
  | { kind: 'grab'; guardId: number; targetId: number; now: number }
  | { kind: 'arrive'; guardId: number; targetId: number; now: number }
  | { kind: 'abort'; guardId: number; targetId: number; now: number; reason: EscortAbortReason };
```


## Agent Extensions
### Skill
- **domain-modeling**
  - Purpose: 按项目既有的 ADR 格式与领域词汇起草 ADR-0110，明确「押送中止」与「急救接管」的边界和取代关系。
  - Expected outcome: 生成 `docs/adr/0110-escort-aborts-on-down.md`，包含背景、决策、备选方案、后果与回滚，且不改写历史 ADR。
