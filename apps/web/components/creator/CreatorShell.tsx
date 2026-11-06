'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useCreatorStore } from '@/lib/creator-store';
import { loadProfile } from '@/lib/profile';
import { ColorConsole } from './ColorConsole';
import { PartRail } from './PartRail';
import { PreviewStage } from './PreviewStage';
import { SaveBar } from './SaveBar';

/** 保存状态：一个色点 + 一句话，不再让图标和标签各说一遍 */
function SaveState({ dirty }: { dirty: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
        dirty
          ? 'border-amber-400/35 bg-amber-400/[0.07] text-amber-400'
          : 'border-mint-400/30 bg-mint-400/[0.07] text-mint-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 ${dirty ? 'bg-amber-400' : 'bg-mint-400'}`} aria-hidden />
      {dirty ? '草稿未保存' : '已同步到本地'}
    </span>
  );
}

export function CreatorShell() {
  const hydrate = useCreatorStore((state) => state.hydrate);
  const dirty = useCreatorStore((state) => state.dirty);
  const species = useCreatorStore((state) => state.appearance.species);

  useEffect(() => {
    const profile = loadProfile();
    if (profile) hydrate(profile.name, profile.appearance);
  }, [hydrate]);

  return (
    <div className="min-h-dvh bg-ink-900 pb-32 sm:pb-32">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-ink-700/80 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-mist-400 transition-colors duration-150 hover:text-mint-400"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
              返回园区
            </Link>
            <span className="hidden h-3 w-px shrink-0 bg-ink-600 sm:block" aria-hidden />
            <span className="hidden truncate font-display text-[13px] font-semibold tracking-[0.3em] text-mist-100 sm:inline">
              工位 404
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <span className="tag hidden border-ink-600 text-[9px] sm:inline-flex">{species === 'cow' ? 'cow / 牛' : 'horse / 马'}</span>
            <SaveState dirty={dirty} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] px-5 pt-[88px] sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-ink-700/70 pb-6">
          <h1 className="font-display text-[clamp(26px,3.4vw,38px)] leading-[1.12] font-bold tracking-[-0.01em] text-mist-100">
            捏一头能加班的{species === 'cow' ? '牛' : '马'}
          </h1>
          <p className="max-w-[34ch] text-[13px] leading-relaxed text-mist-300">
            11 个色槽、8 个属性、6 款发型——随便调。这里没有 HR 审核，只有 20Hz 的 Tick。
          </p>
        </div>

        <div className="mt-7 grid gap-5 xl:grid-cols-[288px_minmax(0,1fr)_368px]">
          <PartRail />
          <PreviewStage className="order-first xl:order-none" />
          <ColorConsole />
        </div>

        <div className="mt-6 flex items-start gap-2.5 border-t border-ink-700/70 pt-4">
          <span className="mt-[7px] h-1 w-1 shrink-0 bg-mint-400" aria-hidden />
          <p className="font-mono text-[10px] leading-relaxed tracking-[0.06em] text-mist-400">
            提示：H / S / V 滑块拖动时只更新 GPU tint，不触发 Pixi 纹理重建。
          </p>
        </div>
      </main>

      <SaveBar />
    </div>
  );
}
