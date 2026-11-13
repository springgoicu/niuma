import Link from 'next/link';
import { ArrowDown, ArrowRight, Play } from 'lucide-react';
import { CharacterSprite, footPad } from './CharacterSprite';
import { SPECIES, type SpeciesProfile } from './species';

/** HUD 条只留三个能在窄屏并排站住的数：口径都出自下方技术底牌，没有新增 */
const HUD_METRICS = ['20 hz tick', '8 b move', '900 px aoi'];

/** 四角选择框：角色选择画面里最省笔墨的「这一格可以按」 */
const SELECT_CORNERS = [
  '-left-1.5 -top-1.5 border-l-2 border-t-2',
  '-right-1.5 -top-1.5 border-r-2 border-t-2',
  '-bottom-1.5 -left-1.5 border-b-2 border-l-2',
  '-bottom-1.5 -right-1.5 border-b-2 border-r-2',
];

/**
 * 舞台上的一个站位。
 *
 * 挂两档整数倍（窄屏 2x / 宽屏 3x）而不是缩放同一张图，像素块才不会被拉成
 * 宽窄不一的矩形。负 margin 抵扣帧底那 5 个空像素，容器底边正好落在脚底，
 * 脚下的地平线、接触阴影才有意义。
 */
function StageSprite({
  species,
  size,
  delay = false,
  className = '',
}: {
  species: SpeciesProfile['key'];
  size: number;
  delay?: boolean;
  className?: string;
}) {
  return (
    <span className={`block ${className}`} style={{ marginBottom: -footPad(size) }}>
      <CharacterSprite
        species={species}
        size={size}
        className={`animate-idle-bob ${delay ? '[animation-delay:0.55s]' : ''}`}
      />
    </span>
  );
}

function SpeciesTile({ species, delay }: { species: SpeciesProfile; delay: boolean }) {
  return (
    <Link
      href={`/create?species=${species.key}`}
      aria-label={`选择${species.name}，进入捏人界面`}
      className="group relative flex flex-col items-center focus-visible:outline-offset-[10px]"
    >
      <div className="relative">
        {/* 角标、阴影与地平线都不跟着角色抬起，抬的只有角色本身 */}
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {SELECT_CORNERS.map((corner) => (
            <span
              key={corner}
              className={`absolute h-3 w-3 border-mint-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${corner}`}
            />
          ))}
          <span className="absolute inset-x-0 bottom-0 mx-auto h-1.5 w-14 translate-y-[3px] rounded-full bg-ink-950/70 blur-[3px] transition-transform duration-150 group-hover:scale-x-90 sm:w-20" />
          <span className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-mint-400/45 to-transparent" />
        </span>

        <div className="transition-transform duration-150 group-hover:-translate-y-1 group-focus-visible:-translate-y-1">
          <StageSprite species={species.key} size={128} delay={delay} className="sm:hidden" />
          <StageSprite species={species.key} size={192} delay={delay} className="hidden sm:block" />
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center text-center">
        <span className="font-display text-2xl font-semibold leading-none text-mist-100 transition-colors duration-150 group-hover:text-mint-400 group-focus-visible:text-mint-400">
          {species.name}
        </span>
        <span className="mt-2 text-[11px] leading-relaxed text-mist-400">{species.tagline}</span>
        <span className="mt-2 flex h-4 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-mint-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          <ArrowRight className="h-3 w-3" aria-hidden />
          进入捏人
        </span>
      </div>
    </Link>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink-700">
      {/* 舞台是「屏幕里的房间」，不是海报：网格向下渐隐，扫描线压在最上层 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="grid-bg absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,transparent,black_38%,black_76%,transparent)]" />
        <div className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(560px_360px_at_50%_16%,rgba(79,227,193,0.16),transparent_72%)]" />
        <div className="panel-scan absolute inset-0 opacity-35" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />
      </div>

      <div className="relative mx-auto flex max-w-[1440px] flex-col px-5 sm:px-8 lg:min-h-[calc(100svh-4rem)]">
        {/* 顶栏：一左一右两个状态，不是标题上方的小标签 */}
        <div className="flex items-center justify-between gap-3 border-b border-ink-700/70 py-3 font-mono text-[10px] uppercase tracking-[0.22em]">
          <span className="flex items-center gap-2 text-mist-400">
            <span className="h-1.5 w-1.5 animate-blink bg-mint-400" aria-hidden />
            shift 03 · 夜班园区
          </span>
          <span className="flex items-center gap-2 text-mist-500">
            <span className="hidden sm:inline">no save</span>
            <span className="hidden h-1 w-1 bg-ink-500 sm:block" aria-hidden />
            <span>no login</span>
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-10 lg:py-6">
          <h1 className="relative text-center font-display text-[clamp(64px,10vw,132px)] leading-[0.82] font-bold tracking-[-0.02em] text-mist-100">
            <span aria-hidden className="absolute inset-0 translate-x-[4px] translate-y-[4px] text-mint-400/20">
              牛马
            </span>
            <span className="relative block">牛马</span>
            <span className="mt-3 block font-display text-[clamp(18px,2.2vw,30px)] font-semibold tracking-[0.44em] text-mist-500 [text-indent:0.44em]">
              NIOMA
            </span>
          </h1>

          <p className="mt-7 max-w-[30rem] text-balance text-center text-base leading-relaxed text-mist-100 sm:text-lg">
            一座永不下班的像素办公园区。沿着走廊走，在工位坐下，跟前同事打字聊天——
            也可以什么都不做，反正绩效早就定好了。
          </p>

          {/* 选角舞台：两名角色站在各自的地平线上，整块都是入口 */}
          <div className="mt-10 flex items-end justify-center gap-14 sm:mt-12 sm:gap-24">
            {SPECIES.map((species, index) => (
              <SpeciesTile key={species.key} species={species} delay={index === 1} />
            ))}
          </div>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/create" className="btn-primary group">
              <Play className="h-3.5 w-3.5" aria-hidden />
              打卡上班
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
            </Link>
            <a href="#species" className="btn-ghost">
              查看物种档案
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>

          <p className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
            ready · 无需注册 · 无存档 · 无绩效面谈
            <span className="animate-blink text-mint-400" aria-hidden>
              ▌
            </span>
          </p>
        </div>

        {/* HUD：桌面摄像机的 boot 日志收成一条状态带，机身还在，假面板不在了 */}
        <div className="border-t-2 border-ink-700 py-3.5">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-mist-500">
            <span className="flex items-center gap-1.5 text-signal-500">
              <span className="h-1.5 w-1.5 animate-blink bg-signal-500" aria-hidden />
              rec
            </span>
            <span aria-hidden className="h-3 w-px bg-ink-500" />
            <span className="text-mint-400">$ boot --shift 03</span>
            <span className="hidden items-center gap-x-3 sm:flex">
              {HUD_METRICS.map((metric) => (
                <span key={metric}>{metric}</span>
              ))}
            </span>
            <span className="ml-auto text-mint-400">24 online</span>
          </p>
        </div>
      </div>
    </section>
  );
}
