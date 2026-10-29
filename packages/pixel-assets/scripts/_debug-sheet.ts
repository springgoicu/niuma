/** 临时调试脚本：把指定帧放大拼成一张图，供人眼检查造型与动画节奏。用完即删。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodePng } from '../src/png';
import { drawFrame, type FrameSpec, type SpeciesName } from '../src/quadruped';
import { SLOT_TABLE, type LayerName } from '../src/palette';
import { FRAME_SIZE } from '../src/layout';

const COLORS: Record<LayerName, number> = {
  body: 0xf3efe4,
  pattern: 0x2a2622,
  bodyLight: 0xfffdf7,
  hoof: 0x3a3532,
  eyes: 0x1d1a17,
  eyeLight: 0xfffdf7,
  extra: 0xe6d6b4,
  snout: 0xd9d2c2,
};

const HORSE: Record<LayerName, number> = {
  body: 0xa96c3c,
  pattern: 0xf0ebdf,
  bodyLight: 0xd9a273,
  hoof: 0x4a3b2e,
  eyes: 0x1d1a17,
  eyeLight: 0xfffdf7,
  extra: 0x3b2a1d,
  snout: 0x8a552c,
};

const SCALE = 6;

function sheet(species: SpeciesName, direction: 0 | 1 | 2 | 3, columns: number[], pattern: number, extra: number): Uint8Array {
  const w = FRAME_SIZE * SCALE * columns.length;
  const h = FRAME_SIZE * SCALE;
  const out = new Uint8Array(w * h * 4);
  const colors = species === 'cow' ? COLORS : HORSE;
  columns.forEach((column, index) => {
    const spec: FrameSpec = { species, direction, column, tail: 0, pattern, extra, snout: 0 };
    const px = drawFrame(spec);
    for (let y = 0; y < FRAME_SIZE; y += 1) {
      for (let x = 0; x < FRAME_SIZE; x += 1) {
        const info = SLOT_TABLE[px.data[y * FRAME_SIZE + x]!];
        if (!info) continue;
        const color = colors[info.layer];
        const k = info.luma / 255;
        const r = Math.round(((color >> 16) & 0xff) * k);
        const g = Math.round(((color >> 8) & 0xff) * k);
        const b = Math.round((color & 0xff) * k);
        for (let sy = 0; sy < SCALE; sy += 1) {
          for (let sx = 0; sx < SCALE; sx += 1) {
            const tx = (index * FRAME_SIZE + x) * SCALE + sx;
            const ty = y * SCALE + sy;
            const i = (ty * w + tx) * 4;
            out[i] = r;
            out[i + 1] = g;
            out[i + 2] = b;
            out[i + 3] = 255;
          }
        }
      }
    }
    // 帧分隔线
    if (index > 0) {
      for (let ty = 0; ty < h; ty += 1) {
        const i = (ty * w + index * FRAME_SIZE * SCALE) * 4;
        out[i] = 90;
        out[i + 1] = 90;
        out[i + 2] = 90;
        out[i + 3] = 255;
      }
    }
  });
  return out;
}

const OUT = resolve(process.env.TEMP ?? '.', 'niuma-preview');
await mkdir(OUT, { recursive: true });

function closeup(species: SpeciesName, direction: 0 | 1 | 2 | 3, column: number, pattern: number, extra: number): Uint8Array {
  const S2 = 14;
  const w = FRAME_SIZE * S2;
  const out = new Uint8Array(w * w * 4);
  const colors = species === 'cow' ? COLORS : HORSE;
  const px = drawFrame({ species, direction, column, tail: 0, pattern, extra, snout: 0 });
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    for (let x = 0; x < FRAME_SIZE; x += 1) {
      const info = SLOT_TABLE[px.data[y * FRAME_SIZE + x]!];
      const color = info ? colors[info.layer] : 0x1b2430;
      const k = info ? info.luma / 255 : 1;
      for (let sy = 0; sy < S2; sy += 1) {
        for (let sx = 0; sx < S2; sx += 1) {
          const i = ((y * S2 + sy) * w + x * S2 + sx) * 4;
          out[i] = Math.round(((color >> 16) & 0xff) * k);
          out[i + 1] = Math.round(((color >> 8) & 0xff) * k);
          out[i + 2] = Math.round((color & 0xff) * k);
          out[i + 3] = 255;
        }
      }
    }
  }
  return out;
}

await writeFile(
  resolve(OUT, 'closeup-cow-side.png'),
  encodePng(FRAME_SIZE * 14, FRAME_SIZE * 14, closeup('cow', 2, 4, 1, 1)),
);
await writeFile(
  resolve(OUT, 'closeup-cow-front.png'),
  encodePng(FRAME_SIZE * 14, FRAME_SIZE * 14, closeup('cow', 0, 0, 1, 1)),
);
await writeFile(
  resolve(OUT, 'closeup-horse-side.png'),
  encodePng(FRAME_SIZE * 14, FRAME_SIZE * 14, closeup('horse', 2, 4, 1, 1)),
);

const WALK = [3, 4, 5, 6, 7, 8];
const IDLE = [0, 1, 2, 9, 10, 11, 12, 13, 14, 15];

for (const species of ['cow', 'horse'] as SpeciesName[]) {
  const walk = sheet(species, 2, WALK, 1, 1);
  await writeFile(resolve(OUT, `${species}-walk-right.png`), encodePng(FRAME_SIZE * SCALE * WALK.length, FRAME_SIZE * SCALE, walk));
  const front = sheet(species, 0, IDLE, 1, 1);
  await writeFile(resolve(OUT, `${species}-front-set.png`), encodePng(FRAME_SIZE * SCALE * IDLE.length, FRAME_SIZE * SCALE, front));
  const back = sheet(species, 3, [0, 9, 11], 1, 1);
  await writeFile(resolve(OUT, `${species}-back.png`), encodePng(FRAME_SIZE * SCALE * 3, FRAME_SIZE * SCALE, back));
}

console.log(`[debug] -> ${OUT}`);
