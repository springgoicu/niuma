'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Dices, ShieldOff } from 'lucide-react';
import {
  MAX_NAME_CHARS,
  MAX_NAME_DISPLAY_UNITS,
  displayWidth,
  truncateName,
} from '@niuma/shared-types';
import { useCreatorStore } from '@/lib/creator-store';
import { randomNickname, saveProfile } from '@/lib/profile';

export function SaveBar() {
  const router = useRouter();
  const name = useCreatorStore((state) => state.name);
  const appearance = useCreatorStore((state) => state.appearance);
  const setName = useCreatorStore((state) => state.setName);
  const markSaved = useCreatorStore((state) => state.markSaved);

  const handleSave = () => {
    // 与协议同一把尺子：16 字符 / 48 字节，超宽的名字只影响头顶显示
    const finalName = truncateName(name.trim() || randomNickname());
    setName(finalName);
    saveProfile({ name: finalName, appearance });
    markSaved();
    router.push('/play');
  };

  const tooWide = displayWidth(name.trim()) > MAX_NAME_DISPLAY_UNITS;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700/80 bg-ink-900/[0.94] shadow-[0_-24px_48px_-32px_rgba(0,0,0,0.95)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1560px] items-center gap-x-3 gap-y-2.5 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:flex-wrap sm:gap-x-4 sm:px-8 sm:py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[240px]">
          <label
            htmlFor="niuma-name"
            className="sr-only shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400 sm:not-sr-only"
          >
            工牌名
          </label>
          <input
            id="niuma-name"
            value={name}
            maxLength={MAX_NAME_CHARS}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入你的工牌名"
            autoComplete="off"
            className="h-11 min-w-0 flex-1 border border-ink-700 bg-ink-950 px-2.5 font-mono text-[12px] text-mist-100 outline-none transition-colors duration-150 placeholder:text-mist-500 focus:border-mint-400 sm:h-9 sm:max-w-[220px] sm:flex-none sm:w-full"
          />
          <button
            type="button"
            onClick={() => setName(randomNickname())}
            aria-label="随机生成昵称"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center border border-ink-700 text-mist-300 transition-colors duration-150 hover:border-mint-400/70 hover:text-mint-400 sm:h-9 sm:w-9"
          >
            <Dices className="h-3.5 w-3.5" />
          </button>
          {tooWide ? (
            <span
              className="hidden shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-400 sm:inline"
              title={`头顶只显示 ${MAX_NAME_DISPLAY_UNITS} 显示宽，超出部分以省略号代替`}
            >
              头顶截断
            </span>
          ) : null}
        </div>

        <p className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mist-400 sm:flex">
          <ShieldOff className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          仅存于当前标签页 · 关闭即清空
        </p>

        <button
          type="button"
          onClick={handleSave}
          className="btn-primary group h-11 shrink-0 px-4 text-[12px] sm:h-auto sm:px-6"
        >
          <span className="sm:hidden">上岗</span>
          <span className="hidden sm:inline">保存并上岗</span>
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
}
