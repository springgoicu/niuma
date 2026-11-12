import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import { runWorkerHost, type WorkerScope } from '../lib/game/runtime/worker-host';
import { loadWorkerFonts } from './font-bootstrap';

/**
 * 游戏渲染线程入口。
 *
 * 执行顺序是有讲究的：
 * 1. `DOMAdapter.set(WebWorkerAdapter)` 必须在任何 `app.init` 之前跑完——Pixi 默认
 *    适配器会去 `document.createElement('canvas')`，Worker 里没有 document；
 * 2. **先挂消息监听再加载字体**：主线程在 `new Worker()` 之后立刻同步
 *    `postMessage(init)`，而 Worker 不会为「此刻尚无监听器」的 message 排队。
 *    旧版等字体加载完才调 `runWorkerHost`，init 早就被事件循环丢弃了——
 *    脚本加载成功、Worker 进程也在，却永远不回任何消息，用户只能等超时回退；
 * 3. 字体并行注册即可：`worker-host` 的 `readFontsReady()` 会等 `fonts.ready`，
 *    引擎真正开始度量文字时字体已经就绪；
 * 4. 之后所有工作由 `runWorkerHost` 接管：它等 `init` 才创建引擎，热重载 /
 *    快速切换页面时不会有半初始化的引擎。
 *
 * 这里不 import 任何 React、`'use client'` 模块或 DOM 组件。
 */
DOMAdapter.set(WebWorkerAdapter);

/**
 * Worker 内的未捕获异常必须主动送回主线程。
 * 外部 `worker.onerror` 在「脚本被 COEP/CSP 拦截」或「模块加载失败」时
 * `message` 常常是空串；这条 fatal 带完整堆栈，供 WorkerGameClient 决定
 * 启动期回退还是运行期报错。
 */
function reportFatal(error: unknown): void {
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
    : String(error);
  (globalThis as unknown as { postMessage(message: unknown): void }).postMessage({ t: 'fatal', detail });
}

globalThis.addEventListener('error', (event: ErrorEvent) => reportFatal(event.error ?? event.message));
globalThis.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportFatal(event.reason));

runWorkerHost(globalThis as unknown as WorkerScope);

// 字体失败只影响昵称 / 状态的字宽，绝不能阻塞入场
void loadWorkerFonts().catch((error: unknown) => {
  console.warn('[worker] 字体注册失败，使用回退度量', error);
});
