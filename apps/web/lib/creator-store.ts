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
  clampNameLength,
  normalizeColor,
  sanitizeAppearance,
  type AppearanceColorKey,
  type CharacterAppearance,
  type Species,
} from '@niuma/shared-types';
import { switchSpeciesAppearance, type CreatorSeed } from './creator-seed';

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
  /** 整套配色一次落库：逐槽调 4 次 setColor 会重渲染 4 次，预览就闪 4 下 */
  applyPalette: (colors: Partial<Record<ColorSlot, number>>) => void;
  setPattern: (id: number) => void;
  setSnout: (id: number) => void;
  setExtra: (id: number) => void;
  setTail: (id: number) => void;
  setCosmetic: (kind: CosmeticKind, value: string) => void;
  setActivePart: (part: PartKey | null) => void;
  setPose: (pose: Pose) => void;
  /** 挂载时一次性落库：入口参数、存档与记忆键的优先级已在 creator-seed 里算完 */
  hydrate: (seed: CreatorSeed) => void;
  markSaved: () => void;
}

export const useCreatorStore = create<CreatorState>()(
  subscribeWithSelector((set) => ({
    name: '',
    appearance: sanitizeAppearance(DEFAULT_APPEARANCE.cow),
    pose: 'idle',
    activePart: null,
    dirty: false,

    // 按码点钳到 16 字符：slice 会把 emoji 的代理对切成半个
    setName: (name) => set({ name: clampNameLength(name), dirty: true }),

    setSpecies: (species) =>
      set((state) => {
        // 与入口直接带 ?species= 共用同一套切法：保色、其余回默认、同物种不动
        const appearance = switchSpeciesAppearance(state.appearance, species);
        if (appearance === state.appearance) return state;
        return { appearance, dirty: true };
      }),

    setColor: (slot, hex) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          colors: { ...state.appearance.colors, [slot]: hex },
        }),
        dirty: true,
      })),

    applyPalette: (colors) =>
      set((state) => ({
        appearance: sanitizeAppearance({
          ...state.appearance,
          colors: { ...state.appearance.colors, ...colors },
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

    hydrate: (seed) =>
      set({ name: seed.name, appearance: sanitizeAppearance(seed.appearance), dirty: seed.dirty }),

    markSaved: () => set({ dirty: false }),
  })),
);

export function extraOptions(species: Species): readonly string[] {
  return species === 'cow' ? HORN_IDS : MANE_IDS;
}

/**
 * 捏人界面可选的配件目录：警用 / 护士件只给服务端 NPC 使用，不对玩家开放。
 * 外观编码仍保留完整目录，玩家旧档如果带着这些索引也会被正常解析。
 */
export const PLAYER_HEADWEAR_IDS = HEADWEAR_IDS.filter((id) => id !== 'police_cap' && id !== 'nurse_cap');
export const PLAYER_NECKWEAR_IDS = NECKWEAR_IDS.filter((id) => id !== 'epaulette');

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
    labels: {
      none: '不戴',
      grad: '学士帽',
      cap: '鸭舌帽',
      beret: '贝雷帽',
      helmet: '安全帽',
      top: '礼帽',
      god_of_wealth: '财神官帽',
      bamboo_hat: '江湖斗笠',
      curse_hoop: '赛博紧箍',
      police_cap: '大檐警帽',
      nurse_cap: '护士帽',
    },
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
    labels: {
      none: '不戴',
      scarf: '围巾',
      collar: '项圈',
      phones: '挂脖耳机',
      chinese_knot: '吉祥中国结',
      jade_pendant: '翡翠平安扣',
      epaulette: '肩章反光条',
    },
  },
  hairstyle: {
    slot: 'hairstyle',
    label: '发型',
    hint: 'HAIR',
    labels: {
      none: '不剪',
      buzz: '寸头',
      bangs: '齐刘海',
      ponytail: '马尾',
      afro: '爆炸头',
      slick: '大背头',
      topknot: '发髻',
      braid: '长辫',
    },
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
      return PLAYER_HEADWEAR_IDS;
    case 'eyewear':
      return EYEWEAR_IDS;
    case 'neckwear':
      return PLAYER_NECKWEAR_IDS;
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

/**
 * 整妆配色：一整套跨槽位的协调色，点一次就把整只角色换好。
 *
 * 只给「会被看见」的槽：主体、斑纹、蹄铁、眼睛、角鬃、口鼻、尾巴，外加四件配饰。
 * 写成部分映射，没列到的槽保持用户原值——套用整妆不该顺手抹掉他刚调好的围巾色。
 */
export interface LookPalette {
  id: string;
  /** 中文名，放在卡片主行 */
  name: string;
  /** 拉丁小字，卡片副行 */
  hint: string;
  colors: Partial<Record<ColorSlot, number>>;
}

/** 三色迷你条取主体 / 斑纹 / 角鬃，一眼能读出这套妆的冷暖 */
export function lookSwatches(palette: LookPalette): number[] {
  return [palette.colors.body, palette.colors.pattern, palette.colors.extra].map((hex) =>
    normalizeColor(hex ?? 0x000000),
  );
}

export const LOOK_PALETTES: LookPalette[] = [
  {
    id: 'sakura',
    name: '晨樱',
    hint: 'sakura',
    colors: {
      body: 0xf7dde2,
      pattern: 0xfffaf9,
      hoof: 0x8d5a63,
      eyes: 0x2a1f22,
      extra: 0xf3c6cf,
      snout: 0xf7dde2,
      tail: 0xf7dde2,
      headwear: 0xc9748a,
      eyewear: 0xd8b48e,
      neckwear: 0xb96b83,
      hairstyle: 0x5a3a41,
    },
  },
  {
    id: 'peach',
    name: '蜜桃奶',
    hint: 'peach',
    colors: {
      body: 0xf7e2cf,
      pattern: 0xfff6ea,
      hoof: 0x9a6446,
      eyes: 0x2a201a,
      extra: 0xe7b98f,
      snout: 0xf7e2cf,
      tail: 0xf7e2cf,
      headwear: 0xd08060,
      eyewear: 0xc9a37a,
      neckwear: 0xb8593a,
      hairstyle: 0x6b3f28,
    },
  },
  {
    id: 'dusk',
    name: '暮玫',
    hint: 'dusk',
    colors: {
      body: 0x6d4a55,
      pattern: 0xe6c9d2,
      hoof: 0x3b2a30,
      eyes: 0xf4e3e8,
      extra: 0xc98ea0,
      snout: 0x8a5c68,
      tail: 0x6d4a55,
      headwear: 0xb96b83,
      eyewear: 0xd8b48e,
      neckwear: 0xe6c9d2,
      hairstyle: 0x3b2a30,
    },
  },
  {
    id: 'linen',
    name: '燕麦奶',
    hint: 'linen',
    colors: {
      body: 0xefe6d6,
      pattern: 0xb89f86,
      hoof: 0x6b5a48,
      eyes: 0x3a2f26,
      extra: 0xd8c4a8,
      snout: 0xefe6d6,
      tail: 0xefe6d6,
      headwear: 0x9a7b62,
      eyewear: 0x7d8c74,
      neckwear: 0xb96b83,
      hairstyle: 0x6b5136,
    },
  },
];
