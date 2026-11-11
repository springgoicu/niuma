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

  it('出生点四个目标全部可读，最近的是西侧的工作区', () => {
    const readings = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    expect(readings.map((reading) => reading.target.id)).toEqual(NAV_TARGETS.map((target) => target.id));
    // 工作区与会议室到北门的直线距离并列，并列时按 NAV_TARGETS 顺序取工作区（ADR-0044）
    expect(nearestReading(readings)?.target.name).toBe('工作区');
    for (const reading of readings) {
      expect(reading.distance).toBeGreaterThan(0);
      expect(reading.seconds).toBe(Math.max(1, Math.round(reading.distance / MOVE_SPEED)));
      expect(reading.octant).toBeGreaterThanOrEqual(0);
      expect(reading.octant).toBeLessThan(8);
      expect(OCTANT_NAMES[reading.octant]).toBeTruthy();
    }
  });

  it('卫生间、会议室、宿舍区都在入口南侧：越往南走，步行秒数越小', () => {
    const before = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y);
    const after = navReadings(SPAWN_CENTER.x, SPAWN_CENTER.y + 400);
    const pick = (list: typeof before, id: string) => list.find((reading) => reading.target.id === id)!;
    expect(pick(after, 'restroom').seconds).toBeLessThan(pick(before, 'restroom').seconds);
    expect(pick(after, 'meeting').seconds).toBeLessThan(pick(before, 'meeting').seconds);
    expect(pick(after, 'lounge').seconds).toBeLessThan(pick(before, 'lounge').seconds);
    // 工作区在西北角：进门时在西南向，走到院落中段后基本正西
    expect(pick(before, 'workroom').octant).toBe(5);
    expect(pick(after, 'workroom').octant).toBe(6);
  });

  it('空列表没有最近目标', () => {
    expect(nearestReading([])).toBeNull();
  });
});
