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
    <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink-600 bg-ink-900/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-5 py-4 sm:px-8">
        <div className="flex min-w-[220px] flex-1 items-center gap-3">
          <label htmlFor="niuma-name" className="font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
            工牌名
          </label>
          <input
            id="niuma-name"
            value={name}
            maxLength={16}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入你的工牌名"
            className="field max-w-[240px]"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setName(randomNickname())}
            aria-label="随机生成昵称"
            className="grid h-[42px] w-[42px] cursor-pointer place-items-center border-2 border-ink-600 text-mist-300 transition-colors hover:border-mint-400 hover:text-mint-400"
          >
            <Dices className="h-4 w-4" />
          </button>
        </div>

        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-500">
          <ShieldOff className="h-3.5 w-3.5 text-amber-400" />
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
