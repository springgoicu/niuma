'use client';

import { parseParkHealth, resolvePark, toHealthUrl, type ParkEntry, type ParkHealth } from './park';

/**
 * 园区探活。
 *
 * 走各服自己的 `/health`（服务端已带上 `access-control-allow-origin: *`），
 * 一次请求同时拿到在线人数与「浏览器 → 该园区」的真实往返时间：
 * 由服务端代理测出来的是 A → B 的延迟，跟玩家的实际感受不是一回事。
 *
 * 探活失败一律归成 null（超时 / DNS / TLS / 证书 / CORS 都算不可达），
 * 因为选园页只需要一个二元判断；具体原因进 console，不往界面上抛。
 */

/** 单服超时：小机器 TLS 握手偏慢，1.2s 已经足够宽容 */
const PROBE_TIMEOUT_MS = 1200;

export async function probePark(park: ParkEntry, signal?: AbortSignal): Promise<ParkHealth | null> {
  if (typeof window === 'undefined') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const abortOuter = () => controller.abort();
  signal?.addEventListener('abort', abortOuter);
  if (signal?.aborted) controller.abort();

  const startedAt = performance.now();
  try {
    const response = await fetch(toHealthUrl(park.health, window.location.origin), {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    // fetch 在收到响应头时就 resolve，这里取到的就是一次往返，不含读 body
    const rttMs = Math.round(performance.now() - startedAt);
    if (!response.ok) return null;
    return parseParkHealth(await response.json(), rttMs);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortOuter);
  }
}

export interface ParkProbe {
  park: ParkEntry;
  health: ParkHealth | null;
}

export async function probeParks(
  parks: readonly ParkEntry[],
  signal?: AbortSignal,
): Promise<ParkProbe[]> {
  return Promise.all(
    parks.map(async (park) => ({ park, health: await probePark(park, signal) })),
  );
}

export interface EntryResolution {
  park: ParkEntry;
  /** 首选园区不可达时，这里是被顶替掉的那座园区的名字 */
  fallbackFrom: string | null;
}

/**
 * 入场前的园区裁决。
 *
 * 1. 只配了一座园区 → 不探活，直接进（单机部署与改造前完全一致）。
 * 2. 首选园区探活通过 → 立即进，不等其它园区返回，进场延迟只有一次往返。
 * 3. 首选不可达 → 用其它园区里第一个可达的顶替，并回报它原本叫什么。
 * 4. 全部不可达 → 仍然进首选：此时界面该显示的是「连接中断，正在重连」，
 *    而不是把人挡在一张永远点不动的卡片前面。
 */
export async function resolveEntryPark(
  parks: readonly ParkEntry[],
  targetId: string | null,
): Promise<EntryResolution> {
  const target = resolvePark(parks, targetId).park;
  if (parks.length <= 1) return { park: target, fallbackFrom: null };

  // 先并行起其它园区的探活，但优先等目标园区：健康时不付第二份等待
  const rest = Promise.all(
    parks
      .filter((park) => park.id !== target.id)
      .map(async (park) => ({ park, health: await probePark(park) })),
  ).catch(() => [] as ParkProbe[]);

  if (await probePark(target)) return { park: target, fallbackFrom: null };

  const alive = (await rest).find((item) => item.health !== null);
  return alive ? { park: alive.park, fallbackFrom: target.name } : { park: target, fallbackFrom: null };
}
