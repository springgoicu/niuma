/**
 * 渲染模式与后端判定。
 *
 * 能力检测只看三件事：Worker、OffscreenCanvas、`transferControlToOffscreen`。
 * 三者缺一就退回主线程——同一个 `GameSession`，只是宿主不同。
 *
 * 灰度开关：
 * - `?render=main` 强制主线程（线上定位渲染线程回归、以及对照性能）
 * - `?render=worker` 强制渲染线程（不支持时自动回退并打一条警告）
 * - `?gpu=webgpu` 强制 WebGPU（默认 WebGL2，见 ADR-0071）
 */
import { allowReloadForVersion } from '../../build-version';
import { browserStorage, type StorageLike } from '../../storage';

export type RenderMode = 'worker' | 'main';

/** 渲染后端：默认 WebGL2，WebGPU 只作为灰度开关保留（ADR-0071） */
export type GpuPreference = 'webgl' | 'webgpu';

/**
 * 后端解析：`?gpu=` 显式值 > 宿主注入 > 默认 `webgl`。
 *
 * 默认从 WebGPU 换成 WebGL2 是稳定性决定，不是性能妥协（ADR-0071）：
 * Chromium 的 `copyExternalImageToTexture()` 在上传画布快照失败时抛
 * `TypeError: Failed to copy content from external image.`，而 Pixi 的文字纹理
 * 正好走这条路径（`CanvasPool` 画布 → GPU 上传）；异常从帧循环里逃出来，
 * 整个渲染线程就被判成 fatal。WebGL2 用 `texImage2D` 直接吃画布，
 * 这条失败路径不存在，Android 上还省掉一次 CPU 回读 + mapped buffer。
 */
export function resolveGpuPreference(search: string, override?: GpuPreference): GpuPreference {
  const requested = new URLSearchParams(search).get('gpu');
  if (requested === 'webgpu') return 'webgpu';
  if (requested === 'webgl') return 'webgl';
  return override ?? 'webgl';
}

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

/**
 * 渲染线程这一路彻底不可用时打标记：本次标签页会话内不再重试 Worker。
 *
 * 注意这**不是**「GPU 后端挑错了」的意思：单次 WebGPU 上传失败先走
 * `reloadForRenderFatal()` 把后端换成 WebGL2，只有连受控重载都被守卫拦下
 * （说明 WebGL2 也崩、或环境根本起不来 Worker）才记这一笔，否则重载之后
 * 会白白掉到主线程渲染，性能反而更差。
 *
 * Worker 脚本被 COEP/CSP 拦掉时刷新仍会走同一条失败路径，用户会陷入
 * 「刷新 → 又崩 → 再刷新」；自动回退主线程后记一笔，之后直接走 main；
 * `?render=worker` 仍可强制重试（排查完想验证 Worker 是否恢复时用）。
 */
const FALLBACK_KEY = 'niuma:render-fallback';

export function markRenderFallback(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(FALLBACK_KEY, '1');
  } catch {
    // 隐私模式 / 存储被禁用：不影响本次会话内已经完成的回退
  }
}

/**
 * 玩家点「切回渲染线程」时清掉回退标记。
 *
 * 只清标记、不改地址：下一次 `pickRenderMode` 会重新探测能力并尝试 Worker。
 * 若环境本身起不来 Worker，会再回退一次并重新记上标记（HUD 角标回来），
 * 不会形成「强制 → 崩 → 再强制」的刷新打转。
 */
export function clearRenderFallback(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(FALLBACK_KEY);
  } catch {
    // 存储被禁用：地址上没有 `render=main` 时仍走能力探测，重试同样有效
  }
}

function renderFallbackMarked(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(FALLBACK_KEY) === '1';
  } catch {
    return false;
  }
}

export function pickRenderMode(search: string): RenderMode {
  const requested = new URLSearchParams(search).get('render');
  if (requested === 'main') return 'main';
  if (requested === 'worker') {
    if (!supportsWorkerRendering()) {
      console.warn('[game] 当前环境不支持 OffscreenCanvas，已回退主线程渲染');
      return 'main';
    }
    return 'worker';
  }
  if (renderFallbackMarked()) return 'main';
  return supportsWorkerRendering() ? 'worker' : 'main';
}

/** 渲染线程崩溃后受控重载用的 pseudo id：只作守卫键，不参与版本比较 */
export const RENDER_FATAL_RELOAD_ID = 'render-fatal';

/** 重载只需要替换地址：测试注入 `location` 用 */
export interface ReloadLocation {
  href: string;
  replace(url: string): void;
}

export interface RenderFatalReloadOptions {
  /** 测试注入；缺省读 `globalThis.location` */
  location?: ReloadLocation | null;
  /** 测试注入；缺省读 sessionStorage */
  storage?: StorageLike | null;
}

/**
 * 崩溃重载地址：把后端显式钉到 `webgl`。
 *
 * 不能用 `?gpu=webgpu` 的原地址原地刷新——那会再走一遍刚崩掉的上传路径，
 * 把玩家卡在「刷新 → 又崩」里。其余查询参数（园区、缩放、灰度）原样保留。
 */
export function renderFatalUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('gpu', 'webgl');
  return url.toString();
}

/**
 * 重试地址：只把 `render` 参数去掉，交回能力探测。
 *
 * 不钉 `?render=worker`：那个参数会永远盖过回退标记，Worker 再次崩掉时
 * 用户会被困在「刷新 → 又崩」里。清参数 + 清标记，这次重试只发生一次。
 */
export function retryRenderUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('render');
  return url.toString();
}

/**
 * 渲染线程 fatal 后的受控重载。
 *
 * 玩家侧不该只看到「黑屏 + 请手动刷新」：带着 `gpu=webgl` 重新走一遍已经
 * 验证过的启动链路，落点由主线程每 2s 写盘的快照恢复。守卫与素材换图同一套
 * （`allowReloadForVersion`）：同一次标签页会话只放行一次、10s 冷却，
 * 不会把页面刷成永动机。
 *
 * 返回是否真的发起了重载；false 表示被守卫拦下或当前环境没有 location，
 * 调用方这时才该退回主线程渲染。
 */
export function reloadForRenderFatal(
  now: number = Date.now(),
  options: RenderFatalReloadOptions = {},
): boolean {
  const location =
    options.location !== undefined
      ? options.location
      : (globalThis as { location?: ReloadLocation }).location;
  if (!location) return false;

  let current: URL;
  try {
    current = new URL(location.href);
  } catch {
    return false;
  }
  // 地址上已经钉着 webgl 还崩：换后端这招已经用过了，再刷一遍只是原地打转。
  // 这条判断不依赖 sessionStorage，隐私模式下存储被禁也拦得住。
  if (current.searchParams.get('gpu') === 'webgl') return false;

  const storage = options.storage !== undefined ? options.storage : browserStorage('session');
  if (!allowReloadForVersion(storage, RENDER_FATAL_RELOAD_ID, now, undefined, 1)) return false;
  location.replace(renderFatalUrl(location.href));
  return true;
}
