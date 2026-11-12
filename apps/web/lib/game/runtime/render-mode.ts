/**
 * 渲染模式判定。
 *
 * 能力检测只看三件事：Worker、OffscreenCanvas、`transferControlToOffscreen`。
 * 三者缺一就退回主线程——同一个 `GameSession`，只是宿主不同。
 *
 * 灰度开关：
 * - `?render=main` 强制主线程（线上定位渲染线程回归、以及对照性能）
 * - `?render=worker` 强制渲染线程（不支持时自动回退并打一条警告）
 */
export type RenderMode = 'worker' | 'main';

/** 浏览器是否具备把画布交给 Worker 的全部能力 */
export function supportsWorkerRendering(): boolean {
  if (typeof Worker === 'undefined') return false;
  if (typeof OffscreenCanvas === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  return typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

/** 控制块的零拷贝通道是否可用（决定输入走共享内存还是定长消息） */
export function isSharedMemoryAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
}

export function pickRenderMode(search: string): RenderMode {
  const requested = new URLSearchParams(search).get('render');
  if (requested === 'main') return 'main';
  if (requested === 'worker' && !supportsWorkerRendering()) {
    console.warn('[game] 当前环境不支持 OffscreenCanvas，已回退主线程渲染');
    return 'main';
  }
  return supportsWorkerRendering() ? 'worker' : 'main';
}
