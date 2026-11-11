'use client';

import { Container, Sprite, type Texture } from 'pixi.js';
import type { CharacterAppearance } from '@niuma/shared-types';
import { mixHex } from '../color';
import { directionOf, type Atlas, type SpriteManifest } from './atlas';
import { SPRITE_LAYOUT } from './sprite-layout.generated';

/**
 * 脚底锚点直接由生成物推导（origin.y / 帧高）。
 * 这里曾经写死 45 / 48，网格一换就要回来改一次，还只改一处——配件、气泡、裁剪全跟着漂。
 */
const FOOT_ANCHOR_Y = SPRITE_LAYOUT.origin.y / SPRITE_LAYOUT.frame.h;

/**
 * tint 只能乘、不能提亮，所以高光必须借独立图层，再把本体色往白里混一份当 tint。
 * bodyLight / eyeLight 不是外观字段，只是派生的染色槽；其余 key 与协议 11 色一一对应。
 */
type TintKey =
  | 'body'
  | 'pattern'
  | 'hoof'
  | 'eyes'
  | 'extra'
  | 'snout'
  | 'tail'
  | 'headwear'
  | 'eyewear'
  | 'neckwear'
  | 'hairstyle'
  | 'bodyLight'
  | 'eyeLight';
type CosmeticKind = 'head' | 'eyes' | 'neck' | 'hair';

/**
 * 纸娃娃的深度顺序，唯一真相（ADR-0013）。
 *
 * 与需求文本唯一的偏离：鬃毛（extra）排在眼睛之前。
 * 图集里鬃毛与眼睛在同一帧的不同像素上，鬃毛压过去会直接吃掉表情；
 * 读脸优先级高于「鬃毛在最上层」的字面顺序，所以保持现状。
 * 同理，头饰排在 extra 之前——牛角与马鬃要从帽子上方穿出。
 */
export const PONY_LAYER_ORDER = [
  // 身后
  'tail',
  // 身体
  'body',
  'pattern',
  'bodyLight',
  // 头饰先于 extra：牛角与马鬃从帽子上方穿出，戴帽不会丢掉物种剪影
  'hairstyle',
  'headwear',
  // 前蹄压在身体之上
  'hoof',
  // 鬃毛 / 牛角
  'extra',
  // 表情：眼睛与眼神光，眼镜压在眼睛上
  'eyes',
  'eyeLight',
  'eyewear',
  // 口鼻
  'snout',
  // 颈饰最后叠，压在下巴与胸口的交界
  'neckwear',
] as const;

export type PonyLayerId = (typeof PONY_LAYER_ORDER)[number];

interface TintLayer {
  kind: 'tint';
  path: string;
  colorKey: TintKey;
}

interface CosmeticLayer {
  kind: 'cosmetic';
  cosmeticKind: CosmeticKind;
  value: string;
  /** ADR-0011：配件图标是灰度图，颜色跟属性走 */
  colorKey: TintKey;
}

type LayerSpec = TintLayer | CosmeticLayer;

interface LayerEntry {
  sprite: Sprite;
  frames: Texture[] | null;
  colorKey?: TintKey;
  cosmeticKind?: CosmeticKind;
  /** 四向图标一次加载：切朝向只换 texture 引用，不触发加载 */
  textures?: Record<string, Texture>;
}

/** 背线高光只比本体亮一点；再亮就成了塑料反光 */
const BODY_LIGHT_MIX = 0.22;
/** 眼神光要压过眼睛色才有「水光」，所以混得比身体高光狠得多 */
const EYE_LIGHT_MIX = 0.7;

function tintFor(appearance: CharacterAppearance, key: TintKey): number {
  if (key === 'bodyLight') return mixHex(appearance.colors.body, 0xffffff, BODY_LIGHT_MIX);
  if (key === 'eyeLight') return mixHex(appearance.colors.eyes, 0xffffff, EYE_LIGHT_MIX);
  return appearance.colors[key];
}

/** 按 PONY_LAYER_ORDER 组装图层：缺哪层就跳过，不会留空洞 */
function layerSpecs(manifest: SpriteManifest, appearance: CharacterAppearance): LayerSpec[] {
  const species = manifest.species[appearance.species] ?? manifest.species.cow!;
  const extraId = appearance.species === 'cow' ? appearance.parts.hornId ?? 0 : appearance.parts.maneId ?? 0;
  const body = species.body[0]!;
  const bodyLight = species.bodyLight?.[0];
  const tail = species.tail?.[appearance.parts.tailId] ?? species.tail?.[0];
  const snout = species.snout[appearance.parts.snoutId] ?? species.snout[0]!;
  const pattern = appearance.parts.patternId > 0 ? species.pattern[appearance.parts.patternId] : undefined;
  const extra = species.extra[extraId];
  const eyeLight = species.eyeLight?.[0];

  const specs = new Map<PonyLayerId, LayerSpec>();
  if (tail) specs.set('tail', { kind: 'tint', path: tail, colorKey: 'tail' });
  specs.set('body', { kind: 'tint', path: body, colorKey: 'body' });
  if (pattern) specs.set('pattern', { kind: 'tint', path: pattern, colorKey: 'pattern' });
  if (bodyLight) specs.set('bodyLight', { kind: 'tint', path: bodyLight, colorKey: 'bodyLight' });
  specs.set('hoof', { kind: 'tint', path: species.hoof[0]!, colorKey: 'hoof' });
  if (extra) specs.set('extra', { kind: 'tint', path: extra, colorKey: 'extra' });
  specs.set('eyes', { kind: 'tint', path: species.eyes[0]!, colorKey: 'eyes' });
  if (eyeLight) specs.set('eyeLight', { kind: 'tint', path: eyeLight, colorKey: 'eyeLight' });
  specs.set('snout', { kind: 'tint', path: snout, colorKey: 'snout' });

  const hairstyle = appearance.cosmetics.hairstyle;
  if (hairstyle && hairstyle !== 'none') {
    specs.set('hairstyle', { kind: 'cosmetic', cosmeticKind: 'hair', value: hairstyle, colorKey: 'hairstyle' });
  }
  const headwear = appearance.cosmetics.headwear;
  if (headwear && headwear !== 'none') {
    specs.set('headwear', { kind: 'cosmetic', cosmeticKind: 'head', value: headwear, colorKey: 'headwear' });
  }
  const eyewear = appearance.cosmetics.eyewear;
  if (eyewear && eyewear !== 'none') {
    specs.set('eyewear', { kind: 'cosmetic', cosmeticKind: 'eyes', value: eyewear, colorKey: 'eyewear' });
  }
  const neckwear = appearance.cosmetics.neckwear;
  if (neckwear && neckwear !== 'none') {
    specs.set('neckwear', { kind: 'cosmetic', cosmeticKind: 'neck', value: neckwear, colorKey: 'neckwear' });
  }

  const ordered: LayerSpec[] = [];
  for (const id of PONY_LAYER_ORDER) {
    const spec = specs.get(id);
    if (spec) ordered.push(spec);
  }
  return ordered;
}

function variantKey(appearance: CharacterAppearance): string {
  const extra = appearance.species === 'cow' ? appearance.parts.hornId : appearance.parts.maneId;
  return [
    appearance.species,
    appearance.parts.patternId,
    appearance.parts.snoutId,
    extra,
    appearance.parts.tailId,
    appearance.cosmetics.hairstyle,
    appearance.cosmetics.headwear,
    appearance.cosmetics.eyewear,
    appearance.cosmetics.neckwear,
  ].join('|');
}

/**
 * 分层角色：每层是灰度图 + tint，等价于调色板替换但完全合批、每帧零开销。
 * 变体（物种/配件/斑纹）变化才重建精灵，纯颜色变化只改 tint。
 *
 * 微动效不在这里算：`pony-motion.ts` 给出整数纹素与阴影档位，
 * 这里只负责把 bob 落到容器 y 上——阴影在容器外，所以不会被一起抬高。
 */
export class PonyRenderer {
  readonly container = new Container();
  private entries: LayerEntry[] = [];
  private frameIndex = 0;
  private token = 0;
  /** 呼吸 / 行走起伏（≤ 0）与座位抬升（≥ 0）分开记，合成后落在一个整数 y 上 */
  private bobTexels = 0;
  private seatLiftTexels = 0;
  private appearanceValue: CharacterAppearance;
  private builtKey = '';

  constructor(
    private readonly atlas: Atlas,
    appearance: CharacterAppearance,
    /** 由 pixel-scale 推导的 CSS 缩放，保证 1 纹素 = 整数设备像素 */
    scale: number,
  ) {
    this.appearanceValue = appearance;
    this.container.scale.set(scale);
  }

  get appearance(): CharacterAppearance {
    return this.appearanceValue;
  }

  /** DPR 变化时重算缩放，保持「1 纹素 = 整数设备像素」 */
  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  /** 待机 / 行走的整数纹素起伏：只允许 0 或负值，角色永远不会陷进地面 */
  setBob(bobTexels: number): void {
    if (this.bobTexels === bobTexels) return;
    this.bobTexels = bobTexels;
    this.applyOffset();
  }

  /**
   * 坐在座位上时整体上移，让臀底落在座面顶面（ADR-0032）。
   * 阴影挂在 container 之外，所以只抬身体，不抬阴影——人不会「飞起来」。
   */
  setSeatLift(liftTexels: number): void {
    if (this.seatLiftTexels === liftTexels) return;
    this.seatLiftTexels = liftTexels;
    this.applyOffset();
  }

  private applyOffset(): void {
    const y = this.bobTexels - this.seatLiftTexels;
    if (this.container.y !== y) this.container.y = y;
  }

  async build(appearance: CharacterAppearance = this.appearanceValue): Promise<void> {
    const token = (this.token += 1);
    this.appearanceValue = appearance;
    this.builtKey = variantKey(appearance);
    const specs = layerSpecs(this.atlas.manifest, appearance);
    const entries: LayerEntry[] = [];

    for (const spec of specs) {
      if (spec.kind === 'tint') {
        const frames = await this.atlas.frames(spec.path);
        if (token !== this.token) return;
        const sprite = new Sprite(frames[this.frameIndex] ?? frames[0]!);
        sprite.anchor.set(0.5, FOOT_ANCHOR_Y);
        sprite.tint = tintFor(appearance, spec.colorKey);
        entries.push({ sprite, frames, colorKey: spec.colorKey });
      } else {
        const textures = await this.loadCosmeticTextures(spec.cosmeticKind, spec.value);
        if (token !== this.token) return;
        const first = textures.down ?? textures.right ?? Object.values(textures)[0];
        if (!first) continue;
        const sprite = new Sprite(first);
        sprite.anchor.set(0.5);
        // 配件按 1:1 叠加：亚像素缩放会把图标糊成一团
        sprite.scale.set(1);
        sprite.tint = tintFor(appearance, spec.colorKey);
        entries.push({ sprite, frames: null, colorKey: spec.colorKey, cosmeticKind: spec.cosmeticKind, textures });
      }
    }

    if (token !== this.token) return;
    for (const child of this.container.removeChildren()) child.destroy();
    this.entries = entries;
    for (const entry of entries) this.container.addChild(entry.sprite);
    this.layoutCosmetics();
  }

  setAppearance(next: CharacterAppearance): void {
    this.appearanceValue = next;
    if (variantKey(next) !== this.builtKey) {
      void this.build(next);
      return;
    }
    for (const entry of this.entries) {
      if (entry.colorKey) entry.sprite.tint = tintFor(next, entry.colorKey);
    }
  }

  /**
   * 方向与帧列分开传：列数由 manifest 决定，调用方不该再知道「一行 8 帧」这种细节。
   */
  setPose(direction: number, column: number): void {
    const index = direction * this.atlas.columns + column;
    if (index === this.frameIndex) return;
    this.frameIndex = index;
    for (const entry of this.entries) {
      if (entry.frames) entry.sprite.texture = entry.frames[index] ?? entry.frames[0]!;
    }
    this.layoutCosmetics();
  }

  /** 四向图标一次读进 entry：切朝向只换 texture 引用，不在帧循环里 await */
  private async loadCosmeticTextures(kind: CosmeticKind, value: string): Promise<Record<string, Texture>> {
    const files = this.atlas.manifest.cosmeticFiles[kind]?.[value];
    const textures: Record<string, Texture> = {};
    if (!files) return textures;
    for (const [direction, path] of Object.entries(files)) {
      if (path) textures[direction] = await this.atlas.cosmetic(path);
    }
    return textures;
  }

  /**
   * 锚点按 物种 × 朝向 × 帧列 查表：呼吸、走路起伏、蹦跳与坐躺过渡帧各有一组，
   * 配件不会因为换姿势而悬空。锚点为 null 的朝向（如背面的眼镜）整层隐藏。
   */
  private layoutCosmetics(): void {
    if (this.entries.length === 0) return;
    const directionName = this.atlas.manifest.directions[directionOf(this.frameIndex)] ?? 'down';
    const column = this.frameIndex % this.atlas.columns;
    const byDirection = this.atlas.manifest.cosmeticAnchors[this.appearanceValue.species]?.[directionName];
    const anchors = byDirection?.[String(column)] ?? byDirection?.['0'];
    for (const entry of this.entries) {
      if (!entry.cosmeticKind) continue;
      const anchor = anchors?.[entry.cosmeticKind] ?? null;
      const texture = entry.textures?.[directionName];
      if (!anchor || !texture) {
        entry.sprite.visible = false;
        continue;
      }
      entry.sprite.visible = true;
      entry.sprite.texture = texture;
      entry.sprite.position.set(Math.round(anchor[0]), Math.round(anchor[1]));
    }
  }

  destroy(): void {
    this.token += 1;
    this.container.destroy({ children: true });
  }
}
