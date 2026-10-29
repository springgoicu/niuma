# ADR-0001：用 Bun.serve 承载 WebSocket，而不是外挂 uWebSockets.js

- 状态：已采纳
- 日期：2026-10-28

## 背景

需求要求「Bun 原生服务器，底层集成 C++ uWebSockets，零开销长连接」，并禁止 Tick 路径上的 JSON。

## 决策

直接使用 `Bun.serve({ fetch, websocket })`：

- Bun 官方文档明确其服务端 WebSocket 实现建立在 uWebSockets 之上，并自带 `publish`/`subscribe`；
- 二进制帧直接以 `Uint8Array` 进出，无序列化中间层；
- 通过 `Transport` 端口（`send(wsId, Uint8Array)`）隔离传输，未来换节点分片只替换适配器。

不引入 `uWebSockets.js` 原生插件：它是 Node 原生扩展，在 Bun 下需要 ABI 兼容层，
既拿不到性能收益，又增加部署与调试成本。

## 后果

- 正面：零额外依赖、单进程可跑、连接吞吐由 Bun 运行时保证。
- 负面：无法直接使用 uWS 的高级特性（如 HTTP/3）；单进程即单点，水平扩展需要自建网关。
- 回滚成本：低。传输只通过 `Transport` 接口暴露，替换实现不影响 Tick 与协议层。

## 复核信号

单机同时在线超过 5k，或 Tick p95 超过 8ms 且瓶颈确认在 socket 层时，再评估分片与专用网关。
