import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import { runWorkerHost, type WorkerScope } from '../lib/game/runtime/worker-host';
import { loadWorkerFonts } from './font-bootstrap';

/**
 * 游戏渲染线程入口。
 *
 * 执行顺序是有讲究的：
 * 1. `DOMAdapter.set(WebWorkerAdapter)` 必须在任何 `app.init` 之前跑完——Pixi 默认
 *    适配器会去 `document.createElement('canvas')`，Worker 里没有 document；
 * 2. 字体注册完再挂消息监听，保证 `init` 到来时文字度量已经可用；
 * 3. 之后所有工作由 `runWorkerHost` 接管：它等 `init` 消息才真正创建引擎，
 *    所以热重载 / 快速切换页面时不会有半初始化的引擎。
 *
 * 这里不 import 任何 React、`'use client'` 模块或 DOM 组件。
 */
DOMAdapter.set(WebWorkerAdapter);

/**
 * Worker 内的未捕获异常必须主动送回主线程。
 *
 * 外部 `worker.onerror` 在「脚本被 COEP/CSP 拦截」或「模块加载失败」时
 * `message` 常常是空串，`filename/lineno` 也不可用；只靠它既定位不了问题，
 * 也拿不到触发自动回退的可靠信号。这条 fatal 消息带完整堆栈，由
 * `WorkerGameClient` 统一决定是启动期回退还是运行期报错。
 */
function reportFatal(error: unknown): void {
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
    : String(error);
  (globalThis as unknown as { postMessage(message: unknown): void }).postMessage({ t: 'fatal', detail });
}

globalThis.addEventListener('error', (event: ErrorEvent) => reportFatal(event.error ?? event.message));
globalThis.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportFatal(event.reason));

void loadWorkerFonts()
  .then(() => {
    runWorkerHost(globalThis as unknown as WorkerScope);
  })
  .catch(reportFatal);
