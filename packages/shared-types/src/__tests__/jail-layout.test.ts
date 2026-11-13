import { describe, expect, it } from 'vitest';
import {
  CAMPUS_RECT,
  HOME_THEATER,
  JAIL,
  JAIL_ANCHOR,
  JAIL_ANCHORS,
  JAIL_DOOR,
  JAIL_DOOR_PAVING,
  SOUTH_YARD,
} from '../world/campus';
import { isBlocked } from '../world/collision';
import { rectContains } from '../world/geometry';
import { WORLD_LAYOUT } from '../world/layout';

/**
 * 小黑屋布局（ADR-0072 / ADR-0077）：
 * - 与影厅隔南向主路东西相对，门都开在 y=4950 一线；
 * - ADR-0077 把 460×320 收到 320×240：北边仍离四角院落 74px，南留白变成 110px；
 * - 西门洞 60px 可通行，门前铺装与支路不动；
 * - 反省点与左右两个并排点都在室内、都可站立。
 */
describe('小黑屋布局（ADR-0072 / ADR-0077）', () => {
  it('与影厅同北线、在东侧、体量更小：北 74px / 南 110px 留白', () => {
    expect(JAIL.y).toBe(HOME_THEATER.y);
    expect(JAIL.w).toBe(320);
    expect(JAIL.h).toBe(240);
    expect(JAIL.w).toBeLessThan(HOME_THEATER.w);
    expect(JAIL.h).toBeLessThan(HOME_THEATER.h);
    expect(JAIL.y - (CAMPUS_RECT.y + CAMPUS_RECT.h)).toBe(74);
    expect(SOUTH_YARD.y - (JAIL.y + JAIL.h)).toBe(110);
    // 影厅在西、小黑屋在东，中间隔着 4096 的南向主路
    expect(JAIL.x).toBeGreaterThan(HOME_THEATER.x + HOME_THEATER.w);
  });

  it('西门洞 60px 可通行，两侧墙体仍然挡人', () => {
    expect(JAIL_DOOR.side).toBe('west');
    for (let y = JAIL_DOOR.from + 12; y <= JAIL_DOOR.to - 12; y += 8) {
      expect(isBlocked(JAIL.x, y)).toBe(false);
    }
    // 门框上下各 12px 已经是墙，不能留出可钻的缝
    expect(isBlocked(JAIL.x, JAIL_DOOR.from - 12)).toBe(true);
    expect(isBlocked(JAIL.x, JAIL_DOOR.to + 12)).toBe(true);
  });

  it('门前铺装从墙外接到南向主路，且不挡人', () => {
    expect(JAIL_DOOR_PAVING.x + JAIL_DOOR_PAVING.w).toBeGreaterThanOrEqual(JAIL.x);
    expect(JAIL_DOOR_PAVING.y).toBe(JAIL_DOOR.from);
    expect(JAIL_DOOR_PAVING.h).toBe(JAIL_DOOR.to - JAIL_DOOR.from);
    expect(WORLD_LAYOUT.paved.some((strip) => rectContains(strip, 4270, 4950))).toBe(true);
    expect(isBlocked(4270, 4950)).toBe(false);
    // 主路一侧没有铺装断口
    expect(isBlocked(4150, 4950)).toBe(false);
  });

  it('反省点三个并排位都在室内、都可站立', () => {
    expect(JAIL_ANCHORS).toHaveLength(3);
    expect(JAIL_ANCHORS[1]).toEqual(JAIL_ANCHOR);
    expect(JAIL_ANCHORS[0]!.x).toBe(JAIL_ANCHOR.x - 48);
    expect(JAIL_ANCHORS[2]!.x).toBe(JAIL_ANCHOR.x + 48);
    for (const point of JAIL_ANCHORS) {
      expect(rectContains(JAIL, point.x, point.y)).toBe(true);
      expect(isBlocked(point.x, point.y)).toBe(false);
    }
  });
});
