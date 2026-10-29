import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodePng } from '../src/png';
import { COLUMNS, FRAME_SIZE, ROWS, drawFrame, type FrameSpec, type SpeciesName } from '../src/quadruped';
import { LAYERS, SLOT_TABLE, type LayerName } from '../src/palette';
import { COSMETIC_CATALOG, COSMETIC_SIZE, drawCosmetic } from '../src/cosmetics';

const OUT_DIR = resolve(import.meta.dir, '../../../apps/web/public/sprites');
const ATLAS_W = FRAME_SIZE * COLUMNS;
const ATLAS_H = FRAME_SIZE * ROWS;

const SPECIES: SpeciesName[] = ['cow', 'horse'];
const EXTRA_COUNT: Record<SpeciesName, number> = { cow: 4, horse: 3 };
const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;

interface RenderOptions {
  tail: number;
  pattern: number;
  extra: number;
  snout: number;
}

type LayerAtlas = Map<LayerName, Uint8Array>;

function renderAtlas(species: SpeciesName, options: RenderOptions): LayerAtlas {
  const layers: LayerAtlas = new Map();
  for (const layer of LAYERS) layers.set(layer, new Uint8Array(ATLAS_W * ATLAS_H * 4));

  for (let direction = 0; direction < 4; direction += 1) {
    for (let frame = 0; frame < 8; frame += 1) {
      const spec: FrameSpec = {
        species,
        direction: direction as 0 | 1 | 2 | 3,
        frame,
        tail: options.tail,
        pattern: options.pattern,
        extra: options.extra,
        snout: options.snout,
      };
      const px = drawFrame(spec);
      const ox = frame * FRAME_SIZE;
      const oy = direction * FRAME_SIZE;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const slot = px.data[y * FRAME_SIZE + x]!;
          const info = SLOT_TABLE[slot];
          if (!info) continue;
          const target = layers.get(info.layer)!;
          const index = ((oy + y) * ATLAS_W + ox + x) * 4;
          target[index] = info.luma;
          target[index + 1] = info.luma;
          target[index + 2] = info.luma;
          target[index + 3] = 255;
        }
      }
    }
  }
  return layers;
}

/** 落地页用的默认配色预览图（与 shared-types 的 DEFAULT_APPEARANCE 对齐） */
const PREVIEW_COLORS: Record<SpeciesName, Record<LayerName, number>> = {
  cow: {
    body: 0xf3efe4,
    pattern: 0x2a2622,
    hoof: 0x3a3532,
    eyes: 0x1d1a17,
    extra: 0xe6d6b4,
    snout: 0xd9d2c2,
  },
  horse: {
    body: 0xa96c3c,
    pattern: 0xf0ebdf,
    hoof: 0x4a3b2e,
    eyes: 0x1d1a17,
    extra: 0x3b2a1d,
    snout: 0x8a552c,
  },
};

function renderPreview(species: SpeciesName): Uint8Array {
  const px = drawFrame({ species, direction: 0, frame: 0, tail: 0, pattern: 1, extra: 1, snout: 0 });
  const rgba = new Uint8Array(FRAME_SIZE * FRAME_SIZE * 4);
  for (let i = 0; i < px.data.length; i += 1) {
    const info = SLOT_TABLE[px.data[i]!];
    if (!info) continue;
    const color = PREVIEW_COLORS[species][info.layer];
    const k = info.luma / 255;
    rgba[i * 4] = Math.round(((color >> 16) & 0xff) * k);
    rgba[i * 4 + 1] = Math.round(((color >> 8) & 0xff) * k);
    rgba[i * 4 + 2] = Math.round((color & 0xff) * k);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

async function writeLayer(species: SpeciesName, layer: LayerName, fileName: string, atlas: LayerAtlas): Promise<string> {
  const rgba = atlas.get(layer)!;
  const png = encodePng(ATLAS_W, ATLAS_H, rgba);
  const dir = resolve(OUT_DIR, species);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, fileName), png);
  return `${species}/${fileName}`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const started = Date.now();

  const manifest: Record<string, unknown> = {
    frame: { w: FRAME_SIZE, h: FRAME_SIZE, columns: COLUMNS, rows: ROWS },
    directions: DIRECTIONS,
    clips: {
      idle: { frames: [0, 1], fps: 2.5 },
      walk: { frames: [2, 3, 4, 5], fps: 9 },
      sit: { frames: [6], fps: 0 },
      lie: { frames: [7], fps: 0 },
    },
    origin: { x: FRAME_SIZE / 2, y: 45 },
    /** 配件图标边长；客户端按 1:1 叠加，不做亚像素缩放 */
    cosmeticSize: COSMETIC_SIZE,
    species: {} as Record<string, unknown>,
    cosmeticAnchors: {
      down: { badge: [0, -21], tie: [0, -16], mouth: [0, -25], back: [0, -22] },
      up: { badge: [0, -21], tie: [0, -16], mouth: [0, -25], back: [0, -22] },
      left: { badge: [-4, -20], tie: [-3, -16], mouth: [-12, -25], back: [8, -22] },
      right: { badge: [4, -20], tie: [3, -16], mouth: [12, -25], back: [-8, -22] },
    },
    cosmetics: COSMETIC_CATALOG,
  };

  for (const species of SPECIES) {
    const entry: Record<string, unknown> = {};
    const base = renderAtlas(species, { tail: 0, pattern: 0, extra: 0, snout: 0 });

    const bodies: string[] = [];
    for (let tail = 0; tail < 2; tail += 1) {
      const atlas = tail === 0 ? base : renderAtlas(species, { tail, pattern: 0, extra: 0, snout: 0 });
      bodies.push(await writeLayer(species, 'body', `body-${tail}.png`, atlas));
    }
    entry.body = bodies;

    const patterns = [''];
    for (let pattern = 1; pattern < 3; pattern += 1) {
      const atlas = renderAtlas(species, { tail: 0, pattern, extra: 0, snout: 0 });
      patterns.push(await writeLayer(species, 'pattern', `pattern-${pattern}.png`, atlas));
    }
    entry.pattern = patterns;

    entry.hoof = [await writeLayer(species, 'hoof', 'hoof.png', base)];
    entry.eyes = [await writeLayer(species, 'eyes', 'eyes.png', base)];

    const snouts: string[] = [];
    for (let snout = 0; snout < 2; snout += 1) {
      const atlas = snout === 0 ? base : renderAtlas(species, { tail: 0, pattern: 0, extra: 0, snout });
      snouts.push(await writeLayer(species, 'snout', `snout-${snout}.png`, atlas));
    }
    entry.snout = snouts;

    const extras: string[] = [];
    for (let extra = 0; extra < EXTRA_COUNT[species]; extra += 1) {
      const atlas = extra === 0 ? base : renderAtlas(species, { tail: 0, pattern: 0, extra, snout: 0 });
      extras.push(await writeLayer(species, 'extra', `extra-${extra}.png`, atlas));
    }
    entry.extra = extras;

    (manifest.species as Record<string, unknown>)[species] = entry;
  }

  for (const species of SPECIES) {
    const preview = renderPreview(species);
    await writeFile(resolve(OUT_DIR, `preview-${species}.png`), encodePng(FRAME_SIZE, FRAME_SIZE, preview));
  }
  manifest.preview = { cow: 'preview-cow.png', horse: 'preview-horse.png' };

  const cosmeticFiles: Record<string, Record<string, string | null>> = {};
  for (const [kind, ids] of Object.entries(COSMETIC_CATALOG)) {
    cosmeticFiles[kind] = { none: null };
    for (const id of ids) {
      const data = drawCosmetic(kind as keyof typeof COSMETIC_CATALOG, id);
      const dir = resolve(OUT_DIR, 'cos');
      await mkdir(dir, { recursive: true });
      const fileName = `${kind}-${id}.png`;
      await writeFile(resolve(dir, fileName), encodePng(COSMETIC_SIZE, COSMETIC_SIZE, data));
      cosmeticFiles[kind]![id] = `cos/${fileName}`;
    }
  }
  manifest.cosmeticFiles = cosmeticFiles;

  await writeFile(resolve(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const elapsed = Date.now() - started;
  console.log(`[pixel-assets] atlas ${ATLAS_W}x${ATLAS_H}, species=${SPECIES.length}, ${elapsed}ms -> ${OUT_DIR}`);
}

await main();
