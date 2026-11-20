'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, Sparkles } from 'lucide-react';
import { DEFAULT_PARK, parseParkHealth, toHealthUrl } from '@/lib/park';

const STAGE_MOODS = [
  '摸鱼巡游 · 在岗离线两不误',
  '飞车送餐 · 全岛高架 16 车抢开',
  '江湖切磋 · 涂鸦占壁 & 急诊续命',
] as const;

/**
 * 首屏实时状态条（客户端探测同源 / 默认园区 `/health`）：
 * SSR 首帧保底输出确定文案，水合后轻量拉取实时在线牛马数与可互动阶段切换。
 */
export function HeroLiveStatus() {
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [moodIndex, setMoodIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (typeof window === 'undefined') return;
    const url = toHealthUrl(DEFAULT_PARK.health, window.location.origin);
    void fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || controller.signal.aborted) return;
        const parsed = parseParkHealth(data, 0);
        if (parsed) setOnlineCount(parsed.online);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px]">
      <span className="inline-flex items-center gap-1.5 border border-ink-600 bg-ink-900/90 px-2.5 py-1 text-mint-400">
        <Radio className="h-3 w-3 animate-pulse" aria-hidden />
        {onlineCount !== null ? `实时在园 ${onlineCount} 头牛马` : '开放园区即时接入'}
      </span>

      <button
        type="button"
        onClick={() => setMoodIndex((i) => (i + 1) % STAGE_MOODS.length)}
        className="inline-flex cursor-pointer items-center gap-1.5 border border-ink-600 bg-ink-900/90 px-2.5 py-1 text-mist-300 transition-colors hover:border-mint-400 hover:text-mint-400"
      >
        <Sparkles className="h-3 w-3 text-[#f2c879]" aria-hidden />
        {STAGE_MOODS[moodIndex]}
      </button>

      <Link
        href="/play?name=路过实习生&species=cow"
        className="inline-flex items-center gap-1 border border-mint-500/60 bg-mint-500/10 px-2.5 py-1 text-mint-400 transition-colors hover:bg-mint-500/20"
      >
        游客直进试玩 →
      </Link>
    </div>
  );
}
