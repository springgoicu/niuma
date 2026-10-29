'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Dices, ShieldOff } from 'lucide-react';
import type { Species } from '@niuma/shared-types';
import { defaultAppearance, randomNickname, saveProfile, type Profile } from '@/lib/profile';


export function JoinGate({ onEnter }: { onEnter: (profile: Profile) => void }) {
  const [name, setName] = useState(randomNickname());
  const [species, setSpecies] = useState<Species>('cow');

  const enter = () => {
    const profile: Profile = {
      name: name.trim() || randomNickname(),
      appearance: defaultAppearance(species),
    };
    saveProfile(profile);
    onEnter(profile);
  };

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink-950/92 px-5 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="panel panel-scan relative w-full max-w-[520px] p-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">// 入职登记</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-mist-100">打卡进入园区</h1>
        <p className="mt-3 text-sm leading-relaxed text-mist-300">
          只填一个工牌名。没有密码，没有邮箱，没有「下次自动登录」——因为你不会被记住。
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {(['cow', 'horse'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={species === item}
              onClick={() => setSpecies(item)}
              className={`flex cursor-pointer items-center gap-3 border-2 p-3 text-left transition-colors duration-150 ${
                species === item
                  ? 'border-mint-400 bg-mint-400/10'
                  : 'border-ink-600 bg-ink-950/60 hover:border-ink-500'
              }`}
            >
              <img
                src={`/sprites/preview-${item}.png`}
                alt=""
                width={96}
                height={96}
                className="pixelated h-16 w-16 shrink-0 sm:h-24 sm:w-24"
                style={{ imageRendering: 'pixelated' }}
              />
              <span>
                <span className="block font-display text-lg font-semibold text-mist-100">
                  {item === 'cow' ? '牛' : '马'}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
                  {item === 'cow' ? 'stable' : 'sprint'}
                </span>
              </span>
            </button>
          ))}
        </div>

        <label htmlFor="join-name" className="mt-6 block font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
          工牌名
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="join-name"
            value={name}
            maxLength={16}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') enter();
            }}
            placeholder="例如：夜班实习生"
            autoComplete="off"
            className="field"
          />
          <button
            type="button"
            onClick={() => setName(randomNickname())}
            aria-label="随机昵称"
            className="grid w-[46px] shrink-0 cursor-pointer place-items-center border-2 border-ink-600 text-mist-300 transition-colors hover:border-mint-400 hover:text-mint-400"
          >
            <Dices className="h-4 w-4" />
          </button>
        </div>

        <button type="button" onClick={enter} className="btn-primary group mt-5 w-full">
          上岗
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </button>

        <div className="mt-5 flex items-center justify-between gap-3 border-t-2 border-ink-700 pt-4">
          <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
            <ShieldOff className="h-3.5 w-3.5 text-amber-400" />
            关闭页面即清空
          </span>
          <Link
            href="/create"
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-mint-400 transition-colors hover:text-lime-400"
          >
            先去捏人 →
          </Link>
        </div>
      </div>
    </div>
  );
}
