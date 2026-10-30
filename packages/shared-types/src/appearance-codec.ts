import { APPEARANCE_BYTES } from './constants';
import {
  BACK_IDS,
  EYEWEAR_IDS,
  HEADWEAR_IDS,
  HORN_IDS,
  MANE_IDS,
  NECKWEAR_IDS,
  PATTERN_IDS,
  SNOUT_IDS,
  SPECIES_LIMITS,
  TAIL_IDS,
  catalogIndexOf,
  catalogValue,
} from './catalog';
import { DEFAULT_APPEARANCE, type CharacterAppearance, type Species } from './types';

export function clampColor(hex: number): number {
  if (!Number.isFinite(hex)) return 0;
  const value = Math.floor(hex);
  if (value < 0) return 0;
  if (value > 0xffffff) return 0xffffff;
  return value;
}

export function hexToRgb565(hex: number): number {
  const c = clampColor(hex);
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

export function rgb565ToHex(value: number): number {
  const v = value & 0xffff;
  const r = (v >> 11) & 0x1f;
  const g = (v >> 5) & 0x3f;
  const b = v & 0x1f;
  const r8 = (r << 3) | (r >> 2);
  const g8 = (g << 2) | (g >> 4);
  const b8 = (b << 3) | (b >> 2);
  return (r8 << 16) | (g8 << 8) | b8;
}

/** 把任意颜色规范化为 565 可表达值，保证本地预览与远处玩家看到的完全一致 */
export function normalizeColor(hex: number): number {
  return rgb565ToHex(hexToRgb565(hex));
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  const idx = Math.floor(value);
  if (idx < 0) return 0;
  return idx >= length ? length - 1 : idx;
}

function pickCosmetic(catalog: readonly string[], value: string | undefined): string {
  return catalogValue(catalog, catalogIndexOf(catalog, value));
}

/**
 * 服务端与捏人端共用的合法性钳制。
 * 客户端可能被篡改，任何进入世界的对象都必须先过这里。
 */
export function sanitizeAppearance(input: Partial<CharacterAppearance> | null | undefined): CharacterAppearance {
  const species: Species = input?.species === 'horse' ? 'horse' : 'cow';
  const base = DEFAULT_APPEARANCE[species];
  const limits = SPECIES_LIMITS[species];
  const colors = input?.colors;
  const parts = input?.parts;
  const cosmetics = input?.cosmetics;
  const extraRaw = species === 'cow' ? parts?.hornId : parts?.maneId;
  const extraId = clampIndex(extraRaw ?? (species === 'cow' ? base.parts.hornId ?? 1 : base.parts.maneId ?? 1), limits.extras);

  const appearance: CharacterAppearance = {
    species,
    colors: {
      body: normalizeColor(colors?.body ?? base.colors.body),
      pattern: normalizeColor(colors?.pattern ?? base.colors.pattern),
      hoof: normalizeColor(colors?.hoof ?? base.colors.hoof),
      eyes: normalizeColor(colors?.eyes ?? base.colors.eyes),
      extra: normalizeColor(colors?.extra ?? base.colors.extra),
    },
    parts: {
      patternId: clampIndex(parts?.patternId ?? base.parts.patternId, limits.patterns),
      snoutId: clampIndex(parts?.snoutId ?? base.parts.snoutId, limits.snouts),
      tailId: clampIndex(parts?.tailId ?? base.parts.tailId, limits.tails),
    },
    cosmetics: {
      headwear: pickCosmetic(HEADWEAR_IDS, cosmetics?.headwear ?? base.cosmetics.headwear),
      eyewear: pickCosmetic(EYEWEAR_IDS, cosmetics?.eyewear ?? base.cosmetics.eyewear),
      neckwear: pickCosmetic(NECKWEAR_IDS, cosmetics?.neckwear ?? base.cosmetics.neckwear),
      backItem: pickCosmetic(BACK_IDS, cosmetics?.backItem ?? base.cosmetics.backItem),
    },
  };

  if (species === 'cow') {
    appearance.parts.hornId = extraId;
  } else {
    appearance.parts.maneId = extraId;
  }
  return appearance;
}

/**
 * 20 字节定长外观：
 * [0] species | [1..10] 5×u16 RGB565 | [11..14] parts | [15..18] cosmetics | [19] reserved
 */
export function encodeAppearance(appearance: CharacterAppearance): Uint8Array {
  const a = sanitizeAppearance(appearance);
  const out = new Uint8Array(APPEARANCE_BYTES);
  const view = new DataView(out.buffer);
  out[0] = a.species === 'horse' ? 1 : 0;
  const colors = [a.colors.body, a.colors.pattern, a.colors.hoof, a.colors.eyes, a.colors.extra];
  for (let i = 0; i < colors.length; i += 1) {
    view.setUint16(1 + i * 2, hexToRgb565(colors[i]!), true);
  }
  const extraId = a.species === 'cow' ? a.parts.hornId ?? 0 : a.parts.maneId ?? 0;
  out[11] = a.parts.patternId;
  out[12] = a.parts.snoutId;
  out[13] = extraId;
  out[14] = a.parts.tailId;
  out[15] = catalogIndexOf(HEADWEAR_IDS, a.cosmetics.headwear);
  out[16] = catalogIndexOf(EYEWEAR_IDS, a.cosmetics.eyewear);
  out[17] = catalogIndexOf(NECKWEAR_IDS, a.cosmetics.neckwear);
  out[18] = catalogIndexOf(BACK_IDS, a.cosmetics.backItem);
  out[19] = 0;
  return out;
}

export function decodeAppearance(bytes: Uint8Array, offset = 0): CharacterAppearance {
  if (bytes.byteLength - offset < APPEARANCE_BYTES) {
    throw new Error(`appearance needs ${APPEARANCE_BYTES} bytes, got ${bytes.byteLength - offset}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, APPEARANCE_BYTES);
  const species: Species = bytes[offset] === 1 ? 'horse' : 'cow';
  const colors = {
    body: rgb565ToHex(view.getUint16(1, true)),
    pattern: rgb565ToHex(view.getUint16(3, true)),
    hoof: rgb565ToHex(view.getUint16(5, true)),
    eyes: rgb565ToHex(view.getUint16(7, true)),
    extra: rgb565ToHex(view.getUint16(9, true)),
  };
  const parts = {
    patternId: bytes[offset + 11]!,
    snoutId: bytes[offset + 12]!,
    tailId: bytes[offset + 14]!,
  } as CharacterAppearance['parts'];
  const extraId = bytes[offset + 13]!;
  if (species === 'cow') parts.hornId = extraId;
  else parts.maneId = extraId;

  return sanitizeAppearance({
    species,
    colors,
    parts,
    cosmetics: {
      headwear: catalogValue(HEADWEAR_IDS, bytes[offset + 15]!),
      eyewear: catalogValue(EYEWEAR_IDS, bytes[offset + 16]!),
      neckwear: catalogValue(NECKWEAR_IDS, bytes[offset + 17]!),
      backItem: catalogValue(BACK_IDS, bytes[offset + 18]!),
    },
  });
}

/** 内容哈希键，用于图集与调色缓存命中率统计 */
export function appearanceKey(appearance: CharacterAppearance): string {
  const a = appearance;
  const extra = a.species === 'cow' ? a.parts.hornId ?? 0 : a.parts.maneId ?? 0;
  return [
    a.species,
    a.colors.body.toString(16),
    a.colors.pattern.toString(16),
    a.colors.hoof.toString(16),
    a.colors.eyes.toString(16),
    a.colors.extra.toString(16),
    a.parts.patternId,
    a.parts.snoutId,
    extra,
    a.parts.tailId,
    a.cosmetics.headwear,
    a.cosmetics.eyewear,
    a.cosmetics.neckwear,
    a.cosmetics.backItem,
  ].join('|');
}
