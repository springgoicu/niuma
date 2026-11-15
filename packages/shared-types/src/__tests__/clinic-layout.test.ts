import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, isBlocked, resolveMotion } from '../world/collision';
import {
  CLINIC_ACCESS_PAVING,
  CLINIC_AMBULANCE_SPOTS,
  CLINIC_BEDS,
  CLINIC_COUNTER,
  CLINIC_DROP,
  CLINIC_FENCE_SOLIDS,
  CLINIC_RECT,
  CLINIC_VEHICLE_ENTRY,
  type SolidRect,
} from '../world/layout';

const EAST_GATE = { x: 5200, y: 4755 };

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 沿直线每 2px 采一次样：救护车与玩家都是圆形碰撞体，逐点判空等价于扫掠 */
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

describe('护士站围挡（ADR-0092）', () => {
  it('西侧人行门洞可通行，进门就是站台铺装', () => {
    expect(clearLine({ x: 4960, y: 4350 }, { x: 5020, y: 4350 })).toBe(true);
    // 门洞正中心留出玩家半径净空：9 + 56 + 9 的通道随便走
    expect(isBlocked(4995, 4340, PLAYER_RADIUS)).toBe(false);
    expect(isBlocked(4995, 4360, PLAYER_RADIUS)).toBe(false);
  });

  it('门洞与进站铺装同高，铺装直接接到门口', () => {
    expect(westFence).toHaveLength(2);
    const [upper, lower] = [...westFence].sort((a, b) => a.y - b.y);
    expect(upper!.y + upper!.h).toBe(CLINIC_ACCESS_PAVING.y);
    expect(lower!.y).toBe(CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h);
    expect(CLINIC_ACCESS_PAVING.x + CLINIC_ACCESS_PAVING.w).toBe(CLINIC_RECT.x);
  });

  it('北、东、西三面挡人，撞上去是滑行而不是穿模', () => {
    expect(isBlocked(5100, 4255)).toBe(true);
    expect(isBlocked(5245, 4350)).toBe(true);
    expect(isBlocked(4995, 4300)).toBe(true);
    expect(isBlocked(4995, 4420)).toBe(true);
    // 从站外北侧往站内走，被北栏拦住
    expect(resolveMotion(5100, 4230, 5100, 4300).y).toBeLessThan(CLINIC_RECT.y);
    // 从站外西侧往站内走，被西栏拦住（门洞以外）
    expect(resolveMotion(4960, 4300, 5030, 4300).x).toBeLessThan(CLINIC_RECT.x);
  });

  it('南侧救护车通道敞开：两辆车都能直着开出站', () => {
    for (const spot of CLINIC_AMBULANCE_SPOTS) {
      expect(clearLine(spot, EAST_GATE)).toBe(true);
    }
    expect(isBlocked(CLINIC_VEHICLE_ENTRY.x, CLINIC_VEHICLE_ENTRY.y, PLAYER_RADIUS)).toBe(false);
    // 通道口到站内的落点/车位一路畅通，救护车不必贴墙磨
    expect(clearLine(CLINIC_VEHICLE_ENTRY, { x: 5080, y: 4396 })).toBe(true);
  });

  it('围挡不压铺装，也不和柜台、病床、落点、车位抢位置', () => {
    for (const bar of CLINIC_FENCE_SOLIDS) {
      expect(overlaps(bar, CLINIC_RECT)).toBe(false);
      expect(overlaps(bar, CLINIC_COUNTER)).toBe(false);
      for (const bed of CLINIC_BEDS) expect(overlaps(bar, bed)).toBe(false);
    }
    // 落点与两个车位仍在站内空地：围挡不能把它们圈进碰撞体
    for (const point of [CLINIC_DROP, ...CLINIC_AMBULANCE_SPOTS]) {
      expect(isBlocked(point.x, point.y, PLAYER_RADIUS)).toBe(false);
    }
  });
});
