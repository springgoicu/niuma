import {
  HOTSPOT_SERVER_SLACK,
  WORK_REWARD,
  hotspotById,
  isNightShift,
  isWithinHotspot,
  seatMatchesHotspot,
  workDeskHotspotId,
  workDeskIndexOfSeat,
  workPayout,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * 工位搬砖的权威结算（ADR-0088 / ADR-0093）。
 *
 * 客户端只上报「我完成了一轮」，坐姿、位置与时间间隔一律由这里裁决：
 * - 必须坐在本工位椅上（`seatMatchesHotspot` 与赌桌 / 长椅同一把尺）：地面坐、赌桌、长椅都不算打工；
 * - 必须还在对应工位热区里：坐下后被人撞开或被拖走就领不到；
 * - 两轮之间至少 `MinGapMs`：连点脚本刷不出第二份工资；
 * - 倒地 / 昏迷 / 治疗期间不结算，避免躺着赚钱。
 */
export interface WorkClaimOutcome {
  amount: number;
  /** 十分位倍率（工效 × 夜班），用于结果包与日志 */
  mult: number;
  night: boolean;
}

/** 搬砖被拒的原因：分发层据此发 `S2C_INTERACT_REJECT`，不再静默丢弃 */
export type WorkClaimFailure = 'busy' | 'cooldown' | 'notSeated' | 'far' | 'unknown';

export type WorkClaimResult =
  | { ok: true; outcome: WorkClaimOutcome }
  | { ok: false; reason: WorkClaimFailure };

export function resolveWorkClaim(
  player: Player,
  now: number,
  hour: number,
  roll: number,
): WorkClaimResult {
  if (player.incapacitated || now < player.stunUntil) return { ok: false, reason: 'busy' };
  if (now - player.lastWorkClaimAt < WORK_REWARD.MinGapMs) return { ok: false, reason: 'cooldown' };
  const deskIndex = workDeskIndexOfSeat(player.seat);
  if (deskIndex < 0) return { ok: false, reason: 'notSeated' };
  const hotspot = hotspotById(workDeskHotspotId(deskIndex));
  if (!hotspot) return { ok: false, reason: 'unknown' };
  // 入座门：必须是「坐在这一桌的工位上」，与赌桌 / 观战长椅同一套判定
  if (!seatMatchesHotspot(hotspot, player.seat)) return { ok: false, reason: 'notSeated' };
  // 与其它热区包同一把尺子：半径 + 网络延迟余量
  if (!isWithinHotspot(hotspot, player.x, player.y, HOTSPOT_SERVER_SLACK)) {
    return { ok: false, reason: 'far' };
  }

  const night = isNightShift(hour);
  const level = Math.max(0, Math.min(10, Math.floor(player.stats.workEffLv) || 0));
  const amount = workPayout(roll, level, night);
  if (amount <= 0) return { ok: false, reason: 'unknown' };
  const effMul = 1 + WORK_REWARD.PerEffLv * level;
  const mult = Math.round(effMul * (night ? WORK_REWARD.NightMul : 1) * 10);

  player.lastWorkClaimAt = now;
  return { ok: true, outcome: { amount, mult, night } };
}
