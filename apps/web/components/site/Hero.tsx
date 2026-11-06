import Link from 'next/link';
import { ArrowRight, Coffee, CornerDownRight, Terminal } from 'lucide-react';
import { CharacterSprite } from './CharacterSprite';

const METRICS = [
  ['20 Hz', '权威 tick'],
  ['8 B', '移动包'],
  ['WebGPU', '优先渲染'],
  ['900 px', 'AOI 半径'],
];

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink-700">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #4fe3c1 0%, transparent 70%)' }}
      />

      <div className="relative mx-auto grid max-w-[1440px] items-center gap-14 px-5 pt-16 pb-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24 lg:pb-28">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">
            <span className="h-2 w-2 animate-blink bg-mint-400" />
            shift 03 · 夜班园区 · 工位永远空着一个
          </p>

          <h1 className="relative mt-6 font-display text-[clamp(68px,11vw,150px)] leading-[0.78] font-bold tracking-[-0.02em] text-mist-100">
            <span aria-hidden className="absolute inset-0 translate-x-[4px] translate-y-[4px] text-mint-400/20">
              牛马
            </span>
            <span className="relative">牛马</span>
            <span className="mt-4 block font-display text-[clamp(22px,3.2vw,40px)] font-semibold tracking-[0.44em] text-mist-500">
              NIOMA
            </span>
          </h1>

          <p className="mt-8 max-w-xl text-balance text-lg leading-relaxed text-mist-100">
            一座永不下班的像素办公园区。你可以沿着走廊走，在工位坐下，跟前同事打字聊天，
            也可以什么都不做——反正绩效早就定好了。
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-mist-300">
            没有注册，没有存档，没有绩效面谈。关掉标签页，你就自由了。
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link href="/create" className="btn-primary group">
              打卡上班
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
            <a href="#species" className="btn-ghost">
              查看物种档案
            </a>
          </div>

          <dl className="mt-12 grid max-w-xl grid-cols-2 gap-x-6 gap-y-5 border-t-2 border-ink-700 pt-6 sm:grid-cols-4">
            {METRICS.map(([value, label]) => (
              <div key={label}>
                <dt className="font-display text-2xl font-semibold text-mist-100">{value}</dt>
                <dd className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-mist-500">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative">
          <div className="panel panel-scan relative overflow-hidden">
            <header className="flex items-center justify-between border-b-2 border-ink-600 px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mist-500">
                desk-cam / 404
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-signal-500">
                <span className="h-2 w-2 animate-blink bg-signal-500" />
                rec
              </span>
            </header>

            <div className="relative h-[320px] overflow-hidden bg-ink-950">
              <div className="absolute inset-0 grid-bg opacity-70" />
              <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-mint-400/10 to-transparent" />

              {/* 工位 */}
              <div className="absolute bottom-[86px] left-10 right-10 h-2 bg-ink-600" />
              <div className="absolute bottom-[70px] left-10 h-4 w-2 bg-ink-700" />
              <div className="absolute bottom-[70px] right-10 h-4 w-2 bg-ink-700" />

              {/* 显示器 */}
              <div className="absolute bottom-[92px] left-1/2 h-16 w-24 -translate-x-1/2 border-2 border-ink-500 bg-ink-800 shadow-[0_0_28px_rgba(79,227,193,0.28)]">
                <div className="m-1 h-1.5 w-8 bg-mint-400/80" />
                <div className="mx-1 h-1 w-12 bg-mint-400/35" />
                <div className="mx-1 mt-1 h-1 w-9 bg-mint-400/25" />
              </div>
              <div className="absolute bottom-[86px] left-1/2 h-1.5 w-8 -translate-x-1/2 bg-ink-500" />

              {/* 角色：与物种档案同一张默认外观图，只差放大倍数 */}
              <div className="absolute bottom-[86px] right-14 animate-float">
                <CharacterSprite species="cow" size={192} />
              </div>

              {/* 咖啡与绿植 */}
              <div className="absolute bottom-[86px] left-12 flex flex-col items-center">
                <div className="h-3 w-3 border border-mist-500 bg-ink-700" />
                <div className="h-1.5 w-4 bg-ink-600" />
              </div>
              <div className="absolute bottom-[86px] right-32 flex flex-col items-center">
                <div className="h-4 w-1 bg-mist-500/50" />
                <div className="h-3 w-3 bg-lime-400/50" />
                <div className="mt-[-14px] ml-3 h-3 w-2 bg-lime-400/35" />
              </div>

              <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-ink-950 to-transparent" />
              <div className="absolute left-4 top-4 font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">
                floor 03 · corridor b
              </div>
            </div>

            <footer className="space-y-1.5 border-t-2 border-ink-600 px-4 py-3.5 font-mono text-[11px] leading-relaxed text-mist-300">
              <p className="flex items-center gap-2">
                <Terminal className="h-3 w-3 text-mint-400" />
                <span className="text-mint-400">$</span> boot --shift 03
              </p>
              <p className="text-mist-500">&gt; 世界仅在内存中，0 条持久化记录</p>
              <p className="text-mist-500">
                &gt; 检测到 1 头牛在打印机旁
                <span className="text-amber-400">躺平</span>
              </p>
              <p className="text-mist-500">&gt; AOI 900px · 只广播看得见的人</p>
              <p className="flex items-center gap-1 text-mint-400">
                <CornerDownRight className="h-3 w-3" />
                ready <span className="animate-blink">▌</span>
              </p>
            </footer>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-2 border-ink-700 bg-ink-800/60 px-4 py-3">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
              <Coffee className="h-3.5 w-3.5 text-amber-400" />
              本司咖啡免费，续命自费
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-mint-400">24 online</span>
          </div>
        </div>
      </div>
    </section>
  );
}
