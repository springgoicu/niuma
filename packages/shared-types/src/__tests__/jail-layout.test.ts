import { describe, expect, it } from 'vitest';
import { HOME_THEATER, JAIL, JAIL_ANCHOR, JAIL_ANCHORS, JAIL_DOOR, JAIL_DOOR_PAVING } from '../world/campus';
import { isBlocked } from '../world/collision';
import { rectContains } from '../world/geometry';
import { WORLD_LAYOUT, regionAt } from '../world/layout';

/**
 * 小黑屋布局（ADR-0072 / ADR-0097）：
 * - 落位服务区广场南侧，是服务街上的一间独立小楼；
 * - 320×240，只在西墙开一扇 60px 的门，门开向服务广场；
 * - 反省点与左右两个并排点都在室内、都可站立。
 */
describe('小黑屋布局（ADR-0072 / ADR-0097）', () => {
  it('是服务区里的独立小楼：320×240，不贴影厅也不贴企业楼', () => {
    expect(JAIL.w).toBe(320);
    expect(JAIL.h).toBe(240);
    // 与影厅分属两个大区：影厅在生活区，小黑屋在服务区
    expect(JAIL.y).not.toBe(HOME_THEATER.y);
    expect(JAIL.x).toBeGreaterThan(HOME_THEATER.x + HOME_THEATER.w);
    expect(regionAt(JAIL.x + JAIL.w / 2, JAIL.y + JAIL.h / 2)).toBe('小黑屋');
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

  it('门前铺装从墙外接进服务广场，且不挡人', () => {
    expect(JAIL_DOOR_PAVING.x + JAIL_DOOR_PAVING.w).toBeGreaterThanOrEqual(JAIL.x);
    expect(JAIL_DOOR_PAVING.y).toBe(JAIL_DOOR.from);
    expect(JAIL_DOOR_PAVING.h).toBe(JAIL_DOOR.to - JAIL_DOOR.from);
    const insideDoor = { x: JAIL_DOOR_PAVING.x + 20, y: JAIL_DOOR.from + 30 };
    expect(WORLD_LAYOUT.paved.some((strip) => rectContains(strip, insideDoor.x, insideDoor.y))).toBe(true);
    expect(isBlocked(insideDoor.x, insideDoor.y)).toBe(false);
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
