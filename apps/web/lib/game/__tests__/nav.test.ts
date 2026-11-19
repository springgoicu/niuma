import { describe, expect, it } from 'bun:test';
import { MOVE_SPEED, NAV_TARGETS, SPAWN_CENTER } from '@niuma/shared-types';
import { bearingDegOf, nearestReading, navReadings, octantOf, OCTANT_NAMES } from '../nav';

describe('园区导览方位（ADR-0036）', () => {
  it('八向档位：北起顺时针，边界落在 22.5° 的分界上', () => {
    expect(octantOf(0, -1)).toBe(0); // 北
    expect(octantOf(1, -1)).toBe(1); // 东北
    expect(octantOf(1, 0)).toBe(2); // 东
    expect(octantOf(1, 1)).toBe(3); // 东南
    expect(octantOf(0, 1)).toBe(4); // 南
    expect(octantOf(-1, 1)).toBe(5); // 西南
    expect(octantOf(-1, 0)).toBe(6); // 西
    expect(octantOf(-1, -1)).toBe(7); // 西北
    expect(octantOf(0, 0)).toBe(0); // 原地按北处理
    // 22.4° 仍在北，22.6° 已经落到东北
    const rad = (deg: number) => (deg * Math.PI) / 180;
    expect(octantOf(Math.sin(rad(22.4)), -Math.cos(rad(22.4)))).toBe(0);
    expect(octantOf(Math.sin(rad(22.6)), -Math.cos(rad(22.6)))).toBe(1);
  });

  it('方位角从北起顺时针，东 90°、南 180°、西 270°', () => {
    expect(bearingDegOf(0, -1)).toBeCloseTo(0, 6);
    expect(bearingDegOf(1, 0)).toBeCloseTo(90, 6);
    expect(bearingDegOf(0, 1)).toBeCloseTo(180, 6);
    expect(bearingDegOf(-1, 0)).toBeCloseTo(270, 6);
    expect(bearingDegOf(0, 0)).toBe(0);
  });

  it('出生点全部导览目标都可读，顺序与 NAV_TARGETS 一致', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    expect(readings.map((reading) => reading.target.id)).toEqual(NAV_TARGETS.map((target) => target.id));
    // 去掉骰桌/擂台、新增霓虹街区与景观区 8 处分阶房产后共 18 处导览目标
    expect(readings).toHaveLength(18);
    for (const reading of readings) {
      expect(reading.distance).toBeGreaterThan(0);
      expect(reading.seconds).toBe(Math.max(1, Math.round(reading.distance / MOVE_SPEED)));
      expect(reading.octant).toBeGreaterThanOrEqual(0);
      expect(reading.octant).toBeLessThan(8);
      expect(OCTANT_NAMES[reading.octant]).toBeTruthy();
    }
  });

  it('最近目标取距离最短的那一个，并列时按 NAV_TARGETS 顺序', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    const nearest = nearestReading(readings)!;
    const shortest = Math.min(...readings.map((reading) => reading.distance));
    expect(nearest.distance).toBe(shortest);
    expect(readings.find((reading) => reading.distance === shortest)!.target.id).toBe(nearest.target.id);
  });

  it('出生点到五区目标分别落在预期的象限', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    const octant = (id: string) => readings.find((reading) => reading.target.id === id)!.octant;
    // 企业区在正西偏北，服务区在东北，生活区在正南
    expect(octant('workroom')).toBe(7);
    expect(octant('meeting')).toBe(7);
    expect(octant('restroom')).toBe(1);
    expect(octant('lounge')).toBe(4);
    expect(octant('park')).toBe(0);
    // 每个目标都带大区与场景，导览卡据此分组
    expect(NAV_TARGETS.filter((target) => target.district === 'corporate')).toHaveLength(4);
    expect(NAV_TARGETS.filter((target) => target.district === 'amusement')).toHaveLength(4);
    expect(NAV_TARGETS.filter((target) => target.district === 'living')).toHaveLength(5);
    expect(NAV_TARGETS.filter((target) => target.district === 'service')).toHaveLength(2);
    expect(NAV_TARGETS.filter((target) => target.district === 'scenery')).toHaveLength(3);
    for (const target of NAV_TARGETS) {
      expect(['indoor', 'outdoor', 'semi']).toContain(target.scene);
    }
  });

  it('五大区的全部导览目标都远于一步', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    for (const district of ['corporate', 'amusement', 'living', 'service', 'scenery'] as const) {
      const inDistrict = readings.filter((reading) => reading.target.district === district);
      expect(inDistrict.length, district).toBeGreaterThan(0);
      for (const reading of inDistrict) expect(reading.distance).toBeGreaterThan(MOVE_SPEED);
    }
  });

  it('朝目标走 120px，步行秒数不会变大', () => {
    const before = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    for (const reading of before) {
      const dx = reading.target.x - SPAWN_CENTER.x;
      const dy = reading.target.y - SPAWN_CENTER.y;
      const length = Math.hypot(dx, dy);
      const after = navReadings(
        SPAWN_CENTER.x + (dx / length) * 120,
        SPAWN_CENTER.y + (dy / length) * 120,
      );
      const next = after.find((item) => item.target.id === reading.target.id)!;
      expect(next.seconds).toBeLessThanOrEqual(reading.seconds);
    }
  });

  it('空列表没有最近目标', () => {
    expect(nearestReading([])).toBeNull();
  });
});
