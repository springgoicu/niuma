---
name: vent-seat-immunity
overview: 让处于入座状态的玩家（办公、睡觉、蹲马桶及所有其他座位）不会被发泄创飞；前方最近目标是入座者时判定为空放。
todos:
  - id: vent-immunity-server
    content: 改造 resolveVents：入座目标判空放，移除座位释放与 seats 参数，同步 server 调用点
    status: completed
  - id: vent-tests
    content: 重写 vent.test.ts 座位用例，覆盖各座位免疫、空放不穿透与席地而坐仍可被创飞
    status: completed
    dependencies:
      - vent-immunity-server
  - id: adr-readme
    content: 新增 ADR-0065 记录入座免伤决策，更新 README 发泄说明
    status: completed
    dependencies:
      - vent-immunity-server
  - id: release-notes
    content: 追加 release-notes 记录 2026-11-13-5 并运行 pnpm changelog:check
    status: completed
    dependencies:
      - vent-immunity-server
  - id: verify
    content: 运行 game-server 类型检查与 bun test，确认无回归
    status: completed
    dependencies:
      - vent-immunity-server
      - vent-tests
---

## 产品概述
调整园区「发泄」动作的服务端命中规则：角色只要处于入座状态就不再会被创飞，避免办公、睡觉、蹲马桶时被反复打断。

## 核心功能
- **入座即免伤**：只要 `seat !== 0`（工位椅、会议椅、床位、马桶、凳子、沙发、石鼓凳、影厅椅均算），被发泄打中时不击退、不倒地、不进入硬直，也不会被拽离座位。
- **免伤者即空放**：出招扇形内最近的人是入座状态时，整次出招判为空放，不穿透命中其身后的人，只播破空音与空放台词。
- **边界明确**：席地而坐（`POSE.Sit` 但无座位）、地面躺平不免疫；起身离座后立即恢复可被创飞。
- **攻击方不变**：自己入座后仍可出招，冷却、扇形范围、硬直与事件包格式全部沿用现有规则，客户端无需改动。

## 技术栈
沿用现有技术栈：TypeScript 5（strict）、Bun `Bun.serve` + 20Hz 固定 Tick、`@niuma/shared-types` 二进制协议；测试使用 `bun:test`。不新增依赖、不改协议。

## 实现方案
### 核心思路
座位占用是服务端内存里的权威字段 `Player.seat`，与客户端自报无关，天然适合做免伤判据。在 `resolveVents` 的命中结算处加一道前置分支：扇形内最近的目标若 `seat !== 0`，直接按空放广播 `targetId = 0` 并结束本次结算；否则走原有击退 / 躺姿 / 硬直路径。这样「免伤 + 不穿透」两个诉求由同一个分支同时满足。

### 关键决策
- **判据用 `seat` 而非座位种类**：澄清结论是「所有入座状态都豁免」，无需读 `seatById` 与 `SeatKind`，规则单一、无白名单漂移风险，单次判断为 O(1)。
- **不跳过而是判空放**：与现有「跳过已倒地者」区分——倒地者被跳过是为了让出招能命中身后的人；入座者是「打到但没有效果」，因此不穿透，语义更直观。
- **删除发泄的座位释放链路**：入座者不再被命中，`seats.stand(target, RELEASED)` 与 `RELEASED` scratch 成为死代码；`resolveVents` 的 `seats` 参数与 `SeatStateEntry[]` 返回值一并移除，返回类型改 `void`。`broadcastSeats` 仍被入场、移动解算、坐 / 躺 / 起身、离场等六处使用，只删发泄这一处调用。
- **客户端零改动**：`handleVent` 对 `targetId === 0` 直接 return，已按空放处理；服务端不再发命中包，本地不会出现「别人看我坐着、我自己躺下」的预测漂移。
- **性能**：稳态仍为「每个玩家一次布尔判断」；只有真正出招的人扫一遍 `attacker.known`，新增一次 `seat !== 0` 比较，无额外分配、无新增包。

### 落地细节
`apps/game-server/src/sim/vent.ts`：

```ts
const target = nearestInCone(world, attacker, now);
if (!target) {
  broadcastVent(world, attacker, 0, 0, 0, transport);
  continue;
}
// 入座即免伤：不击退、不倒地、不释放座位，也不穿透打身后的人
if (target.seat !== 0) {
  broadcastVent(world, attacker, 0, 0, 0, transport);
  continue;
}
// 原有的 resolveMotionInto → POSE.Lie → stunUntil → dirty → broadcastVent(target.id)
```

`apps/game-server/src/server.ts`（约 754-757 行）：

```ts
// 注释保留：发泄结算必须跑在 runTick 之前
resolveVents(world, grid, transport, now);
```

同时删除 `vent.ts` 里的 `SeatRegistry`、`SeatStateEntry` import 与 `RELEASED`，更新顶部注释与 `nearestInCone` 的说明（跳过的是倒地者；入座者会被选中但判空放）。

### 架构与边界
改动集中在服务端仿真层的单点结算函数，`World` / `SeatRegistry` / `movement` / 协议 / 渲染层均不涉及；不改变 `S2C_VENT` 9 字节定长与 `VENT_*` 常量，回滚只需恢复命中分支与 `seats` 参数。历史 ADR-0051 不修改，其第 3 节「命中后释放座位」的结论由新 ADR 修订。

## 目录结构
```
niuma/
├── apps/game-server/src/
│   ├── sim/vent.ts        # [MODIFY] 入座目标判空放；移除座位释放、seats 参数与 SeatStateEntry 返回值，更新注释
│   ├── sim/vent.test.ts   # [MODIFY] 删除「座位释放」用例；新增工位椅/床位/马桶/凳子免疫、空放不穿透、席地而坐仍可被创飞的用例
│   └── server.ts          # [MODIFY] Tick 内改为 resolveVents(world, grid, transport, now)，删除 ventSeats 广播
├── docs/adr/
│   └── 0065-vent-immune-when-seated.md  # [NEW] 记录入座免伤决策：背景、备选方案、决策、后果、回滚、验证
├── README.md              # [MODIFY] 「发泄（E）」段落补一句：入座者不会被创飞，空放不穿透
└── apps/web/data/release-notes.json  # [MODIFY] 追加 2026-11-13-5 版本工报，面向玩家的三条改动
```

## 验证
- `pnpm --filter @niuma/game-server typecheck`
- `pnpm --filter @niuma/game-server test`（重点 `src/sim/vent.test.ts`）
- `pnpm changelog:check`
