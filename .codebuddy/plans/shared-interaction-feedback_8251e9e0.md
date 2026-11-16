---
name: shared-interaction-feedback
overview: 让旁观者能看到他人的交互反馈：老板被任何玩家击中都抖动/发红/冒伤害数字并发出钝击音；点赞时目标头顶冒爱心；保安出动时旁人能看到提示。纯客户端改动，不碰协议。
todos:
  - id: boss-feedback
    content: 新增 bossHitFeedback 纯函数与单测，覆盖入场快照、跨日重置、他人命中、本人命中与未知前值
    status: completed
  - id: boss-feedback-wire
    content: 改造 handleBoss：任意出招者都触发抖动与钝击音，维护 lastBossHp 并按血量差累积伤害
    status: completed
    dependencies:
      - boss-feedback
  - id: boss-damage-float
    content: 新增 renderer.showBossDamage 与主循环 600ms 合并窗口，用 [skill:pixel-venue-polish] 校验像素风格
    status: completed
    dependencies:
      - boss-feedback-wire
  - id: like-guard-visibility
    content: 补点赞头顶「赞 +1」与保安派单气泡，renderer 增加 hasEntity 回退判断
    status: completed
  - id: docs-changelog
    content: 新增 ADR-0103 与 release-notes 2026-11-16-4，写清共享可见与本机私有的边界
    status: completed
    dependencies:
      - boss-feedback-wire
      - like-guard-visibility
  - id: verify
    content: 使用 [skill:verification-before-completion] 运行 typecheck、bun test 与 changelog:check 并记录证据
    status: completed
    dependencies:
      - docs-changelog
---

## 用户需求
发泄区里看不到其他玩家的交互：别人踢老板时，老板不会抖动泛红，也没有钝击声，只有血条数字在变。需要把这类「只有本人能看到」的共享反馈补齐，并顺带做一次全局检查，找出同类遗漏。

## 产品概述
让同一个园区里的玩家能互相看见对方的动作结果。范围锁定在发泄区老板受击、工牌点赞、保安出动三处；明确属于个人私密的反馈（上香、弱交互场所台词）保持原样，需要改服务端或协议的项不在本次范围。

## 核心功能
- 老板受击共享：任何玩家踢中老板，附近所有人都看到老板左右抖动、整体泛红，并在身上浮出 `-N` 伤害数字；800 像素内还能听到随距离衰减的钝击声。
- 连击合并：多人高频踢打时，短窗口内的多次命中合并成一个 `-N` 数字，数字短促上浮淡出，不遮挡血条与名牌。
- 边界正确：入场补发的血量快照与跨日回满只更新血条，不触发抖动、飘字与音效；老板归零时的「老板倒下」提示仍只弹一次。
- 点赞可见：有人给工牌点赞时，被点赞者与视野内其他人都能看到目标头顶浮出「赞 +1」。
- 保安出动可见：保安被派单时，附近玩家能看到保安头顶冒出提醒；保安不在视野内时退到被处置者头顶显示。
- 观感一致：新增飘字沿用现有金色像素飘字样式，整像素定位，不引入新的美术资源。

## 技术栈
- 现有栈：Next.js + React + TypeScript、Pixi.js v8 渲染层、Web Worker 会话层（`apps/web/lib/game/runtime`）、`@niuma/shared-types` 协议包、服务端 Bun。
- 本次不新增依赖、不改协议、不改服务端：`S2C_BOSS`（6 字节，含 `attackerId`）与 `S2C_LIKE`（6 字节，含 `targetId`）已经把所需信息广播到位。
- 测试：`bun test lib`（apps/web），沿用 `vent-outcome.ts` 的纯函数 + 单测范式。

## 实现思路
1. 把「一条老板血量包对本地意味着什么」抽成纯函数 `bossHitFeedback(packet, localId, previousHp)`，返回 `{ hit, byLocal, damage }`。归因只做一次，会话层与单测共用，避免回调里再写一套判断。
2. `handleBoss` 从「只认 `attackerId === localId`」改为「`attackerId !== 0` 即视为真实命中」：抖动、钝击音对所有人触发，`local` 只用于音效的 90ms 节流档位；伤害按前后血量差累积。
3. 伤害数字不复用每条命中：会话层按 600ms 合并窗口把累积值交给渲染层，渲染层复用既有 `RitualFx`（3 槽、1.8s 生命、金色描边）在老板胸腹位置飘 `-N`。这样 20Hz 连击不会造成 Text 每帧重建，也不会把上香/擂台飘字挤掉。
4. 点赞在 `handleLike` 里对目标实体调用现有 `renderer.showFloatText`，目标不在视野时静默跳过；保安派单在 `handleJail` 非 self 分支补 `Dispatch` 阶段的气泡，渲染层新增 `hasEntity(id)` 做保安不可见时的回退。
5. 明确不动 `handleVent` 开头的 `targetId === 0` 早退：空放的动画、破空音与台词由 state 位上升沿覆盖（远端 `stepRemote`、本人按键），改这里会造成双重音效。

## 实施要点
- 性能：单次受击成本 O(1)，只有几次标量写入；飘字按 600ms 合并后每秒最多约 2 次、并发不超过 3 个槽位；音频沿用现有固定声道池与共享噪声链，不产生每帧对象。
- 音效：直接复用 `emitAudio({ kind: 'vent', hit: true, local: byLocal })`。`sfx.playVentImpactSound` 自带 800px 距离衰减（`spatial-audio.ts`），远处玩家天然听不到，不会变成全图「砰」。
- 边界：`lastBossHp` 初值 -1，表示「还没收到过快照」；此时一次命中只记 1 点伤害，绝不把整条血算成伤害。跨日 `reset` 包清空伤害累积并同步血量。
- 影响面：`onBossDown(local)` 语义与「老板倒下」横幅不变；不触碰服务端、协议与老客户端；不顺手重构无关代码。
- 可感知验收：两个客户端同屏，A 连续踢老板，B 应看到抖动 + 泛红 + `-N` 并在 800px 内听到闷响；B 给 A 点赞，双方都能看到 A 头顶「赞 +1」；有玩家被派单时，旁观者能看到保安提醒。

## 架构与数据流
服务端 `broadcastBoss` → `NetClient.onBoss` → `GameSession.handleBoss` → `bossHitFeedback()` → `renderer.flashBossHit()` + `emitAudio()` + 伤害累积 → 主循环 `flushBossDamage()` → `renderer.showBossDamage()` → `RitualFx.floatText()`。

点赞：`handleLike`（服务端已广播 flag0/flag1）→ `renderer.showFloatText(目标坐标, '赞 +1')`。
派单：`handleJail` 非 self 分支 → `renderer.hasEntity(guardId)` 判断 → `showBubble(guardId 或 entityId, '保安来了！')`。

## 目录结构
```
apps/web/lib/game/
├── boss-feedback.ts                        # [NEW] 纯函数 bossHitFeedback：判定是否真实命中、是否本人出招、本次伤害（按前后血量差计算，未知前值按 1 点）。只依赖 BossPacket 类型，不碰渲染与网络。
├── __tests__/
│   └── boss-feedback.test.ts               # [NEW] 单测：入场快照 attackerId=0、跨日 reset、他人命中、本人命中、未知前值、一次跨多点伤害。
├── session.ts                              # [MODIFY] handleBoss 改为任意 attackerId 都触发抖动与钝击音，新增 lastBossHp / bossDamage / bossDamageNextAt 字段与 flushBossDamage()；handleLike 增加目标头顶「赞 +1」；handleJail 非 self 分支补 Dispatch 气泡与回退。
├── renderer.ts                             # [MODIFY] 新增 showBossDamage(damage)（复用 RitualFx，在老板胸腹位置飘 -N，常量注释说明偏移）与 hasEntity(id)；从 shared-types 补导入 BOSS；更新 flashBossHit 注释为「任何玩家踢中」。
└── runtime/                                # 不改动：AudioEvent 与 sfx 现有能力已够用。

docs/adr/
└── 0103-shared-action-feedback-visibility.md  # [NEW] 记录「共享交互反馈对旁观者可见」的契约：老板受击、点赞、保安派单；同时列出仍保持本机私有的反馈（上香与作揖、弱交互场所台词、设施互动气泡、个人钱包与打赏）与本次不做的项（影厅频道同步、暴击标记、被挡原因提示）。

apps/web/data/
└── release-notes.json                      # [MODIFY] 追加 id=2026-11-16-4 的记录（今天已有 1/2/3），最多 4 条改动，面向玩家描述可见变化，提交前跑 pnpm changelog:check。
```

## 关键代码结构
```ts
export interface BossHitFeedback {
  /** 是否真实命中：attackerId 非 0 且不是跨日重置 */
  hit: boolean;
  /** 出招者是否是本机玩家，决定音效走哪一档节流 */
  byLocal: boolean;
  /** 本次应显示的伤害点数；previousHp 未知时按 1 点，绝不把整条血算成伤害 */
  damage: number;
}

export function bossHitFeedback(
  packet: BossPacket,
  localId: number,
  previousHp: number,
): BossHitFeedback;
```

## Agent Extensions
### Skill
- **pixel-venue-polish**
  - Purpose: 校准发泄区新增的受击飘字与抖动表现，确保整像素定位、字号描边与全站像素画风一致，不糊边、不抢血条与名牌。
  - Expected outcome: 伤害数字在发泄区室内光线下清晰可读，抖动幅度与现有 140ms 节奏一致，无需新增美术资源。
- **verification-before-completion**
  - Purpose: 在宣称完成前跑通并记录命令证据，避免只凭代码阅读判断。
  - Expected outcome: `pnpm --filter @niuma/web run typecheck`、`pnpm --filter @niuma/web test`、`pnpm changelog:check` 全部通过，并给出实际输出摘要。
