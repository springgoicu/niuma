# ADR-0049：OffscreenCanvas + Worker 独立渲染线程

- 状态：已采纳
- 日期：2026-11-12
- 关联：沿用 ADR-0005（像素网格）、ADR-0024（y 分桶与帧循环零分配）、ADR-0025 / ADR-0048（回放延迟与自适应抖动）、ADR-0034（客户端落点快照）、ADR-0043（变化驱动同步包）；修订 README「性能 / 画面」一节对主线程的假设

## 背景

游戏画面、ECS 状态与网络循环原本全部跑在主线程：`GameSession.tick` 由 Pixi 的
`app.ticker` 驱动，同一线程上还有 React 19 的外壳、聊天输入框与输入法。

高刷屏（120Hz / 144Hz / ProMotion）把这个矛盾放大了一倍：帧预算从 16.7ms 变成
8.3ms 甚至 6.9ms，而主线程还要处理 React 提交、输入法组合态、HUD 的 2Hz 更新与
小地图的 4Hz 重绘。任何一个 10ms 级的长任务都会直接掉帧——这正是「边走边打字卡一下」
的来源。

需求是把核心循环搬进 Dedicated Worker：主线程只留外壳 UI、键盘监听与尺寸同步。

## 问题

- **画布只能交出去一次。** `transferControlToOffscreen()` 是一次性操作，画布移交后
  主线程不能再拿它绘制；`reactStrictMode` 的双挂载必须靠「每次会话新建画布」解决。
- **Worker 里没有 `window` / `document` / `localStorage` / `AudioContext`。** 引擎里有
  六类平台访问：灰度开关读 `location.search`、DPR 读 `window.devicePixelRatio`、
  字体等 `document.fonts`、落点写 `localStorage`、发声用 `AudioContext`、
  可见性监听 `document.visibilitychange`。
- **Pixi 默认适配器会找 `document`。** `DOMAdapter` 是模块级单例，默认 `BrowserAdapter`；
  `pixi.js/webworker` 入口**不会**自动替换，必须显式 `DOMAdapter.set(WebWorkerAdapter)`。
- **文本度量依赖字体。** 昵称与状态行用 `JetBrains Mono`，主线程靠 CSS `@font-face`
  加载；Worker 不继承样式表，不注册就会退回 `monospace`，名字宽度全变。
- **每帧 `postMessage` 会抵消收益。** 结构化克隆 + 短命对象在主线程侧仍然是分配，
  GC 抖动正是要消灭的东西。
- **不支持的环境必须还能玩。** Safari 16.4 之前、Firefox 105 之前没有
  `transferControlToOffscreen`。

## 备选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 保持主线程，只做增量优化（拆长任务、降 HUD 频率） | 零风险、改动小 | 8.3ms 预算下 React 提交与输入法仍与渲染同线程竞争，天花板明显 | 否决 |
| B. 只搬渲染循环，ECS / 网络留在主线程 | 画布移交简单 | 状态仍在主线程更新，IPC 每帧来回，等于把复杂度翻倍而收益减半 | 否决 |
| C. 整个引擎进 Worker（采纳） | 主线程彻底不参与帧循环；高刷屏下镜头跟手只受 Worker 帧率限制 | 平台能力要端口化；调试从「一个线程」变成「两个线程」 | 采纳 |
| D. 回退实现保留旧 `GameSession` 副本 | 回退路径改动为零 | 两份实现两次发版后必然腐烂，且回退路径永远得不到验证 | 否决 |
| E. 高频通道用 `postMessage` + `ArrayBuffer` 转移 | 不需要 COOP/COEP | 每次按键/摇杆都要克隆一次，摇杆拖动时每秒几十条消息 | 部分采纳：作为无跨源隔离时的降级通道 |

## 决策

### 1. 线程边界：单一引擎 + 双宿主

引擎（`GameSession` + `GameRenderer` + `Ecs` + `NetClient`）通过 `EngineEnv`
（`apps/web/lib/game/runtime/engine-env.ts`）注入平台能力，自己不再摸全局：

```ts
readonly search: string;            // ?zoom/?flat/?light/?season/?render
readonly canvas: HTMLCanvasElement | OffscreenCanvas;
readonly control: ControlBlock;     // 输入控制块
readViewport(out): boolean;         // 每帧一次，尺寸/DPR 变了才 true
fontsReady(): Promise<void>;
writeSnapshot(patch): void;
emitAudio(event, listenerX, listenerY): void;
```

两个宿主实现同一个 `GameClient` 接口（`lib/game/client/game-client.ts`）：
`WorkerGameClient`（画布移交 + 消息）与 `MainThreadGameClient`（同线程直连）。
按钮、聊天、点选这些调用点完全不区分模式。

### 2. 高频通道：一块定长控制内存

`lib/game/runtime/control-channel.ts` 用一块 `Int32Array`（20 个槽位，80 字节）
承载所有「每帧都要读最新值」的量：

| 槽位 | 内容 |
|---|---|
| keys | 方向键掩码（`KEY_BIT`，可叠加） |
| actionWrite / actionRead / ring[4] | 动作环：坐/躺/挥手/叫唤/跳/互动/咀嚼 |
| touchX / touchY | 摇杆方向，1/1000 定点 |
| viewportW / viewportH / dpr | 视口，DPR 1/100 |
| snapshotSeq / x / y / state | 落点快照，坐标 1/16 像素，`state` 打包 dir/pose/seatId |

- 有跨源隔离时是 `SharedArrayBuffer`，两侧读写同一块内存，**输入零消息**；
- 没有时退化成「每次变更补一条定长消息」，Worker 侧 `apply()` 落进自己的私有块，
  引擎读到的接口完全一致；
- 全部走 `Atomics.load/store`（非共享缓冲区自动退回普通数组访问）。

### 3. 低频消息：只放事件与指令

`lib/game/runtime/worker-protocol.ts` 定义双向判别联合：

- 主 → Worker：`init` / `minimap` / `chat` / `history` / `status` / `appearance` /
  `navigate` / `cancelNav` / `pick` / `inspect` / `retry` / `pause` / `control` / `dispose`
- Worker → 主：`ready` / `status` / `queue` / `rejected` / `stats`(2Hz) / `chat` /
  `history` / `hint` / `localState` / `nav` / `picked` / `badge`(4Hz) / `audio` / `snapshot`

纪律：**每帧都要读的量一律不进消息**；带字符串的只有聊天、状态与提示，且都在事件驱动
路径上。

### 4. 平台能力的落点

| 能力 | 主线程 | Worker |
|---|---|---|
| 灰度开关 | 读 `location.search` 塞进 `init.search` | `new URLSearchParams(search)` |
| DPR | `devicePixelRatio` 写控制块 | 从控制块读 |
| 尺寸 | `ResizeObserver` + `visualViewport` 写控制块 | 每帧 `readViewport` |
| 字体 | `document.fonts.ready` | `workers/font-bootstrap.ts` 注册 `FontFace` 后等 `self.fonts.ready` |
| 落点快照 | 2s + `pagehide` 读控制块写 `localStorage` | 2s 写控制块（`park` 分区留在主线程） |
| 音频 | `runtime/audio-sink.ts` 调 `sfx` | 只发 `audio` 事件（含当时的听者坐标） |
| visibility | `visibilitychange` → `pause` 消息 | `app.ticker.stop()/start()`，socket 与心跳不动 |
| 点选 / 工牌 | 传局部坐标 / 订阅 id | 命中判定与 `badgeOf` 在 Worker，4Hz 推送 |

### 5. 小地图一并移交

`lib/game/minimap-draw.ts` 从 `MiniMap.tsx` 抽出纯绘制，跑 `OffscreenCanvasRenderingContext2D`。
Worker 按 4Hz 重绘地形与玩家点；主线程只留 `<canvas>` 与两个读 stats 的文本标签，
不再每 250ms 做一次全图多边形重绘。

### 6. 生命周期

- **画布**：每次会话由宿主新建 `<canvas>`，`stop()` 时移除。绝不复用已移交的画布。
- **HMR / StrictMode**：`stop()` 里 `worker.terminate()`、断开 `ResizeObserver`、
  摘掉 `resize/visibilitychange/pagehide`、清 2s 落盘定时器；迟到消息由 `stopped` 丢弃。
- **切后台**：停渲染保连接。回前台 `ticker.start()`，`deltaMS` 仍有 50ms 钳制。
- **回退**：`supportsWorkerRendering()` 检测 Worker + OffscreenCanvas +
  `transferControlToOffscreen`，任一缺失走主线程宿主；`?render=main|worker` 可强制。

## 后果

- 主线程在游戏内不再有 Pixi ticker、不再有 4Hz 小地图重绘、不再有 1–4Hz 的 ECS 轮询；
  React 只按 2Hz 的 stats 与事件消息更新。
- 调试变成两个线程：Worker 的异常不会出现在主线程调用栈里，`worker.onerror` 只给
  一条状态；排查渲染问题用 `?render=main` 对照。
- 跨源隔离（COOP/COEP）只加在 `next.config.ts`：**nginx 不要重复 `add_header`**，
  重复的同名头会被浏览器判非法，`crossOriginIsolated` 反而变 false。
- 输入法语义仍在主线程（`isComposing` / `keyCode 229` 只有 DOM 事件里能看到）。
- 音频与落盘仍在主线程：`AudioContext` 与 `localStorage` 都不在 Worker 的可用面里。

## 基线

```text
BASELINE | apps/web/lib/game/session.ts | expected: 应用层编排，平台能力靠注入 | observed: 只依赖 EngineEnv（search/canvas/control/viewport/fonts/snapshot/audio），tick 内读控制块 | fit: align | suggestion: 保持，不再新增全局访问
BASELINE | apps/web/lib/game/renderer.ts | expected: 渲染实现，只认传入的画布与尺寸 | observed: init(RendererInit) 接收 canvas/size/dpr/search，resize() 只在真变化时重建 | fit: align | suggestion: 无
BASELINE | apps/web/lib/game/runtime/control-channel.ts | expected: 高频通道单一实现，两条传输行为一致 | observed: ControlBlock 20 槽位、动作环容量 4、SAB 与定长消息两条路径共用读写 | fit: align | violations: [] | suggestion: 加槽位时同步更新 CONTROL_SLOTS 与单测
BASELINE | apps/web/components/game/MiniMap.tsx | expected: 展示组件只读 store | observed: 仅一块 canvas 与两个 stats 文本 | fit: align | suggestion: 无
BASELINE | apps/web/components/game/InspectCard.tsx | expected: 订阅式取数，不轮询 | observed: subscribeBadge(playerId) 4Hz 推送，卸载退订 | fit: align | suggestion: 无
```

## 复核信号

- 主线程 Performance 录制（120Hz 或 CPU 6x 降速）出现 >8ms 长任务 → 检查是否有
  新的主线程绘制/轮询被加回来。
- `?render=main` 与默认模式的画面出现差异（遮挡、飘雪、柔光、气泡、小地图）→
  说明有渲染状态漏进了宿主分支。
- 连续保存触发的 HMR 后 `chrome://workers` 里出现多个 `niuma-game` → 宿主清理漏项。
- 切后台 10s 再回前台出现重连横幅 → 说明 `pause` 把 socket 也停了。
- `crossOriginIsolated` 为 false 但预期为 true → 检查响应头是否被重复添加。

## 回滚路径

1. `?render=main` 立即把某个会话切回主线程宿主（同一份引擎，功能一致）。
2. 30 天内删除 `workers/`、`lib/game/client/worker-client.ts`、`next.config.ts` 的
   `headers()`，并把 `createGameClient()` 直接换成 `MainThreadGameClient`：
   `EngineEnv` 端口保留，行为零差异。
