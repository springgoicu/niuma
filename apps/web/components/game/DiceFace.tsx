'use client';

/**
 * 一颗像素骰（ADR-0110）：亮牌前是暗色的「?」，亮牌后按点数画九宫格点阵。
 *
 * 与结算单共用同一套骰面，避免「桌上是数字、小票上是点阵」的两副牌。
 */
const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DiceFace({
  value,
  dim = false,
  size = 'md',
}: {
  /** 0 表示还没亮牌 */
  value: number;
  /** 结算单里看历史局时压暗，避免读成当前局 */
  dim?: boolean;
  size?: 'md' | 'lg';
}) {
  const pips = PIPS[value] ?? [];
  const box = size === 'lg' ? 'h-9 w-9 p-[3px]' : 'h-8 w-8 p-[3px]';
  return (
    <span
      className={`grid shrink-0 grid-cols-3 grid-rows-3 place-items-center border-2 ${box} ${
        pips.length > 0 ? 'border-mist-100 bg-mist-100' : 'border-ink-600 bg-ink-800'
      } ${dim ? 'opacity-60' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={`h-[3px] w-[3px] ${pips.includes(index) ? 'bg-ink-900' : 'bg-transparent'}`}
        />
      ))}
    </span>
  );
}
