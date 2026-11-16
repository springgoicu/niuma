/**
 * 低帧自适应画质档。
 *
 * 只作用在**非关键观感**层（夜色抬暗部、飘雪、远景名牌）。刻意不碰：
 * - DPR / backing store：`renderer.ts` 要求它与设备像素 1:1，改了会让像素块被重采样；
 * - 光图分辨率：降低后夜景会糊成一片色块，属于画风损失；
 * - 角色本体与地形：那是玩家判断位置的全部依据。
 *
 * 判定用「降快升慢 + 滞回」：连续 3 个采样窗口低于 45 才降一档，连续 12 秒高于
 * 55 才升一档，45–55 之间不动。这样在 48fps 附近不会来回切档（切档本身是可见的）。
 */

export type QualityTier = 'high' | 'balanced' | 'low';

/** 采样节拍：与 `session` 的 stats 推送同一个 2Hz 窗口，不额外起计时器 */
export const QUALITY_SAMPLE_MS = 500;

/** 降档线：低于它算「这一档撑不住」 */
const FALL_FPS = 45;
/** 连续几个采样窗口后才降一档（3 × 500ms ≈ 1.5 秒确认，两档降到底约 3 秒） */
const FALL_WINDOWS = 3;
/** 升档线：高于它才算恢复（与降档线留 10fps 滞回） */
const RISE_FPS = 55;
/** 恢复要连续稳住多久才升一档：升档慢，避免刚升上去又掉下来 */
const RISE_MS = 12_000;

/**
 * 判定状态。由会话持有一个实例，不用模块级单例——
 * 同一页面可能同时跑主会话与预览会话，共享状态会让它们互相拽档位。
 */
export interface QualitySignal {
  tier: QualityTier;
  /** 连续几个采样窗口低于降档线 */
  lowWindows: number;
  /** 当前档位下已连续多长时间高于升档线（毫秒） */
  riseMs: number;
}

export function createQualitySignal(): QualitySignal {
  return { tier: 'high', lowWindows: 0, riseMs: 0 };
}

/**
 * 推进一次采样，返回新的档位。
 *
 * `fps <= 0` 表示「还没测出来」（启动首窗口、后台切回），直接跳过判定：
 * 否则一进游戏就可能被判成低帧，玩家看到画质无缘无故地掉一档。
 */
export function stepQualitySignal(signal: QualitySignal, fps: number, dtMs: number): QualityTier {
  if (fps <= 0) return signal.tier;

  if (fps < FALL_FPS) {
    signal.riseMs = 0;
    signal.lowWindows += 1;
    if (signal.lowWindows >= FALL_WINDOWS && signal.tier !== 'low') {
      signal.tier = signal.tier === 'high' ? 'balanced' : 'low';
      signal.lowWindows = 0;
    }
    return signal.tier;
  }

  signal.lowWindows = 0;
  if (signal.tier === 'high' || fps <= RISE_FPS) {
    signal.riseMs = 0;
    return signal.tier;
  }

  signal.riseMs += dtMs;
  if (signal.riseMs >= RISE_MS) {
    signal.tier = signal.tier === 'low' ? 'balanced' : 'high';
    signal.riseMs = 0;
  }
  return signal.tier;
}
