---
name: npc-ambulance-rescue
overview: 把急救救护链从「只救真人」扩展到「所有被击倒实体」：NPC 被打倒一次即进入昏迷、派救护车、上病床治疗，治疗结束后回位并继续原任务。
todos:
  - id: clinic-npc-patient
    content: 改造 clinic.ts：NPC 一击倒地、记录归位点、护士自救、治疗结束经 NpcRestorePort 归位
    status: completed
  - id: npc-behavior-freeze
    content: 在 brain/social/follow/escort 增加昏迷早退，押送计时挂起，派单排除昏迷保安
    status: completed
    dependencies:
      - clinic-npc-patient
  - id: npc-restore-port
    content: 实现 director.restore 归位与任务续接，并在 server.ts 注入 NpcRestorePort
    status: completed
    dependencies:
      - clinic-npc-patient
      - npc-behavior-freeze
  - id: tests-npc-rescue
    content: 用 [skill:test-driven-development] 补齐 clinic/brain/escort/director 用例并跑 bun test
    status: completed
    dependencies:
      - npc-restore-port
  - id: docs-and-changelog
    content: 用 [skill:domain-modeling] 新增 ADR 0106，追加版本工报并跑 changelog:check
    status: completed
    dependencies:
      - tests-npc-rescue
---

## 用户需求
玩家反馈「击打其他任务时护士的逻辑不生效」，并明确期望：**只要被击倒，就必须触发救护车出警逻辑**。经澄清确认：NPC 被打中一次躺下就要送医；覆盖全部 NPC（普通同事、保安、护士）；治疗后回到原位置继续原任务。

## 产品概述
园区里任何角色被击打倒地，都按同一套急救流程处理：鸣笛出警的救护车赶到、把人挂上车尾拖回急救站、躺上病床治疗 3 秒，治愈后获得 15 秒工伤保护，再回到倒下位置继续之前的巡逻、押送或站岗。真人玩家保持原有的「15 秒内被打 3 次才昏迷」手感不变。

## 核心功能
- **NPC 一击即倒**：普通同事、保安、护士被真实命中一次就进入昏迷，不再只是自己躺一下爬起来；真人仍是三次累计。
- **完整救护链对 NPC 生效**：出警、绕行、拖拽、上病床、治疗、治愈护盾全流程复用现有急救站逻辑，不再被「目标是 NPC 就跳过」的闸门挡住。
- **视觉表现一致**：昏迷的 NPC 头顶出现昏迷星星，治疗中护士站冒爱心，治愈后挂绿色十字盾牌，其他玩家进入视野时也能补看到当前状态。
- **昏迷期间行为冻结**：倒地的 NPC 不再走路、发呆、招手、让路，押送中的保安停在原地等治疗，不会一边躺着一边拖人。
- **治疗后归位并续接任务**：治疗结束回到被击倒的位置，巡逻继续走向原来的目标点；被打断的押送、盯梢任务重新开始追击，而不是直接作废。
- **护士自救**：护士被打倒同样被抬走治疗，治疗结束后回到分诊台或急救备勤位继续站岗，不再靠「硬直结束自动回位」提前爬起来。
- **容量兜底**：两辆救护车、两张病床都忙时，伤员在队列里最多等 6 秒，超时就地包扎并同样归位，不会让任何人卡在无限等待里。
- **不受影响的场景**：擂台、野外切磋、老板冲击波、老板受击仍按原有独立战斗域处理，不会因为这次改动开始派救护车。

## 边界与不改动项
- 急救状态依旧只在进程内存，不写入园区共享运行态文件。
- 不改变真人三次累计的判定窗口与手感。
- 不改变打保安、打护士触发执法与押送的口径，执法与送医是同一次命中的两个独立结果。
- 客户端协议不新增字段：伤员状态包本来就按实体 id 生效。


## 技术栈
- 现有 TypeScript + Bun 单仓（pnpm + turbo），服务端 `@niuma/game-server`，共享类型 `@niuma/shared-types`。
- 无新增依赖、无协议变更、无客户端渲染改动：`encodePatientStatus` / `PatientStatusPacket` 已按 `entityId` 通用处理，星星、爱心、护盾会自动覆盖 NPC。
- 测试：`bun test`（`apps/game-server`），类型检查 `tsc --noEmit`，提交前 `pnpm changelog:check`。

## 实现路径
核心思路：把 `AmbulanceManager` 的「伤员」从「真人会话」泛化为「任意 `Player` 实体」，并用一个窄端口 `NpcRestorePort` 把「回位 + 恢复任务」交还 `npc/director`，让 `sim/clinic` 不需要认识 `NpcAgent`、押送路径与巡逻路点。

### 1. 救护链放开 NPC（`sim/clinic.ts`）
- `observeHit()` 去掉 `target.isNpc` 早退，改为：
  - `target.incapacitated` / 免疫期内直接返回（与 `resolveVents` 的空放口径保持一致）；
  - `target.isNpc` → 立即 `downPlayer(target, now)`（一击即倒）；
  - 真人 → 保留 `recentHits` / `HIT_WINDOW_TICKS` / `HITS_TO_DOWN` 原逻辑，零改动。
- `downPlayer()` 增加一步：NPC 目标在倒地瞬间把坐标存入 `npcReturn: Map<number, NpcSpot>`，作为治疗后归位点；护士不存，直接用 `CLINIC_NURSE_SPOTS`。
- `advanceNurses()` 的回位循环与挥手排期都跳过 `nurse.incapacitated`，否则护士会在病床/车尾被瞬移回站位，打断救护链。
- `grantImmunity()` 与 `healInPlace()` 在收尾时调用 `restoreNpc(player, now)`；`advanceBeds()` 对 NPC 跳过「站到床尾」的坐标写入（归位点已由端口写回）。
- `restoreNpc()`：护士 → `resetNurse()`（复用 ADR-0090 的合法站位写入）；其他 NPC → `recovery?.restore(id, spot, now)`，随后删除 `npcReturn` 条目。端口缺失时退化为原地站起，保证不阻塞。
- `sendSnapshot()` / `broadcastPatient()` 无需改动，NPC 的伤员状态会自动同步给新入场者与全场。

### 2. NPC 行为冻结与恢复（`npc/*`）
- `brain.updateAgent()`：在 `now < stunUntil` 之前加 `if (player.incapacitated) return;`，避免硬直结束后自己站起来。
- `social.updateSocial()`、`follow.stepFollow()`：同样加 `incapacitated` 早退。
- `escort.stepEscort()`：在最前面加 `if (guard.incapacitated) return null;`（放在超时判断之前），语义是「住院期间押送计时挂起」；90 秒案子硬上限仍是唯一兜底，ADR-0080 的 1.5 秒硬直不冻结计时的既有用例不受影响。
- `director.dispatchEscort()` / `dispatchFollow()`：排除 `player.incapacitated` 的保安，避免派单给躺在车上的人。
- `NpcDirector` 新增 `restore(playerId, spot, now): boolean`：
  - 写回坐标、清 `stunUntil` / `carriedBy`、落 `Idle` 站姿、`markDirtyIfChanged()`、`grid.update()` 返回 true 时置 `needsViewRefresh`；
  - `phase='pause'`、`pauseUntil=now+600`，复位 `stuckCount` / `lastProgress*`；
  - `escort` 存在则重置为 `stage='chase'`、`path=[]`、`index=0`、`replanAt=now`、`startedAt=now`、`dragDeadlineAt=0`，让保安回位后重新追击而不是拿着过期路径；
  - `follow` 存在则清 `path` 并 `replanAt=now`，保留 `until`。
- `createAgent()` 不需要新增字段：归位点由 clinic 在倒地时记录。

### 3. 接线（`server.ts`）
- `AmbulanceManager` 构造早于 `createNpcDirector`，因此新增 `clinic.setNpcRecovery({ restore: (id, spot, now) => npcs.restore(id, spot, now) })`，在 `npcs.spawn()` 之后调用一次；不改动现有构造顺序，避免动 1000 行文件里的初始化次序。
- `ventObserver.onVentHit` 的调用顺序保持 `detention` → `clinic`：执法与送医互不依赖，且 `detention` 的零容忍白名单不变。

### 4. 关键取舍
| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. NPC 沿用三次累计 | 规则统一 | 与用户明确要求的「打一次就送医」相反 | 否决 |
| B. NPC 一击倒地、复用现成 `incapacitated` | 不新增状态机、客户端零改动 | 送医频率上升 | 采纳 |
| C. 新增 `npcDowned` 独立状态机 | 语义更纯 | 与 `vent` / `brain` / `escort` 三处状态重复 | 否决 |
| D. 归位点用出生点 | 实现最简单 | 跨岛瞬移，玩家看到人凭空消失 | 否决 |
| E. 归位点用倒下坐标 | 视觉连续、押送者可原地续追 | clinic 多存一张 Map | 采纳 |
| F. 住院期间冻结押送计时 | 任务可恢复 | 与 ADR-0080 的字面口径不同，需在新 ADR 里写明边界 | 采纳 |

### 5. 性能与稳定性
- 每 Tick 只新增 O(NPC) 次布尔判断，无分配；`npcReturn` 为 O(1) 查找。
- 伤员状态包仍只在状态切换（昏迷 / 治疗 / 护盾 / 清除）时广播，不进 20Hz 稳态流量。
- 两车两床容量不变，`QUEUE_TIMEOUT_MS = 6000` 的「就地包扎」是防止急救站被围观式殴打堵死的兜底。
- 押送中的保安被送医时，被押者硬直自然到期后可以离开，保安回位后重新追击；案子 90 秒上限保持不变，不引入新的死锁。

## 目录结构
```
niuma/
├── apps/game-server/src/
│   ├── sim/
│   │   ├── clinic.ts                    # [MODIFY] 放开 NPC 早退；NPC 一击即倒；记录归位点；昏迷护士跳过自动回位；治疗结束经 NpcRestorePort 归位；新增 NpcRestorePort 接口与 setNpcRecovery()
│   │   └── clinic.test.ts               # [MODIFY] 新增 NPC 一击倒地、全链路送医归位、护士自救、排队就地包扎、真人三次回归用例
│   ├── npc/
│   │   ├── brain.ts                     # [MODIFY] updateAgent 增加 incapacitated 早退，昏迷 NPC 不再自己起身
│   │   ├── social.ts                    # [MODIFY] 昏迷期间不做对视/让路/招手
│   │   ├── follow.ts                    # [MODIFY] 昏迷期间暂停盯梢推进
│   │   ├── escort.ts                    # [MODIFY] 昏迷期间押送计时挂起（早退放在超时判断之前）
│   │   ├── director.ts                  # [MODIFY] 派单排除昏迷保安；实现 restore()：写回归位点、刷新 AOI、重置押送/盯梢路径与计时
│   │   ├── brain.test.ts                # [MODIFY] 断言昏迷 NPC 硬直结束后仍不起身
│   │   ├── escort.test.ts               # [MODIFY] 断言昏迷期间不中止任务、restore 后重新追击；保留原有「硬直不冻结计时」用例
│   │   └── director.test.ts             # [MODIFY] 断言昏迷保安不接押送/盯梢派单，restore 后恢复接单
│   └── server.ts                        # [MODIFY] npcs 创建后注入 NpcRestorePort；确认 onVentHit 仍是 detention → clinic 顺序
├── docs/adr/
│   └── 0106-npc-ambulance-rescue.md     # [NEW] 记录「所有被击倒实体进入救护链」的决策、与 ADR-0090 第 75-77 行的覆盖关系、住院暂停押送计时的边界与回滚路径
└── apps/web/data/
    └── release-notes.json               # [MODIFY] 追加 2026-11-16-1 一条面向玩家的版本记录
```

## 关键代码结构
```ts
/** 治疗结束后把 NPC 交还给 npc 层：clinic 只负责调度，不碰行为状态机 */
export interface NpcRestorePort {
  /** spot 为倒地瞬间记录的坐标；返回 false 表示这个实体不由 npc 层管理 */
  restore(playerId: number, spot: { x: number; y: number }, now: number): boolean;
}
```


## Agent Extensions
### Skill
- **domain-modeling**
  - Purpose: 按仓库现有 ADR 格式产出 `docs/adr/0106-npc-ambulance-rescue.md`，把「NPC 进入救护链」「一击即倒」「住院暂停押送计时」写成可追溯的决策记录。
  - Expected outcome: 一份与既有 ADR 风格一致、含背景/决策/备选方案/后果/回滚路径的新 ADR，且不改写 ADR-0090 正文。
- **test-driven-development**
  - Purpose: 先写 `clinic` / `brain` / `escort` / `director` 的失败用例，再落实现，锁定「NPC 一击倒地」「昏迷不自行起身」「押送计时挂起」「治疗后归位续接任务」四条规则。
  - Expected outcome: `bun test` 下新增用例先红后绿，且真人三次累计等既有用例保持通过。
