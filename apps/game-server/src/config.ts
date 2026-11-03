import type { AdmissionConfig } from './admission/controller';

export interface ServerConfig {
  port: number;
  hostname: string;
  /** 单连接每秒最多处理的消息数，超出直接丢弃，防止单客户端打满 Tick */
  maxMessagesPerSecond: number;
  helloTimeoutMs: number;
  /** 出生点散布半径（像素），压测时放大可模拟稀疏分布 */
  spawnRadius: number;
  /** 准入与排队策略；容量、水位、放行速率全部可配 */
  admission: AdmissionConfig;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === '0' || value === 'false' || value === 'off') return false;
  if (value === '1' || value === 'true' || value === 'on') return true;
  return fallback;
}

/**
 * 2C2G / 3Mbps 单机的现实预算：
 * - 320 KB/s 出口 = 3Mbps 理论 375 KB/s 扣掉 TCP/TLS 开销后留 15% 余量
 * - Tick 预算 25ms = 50ms 周期的一半，超过就该关闸
 * - 基准容量 60 人，AIMD 会在稳定期往上探、越界时按 25% 收缩
 * 全部可用环境变量覆盖，便于压测时把阈值调低来观察排队行为。
 */
export function loadConfig(): ServerConfig {
  const admission: AdmissionConfig = {
    enabled: readBool(process.env.GAME_QUEUE_ENABLED, true),
    maxOnline: readInt(process.env.GAME_MAX_ONLINE, 60),
    minCapacity: readInt(process.env.GAME_CAPACITY_MIN, 10),
    highWatermark: readFloat(process.env.GAME_WATERMARK_HIGH, 0.85),
    lowWatermark: readFloat(process.env.GAME_WATERMARK_LOW, 0.65),
    capacityStep: readInt(process.env.GAME_CAPACITY_STEP, 2),
    shrinkRatio: readFloat(process.env.GAME_SHRINK_RATIO, 0.75),
    stableMs: readInt(process.env.GAME_STABLE_MS, 30_000),
    shrinkIntervalMs: readInt(process.env.GAME_SHRINK_INTERVAL_MS, 10_000),
    breakerFactor: readFloat(process.env.GAME_BREAKER_FACTOR, 2),
    breakerStrikes: readInt(process.env.GAME_BREAKER_STRIKES, 3),
    maxEgressKbps: readInt(process.env.GAME_MAX_EGRESS_KBPS, 320),
    tickBudgetMs: readInt(process.env.GAME_TICK_BUDGET_MS, 25),
    admitPerTick: readInt(process.env.GAME_ADMIT_PER_TICK, 2),
    queueRatio: readFloat(process.env.GAME_QUEUE_RATIO, 2),
    queueMin: readInt(process.env.GAME_QUEUE_MIN, 50),
    queueMax: readInt(process.env.GAME_QUEUE_MAX, 1000),
    queueMaxWaitMs: readInt(process.env.GAME_QUEUE_MAX_WAIT_MS, 180_000),
    sampleIntervalMs: readInt(process.env.GAME_ADMISSION_SAMPLE_MS, 500),
  };

  return {
    port: readInt(process.env.GAME_SERVER_PORT, 3001),
    hostname: process.env.GAME_SERVER_HOST ?? '0.0.0.0',
    maxMessagesPerSecond: readInt(process.env.GAME_SERVER_MAX_MPS, 120),
    helloTimeoutMs: 5000,
    // 与 shared-types 的 SPAWN_RADIUS 对齐：世界放大 1.25 后出生圈同步放大
    spawnRadius: readInt(process.env.GAME_SPAWN_RADIUS, 300),
    admission,
  };
}
