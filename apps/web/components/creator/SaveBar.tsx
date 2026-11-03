'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Dices, ShieldOff } from 'lucide-react';
import { useCreatorStore } from '@/lib/creator-store';
import { randomNickname, saveProfile } from '@/lib/profile';

export function SaveBar() {
  const router = useRouter();
  const name = useCreatorStore((state) => state.name);
  const appearance = useCreatorStore((state) => state.appearance);
  const setName = useCreatorStore((state) => state.setName);
  const markSaved = useCreatorStore((state) => state.markSaved);

  const handleSave = () => {
    const finalName = name.trim() || randomNickname();
    setName(finalName);
    saveProfile({ name: finalName, appearance });
    markSaved();
    router.push('/play');
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700/80 bg-ink-900/[0.94] shadow-[0_-24px_48px_-32px_rgba(0,0,0,0.95)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:px-8">
        <div className="flex min-w-[240px] flex-1 items-center gap-2.5">
          <label
            htmlFor="niuma-name"
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400"
          >
            工牌名
          </label>
          <input
            id="niuma-name"
            value={name}
            maxLength={16}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入你的工牌名"
            autoComplete="off"
            className="h-9 w-full max-w-[220px] border border-ink-700 bg-ink-950 px-2.5 font-mono text-[12px] text-mist-100 outline-none transition-colors duration-150 placeholder:text-mist-500 focus:border-mint-400"
          />
          <button
            type="button"
            onClick={() => setName(randomNickname())}
            aria-label="随机生成昵称"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center border border-ink-700 text-mist-300 transition-colors duration-150 hover:border-mint-400/70 hover:text-mint-400"
          >
            <Dices className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mist-400">
          <ShieldOff className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          仅存于当前标签页 · 关闭即清空
        </p>

        <button type="button" onClick={handleSave} className="btn-primary group">
          保存并上岗
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
}
