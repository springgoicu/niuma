'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Wifi, WifiOff } from 'lucide-react';
import { useCreatorStore } from '@/lib/creator-store';
import { loadProfile } from '@/lib/profile';
import { ColorConsole } from './ColorConsole';
import { PartRail } from './PartRail';
import { PreviewStage } from './PreviewStage';
import { SaveBar } from './SaveBar';

export function CreatorShell() {
  const hydrate = useCreatorStore((state) => state.hydrate);
  const dirty = useCreatorStore((state) => state.dirty);
  const species = useCreatorStore((state) => state.appearance.species);

  useEffect(() => {
    const profile = loadProfile();
    if (profile) hydrate(profile.name, profile.appearance);
  }, [hydrate]);

  return (
    <div className="min-h-dvh bg-ink-900 pb-36">
      <header className="fixed inset-x-0 top-0 z-40 border-b-2 border-ink-700 bg-ink-900/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-300 transition-colors hover:text-mint-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回园区
          </Link>

          <div className="flex items-center gap-4">
            <span className="font-display text-sm tracking-[0.36em] text-mist-100">工位 404</span>
            <span className="tag hidden sm:inline-flex">{species === 'cow' ? 'cow / 牛' : 'horse / 马'}</span>
            <span className="tag">
              {dirty ? '草稿未保存' : '已同步到本地'}
            </span>
            {dirty ? (
              <WifiOff className="h-3.5 w-3.5 text-amber-400" aria-label="未保存" />
            ) : (
              <Wifi className="h-3.5 w-3.5 text-mint-400" aria-label="已保存" />
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-5 pt-24 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">// hr onboarding</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-mist-100">
              捏一头能加班的{species === 'cow' ? '牛' : '马'}
            </h1>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-mist-300">
            颜色、斑纹、口鼻、角或鬃毛、头饰眼镜颈饰——随便调。这里没有 HR 审核，只有 20Hz 的 Tick。
          </p>
        </div>

        <div className="mt-8 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <PartRail />
          <PreviewStage />
          <ColorConsole />
        </div>

        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-mist-500">
          提示：H / S / V 滑块拖动时只更新 GPU tint，不触发 Pixi 纹理重建。
        </p>
      </main>

      <SaveBar />
    </div>
  );
}
