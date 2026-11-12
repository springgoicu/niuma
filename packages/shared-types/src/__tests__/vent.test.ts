import { describe, expect, it } from 'vitest';
import { DIRECTION, VENT_HALF_ANGLE_DEG, VENT_RANGE_PX, VENT_FACING, withinVentCone } from '../index';

/**
 * 扇形判定的形状契约。
 *
 * 这些数字是「手感」而不是实现细节：64px 是两个身位、±30° 是一条正前方的楔形。
 * 改它们等于改玩法，因此用常量断言而不是写死字面量。
 */
describe('发泄扇形判定', () => {
  it('朝向向量与 DIRECTION 下标一致（下 / 左 / 右 / 上）', () => {
    expect(VENT_FACING[DIRECTION.Down]).toEqual({ x: 0, y: 1 });
    expect(VENT_FACING[DIRECTION.Left]).toEqual({ x: -1, y: 0 });
    expect(VENT_FACING[DIRECTION.Right]).toEqual({ x: 1, y: 0 });
    expect(VENT_FACING[DIRECTION.Up]).toEqual({ x: 0, y: -1 });
  });

  it('正前方命中，背后不命中', () => {
    expect(withinVentCone(0, 0, DIRECTION.Right, 40, 0)).toBe(true);
    expect(withinVentCone(0, 0, DIRECTION.Right, -40, 0)).toBe(false);
    expect(withinVentCone(0, 0, DIRECTION.Up, 0, -40)).toBe(true);
    expect(withinVentCone(0, 0, DIRECTION.Up, 0, 40)).toBe(false);
  });

  it('超出 64px 不命中', () => {
    expect(withinVentCone(0, 0, DIRECTION.Right, VENT_RANGE_PX - 0.5, 0)).toBe(true);
    expect(withinVentCone(0, 0, DIRECTION.Right, VENT_RANGE_PX + 0.5, 0)).toBe(false);
  });

  it('夹角边界：±30° 内命中，45° 斜角落空', () => {
    // 距离 40：tan30 ≈ 0.577，横向偏移 22 刚好在界内，26 出界
    expect(withinVentCone(0, 0, DIRECTION.Right, 40, 40 * Math.tan((VENT_HALF_ANGLE_DEG * Math.PI) / 180) * 0.99)).toBe(true);
    expect(withinVentCone(0, 0, DIRECTION.Right, 40, 26)).toBe(false);
    // 四向轴对齐下，正对角（45°）是落空的——需要先转身对准
    expect(withinVentCone(0, 0, DIRECTION.Right, 30, 30)).toBe(false);
  });

  it('贴脸重合按命中处理，不因算不出方向漏判', () => {
    expect(withinVentCone(120, 80, DIRECTION.Down, 120, 80)).toBe(true);
  });

  it('非有限坐标一律不命中：坏包不能把判定区打歪', () => {
    expect(withinVentCone(0, 0, DIRECTION.Down, Number.NaN, 10)).toBe(false);
    expect(withinVentCone(Number.POSITIVE_INFINITY, 0, DIRECTION.Down, 0, 10)).toBe(false);
  });

  it('判定与坐标平移无关：只看向对向量与距离', () => {
    for (const x of [0, -3200, 512.5]) {
      for (const y of [0, 1024, -77.25]) {
        expect(withinVentCone(x, y, DIRECTION.Left, x - 20, y + 5)).toBe(true);
        expect(withinVentCone(x, y, DIRECTION.Left, x + 20, y + 5)).toBe(false);
      }
    }
  });
});
