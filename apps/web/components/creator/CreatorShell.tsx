'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useCreatorStore } from '@/lib/creator-store';
import { describeProfileName, loadProfile, resolveProfileName, saveProfile } from '@/lib/profile';
import { ColorConsole } from './ColorConsole';
import { CreatorTabs, type CreatorTab } from './CreatorTabs';
import { NamePlate } from './NamePlate';
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
  const router = useRouter();
  const hydrate = useCreatorStore((state) => state.hydrate);
  const dirty = useCreatorStore((state) => state.dirty);
  const name = useCreatorStore((state) => state.name);
  const appearance = useCreatorStore((state) => state.appearance);
  const setName = useCreatorStore((state) => state.setName);
  const markSaved = useCreatorStore((state) => state.markSaved);
  const species = appearance.species;
  const [tab, setTab] = useState<CreatorTab>('species');
  /** 本地档案读完之前不判定「没填名字」，否则恢复中的老用户会闪一下必填 */
  const [hydrated, setHydrated] = useState(false);
  /** 递增即把用户送回工牌条；0 表示本次会话还没触发过空名拦截 */
  const [focusSignal, setFocusSignal] = useState(0);
  /** 状态在游戏内编辑，捏人页只负责原样带回存档 */
  const statusRef = useRef('');

  useEffect(() => {
    const profile = loadProfile();
    if (profile) {
      hydrate(profile.name, profile.appearance);
      statusRef.current = profile.status;
    }
    setHydrated(true);
  }, [hydrate]);

  const status = describeProfileName(name);

  const save = () => {
    if (status.blocked) return;
    // 空名不再静默换成随机款：把用户送回工牌条，名字得是他自己认得的
    if (status.empty) {
      setFocusSignal((signal) => signal + 1);
      return;
    }
    // 与协议同一把尺子：16 字符 / 48 字节，超宽的名字只影响头顶显示
    const finalName = resolveProfileName(status.trimmed);
    setName(finalName);
    saveProfile({ name: finalName, appearance, status: statusRef.current });
    markSaved();
    router.push('/play');
  };

  return (
    <div
      // 头部高度是吸顶 / 内容上边距的唯一来源，刘海屏由 env() 撑开
      className="min-h-dvh bg-ink-900 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-24"
      style={{ '--creator-top': 'calc(3.5rem + env(safe-area-inset-top))' } as CSSProperties}
    >
      <header className="pt-safe fixed inset-x-0 top-0 z-40 border-b border-ink-700/80 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center justify-between gap-4 px-4 sm:px-8">
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

      <main className="mx-auto max-w-[1560px] px-4 pt-[calc(var(--creator-top)+1rem)] [@media(max-height:500px)]:pt-[calc(var(--creator-top)+0.5rem)] sm:px-8 sm:pt-[calc(var(--creator-top)+2rem)]">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2 border-b border-ink-700/70 pb-4 [@media(max-height:500px)]:pb-2 sm:gap-y-4 sm:pb-6">
          <h1 className="font-display text-[clamp(24px,3.4vw,38px)] leading-[1.12] font-bold tracking-[-0.01em] text-mist-100 [@media(max-height:500px)]:text-[20px]">
            捏一头能加班的{species === 'cow' ? '牛' : '马'}
          </h1>
          {hydrated && status.empty ? (
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-amber-400 [@media(max-height:500px)]:hidden sm:text-[11px]">
              <span className="h-1.5 w-1.5 bg-amber-400" aria-hidden />
              先给自己起个工牌名
            </p>
          ) : (
            <p className="hidden max-w-[34ch] text-[13px] leading-relaxed text-mist-300 sm:block [@media(max-height:500px)]:hidden">
              11 个色槽、8 个属性、6 款发型——随便调。这里没有 HR 审核，只有 20Hz 的 Tick。
            </p>
          )}
        </div>

        <div className="mt-4 xl:mt-5">
          <NamePlate onSubmit={save} focusSignal={focusSignal} hydrated={hydrated} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:mt-5 xl:grid-cols-[288px_minmax(0,1fr)_368px] xl:gap-5">
          {/* 预览常驻：手机吸顶在头部之下，桌面吸顶并收在与视口等高的列里，
              不再被左栏的长列表拉成一张两屏高的画布 */}
          {/* 横屏矮视口（<500px）放不下吸顶工作台，退回普通单列，靠滚动查看 */}
          <div className="sticky top-[var(--creator-top)] z-30 flex h-[48dvh] max-h-[440px] min-h-[300px] flex-col bg-ink-900 shadow-[0_18px_24px_-24px_rgba(10,6,3,0.95)] [@media(max-height:500px)]:static [@media(max-height:500px)]:h-[248px] [@media(max-height:500px)]:max-h-[248px] [@media(max-height:500px)]:min-h-0 sm:h-[52dvh] sm:max-h-[560px] xl:top-[calc(var(--creator-top)+1.5rem)] xl:z-20 xl:col-start-2 xl:row-start-1 xl:h-[calc(100dvh-var(--creator-top)-18rem)] xl:max-h-none xl:min-h-0 xl:self-start xl:bg-transparent xl:shadow-none">
            <PreviewStage />
            <CreatorTabs value={tab} onChange={setTab} className="mt-2 shrink-0 xl:hidden" />
          </div>

          <PartRail
            mobileTab={tab}
            className={`xl:col-start-1 xl:row-start-1 ${tab === 'color' ? 'hidden xl:block' : ''}`}
          />
          <ColorConsole
            className={`xl:col-start-3 xl:row-start-1 ${tab === 'color' ? '' : 'hidden xl:block'}`}
          />
        </div>

        <div className="mt-6 flex items-start gap-2.5 border-t border-ink-700/70 pt-4">
          <span className="mt-[7px] h-1 w-1 shrink-0 bg-mint-400" aria-hidden />
          <p className="font-mono text-[10px] leading-relaxed tracking-[0.06em] text-mist-400">
            提示：H / S / V 滑块拖动时只更新 GPU tint，不触发 Pixi 纹理重建。
          </p>
        </div>
      </main>

      <SaveBar onSubmit={save} onFocusName={() => setFocusSignal((signal) => signal + 1)} hydrated={hydrated} />
    </div>
  );
}
