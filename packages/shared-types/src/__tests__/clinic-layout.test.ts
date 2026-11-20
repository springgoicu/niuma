import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, isBlocked, resolveMotion } from '../world/collision';
import {
  CLINIC_ACCESS_PAVING,
  CLINIC_AMBULANCE_SPOTS,
  CLINIC_BEDS,
  CLINIC_COFFEE_SPOT,
  CLINIC_COUNTER,
  CLINIC_DROP,
  CLINIC_FENCE_SOLIDS,
  CLINIC_NURSE_SPOTS,
  CLINIC_RECT,
  CLINIC_RESPAWN_POINT,
  CLINIC_VEHICLE_ENTRY,
  clinicBedSide,
  type SolidRect,
} from '../world/layout';

/** 服务广场上的空地（避开 (5200, 3980) 路口花箱）：救护车从站内开出来后停在这里 */
const SQUARE_EXIT = { x: CLINIC_RECT.x + 98, y: 3930 };

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 沿直线每 2px 采一次样 */
function clearLine(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (isBlocked(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, PLAYER_RADIUS)) {
      return false;
    }
  }
  return true;
}

const westFence: SolidRect[] = CLINIC_FENCE_SOLIDS.filter((bar) => bar.w < bar.h && bar.x < CLINIC_RECT.x);

describe('新版 3 床大急诊大厅（Stage 1 优化）', () => {
  it('西侧加宽人行大门几何畅通，直接衔接无障碍铺装', () => {
    const gateMidY = CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h / 2;
    const approachX = CLINIC_ACCESS_PAVING.x - 20;
    const midX = CLINIC_ACCESS_PAVING.x + CLINIC_ACCESS_PAVING.w / 2;
    expect(clearLine({ x: approachX, y: gateMidY }, { x: CLINIC_ACCESS_PAVING.x, y: gateMidY })).toBe(true);
    expect(isBlocked(midX, CLINIC_ACCESS_PAVING.y + 12, PLAYER_RADIUS)).toBe(false);
    expect(isBlocked(midX, CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h - 12, PLAYER_RADIUS)).toBe(false);
  });

  it('门洞与进站铺装严格对齐且零缝隙', () => {
    expect(westFence).toHaveLength(2);
    const [upper, lower] = [...westFence].sort((a, b) => a.y - b.y);
    expect(upper!.y + upper!.h).toBe(CLINIC_ACCESS_PAVING.y);
    expect(lower!.y).toBe(CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h);
    expect(CLINIC_ACCESS_PAVING.x + CLINIC_ACCESS_PAVING.w).toBe(CLINIC_RECT.x);
  });

  it('柜台后方保留 38px 宽敞护士工作带，3 张病床护工站位全部无阻挡', () => {
    expect(CLINIC_COUNTER.y - CLINIC_RECT.y).toBe(38);
    for (const spot of CLINIC_NURSE_SPOTS) {
      expect(isBlocked(spot.x, spot.y, PLAYER_RADIUS)).toBe(false);
    }
    expect(CLINIC_BEDS).toHaveLength(3);
    for (let i = 0; i < CLINIC_BEDS.length; i += 1) {
      const side = clinicBedSide(i);
      expect(isBlocked(side.x, side.y, PLAYER_RADIUS), `bed ${i} side`).toBe(false);
    }
    expect(isBlocked(CLINIC_COFFEE_SPOT.x, CLINIC_COFFEE_SPOT.y, PLAYER_RADIUS)).toBe(false);
    expect(isBlocked(CLINIC_RESPAWN_POINT.x, CLINIC_RESPAWN_POINT.y, PLAYER_RADIUS)).toBe(false);
  });

  it('北、东、西围栏挡人但不自交', () => {
    expect(isBlocked(CLINIC_RECT.x + 120, CLINIC_RECT.y - 5)).toBe(true);
    expect(isBlocked(CLINIC_RECT.x + CLINIC_RECT.w + 5, CLINIC_RECT.y + 80)).toBe(true);
    expect(isBlocked(CLINIC_RECT.x - 5, CLINIC_RECT.y + 20)).toBe(true);
    expect(isBlocked(CLINIC_RECT.x - 5, CLINIC_RECT.y + CLINIC_RECT.h - 20)).toBe(true);
    expect(resolveMotion(CLINIC_RECT.x + 120, CLINIC_RECT.y - 40, CLINIC_RECT.x + 120, CLINIC_RECT.y + 40).y).toBeLessThan(CLINIC_RECT.y);
  });

  it('南侧 188px 救护车通道敞开：双车位都能直插出口', () => {
    for (const spot of CLINIC_AMBULANCE_SPOTS) {
      expect(clearLine(spot, SQUARE_EXIT)).toBe(true);
    }
    expect(isBlocked(CLINIC_VEHICLE_ENTRY.x, CLINIC_VEHICLE_ENTRY.y, PLAYER_RADIUS)).toBe(false);
    expect(clearLine(CLINIC_VEHICLE_ENTRY, CLINIC_DROP)).toBe(true);
  });

  it('围挡不压柜台、三张病床、落点或救护车位', () => {
    for (const bar of CLINIC_FENCE_SOLIDS) {
      expect(overlaps(bar, CLINIC_RECT)).toBe(false);
      expect(overlaps(bar, CLINIC_COUNTER)).toBe(false);
      for (const bed of CLINIC_BEDS) expect(overlaps(bar, bed)).toBe(false);
    }
    for (const point of [CLINIC_DROP, ...CLINIC_AMBULANCE_SPOTS]) {
      expect(isBlocked(point.x, point.y, PLAYER_RADIUS)).toBe(false);
    }
  });
});
