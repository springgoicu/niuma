import { readFileSync } from 'node:fs';

/**
 * NPC 配置：环境变量为主，可选 JSON 覆盖细节节奏。
 *
 * 与 `GAME_MODERATION_LEXICON` 同一套降级纪律：文件读不到、JSON 坏了、字段越界，
 * 一律告警一次并退回默认值，绝不阻断开服。数量为 0 与 `enabled=false` 等价，
 * 都是「这台机器不生成同事与保安」的完整回滚开关。
 */
export interface NpcConfig {
  enabled: boolean;
  /** 普通同事数量，0 表示整批关闭（含保安）；上限 `MAX_NPC_COUNT` 防止误配把出口带宽打满 */
  count: number;
  /** 随机种子：固定后整场行为可复现，压测与回归都靠它 */
  seed: number;
  /** 是否允许对视、让路与招手 */
  interact: boolean;
  /** 步速系数：相对 `MOVE_SPEED`，永远不超过 1 */
  speed: { min: number; max: number };
  /** 三档停顿区间（毫秒）：短停、常规、长时间发呆 */
  pauseMs: {
    short: readonly [number, number];
    normal: readonly [number, number];
    long: readonly [number, number];
  };
  /** 邻居感知节流：不参与 20Hz 热路径 */
  socialIntervalMs: number;
}

/** 误配保护：2 是默认值（保安另算 3 位），64 已经足够把一条 3M 出口压到必须排队 */
export const MAX_NPC_COUNT = 64;
/** 步速上限：不能超过真人速度，否则远端回放看起来像瞬移 */
export const MAX_SPEED_FACTOR = 1;

export const DEFAULT_NPC_CONFIG: NpcConfig = {
  enabled: true,
  count: 2,
  // 每次开服换一批同事；固定种子只用于测试与复现
  seed: 0,
  interact: true,
  speed: { min: 0.62, max: 0.95 },
  pauseMs: {
    short: [1_200, 3_000],
    normal: [3_000, 12_000],
    long: [20_000, 60_000],
  },
  socialIntervalMs: 500,
};

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === '0' || value === 'false' || value === 'off') return false;
  if (value === '1' || value === 'true' || value === 'on') return true;
  return fallback;
}

function readCount(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(MAX_NPC_COUNT, parsed);
}

function readSeed(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed >>> 0;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readRange(
  value: unknown,
  fallback: readonly [number, number],
  min: number,
  max: number,
): readonly [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const lo = clampNumber(value[0], min, max, fallback[0]);
  const hi = clampNumber(value[1], min, max, fallback[1]);
  return hi < lo ? [hi, lo] : [lo, hi];
}

/**
 * 把一份不可信的 JSON 合并到基准配置上：逐字段校验，任何非法值都保留基准。
 * 纯函数，测试可以直接喂坏数据，不需要碰文件系统。
 */
export function parseNpcConfig(raw: unknown, base: NpcConfig = DEFAULT_NPC_CONFIG): NpcConfig {
  if (!raw || typeof raw !== 'object') return { ...base };
  const input = raw as Record<string, unknown>;
  const speed = (input.speed ?? {}) as Record<string, unknown>;
  const pause = (input.pauseMs ?? {}) as Record<string, unknown>;

  const speedMin = clampNumber(speed.min, 0.3, MAX_SPEED_FACTOR, base.speed.min);
  const speedMax = clampNumber(speed.max, 0.3, MAX_SPEED_FACTOR, base.speed.max);

  return {
    ...base,
    // 上下界写反时按升序纠正：range(min > max) 会产生反向步速
    speed: speedMax < speedMin ? { min: speedMax, max: speedMin } : { min: speedMin, max: speedMax },
    pauseMs: {
      short: readRange(pause.short, base.pauseMs.short, 200, 300_000),
      normal: readRange(pause.normal, base.pauseMs.normal, 200, 300_000),
      long: readRange(pause.long, base.pauseMs.long, 200, 300_000),
    },
    socialIntervalMs: clampNumber(input.socialIntervalMs, 100, 5_000, base.socialIntervalMs),
  };
}

/** 读一次外置 JSON；失败只告警并回退，不抛异常 */
function readConfigFile(path: string): unknown | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    console.warn(`[npc] config unavailable: ${(error as Error).message}; falling back to defaults`);
    return null;
  }
}

export function loadNpcConfig(env: NodeJS.ProcessEnv = process.env): NpcConfig {
  const seed = readSeed(env.GAME_NPC_SEED, (Date.now() ^ process.pid) >>> 0);
  const fromEnv: NpcConfig = {
    ...DEFAULT_NPC_CONFIG,
    enabled: readBool(env.GAME_NPC_ENABLED, DEFAULT_NPC_CONFIG.enabled),
    count: readCount(env.GAME_NPC_COUNT, DEFAULT_NPC_CONFIG.count),
    seed,
    interact: readBool(env.GAME_NPC_INTERACT, DEFAULT_NPC_CONFIG.interact),
  };

  const file = readConfigFile(env.GAME_NPC_CONFIG ?? '');
  if (!file) return fromEnv;
  return parseNpcConfig(file, fromEnv);
}
