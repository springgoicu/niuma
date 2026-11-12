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

void loadWorkerFonts().then(() => {
  runWorkerHost(globalThis as unknown as WorkerScope);
});
