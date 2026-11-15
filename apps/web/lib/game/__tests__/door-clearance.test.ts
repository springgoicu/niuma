import { describe, expect, it } from 'bun:test';
import {
  CLINIC_ACCESS_PAVING,
  CLINIC_FENCE_SOLIDS,
  CLINIC_RECT,
  CLINIC_VEHICLE_ENTRY,
  COMPANY_CORRIDOR,
  PLAYER_RADIUS,
  WORLD_LAYOUT,
  isBlocked,
  type WorldRect,
} from '@niuma/shared-types';

/**
 * 门口防卡位回归（不修改任何坐标，只把现有留白钉住）。
 *
 * 门洞宽度不写死成常量：全部从 `WORLD_LAYOUT.buildings` 的房间矩形与
 * `WORLD_LAYOUT.solids` 的墙体段**反推**——同一个房间同一条边上，
 * 两段墙之间的空隙就是门洞。这样将来谁把门收窄，测试会先炸，
 * 而不是等到自动导览或保安押送在门口擦边卡死才发现。
 */

/** 净通行下限：玩家直径 18px 之外，还要留出一档贴身滑行的余量 */
const MIN_NET_PASSAGE = 20;
/** 墙带厚度上限：比这更厚的矩形不是墙（台面、隔断大件都不算） */
const WALL_BAND_MAX = 16;

type Side = 'north' | 'south' | 'west' | 'east';

interface DoorGap {
  readonly name: string;
  readonly side: Side;
  readonly from: number;
  readonly to: number;
}

/** 取落在某条房间边上、且与这条边对齐的墙体段（沿该边的坐标区间） */
function wallsOnSide(rect: WorldRect, side: Side): Array<{ from: number; to: number }> {
  const horizontal = side === 'north' || side === 'south';
  const spans: Array<{ from: number; to: number }> = [];
  for (const solid of WORLD_LAYOUT.solids) {
    if (solid.kind !== 'wall') continue;
    if (horizontal) {
      if (solid.h > WALL_BAND_MAX) continue;
      const edge = side === 'north' ? rect.y : rect.y + rect.h;
      const solidEdge = side === 'north' ? solid.y : solid.y + solid.h;
      if (Math.abs(solidEdge - edge) > 2) continue;
      const from = Math.max(solid.x, rect.x);
      const to = Math.min(solid.x + solid.w, rect.x + rect.w);
      if (to - from >= 2) spans.push({ from, to });
    } else {
      if (solid.w > WALL_BAND_MAX) continue;
      const edge = side === 'west' ? rect.x : rect.x + rect.w;
      const solidEdge = side === 'west' ? solid.x : solid.x + solid.w;
      if (Math.abs(solidEdge - edge) > 2) continue;
      const from = Math.max(solid.y, rect.y);
      const to = Math.min(solid.y + solid.h, rect.y + rect.h);
      if (to - from >= 2) spans.push({ from, to });
    }
  }
  return spans.sort((left, right) => left.from - right.from);
}

/** 反推一间房四边的门洞：两侧都是墙、且两端都不落在房间边角 */
function doorGapsOf(rect: WorldRect, name: string): DoorGap[] {
  const gaps: DoorGap[] = [];
  for (const side of ['north', 'south', 'west', 'east'] as const) {
    const spans = wallsOnSide(rect, side);
    // 少于两段说明这条边整体敞开（例如工作区南沿），那不是门洞
    if (spans.length < 2) continue;
    const horizontal = side === 'north' || side === 'south';
    const start = horizontal ? rect.x : rect.y;
    const end = horizontal ? rect.x + rect.w : rect.y + rect.h;
    for (let index = 1; index < spans.length; index += 1) {
      const from = spans[index - 1]!.to;
      const to = spans[index]!.from;
      if (to - from < 4) continue;
      // 缺口顶到房间边角的是「这面墙本来就没砌满」，不是门
      if (from <= start + 1 || to >= end - 1) continue;
      gaps.push({ name, side, from, to });
    }
  }
  return gaps;
}

/** 门洞墙带中线上的取样点 */
function wallPoint(rect: WorldRect, side: Side, along: number): { x: number; y: number } {
  if (side === 'north') return { x: along, y: rect.y + 5 };
  if (side === 'south') return { x: along, y: rect.y + rect.h - 5 };
  if (side === 'west') return { x: rect.x + 5, y: along };
  return { x: rect.x + rect.w - 5, y: along };
}

describe('门口防卡位（门洞净通行与导览到达点）', () => {
  it('每处门洞的净通行都够玩家侧身走过，且门框两侧确实是墙', () => {
    let checked = 0;
    for (const building of WORLD_LAYOUT.buildings) {
      for (const gap of doorGapsOf(building.rect, building.name)) {
        checked += 1;
        const net = gap.to - gap.from;
        expect(net, `${gap.name} ${gap.side} 门洞净宽只有 ${net}px`).toBeGreaterThanOrEqual(
          2 * PLAYER_RADIUS + MIN_NET_PASSAGE,
        );
        const center = (gap.from + gap.to) / 2;
        const inside = wallPoint(building.rect, gap.side, center);
        expect(isBlocked(inside.x, inside.y), `${gap.name} ${gap.side} 门洞中心被挡`).toBe(false);
        const left = wallPoint(building.rect, gap.side, gap.from - 1);
        const right = wallPoint(building.rect, gap.side, gap.to + 1);
        expect(isBlocked(left.x, left.y), `${gap.name} ${gap.side} 门洞左框不是墙`).toBe(true);
        expect(isBlocked(right.x, right.y), `${gap.name} ${gap.side} 门洞右框不是墙`).toBe(true);
      }
    }
    // 六处有门房间：会议室 / 发泄区 / 卫生间 / 宿舍区 / 家庭影音室 / 小黑屋
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('六处有门房间各测到一个门洞，不会被「门洞被道具堵住」静默跳过', () => {
    for (const name of ['会议室', '发泄区', '卫生间', '宿舍区', '家庭影音室', '小黑屋']) {
      const building = WORLD_LAYOUT.buildings.find((item) => item.name === name);
      expect(building, `${name} 不在 WORLD_LAYOUT.buildings 里`).toBeDefined();
      expect(doorGapsOf(building!.rect, name).length, `${name} 没测到门洞`).toBeGreaterThanOrEqual(1);
    }
  });

  it('急救站人行门仍是 56px，救护车通道口可走进站内', () => {
    // 只看西面那两段竖栏杆：北面横栏杆的起点也在同一个 x 上，靠 `w <= 10` 排掉
    const west = CLINIC_FENCE_SOLIDS.filter(
      (solid) => Math.abs(solid.x - (CLINIC_RECT.x - 10)) <= 0.5 && solid.w <= 10,
    );
    expect(west).toHaveLength(2);
    const top = west.reduce((a, b) => (a.y < b.y ? a : b));
    const bottom = west.reduce((a, b) => (a.y > b.y ? a : b));
    const gateTop = top.y + top.h;
    const gateBottom = bottom.y;
    expect(gateBottom - gateTop).toBe(CLINIC_ACCESS_PAVING.h);
    expect(gateBottom - gateTop).toBeGreaterThanOrEqual(2 * PLAYER_RADIUS + MIN_NET_PASSAGE);
    // 门洞中线可站，门柱两侧不可站
    expect(isBlocked(CLINIC_RECT.x - 5, (gateTop + gateBottom) / 2)).toBe(false);
    expect(isBlocked(CLINIC_RECT.x - 5, gateTop - 6)).toBe(true);
    expect(isBlocked(CLINIC_RECT.x - 5, gateBottom + 6)).toBe(true);
    // 救护车从南沿直插站心：通道口本身不能有碰撞
    expect(isBlocked(CLINIC_VEHICLE_ENTRY.x, CLINIC_VEHICLE_ENTRY.y)).toBe(false);
  });

  it('企业楼走廊（ADR-0099 加宽到 56px）的净通行与中线都还够走', () => {
    const net = COMPANY_CORRIDOR.h - 2 * PLAYER_RADIUS;
    expect(net).toBeGreaterThanOrEqual(MIN_NET_PASSAGE);
    const midY = COMPANY_CORRIDOR.y + COMPANY_CORRIDOR.h / 2;
    // 西端 10px 是封头墙，从墙内侧一路量到东口（大门）
    for (let x = COMPANY_CORRIDOR.x + 30; x < COMPANY_CORRIDOR.x + COMPANY_CORRIDOR.w; x += 40) {
      expect(isBlocked(x, midY), `走廊中线 x=${x} 被挡`).toBe(false);
    }
  });
});
