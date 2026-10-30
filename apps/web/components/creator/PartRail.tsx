'use client';

import { BACK_IDS, EYEWEAR_IDS, HEADWEAR_IDS, NECKWEAR_IDS, PATTERN_IDS, SNOUT_IDS, TAIL_IDS } from '@niuma/shared-types';
import { useCreatorStore, extraLabel, extraOptions, type CosmeticKind } from '@/lib/creator-store';

const PATTERN_LABELS = ['无斑纹', '奶牛斑块', '马蹄踏雪'];
const SNOUT_LABELS = ['宽牛吻', '狭长马吻'];
const TAIL_LABELS = ['短尾穗', '长尾'];
const HEADWEAR_LABELS = ['不戴', '学士帽', '鸭舌帽', '贝雷帽', '安全帽', '礼帽'];
const EYEWEAR_LABELS = ['不戴', '圆框眼镜', '墨镜', '单眼镜'];
const NECKWEAR_LABELS = ['不戴', '围巾', '项圈', '挂脖耳机'];
const BACK_LABELS = ['空手', '电脑包', '公文包'];

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer border-2 px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors duration-150 ${
        active
          ? 'border-mint-400 bg-mint-400/10 text-mint-400'
          : 'border-ink-600 bg-ink-950/60 text-mist-300 hover:border-ink-500 hover:text-mist-100'
      }`}
    >
      {label}
    </button>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-mist-500">{title}</h3>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-500">{hint}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

export function PartRail() {
  const appearance = useCreatorStore((s) => s.appearance);
  const setSpecies = useCreatorStore((s) => s.setSpecies);
  const setPattern = useCreatorStore((s) => s.setPattern);
  const setSnout = useCreatorStore((s) => s.setSnout);
  const setExtra = useCreatorStore((s) => s.setExtra);
  const setTail = useCreatorStore((s) => s.setTail);
  const setCosmetic = useCreatorStore((s) => s.setCosmetic);

  const extras = extraOptions(appearance.species);
  const currentExtra = appearance.species === 'cow' ? appearance.parts.hornId ?? 1 : appearance.parts.maneId ?? 1;

  const cosmeticGroup = (title: string, hint: string, kind: CosmeticKind, catalog: readonly string[], labels: string[], current: string | undefined) => (
    <Group title={title} hint={hint}>
      {catalog.map((id, index) => (
        <Chip
          key={id}
          active={(current ?? 'none') === id}
          label={labels[index] ?? id}
          onClick={() => setCosmetic(kind, id)}
        />
      ))}
    </Group>
  );

  return (
    <aside className="panel panel-scan p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold tracking-wide text-mist-100">工种</h2>
        <span className="tag">species</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(['cow', 'horse'] as const).map((species) => (
          <button
            key={species}
            type="button"
            aria-pressed={appearance.species === species}
            onClick={() => setSpecies(species)}
            className={`cursor-pointer border-2 px-4 py-4 text-left transition-colors duration-150 ${
              appearance.species === species
                ? 'border-mint-400 bg-mint-400/10'
                : 'border-ink-600 bg-ink-950/60 hover:border-ink-500'
            }`}
          >
            <span className="block font-display text-3xl font-bold leading-none text-mist-100">
              {species === 'cow' ? '牛' : '马'}
            </span>
            <span className="mt-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">
              {species === 'cow' ? 'bos taurus' : 'equus ferus'}
            </span>
          </button>
        ))}
      </div>

      <Group title="斑纹" hint="pattern">
        {PATTERN_IDS.map((_, index) => (
          <Chip
            key={index}
            active={appearance.parts.patternId === index}
            label={PATTERN_LABELS[index] ?? `#${index}`}
            onClick={() => setPattern(index)}
          />
        ))}
      </Group>

      <Group title="口鼻" hint="snout">
        {SNOUT_IDS.map((_, index) => (
          <Chip
            key={index}
            active={appearance.parts.snoutId === index}
            label={SNOUT_LABELS[index] ?? `#${index}`}
            onClick={() => setSnout(index)}
          />
        ))}
      </Group>

      <Group title={appearance.species === 'cow' ? '角' : '鬃毛'} hint="extra">
        {extras.map((_, index) => (
          <Chip
            key={index}
            active={currentExtra === index}
            label={extraLabel(appearance.species, index)}
            onClick={() => setExtra(index)}
          />
        ))}
      </Group>

      <Group title="尾巴" hint="tail">
        {TAIL_IDS.map((_, index) => (
          <Chip
            key={index}
            active={appearance.parts.tailId === index}
            label={TAIL_LABELS[index] ?? `#${index}`}
            onClick={() => setTail(index)}
          />
        ))}
      </Group>

      {cosmeticGroup('头饰', 'head', 'headwear', HEADWEAR_IDS, HEADWEAR_LABELS, appearance.cosmetics.headwear)}
      {cosmeticGroup('眼镜', 'eyes', 'eyewear', EYEWEAR_IDS, EYEWEAR_LABELS, appearance.cosmetics.eyewear)}
      {cosmeticGroup('颈饰', 'neck', 'neckwear', NECKWEAR_IDS, NECKWEAR_LABELS, appearance.cosmetics.neckwear)}
      {cosmeticGroup('背上', 'back', 'backItem', BACK_IDS, BACK_LABELS, appearance.cosmetics.backItem)}

      <p className="mt-6 border-t-2 border-ink-700 pt-4 font-mono text-[10px] leading-relaxed text-mist-500">
        角与鬃毛共用一个线协议字节槽位，按物种解释；切换物种会保留配色，但配件回到默认。
      </p>
    </aside>
  );
}
