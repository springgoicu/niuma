'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_APPEARANCE,
  EYEWEAR_IDS,
  HAIR_IDS,
  HEADWEAR_IDS,
  HORN_IDS,
  MANE_IDS,
  NECKWEAR_IDS,
  PATTERN_IDS,
  SNOUT_IDS,
  TAIL_IDS,
  sanitizeAppearance,
  type AppearanceColorKey,
  type CharacterAppearance,
  type Species,
} from '@niuma/shared-types';

export type Pose = 'idle' | 'walk' | 'sit' | 'lie';
/** 11 个可独立调色的槽位，与线协议一一对应 */
export type ColorSlot = AppearanceColorKey;
export type CosmeticKind = 'headwear' | 'eyewear' | 'neckwear' | 'hairstyle';
/** 左栏里可以被「聚焦」的属性；聚焦决定右侧面板下半部分显示谁的颜色 */
export type PartKey = 'pattern' | 'snout' | 'extra' | 'tail' | 'headwear' | 'eyewear' | 'neckwear' | 'hairstyle';

interface CreatorState {
  name: string;
  appearance: CharacterAppearance;
  pose: Pose;
  activePart: PartKey | null;
  dirty: boolean;
  setName: (name: string) => void;
  setSpecies: (species: Species) => void;
  setColor: (slot: ColorSlot, hex: number) => void;
  setPattern: (id: number) => void;
  setSnout: (id: number) => void;
  setExtra: (id: number) => void;
  setTail: (id: number) => void;
  setCosmetic: (kind: CosmeticKind, value: string) => void;
  setActivePart: (part: PartKey | null) => void;
  setPose: (pose: Pose) => void;
  hydrate: (name: string, appearance: CharacterAppearance) => void;
  markSaved: () => void;
}

export const useCreatorStore = create<CreatorState>()(
  subscribeWithSelector((set) => ({
    name: '',
    appearance: sanitizeAppearance(DEFAULT_APPEARANCE.cow),
    pose: 'idle',
    activePart: null,
    dirty: false,

    setName: (name) => set({ name: name.slice(0, 16), dirty: true }),

    setSpecies: (species) =>
      set((state) => {
        if (state.appearance.species === species) return state;
        const defaults = sanitizeAppearance(DEFAULT_APPEARANCE[species]);
        const keepsColors = state.appearance.colors;
        return {
          appearance: sanitizeAppearance({
            ...defaults,
            colors: keepsColors,
          }),
          dirty: true,
        };
      }),

    setColor: (slot, hex) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          colors: { ...state.appearance.colors, [slot]: hex },
        }),
        dirty: true,
      })),

    setPattern: (id) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          parts: { ...state.appearance.parts, patternId: id },
        }),
        dirty: true,
      })),

    setSnout: (id) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          parts: { ...state.appearance.parts, snoutId: id },
        }),
        dirty: true,
      })),

    setExtra: (id) =>
      set((state) => {
        const parts = { ...state.appearance.parts };
        if (state.appearance.species === 'cow') parts.hornId = id;
        else parts.maneId = id;
        return { appearance: sanitizeAppearance({ ...state.appearance, parts }), dirty: true };
      }),

    setTail: (id) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          parts: { ...state.appearance.parts, tailId: id },
        }),
        dirty: true,
      })),

    setCosmetic: (kind, value) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          cosmetics: { ...state.appearance.cosmetics, [kind]: value },
        }),
        dirty: true,
      })),

    setActivePart: (part) => set((state) => (state.activePart === part ? state : { activePart: part })),

    setPose: (pose) => set({ pose }),

    hydrate: (name, appearance) => set({ name, appearance: sanitizeAppearance(appearance), dirty: false }),

    markSaved: () => set({ dirty: false }),
  })),
);

export function extraOptions(species: Species): readonly string[] {
  return species === 'cow' ? HORN_IDS : MANE_IDS;
}

const EXTRA_LABELS: Record<Species, Record<string, string>> = {
  cow: { none: '无角', spike: '尖角', curve: '弯角', broken: '断角' },
  horse: { short: '短鬃', long: '披肩长发', mohawk: '莫西干' },
};

/** 左栏每个属性的静态元信息：着色槽 + 中文名 + 目录 id 的读法 */
export const PART_META: Record<
  PartKey,
  { slot: ColorSlot; label: string; hint: string; labels: Record<string, string> }
> = {
  pattern: {
    slot: 'pattern',
    label: '斑纹',
    hint: 'PATTERN',
    labels: { none: '无斑纹', spots: '奶牛斑块', socks: '马蹄踏雪' },
  },
  snout: { slot: 'snout', label: '口鼻', hint: 'SNOUT', labels: { wide: '宽牛吻', long: '狭长马吻' } },
  extra: { slot: 'extra', label: '角 / 鬃', hint: 'EXTRA', labels: {} },
  tail: { slot: 'tail', label: '尾巴', hint: 'TAIL', labels: { tuft: '短尾穗', long: '长尾' } },
  headwear: {
    slot: 'headwear',
    label: '头饰',
    hint: 'HEAD',
    labels: { none: '不戴', grad: '学士帽', cap: '鸭舌帽', beret: '贝雷帽', helmet: '安全帽', top: '礼帽' },
  },
  eyewear: {
    slot: 'eyewear',
    label: '眼镜',
    hint: 'EYES',
    labels: { none: '不戴', round: '圆框眼镜', sun: '墨镜', monocle: '单眼镜' },
  },
  neckwear: {
    slot: 'neckwear',
    label: '颈饰',
    hint: 'NECK',
    labels: { none: '不戴', scarf: '围巾', collar: '项圈', phones: '挂脖耳机' },
  },
  hairstyle: {
    slot: 'hairstyle',
    label: '发型',
    hint: 'HAIR',
    labels: { none: '不剪', buzz: '寸头', bangs: '齐刘海', ponytail: '马尾', afro: '爆炸头', slick: '大背头' },
  },
};

/** 左栏顺序即面板快捷入口顺序 */
export const PART_ORDER: PartKey[] = ['snout', 'tail', 'headwear', 'eyewear', 'neckwear', 'hairstyle'];

/** 属性当前的目录 id */
export function partValue(appearance: CharacterAppearance, part: PartKey): string {
  switch (part) {
    case 'pattern':
      return PATTERN_IDS[appearance.parts.patternId] ?? 'none';
    case 'snout':
      return SNOUT_IDS[appearance.parts.snoutId] ?? 'none';
    case 'extra':
      return appearance.species === 'cow'
        ? HORN_IDS[appearance.parts.hornId ?? 0] ?? 'none'
        : MANE_IDS[appearance.parts.maneId ?? 0] ?? 'none';
    case 'tail':
      return TAIL_IDS[appearance.parts.tailId] ?? 'none';
    default:
      return appearance.cosmetics[part] ?? 'none';
  }
}

/** 目录 id 的中文名；角与鬃共用一个槽位，按物种读音 */
export function partItemLabel(species: Species, part: PartKey, id: string): string {
  if (part === 'extra') return EXTRA_LABELS[species][id] ?? id;
  return PART_META[part].labels[id] ?? id;
}

/** 属性当前佩戴项的中文名 */
export function partLabel(appearance: CharacterAppearance, part: PartKey): string {
  return partItemLabel(appearance.species, part, partValue(appearance, part));
}

/** 属性对应的目录（供面板显示已选条目序号之类） */
export function partCatalog(appearance: CharacterAppearance, part: PartKey): readonly string[] {
  switch (part) {
    case 'pattern':
      return PATTERN_IDS;
    case 'snout':
      return SNOUT_IDS;
    case 'extra':
      return extraOptions(appearance.species);
    case 'tail':
      return TAIL_IDS;
    case 'headwear':
      return HEADWEAR_IDS;
    case 'eyewear':
      return EYEWEAR_IDS;
    case 'neckwear':
      return NECKWEAR_IDS;
    default:
      return HAIR_IDS;
  }
}

/** 右侧「整体」区：始终固定的 5 行 */
export const GLOBAL_COLOR_ROWS: Array<{ slot: ColorSlot; label: string; hint: string }> = [
  { slot: 'body', label: '主体', hint: 'BODY' },
  { slot: 'pattern', label: '斑纹', hint: 'PATTERN' },
  { slot: 'hoof', label: '蹄铁', hint: 'HOOF' },
  { slot: 'eyes', label: '眼睛', hint: 'EYES' },
  { slot: 'extra', label: '角 / 鬃', hint: 'EXTRA' },
];

export const PRESET_SWATCHES = [
  0xf3efe4, 0xd8cdb4, 0x2a2622, 0x6b4a32, 0xa96c3c, 0xc94f3a,
  0x4fe3c1, 0xa8ff6b, 0xffc53d, 0xff6b3d, 0x5ac8fa, 0x8a3f6b,
];
