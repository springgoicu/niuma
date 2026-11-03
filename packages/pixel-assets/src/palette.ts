/**
 * Slot 调色板：绘制期只写"语义槽位"，导出期再拆成灰度图层。
 * 这样每个图层都能被 Sprite.tint 精确染色，等价于 GPU 调色板替换，
 * 但保持单批次绘制、零每帧开销。
 */

export type LayerName =
  | 'body'
  | 'pattern'
  | 'bodyLight'
  | 'hoof'
  | 'eyes'
  | 'eyeLight'
  | 'extra'
  | 'snout'
  | 'tail';

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
  BodyLight: 15,
  EyeLight: 16,
  Tail: 17,
  TailShade: 18,
  TailOutline: 19,
} as const;

export type Slot = number;

interface SlotInfo {
  layer: LayerName;
  luma: number;
}

/**
 * 索引即 slot 值；未列出的 slot 视为透明。
 *
 * 明度阶梯只有「本体 / 阴影」两档（外加一档远端肢体），因为 tint 是乘法：
 * 旧表 255/176/112 在深色身体上（马身 0xA96C3C × 0.44 ≈ 0x4A2F1A）会被压成一坨近黑，
 * 放大 3 倍后看不出体积。新表把阴影拉到 0.81、远端拉到 0.62，深色主体仍留得住色相。
 *
 * BodyLight / EyeLight 仍是纯白：tint 只能乘、不能提亮，想让月牙高光与眼神光比本体更亮，
 * 只能给它们单独开一层，再由客户端把主体色往白里混一份当 tint。
 */
export const SLOT_TABLE: Array<SlotInfo | null> = [
  null,
  { layer: 'body', luma: 255 },
  { layer: 'body', luma: 206 },
  { layer: 'body', luma: 158 },
  { layer: 'body', luma: 44 },
  { layer: 'pattern', luma: 255 },
  { layer: 'pattern', luma: 200 },
  { layer: 'hoof', luma: 236 },
  { layer: 'hoof', luma: 160 },
  { layer: 'eyes', luma: 255 },
  { layer: 'eyes', luma: 150 },
  { layer: 'extra', luma: 255 },
  { layer: 'extra', luma: 190 },
  // 口鼻在游戏里跟身体共用同一 tint，只能靠明度区分；差距太小就只剩描边在撑
  { layer: 'snout', luma: 246 },
  { layer: 'snout', luma: 198 },
  { layer: 'bodyLight', luma: 255 },
  { layer: 'eyeLight', luma: 255 },
  // ADR-0011：尾巴从 body 层拆出来独立染色，描边也归 tail 层，否则尾巴的边会被身体色带跑
  { layer: 'tail', luma: 255 },
  { layer: 'tail', luma: 200 },
  { layer: 'tail', luma: 56 },
];

/** 叠放顺序：尾巴在身后最先画；高光压在斑纹之上、眼睛之下，眼神光紧随眼睛 */
export const LAYERS: LayerName[] = [
  'tail',
  'body',
  'pattern',
  'bodyLight',
  'hoof',
  'eyes',
  'eyeLight',
  'extra',
  'snout',
];

/** 描边槽：主体描边与尾巴描边（ADR-0011 把尾巴的边拆成独立槽，才能各自染色） */
export function isOutlineSlot(slot: Slot): boolean {
  return slot === S.Outline || slot === S.TailOutline;
}

export function slotLayer(slot: number): LayerName | null {
  return SLOT_TABLE[slot]?.layer ?? null;
}

export function slotLuma(slot: number): number {
  return SLOT_TABLE[slot]?.luma ?? 0;
}
