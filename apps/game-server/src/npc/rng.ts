/**
 * NPC 的唯一随机源（mulberry32）。
 *
 * 整场随机都由 `GAME_NPC_SEED` 派生：同一个种子跑出同一批同事、同一串路点与停顿，
 * 测试才能对「停顿落在区间内」「卡住后会换方向」这类行为做确定性断言。
 * 运行期不要再用 `Math.random` 兜底，否则复现性会在某个分支上悄悄失效。
 */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [min, max) */
  range(min: number, max: number): number;
  /** [min, max] 的整数 */
  int(min: number, max: number): number;
  /** 以 probability（0–1）的概率为真 */
  chance(probability: number): boolean;
  /** 从非空数组里取一项 */
  pick<T>(items: readonly T[]): T;
  /** 洗牌副本，不改入参 */
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32：32 位状态、无外部依赖，同种子逐位可复现 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const swap = out[i]!;
        out[i] = out[j]!;
        out[j] = swap;
      }
      return out;
    },
  };
}
