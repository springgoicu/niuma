import type { CSSProperties } from 'react';

/**
 * 妆造层的三个小件：只在捏人页出现，全部无状态、无副作用。
 * 装饰一律 aria-hidden —— 屏读用户不需要知道镜框和花瓣。
 */

/**
 * 两端淡出的金色细线。
 * `ornament` 默认开：中点再嵌一枚菱形金饰，只给区块级分隔用；
 * 组内密集分隔（左栏那 8 组）传 false，免得一排小金点变成噪声。
 */
export function AtelierRule({ ornament = true, className = '' }: { ornament?: boolean; className?: string }) {
  return <div aria-hidden className={`atelier-rule ${ornament ? '' : 'atelier-rule-plain'} ${className}`} />;
}

/** 四角星芒：颜色交给调用方的 bg-*，尺寸交给 h-* / w-* */
export function AtelierStar({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`atelier-star inline-block shrink-0 ${className}`} />;
}

/** 面板眉标：拉丁衬线一句 + 一道短线 + 中文小字 */
export function AtelierEyebrow({
  latin,
  hint,
  className = '',
}: {
  latin: string;
  hint: string;
  className?: string;
}) {
  return (
    <p className={`flex items-center gap-2 ${className}`}>
      <span className="font-editorial text-[13px] leading-none italic tracking-[0.3em] text-blush-300">{latin}</span>
      <span className="h-px w-4 bg-gilt-400/40" aria-hidden />
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">{hint}</span>
    </p>
  );
}

/** 五片花瓣的参数：错开周期与横向漂移，才不会读成一条上移的点阵 */
const PETALS = [
  { left: '16%', bottom: '18%', delay: '0s', duration: '19s', sway: '16px', peak: 0.34, size: 3 },
  { left: '33%', bottom: '9%', delay: '3.4s', duration: '22s', sway: '-12px', peak: 0.26, size: 2 },
  { left: '52%', bottom: '22%', delay: '7.1s', duration: '24s', sway: '10px', peak: 0.3, size: 3 },
  { left: '71%', bottom: '12%', delay: '1.8s', duration: '20s', sway: '-18px', peak: 0.24, size: 2 },
  { left: '86%', bottom: '26%', delay: '5.6s', duration: '23s', sway: '12px', peak: 0.3, size: 3 },
];

/**
 * 预览台后方的花瓣层。
 * 只动 transform / opacity，`pointer-events-none` 让画布照常接收指针；
 * reduced-motion 下由 globals 的全局规则把动画归零，基态 opacity: 0 即隐形。
 */
export function AtelierPetals({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {PETALS.map((petal) => (
        <span
          key={`${petal.left}-${petal.delay}`}
          className="animate-petal absolute block bg-blush-400"
          style={
            {
              left: petal.left,
              bottom: petal.bottom,
              width: petal.size,
              height: petal.size,
              '--petal-delay': petal.delay,
              '--petal-duration': petal.duration,
              '--petal-sway': petal.sway,
              '--petal-peak': petal.peak,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
