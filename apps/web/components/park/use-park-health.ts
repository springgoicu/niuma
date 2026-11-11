'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ParkEntry } from '@/lib/park';
import { probeParks, type ParkProbe } from '@/lib/park-health';

/** 轮询间隔：选园页通常只停留十几秒，15s 足够反映「刚被别人挤满」 */
const POLL_INTERVAL_MS = 15_000;

export interface ParkHealthState {
  probes: ParkProbe[];
  /** 首屏与手动重试期间为 true；后台轮询不会让界面回到骨架态 */
  loading: boolean;
  refresh: () => void;
}

/**
 * 选园页的探活循环。
 *
 * 三条规则：
 * - `Promise.allSettled` 语义（`probeParks` 内部已把失败收敛成 null），
 *   一座园区挂掉不影响另一座的卡片；
 * - `hidden` 时停止轮询：后台标签页没人看，不该持续消耗出口带宽；
 * - 卸载时 abort 在途请求并清掉定时器，避免回到前台后一堆回调打进来。
 */
export function useParkHealth(parks: readonly ParkEntry[]): ParkHealthState {
  const [probes, setProbes] = useState<ParkProbe[]>([]);
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setRound((value) => value + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    function clearTimer(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function schedule(): void {
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, POLL_INTERVAL_MS);
    }

    async function run(): Promise<void> {
      if (disposed) return;
      clearTimer();
      const next = await probeParks(parks, controller.signal);
      if (disposed) return;
      setProbes(next);
      setLoading(false);
      if (document.visibilityState === 'visible') schedule();
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'visible') void run();
      else clearTimer();
    }

    void run();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      clearTimer();
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [parks, round]);

  return { probes, loading, refresh };
}
