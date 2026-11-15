import {
  HOTSPOT_SERVER_SLACK,
  WORK_REWARD,
  hotspotById,
  isNightShift,
  isWithinHotspot,
  isWorkDeskSeat,
  workDeskHotspotId,
  workDeskIndexOfSeat,
  workPayout,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * 工位搬砖的权威结算（ADR-0088）。
 *
 * 客户端只上报「我完成了一轮」，坐姿、位置与时间间隔一律由这里裁决：
 * - 必须坐在工位椅上（`isWorkDeskSeat`）：地面坐、赌桌、长椅都不算打工；
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

export function resolveWorkClaim(
  player: Player,
  now: number,
  hour: number,
  roll: number,
): WorkClaimOutcome | null {
  if (player.seat === 0 || !isWorkDeskSeat(player.seat)) return null;
  if (player.incapacitated || now < player.stunUntil) return null;
  if (now - player.lastWorkClaimAt < WORK_REWARD.MinGapMs) return null;
  const deskIndex = workDeskIndexOfSeat(player.seat);
  if (deskIndex < 0) return null;
  const hotspot = hotspotById(workDeskHotspotId(deskIndex));
  if (!hotspot) return null;
  // 与其它热区包同一把尺子：半径 + 网络延迟余量
  if (!isWithinHotspot(hotspot, player.x, player.y, HOTSPOT_SERVER_SLACK)) return null;

  const night = isNightShift(hour);
  const level = Math.max(0, Math.min(10, Math.floor(player.stats.workEffLv) || 0));
  const amount = workPayout(roll, level, night);
  if (amount <= 0) return null;
  const effMul = 1 + WORK_REWARD.PerEffLv * level;
  const mult = Math.round(effMul * (night ? WORK_REWARD.NightMul : 1) * 10);

  player.lastWorkClaimAt = now;
  return { amount, mult, night };
}
