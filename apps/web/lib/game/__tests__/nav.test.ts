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

  it('出生点 13 个导览目标全部可读，顺序与 NAV_TARGETS 一致', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    expect(readings.map((reading) => reading.target.id)).toEqual(NAV_TARGETS.map((target) => target.id));
    expect(readings).toHaveLength(13);
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

  it('出生点到四角房分别落在西北 / 东北 / 东南 / 西南四个象限', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    const octant = (id: string) => readings.find((reading) => reading.target.id === id)!.octant;
    expect(octant('workroom')).toBe(7);
    expect(octant('meeting')).toBe(1);
    expect(octant('restroom')).toBe(3);
    expect(octant('lounge')).toBe(5);
    // 中央广场到四角房中心等距，四条放射路长度在同一档
    const indoor = NAV_TARGETS.filter((target) => target.area === 'indoor');
    expect(indoor).toHaveLength(4);
    const roomDistances = readings.filter((reading) => reading.target.area === 'indoor');
    const distances = roomDistances.map((reading) => reading.distance);
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(1);
  });

  it('户外 9 个目标都朝向岛外方向，不会指回出生点脚下', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    const outdoor = readings.filter((reading) => reading.target.area === 'grounds');
    expect(outdoor.map((reading) => reading.target.id)).toEqual([
      'park',
      'southYard',
      'bossArena',
      'theater',
      'jail',
      'pavilion',
      'lakeMoping',
      'lakeChensi',
      'lakeLianyi',
    ]);
    for (const reading of outdoor) expect(reading.distance).toBeGreaterThan(MOVE_SPEED);
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
