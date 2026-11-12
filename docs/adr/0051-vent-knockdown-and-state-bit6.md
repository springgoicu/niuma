# ADR-0051：发泄（Vent）——bit6 换语义与服务端权威的创飞倒地

- 状态：已采纳
- 日期：2026-11-12
- 取代：ADR-0018 中 bit6 = 「叫唤」的语义，以及该动作的音效与叠加位准入规则（ADR-0018 的其余结论——姿态四态收敛、叠加位与姿态正交、图集只增不改已有列号——仍然有效）
- 关联：ADR-0019（打招呼，同为叠加位）、ADR-0048（一次性事件通道与空间音效）、ADR-0043（去脏同步，叠加位到期必须立刻发包）

## 背景

园区里的「叫唤」是一个纯情绪动作：按下 `E`，角色张嘴、出一声合成音，对世界没有任何影响。
它的问题是**没有后果**——两个人贴在一起，最激烈的互动也只是互相哞一声。

要换成「发泄」：一记牛马式冲撞，打到的人会被创飞、摔在地上、1.5 秒起不来。
这就不再是表现层的事了：它需要命中判定、位移解算、姿态强制与硬直，而且这些必须**由服务端裁决**——
否则任何客户端都能靠自证命中把满园的人放倒。

同时有两条硬约束不能破：

1. **移动包必须还是 8 字节**（`op|id|x|y|state`）。20Hz × 200 人的上行是这条协议的带宽底线，
   加任何字段都得重新论证 ADR-0043 的结论；
2. **叠加动作与姿态正交**这条模型不能退回去（ADR-0018 的核心结论），否则「坐着发泄完站起来」的老 bug 会复现。

## 问题

- `state` 的 8 位已经排满：`dir(2) | pose(2) | wave(1) | moving(1) | bit6(1) | jump(1)`，没有第 9 位；
- 本地玩家的姿态是**客户端预测**的：`visitSync` 对自己的分支只做位置纠偏，
  Tick 里的 `state` 对本人不生效。这意味着「我被强制躺下」这件事无法只靠 Tick 传达；
- 击退只有 32px，低于 `LOCAL_DRIFT_LIMIT`(128px) 的一次性对齐阈值，
  光等 Tick 回正会先看到人被拉开、再被拽回来；
- 客户端把叠加位保持一整个播放窗口（440ms ≈ 9 个 Tick），逐 Tick 结算会让一次出招打九次。

## 备选方案

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 新增第 9 位 / 新增长度可变的移动包 | 语义最干净，命中位与动作位分开 | 要升 `state` 位宽 → 同步条目从 48 bit 溢出 → 升同步格式 → 每个实体多占字节；违背「移动包 8 字节」这条验收线 | 高 |
| B. bit6 原地换语义，命中结果走进一次性事件包 | 包长、opcode、位布局全不变；命中由服务端算，客户端只上报「我在出招」 | bit6 的旧语义（叫唤）彻底消失，旧客户端与新客户端互相看不到对方的这个动作 | 低 |
| C. 命中结果也塞进 Tick，不加事件包 | 零新增包 | 本地玩家姿态是预测的 → 「别人看我躺着、我自己还站着」；且无法归因（谁打了谁），音效与台词都没有对象 | 中 |

选 **B**。

## 决策

### 1. bit6：`emote` → `vent`，包长零变化

```ts
// packages/shared-types/src/quantize.ts
packState(direction, pose, moving, vent = false, jump = false, wave = false)
STATE_BITS = { direction, poseShift: 2, pose, wave: 0b10000, moving: 0b100000, vent: 0b1000000, jump: 0b10000000 }
```

移动包仍是 8 字节（带序号时间戳 14 字节），紧凑同步条目仍是 48 bit。
客户端上报的是**出招意图**，不是命中结果——打没打到、打到谁，全部由服务端说。

### 2. 新增 9 字节 `S2C_VENT`

```
[op=0x21][attackerId u16][targetId u16][x u16][y u16]
```

- `targetId = 0` 表示空放，`x/y` 无意义；空放也要发，破空音与台词需要附近每个人都能独立播放；
- `x/y` 是服务端结算后的**受击者权威坐标**（1/8px 定点，与移动包同一把尺子）；
- 按 `attacker.known`（对称 AOI）定向广播，**包含发起者自己**——本地要靠它区分命中与空放。

这条包与 `S2C_GRAZE` 同属「一次性事件通道」，不进 20Hz 稳态：一次出招最多 1 条 × 视野人数。

### 3. 命中判定在 Tick 里，且必须跑在 dirty 广播之前

```ts
// apps/game-server/src/sim/vent.ts
resolveVents(world, grid, seats, transport, now)   // 在 runTick 之前调用
```

- 只消费 `ventPending`（`Player.applyState` 在 bit6 的 0→1 上升沿置位），配合 `VENT_COOLDOWN_MS` 限频，
  把「位保持 440ms」收敛成「一次结算」；
- 扇形：`withinVentCone(ax, ay, dir, bx, by)`，前方 **64px**、合计 **60°**（±30°），
  四向轴对齐、点积平方比较、无开方；客户端「点击身边玩家」用同一个函数，可打范围与服务端完全一致；
- 目标从 `attacker.known` 里选**距离最近**且未处于硬直的人（跳过已倒地的，避免一脚把人永久锁在地上）；
- 命中后：`seats.stand(target)` 释放座位 → `resolveMotionInto` 沿出招朝向推 **32px**（与移动共用碰撞求解器，
  贴墙自然衰减，绝不穿墙）→ `applyState(target.direction, POSE.Lie, false)` → `stunUntil = now + 1500ms`；
- 解算必须发生在 `runTick` 的 dirty 遍历之前，否则受害者的新坐标与躺姿要晚一个 Tick（50ms）才广播出去。

### 4. 硬直是服务端权威，客户端只负责不早发

```ts
// sim/movement.ts —— 防重复序号之后、座位分支之前
if (now < player.stunUntil) {
  player.applyState(player.direction, POSE.Lie, false);
  markIfChanged(player);
  return RESULT;   // accepted = false
}
```

不拦 `lastMoveAt`：硬直结束时时间窗被 `MAX_WINDOW_MS`(250ms) 封顶，一次最多放行 ≈55px，
正好容得下 32px 的击退落点，不会把人拽回原位。

客户端侧：

- 收到 `S2C_VENT` 且 `targetId` 是自己 → 直接写 `Position`、强制 `POSE.Lie`、清叠加位、
  `stunUntil = elapsed + VENT_STUN_MS`（从**收到**起算，晚半个 RTT，所以永远不会提前发输入被拒）；
- `stepLocal` 在 `elapsed < stunUntil` 时把输入归零，按方向键也起不来；到期后自然起身。

### 5. 客户端出招：打断移动，而不是滑步

`applyIntent('vent')`：冷却检查 → 若 `pose === Walk` 先落回 `Idle`（`overlayTrackFor` 对 `Walk` 返回 null）
→ `startOverlay('vent')` → `ventLockUntil = elapsed + overlays.ventMs` 冻结位移。
这样「行走中按 E」是**停下出招**，不会出现一边滑步一边头槌；服务端也因此放行行走中的 vent 位
（`state.vent` 不再按 `stationary` 丢弃，只有 wave 仍要求站定）。

### 6. 声音与台词

- 空放：低通白噪 1600→420Hz，0.18s，「呼哧」；
- 命中：带通噪音冲击 + 正弦 190→52Hz 下潜，0.21s，「砰」；
- 两条噪音共用一条常驻的环形缓冲噪音链（1s buffer，`loop = true`），与振荡器池同一个思路：
  节点一次建好，之后只写 AudioParam；
- 本地「挥空」与「命中」用**各自的节流时间戳**——命中的回执只比出招晚半个 RTT，
  共用一个 90ms 窗口会把「砰」吞掉；
- 台词按 `netId` 取模选句（`pickVentLine` / `pickVentVictimLine`），
  每个客户端各自渲染气泡也能得到同一句，双开窗口画面一致。

### 7. 图集：16-24 列重绘，版本升到 8

`vent 16-18 / sitVent 19-21 / lieVent 22-24`，逐帧 `[140, 120, 180]`（合计仍是 440ms，与播放窗口对齐）：

- 第 16 列：后撤蓄力，躯干后退 1px、头微抬、双耳竖起；
- 第 17 列：全力前冲，躯干前移 2px、头下压 3px、前蹄前探 5px 砸地，并在描边之后补 1px 速度线；
- 第 18 列：后坐力，只留 1px 前倾残余。

速度线必须在 `px.outline()` 之后落笔（先画会被描边包成一根带黑框的小棍子）。
躺姿的下压量取 `min(0, dropY)`：贴地躺姿没有下方余量，再往下压会把马的鬃毛顶出 64 帧底边。

## 后果

- **正面**：移动包体积、同步条目、稳态吞吐全部不变；命中由服务端裁决，客户端无法自证；
  受害者的落地坐标与躺姿在同一次广播里到达，两个窗口的画面一致；
- **负面**：bit6 的旧语义（叫唤）彻底消失，新旧客户端互相看不到对方的这个动作（降级为「没反应」，不会崩）；
  一次出招多一条 9 字节的定向事件包（限频 700ms，可忽略）；
- **不变**：姿态枚举仍是四态、`POSE.Emote` 这类「动作即姿态」的用法没有回潮；
  叠加位仍然与姿态正交，播完自然回到原姿势。

## 回滚

1. 表现层单独回滚：让 `overlayTrackFor` 对 `vent` 恒返回 null、删掉 `S2C_VENT` 的客户端处理——
   协议与包长不动，只是「按 E 没反应」；
2. 玩法层单独回滚：服务端跳过 `resolveVents` 调用即可，事件包不再产生，Tick 与移动解算完全不受影响；
3. 完全回滚：把 bit6 的语义换回旧动作即可，因为包长与位布局从未变过。

## 验证

- 单测：`packages/shared-types/src/__tests__/vent.test.ts`（扇形边界）、
  `apps/game-server/src/sim/vent.test.ts`（命中 / 击退 / 硬直 / 限频 / 座位释放）、
  `packages/pixel-assets/src/__tests__/overlay-frames.test.ts`（三帧、速度线、无张嘴帧、不越界）；
- 手工：双开窗口，A 走到 B 面前按 `E` → A 播头槌、B 被推开并躺地 1.5s，两边落点与台词一致；
  空放按 `E` 只有破空音，无报错。
