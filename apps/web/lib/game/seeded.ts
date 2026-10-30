/**
 * mulberry32：只用于美术撒点（草簇、树叶、岸边碎石）。
 * 世界布局那份随机在 shared-types 里，必须双端一致；这里只负责「每次启动长得一样」。
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
