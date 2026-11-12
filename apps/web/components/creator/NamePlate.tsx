'use client';

import { useEffect, useRef, useState } from 'react';
import { Dices } from 'lucide-react';
import { MAX_NAME_CHARS, MAX_NAME_DISPLAY_UNITS } from '@niuma/shared-types';
import { useCreatorStore } from '@/lib/creator-store';
import { describeProfileName, randomNickname } from '@/lib/profile';
import { AtelierStar } from './Atelier';

export interface NamePlateProps {
  /** Enter 与底部上岗按钮走同一条保存链路，空名拦截由 CreatorShell 统一处理 */
  onSubmit: () => void;
  /** 递增即滚动聚焦并提示；0 表示用户还没尝试过上岗 */
  focusSignal: number;
  /** 水合完成前不显示「必填 / 未填写」，恢复中的老用户不会闪一下红 */
  hydrated: boolean;
}

/**
 * 页面的第一入口：工牌名。
 *
 * 它曾经躲在底部保存栏里——12px 小字、移动端标签还被 sr-only 藏掉，
 * 用户一路调完外观直接点上岗，名字就被静默换成了随机款。
 * 所以这里不再只是「一个输入框」：头像旁的名字是身份本身，值得占一条独立横栏。
 */
export function NamePlate({ onSubmit, focusSignal, hydrated }: NamePlateProps) {
  const name = useCreatorStore((state) => state.name);
  const setName = useCreatorStore((state) => state.setName);
  const inputRef = useRef<HTMLInputElement>(null);
  const [prompted, setPrompted] = useState(false);

  const status = describeProfileName(name);
  const missing = prompted && status.empty;
  const showRequired = hydrated && status.empty && !prompted;

  useEffect(() => {
    if (focusSignal === 0) return;
    setPrompted(true);
    const input = inputRef.current;
    if (!input) return;
    // 平滑滚动只在这里出现一次；系统要求减少动效时立即定位
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    input.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    input.focus({ preventScroll: true });
  }, [focusSignal]);

  const hint = status.blocked
    ? '名字用不了，换一个说法再上岗'
    : status.masked
      ? '不文明用词会自动打码，照样能上岗'
      : missing
        ? '先起个工牌名，或点骰子随机一个'
        : status.empty
          ? '头顶会显示这个名字，先给自己起一个'
          : status.tooWide
            ? `头顶只显示 ${MAX_NAME_DISPLAY_UNITS} 显示宽，超出部分换成省略号`
            : '点右下角上岗后，名字会跟着你进园区';

  const hintTone = status.blocked || status.masked || status.tooWide || missing ? 'text-amber-400' : 'text-mist-400';
  const dotTone = status.blocked || status.masked || status.tooWide || missing ? 'bg-amber-400' : 'bg-mint-400';
  const inputTone =
    status.blocked || missing ? 'border-amber-400' : 'border-ink-500 focus:border-mint-400';

  return (
    <section
      aria-labelledby="nameplate-heading"
      className="panel panel-atelier p-4 [@media(max-height:500px)]:p-3 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6 [@media(max-height:500px)]:gap-2">
        <div className="shrink-0 sm:w-[212px]">
          <div className="flex items-baseline gap-2">
            <span className="h-1.5 w-1.5 self-center bg-mint-400" aria-hidden />
            <h2
              id="nameplate-heading"
              className="font-display text-[18px] font-semibold leading-none tracking-[0.06em] text-mist-100"
            >
              <label htmlFor="niuma-name">工牌名</label>
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">nameplate</span>
            <AtelierStar className="h-1.5 w-1.5 self-center bg-blush-300/70" />
            {showRequired ? (
              <span className="tag border-amber-400/40 px-1.5 py-0 text-[9px] text-amber-400">必填</span>
            ) : null}
          </div>
          <p className="mt-2 hidden text-[12px] leading-relaxed text-mist-300 sm:block [@media(max-height:500px)]:hidden">
            头顶会显示这个名字。
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-stretch gap-2">
            <input
              ref={inputRef}
              id="niuma-name"
              value={name}
              maxLength={MAX_NAME_CHARS}
              onChange={(event) => {
                setName(event.target.value);
                // 一动手就撤掉「先起个名字」的警告，不追着用户重复
                if (prompted) setPrompted(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                // 中文输入法确认候选词时的那次 Enter 不算提交
                if (event.nativeEvent.isComposing) return;
                event.preventDefault();
                onSubmit();
              }}
              placeholder="例如：夜班实习生"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              required
              aria-invalid={status.blocked || missing}
              aria-describedby="nameplate-hint"
              className={`field h-12 min-w-0 flex-1 px-3.5 font-mono text-[16px] leading-none tracking-[0.02em] text-mist-100 [@media(max-height:500px)]:h-11 ${inputTone}`}
            />
            <button
              type="button"
              onClick={() => {
                setName(randomNickname());
                setPrompted(false);
                inputRef.current?.focus();
              }}
              aria-label="随机生成工牌名"
              title="随机生成"
              className="group grid h-12 w-12 shrink-0 cursor-pointer place-items-center border-2 border-ink-600 text-mist-300 transition-colors duration-150 hover:border-mint-400/70 hover:text-mint-400 [@media(max-height:500px)]:h-11 [@media(max-height:500px)]:w-11"
            >
              <Dices className="h-[18px] w-[18px] transition-transform duration-200 group-hover:rotate-180" aria-hidden />
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p
              id="nameplate-hint"
              role={missing || status.blocked ? 'alert' : 'status'}
              className={`flex items-baseline gap-1.5 font-mono text-[10px] leading-relaxed tracking-[0.06em] ${hintTone}`}
            >
              <span className={`h-1 w-1 shrink-0 self-center ${dotTone}`} aria-hidden />
              {hint}
            </p>
            <span
              className={`font-mono text-[10px] tabular-nums tracking-[0.08em] [@media(max-height:500px)]:hidden ${
                status.tooWide ? 'text-amber-400' : 'text-mist-500'
              }`}
              title={`头顶只放得下 ${MAX_NAME_DISPLAY_UNITS} 显示宽，半角算 1、全角算 2`}
            >
              显示宽度 {status.displayUnits} / {MAX_NAME_DISPLAY_UNITS}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
