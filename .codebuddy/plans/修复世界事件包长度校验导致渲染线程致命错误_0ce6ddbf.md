---
name: 修复世界事件包长度校验导致渲染线程致命错误
overview: 修正 S2C_WORLD_EVENT（9 字节）与 S2C_BOSS_SHOCK（11 字节）的定长校验与编码缓冲，并在 NetClient 分发处吞掉单包解析异常，让协议错误不再被当成渲染线程崩溃而触发「刷新改主线程」。
todos:
  - id: write-packet-tests
    content: 用 [skill:test-driven-development] 为世界事件 9 字节、冲击波 11 字节补往返、尾扩、截断测试
    status: completed
  - id: align-packet-sizes
    content: 在 constants.ts 定义两个包长常量，protocol.ts 编解码改用常量并允许尾部扩展
    status: completed
    dependencies:
      - write-packet-tests
  - id: isolate-decode-errors
    content: 拆分 NetClient.handle/dispatch，单包解析异常只记录丢弃，不再冒泡为 fatal
    status: completed
    dependencies:
      - align-packet-sizes
  - id: verify-fix
    content: 用 [skill:verification-before-completion] 跑 shared-types 单测与 web typecheck 并核对输出
    status: completed
    dependencies:
      - isolate-decode-errors
  - id: record-decision-and-notes
    content: 新增 ADR-0102 记录解析隔离决策，更新 release-notes.json 并跑 changelog:check
    status: completed
    dependencies:
      - verify-fix
---

## 用户需求
进入园区后，顶部会反复弹出红条：`ERROR: WORLD EVENT MUST BE 8 BYTES, GOT 9（刷新后自动改用主线程）`。这不是偶发提示：世界事件每 10 分钟一轮，每轮必然触发；一旦出现，本次标签页就会被永久降级为主线程渲染，帧率与流畅度随之下降。要求彻底解决：不再出现该报错，不再因单条报文异常把渲染线程判死，且同类“报文长度写错就崩渲染线程”的问题不复发。

## 产品概述
这是一次面向线上稳定性的纵深修复。玩家侧感知为：红包雨 / 老板查岗横幅与画饼冲击波预警圈正常播放，不再弹红条、不再被自动切到主线程、无需刷新页面。服务端广播格式保持不变，只让客户端的读取与容错跟服务端对齐。

## 核心功能
- 世界事件与冲击波广播按真实长度（9 / 11 字节）被正确解析，事件横幅、红包撒点、预警圈恢复正常。
- 客户端网络层隔离单条报文解析失败：记录一条错误日志后丢弃该包，连接与渲染线程继续运行。
- 定长协议以常量作为唯一事实源，编码缓冲与解码校验引用同一数值，避免以后加字段再次错位。
- 补回归测试锁死两个包的线上字节数，覆盖往返一致、尾部扩展、截断报错。
- 同步一条玩家可感知的版本工报记录。

## 技术栈
- 协议层：TypeScript，`@niuma/shared-types`（Web 与 game-server 共用源码，vitest 单测）
- 客户端：Next.js + Pixi，网络会话运行在 Web Worker 内（`GameSession` → `NetClient`）
- 校验命令：`pnpm --filter @niuma/shared-types test`、`pnpm --filter @niuma/web typecheck`、`pnpm changelog:check`

## 根因（已逐行核实）
- `packages/shared-types/src/protocol.ts:2816` `encodeWorldEvent` 以 `new ByteWriter(8)` 起笔，实际写入 `op(1)+kind(1)+phase(1)+remainingSec(2)+seed(2)+amount(2) = 9` 字节；`ByteWriter.ensure()` 会自动扩容，所以发送端不报错。
- `packages/shared-types/src/protocol.ts:2829` `decodeWorldEvent` 仍按 `!== 8` 校验，服务端正常的 9 字节包 100% 抛错，文案与截图完全一致。
- 同源缺陷：`encodeBossShock` 实际写 11 字节，`decodeBossShock` 却校验 10 字节，首次冲击波同样会抛。
- 放大链路：`apps/web/lib/net/client.ts:422` 的 `handle()` 没有异常边界 → Worker 全局 `error`（`apps/web/workers/game.worker.ts:37`）→ `postMessage({ t: 'fatal' })` → `worker-client.ts:355` `onWorkerFatal()` 受控重载被守卫拦下后 `markRenderFallback()`，弹出「刷新后自动改用主线程」，并永久降级本会话。

## 实施方案
### 1. 定长包以常量作唯一事实源
在 `packages/shared-types/src/constants.ts` 追加（与 `QUEUE_STATUS_BYTES`、`JAIL_PACKET_BYTES` 同风格）：

```ts
/** 世界事件：op(1) + kind(1) + phase(1) + remainingSec(2) + seed(2) + amount(2) */
export const WORLD_EVENT_PACKET_BYTES = 9;
/** 画饼冲击波：op(1) + phase(1) + x(2) + y(2) + radius(2) + remainingMs(2) + hits(1) */
export const BOSS_SHOCK_PACKET_BYTES = 11;
```

`protocol.ts` 第 40-71 行的常量导入块补上这两项；编码改用 `new ByteWriter(WORLD_EVENT_PACKET_BYTES)`，解码改用同一常量。这样“写几字节”和“校验几字节”不可能再各写一个数字。

### 2. 读端对尾部字段容错
解码条件改为“至少 N 字节”，固定字段读完即返回，多余尾字节忽略并注释说明：新字段只能追加在尾部，旧读端忽略。截断仍然立即抛错，保留守卫价值。该策略与既有 `decodeVent` 允许 9/10 字节、HELLO 尾段“读到不认识就停”的做法一致。

### 3. 网络边界隔离（彻底解决的关键）
把 `NetClient.handle(data)` 拆成外层守卫 + 内层 `dispatch(data)`（原 `switch` 原样搬入）：

```ts
private handle(data: Uint8Array): void {
  try {
    this.dispatch(data);
  } catch (error) {
    this.reportDecodeError(data[0] ?? 0, error);
  }
}
```

约束：
- 只 `console.error` 记录 opcode 与错误，然后丢弃这一包，连接、会话与渲染线程继续；
- 同一 opcode 首次打印完整堆栈，后续只计数不刷屏，避免坏包按 tick 打爆 Worker 主循环；
- 不调用 `onStatus('error')`，单包坏掉不该铺成玩家可见红条。

### 4. 回归测试（先红后绿）
在 `packages/shared-types/src/__tests__/protocol.test.ts` 增加：
- 世界事件往返：`encodeWorldEvent(p).byteLength === 9`，`decodeWorldEvent` 结果与 `p` 深相等；
- 冲击波往返：`11` 字节，用整数坐标验证量化后精确还原；
- 尾部扩展：10 字节世界事件包仍能解出前 9 字节字段；
- 截断：8 字节世界事件、10 字节冲击波按 `/must be .* bytes/` 抛错。

### 5. 留档与发布
- 新增 `docs/adr/0102-protocol-decode-errors-are-not-render-fatals.md`，沿用现有 ADR 格式，记录“协议解析异常在 NetClient 边界吞掉、不得进入渲染致命通道”的决策与代价（坏包被丢弃，依赖日志排查）。
- `apps/web/data/release-notes.json` 头部追加一条 `fix`，例如「修复世界事件与画饼冲击波提示偶发中断、画面被切回主线程的问题」，并通过 `changelog:check`。

## 目录结构
```
niuma/
├── packages/shared-types/src/
│   ├── constants.ts        # [MODIFY] 新增两个定长包字节常量
│   ├── protocol.ts         # [MODIFY] 编解码改用常量、允许尾部扩展、注释 8→9 / 10→11
│   └── __tests__/protocol.test.ts  # [MODIFY] 四个回归用例：往返、尾扩、截断
├── apps/web/lib/net/client.ts      # [MODIFY] handle/dispatch 拆分 + 解析异常隔离
├── apps/web/data/release-notes.json # [MODIFY] 追加一条 fix 记录
└── docs/adr/0102-protocol-decode-errors-are-not-render-fatals.md  # [NEW] 失败语义决策
```

## 回归与风险控制
- 服务端与 README 已是 9 / 11 字节，**不动服务端、不改 README**，只修读端。
- 隔离层只在异常路径产生开销，正常包无额外分配；不触碰 `worker-client.ts` / `render-mode.ts` 的致命判定，避免把真正的渲染崩溃也吞掉。
- 不改历史 ADR；新决策单独新增。
- 缓存旧页面遇到新服务端时，尾部容错可正常降级读取，不再整包报错。

## 验收
- `packages/shared-types` 单测通过；Web 端 `typecheck` 通过；`changelog:check` 通过。
- 本地连服跑满一轮世界事件（播报 → 进行 → 结算）与一次冲击波：横幅、红包、预警圈正常，控制台无该报错，状态栏保持在线且不降级主线程。

## Agent Extensions
### Skill
- **test-driven-development**
  - Purpose: 先写世界事件 / 冲击波的长度与往返测试，让缺陷在修复前稳定复现
  - Expected outcome: 测试先失败（9 字节包被 8 字节校验拒绝），修复后全部通过并锁死格式
- **verification-before-completion**
  - Purpose: 在宣布修复完成前跑完单测、类型检查与工报校验并核对输出
  - Expected outcome: 每条验证命令都有实际通过输出，不以推测代替证据
