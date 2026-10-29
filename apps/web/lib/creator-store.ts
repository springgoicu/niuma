'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_APPEARANCE,
  HORN_IDS,
  MANE_IDS,
  sanitizeAppearance,
  type CharacterAppearance,
  type Species,
} from '@niuma/shared-types';

export type Pose = 'idle' | 'walk' | 'sit' | 'lie';
export type ColorSlot = 'body' | 'pattern' | 'hoof' | 'eyes' | 'extra';
export type CosmeticKind = 'badge' | 'tie' | 'mouthItem' | 'backItem';

interface CreatorState {
  name: string;
  appearance: CharacterAppearance;
  pose: Pose;
  dirty: boolean;
  setName: (name: string) => void;
  setSpecies: (species: Species) => void;
  setColor: (slot: ColorSlot, hex: number) => void;
  setPattern: (id: number) => void;
  setSnout: (id: number) => void;
  setExtra: (id: number) => void;
  setTail: (id: number) => void;
  setCosmetic: (kind: CosmeticKind, value: string) => void;
  setPose: (pose: Pose) => void;
  hydrate: (name: string, appearance: CharacterAppearance) => void;
  markSaved: () => void;
}

export const useCreatorStore = create<CreatorState>()(
  subscribeWithSelector((set) => ({
    name: '',
    appearance: sanitizeAppearance(DEFAULT_APPEARANCE.cow),
    pose: 'idle',
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

    setPose: (pose) => set({ pose }),

    hydrate: (name, appearance) => set({ name, appearance: sanitizeAppearance(appearance), dirty: false }),

    markSaved: () => set({ dirty: false }),
  })),
);

export function extraOptions(species: Species): readonly string[] {
  return species === 'cow' ? HORN_IDS : MANE_IDS;
}

export function extraLabel(species: Species, index: number): string {
  if (species === 'cow') return ['无角', '尖角', '弯角', '断角'][index] ?? '尖角';
  return ['短鬃', '披肩长发', '莫西干'][index] ?? '短鬃';
}

export const COLOR_ROWS: Array<{ slot: ColorSlot; label: string; hint: string }> = [
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
