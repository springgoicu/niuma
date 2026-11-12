'use client';

import { Rectangle, type Application, type Texture } from 'pixi.js';
import { bake } from '../terrain-textures';

/**
 * 所有点光源共用的一张光斑：32×32 的径向渐变，4 阶量化 + Bayer 4×4 抖动。
 *
 * 为什么不是平滑径向渐变：光图只有视口的 1/4，放大后平滑渐变会被最近邻采样
 * 拉成一块块色阶；先在源图里把色阶做成「有意的抖动」，放大后读起来是像素颗粒，
 * 而不是低分辨率的 banding。
 *
 * 为什么只有一张：同纹理、同混合模式的 Sprite 才能被 Pixi 批处理器合并成一次绘制。
 */

export const LIGHT_TEXTURE_SIZE = 32;

/** 4×4 Bayer 矩阵：0..15 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export function bakeLightTexture(renderer: Application['renderer']): Texture {
  return bake(
    renderer,
    (g) => {
      const size = LIGHT_TEXTURE_SIZE;
      const half = size / 2;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = (x + 0.5 - half) / half;
          const dy = (y + 0.5 - half) / half;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= 1) continue;
          // 四阶：中心、内环、中环、外缘；灯心不画到全白，留一点给 intensity
          const quantized = Math.round((1 - distance) * 4) / 4;
          const dither = (BAYER[y & 3]![x & 3]! / 16 - 0.5) * 0.12;
          const alpha = Math.max(0, Math.min(1, quantized * 0.92 + dither));
          if (alpha < 0.02) continue;
          g.rect(x, y, 1, 1).fill({ color: 0xffffff, alpha });
        }
      }
    },
    // 固定画布框：不传 frame 时 generateTexture 会裁到内容包围盒，圆心会偏
    { frame: new Rectangle(0, 0, LIGHT_TEXTURE_SIZE, LIGHT_TEXTURE_SIZE) },
  );
}
