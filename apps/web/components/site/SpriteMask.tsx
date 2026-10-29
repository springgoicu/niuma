const FRAME = 48;
const COLUMNS = 8;

/** 只允许 48 的整数倍：非整数倍放大时 CSS mask 会落在半像素上，像素块就糊了 */
export function spriteZoom(size: number): number {
  return Math.min(4, Math.max(1, Math.round(size / FRAME)));
}

interface SpriteMaskProps {
  src: string;
  /** 0..31（4 方向 × 8 帧） */
  frame?: number;
  /** 期望尺寸的提示值，实际按 48 的整数倍取整 */
  size?: number;
  color: string;
  className?: string;
}

/**
 * 用 CSS mask 把灰度图层染成任意色，服务端渲染也能安全使用。
 * 避免为落地页额外生成一份全彩角色图。
 */
export function SpriteStack({
  layers,
  frame = 0,
  size = 72,
  color,
  className = '',
}: {
  layers: string[];
  frame?: number;
  size?: number;
  color: string;
  className?: string;
}) {
  const px = FRAME * spriteZoom(size);
  return (
    <div className={`relative ${className}`} style={{ width: px, height: px }}>
      {layers.map((src) => (
        <SpriteMask key={src} src={src} frame={frame} size={size} color={color} className="absolute inset-0" />
      ))}
    </div>
  );
}

export function SpriteMask({ src, frame = 0, size = 72, color, className = '' }: SpriteMaskProps) {
  const zoom = spriteZoom(size);
  const px = FRAME * zoom;
  const col = frame % COLUMNS;
  return (
    <div
      aria-hidden
      className={`pixelated ${className}`}
      style={{
        width: px,
        height: px,
        backgroundColor: color,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskSize: `${FRAME * COLUMNS * zoom}px ${FRAME * 4 * zoom}px`,
        maskSize: `${FRAME * COLUMNS * zoom}px ${FRAME * 4 * zoom}px`,
        WebkitMaskPosition: `${-col * px}px 0px`,
        maskPosition: `${-col * px}px 0px`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        // 0 模糊的硬投影：软光晕会顺着轮廓把像素边缘抹开
        filter: 'drop-shadow(2px 2px 0 rgba(79, 227, 193, 0.35))',
      }}
    />
  );
}
