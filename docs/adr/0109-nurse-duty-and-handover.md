# ADR-0109：护士值守巡游与伤员交接链

- 状态：已采纳
- 日期：2026-11-16
- 关联：救护车与床位治疗沿用 ADR-0084；护士零容忍沿用 ADR-0090；NPC 由救护车送医沿用
  ADR-0106；共享运行态落盘范围不变（ADR-0081）；救护车 8 秒脱困沿用 ADR-0097

## 背景

ADR-0084 把急救链做成「车一停就把伤员直接写上床」，护士始终站在柜台后的固定站位。实际运行
时，这条链路由三处坐标硬切拼成：

1. `admitDirect` 把伤员从车尾（落点）直接吸附到床心，100~180px 一帧完成；
2. 治疗结束再由 `finishStay` 把真人写回床尾、把 NPC 写回**倒地坐标**，NPC 会从病床瞬移回
   半个园区外；
3. 护士帽红十字画在固定站位，人不动，贴图也不动。

要消掉的不只是数字，而是三处「玩家看得见的一帧跳」。约束是：协议不加状态、不写新落盘、
急救链不能因此卡死；失败时仍要能回退到 ADR-0084 的旧路径。

## 决策

### 1. 护士值守状态机放在 `sim/clinic`，不进 NPC 层

`NurseDuty` 只认识实体与站内几何，阶段为 `post | patrol | pickup | escort | treat | back`：

- `post`：站在站位里驻足 2.4~5.2 秒，偶尔挥手；
- `patrol`：沿柜台东侧 22px 通道 → 床区南侧通道 → 落点走巡检环，到点驻足；
- `pickup`：救护车在落点等待时，从当前位置直奔「伤员东侧 22px」；
- `escort`：转身朝床，伤员以躺姿尾随身后 22px；到床侧后交给上床 tween；
- `treat`：治疗 3 秒站床侧；`back`：走回站位。

位移全部走现有 `resolveMotionInto`，每 Tick 只在位移 > 0.5px 时写状态、标脏与刷新 AOI 网格。
航点由 `CLINIC_RECT` 派生（`CLINIC_NURSE_LANE_X/Y` 与床侧点），不把 `NpcAgent` / 巡逻路点
引进急救站，守住 ADR-0106 的层边界。

### 2. 交接不新增协议状态

`Ambulance` 增加内部字段 `handover` / `handoverAt`，仍复用 `Transporting` 与现有
`attachPatient`：

- 车到 `CLINIC_DROP` 后停在落点继续挂人，`CARRYING` 照常亮；
- 有空闲护士：护士走到落点接手，`startEscort` 清 `handover` 与 `targetId`，车才切
  `Returning`；
- 没有空闲护士或 6 秒等不到人：维持 `admitDirect` 旧路径。

协议值域、客户端车辆分支与落盘结构都不动。

### 3. 上床 / 下床走 360ms 逐 Tick 过渡

`SeatRegistry.occupy` 增加可选 `snap`（缺省 `true`，其他调用方行为不变）。急救站用
`snap=false` 先占座与落姿态，再由 `MoveTween` 在 360ms 内逐 Tick 把伤员从床侧挪到床锚点并
刷新 `grid`；治疗结束同样在 360ms 内从床心平移到床尾。座位广播只在 `occupy` / `stand`
时发，不随 tween 逐帧广播。

`seatId = 0`（两张床占满）时不位移，原地地面治疗。

### 4. 康复端口收窄为「只续接任务」，不再写回倒地点

`NpcRestorePort` 收紧为 `restore(playerId, now)`：

- 坐标先由 `sim/clinic` 写成床尾（与真人口径一致）；
- `npc/director` 只清 `incapacitated` / `stunUntil` / `carriedBy`，复位 `Idle`，从当前位置续接
  巡逻 / 押送 / 盯梢；
- `npcReturn` 整张 Map 删除，NPC 康复后不再瞬移回倒地坐标。

护士同理：康复后 `beginBack` 走回站位，只有卡死超时才瞬移兜底。

### 5. 客户端三处跟位

- 红十字按实体 id 登记，每帧读视图根节点的当前插值坐标；护士走远不会留下帽徽；
- 治疗爱心挂到正在被治疗的伤员头顶，上床 / 下床 tween 期间跟着人走；
- `GameSession` 新增 `patientLocked`：`Incapacitated` / `Treating` 期间本地位置与服务端同权，
  不再先按本地输入外推再跳回。

## 后果

- 一次护送拆成「车等 → 护士走过来 → 拖行 → 上床 tween → 守床 → 下床 tween → 走回」，
  全程逐 Tick 位移 ≤ 15px，玩家视角看不到一帧跳。
- 交接多出 2~5 秒等待；救护车出警与绕行时间不变（ADR-0097 的东主路路线）。
- 兜底路径一条不少：双护士昏迷 / 都在忙 → `admitDirect`；接人路上卡死 2.4 秒 → `admitDirect`；
  车在落点等 6 秒 → `admitDirect`；护送 9 秒未到床或中途卡死 → 就地地面治疗；
  护士被打倒 → 伤员原地掉落并重新排队；床位被抢 → `seatId = 0` 地面治疗。
  任一路径都不会让实体永久停在躺姿。
- 6 秒排队就地包扎、15 秒工伤保护、擂台不派车保持原样（ADR-0084）。
- 回滚：删除 `NurseDuty` / `handover` / `patientLocked`，`NpcRestorePort` 恢复 `spot` 参数；
  协议与 `world-state.json` 零影响。

## 备选方案

- **护士并入 NPC 层，复用 brain / escort**：少写一套移动逻辑，但护士会变成可接押送单的 NPC，
  急救站还要依赖 `npc` 层，违反 ADR-0106 的依赖方向。
- **新增 `AMBULANCE_STATE.HandingOver`**：语义最清晰，但要同步改协议值域校验与客户端全部分支，
  本次不值得。
- **保留 NPC 坐标回写，只把回写点改到床边**：仍是「治好后瞬移回原处」的语义，只是距离变短，
  没有解决玩家感知。

## 验证

- `sim/clinic.test.ts`：整条链路逐 Tick 记录伤员坐标，护士接手后的每一帧 < 60px（实测 ≤ 15px）；
  另覆盖双护士昏迷、护士护送途中被打倒、两床占满地面治疗。
- `npc/director.test.ts`：康复续接只清状态，坐标不跳。
- `pnpm -r typecheck`、`pnpm --filter @niuma/game-server test`、`pnpm --filter @niuma/web test`。
