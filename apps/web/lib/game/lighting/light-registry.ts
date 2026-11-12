/**
 * 点光源注册表：光源数据与 GPU 表现解耦。
 *
 * 场景里常驻 30–50 个地标光源，但一屏通常只看得到 2–10 个。
 * 这里只负责「存、改、按视口剔」，不碰 Pixi——光图、合批与混合都在 `lightmap.ts` 里，
 * 纯逻辑因此可以在 `bun:test` 里直接跑。
 *
 * 帧循环约定：`collect` 写入调用方复用的数组，不新建光源对象、不排序、不分配输出数组。
 */

export interface LightSpec {
  x: number;
  y: number;
  radius: number;
  /** 0xRRGGBB */
  color: number;
  intensity: number;
  /** 0..1 的随机抖动幅度：烛光约 0.16，霓虹接近 0 */
  flicker?: number;
}

export interface Light {
  readonly id: number;
  /** 抖动相位：由 id 派生，同帧不会所有灯一起闪 */
  readonly seed: number;
  x: number;
  y: number;
  radius: number;
  color: number;
  intensity: number;
  flicker: number;
}

/** `undefined` 表示不改这个字段；`flicker` 故意保留 `undefined` 语义 */
export type LightPatch = Partial<LightSpec>;

/** 一帧最多提交的光源数：场景常驻 39，留一倍余量给后续动态光源 */
export const MAX_LIGHTS = 64;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 圆与轴对齐矩形是否相交。用最近点距离而不是包围盒：
 * 对角落的光源，包围盒会把它当成可见，白白提交一个几乎照不到镜头的 quad。
 */
export function circleVisible(
  x: number,
  y: number,
  radius: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 烛光抖动 LUT：64 档、90ms 换一次，组合两条正弦得到不重复的噪声。
 * 用查表而不是每帧 `Math.random()`：同一种子逐帧可复现，测试才能断言区间。
 */
const FLICKER_STEPS = 64;
const FLICKER = new Float32Array(FLICKER_STEPS);
for (let i = 0; i < FLICKER_STEPS; i += 1) {
  const wave = Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.43 + 1.3) * 0.5;
  FLICKER[i] = 0.42 + 0.58 * (wave * 0.5 + 0.5);
}

export function flickerAt(seed: number, timeMs: number): number {
  const step = Math.floor(timeMs / 90 + seed * 7.31) % FLICKER_STEPS;
  return FLICKER[step < 0 ? step + FLICKER_STEPS : step]!;
}

/** 强度 × 抖动后的 alpha：`flicker = 0` 时原样返回强度 */
export function flickerAlpha(intensity: number, flicker: number, seed: number, timeMs: number): number {
  if (flicker <= 0) return intensity;
  const noise = flickerAt(seed, timeMs);
  return intensity * (1 - flicker + flicker * noise);
}

export class LightRegistry {
  private readonly items = new Map<number, Light>();
  private nextId = 1;

  get size(): number {
    return this.items.size;
  }

  /** 注册一个光源；坐标非法或超过容量返回 -1，不抛异常打断渲染 */
  add(spec: LightSpec): number {
    if (this.items.size >= MAX_LIGHTS) return -1;
    if (
      !Number.isFinite(spec.x) ||
      !Number.isFinite(spec.y) ||
      !Number.isFinite(spec.radius) ||
      !Number.isFinite(spec.color) ||
      !Number.isFinite(spec.intensity)
    ) {
      return -1;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.items.set(id, {
      id,
      seed: (id * 97) % 1024,
      x: spec.x,
      y: spec.y,
      radius: Math.max(0, spec.radius),
      color: spec.color,
      intensity: clamp(spec.intensity, 0, 4),
      flicker: clamp(spec.flicker ?? 0, 0, 1),
    });
    return id;
  }

  addAll(specs: readonly LightSpec[]): number[] {
    const ids: number[] = [];
    for (const spec of specs) {
      const id = this.add(spec);
      if (id >= 0) ids.push(id);
    }
    return ids;
  }

  update(id: number, patch: LightPatch): boolean {
    const light = this.items.get(id);
    if (!light) return false;
    if (patch.x !== undefined && Number.isFinite(patch.x)) light.x = patch.x;
    if (patch.y !== undefined && Number.isFinite(patch.y)) light.y = patch.y;
    if (patch.radius !== undefined && Number.isFinite(patch.radius)) {
      light.radius = Math.max(0, patch.radius);
    }
    if (patch.color !== undefined && Number.isFinite(patch.color)) light.color = patch.color;
    if (patch.intensity !== undefined && Number.isFinite(patch.intensity)) {
      light.intensity = clamp(patch.intensity, 0, 4);
    }
    if (patch.flicker !== undefined && Number.isFinite(patch.flicker)) {
      light.flicker = clamp(patch.flicker, 0, 1);
    }
    return true;
  }

  remove(id: number): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  /**
   * 视口剔除：把可见光源引用写进 `out`，返回数量。
   * `out.length` 会被截断，数组容量保留，下一帧继续复用。
   */
  collect(minX: number, minY: number, maxX: number, maxY: number, out: Light[]): number {
    let count = 0;
    for (const light of this.items.values()) {
      if (light.intensity <= 0 || light.radius <= 0) continue;
      if (!circleVisible(light.x, light.y, light.radius, minX, minY, maxX, maxY)) continue;
      out[count] = light;
      count += 1;
    }
    out.length = count;
    return count;
  }
}
