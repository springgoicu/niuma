'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Dices, ShieldOff } from 'lucide-react';
import {
  MAX_NAME_CHARS,
  MAX_NAME_DISPLAY_UNITS,
  displayWidth,
  type Species,
} from '@niuma/shared-types';
import { checkProfileName, defaultAppearance, randomNickname, resolveProfileName, saveProfile, type Profile } from '@/lib/profile';


export function JoinGate({ onEnter }: { onEnter: (profile: Profile) => void }) {
  const [name, setName] = useState(randomNickname());
  const [species, setSpecies] = useState<Species>('cow');

  // 字符数够用不代表宽度够用：16 个汉字是 32 宽，头顶只放得下 16
  const nameWidth = displayWidth(name.trim());
  const tooWide = nameWidth > MAX_NAME_DISPLAY_UNITS;

  // 政治类命中不允许上岗；脏话打码后照常进入，只提前告知
  const nameCheck = checkProfileName(name.trim());
  const nameBlocked = nameCheck.verdict === 'reject';
  const nameMasked = nameCheck.verdict === 'mask';

  const enter = () => {
    if (nameBlocked) return;
    const profile: Profile = {
      // 钳制与审核都只有 shared-types 一份实现，这里不再自己 slice 或查词表
      name: resolveProfileName(name.trim() || randomNickname()),
      appearance: defaultAppearance(species),
    };
    saveProfile(profile);
    onEnter(profile);
  };

  return (
    <div className="absolute inset-0 z-40 flex overflow-y-auto bg-ink-950/92 px-5 py-4 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="panel panel-scan relative m-auto w-full max-w-[520px] p-5 sm:p-7">
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
                className="pixelated h-12 w-12 shrink-0 sm:h-24 sm:w-24"
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

        <div className="mt-6 flex items-baseline justify-between gap-3">
          <label htmlFor="join-name" className="block font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
            工牌名
          </label>
          <span
            className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
              tooWide ? 'text-amber-400' : 'text-mist-500'
            }`}
          >
            {tooWide ? `头顶只显示 ${MAX_NAME_DISPLAY_UNITS} 宽 + …` : `显示宽度 ${nameWidth} / ${MAX_NAME_DISPLAY_UNITS}`}
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            id="join-name"
            value={name}
            maxLength={MAX_NAME_CHARS}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') enter();
            }}
            placeholder="例如：夜班实习生"
            autoComplete="off"
            aria-invalid={nameBlocked}
            aria-describedby={nameBlocked || nameMasked ? 'join-name-notice' : undefined}
            className={`field ${nameBlocked ? 'border-amber-400 focus:border-amber-400' : ''}`}
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

        {(nameBlocked || nameMasked) && (
          <p
            id="join-name-notice"
            role={nameBlocked ? 'alert' : 'status'}
            className="mt-2 font-mono text-[10px] leading-relaxed tracking-[0.08em] text-amber-400"
          >
            {nameBlocked ? '这个工牌名用不了，换个说法再上岗' : '提交后不文明用词会自动打码'}
          </p>
        )}

        <button type="button" onClick={enter} disabled={nameBlocked} className="btn-primary group mt-5 w-full">
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
