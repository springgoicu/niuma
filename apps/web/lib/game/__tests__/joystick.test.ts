import { describe, expect, it } from 'bun:test';
import { STICK_DEAD_ZONE, STICK_RADIUS, stickKnob, stickVector } from '../joystick';

const DIRECTIONS = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];

function magnitude(v: { x: number; y: number }): number {
  return Math.hypot(v.x, v.y);
}

describe('摇杆数学（ADR-0032）', () => {
  it('斜向与左右同速：同一半径下任意方向的模长一致', () => {
    for (const radius of [STICK_RADIUS * 0.4, STICK_RADIUS * 0.75, STICK_RADIUS]) {
      const lengths = DIRECTIONS.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return magnitude(stickVector(Math.cos(rad) * radius, Math.sin(rad) * radius));
      });
      const first = lengths[0]!;
      for (const length of lengths) expect(Math.abs(length - first)).toBeLessThan(1e-9);
    }
  });

  it('45° 与 0° 的输入给出同样长的向量', () => {
    const right = stickVector(STICK_RADIUS, 0);
    const diagonal = stickVector(STICK_RADIUS * Math.SQRT1_2, STICK_RADIUS * Math.SQRT1_2);
    expect(right).toEqual({ x: 1, y: 0 });
    expect(magnitude(diagonal)).toBeCloseTo(1, 12);
    expect(magnitude(diagonal)).toBeCloseTo(magnitude(right), 12);
  });

  it('死区内归零，死区外从 0 平滑升到 1', () => {
    expect(stickVector(STICK_RADIUS * (STICK_DEAD_ZONE - 0.01), 0)).toEqual({ x: 0, y: 0 });
    const edge = stickVector(STICK_RADIUS * STICK_DEAD_ZONE, 0);
    expect(edge).toEqual({ x: 0, y: 0 });
    const middle = stickVector(STICK_RADIUS * 0.6, 0);
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.x).toBeLessThan(1);
  });

  it('推到圆外也只按半径计：不会因为手指甩出摇杆突然加速', () => {
    const inside = stickVector(STICK_RADIUS, 0);
    const outside = stickVector(STICK_RADIUS * 3, 0);
    expect(outside).toEqual(inside);
  });

  it('旋转舞台把屏幕方向换算回舞台本地坐标，长度不变', () => {
    // 舞台顺时针转 90°：屏幕「下」= 舞台「右」，屏幕「右」= 舞台「上」
    expect(stickVector(0, STICK_RADIUS, true).x).toBeCloseTo(1, 12);
    expect(stickVector(0, STICK_RADIUS, true).y).toBeCloseTo(0, 12);
    expect(stickVector(STICK_RADIUS, 0, true).y).toBeCloseTo(-1, 12);
    for (const deg of DIRECTIONS) {
      const rad = (deg * Math.PI) / 180;
      const plain = stickVector(Math.cos(rad) * STICK_RADIUS, Math.sin(rad) * STICK_RADIUS);
      const rotated = stickVector(Math.cos(rad) * STICK_RADIUS, Math.sin(rad) * STICK_RADIUS, true);
      expect(magnitude(rotated)).toBeCloseTo(magnitude(plain), 12);
    }
  });

  it('摇杆头只钳半径，不套死区：视觉跟手', () => {
    expect(stickKnob(STICK_RADIUS * 0.5, 0)).toEqual({ x: STICK_RADIUS * 0.5, y: 0 });
    const clamped = stickKnob(STICK_RADIUS * 2, 0);
    expect(clamped.x).toBeCloseTo(STICK_RADIUS, 12);
    expect(clamped.y).toBeCloseTo(0, 12);
    expect(stickKnob(0, 0)).toEqual({ x: 0, y: 0 });
  });
});
