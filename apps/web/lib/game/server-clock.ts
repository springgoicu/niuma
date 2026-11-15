/**
 * 服务器时钟（ADR-0081）。
 *
 * 铁律：**凡是会影响玩法或「今天」口径的时间，一律用 `serverNow()`**。
 * `Date.now()` 只留给纯本机交互（返回键守卫、重连退避、日志）——玩家的电脑
 * 可能停在去年，也可能在另一个时区，但这些都不该把园区倒计时和工牌日期带歪。
 *
 * 它不碰 `window`，Worker 与主线程各持一份实例：保存「某次对时那一刻的服务器时刻 +
 * 当时的单调时钟读数」，之后只用单调时钟往前走，系统时间被改也不会跳。
 */

const EMA_ALPHA = 0.2;
/**
 * 偏差超过这个值就直接对齐，不再平滑。
 *
 * 秒级 epoch 会被截断成 0–999ms 的余数，所以单个样本天然带 ±500ms 噪声：
 * 阈值放到 1s 以上，平滑才有意义，又能在真的跑偏时立刻纠正。
 */
const SNAP_THRESHOLD_MS = 1000;
/** 半程 RTT 的上限：坏网样本不能把时钟一次性推飞 */
const MAX_HALF_RTT_MS = 2000;

/** 超过这个偏差就算「跳变」：不是网络抖动，而是本机时钟本来就错得离谱 */
const JUMP_NOTIFY_MS = 5000;

let synced = false;
let epochBase = 0;
let monoBase = 0;
let tzOffsetMin = defaultTzOffsetMin();
const jumpListeners = new Set<(jumpMs: number) => void>();

export interface ClockSample {
  /** 服务器秒级 epoch（PONG 尾段原值） */
  serverSec: number;
  /** 往返时延（毫秒），用来把样本往「中点」挪半程 */
  rttMs?: number;
  /** 园区时区偏移（分钟），服务端权威 */
  tzOffsetMin: number;
}

function defaultTzOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-840, Math.min(840, Math.round(value)));
}

/** 单调时钟：优先 `performance.now()`，它不受系统时间调校影响 */
function monoNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * 应用一次对时样本。
 *
 * 服务器只发整秒，所以推算「样本对应的服务器时刻」要补回半秒的截断期望值；
 * 再叠加半程 RTT，把样本从「收到时刻」挪到「发送时刻」。
 */
export function applyClockSample(sample: ClockSample): void {
  if (!Number.isFinite(sample.serverSec) || sample.serverSec <= 0) return;
  const halfRtt = Math.max(0, Math.min(MAX_HALF_RTT_MS, (sample.rttMs ?? 0) / 2));
  const target = sample.serverSec * 1000 + 500 + halfRtt;
  const mono = monoNow();
  if (!synced) {
    epochBase = target;
    monoBase = mono;
    synced = true;
  } else {
    const projected = epochBase + (mono - monoBase);
    const drift = target - projected;
    if (Math.abs(drift) > SNAP_THRESHOLD_MS) {
      epochBase = target;
      // 跳变订阅：按「绝对时刻区间」记账的模块（考勤）必须重设游标，
      // 否则一次 2 小时的时区/时钟纠偏会被记成一整段在岗
      if (Math.abs(drift) > JUMP_NOTIFY_MS) notifyJump(drift);
    } else {
      epochBase = projected + drift * EMA_ALPHA;
    }
    monoBase = mono;
  }
  tzOffsetMin = clampOffset(sample.tzOffsetMin);
}

/** Worker → 主线程的直接注入：只带绝对服务器时刻，没有 RTT 可用 */
export function applyClockEpoch(epochMs: number, offsetMin: number): void {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return;
  const jump = synced ? epochMs - serverNow() : 0;
  if (Math.abs(jump) > JUMP_NOTIFY_MS) notifyJump(jump);
  epochBase = epochMs;
  monoBase = monoNow();
  synced = true;
  tzOffsetMin = clampOffset(offsetMin);
}

/** 当前服务器时刻（毫秒）。没对过时就退回本机时间，至少不会显示成 1970 */
export function serverNow(): number {
  if (!synced) return Date.now();
  return Math.floor(epochBase + (monoNow() - monoBase));
}

/** 园区时区偏移（分钟）：切日与时间戳显示的唯一口径 */
export function serverTzOffsetMin(): number {
  return tzOffsetMin;
}

export function isServerClockSynced(): boolean {
  return synced;
}

/**
 * 订阅「时钟跳变」。回调收到跳变量（正数 = 时间被往前推），只做重设游标用。
 * 返回退订函数，调用方在 dispose 里务必退订，避免热更新时监听器累积。
 */
export function subscribeClockJump(listener: (jumpMs: number) => void): () => void {
  jumpListeners.add(listener);
  return () => {
    jumpListeners.delete(listener);
  };
}

function notifyJump(jumpMs: number): void {
  for (const listener of jumpListeners) {
    try {
      listener(jumpMs);
    } catch {
      // 订阅方自己出错不该拖垮对时链路
    }
  }
}

/** 断线重连 / 换服时清空：下一次样本重新建立基准，避免拿旧偏移继续算 */
export function resetServerClock(): void {
  synced = false;
  epochBase = 0;
  monoBase = 0;
}
