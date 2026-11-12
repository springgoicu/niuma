import { readFileSync } from 'node:fs';
import type { NpcRegionConfig } from './spots';

/**
 * NPC 配置：环境变量为主，可选 JSON 覆盖细节节奏。
 *
 * 与 `GAME_MODERATION_LEXICON` 同一套降级纪律：文件读不到、JSON 坏了、字段越界，
 * 一律告警一次并退回默认值，绝不阻断开服。数量为 0 与 `enabled=false` 等价，
 * 都是「这台机器不生成同事」的完整回滚开关。
 */
export interface NpcConfig {
  enabled: boolean;
  /** 0 表示关闭；上限 `MAX_NPC_COUNT` 防止误配把出口带宽打满 */
  count: number;
  /** 随机种子：固定后整场行为可复现，压测与回归都靠它 */
  seed: number;
  /** 是否允许低频频道发言 */
  chat: boolean;
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
  /** 发言间隔（毫秒）：首次与后续 */
  chatDelayMs: {
    first: readonly [number, number];
    repeat: readonly [number, number];
  };
  /** 外置台词池；空数组表示用内置池。进频道前由 director 走与昵称同一套审核 */
  chatLines: readonly string[];
  /** 活动区域覆盖项：只改权重与半径，坐标由 spots.ts 定义 */
  regions: ReadonlyArray<NpcRegionConfig>;
}

/** 误配保护：10 是默认值，64 已经足够把一条 3M 出口压到必须排队 */
export const MAX_NPC_COUNT = 64;
/** 步速上限：不能超过真人速度，否则远端回放看起来像瞬移 */
export const MAX_SPEED_FACTOR = 1;

export const DEFAULT_NPC_CONFIG: NpcConfig = {
  enabled: true,
  count: 10,
  // 每次开服换一批同事；固定种子只用于测试与复现
  seed: 0,
  chat: true,
  interact: true,
  speed: { min: 0.62, max: 0.95 },
  pauseMs: {
    short: [1_200, 3_000],
    normal: [3_000, 12_000],
    long: [20_000, 60_000],
  },
  socialIntervalMs: 500,
  chatDelayMs: {
    first: [60_000, 180_000],
    repeat: [240_000, 600_000],
  },
  chatLines: [],
  regions: [],
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

function readChatLines(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const line = raw.trim();
    // 与聊天正文同一个长度口径；空串与重复项直接丢弃
    if (line.length === 0 || line.length > 160 || out.includes(line)) continue;
    out.push(line);
    if (out.length >= 40) break;
  }
  return out;
}

function readRegionOverrides(value: unknown, fallback: ReadonlyArray<NpcRegionConfig>): NpcRegionConfig[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: NpcRegionConfig[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { id?: unknown; weight?: unknown; radius?: unknown };
    if (typeof entry.id !== 'string' || entry.id.length === 0 || seen.has(entry.id)) continue;
    const weight = clampNumber(entry.weight, 0, 100, 1);
    // 半径下限高于广场出生安全区，上限小于半个岛：越界值只会得到「更保守」的区域
    const radius = clampNumber(entry.radius, 120, 1_200, 480);
    seen.add(entry.id);
    out.push({ id: entry.id, weight, radius });
  }
  return out;
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
  const chatDelay = (input.chatDelayMs ?? {}) as Record<string, unknown>;

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
    chatDelayMs: {
      first: readRange(chatDelay.first, base.chatDelayMs.first, 5_000, 3_600_000),
      repeat: readRange(chatDelay.repeat, base.chatDelayMs.repeat, 5_000, 3_600_000),
    },
    chatLines: readChatLines(input.chatLines, base.chatLines),
    regions: readRegionOverrides(input.regions, base.regions),
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
    chat: readBool(env.GAME_NPC_CHAT, DEFAULT_NPC_CONFIG.chat),
    interact: readBool(env.GAME_NPC_INTERACT, DEFAULT_NPC_CONFIG.interact),
  };

  const file = readConfigFile(env.GAME_NPC_CONFIG ?? '');
  if (!file) return fromEnv;
  return parseNpcConfig(file, fromEnv);
}
