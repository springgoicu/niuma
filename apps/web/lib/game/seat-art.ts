'use client';

import type { Direction, SeatKind } from '@niuma/shared-types';
import { chairArtFor } from './chair-art';

/**
 * 座位接触契约（ADR-0032）：家具精灵尺寸、下沉量与「人坐上后该抬多高」的唯一来源。
 *
 * 坐姿贴图是按「坐在空地上」画的（臀底贴脚底锚点，ADR-0031），家具却各自有厚薄不同的
 * 座面。两者之间原来没有任何契约：`SEAT_ART.sink` 只挪家具，不挪人，于是四向椅子把人
 * 陷进去 8–15 纹素，且每个朝向陷得不一样深。
 *
 * 本模块只回答两个问题，纯函数、不 import pixi：
 * 1. 这个座位的精灵多大、相对座位锚点下沉多少；
 * 2. 角色坐上去要把身体抬几个纹素，才能让臀底正好落在座面顶面。
 */
export interface SeatArt {
  frame: { w: number; h: number };
  /** 精灵相对座位锚点的下沉量 */
  sink: number;
  /** 座面接触高度（相对座位锚点，负值向上）；没有可坐平面时为 null */
  contactY: number | null;
}

/**
 * 坐姿贴图里臀底相对脚底锚点的高度。
 * `quadruped.ts` 的侧视坐姿用 `hipBottom = FEET`，渲染后最低行是 `FEET - 1`，
 * 锚点本身就在 `FEET`，所以臀底 = 锚点 - 1。
 */
export const SIT_HIP_Y = -1;

const CHAIR_SINK = 6;

const OTHER_SEATS: Record<Exclude<SeatKind, 'chair'>, { w: number; h: number; sink: number }> = {
  toilet: { w: 22, h: 28, sink: 6 },
  stool: { w: 18, h: 22, sink: 4 },
  sofa: { w: 58, h: 30, sink: 8 },
  bed: { w: 64, h: 42, sink: 16 },
};

/**
 * 座位几何。椅子的座面顶由 `chair-art.ts` 的帧内 `seat.y` 推出：
 * 帧底 = 座位锚点 + sink，帧内 y 换算到世界坐标要减去帧高。
 */
export function seatArtFor(kind: SeatKind, facing: Direction): SeatArt {
  if (kind === 'chair') {
    const art = chairArtFor(facing);
    return {
      frame: art.frame,
      sink: CHAIR_SINK,
      contactY: CHAIR_SINK - art.frame.h + art.seat.y,
    };
  }
  const { w, h, sink } = OTHER_SEATS[kind];
  return { frame: { w, h }, sink, contactY: null };
}

/**
 * 角色坐上该座位时的抬升纹素。地面坐姿（无座位）与非椅子的座位返回 0：
 * 马桶 / 沙发 / 床 / 凳子的贴合不在本轮范围，契约留在这里，后续按同样方式登记即可。
 *
 * 帧循环每个可见实体每帧都会读一次，结果按 `kind:facing` 缓存（至多 5×4 种），
 * 稳态下只剩一次 Map 查询，不再每帧构造几何对象。
 */
const LIFT_CACHE = new Map<string, number>();

export function seatLift(kind: SeatKind, facing: Direction): number {
  const key = `${kind}:${facing}`;
  const cached = LIFT_CACHE.get(key);
  if (cached !== undefined) return cached;
  const { contactY } = seatArtFor(kind, facing);
  const lift = contactY === null ? 0 : Math.max(0, Math.round(SIT_HIP_Y - contactY));
  LIFT_CACHE.set(key, lift);
  return lift;
}
