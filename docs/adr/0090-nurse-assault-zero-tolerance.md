# ADR-0090：医务人员零容忍与护士硬直后回位

- 状态：已采纳
- 日期：2026-11-15
- 关联：打人触发执法沿用 ADR-0074；袭警零容忍与押送链沿用 ADR-0080（本 ADR 覆盖其
  「NPC 受害者只认保安」的口径）；护士角色与 `role` 字段沿用 ADR-0063；急救站与护士 NPC
  沿用 ADR-0084；零持久化沿用 ADR-0004；通知通道沿用 ADR-0038；反省点与押送沿用 ADR-0072

## 背景

玩家反馈「攻击护士没有任何后果」。急救站的两名护士是固定站桩 NPC（`ENTITY_ROLE_NURSE`），
站在分诊台与急救备勤位上，被创飞后与其他实体一样进入 `POSE.Lie` 与 1.5 秒硬直，但：

1. `sim/detention` 的 `onVentHit` 在 ADR-0080 之后是「NPC 受害者只放行 `role === ENTITY_ROLE_GUARD`」，
   护士 `role = 2` 直接被挡掉，永远进不了执法账本；
2. 护士没有 NPC 大脑（`npc/brain` 只管保安与同事），而「硬直结束后自己起身」只对真人的
   移动上报生效，所以被打倒的护士会一直躺在急救站里，没人扶。

结果是同一条链路上「打医护人员不影响任何东西」＋「急救站永久躺着一个护士」两个问题。
医疗岗在园区里是权威角色，被回避的成本应该和保安同级。

## 决策

### 1. 零容忍角色收成一个白名单（保安 + 护士）

`sim/detention` 在 `ASSAULT` 旁新增：

```ts
const ZERO_TOLERANCE_ROLES: ReadonlySet<number> = new Set([ENTITY_ROLE_GUARD, ENTITY_ROLE_NURSE]);
```

`onVentHit` 的 NPC 分支由「只放行保安」改为 `!ZERO_TOLERANCE_ROLES.has(victim.role)` 即返回，
其余路径完全复用 ADR-0080 的建案段：清打人账本 → `openCase(attacker, now, DetainedFight)` →
占反省点 → `tryDispatch` → 通播。协议、通知枚举与客户端模板零改动。

- 普通同事（`role = 0`）仍不进执法，保持园区 NPC 的中立身份；
- 真人之间仍是 2 次警告、3 次建案；
- `cases.has(attacker.id)` 闸门在该分支上方，因此押送途中的连续殴打不会重复建案；
- 用集合而不是继续叠 `if`：这条口径还会随新职业（医生 / 前台）扩展，规则只留一处才不会漂移。

### 2. 护士硬直结束自己站回原位

`sim/clinic` 的 `advanceNurses` 在最前面扫一遍护士：

```ts
if (nurse.pose !== POSE.Lie || now < nurse.stunUntil) continue;
this.resetNurse(nurse, this.nurseSpots[i] ?? 0, now);
```

`resetNurse` 做四件事：清 `stunUntil`、把坐标写回 `CLINIC_NURSE_SPOTS[spot]`、落 `Down / Idle`
站姿并 `markDirtyIfChanged()`、`grid.update()` 返回 true 时才置 `needsViewRefresh`。

- 回位坐标取出生时的合法站位，不经碰撞求解也不会进墙；
- 新增并行数组 `nurseSpots`（与 `nurses` 同下标）：某个护士创建失败时也不会把别人放错位置；
- 回位排在挥手动效之前：挥手用当前 `pose` 打包 `state`，先回位才不会把躺姿当站姿发出去。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 走 3 次累计（与普通同事一致） | 误伤友好、复用通用账本 | 与「医务人员零容忍」的产品预期相反 | 否决（用户确认一击建案） |
| B. 所有 NPC 被打都抓 | 规则最统一 | 打普通同事也会被抓，改变园区 NPC 的中立语义 | 否决（ADR-0080 已否决） |
| C. 护士免伤，不接执法 | 没有倒地问题 | 「打了要有后果」落空，免伤挡板还会替身后玩家挡刀 | 否决 |
| D. 新增「袭击医护人员」通知编号 | 文案更贴切 | 要扩协议枚举与客户端模板，收益不抵 | 否决（沿用 ADR-0080 的选择） |
| E. 给护士接 NPC 大脑让它自己起身 | 自动恢复 | 会走出柜台，破坏站桩定位与挥手节奏 | 否决 |
| F. 本 ADR 的组合（采纳） | 判定收在一处白名单、护士自恢复、协议与客户端零改动 | 多一个常量集合与一个下标数组 | 采纳 |

## 后果

- `onVentHit` 的 NPC 分支从单角色判断变成集合判断，新职业接入只改白名单；
- `AmbulanceManager` 多一个 `nurseSpots: number[]` 与私有方法 `resetNurse`；
- 新增单测：打得护士一次立即建案、押送途中再打不重复建案（`detention.test.ts`）；
  护士硬直内保持倒地、硬直结束回位、两名护士各回各位（新建 `clinic.test.ts`）；
- 既有用例「打普通同事不计数」的标题改为「只有真人与零容忍角色才进入执法」，断言不变；
- 该命中与「护士倒地」是同一次结算产生的两个独立结果：执法不依赖倒地，也不改
  `sim/vent` 的命中几何；`clinic.observeHit` 的 `if (target.isNpc ...) return` 保持不动，
  护士不会触发救护车与工伤计数；
- 回滚：把 `onVentHit` 的 NPC 分支还原成 `victim.role !== ENTITY_ROLE_GUARD`，删掉
  `advanceNurses` 的回位循环与 `resetNurse` / `nurseSpots` 即可；协议、客户端与持久化都没有改动。

## 已登记、本次不修的边界项

1. 护士躺地期间仍会被 `detention.hasWitness` 当成围观者（不区分 NPC，见 ADR-0080 边界项 2）；
2. 押送链走既有 BFS（`npc/escort-path`），急救站在地图最东侧，`CASE_TIMEOUT_MS = 90_000`
   仍是唯一的硬兜底；
3. 护士被撞离站位后没有寻路，回位是瞬移式写坐标，客户端按 dirty 同步看到「站起来」。
