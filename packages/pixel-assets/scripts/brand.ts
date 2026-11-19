import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/png';
import { LOGO_SIZE, LOGO_TILE_HEX, drawLogo, logoRgba, type LogoFrame } from '../src/logo';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** 产物落在 public/brand：与 public/sprites 同级，不会被 generate.ts 的 rm -rf sprites 波及 */
const OUT_DIR = resolve(SCRIPT_DIR, '../../../apps/web/public/brand');
/** 校对图不进 public、不打进包，只给人眼验收用 */
const PROOF_DIR = resolve(SCRIPT_DIR, '../.proof');

/** 标签页三级图标 + 导航 48（含眨眼帧）+ iOS 主屏 + PWA 安装图标 */
const ICON_SIZES = [16, 32, 48] as const;
const APPLE_SIZE = 180;
const NAV_SIZE = 48;
/** PWA 安装图标：192 与 512 是 Chromium 的可安装判据下限，512 另出一张 maskable */
const PWA_ICON_SIZES = [192, 512] as const;
const MASKABLE_SIZE = 512;
/** maskable 的安全区是中心 80% 圆：16 × 20 = 320，四周留 96px 底板边，牛角不会被裁 */
const MASKABLE_SCALE = 20;

function hex(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function fill(dst: Uint8Array, width: number, height: number, color: number): void {
  const [r, g, b] = hex(color);
  for (let i = 0; i < width * height; i += 1) {
    dst[i * 4] = r;
    dst[i * 4 + 1] = g;
    dst[i * 4 + 2] = b;
    dst[i * 4 + 3] = 255;
  }
}

/**
 * 把 RGBA 图贴到不透明底上（源只有全透明或全不透明，等价于 source-over）。
 * iOS 主屏图标不能带透明：180 的余量用底板色补齐，四角切掉的像素也就自然消失。
 */
function blit(
  dst: Uint8Array,
  dstW: number,
  dstH: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  ox: number,
  oy: number,
): void {
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const i = (y * srcW + x) * 4;
      if (!src[i + 3]) continue;
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dstW || dy >= dstH) continue;
      const o = (dy * dstW + dx) * 4;
      dst[o] = src[i]!;
      dst[o + 1] = src[i + 1]!;
      dst[o + 2] = src[i + 2]!;
      dst[o + 3] = 255;
    }
  }
}

/**
 * 不透明方形图标：按整数倍居中贴图，四周用底板色补齐。
 *
 * 16 的整数倍尺寸（192 / 512）offset 为 0，就是一整块满幅图；
 * iOS 主屏的 180 = 16 × 11 + 2px 边，maskable 的 512 用 20 倍留出安全区。
 * 不做非整数缩放——硬缩会得到忽宽忽窄的像素块（ADR-0005）。
 */
function paddedIcon(size: number, scale: number, frame: LogoFrame = 'open'): Uint8Array {
  const inner = LOGO_SIZE * scale;
  const offset = Math.floor((size - inner) / 2);
  const out = new Uint8Array(size * size * 4);
  fill(out, size, size, LOGO_TILE_HEX);
  blit(out, size, size, logoRgba(drawLogo(frame), scale), inner, inner, offset, offset);
  return out;
}

/**
 * 校对图：睁眼与眨眼并排 8 倍，下面一行是 1× / 2× / 3× 的真实观感。
 * 「16px 还能不能读出牛角与耳标」只看 8 倍图是不够的，所以缩放阶梯也一起出。
 */
function proofSheet(): { width: number; height: number; rgba: Uint8Array } {
  const zoom = 8;
  const cell = LOGO_SIZE * zoom;
  const pad = 8;
  const ladder = [1, 2, 3] as const;
  const ladderWidth = ladder.reduce((sum, scale) => sum + LOGO_SIZE * scale + pad, pad);
  const width = pad + cell * 2 + pad + pad;
  const height = pad + cell + pad + LOGO_SIZE * 3 + pad;
  const sheet = new Uint8Array(width * height * 4);
  fill(sheet, width, height, 0x30362f);

  blit(sheet, width, height, logoRgba(drawLogo('open'), zoom), cell, cell, pad, pad);
  blit(sheet, width, height, logoRgba(drawLogo('blink'), zoom), cell, cell, pad + cell + pad, pad);

  let x = pad;
  const baseY = pad + cell + pad;
  for (const scale of ladder) {
    const size = LOGO_SIZE * scale;
    blit(sheet, width, height, logoRgba(drawLogo('open'), scale), size, size, x, baseY + LOGO_SIZE * 3 - size);
    x += size + pad;
  }

  return { width: Math.max(width, ladderWidth), height, rgba: sheet };
}

async function writeIcon(file: string, size: number, rgba: Uint8Array): Promise<void> {
  await writeFile(resolve(OUT_DIR, file), encodePng(size, size, rgba));
}

/** 由 `pnpm assets` 调用；直接 `bun scripts/brand.ts` 也能单独出图 */
export async function writeBrandAssets(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PROOF_DIR, { recursive: true });

  const open = drawLogo('open');
  for (const size of ICON_SIZES) {
    await writeIcon(`logo-${size}.png`, size, logoRgba(open, size / LOGO_SIZE));
  }
  await writeIcon(`logo-${NAV_SIZE}-blink.png`, NAV_SIZE, logoRgba(drawLogo('blink'), NAV_SIZE / LOGO_SIZE));
  await writeIcon(`logo-${APPLE_SIZE}.png`, APPLE_SIZE, paddedIcon(APPLE_SIZE, 11));
  for (const size of PWA_ICON_SIZES) {
    await writeIcon(`logo-${size}.png`, size, paddedIcon(size, size / LOGO_SIZE));
  }
  await writeIcon(`logo-${MASKABLE_SIZE}-maskable.png`, MASKABLE_SIZE, paddedIcon(MASKABLE_SIZE, MASKABLE_SCALE));

  const proof = proofSheet();
  await writeFile(resolve(PROOF_DIR, 'logo.png'), encodePng(proof.width, proof.height, proof.rgba));
}

if (import.meta.main) await writeBrandAssets();
