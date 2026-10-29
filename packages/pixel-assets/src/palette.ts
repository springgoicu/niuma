/**
 * Slot 调色板：绘制期只写“语义槽位”，导出期再拆成灰度图层。
 * 这样每个图层都能被 Sprite.tint 精确染色，等价于 GPU 调色板替换，
 * 但保持单批次绘制、零每帧开销。
 */

export type LayerName = 'body' | 'pattern' | 'hoof' | 'eyes' | 'extra' | 'snout';

export const S = {
  None: 0,
  Body: 1,
  BodyShade: 2,
  BodyDeep: 3,
  Outline: 4,
  Pattern: 5,
  PatternShade: 6,
  Hoof: 7,
  HoofShade: 8,
  Eye: 9,
  EyeShade: 10,
  Extra: 11,
  ExtraShade: 12,
  Snout: 13,
  SnoutShade: 14,
} as const;

export type Slot = number;

interface SlotInfo {
  layer: LayerName;
  luma: number;
}

/**
 * 索引即 slot 值；未列出的 slot 视为透明。
 * luma 是 tint 之前的明度：相邻档差拉开到 ≥60，放大 3–4 倍时才看得出体积，
 * 否则一坨中间调会让造型发糊。
 */
export const SLOT_TABLE: Array<SlotInfo | null> = [
  null,
  { layer: 'body', luma: 255 },
  { layer: 'body', luma: 176 },
  { layer: 'body', luma: 112 },
  { layer: 'body', luma: 56 },
  { layer: 'pattern', luma: 255 },
  { layer: 'pattern', luma: 150 },
  { layer: 'hoof', luma: 236 },
  { layer: 'hoof', luma: 132 },
  { layer: 'eyes', luma: 255 },
  { layer: 'eyes', luma: 140 },
  { layer: 'extra', luma: 255 },
  { layer: 'extra', luma: 142 },
  { layer: 'snout', luma: 255 },
  { layer: 'snout', luma: 158 },
];

export const LAYERS: LayerName[] = ['body', 'pattern', 'hoof', 'eyes', 'extra', 'snout'];

export function slotLayer(slot: number): LayerName | null {
  return SLOT_TABLE[slot]?.layer ?? null;
}

export function slotLuma(slot: number): number {
  return SLOT_TABLE[slot]?.luma ?? 0;
}
