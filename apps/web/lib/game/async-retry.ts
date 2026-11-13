/**
 * 极小的异步重试工具。
 *
 * Worker 与主线程共用：不碰 window / document / localStorage，只用 `setTimeout`。
 * 只服务「冷加载一张贴图失败」这类瞬时故障——次数少、退避短、可取消；
 * 重试耗尽后把最后一个错误原样抛回去，由调用方决定是降级还是报错。
 */

export interface RetryOptions {
  /** 总尝试次数（含首次），小于 1 时按 1 处理 */
  attempts: number;
  /** 第一次重试前的等待时长；之后按 2 的幂递增 */
  baseDelayMs: number;
  /** 退避上限，缺省 4s */
  maxDelayMs?: number;
  /** 抖动比例 0–1：最终等待 = base * (1 ± ratio)，避免同时失败的一批请求同步重试 */
  jitterRatio?: number;
  /** 返回 false 时立即停止重试（例如版本错配、请求被取消） */
  shouldRetry?: (error: unknown, failedAttempt: number) => boolean;
  /** 注入用：单测里替换成同步 resolve，避免真的等定时器 */
  sleep?: (ms: number) => Promise<void>;
  /** 注入用：单测里替换成固定值 */
  random?: () => number;
  /** 每次真正重试前回调一次，便于打 warn 日志 */
  onRetry?: (error: unknown, nextAttempt: number) => void;
}

const DEFAULT_MAX_DELAY_MS = 4_000;

/** 第 `failedAttempt` 次失败后的等待时长（0 表示首次失败） */
export function retryDelayMs(
  failedAttempt: number,
  options: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio' | 'random'>,
): number {
  const base = Math.min(
    options.baseDelayMs * 2 ** Math.max(0, failedAttempt),
    options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
  );
  const ratio = Math.min(Math.max(options.jitterRatio ?? 0, 0), 1);
  const random = options.random ?? Math.random;
  const delta = base * ratio * (random() * 2 - 1);
  return Math.max(0, Math.round(base + delta));
}

export async function withRetry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const failedAttempt = attempt;
      if (attempt + 1 >= attempts) break;
      if (options.shouldRetry && !options.shouldRetry(error, failedAttempt)) break;
      options.onRetry?.(error, attempt + 1);
      await sleep(retryDelayMs(failedAttempt, options));
    }
  }

  throw lastError;
}
