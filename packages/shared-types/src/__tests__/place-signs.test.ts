import { describe, expect, it } from 'vitest';
import { isBlocked } from '../world/collision';
import { DOOR_PLAQUES, NAV_ARRIVALS, NAV_TARGETS, isOnLand, type NavTargetId } from '../world/layout';
import { VILLA_SPECS } from '../world/villas';

/**
 * 场所门牌（ADR-0091 / ADR-0099）：除企业楼外的导览目标各有一块中文门牌。
 *
 * 企业楼东门不再立牌坊与门牌；其余 11 处入口立小门牌；
 * 两栋小院的院名写在院门牌匾上，不占 `DOOR_PLAQUES`。
 */
const PLAQUE_IDS = DOOR_PLAQUES.map((plaque) => plaque.id);
const ALL_IDS: NavTargetId[] = [...PLAQUE_IDS, 'villa1', 'villa2'];

describe('场所门牌（ADR-0091）', () => {
  it('除企业楼外的 13 处导览场所都有门牌，id 不重复也不缺项', () => {
    expect(ALL_IDS).toHaveLength(13);
    expect(new Set(ALL_IDS).size).toBe(13);
    const withoutWorkroom = NAV_TARGETS.filter((target) => target.id !== 'workroom').map((target) => target.id);
    expect(new Set(ALL_IDS)).toEqual(new Set(withoutWorkroom));
    expect(DOOR_PLAQUES).toHaveLength(11);
  });

  it('匾额文案等于导览目标的中文名，不手写第二份场所名', () => {
    for (const plaque of DOOR_PLAQUES) {
      const target = NAV_TARGETS.find((item) => item.id === plaque.id);
      expect(target).toBeDefined();
      expect(plaque.text).toBe(target!.name);
      // 数据里存标准名，字距排版由渲染端补
      expect(plaque.text).not.toMatch(/\s/);
    }
    for (const villa of VILLA_SPECS) {
      expect(villa.name.length).toBeGreaterThan(0);
    }
  });

  it('每个门牌落点都能站人，且不压在导览到达点上', () => {
    for (const plaque of DOOR_PLAQUES) {
      expect(isOnLand(plaque.x, plaque.depthY, 20), `${plaque.id} 门牌落在岛外`).toBe(true);
      expect(isBlocked(plaque.x, plaque.depthY), `${plaque.id} 门牌落在碰撞体里`).toBe(false);
      const arrive = NAV_ARRIVALS[plaque.id];
      // 牌坊本来就立在门线上，会议室到达点离门线 46px 是既有设计；这里只防「牌压在人身上」
      expect(Math.hypot(arrive.x - plaque.x, arrive.y - plaque.depthY)).toBeGreaterThan(40);
    }
  });

  it('小门牌落点是整纹素：像素对齐不因半像素发糊', () => {
    for (const plaque of DOOR_PLAQUES) {
      expect(Number.isInteger(plaque.x)).toBe(true);
      expect(Number.isInteger(plaque.depthY)).toBe(true);
    }
  });
});
