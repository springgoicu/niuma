import { SPRITE_LAYOUT } from '@/lib/game/sprite-layout.generated';

/** 落地页出现的物种，键与 shared-types 的 DEFAULT_APPEARANCE 保持一致 */
export type SiteSpecies = 'cow' | 'horse';

/**
 * 默认外观图由 `pnpm assets` 用与游戏同一份 drawFrame 调色板导出。
 * 首屏、物种档案与入职页共用它，同一头牛才不会在上方和下方长成两个样。
 */
const PREVIEW: Record<SiteSpecies, string> = {
  cow: '/sprites/preview-cow.png',
  horse: '/sprites/preview-horse.png',
};

const FRAME = SPRITE_LAYOUT.frame.w;

/**
 * 最近邻放大只认整数倍：144 / 64 = 2.25 会让像素块宽窄不一，
 * 看起来像被浏览器缩放过的图，而不是像素画。
 */
export function pixelSize(size: number): number {
  return FRAME * Math.max(1, Math.round(size / FRAME));
}

interface CharacterSpriteProps {
  species: SiteSpecies;
  /** 期望边长，实际按帧边长的整数倍取整 */
  size: number;
  alt?: string;
  className?: string;
}

export function CharacterSprite({ species, size, alt = '', className = '' }: CharacterSpriteProps) {
  const px = pixelSize(size);
  return (
    <img
      src={PREVIEW[species]}
      alt={alt}
      width={px}
      height={px}
      draggable={false}
      className={`pixelated select-none ${className}`}
      style={{ width: px, height: px }}
    />
  );
}
