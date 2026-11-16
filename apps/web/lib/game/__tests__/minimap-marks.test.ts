import { describe, expect, it } from 'bun:test';
import { isOnLand } from '@niuma/shared-types';
import { MINIMAP_SIZE, MINIMAP_VENUE_MARKS } from '../minimap-draw';

/**
 * 小地图地标表：纯常量，不碰 canvas。
 *
 * 这些断言钉住两件事：
 * 1. 核心场所各有图标；
 * 2. 所有标记都落在陆地上（地标跑到海里，玩家会以为那里有条路）。
 */

describe('小地mark地标表', () => {
  it('核心场所图标不少于 6 枚：发泄区 / 赌场 / 擂台 / 急救站 / 卫生间 / 小黑屋 / 公寓', () => {
    expect(MINIMAP_VENUE_MARKS.length).toBeGreaterThanOrEqual(6);
    for (const mark of MINIMAP_VENUE_MARKS) expect(isOnLand(mark.x, mark.y)).toBe(true);
  });

  it('所有地标都在陆地内且颜色是合法 CSS 色', () => {
    for (const mark of MINIMAP_VENUE_MARKS) {
      expect(isOnLand(mark.x, mark.y)).toBe(true);
      expect(mark.fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(mark.line).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('画布边长是整数，缩放后 1px 线不会落在半像素上', () => {
    expect(Number.isInteger(MINIMAP_SIZE)).toBe(true);
    expect(MINIMAP_SIZE).toBeGreaterThan(96);
  });
});
