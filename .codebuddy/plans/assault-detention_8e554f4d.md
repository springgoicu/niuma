---
name: assault-detention
overview: 在擂台外单方面攻击同一名玩家达到阈值时，依次触发私下警告与保安押送：复用现有小黑屋处置链路，新增 2 分钟滑动窗口的攻击账本。
todos:
  - id: notice-and-vent-port
    content: 新增两个系统文案 kind，并给 resolveVents 加可选命中观察者与测试
    status: completed
  - id: detention-assault-ledger
    content: 用 [skill:tdd] 在 Detention 实现攻击账本、第 2 次私警与第 3 次建案派单
    status: completed
    dependencies:
      - notice-and-vent-port
  - id: wire-server-and-adr
    content: server 注入观察者，新增 ADR-0074 记录判定口径与回滚方式
    status: completed
    dependencies:
      - detention-assault-ledger
  - id: changelog-and-verify
    content: 补版本工报，跑 bun test、类型检查与 changelog:check
    status: completed
    dependencies:
      - wire-server-and-adr
---

## 产品概述
园区里除了擂台，任何地方对同一名玩家反复动手都会被保安盯上，形成一次从警告到押送的完整执法事件。

## 核心功能
- 只统计擂台外的攻击命中：擂台内互打、空放、打在座位上的人、攻击 NPC 都不计数。
- 以 2 分钟滑动窗口统计同一攻击者对同一受害者的命中次数：第 2 次命中只私下提醒攻击者本人，旁人不该知道；第 3 次命中立即广播「被保安请进小黑屋（园区内不许动手）」并派最近的保安。
- 复用现有押送表现：保安步行赶到、按肩停顿、拖出门口、拖进小黑屋反省点，到达即放人，不新增禁足时长。
- 互殴时双方各自按单向次数累计，谁先打满 3 次谁被押走；已经被押送中的玩家不重复触发。
- 攻击者断线、超过 2 分钟窗口或已进入押送流程后，计数自动清零。

## 技术栈
- 服务端：Bun + TypeScript（`apps/game-server`），测试用 `bun:test`。
- 共享契约：`@niuma/shared-types`（`SYSTEM_NOTICE_KIND`、`formatSystemNotice`、`encodeSystemNotice`）。
- 客户端：不改动。系统提示文本由服务端套模板，客户端只按 kind 选默认样式展示。

## 实现策略
在现有执法模块 `sim/detention.ts` 内增加一份「攻击账本」，由唯一权威命中结算点 `sim/vent.ts` 通过可选观察者端口上报命中。不新增模块、不改 9 字节 `S2C_JAIL` 协议、不改客户端组件，回滚只需移除注入。

### 1. 系统文案（shared-types）
在 `packages/shared-types/src/notice.ts` 的 `SYSTEM_NOTICE_KIND` 追加两个编号（当前已用 1–5）：
- `AssaultWarn = 6`：`保安盯上你了：园区内不许动手，再打一次就请你进小黑屋。`，只发给攻击者本人。
- `DetainedFight = 7`：`{name} 被保安请进了小黑屋：园区内不许动手。`，沿用 `Detained` 的 AOI 广播口径（只发 `player.known`）。

现有 `Detained` 文案保持不变，坐站骚扰仍走原路径；客户端 `handleSystemNotice` 直接显示文本，`ChatLog.systemMarker` 对未知 kind 走 default，无需前端改动。

### 2. 命中上报（vent.ts）
导出 `VentHitObserver` 接口，只暴露一个方法 `onVentHit(attacker, target, now)`；`resolveVents` 增加可选第五参数。在确认命中、算出 `ringHit` 之后调用一次，且仅在 `ringHit` 为假时上报。空放（`targetId = 0`）、入座免伤提前 `continue`、老板受击走 `resolveBossHit`，都不会回调，无需额外判断。

依赖方向保持向内：`vent.ts` 只认识自己定义的观察者接口，不引用 `detention.ts`；由 `detention.ts` 实现该接口，`server.ts` 在组装层注入。

### 3. 攻击账本（detention.ts）
新增常量 `ASSAULT = { WINDOW_MS: 120000, WARN_HITS: 2, CONFIRM_HITS: 3 }`。

数据结构：顶层以攻击者实体 id 为键，内层以受害者 id 为键，值为命中时刻数组。只在命中时 push 并裁掉窗口外的时刻，窗口内最多保留 3 个时间戳，内存与 CPU 都可忽略。

`onVentHit` 规则：
- 攻击者或受害者是 NPC、任一方 `wsId` 为 0 时直接返回。
- 攻击者已在 `cases` 中时直接返回，避免重复建案。
- 命中次数达到 `WARN_HITS` 时调用只发本人的警告（`encodeSystemNotice` + `transport.send(attacker.wsId, ...)`，不经过 AOI 广播）。
- 达到 `CONFIRM_HITS` 时清空该攻击者的全部记录，调用建案方法并广播 `DetainedFight`。
- 同一攻击者打不同受害者分别计数，不合并。

把现有 `confirm()` 的建案段抽成 `openCase(player, now, noticeKind)`：占反省点、写 `cases`、按 kind 套文案、`tryDispatch`。坐站循环的 `confirm()` 仍先清空观察窗，再以 `SYSTEM_NOTICE_KIND.Detained` 调用 `openCase`，现有行为与测试预期不变。`openCase` 入口判断 `cases.has`，防止两种判定同时建案。

清理：`update()` 中按 5 秒节流执行一次 `pruneAttacks`，删除已断线的攻击者与全部过期记录；`dispose()` 清空账本。避免每 Tick 全量遍历。

### 4. 接线（server.ts）
`resolveVents(world, grid, transport, now, detention ?? undefined)`。`Detention` 实现 `VentHitObserver`，直接传实例，不创建闭包、不产生稳态分配。Tick 顺序不变：命中当帧即可建案，保安同一帧起步。

### 5. 决策记录
新增 `docs/adr/0074-assault-detention.md`：记录单向计数口径、2 分钟窗口、第 2 次私下警告、第 3 次押送、擂台与 NPC 排除、为什么复用 `Detention`、回滚方式（`GAME_JAIL_ENABLED=false` 时 `detention` 为 null，观察者不存在，行为回到当前版本）。不改写历史 ADR。

## 性能与可靠性
- 稳态：每 Tick 只多一次可选回调判断；仅真正命中时执行一次数组 push 与裁剪。
- 广播：警告单发本人 1 条；确认复用现有 `known` 集合，不新增扫描。
- 失败兜底：派单全忙时沿用 12 秒排队重试与 12 秒超时放人；拖行沿用 15 秒超时与 40 秒整案上限。
- 无协议变更、无持久化、无新计时器。

## 待确认假设
- 互殴按单向累计，不检查受害者是否还手（用户未选「只有没还手才押」）。
- 第 3 次命中直接建案派单，不再追加确认等待。
- 2 分钟为滑动窗口，按服务端毫秒时间计算。

## 验证命令
- `d:\other\project\niuma\node_modules\.bin\bun.cmd test`（在 `apps/game-server` 下）
- `d:\other\project\niuma\node_modules\.bin\tsc.cmd --noEmit`（在 `apps/game-server` 下）
- `pnpm changelog:check`（仓库根）

## 目录结构
```text
apps/game-server/src/
├── sim/
│   ├── vent.ts            # [MODIFY] 导出 VentHitObserver，resolveVents 增加可选观察者，仅擂台外命中上报
│   ├── vent.test.ts       # [MODIFY] 断言擂台命中不回调、普通命中回调一次、空放与入座免伤不回调
│   ├── detention.ts       # [MODIFY] 攻击账本、onVentHit、openCase 抽取、5 秒清理、dispose
│   └── detention.test.ts  # [MODIFY] 第 2 次私警、第 3 次派单、窗口过期、不同受害者、NPC、重复派单
└── server.ts              # [MODIFY] 把 detention 作为观察者注入 resolveVents
packages/shared-types/src/
└── notice.ts              # [MODIFY] 新增 AssaultWarn 与 DetainedFight 两个系统文案 kind
docs/adr/
└── 0074-assault-detention.md  # [NEW] 打人触发执法的规则、取舍与回滚
apps/web/data/
└── release-notes.json     # [MODIFY] 追加 2026-11-13-19，面向玩家的修复说明
```

## Agent Extensions
### Skill
- **tdd**
  - Purpose: 按红绿节奏先写失败用例，再实现攻击账本与观察者端口，确保阈值、窗口与排除规则被测试锁住
  - Expected outcome: `vent.test.ts` 与 `detention.test.ts` 新增用例先失败后通过，回归可被测试拦住
