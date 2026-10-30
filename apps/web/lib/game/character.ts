'use client';

import { Container, Sprite, type Texture } from 'pixi.js';
import type { CharacterAppearance } from '@niuma/shared-types';
import { mixHex } from '../color';
import { directionOf, type Atlas, type SpriteManifest } from './atlas';

/**
 * tint 只能乘、不能提亮，所以高光必须借独立图层，再把本体色往白里混一份当 tint。
 * 这两个 key 不是外观字段（协议里仍然只有 5 色），只是派生的染色槽。
 */
type TintKey = 'body' | 'pattern' | 'hoof' | 'eyes' | 'extra' | 'bodyLight' | 'eyeLight';
type CosmeticKind = 'head' | 'eyes' | 'neck' | 'back';

interface TintLayer {
  kind: 'tint';
  path: string;
  colorKey: TintKey;
}

interface CosmeticLayer {
  kind: 'cosmetic';
  cosmeticKind: CosmeticKind;
  value: string;
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

/**
 * 叠层顺序即前后关系：背包在身后；帽子排在 extra 之前，牛角与马鬃从帽子上方穿出，
 * 戴帽不会丢掉物种剪影；眼镜压在眼睛上、口鼻之下；颈饰最后叠，压在下巴与胸口的交界。
 */
function layerSpecs(manifest: SpriteManifest, appearance: CharacterAppearance): LayerSpec[] {
  const species = manifest.species[appearance.species] ?? manifest.species.cow!;
  const extraId = appearance.species === 'cow' ? appearance.parts.hornId ?? 0 : appearance.parts.maneId ?? 0;
  const body = species.body[appearance.parts.tailId] ?? species.body[0]!;
  const bodyLight = species.bodyLight?.[appearance.parts.tailId] ?? species.bodyLight?.[0];
  const snout = species.snout[appearance.parts.snoutId] ?? species.snout[0]!;
  const pattern = appearance.parts.patternId > 0 ? species.pattern[appearance.parts.patternId] : undefined;
  const extra = species.extra[extraId];
  const eyeLight = species.eyeLight?.[0];

  const specs: LayerSpec[] = [];
  const back = appearance.cosmetics.backItem;
  if (back && back !== 'none') specs.push({ kind: 'cosmetic', cosmeticKind: 'back', value: back });

  specs.push({ kind: 'tint', path: body, colorKey: 'body' });
  if (pattern) specs.push({ kind: 'tint', path: pattern, colorKey: 'pattern' });
  if (bodyLight) specs.push({ kind: 'tint', path: bodyLight, colorKey: 'bodyLight' });

  const headwear = appearance.cosmetics.headwear;
  if (headwear && headwear !== 'none') specs.push({ kind: 'cosmetic', cosmeticKind: 'head', value: headwear });

  specs.push({ kind: 'tint', path: species.hoof[0]!, colorKey: 'hoof' });
  if (extra) specs.push({ kind: 'tint', path: extra, colorKey: 'extra' });
  specs.push({ kind: 'tint', path: species.eyes[0]!, colorKey: 'eyes' });
  if (eyeLight) specs.push({ kind: 'tint', path: eyeLight, colorKey: 'eyeLight' });

  const eyewear = appearance.cosmetics.eyewear;
  if (eyewear && eyewear !== 'none') specs.push({ kind: 'cosmetic', cosmeticKind: 'eyes', value: eyewear });

  specs.push({ kind: 'tint', path: snout, colorKey: 'body' });

  const neckwear = appearance.cosmetics.neckwear;
  if (neckwear && neckwear !== 'none') specs.push({ kind: 'cosmetic', cosmeticKind: 'neck', value: neckwear });

  return specs;
}

function variantKey(appearance: CharacterAppearance): string {
  const extra = appearance.species === 'cow' ? appearance.parts.hornId : appearance.parts.maneId;
  return [
    appearance.species,
    appearance.parts.patternId,
    appearance.parts.snoutId,
    extra,
    appearance.parts.tailId,
    appearance.cosmetics.backItem,
    appearance.cosmetics.headwear,
    appearance.cosmetics.eyewear,
    appearance.cosmetics.neckwear,
  ].join('|');
}

/**
 * 分层角色：每层是灰度图 + tint，等价于调色板替换但完全合批、每帧零开销。
 * 变体（物种/配件/斑纹）变化才重建精灵，纯颜色变化只改 tint。
 */
export class CharacterSprite {
  readonly container = new Container();
  private entries: LayerEntry[] = [];
  private frameIndex = 0;
  private token = 0;
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
        sprite.anchor.set(0.5, 45 / 48);
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
        entries.push({ sprite, frames: null, cosmeticKind: spec.cosmeticKind, textures });
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
