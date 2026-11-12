# ADR-0048：2D 空间音效与自适应回放缓冲

- 状态：已采纳
- 日期：2026-11-12
- 关联：修订 ADR-0023 §4（音效节点生命周期）与 ADR-0025（固定 80ms 回放）；沿用 ADR-0018（叠加动作位）、ADR-0043（去脏同步，决定抖动取样方式）

## 背景

三件事同时到了需要处理的程度：

1. 叫唤仍是单声道贴脸：附近玩家按 E 与设施互动都只有一个音量，没有左右与远近。需求要求以本地玩家为听者原点，800px 外静音。
2. 现有 `sfx.ts` 每发一声都 `createOscillator` / `createGain` / `disconnect`，节点生命周期跟着声音走。播放路径不允许再这样分配。
3. 远端回放写死 80ms（ADR-0025）：好网下明显滞后，弱网下又会插值饥饿。ADR-0025 的复核信号已经写明「先量包间隔分布，再调延迟」——本次把它换成运行时自适应。

另外新增「吃草咀嚼（G）」：无音频资源、无图集帧，需要让附近玩家也能听到方位。

## 决策

### 1. 空间声场：纯函数 + 固定 Voice 池

- `lib/game/spatial-audio.ts` 只做标量数学：`panFor(dx) = clamp(dx / 400, -1, 1)`；`attenuationFor` 在 40px 内为 1，40~800px 按 `(1 - (d-40)/760)²` 衰减，800px 外为 0。边界处连续归零，不会「关掉时啪一声」。
- `sfx.ts` 首次手势时一次建好 AudioContext、master 与 **6 路 Voice**。每路预建 3 个振荡器（body / sub / LFO）、2 个幅度 Gain、1 个 BiquadFilter、1 个包络 Gain、1 个 StereoPanner；振荡器只 `start()` 一次，之后靠包络门控。播放时只写 AudioParam 与标量字段，忙时抢占最早结束的 Voice。
- `StereoPannerNode` 不存在时（Safari 14.1 之前）降级为纯距离衰减，不阻塞发声。
- 接入：本地 E（自己坐标）、远端 E（`Motion.emote` 0→1 上升沿 + 实时采样坐标）、F（设施坐标）、G（本地 + 服务端事件）。听者坐标由 session 每帧写两个标量。

### 2. 咀嚼走一次性事件通道，不新增 state 位

state 字节已经占满：bit0-1 朝向、bit2-3 姿态、bit4 wave、bit5 moving、bit6 emote、bit7 jump；紧凑同步条目正好 48 bit（ADR-0043），加第 9 位必须升同步格式并让每个实体多占字节。为一个 500ms 的短音效付这个代价不划算。

- `ACTION.Graze = 3` 复用现有 `C2S_ACTION`；新增 `S2C_GRAZE = 0x20`，包体 `[op][entityId u16]`。
- 服务端按 `GRAZE_COOLDOWN_MS = 500` 限频，写 `Player.lastGrazeAt`，只向 `player.known`（看得见发声者的人）广播，不回发自己。
- 客户端收到后按该实体当前插值位置调用 `chewRemote`；本地按键同时发声、冒气泡、发包。
- 兼容：旧服务端忽略未知 action，退化为仅本地发声；旧客户端对 0x20 走 default 静默忽略。

### 3. 自适应抖动缓冲

- `lib/game/jitter.ts` 用同步包头的 **tick** 计算传输偏移：`offset = arrival - tick × TICK_MS`，抖动是相邻 `offset` 差值的 EWMA（α=1/8，单样本突变夹到 200ms）。
  - 不用「到达间隔减 50ms」：ADR-0043 去脏后，满屋子人坐着时整 Tick 不发包，间隔会被误判成几百毫秒抖动。
- RTT 走 4ms 桶直方图 + 24 样本环，O(256) 扫出 p95；`target = clamp(RTT_p95 × 0.5 + 2 × Jitter, 35, 120)`。
- `delayMs` 每包 EMA 平滑：上升 α=0.35、下降 α=0.03，初值 55ms（覆盖一个 Tick）。
- `interp.ts` 深度 4 → 6（250ms 历史，覆盖 120ms 上限 + 抖动突发）。越过最新帧时允许 **最多 25ms** 的速度外推；上一段速度超过 320px/s（座位吸附 / 传送）则直接钳位。
- `net/client.ts` 的 ping 从 2s 改为 1s，并在连接建立时立即发一次，让 p95 在 20s 内收敛。

### 4. 落点分层

| 层 | 文件 | 职责 |
|---|---|---|
| 纯策略 | `spatial-audio.ts` / `jitter.ts` | 声像、衰减、延迟标量；不碰 Web Audio 与 DOM |
| 适配器 | `sfx.ts` | Voice 池与振荡器合成；只被 session / HUD 调用 |
| 契约 | `shared-types`（`ACTION.Graze` / `S2C_GRAZE` / `readSyncTick`） | 双端唯一事实来源 |
| 服务端 | `server.ts` / `world.ts` | 鉴权、限频、按视野定向广播 |
| 编排 | `session.ts` | 传坐标、喂 tick/RTT、读 `delayMs`；不实现音效与时序算法 |

## 备选方案

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 保留每声新建节点（现状） | 实现简单 | 每次触发都产生节点 churn；无法满足「播放路径零分配」 | 低 |
| B. 固定 6 路 Voice 池（采纳） | 触发时只写参数；节点数恒定、可预测 | 18 个振荡器常驻，空闲时仍有极小 CPU | 低 |
| C. 咀嚼加 state 第 9 位 | 与叫唤同一条通路 | state 已满，需升同步格式、每实体多 1 字节，影响 ADR-0043 的带宽结论 | 中高 |
| D. 咀嚼走一次性事件（采纳） | 不动 48 bit 热路径；天然是一次动作，无远端过期状态 | 其他人只闻其声、无姿态 | 低 |
| E. 固定 80ms（现状） | 零适配成本 | 好网滞后；弱网照样饥饿 | 低 |
| F. 严格 35ms、不外推 | 完全贴公式 | 20Hz 下约 70% 帧越过最新快照，退化成 20Hz 阶梯 | 低 |
| G. 下限抬到 55ms | 始终可插值、不过冲 | 好网做不到 35~40ms，偏离需求 | 低 |
| H. 服务端 Tick 提到 30Hz | 35ms 天然可插值 | 带宽约 +50%，与 ADR-0043 刚完成的省流量方向冲突 | 中 |
| I. 35ms + 25ms 微外推（采纳） | 低延迟段仍连续；异常速度直接钳位 | 方向突变时最多约 4px 回弹 | 低 |

## 后果

- 正面：附近玩家叫唤、咀嚼、设施互动都有左右与远近；远端行走在好网下从 80ms 压到 35~40ms，在弱网下自动拉长而不是瞬移；同步条目大小与协议主路径完全没变。
- 负面：
  - 18 个振荡器常驻。用极小 CPU 换「触发零节点创建」，移动端长时间挂机时会有轻微耗电；若实测不可接受，可缩池到 4 路（触发前先做距离剔除，并发很少）。
  - 35ms 段依赖微外推，方向突变时最多约 4px 回弹；超过 320px/s 视为传送，不外推。
  - 远端咀嚼只有声音，没有姿态与动画；本地有气泡。
  - 延迟随网络变化，虽然 EMA 限制了变化速率，但同一名远端玩家的「跟手程度」会随时间轻微变化。
- 回滚成本：低。
  - 音频：`sfx.ts` 可整体退回单声道实现，调用方只改回 `emit(species)`。
  - 缓冲：把 `JitterBuffer.delayMs` 固定为 55~80 即可退回固定延迟；`interp.ts` 的外推分支可删。
  - 协议：服务端停止广播 `S2C_GRAZE` 即退回本地音效；旧客户端本来就不认识 0x20。

## 复核信号

- 「左边的人听起来在右边」：先查 `setListener` 是否在 tick 里写的是本地玩家坐标，再查 `panFor` 的符号（声源 X − 听者 X）。
- 「800px 外还能听到」：查 `attenuationFor` 是否在触发前短路，以及远端位置是否用了渲染前坐标。
- 「咀嚼被刷屏 / 服务端 CPU 抖」：查 `GRAZE_COOLDOWN_MS` 是否只做了客户端节流；服务端必须独立限频。
- 「好网还是一顿一顿」：先量 `jitter.delayMs`，若长期在 35ms，检查微外推是否被 320px/s 上限挡住；若长期在 120ms，检查 tick 偏移是否被重连重置。
- 「延迟降不下来」：p95 窗口是 24 个样本 × 1s；确认 ping 为 1s 且服务端仍在 `dispatch` 里即时回 PONG。
- 「声音越来越多 / 越玩越卡」：Voice 数应恒为 6；若 `voices.length` 增长，说明有人在播放路径新建了节点。

## 架构基线

```text
BASELINE | apps/web/lib/game/sfx.ts | expected: 副作用适配器，只被编排层调用，不持有游戏状态 | observed: 单例 Voice 池 + 空间参数，触发路径无 new/字面量/数组 | fit: align | patterns: [G-Adapter] | violations: [] | suggestion: 需要新音色时只加 Voice 配置，不引音频资源
BASELINE | apps/web/lib/game/jitter.ts + interp.ts | expected: 时序策略与采样分离，纯计算可单测 | observed: JitterBuffer 只产出延迟标量；RemoteTrack 只做插值与有上限外推 | fit: align | patterns: [G-Strategy] | violations: [] | suggestion: 调参只改常量，不把网络判断塞进插值循环
BASELINE | packages/shared-types + apps/game-server | expected: 契约在 shared-types，服务端只做限频与按视野广播 | observed: ACTION.Graze 复用 C2S_ACTION；S2C_GRAZE 为 3 字节单向事件，500ms 限频，player.known 定投 | fit: align | patterns: [P-Adapter] | violations: [] | suggestion: 若将来需要远端咀嚼姿态，再评估同步格式版本，不原地扩 state
BASELINE | apps/web/lib/game/session.ts | expected: 编排层，不实现音效与时序算法 | observed: 只写听者坐标、喂 tick/RTT、读 delayMs；动作分发沿用 resolveInteraction | fit: align | patterns: [] | violations: [] | suggestion: Worker 迁移完成后，把 input/jitter 的读取一并搬过去，保持协议不变
```
