'use client';

import { Sprite, Texture } from 'pixi.js';

/**
 * 全局柔光层：整张地图画完之后，在屏幕空间上覆盖一层乘算混色。
 *
 * 为什么是「屏幕空间的一个 quad」而不是给每个精灵换色：
 * 一次 blend 与场景复杂度无关，而逐精灵调色调要重走一遍所有材质。
 *
 * 为什么用 multiply：Pony Town 的静谧感来自「整个画面被同一层光笼罩」，
 * normal 叠加会抬黑位、让暗部发灰；multiply 只压亮部，暖色才浮得起来。
 *
 * 风险：WebGPU 下的高级混合走 Pixi 的扩展路径。若某台机器上 multiply 未生效，
 * 观感退化为同色 normal 叠加（略亮一档，不破坏画面），不阻断主流程；
 * 也可以用 `?light=0` 直接关掉这一层做线上定位（ADR-0013）。
 */

export interface LightTone {
  /** 乘算色：暖金 / 中性 / 暖橙 / 冷蓝 */
  color: number;
  alpha: number;
  label: 'night' | 'dawn' | 'day' | 'dusk';
}

interface Anchor extends LightTone {
  hour: number;
}

/**
 * 一天的光照锚点。相邻锚点之间线性插值，所以跨过整点不会有突然跳色。
 * 早晨锚点即需求里的 rgba(255,230,180,0.08)：压得比黄昏轻，清晨才不发灰。
 */
const ANCHORS: Anchor[] = [
  { hour: 0, color: 0x9fb6d9, alpha: 0.12, label: 'night' },
  { hour: 5, color: 0x9fb6d9, alpha: 0.12, label: 'night' },
  { hour: 7, color: 0xffe6b4, alpha: 0.08, label: 'dawn' },
  { hour: 11, color: 0xffffff, alpha: 0, label: 'day' },
  { hour: 16, color: 0xffd2a0, alpha: 0.1, label: 'day' },
  { hour: 18, color: 0xffb877, alpha: 0.18, label: 'dusk' },
  { hour: 21, color: 0x9fb6d9, alpha: 0.12, label: 'night' },
  { hour: 24, color: 0x9fb6d9, alpha: 0.12, label: 'night' },
];

/**
 * 冬季光照锚点（ADR-0046）：日出推后一小时、日落提前一小时，夜里的冷蓝再压深一档。
 *
 * 这是「雪天」而不是「北欧极夜」：alpha 只从 0.12 抬到 0.15，
 * 夜里仍看得清地面纹理；抬到 0.3 以上整张图会先糊成蓝黑，
 * 灯串那点暖光反而没了参照。
 */
const WINTER_ANCHORS: Anchor[] = [
  { hour: 0, color: 0xa8bfe0, alpha: 0.15, label: 'night' },
  { hour: 6, color: 0xa8bfe0, alpha: 0.15, label: 'night' },
  { hour: 8, color: 0xffe6b4, alpha: 0.09, label: 'dawn' },
  { hour: 11, color: 0xffffff, alpha: 0, label: 'day' },
  { hour: 15, color: 0xffd2a0, alpha: 0.12, label: 'day' },
  { hour: 17, color: 0xffb877, alpha: 0.2, label: 'dusk' },
  { hour: 20, color: 0xa8bfe0, alpha: 0.15, label: 'night' },
  { hour: 24, color: 0xa8bfe0, alpha: 0.15, label: 'night' },
];

function lerpChannel(a: number, b: number, t: number): number {
  const from = (a >> 16) & 0xff;
  const to = (b >> 16) & 0xff;
  const r = Math.round(from + (to - from) * t);
  const g0 = (a >> 8) & 0xff;
  const g1 = (b >> 8) & 0xff;
  const g = Math.round(g0 + (g1 - g0) * t);
  const b0 = a & 0xff;
  const b1 = b & 0xff;
  const bl = Math.round(b0 + (b1 - b0) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 纯函数：给定小时（0..24，可为小数）返回当前该叠的光 */
export function lightToneAt(hour: number, winter = false): LightTone {
  const anchors = winter ? WINTER_ANCHORS : ANCHORS;
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 12;
  let index = 0;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    if (h >= anchors[i]!.hour && h <= anchors[i + 1]!.hour) {
      index = i;
      break;
    }
  }
  const from = anchors[index]!;
  const to = anchors[index + 1] ?? from;
  const span = to.hour - from.hour;
  const t = span <= 0 ? 0 : (h - from.hour) / span;
  return {
    color: lerpChannel(from.color, to.color, t),
    alpha: from.alpha + (to.alpha - from.alpha) * t,
    label: t < 0.5 ? from.label : to.label,
  };
}

/** 每 30s 采样一次：跨整点时的变化最多延迟半分钟，看不出来 */
const SAMPLE_MS = 30_000;

export class AmbientLight {
  readonly sprite = new Sprite(Texture.WHITE);
  private nextSampleAt = 0;
  private lastKey = '';

  constructor(private readonly winter = false) {
    this.sprite.blendMode = 'multiply';
    this.sprite.anchor.set(0, 0);
    void this.applyNow();
  }

  /** 视口尺寸变化时同步铺满：这个 quad 在屏幕空间，不跟世界缩放 */
  resize(width: number, height: number): void {
    if (this.sprite.width === width && this.sprite.height === height) return;
    this.sprite.width = width;
    this.sprite.height = height;
  }

  /** 帧循环里只做一次时间比较，采样本身 30s 一次 */
  update(nowMs: number): void {
    if (nowMs < this.nextSampleAt) return;
    this.nextSampleAt = nowMs + SAMPLE_MS;
    this.applyNow();
  }

  private applyNow(): LightTone {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const tone = lightToneAt(hour);
    const key = `${tone.color}:${tone.alpha.toFixed(3)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.sprite.tint = tone.color;
      this.sprite.alpha = tone.alpha;
    }
    return tone;
  }
}
