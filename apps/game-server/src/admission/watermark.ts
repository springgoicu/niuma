import { LIMIT_KIND, type LimitKind } from '@niuma/shared-types';

/**
 * 三维负载采样。三者单位不同，不能相加，只能用「各自占预算的比例」再取最大。
 * - egressKbps：实测出口速率，来自 Transport 收口处的字节累计（不是按人数估算）
 * - online：已入场人数（排队者不算，他们没有广播）
 * - tickP95Ms：Tick 耗时 p95，反映真实卡顿而不是人数
 */
export interface LoadSample {
  egressKbps: number;
  online: number;
  tickP95Ms: number;
}

export interface LoadLimits {
  maxEgressKbps: number;
  maxOnline: number;
  tickBudgetMs: number;
}

export interface LoadWatermark {
  /** 0..1 的综合水位，取三维最大值；>= 1 表示已经越界 */
  utilization: number;
  /** 主导维度；三维都健康时为 None，UI 用它解释「为什么闸门闭着」 */
  dominant: LimitKind;
  ratios: {
    bandwidth: number;
    players: number;
    tick: number;
  };
}

function ratioOf(value: number, limit: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const base = Number.isFinite(limit) && limit > 0 ? limit : 1;
  return value / base;
}

export function measureLoad(sample: LoadSample, limits: LoadLimits): LoadWatermark {
  const bandwidth = ratioOf(sample.egressKbps, limits.maxEgressKbps);
  const players = ratioOf(sample.online, limits.maxOnline);
  const tick = ratioOf(sample.tickP95Ms, limits.tickBudgetMs);

  const utilization = Math.max(bandwidth, players, tick);

  // 平手时优先报带宽：3M 机器上它才是真正的约束，报人数会误导排查方向
  let dominant: LimitKind = LIMIT_KIND.None;
  if (utilization >= 1) {
    let best = bandwidth;
    dominant = LIMIT_KIND.Bandwidth;
    if (players > best) {
      best = players;
      dominant = LIMIT_KIND.Players;
    }
    if (tick > best) {
      dominant = LIMIT_KIND.Tick;
    }
  }

  return { utilization, dominant, ratios: { bandwidth, players, tick } };
}

/** 协议里的水位是千分比整数，越界值钳到 0..1000 */
export function toPermille(utilization: number): number {
  if (!Number.isFinite(utilization)) return 0;
  return Math.min(1000, Math.max(0, Math.round(utilization * 1000)));
}
