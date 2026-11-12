import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodePng } from '../src/png';
import { drawFrame, landmarksOf, type FrameSpec, type SpeciesName } from '../src/quadruped';
import { LAYERS, SLOT_TABLE, type LayerName } from '../src/palette';
import {
  COSMETIC_CATALOG,
  COSMETIC_SIZE,
  drawCosmetic,
  mirrorCosmetic,
  type CosmeticDirection,
  type CosmeticKind,
} from '../src/cosmetics';
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  BLINK_COLUMN,
  CLIPS,
  COLUMNS,
  DIRECTIONS,
  FRAME_SIZE,
  ORIGIN,
  ROWS,
} from '../src/layout';
import { writeBrandAssets } from './brand';

const OUT_DIR = resolve(import.meta.dir, '../../../apps/web/public/sprites');
/** 校对图落点：不进 public、不打进包，只给人眼验收用 */
const PROOF_DIR = resolve(import.meta.dir, '../.proof');
/** 布局契约的落点：SSR 的 CSS mask 与客户端切片都读这一份，避免两边各写死一遍列数 */
const LAYOUT_TS = resolve(import.meta.dir, '../../../apps/web/lib/game/sprite-layout.generated.ts');

const SPECIES: SpeciesName[] = ['cow', 'horse'];
const EXTRA_COUNT: Record<SpeciesName, number> = { cow: 4, horse: 3 };
/**
 * 图集版本：写进 manifest 与 `sprite-layout.generated.ts`，客户端加载时逐字比对。
 *
 * v8：16-24 列由「张嘴呼叫」重绘为「后撤蓄力 / 前冲头槌 / 后坐力」，并带 1px 速度线。
 * 这些列的内容变了，缓存中的旧图集必须失效——版本号与列号是同一份契约。
 */
const ATLAS_VERSION = 8;

interface RenderOptions {
  tail: number;
  pattern: number;
  extra: number;
  snout: number;
}

type LayerAtlas = Map<LayerName, Uint8Array>;

function renderAtlas(species: SpeciesName, options: RenderOptions): LayerAtlas {
  const layers: LayerAtlas = new Map();
  for (const layer of LAYERS) layers.set(layer, new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4));

  for (let direction = 0; direction < 4; direction += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const spec: FrameSpec = {
        species,
        direction: direction as 0 | 1 | 2 | 3,
        column,
        tail: options.tail,
        pattern: options.pattern,
        extra: options.extra,
        snout: options.snout,
      };
      const px = drawFrame(spec);
      const ox = column * FRAME_SIZE;
      const oy = direction * FRAME_SIZE;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const slot = px.data[y * FRAME_SIZE + x]!;
          const info = SLOT_TABLE[slot];
          if (!info) continue;
          const target = layers.get(info.layer)!;
          const index = ((oy + y) * ATLAS_WIDTH + ox + x) * 4;
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

/** 与 apps/web/lib/color.ts 的 mixHex 同义：高光色由协议内的本体色派生，不额外占外观字段 */
function mixHex(base: number, tint: number, amount: number): number {
  const mix = (a: number, b: number) => {
    const channel = ((a >> 0) & 0xff) * (1 - amount) + (b & 0xff) * amount;
    return Math.round(channel);
  };
  const r = mix((base >> 16) & 0xff, (tint >> 16) & 0xff);
  const g = mix((base >> 8) & 0xff, (tint >> 8) & 0xff);
  const b = mix(base & 0xff, tint & 0xff);
  return (r << 16) | (g << 8) | b;
}

/** 落地页用的默认配色预览图（与 shared-types 的 DEFAULT_APPEARANCE 对齐） */
const PREVIEW_COLORS: Record<SpeciesName, Record<LayerName, number>> = {
  cow: {
    body: 0xf3efe4,
    pattern: 0x2a2622,
    bodyLight: mixHex(0xf3efe4, 0xffffff, 0.55),
    hoof: 0x3a3532,
    eyes: 0x1d1a17,
    eyeLight: mixHex(0x1d1a17, 0xffffff, 0.82),
    extra: 0xe6d6b4,
    snout: 0xd9d2c2,
    tail: 0xf3efe4,
  },
  horse: {
    body: 0xa96c3c,
    pattern: 0xf0ebdf,
    bodyLight: mixHex(0xa96c3c, 0xffffff, 0.34),
    hoof: 0x4a3b2e,
    eyes: 0x1d1a17,
    eyeLight: mixHex(0x1d1a17, 0xffffff, 0.82),
    extra: 0x3b2a1d,
    snout: 0x8a552c,
    tail: 0xa96c3c,
  },
};

function renderFrameRgba(species: SpeciesName, direction: number, column: number): Uint8Array {
  const px = drawFrame({
    species,
    direction: direction as 0 | 1 | 2 | 3,
    column,
    tail: 0,
    pattern: 1,
    extra: 1,
    snout: 0,
  });
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

function renderPreview(species: SpeciesName): Uint8Array {
  return renderFrameRgba(species, 0, 0);
}

/**
 * 校对图：把某一帧按整数倍最近邻放大贴进画布，用来目视检查造型与描边。
 * 只写到 packages/pixel-assets/.proof/，不进 public，也不会被客户端加载。
 */
function blitZoomed(
  dst: Uint8Array,
  dstW: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  ox: number,
  oy: number,
  zoom: number,
): void {
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const i = (y * srcW + x) * 4;
      const alpha = src[i + 3]!;
      if (alpha === 0) continue;
      for (let dy = 0; dy < zoom; dy += 1) {
        for (let dx = 0; dx < zoom; dx += 1) {
          const o = ((oy + y * zoom + dy) * dstW + ox + x * zoom + dx) * 4;
          dst[o] = src[i]!;
          dst[o + 1] = src[i + 1]!;
          dst[o + 2] = src[i + 2]!;
          dst[o + 3] = 255;
        }
      }
    }
  }
}

/**
 * 校对图专用：把灰度配件乘上一种代表色，模拟客户端的 Sprite.tint。
 * 不染色的话配件在深灰底上就是一坨白块，看不出四档明暗。
 */
function tintArt(src: Uint8Array, hex: number): Uint8Array {
  const out = Uint8Array.from(src);
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  for (let i = 0; i < out.length; i += 4) {
    if (!out[i + 3]) continue;
    const k = out[i]! / 255;
    out[i] = Math.round(r * k);
    out[i + 1] = Math.round(g * k);
    out[i + 2] = Math.round(b * k);
  }
  return out;
}

function fillRect(dst: Uint8Array, dstW: number, w: number, h: number, x0: number, y0: number, hex: number): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const o = (y * dstW + x) * 4;
      dst[o] = (hex >> 16) & 0xff;
      dst[o + 1] = (hex >> 8) & 0xff;
      dst[o + 2] = hex & 0xff;
      dst[o + 3] = 255;
    }
  }
}

/** 接触表：四向 × 十六列，3 倍放大；背景用中性深灰，浅色牛与深色马都能看清描边 */
async function writeProof(): Promise<void> {
  const zoom = 3;
  const pad = 6;
  const cell = FRAME_SIZE * zoom;
  const width = pad + COLUMNS * (cell + pad);
  const height = pad + ROWS * (cell + pad);
  const sheet = new Uint8Array(width * height * 4);
  fillRect(sheet, width, width, height, 0, 0, 0x30362f);
  for (const species of SPECIES) {
    for (let direction = 0; direction < ROWS; direction += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const rgba = renderFrameRgba(species, direction, column);
        blitZoomed(sheet, width, rgba, FRAME_SIZE, FRAME_SIZE, pad + column * (cell + pad), pad + direction * (cell + pad), zoom);
      }
    }
    await mkdir(PROOF_DIR, { recursive: true });
    await writeFile(resolve(PROOF_DIR, `sheet-${species}.png`), encodePng(width, height, sheet));
  }

  // 比例校对：牛马并排、同一脚底线、6 倍放大，专门用来判断「一样高但一眼分得开」
  const scale = 6;
  const unit = FRAME_SIZE * scale;
  const gap = 12;
  const pw = unit * 2 + gap * 3;
  const ph = unit + gap * 2;
  const pair = new Uint8Array(pw * ph * 4);
  fillRect(pair, pw, pw, ph, 0, 0, 0x30362f);
  fillRect(pair, pw, pw, ph, gap, ph - gap - 2, 0x4a5348);
  SPECIES.forEach((species, index) => {
    blitZoomed(pair, pw, renderFrameRgba(species, 0, 0), FRAME_SIZE, FRAME_SIZE, gap + index * (unit + gap), gap, scale);
  });
  await writeFile(resolve(PROOF_DIR, 'pair.png'), encodePng(pw, ph, pair));

  // 配件校对：每个类别 × 朝向一行，一眼看出帽檐 / 镜圈 / 颈线是否压在同一条基准上
  const cosZoom = 4;
  const cosCell = COSMETIC_SIZE * cosZoom;
  const cosPad = 4;
  const rows: Array<{ kind: CosmeticKind; dir: CosmeticDirection }> = [];
  for (const kind of Object.keys(COSMETIC_CATALOG) as CosmeticKind[]) {
    const dirs: CosmeticDirection[] = kind === 'eyes' ? ['down', 'side'] : ['down', 'side', 'up'];
    for (const dir of dirs) rows.push({ kind, dir });
  }
  const maxIds = Math.max(...Object.values(COSMETIC_CATALOG).map((ids) => ids.length));
  const cw = cosPad + maxIds * (cosCell + cosPad);
  const chh = cosPad + rows.length * (cosCell + cosPad);
  const cosSheet = new Uint8Array(cw * chh * 4);
  fillRect(cosSheet, cw, cw, chh, 0, 0, 0x30362f);
  const proofTint: Record<CosmeticKind, number> = {
    head: 0x4fe3c1,
    eyes: 0x9fb0a1,
    neck: 0xff8a6b,
    hair: 0xffc53d,
  };
  rows.forEach((row, rowIndex) => {
    const ids = COSMETIC_CATALOG[row.kind] as readonly string[];
    ids.forEach((id, index) => {
      const art = cosmeticIconBytes(row.kind, id, row.dir);
      if (!art) return;
      blitZoomed(
        cosSheet,
        cw,
        tintArt(art, proofTint[row.kind]),
        COSMETIC_SIZE,
        COSMETIC_SIZE,
        cosPad + index * (cosCell + cosPad),
        cosPad + rowIndex * (cosCell + cosPad),
        cosZoom,
      );
    });
  });
  await writeFile(resolve(PROOF_DIR, 'cosmetics.png'), encodePng(cw, chh, cosSheet));

  await writeWornProof();
}

/** 把灰度图标乘上代表色后贴到帧上，忽略透明像素 */
function blitIcon(
  dst: Uint8Array,
  dstW: number,
  dstH: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  ox: number,
  oy: number,
  hex: number,
): void {
  const tinted = tintArt(src, hex);
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      const i = (y * srcW + x) * 4;
      if (!tinted[i + 3]) continue;
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dstW || dy >= dstH) continue;
      const o = (dy * dstW + dx) * 4;
      dst[o] = tinted[i]!;
      dst[o + 1] = tinted[i + 1]!;
      dst[o + 2] = tinted[i + 2]!;
      dst[o + 3] = 255;
    }
  }
}

/**
 * 试穿图：把配件按锚点叠到真实角色帧上。
 * 只靠配件自身校对图看不出「发型是否咬住头、帽子有没有压住头发」，这一张才是验收依据。
 */
async function writeWornProof(): Promise<void> {
  const zoom = 4;
  const pad = 6;
  const cell = FRAME_SIZE * zoom;
  const items: Array<{ kind: CosmeticKind; id: string; tint: number }> = [
    { kind: 'head', id: 'cap', tint: 0x4fe3c1 },
    { kind: 'head', id: 'top', tint: 0x4fe3c1 },
    { kind: 'hair', id: 'buzz', tint: 0xffc53d },
    { kind: 'hair', id: 'bangs', tint: 0xffc53d },
    { kind: 'hair', id: 'ponytail', tint: 0xffc53d },
    { kind: 'hair', id: 'afro', tint: 0xffc53d },
    { kind: 'hair', id: 'slick', tint: 0xffc53d },
  ];
  const dirs = [0, 2, 3] as const;
  const width = pad + items.length * (cell + pad);
  const height = pad + dirs.length * (cell + pad);
  const sheet = new Uint8Array(width * height * 4);
  fillRect(sheet, width, width, height, 0, 0, 0x30362f);

  const species: SpeciesName = 'cow';
  /** landmarksOf 给的是相对脚底原点的偏移，贴图时要换回帧内像素 */
  const toFrame = (point: [number, number]): [number, number] => [ORIGIN.x + point[0], ORIGIN.y + point[1]];
  dirs.forEach((direction, rowIndex) => {
    const baseFrame = renderFrameRgba(species, direction, 0);
    const landmarks = landmarksOf(species, direction, 0);
    const dirName: CosmeticDirection = direction === 2 ? 'side' : direction === 3 ? 'up' : 'down';
    items.forEach((item, colIndex) => {
      const frame = Uint8Array.from(baseFrame);
      const art = cosmeticIconBytes(item.kind, item.id, dirName);
      if (art) {
        const anchor =
          item.kind === 'hair'
            ? toFrame([landmarks.headTop[0], landmarks.headTop[1] + 1])
            : item.kind === 'head'
              ? toFrame(landmarks.headTop)
              : toFrame(landmarks.muzzle);
        blitIcon(
          frame,
          FRAME_SIZE,
          FRAME_SIZE,
          art,
          COSMETIC_SIZE,
          COSMETIC_SIZE,
          Math.round(anchor[0]! - COSMETIC_SIZE / 2),
          Math.round(anchor[1]! - COSMETIC_SIZE / 2),
          item.tint,
        );
      }
      blitZoomed(
        sheet,
        width,
        frame,
        FRAME_SIZE,
        FRAME_SIZE,
        pad + colIndex * (cell + pad),
        pad + rowIndex * (cell + pad),
        zoom,
      );
    });
  });
  await writeFile(resolve(PROOF_DIR, 'worn.png'), encodePng(width, height, sheet));
}

/** 校对图用：与 cosmeticIcon 相同的朝向规则，但缺图时返回空而不是 null */
function cosmeticIconBytes(kind: CosmeticKind, id: string, dir: CosmeticDirection): Uint8Array | null {
  if (dir === 'up' && kind === 'eyes') return null;
  return drawCosmetic(kind, id, dir);
}

async function writeLayer(species: SpeciesName, layer: LayerName, fileName: string, atlas: LayerAtlas): Promise<string> {
  const rgba = atlas.get(layer)!;
  const png = encodePng(ATLAS_WIDTH, ATLAS_HEIGHT, rgba);
  const dir = resolve(OUT_DIR, species);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, fileName), png);
  return `${species}/${fileName}`;
}

async function writeLayoutModule(): Promise<void> {
  const body = `/**
 * AUTO-GENERATED by packages/pixel-assets/scripts/generate.ts —— 不要手改。
 * 运行 \`pnpm assets\` 会按 packages/pixel-assets/src/layout.ts 重写本文件。
 */

export interface GeneratedClip {
  frames: number[];
  frameMs: number[];
  loopFrom: number;
  loop: boolean;
}

export const SPRITE_LAYOUT = ${JSON.stringify(
    {
      version: ATLAS_VERSION,
      frame: { w: FRAME_SIZE, h: FRAME_SIZE, columns: COLUMNS, rows: ROWS },
      origin: ORIGIN,
      directions: DIRECTIONS,
      clips: CLIPS,
      cosmeticSize: COSMETIC_SIZE,
      blinkColumn: BLINK_COLUMN,
    },
    null,
    2,
  )} satisfies {
  version: number;
  frame: { w: number; h: number; columns: number; rows: number };
  /** 脚底原点（帧内像素坐标）：客户端精灵锚点与配件挂点的唯一真相 */
  origin: { x: number; y: number };
  directions: readonly string[];
  clips: Record<string, GeneratedClip>;
  cosmeticSize: number;
  /** 眨眼列：客户端不进 idle 循环，改由 35s 调度注入 */
  blinkColumn: number;
};

export type SpritePoseName = keyof typeof SPRITE_LAYOUT.clips;
`;
  await mkdir(resolve(import.meta.dir, '../../../apps/web/lib/game'), { recursive: true });
  await writeFile(LAYOUT_TS, body);
}

type AnchorPair = [number, number];

const roundPair = (point: [number, number]): AnchorPair => [Math.round(point[0]), Math.round(point[1])];

/**
 * 配件锚点：物种 × 朝向 × 帧列。
 * 按帧列而不是按姿态，是为了让呼吸、走路起伏、蹦跳与坐躺过渡帧都不会让配件浮起 1~3px；
 * 数值全部由 landmarksOf 推导，不做手工调表（ADR-0007）。
 */
function buildCosmeticAnchors(): Record<string, Record<string, Record<string, Record<string, AnchorPair | null>>>> {
  const table: Record<string, Record<string, Record<string, Record<string, AnchorPair | null>>>> = {};
  for (const species of SPECIES) {
    table[species] = {};
    for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
      const name = DIRECTIONS[direction]!;
      table[species]![name] = {};
      for (let column = 0; column < COLUMNS; column += 1) {
        const landmarks = landmarksOf(species, direction, column);
        table[species]![name]![column] = {
          head: roundPair(landmarks.headTop),
          eyes: landmarks.eye ? roundPair(landmarks.eye) : null,
          neck: roundPair(landmarks.neck),
          // 发型沿用头顶挂点再下 1px：发块要咬住颅骨，浮在头顶会像一顶假发
          hair: roundPair([landmarks.headTop[0], landmarks.headTop[1] + 1]),
        };
      }
    }
  }
  return table;
}

/** 朝左直接镜像朝右的图；眼镜背面不出图，锚点同时为 null */
function cosmeticIcon(kind: CosmeticKind, id: string, dir: string): Uint8Array | null {
  if (dir === 'up') return kind === 'eyes' ? null : drawCosmetic(kind, id, 'up');
  if (dir === 'left') return mirrorCosmetic(drawCosmetic(kind, id, 'side'));
  if (dir === 'right') return drawCosmetic(kind, id, 'side');
  const art: CosmeticDirection = 'down';
  return drawCosmetic(kind, id, art);
}

async function main(): Promise<void> {
  // 输出目录整体重建：换版本后旧产物（如 v5 的 body-N / back-*）留着会被误读成仍在用的图层
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const started = Date.now();

  const manifest: Record<string, unknown> = {
    // v8：16-24 列由张嘴呼叫改为冲撞 / 头槌（列号不变，内容变了，缓存必须失效）
    version: ATLAS_VERSION,
    frame: { w: FRAME_SIZE, h: FRAME_SIZE, columns: COLUMNS, rows: ROWS },
    directions: DIRECTIONS,
    clips: CLIPS,
    origin: { x: ORIGIN.x, y: ORIGIN.y },
    /** 配件图标边长；客户端按 1:1 叠加，不做亚像素缩放 */
    cosmeticSize: COSMETIC_SIZE,
    species: {} as Record<string, unknown>,
    // 锚点相对脚底原点
    cosmeticAnchors: buildCosmeticAnchors(),
    cosmetics: COSMETIC_CATALOG,
  };

  for (const species of SPECIES) {
    const entry: Record<string, unknown> = {};
    const base = renderAtlas(species, { tail: 0, pattern: 0, extra: 0, snout: 0 });

    // ADR-0011：尾巴拆成独立图层后，body / bodyLight 不再随 tailId 分变体
    entry.body = [await writeLayer(species, 'body', 'body.png', base)];
    entry.bodyLight = [await writeLayer(species, 'bodyLight', 'bodyLight.png', base)];

    const tails: string[] = [];
    for (let tail = 0; tail < 2; tail += 1) {
      const atlas = tail === 0 ? base : renderAtlas(species, { tail, pattern: 0, extra: 0, snout: 0 });
      tails.push(await writeLayer(species, 'tail', `tail-${tail}.png`, atlas));
    }
    entry.tail = tails;

    const patterns = [''];
    for (let pattern = 1; pattern < 3; pattern += 1) {
      const atlas = renderAtlas(species, { tail: 0, pattern, extra: 0, snout: 0 });
      patterns.push(await writeLayer(species, 'pattern', `pattern-${pattern}.png`, atlas));
    }
    entry.pattern = patterns;

    entry.hoof = [await writeLayer(species, 'hoof', 'hoof.png', base)];
    entry.eyes = [await writeLayer(species, 'eyes', 'eyes.png', base)];
    // 眼神光不随尾部/斑纹/角变化，只出一张
    entry.eyeLight = [await writeLayer(species, 'eyeLight', 'eyeLight.png', base)];

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

  const cosDir = resolve(OUT_DIR, 'cos');
  await mkdir(cosDir, { recursive: true });
  const cosmeticFiles: Record<string, Record<string, Record<string, string | null> | null>> = {};
  for (const [kind, ids] of Object.entries(COSMETIC_CATALOG) as [CosmeticKind, readonly string[]][]) {
    cosmeticFiles[kind] = { none: null };
    for (const id of ids) {
      const entry: Record<string, string | null> = {};
      for (const dir of DIRECTIONS) {
        const data = cosmeticIcon(kind, id, dir);
        if (!data) {
          entry[dir] = null;
          continue;
        }
        const fileName = `${kind}-${id}-${dir}.png`;
        await writeFile(resolve(cosDir, fileName), encodePng(COSMETIC_SIZE, COSMETIC_SIZE, data));
        entry[dir] = `cos/${fileName}`;
      }
      cosmeticFiles[kind]![id] = entry;
    }
  }
  manifest.cosmeticFiles = cosmeticFiles;

  await writeFile(resolve(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeLayoutModule();
  // 品牌标记与图集同批生成：favicon / iOS 图标 / 导航 logo 都从 src/logo.ts 这一份 16×16 位图出
  await writeBrandAssets();
  await writeProof();

  const elapsed = Date.now() - started;
  console.log(
    `[pixel-assets] atlas ${ATLAS_WIDTH}x${ATLAS_HEIGHT} · ${COLUMNS} cols · ${SPECIES.length} species · ${elapsed}ms -> ${OUT_DIR}`,
  );
}

await main();
