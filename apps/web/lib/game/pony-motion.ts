'use client';

/**
 * 角色微动效：纯函数，不依赖 Pixi、不持有状态。
 *
 * 纪律（ADR-0013）：
 * 1. 位移只取整数纹素，且只允许抬高（0 / -1）——角色永远不会陷进地面；
 * 2. 阴影形态用三档预烘焙纹理切换，不做浮点缩放：亚像素缩放会让硬像素边发糊；
 * 3. 所有相位用 netId 哈希错开，同屏的人不会像广播体操一样同时呼吸、同时眨眼。
 *
 * 需求文本里的「12 像素正弦浮动」被收敛到 1 texel：角色站立总高 48 texel，
 * 12 texel 等于四分之一身高，那是漂移而不是呼吸。
 */

export type PonyPoseName = 'idle' | 'walk' | 'sit' | 'lie' | 'vent';

export interface PonyMotion {
  /** 只允许 0 或 -1：抬高，永不下沉 */
  bobTexels: 0 | -1;
  /** 阴影形态：0 宽扁 / 1 常态 / 2 窄高 */
  shadow: 0 | 1 | 2;
  blinking: boolean;
}

/** 待机呼吸周期：比真呼吸略快，观感才有「活着」的错觉 */
const IDLE_PERIOD_MS = 3400;
/** 行走起伏周期：六拍一步 480ms，一个步幅起落两次 */
const WALK_BOB_PERIOD_MS = 240;
/** 眨眼周期 35s，按 netId 在 ±5s 内抖动 */
const BLINK_PERIOD_MS = 35000;
const BLINK_JITTER_MS = 5000;
const BLINK_HOLD_MS = 140;
/** 正弦阈值：只有明显处于「上半程」时才抬一档，否则角色会一直抖 */
const BOB_THRESHOLD = 0.62;
const SQUASH_THRESHOLD = -0.55;

/** 稳定的 0..1 哈希：同一 netId 每次进视野的相位一致 */
function hash01(value: number, salt: number): number {
  let h = Math.imul(value + 1, 0x9e3779b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function wave(elapsedMs: number, periodMs: number, phaseMs: number): number {
  return Math.sin(((elapsedMs + phaseMs) / periodMs) * Math.PI * 2);
}

export function ponyMotion(pose: PonyPoseName, elapsedMs: number, netId: number): PonyMotion {
  const phase = hash01(netId, 0x1b873593) * IDLE_PERIOD_MS;
  const blinkPeriod = BLINK_PERIOD_MS + (hash01(netId, 0x2545f491) * 2 - 1) * BLINK_JITTER_MS;

  if (pose === 'walk') {
    const value = wave(elapsedMs, WALK_BOB_PERIOD_MS, phase);
    return {
      bobTexels: value > BOB_THRESHOLD ? -1 : 0,
      // 腾空时阴影摊开、落地时收紧，这就是 squash & stretch 的全部
      shadow: value > BOB_THRESHOLD ? 0 : value < SQUASH_THRESHOLD ? 2 : 1,
      // 行走不眨眼：图集里的闭眼帧是「站立闭眼」，套到走动帧上会瞬移
      blinking: false,
    };
  }

  if (pose === 'idle') {
    const value = wave(elapsedMs, IDLE_PERIOD_MS, phase);
    const blinkPhase = (elapsedMs + hash01(netId, 0x7feb352d) * blinkPeriod) % blinkPeriod;
    return {
      bobTexels: value > BOB_THRESHOLD ? -1 : 0,
      // 待机不做落地压缩：站着不动时阴影缩一下会像被踩了一脚
      shadow: value > BOB_THRESHOLD ? 0 : 1,
      blinking: blinkPhase < BLINK_HOLD_MS,
    };
  }

  // 坐 / 躺 / 叫唤都不眨眼：闭眼帧是站立姿势，混进别的姿势会跳帧
  return { bobTexels: 0, shadow: 1, blinking: false };
}

/**
 * 跳跃弧线：图集只把角色抬高 5 纹素，单靠帧序列在 3 倍缩放下只有 15px，
 * 读起来像「抖了一下」。这里在播放窗口内再叠一条整数纹素的抛物线，
 * 落地归零——与图集的蹲/腾空/落地三帧叠加，蹲伏到顶点约 12 纹素。
 *
 * 纯函数、零分配：调用方每帧算一次数值，阴影档位由 lift 直接推导。
 */
export const JUMP_LIFT_PEAK = 7;
/** 起跳占比：前 20% 仍是蹲伏帧，不该离地 */
const JUMP_RISE_FROM = 0.2;
/** 落地占比：75% 之后进入落地帧，必须已经贴地，否则尘土会飘在空中 */
const JUMP_RISE_TO = 0.75;

/**
 * 跳跃窗口内的抬升纹素：0 或负整数，起落为 0，中段触顶 -PEAK。
 * `durationMs` 传 `overlays.jumpMs`，与图集时长保持一致。
 */
export function jumpLiftTexels(phaseMs: number, durationMs: number): number {
  if (!Number.isFinite(phaseMs) || phaseMs <= 0 || durationMs <= 0) return 0;
  const t = phaseMs >= durationMs ? 1 : phaseMs / durationMs;
  if (t <= JUMP_RISE_FROM || t >= JUMP_RISE_TO) return 0;
  const u = (t - JUMP_RISE_FROM) / (JUMP_RISE_TO - JUMP_RISE_FROM);
  return -Math.round(JUMP_LIFT_PEAK * Math.sin(Math.PI * u));
}

/** 腾空判定：抬到这个高度才把阴影摊平，避免起跳瞬间影子闪一下 */
const AIRBORNE_LIFT = -4;

/** 阴影档位：腾空摊开（0）/ 常态（1）。落地压缩交给图集的落地帧与扬尘 */
export function jumpShadowFor(liftTexels: number): 0 | 1 {
  return liftTexels <= AIRBORNE_LIFT ? 0 : 1;
}

/** 暴露给调用方的常量：服务端下发的 pose 字符串直接可用 */
export const PONY_POSES: readonly PonyPoseName[] = ['idle', 'walk', 'sit', 'lie', 'vent'];

/**
 * 合十作揖的下俯包络（ADR-0061）：900ms 内 0 → 2 → 0 的三角波。
 *
 * 与跳跃同一条纪律——量是整数纹素、方向只向下沉（正值），**不做纵向缩放**：
 * 非整数缩放会把 1px 描边拉成半像素（ADR-0005）。上下两段不对称（45% 下、55% 回），
 * 因为「俯身」比「起身」快一点才像在行礼而不是在鞠躬谢幕。
 */
export const BOW_DURATION_MS = 900;
const BOW_DEPTH = 2;

export function bowTexelsAt(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= BOW_DURATION_MS) return 0;
  const t = elapsedMs / BOW_DURATION_MS;
  const envelope = t < 0.45 ? t / 0.45 : (1 - t) / 0.55;
  return Math.max(0, Math.min(BOW_DEPTH, Math.round(envelope * BOW_DEPTH)));
}
