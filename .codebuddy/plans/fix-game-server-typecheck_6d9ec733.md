---
name: fix-game-server-typecheck
overview: 修复 CI 上 @niuma/game-server typecheck 的 4 个类型错误（villas 存档类型未引入、赌桌广播误用 world.dice、存档测试缺 villas 段、测试误引 vitest），让部署流水线第一步通过。
todos:
  - id: fix-world-state-types
    content: 补齐 world-state.ts 的 VillaSaveState 类型引入，并为存档单测补 villas 段与版本号断言
    status: completed
  - id: fix-dice-broadcast
    content: 改 broadcastDice 接收 DiceHallRuntime，并同步 server.ts 下注与 Tick 两处调用
    status: completed
  - id: fix-test-runner
    content: 将 bus.test.ts 的 vitest 导入改为 bun:test，与仓库其余服务端测试对齐
    status: completed
  - id: update-changelog
    content: 如需提交，在 release-notes.json 追加内部整理记录并执行 changelog:check
    status: completed
    dependencies:
      - fix-world-state-types
      - fix-dice-broadcast
      - fix-test-runner
---

## 产品概述
CI 部署在第一步「安装依赖 + 质量门禁」就失败：全仓类型检查在服务端子工程上报出 4 个错误，导致后续构建与发布全部中断。本次任务是把这门禁恢复绿灯，让新提交的赌场、八角笼、小院、公寓等玩法能够正常上线。

## 核心修复
- 存档层：园区共享运行态的新增字段「豪宅冠名权」在类型声明处引用了未在本文件可见的存档类型，需补齐声明，使快照结构与写盘/读档结构一致。
- 赌桌广播：下注成功与每帧推进后的赌桌快照广播，引用了一个不存在的世界成员（赌桌运行态实际挂在服务启动流程的局部），需改为显式接收赌桌运行态。
- 存档单测：测试用的「快照零件」缺少新增的豪宅段，且版本号断言仍停留在旧版本；补齐后与 v2 存档格式对齐，同时保留对旧版本档的兼容读取验证。
- 对局测试：某测试文件引用了项目未安装的测试框架，在洁净安装下无法解析，需改用与仓库其余测试一致的运行时。

## 交付效果
- 质量门禁在本机与 CI 都能通过，部署流水线可继续执行后续构建与发布步骤。
- 存档读写、赌桌快照广播的行为与既有实现保持一致，不改变任何玩家可见表现。

## 技术栈
沿用现有栈：TypeScript 5.7 + Bun（`bun test`）+ Turbo + pnpm workspace。本次只做类型与签名层面的修复，**不新增任何依赖**，也不引入 vitest。

## 实现方案
四个错误逐一对应到根因与最小改动，全部是「补齐声明 / 修正签名」，不触碰运行逻辑：

1. **`apps/game-server/src/persist/world-state.ts`：`Cannot find name 'VillaSaveState'`**
   根因：第 36 行 `export type { VillaSaveState } from '../sim/villas';` 是纯转出，不在本文件建立本地绑定；而 `boss`/`ring` 之所以可用，是因为第 5-6 行另有一条 `import type`。
   做法：在第 5-6 行旁追加 `import type { VillaSaveState } from '../sim/villas';`，保留第 34-36 行的转出（供外部复用），与 boss/ring 现有写法完全同构。

2. **`apps/game-server/src/sim/dice-hall.ts:213`：`Property 'dice' does not exist on type 'World'`**
   根因：`World`（`sim/world.ts:433`）只持有 `boss` / `ring`；赌桌运行态 `const dice = new DiceHallRuntime({...economy 端口...})` 处在 `server.ts:394` 的局部作用域，且依赖晚于 `world` 创建的 `economy`，无法上提到 `World`。
   做法：把运行态作为首参传入，保留 `now` 默认值（与同目录 `broadcastRing(world, transport, now = Date.now())` 风格一致）：

   ```ts
   export function broadcastDice(
     dice: DiceHallRuntime,
     world: World,
     transport: Transport,
     now = Date.now(),
   ): void {
     for (const player of world.players.values()) {
       if (player.wsId === 0) continue;
       transport.send(player.wsId, encodeDiceState({ tables: dice.snapshot(player, now) }));
     }
   }
   ```

   同步改 `server.ts` 两处调用：第 1141 行（`C2S_DICE_BET` 下注成功后）、第 1476 行（Tick 内 `dice.tick()` 判定变化或 1Hz 心跳）均改为 `broadcastDice(dice, world, transport, now)`。仓库内无其它引用，改动面收敛。

3. **`apps/game-server/src/persist/world-state.test.ts:25`：`Property 'villas' is missing`**
   做法：给 `PARTS` 补 `villas: { villas: [] }`；同时修正第 69 行 `expect(raw.version).toBe(1)` → 断言 `WORLD_STATE_VERSION`（从 `./world-state` 引入，当前为 2），否则 `bun test` 必挂。顺手补一条断言确认 v1 档读回后 `villas.villas` 为空数组，覆盖「v1 按空豪宅接管」的兼容路径。

4. **`apps/game-server/src/challenge/bus.test.ts:2`：`Cannot find module 'vitest'`**
   根因：该文件是全文件唯一使用 vitest 的服务端测试，`apps/game-server/package.json` 与根 `package.json` 均无 vitest（仅 web / shared-types 自有），洁净安装解析失败。
   做法：改为 `import { describe, expect, it } from 'bun:test';`，与 `clock.test.ts`、`boss.test.ts`、`world-state.test.ts` 一致；该文件仅用 `describe/expect/it`，无 `vi.*`，无需其它迁移。

## 实施说明
- `tsc --noEmit` 会一次性输出全程序错误，CI 日志中的 4 条即服务端完整错误集；修复后不应再出现同类报错。
- 按仓库约定（AGENTS.md）本次不额外运行测试/类型检查作为收尾验证；如提交，则必须先按 AGENTS.md 在 `apps/web/data/release-notes.json` 顶部追加一条「内部整理」记录并执行 `pnpm changelog:check`。
- 不修改 `World` 的构造契约、不改存档版本号与落盘字段、不动「豪宅冠名权恢复」等已就绪逻辑（`server.ts:420-424` 已实现 `villas.restore` + `applyVillaLocks`），把爆炸半径限制在 4 个错误点。

## 目录结构（改动文件）
```
apps/game-server/
└── src/
    ├── persist/
    │   ├── world-state.ts       # [MODIFY] 追加 `import type { VillaSaveState }`，使 WorldStateParts.villas 在本地可见；保留原有 export type 转出
    │   └── world-state.test.ts  # [MODIFY] PARTS 补 `villas: { villas: [] }`；版本断言改用 WORLD_STATE_VERSION（=2）；补 v1 档 villa 为空的兼容断言
    ├── sim/
    │   └── dice-hall.ts         # [MODIFY] broadcastDice 增加 dice: DiceHallRuntime 首参，快照取自传入运行态而非 world.dice
    ├── challenge/
    │   └── bus.test.ts          # [MODIFY] vitest → bun:test，与仓库其余服务端测试统一
    └── server.ts                # [MODIFY] 第 1141、1476 行调用改为 broadcastDice(dice, world, transport, now)
apps/web/
└── data/release-notes.json      # [MODIFY] 仅在需要提交时：entries 顶部追加一条内部整理记录（id 形如 2026-11-15-7，最新为 2026-11-15-6）
```
