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

export type PonyPoseName = 'idle' | 'walk' | 'sit' | 'lie' | 'emote';

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

/** 暴露给调用方的常量：服务端下发的 pose 字符串直接可用 */
export const PONY_POSES: readonly PonyPoseName[] = ['idle', 'walk', 'sit', 'lie', 'emote'];
