# ADR-0076：擂台打到冠军即开奖，颁奖可提前离场

- 状态：已采纳
- 日期：2026-11-13
- 关联：替代 ADR-0073 第 3 节「严格 120 秒」与备选方案「KO 即结束比赛」的放弃结论；
  颁奖窗口时长同步取代 ADR-0075 中「颁奖 9 秒」的描述；擂台本身沿用 ADR-0073，
  奖牌入账沿用 ADR-0073 的本地考勤，零持久化沿用 ADR-0004

## 背景

ADR-0073 把 `running` 的终点写死为「第 2 人入场 + `RING_ROUND_MS`」，血量归零只标
淘汰、不结束比赛。实际玩下来问题很明确：三人局里把另外两人都打到 0 血之后，冠军
其实已经产生，但场上还要空等最多两分钟——倒计时继续走，HUD 一直显示「计分中」，
玩家只能站在围绳里干等；随后还有 9 秒颁奖，一局最长 129 秒，而真正的有效对抗
通常不到 30 秒。

当初的取舍是把「苟活到最后一秒」与「提前打光对手」当成两种可选策略。但伤害是
恒定的（`RING_DAMAGE = 1`、`RING_MAX_HP = 10`），打光一个对手要 10 次命中，本身
已经比站着不动更费力，固定时长没有换来策略多样性，只换来等待。

## 决策

### 1. 120 秒降级为本局上限，站着的只剩 1 人即刻结算

`RingRuntime.tick()` 的 `running` 分支把「到点」扩成「到点 或 `isDecided()`」，
仍然只调用唯一的 `settle()`：

```ts
if (this.phase === RING_PHASE.Running && (now >= this.phaseEndsAt || this.isDecided())) {
  this.settle(now, world);
  changed = true;
}
```

`isDecided()` = 名单 ≥ 2 人且站立 ≤ 1 人；每 Tick 扫最多 3 个成员、零分配，不需要
新增字段。

判定放在 `tick` 而不是 `applyHit`：`server.ts` 先跑 `ring.tick`、再跑 `resolveVents`，
在 `applyHit` 里结算会让本拍的 `moved` 不被消费，空间索引与视野刷新要等下一拍，
广播最坏退化成 1Hz 心跳。放 `tick` 只多 50ms，且保住「结算只有一条路径」。

### 2. 断线不算分出胜负

名单 ≥ 2 是硬条件：`removePlayer` 清掉断线者后名单就是 1，不触发提前结算，仍走完
计时。这样「对手掉线」不会白送一个冠军，断线与淘汰在状态机上保持可区分。

### 3. 颁奖窗口 9 秒 → 4 秒，参赛者可提前离场

`RING_AWARD_MS = 4_000`；`leave()` 从「仅 `waiting`」扩到「`waiting` 或 `award`」，
复用既有 `C2S_RING_LEAVE` 与 `teleport(RING_EXIT)`，不新增 opcode、不新增字段：

- 颁奖期离场即从 `members` 移除，`isFrozen` / `snapshot` / `finishAward` 三个消费方
  沿用原分支，不需要给协议加 `left` 标志；
- 奖牌在颁奖首包就按 `matchId` 幂等入账（客户端本地考勤），移除成员不回滚；
- 全员离场立即回 `idle` 并把 `phaseEndsAt` 归零，报名随即重新开放；只要台上还有
  人，`phase` 保持 `award`，围观者继续看到「颁奖中，稍后再来」；
- 客户端：`ringHint()` 在参赛者 `award` 时返回「[F] 领奖离场」，`interactRing()` 直接
  发 `C2S_RING_LEAVE`；`perform()` 的颁奖冻结分支排在硬直门之前，且只放行 `interact`
  ——被淘汰者的 `stunUntil` 还停在本局剩余时间上，顺序写反就会出现「提示写着能走、
  按下去没反应」。

### 4. 表现层跟着 4 秒重排

彩带生成 3.6s / 存活 6.2s 是按 9 秒窗口排的，窗口砍半后会在中途被 `resetAward()`
硬切。改为生成 2.2s、存活 1.8s、下落 70–120px/s，并在窗口最后 240ms 让
`overlayRoot.alpha` 整体淡出；`resetAward()` 把 alpha 复位成 1，下一局不会从半透明
开始。领奖台升起仍是 600ms、奖杯浮动周期不变，垫面文案改为「10 血 · 三人为限 ·
打完即开奖」。

## 备选方案（未采纳）

- **必须全部倒下才提前结算**：三人局里「只剩 1 人站立」与「其他人都 0 血」等价，
  多写一个条件只会让两处判定漂移；
- **断线剩 1 人也提前结算**：等于把冠军白送给没掉线的人，与「这局还没打完」的观感
  冲突；
- **`applyHit` 里直接结算**：要自己补网格刷新、视野刷新与广播，等于复制一条状态机
  出口；
- **颁奖窗口归零、结算即传回出口**：领奖台、奖杯与彩带至少要 3 秒才读得懂；
- **给协议加 `left` 标志保留席位**：多一个字段、多一处兼容分支，只为在颁奖板上留住
  已经离场的人，收益不足。

## 后果

- 收益：一局时长由对抗进度决定，最快十几秒就能开奖；颁奖期想去逛园区随时可走；
  状态机仍然只有 `settle / finishAward` 两个出口。
- 代价：`isDecided()` 每 Tick 一次 O(3) 扫描；`RING_AWARD_MS` 与表现层常量绑得更紧，
  以后调窗口要同步改彩带节奏；旧客户端不升级仍可玩（只是看不到「领奖离场」）。
- 回滚：`tick` 条件还原成 `now >= this.phaseEndsAt`、`leave()` 收回到仅 `waiting`、
  `RING_AWARD_MS` 改回 9_000 三步，协议与存档零改动。

## Baselines

- `CODEBASELINE | 擂台结算触发 | expected: 冠军已定就结算 | observed: 只在 120 秒到点时结算 | fit: drift → align`
- `CODEBASELINE | 颁奖窗口 | expected: 只占表现所需的最短时长且可跳过 | observed: 固定 9 秒不可离场 | fit: drift → align`
- `CODEBASELINE | 颁奖期离场 | expected: 奖牌入账后可离开 | observed: 只能站满窗口被统一传送 | fit: drift → align`

## 测试

- `sim/ring.test.ts`：打空最后一个对手后下一拍即 `award`（`endsAt = settledAt + RING_AWARD_MS`）；
  三人局先倒一人仍 `running`；颁奖期 `leave` 生效并送回出口、全员离场回 `idle`；
  断线剩 1 人仍走完计时；
- `hint-copy.test.ts`：「领奖离场」映射到 `interact / F`，桌面文案带键帽、触屏说法带按钮名；
- `ring-status.test.ts`：阶段文案与倒计时口径不随窗口长度变化。
