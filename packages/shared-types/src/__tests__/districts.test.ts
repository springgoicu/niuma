import { describe, expect, it } from 'vitest';
import {
  DISTRICTS,
  NAV_TARGETS,
  VENUES,
  districtAt,
  districtById,
  districtBounds,
  venueAt,
} from '../world/districts';
import { isBlocked, PLAYER_RADIUS } from '../world/collision';
import { FALLBACK_REGION, isOnLand, regionAt } from '../world/layout';
import type { WorldRect } from '../world/geometry';

/**
 * 五区与场所注册表（ADR-0097）：分区、室内外身份与区域名的唯一真相。
 * 这组断言钉住「每个场所都有区、五个区不重叠、区门都能站人」。
 */

function overlaps(a: WorldRect, b: WorldRect, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
  );
}

describe('五区注册表（ADR-0097）', () => {
  it('恰好五个区，id 唯一、名称非空、场景合法', () => {
    expect(DISTRICTS).toHaveLength(5);
    expect(new Set(DISTRICTS.map((district) => district.id)).size).toBe(5);
    for (const district of DISTRICTS) {
      expect(district.name.length).toBeGreaterThan(0);
      expect(['indoor', 'outdoor', 'semi']).toContain(district.scene);
      expect(district.rects.length).toBeGreaterThan(0);
      expect(districtById(district.id)).toBe(district);
    }
  });

  it('五个区两两不重叠，且每一块地都在陆地上', () => {
    for (let i = 0; i < DISTRICTS.length; i += 1) {
      for (let j = i + 1; j < DISTRICTS.length; j += 1) {
        for (const a of DISTRICTS[i]!.rects) {
          for (const b of DISTRICTS[j]!.rects) {
            expect(overlaps(a, b), `${DISTRICTS[i]!.id} 与 ${DISTRICTS[j]!.id} 重叠`).toBe(false);
          }
        }
      }
    }
    for (const district of DISTRICTS) {
      for (const rect of district.rects) {
        expect(isOnLand(rect.x, rect.y, 0), `${district.id} 压到岛界`).toBe(true);
        expect(isOnLand(rect.x + rect.w, rect.y + rect.h, 0), `${district.id} 压到岛界`).toBe(true);
      }
      const bounds = districtBounds(district);
      expect(bounds.w).toBeGreaterThan(0);
      expect(bounds.h).toBeGreaterThan(0);
    }
  });

  it('每个场所都在自己申报的区里，没有「无区场所」', () => {
    // ADR-0101 合并公寓后 20 处，ADR-0105 拆掉摸鱼亭后 19 处：删场所不该顺手带走别的场所
    expect(VENUES.length).toBeGreaterThanOrEqual(19);
    expect(new Set(VENUES.map((venue) => venue.id)).size).toBe(VENUES.length);
    for (const venue of VENUES) {
      const center = { x: venue.rect.x + venue.rect.w / 2, y: venue.rect.y + venue.rect.h / 2 };
      const found = districtAt(center.x, center.y);
      expect(found?.id, `${venue.name} 不在 ${venue.district}`).toBe(venue.district);
      expect(venueAt(center.x, center.y)?.id, `${venue.name} 中心读不出场所名`).toBe(venue.id);
      expect(regionAt(center.x, center.y)).toBe(venue.name);
      expect(['indoor', 'outdoor', 'semi']).toContain(venue.scene);
    }
  });

  it('导览目标与场所表一一对应：同名、同区、同场景', () => {
    for (const target of NAV_TARGETS) {
      const venue = VENUES.find((item) => item.navId === target.id);
      expect(venue, `${target.name} 缺少场所条目`).toBeDefined();
      expect(venue!.name).toBe(target.name);
      expect(venue!.district).toBe(target.district);
      expect(venue!.scene).toBe(target.scene);
    }
  });

  it('每座区门都能站人，区域名不会落回野地', () => {
    for (const district of DISTRICTS) {
      expect(isOnLand(district.gate.x, district.gate.y, PLAYER_RADIUS), `${district.id} 门在岛外`).toBe(true);
      expect(isBlocked(district.gate.x, district.gate.y), `${district.id} 门被挡`).toBe(false);
      expect(regionAt(district.gate.x, district.gate.y)).not.toBe(FALLBACK_REGION);
    }
  });

  it('摸鱼亭拆除后的原址仍报景观区，场所表里不再有亭子', () => {
    // ADR-0105：原址（5250,4710 起 200×180）并回景观区草地，不再有独立场所名
    expect(VENUES.some((venue) => venue.id === 'pavilion')).toBe(false);
    expect(venueAt(5350, 4800)).toBeUndefined();
    expect(regionAt(5350, 4800)).toBe('景观区');
    expect(districtAt(5350, 4800)?.id).toBe('scenery');
  });

  it('岛上一块空地仍会如实报野地，不会被硬塞进某个区', () => {
    expect(districtAt(2700, 4400)).toBeUndefined();
    expect(regionAt(2700, 4400)).toBe(FALLBACK_REGION);
  });
});
