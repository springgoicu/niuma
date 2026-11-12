/**
 * 昼夜色调：整条光照管线的唯一时间源。
 *
 * 与旧 `ambient-light.ts` 的区别只有一处语义：`alpha` 改成 `ambient`，
 * 表示「环境底被压暗的深度」（0 = 纯白，1 = 全黑），供 Lightmap 直接做乘算。
 * 这样同一份锚点既描述屏幕上的冷暖，也描述光图里环境底要压到多暗，
 * 不再出现「柔光层 alpha 0.12 但光图按另一套曲线压暗」的双重事实源。
 *
 * 数值取的是「能读出夜」而不是「真实夜间照度」：园区夜里仍要看得清地面纹理，
 * 所以最深夜的乘子只到约 (0.57, 0.63, 0.74)；再暗会先糊成蓝黑，灯下的暖光反而失去参照。
 */

export interface LightTone {
  /** 环境光基色：光图里会以 `ambient` 深度混到白色上 */
  color: number;
  /** 环境压暗深度：0 = 白天纯白，1 = 完全压黑 */
  ambient: number;
  label: 'night' | 'dawn' | 'day' | 'dusk';
}

interface Anchor extends LightTone {
  hour: number;
}

/**
 * 一天的光照锚点，相邻锚点之间线性插值，跨整点不会突然跳色。
 *
 * 夜间用比旧柔光更深的冷蓝：旧值 alpha 0.12 只把画面压掉 6%，
 * 点光源没有暗底可以「穿透」；这里压到约 0.68 的深度，
 * 暖光才有对比空间（ADR-0048）。
 */
const ANCHORS: Anchor[] = [
  { hour: 0, color: 0x5f739e, ambient: 0.68, label: 'night' },
  { hour: 5, color: 0x5f739e, ambient: 0.68, label: 'night' },
  { hour: 7, color: 0xffe6b4, ambient: 0.18, label: 'dawn' },
  { hour: 11, color: 0xffffff, ambient: 0, label: 'day' },
  { hour: 16, color: 0xffd2a0, ambient: 0.12, label: 'day' },
  { hour: 18, color: 0xffb877, ambient: 0.32, label: 'dusk' },
  { hour: 21, color: 0x5f739e, ambient: 0.68, label: 'night' },
  { hour: 24, color: 0x5f739e, ambient: 0.68, label: 'night' },
];

/**
 * 冬季锚点（ADR-0046）：日出推后、日落提前，夜里的冷蓝再压深一档。
 * 冬天比夏天暗，但仍是「雪夜」而不是极夜：最深夜乘子约 (0.54, 0.59, 0.72)。
 */
const WINTER_ANCHORS: Anchor[] = [
  { hour: 0, color: 0x566a94, ambient: 0.72, label: 'night' },
  { hour: 6, color: 0x566a94, ambient: 0.72, label: 'night' },
  { hour: 8, color: 0xffe6b4, ambient: 0.2, label: 'dawn' },
  { hour: 11, color: 0xffffff, ambient: 0, label: 'day' },
  { hour: 15, color: 0xffd2a0, ambient: 0.14, label: 'day' },
  { hour: 17, color: 0xffb877, ambient: 0.36, label: 'dusk' },
  { hour: 20, color: 0x566a94, ambient: 0.72, label: 'night' },
  { hour: 24, color: 0x566a94, ambient: 0.72, label: 'night' },
];

/** 每 30s 采样一次：跨整点时的变化最多延迟半分钟，看不出来 */
export const TONE_SAMPLE_MS = 30_000;

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

/** 纯函数：给定小时（0..24，可为小数）返回当前该用的时段光 */
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
    ambient: from.ambient + (to.ambient - from.ambient) * t,
    label: t < 0.5 ? from.label : to.label,
  };
}

/**
 * 环境乘子：把「冷蓝」按深度混到白色上，得到光图的清屏色。
 * 白昼 depth 0 时严格返回 0xffffff，让 Multiply 成为恒等变换。
 */
export function ambientMultiplierOf(tone: LightTone): number {
  const depth = Math.min(1, Math.max(0, tone.ambient));
  if (depth <= 0) return 0xffffff;
  return lerpChannel(0xffffff, tone.color, depth);
}

/**
 * 局部光增益：灯在天黑到什么程度才开始亮。
 * 白昼 0 时整层可以跳过；黄昏约 0.6，深夜 1。
 */
export function localLightGain(tone: LightTone): number {
  const depth = Math.min(1, Math.max(0, tone.ambient));
  return Math.min(1, Math.max(0, (depth - 0.05) / 0.45));
}
