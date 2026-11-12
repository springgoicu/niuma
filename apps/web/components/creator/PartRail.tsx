'use client';

import { EYEWEAR_IDS, HAIR_IDS, HEADWEAR_IDS, NECKWEAR_IDS, PATTERN_IDS, SNOUT_IDS, TAIL_IDS } from '@niuma/shared-types';
import {
  PART_META,
  extraOptions,
  partItemLabel,
  partValue,
  useCreatorStore,
  type CosmeticKind,
  type PartKey,
} from '@/lib/creator-store';
import { AtelierRule } from './Atelier';
import type { CreatorTab } from './CreatorTabs';

/** 选项按钮：中文标签走正文字体，1px 描边，选中只换色相不换体积 */
function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 cursor-pointer items-center border px-2.5 text-left text-[12px] leading-none transition-colors duration-150 xl:h-8 ${
        active
          ? 'border-mint-400/70 bg-mint-400/[0.08] text-mint-400'
          : 'border-ink-700 bg-ink-950/40 text-mist-300 hover:border-ink-500 hover:bg-ink-800/60 hover:text-mist-100'
      }`}
    >
      {label}
    </button>
  );
}

/** 分组标题同时是「聚焦」入口：点标题也能把右侧面板切到这一项 */
function Group({
  title,
  hint,
  focused,
  onFocus,
  children,
}: {
  title: string;
  hint: string;
  focused: boolean;
  onFocus: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 xl:mt-5">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <button
          type="button"
          onClick={onFocus}
          className="group flex min-h-6 cursor-pointer items-center gap-2 py-1.5 text-left xl:min-h-0 xl:py-0"
        >
          <span
            className={`h-1 w-1 shrink-0 transition-colors duration-150 ${focused ? 'bg-mint-400' : 'bg-ink-500'}`}
            aria-hidden
          />
          <h3
            className={`text-[12px] font-medium tracking-[0.06em] transition-colors duration-150 ${
              focused ? 'text-mint-400' : 'text-mist-100 group-hover:text-mint-400'
            }`}
          >
            {title}
          </h3>
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">{hint}</span>
      </div>
      <AtelierRule ornament={false} />
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">{children}</div>
    </section>
  );
}

/**
 * 左栏：工种与配件。
 * 手机端由 `mobileTab` 决定露哪一半——同一份 DOM，切标签只换 class，不重建控件。
 */
export function PartRail({ mobileTab, className = '' }: { mobileTab?: CreatorTab; className?: string }) {
  const appearance = useCreatorStore((s) => s.appearance);
  const activePart = useCreatorStore((s) => s.activePart);
  const setActivePart = useCreatorStore((s) => s.setActivePart);
  const setSpecies = useCreatorStore((s) => s.setSpecies);
  const setPattern = useCreatorStore((s) => s.setPattern);
  const setSnout = useCreatorStore((s) => s.setSnout);
  const setExtra = useCreatorStore((s) => s.setExtra);
  const setTail = useCreatorStore((s) => s.setTail);
  const setCosmetic = useCreatorStore((s) => s.setCosmetic);

  const showSpecies = !mobileTab || mobileTab === 'species';
  const showParts = !mobileTab || mobileTab === 'parts';

  const partGroup = (part: PartKey, catalog: readonly string[], pick: (id: string, index: number) => void) => {
    const current = partValue(appearance, part);
    // 角与鬃毛共用一个槽位，标题按物种读，别让牛长「鬃毛」
    const title = part === 'extra' ? (appearance.species === 'cow' ? '角' : '鬃毛') : PART_META[part].label;
    return (
      <Group
        title={title}
        hint={PART_META[part].hint}
        focused={activePart === part}
        onFocus={() => setActivePart(part)}
      >
        {catalog.map((id, index) => (
          <Chip
            key={id}
            active={current === id}
            label={partItemLabel(appearance.species, part, id)}
            onClick={() => {
              pick(id, index);
              setActivePart(part);
            }}
          />
        ))}
      </Group>
    );
  };

  const cosmeticGroup = (kind: CosmeticKind, catalog: readonly string[]) =>
    partGroup(kind, catalog, (id) => setCosmetic(kind, id));

  return (
    <aside className={`panel panel-atelier p-5 ${className}`}>
      <div className={showSpecies ? '' : 'hidden xl:block'}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-[17px] font-semibold tracking-[0.08em] text-mist-100">工种</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">species</span>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-1.5">
          {(['cow', 'horse'] as const).map((species) => {
            const active = appearance.species === species;
            return (
              <button
                key={species}
                type="button"
                aria-pressed={active}
                onClick={() => setSpecies(species)}
                className={`relative flex cursor-pointer flex-col border px-3.5 py-3 text-left transition-colors duration-150 ${
                  active
                    ? 'border-mint-400/70 bg-mint-400/[0.07]'
                    : 'border-ink-700 bg-ink-950/40 hover:border-ink-500 hover:bg-ink-800/50'
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute right-2.5 top-2.5 h-1.5 w-1.5 transition-colors duration-150 ${
                    active ? 'bg-mint-400' : 'bg-ink-600'
                  }`}
                />
                <span className="block font-display text-[30px] font-bold leading-none text-mist-100">
                  {species === 'cow' ? '牛' : '马'}
                </span>
                <span className="mt-2 block font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
                  {species === 'cow' ? 'bos taurus' : 'equus ferus'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={showParts ? 'mt-2' : 'hidden xl:mt-2 xl:block'}>
        {partGroup('pattern', PATTERN_IDS, (_id, index) => setPattern(index))}
        {partGroup('snout', SNOUT_IDS, (_id, index) => setSnout(index))}
        {partGroup('extra', extraOptions(appearance.species), (_id, index) => setExtra(index))}
        {partGroup('tail', TAIL_IDS, (_id, index) => setTail(index))}

        {cosmeticGroup('headwear', HEADWEAR_IDS)}
        {cosmeticGroup('eyewear', EYEWEAR_IDS)}
        {cosmeticGroup('neckwear', NECKWEAR_IDS)}
        {cosmeticGroup('hairstyle', HAIR_IDS)}

        <p className="mt-6 border-t border-ink-700/70 pt-4 text-[11px] leading-[1.7] text-mist-400">
          角与鬃毛共用一个线协议字节槽位，按物种解释；每个属性都有自己的颜色，点分组标题可把右侧面板切到这一项。
        </p>
      </div>
    </aside>
  );
}
