import Link from 'next/link';
import { ArrowRight, Boxes, Database, EyeOff, Gauge, MousePointerClick, Network } from 'lucide-react';
import { CharacterSprite, type SiteSpecies } from './CharacterSprite';

interface SpeciesProfile {
  key: SiteSpecies;
  name: string;
  latin: string;
  color: string;
  blurb: string;
  stats: ReadonlyArray<readonly [string, number]>;
}

const SPECIES: SpeciesProfile[] = [
  {
    key: 'cow',
    name: '牛',
    latin: 'BOS TAURUS · 稳定输出型',
    color: '#f3efe4',
    blurb: '把稳定当美德。你的产能曲线像心电图一样平，但从不掉线。加班时你会安静地反刍，然后继续。',
    stats: [
      ['产能', 92],
      ['摸鱼', 38],
      ['咖啡耐受', 88],
    ] as const,
  },
  {
    key: 'horse',
    name: '马',
    latin: 'EQUUS FERUS · 高速迭代型',
    color: '#a96c3c',
    blurb: '跑得快，也想得多。你总在赶下一个会，并且真心相信这次能准点下班。鬃毛是你最后的体面。',
    stats: [
      ['产能', 76],
      ['摸鱼', 64],
      ['咖啡耐受', 55],
    ] as const,
  },
];

const BENEFITS = [
  '免费加班餐',
  '弹性下班（不存在）',
  '工位共享',
  '年度体检（自费）',
  '周末团建',
  '期权画饼',
  '打印机永远卡纸',
  '空调永远 26 度',
];

const BYTES: Array<[string, string, string]> = [
  ['0x01', 'op', '1'],
  ['0x1a 0x00', 'entity', '2'],
  ['0x40 0x80', 'x', '2'],
  ['0x20 0x40', 'y', '2'],
  ['0x25', 'state', '1'],
];

const METRICS = [
  { icon: Gauge, label: 'Tick 预算', value: '< 8 ms' },
  { icon: Network, label: '单客户端下行', value: '< 20 KB/s' },
  { icon: Boxes, label: '实体槽位', value: '1024' },
  { icon: Database, label: '持久化记录', value: '0' },
];

const RULES = [
  {
    icon: MousePointerClick,
    title: '不注册',
    body: '输入昵称直接进场。没有邮箱、没有验证码、没有「找回密码」的死亡循环。',
  },
  {
    icon: Database,
    title: '不落库',
    body: '世界只活在游戏进程内存里。进程一停，整层办公楼连同你的工位一起蒸发。',
  },
  {
    icon: EyeOff,
    title: '不留痕',
    body: '服务端不存任何数据。工牌与上次的落点只留在你自己的浏览器里，换设备就重新开始。',
  },
];

export function SpeciesSection() {
  return (
    <section id="species" className="relative border-b-2 border-ink-700 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">// 01 · roster</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl">
              选择你的工位形态
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-mist-300">
            两种物种，同一套 KPI。外观可以随便调——颜色、斑纹、口鼻、角或鬃毛、尾巴、头饰、眼镜、颈饰与发型，
            每一项都有自己的色槽。反正周五之前没人会看。
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {SPECIES.map((species) => (
            <article
              key={species.key}
              className="panel group relative overflow-hidden p-7 transition-colors duration-150 hover:border-mint-400/60"
            >
              <div className="flex items-start justify-between gap-6">
                <div>
                  <span className="tag">{species.latin}</span>
                  <h3 className="mt-4 font-display text-6xl font-bold leading-none text-mist-100">
                    {species.name}
                  </h3>
                </div>
                <div className="relative shrink-0 transition-transform duration-300 group-hover:-translate-y-1">
                  {/* 与首屏同一张图、同一套整数倍放大，只有尺寸不同 */}
                  <CharacterSprite species={species.key} size={128} alt={`${species.name}的默认外观`} />
                </div>
              </div>

              <p className="mt-6 max-w-md text-sm leading-relaxed text-mist-300">{species.blurb}</p>

              <dl className="mt-7 space-y-3">
                {species.stats.map(([label, value]) => (
                  <div key={label} className="flex items-center gap-3">
                    <dt className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-mist-500">
                      {label}
                    </dt>
                    <dd className="flex flex-1 items-center gap-3">
                      <div className="h-2 flex-1 border border-ink-600 bg-ink-950">
                        <div
                          className="h-full bg-mint-400/80"
                          style={{ width: `${value}%`, backgroundColor: species.color }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-[11px] text-mist-300">{value}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              <Link
                href={`/create?species=${species.key}`}
                className="mt-8 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-mint-400 transition-colors hover:text-lime-400"
              >
                以{species.name}的身份入职
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function BenefitsMarquee() {
  return (
    <div className="overflow-hidden border-b-2 border-ink-700 bg-ink-800/50 py-3.5">
      <div className="flex w-max animate-marquee items-center gap-10 whitespace-nowrap">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center gap-10" aria-hidden={copy === 1}>
            {BENEFITS.map((item) => (
              <span
                key={`${copy}-${item}`}
                className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.2em] text-mist-300"
              >
                {item}
                <span className="h-1.5 w-1.5 rotate-45 bg-mint-400/70" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TechSection() {
  return (
    <section id="tech" className="relative border-b-2 border-ink-700 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">// 02 · under the hood</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl">
              八字节，二十赫兹，<br />
              看不见的人不广播。
            </h2>
            <p className="mt-6 max-w-lg text-sm leading-relaxed text-mist-300">
              移动与动作走手写二进制帧，没有 JSON，没有轮询。服务端以 20Hz 固定 Tick 推进，
              空间哈希把世界切成 512px 的格子，只有落进你 900px 视野的人才会被写进你的包。
            </p>

            <div className="mt-8 grid grid-cols-2 gap-4">
              {METRICS.map((metric) => (
                <div key={metric.label} className="border-2 border-ink-700 bg-ink-800/40 p-4">
                  <metric.icon className="h-4 w-4 text-mint-400" />
                  <p className="mt-3 font-display text-xl font-semibold text-mist-100">{metric.value}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">
                    {metric.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel panel-scan p-6">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-mist-500">
              <span>packet / c2s_move</span>
              <span className="text-mint-400">8 bytes total</span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {BYTES.map(([hex, label, width]) => (
                <div key={label} className="min-w-[104px] flex-1 border-2 border-ink-600 bg-ink-950 p-3">
                  <p className="break-all font-mono text-[11px] text-mint-400">{hex}</p>
                  <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">
                    {label} · {width}B
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-2 border-t-2 border-ink-700 pt-5 font-mono text-[11px] leading-relaxed text-mist-300">
              <p>
                <span className="text-mist-500">fixed-point</span> 1/8 px · world 8192 × 8192
              </p>
              <p>
                <span className="text-mist-500">state</span> dir(2b) + pose(3b) + moving(1b)
              </p>
              <p>
                <span className="text-mist-500">aoi</span> cell 512px · radius 900px · spawn/despawn diff
              </p>
              <p>
                <span className="text-mist-500">palette</span> 6 灰度图层 × Sprite.tint · 合批零开销
              </p>
            </div>

            <div className="mt-6 flex items-center gap-2 border-2 border-mint-400/30 bg-mint-400/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-mint-400">
              <span className="h-1.5 w-1.5 animate-blink bg-mint-400" />
              websocket · binary · no json on the tick path
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function RulesSection() {
  return (
    <section id="rules" className="relative py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">// 03 · rules</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl">
              工位守则
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-mist-300">
              这是一个刻意做成「用完即弃」的园区。你不需要信任我们，因为服务器什么都没记住。
            </p>
            <Link href="/create" className="btn-primary mt-8">
              现在入职
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {RULES.map((rule, index) => (
              <div key={rule.title} className="border-2 border-ink-700 bg-ink-800/40 p-5">
                <div className="flex items-center justify-between">
                  <rule.icon className="h-5 w-5 text-mint-400" />
                  <span className="font-mono text-[10px] text-mist-500">0{index + 1}</span>
                </div>
                <h3 className="mt-5 font-display text-2xl font-semibold text-mist-100">{rule.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-mist-300">{rule.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
