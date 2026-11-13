'use client';

/**
 * 「存到桌面」的浏览器能力封装：模块级单例，不持有 React 状态。
 *
 * 三个事实决定了这里的形状：
 * 1. 网页不能凭空创建桌面快捷方式，只能消费 Chromium 的 `beforeinstallprompt`；
 *    该事件在模块求值时就要开始监听，晚一步就再也拿不到（Chrome 只发一次）。
 * 2. `prompt()` 必须由用户手势触发，而且一个事件只能消费一次，消费后立刻清空。
 * 3. Safari / Firefox 没有这个事件，此时只剩「引导用户手动添加」，由 UI 层负责。
 *
 * 所有失败都静默降级：SW 注册不上、剪贴板被拒、安装弹窗被拦都不阻断进园
 * （与 `useImmersiveStage` 的处理一致）。
 */

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** `beforeinstallprompt` 至今不在 lib.dom 里，按规范自己声明最小形状 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

export interface InstallState {
  /** 浏览器已给出可安装信号：点按钮能弹原生安装框 */
  canPrompt: boolean;
  /** 已经在独立窗口里运行（或本次会话刚装完） */
  installed: boolean;
}

/** 与 `next.config.ts` 的 COOP/COEP 同源，public 根目录下的直通脚本 */
const SW_PATH = '/sw.js';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = detectStandalone();
let bound = false;
/** SW 只注册一次：根级引导与 /play 的 PlayShell 都会调用 initInstallPrompt() */
let swStarted = false;
/** 原生安装框正在显示：连点不应再弹第二次 */
let prompting = false;
const listeners = new Set<() => void>();

/** 独立窗口 / iOS 主屏：两种来源，iOS 只有 `navigator.standalone` */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** 只挂一次；模块求值时调用，保证不早于事件丢失 */
function bind(): void {
  if (bound || typeof window === 'undefined') return;
  bound = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // 不 preventDefault 的话 Chrome 会自己弹横幅，之后就拿不到这个事件了
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** `/play?sw=0` 是回滚开关，与 `?flat=1` / `?render=main` 同一思路 */
function swDisabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('sw') === '0';
  } catch {
    return false;
  }
}

async function unregisterServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // 反注册失败不影响进园，下一次带参数访问还会再试
  }
}

/**
 * 接管安装链路：根布局的 `InstallBoot` 在首屏调用，`PlayShell` 进园区时再调一次
 * （幂等，同时负责 `?sw=0` 回滚）。先把监听挂好再注册 SW：首次访问装好 SW 后，
 * 浏览器下一轮导航才会给出安装信号。
 */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  bind();

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  // 回滚开关必须在每次进入时都生效，不能被下面的「只注册一次」跳过
  if (swDisabled()) {
    void unregisterServiceWorkers();
    return;
  }
  // 根布局的 InstallBoot 与 PlayShell 各调一次：注册只做一次，避免重复触发
  if (swStarted) return;
  swStarted = true;

  navigator.serviceWorker
    .register(SW_PATH, { scope: '/' })
    .catch(() => undefined);
}

export function getInstallState(): InstallState {
  return { canPrompt: deferred !== null, installed };
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 弹原生安装框。
 *
 * 事件是一次性的，但「弹了」和「用掉了」不是一回事：只有用户真的做出选择
 * （接受 / 取消）才算消费；`prompt()` 抛错（手势失效、安装准备未完成）时
 * 必须把事件放回去，否则这一次失败会让整场会话的安装入口永久失效。
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event || prompting) return 'unavailable';
  prompting = true;

  try {
    await event.prompt();
    const choice = await event.userChoice;
    deferred = null;
    if (choice.outcome === 'accepted') installed = true;
    emit();
    return choice.outcome;
  } catch {
    // 事件仍在 deferred 里：用户可以再点一次
    emit();
    return 'unavailable';
  } finally {
    prompting = false;
  }
}

/** 复制当前园区链接：保留 `?park=` 等参数，只去掉锚点 */
export async function copyPageLink(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const text = window.location.href.replace(/#.*$/, '');

  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 接口不可用：落到下面的 execCommand
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(area);
  return copied;
}

// 客户端 bundle 求值时就挂上：`beforeinstallprompt` 只发一次，等 effect 可能已经晚了
bind();
