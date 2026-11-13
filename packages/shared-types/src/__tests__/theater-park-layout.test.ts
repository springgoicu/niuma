import { describe, expect, it } from 'vitest';
import {
  HOME_THEATER,
  LOUNGE,
  SOUTH_YARD,
  THEATER_SCREEN,
  THEATER_SEATS,
  THEATER_SPEAKERS,
} from '../world/campus';
import {
  AMUSEMENT_PARK,
  PARK_EAST_GATE,
  PARK_NORTH_GATE,
  PARK_RIDE_SOLIDS,
  PARK_SLIDE,
} from '../world/park';
import {
  DIRECTION,
  WORLD_LAYOUT,
  isBlocked,
  isOnLand,
  isWaterAt,
  pointInPolygon,
  rectContains,
  regionAt,
  slidePointInto,
} from '../index';

/**
 * 宿舍区客厅、家庭影音室与游乐园的几何契约。
 *
 * 这些坐标全部手写：后续任何人挪一堵墙、一张茶几或一座滑梯，
 * 这里会先失败，避免出现「看得到但走不进去」「座位陷进碰撞体里」
 * 或「滑梯落点在水里」这类只能靠肉眼发现的问题。
 */

const { seats, props, solids, paths, buildings } = WORLD_LAYOUT;

function wallAt(x: number, y: number): boolean {
  return solids.some(
    (solid) => solid.kind === 'wall' && x >= solid.x && x < solid.x + solid.w && y >= solid.y && y < solid.y + solid.h,
  );
}

function onAnyPath(x: number, y: number): boolean {
  return paths.some((path) => pointInPolygon(x, y, path.polygon));
}

describe('宿舍区客厅（双人沙发）', () => {
  const couch = seats.filter((seat) => seat.kind === 'couch');

  it('左右两半各一个座位，间距 62：两个人才坐得下', () => {
    expect(couch).toHaveLength(2);
    expect(new Set(couch.map((seat) => seat.variant))).toEqual(new Set([0, 1]));
    expect(couch[0]!.facing).toBe(DIRECTION.Down);
    expect(couch[1]!.facing).toBe(DIRECTION.Down);
    const dx = Math.abs(couch[0]!.x - couch[1]!.x);
    const dy = Math.abs(couch[0]!.y - couch[1]!.y);
    expect(dx).toBe(62);
    expect(dy).toBe(0);
  });

  it('两个座位都在宿舍区里、不压墙也不压茶几', () => {
    for (const seat of couch) {
      expect(rectContains(LOUNGE, seat.x, seat.y)).toBe(true);
      expect(isOnLand(seat.x, seat.y, 20)).toBe(true);
      expect(isBlocked(seat.x, seat.y)).toBe(false);
    }
  });

  it('沙发前有茶几，两张凳子面朝它；门到房间中部的通道不被挡', () => {
    const tables = props.filter((prop) => prop.kind === 'coffeeTable');
    expect(tables).toHaveLength(1);
    const table = tables[0]!;
    expect(table.y).toBeGreaterThan(couch[0]!.y);
    expect(table.y).toBeLessThan(LOUNGE.y + 360);

    // 从北门 (LOUNGE.x+230) 直下到房间中部，不应有任何碰撞体
    for (let y = LOUNGE.y + 20; y <= LOUNGE.y + 220; y += 10) {
      expect(isBlocked(LOUNGE.x + 230, y)).toBe(false);
    }
  });
});

describe('家庭影音室', () => {
  it('独立落在校园与庭院之间，不压两边的院子', () => {
    expect(isOnLand(HOME_THEATER.x, HOME_THEATER.y, 20)).toBe(true);
    expect(rectContains(WORLD_LAYOUT.office, HOME_THEATER.x + 10, HOME_THEATER.y + 10)).toBe(false);
    expect(rectContains(SOUTH_YARD, HOME_THEATER.x + 10, HOME_THEATER.y + 10)).toBe(false);
    expect(HOME_THEATER.y + HOME_THEATER.h).toBeLessThan(SOUTH_YARD.y);
    expect(buildings.some((building) => building.name === '家庭影音室')).toBe(true);
    expect(regionAt(HOME_THEATER.x + 230, HOME_THEATER.y + 160)).toBe('家庭影音室');
  });

  it('东墙留门，门外铺装接南向主路支路', () => {
    const doorY = HOME_THEATER.y + 160;
    // 东墙 x 3830..3840；门洞正中无墙，门洞外仍有墙
    expect(wallAt(HOME_THEATER.x + HOME_THEATER.w - 5, doorY)).toBe(false);
    expect(wallAt(HOME_THEATER.x + HOME_THEATER.w - 5, doorY - 60)).toBe(true);
    expect(isBlocked(HOME_THEATER.x + HOME_THEATER.w + 60, doorY)).toBe(false);
    // 支路中心线末端落在门前铺装里
    const branch = paths[paths.length - 1]!;
    const end = branch.centerline[branch.centerline.length - 1]!;
    expect(end[1]).toBe(doorY);
    expect(end[0]).toBeGreaterThan(HOME_THEATER.x + HOME_THEATER.w);
  });

  it('三排五列影厅座椅全部朝北墙屏幕，彼此不重叠也不压墙', () => {
    const cinema = seats.filter((seat) => seat.kind === 'cinema');
    expect(cinema).toHaveLength(15);
    expect(THEATER_SEATS).toHaveLength(15);
    const rows = new Set(cinema.map((seat) => seat.y));
    expect(rows.size).toBe(3);
    for (const seat of cinema) {
      expect(seat.facing).toBe(DIRECTION.Up);
      expect(rectContains(HOME_THEATER, seat.x, seat.y)).toBe(true);
      expect(isBlocked(seat.x, seat.y)).toBe(false);
      expect(seat.y).toBeGreaterThan(THEATER_SCREEN.y + THEATER_SCREEN.h);
    }
    for (let i = 0; i < cinema.length; i += 1) {
      for (let j = i + 1; j < cinema.length; j += 1) {
        expect(Math.hypot(cinema[i]!.x - cinema[j]!.x, cinema[i]!.y - cinema[j]!.y)).toBeGreaterThan(40);
      }
    }
  });

  it('屏幕与四只环绕音箱都落在房间内', () => {
    expect(rectContains(HOME_THEATER, THEATER_SCREEN.x, THEATER_SCREEN.y)).toBe(true);
    expect(rectContains(HOME_THEATER, THEATER_SCREEN.x + THEATER_SCREEN.w, THEATER_SCREEN.y + THEATER_SCREEN.h)).toBe(
      true,
    );
    expect(THEATER_SPEAKERS).toHaveLength(4);
    for (const speaker of THEATER_SPEAKERS) {
      expect(rectContains(HOME_THEATER, speaker.x, speaker.y)).toBe(true);
    }
  });
});

describe('游乐园与入口滑梯', () => {
  it('整块场地在陆地上、不压湖也不进庭院', () => {
    expect(isOnLand(AMUSEMENT_PARK.x, AMUSEMENT_PARK.y, 20)).toBe(true);
    expect(isOnLand(AMUSEMENT_PARK.x + AMUSEMENT_PARK.w, AMUSEMENT_PARK.y + AMUSEMENT_PARK.h, 20)).toBe(true);
    expect(isWaterAt(AMUSEMENT_PARK.x + 200, AMUSEMENT_PARK.y + 200)).toBe(false);
    expect(rectContains(SOUTH_YARD, AMUSEMENT_PARK.x, AMUSEMENT_PARK.y)).toBe(false);
    expect(buildings.some((building) => building.name === '游乐园')).toBe(true);
    expect(regionAt(AMUSEMENT_PARK.x + 500, AMUSEMENT_PARK.y + 300)).toBe('游乐园');
  });

  it('东门与北门都能走进去，北门接西南支路', () => {
    expect(isBlocked(PARK_EAST_GATE.x, PARK_EAST_GATE.y)).toBe(false);
    expect(isBlocked(PARK_NORTH_GATE.x, PARK_NORTH_GATE.y - 40)).toBe(false);
    const branch = paths.find((path) => path.centerline.some(([x, y]) => x === PARK_NORTH_GATE.x && y === PARK_NORTH_GATE.y));
    expect(branch).toBeDefined();
  });

  it('滑梯在入口内侧，落地点是自由地面', () => {
    // 塔顶精灵允许探出橡胶垫 8px；判中心与落点，不要求整块矩形都在垫内
    expect(rectContains(AMUSEMENT_PARK, PARK_SLIDE.hit.x + PARK_SLIDE.hit.w / 2, PARK_SLIDE.hit.y + PARK_SLIDE.hit.h / 2)).toBe(
      true,
    );
    expect(rectContains(AMUSEMENT_PARK, PARK_SLIDE.landing.x, PARK_SLIDE.landing.y)).toBe(true);
    expect(isBlocked(PARK_SLIDE.landing.x, PARK_SLIDE.landing.y)).toBe(false);
    expect(isWaterAt(PARK_SLIDE.landing.x, PARK_SLIDE.landing.y)).toBe(false);
    // 点击矩形必须覆盖滑道，站在落地点能点到
    expect(PARK_SLIDE.hit.x).toBeLessThan(PARK_SLIDE.landing.x);
    expect(PARK_SLIDE.hit.y + PARK_SLIDE.hit.h).toBeGreaterThan(PARK_SLIDE.landing.y - 20);
  });

  it('滑行折线首尾就是塔顶与落地点，整段留在游乐园里', () => {
    const out = { x: 0, y: 0 };
    const firstDir = slidePointInto(out, PARK_SLIDE.id, 0);
    expect(out).toEqual({ x: PARK_SLIDE.top.x, y: PARK_SLIDE.top.y });
    expect(firstDir).toBe(DIRECTION.Down);
    slidePointInto(out, PARK_SLIDE.id, 1);
    expect(out.x).toBeCloseTo(PARK_SLIDE.landing.x, 5);
    expect(out.y).toBeCloseTo(PARK_SLIDE.landing.y, 5);
    for (let t = 0; t <= 1; t += 0.1) {
      slidePointInto(out, PARK_SLIDE.id, t);
      expect(rectContains(AMUSEMENT_PARK, out.x, out.y)).toBe(true);
    }
  });

  it('器械底座进碰撞表，但不挡东门与滑梯落点', () => {
    for (const solid of PARK_RIDE_SOLIDS) {
      expect(solids).toContainEqual(solid);
      expect(isOnLand(solid.x, solid.y, 0)).toBe(true);
      expect(rectContains(AMUSEMENT_PARK, solid.x, solid.y)).toBe(true);
    }
    for (const solid of PARK_RIDE_SOLIDS) {
      const overlapsGate =
        solid.x < PARK_EAST_GATE.x + 30 &&
        solid.x + solid.w > PARK_EAST_GATE.x - 30 &&
        solid.y < PARK_EAST_GATE.y + 30 &&
        solid.y + solid.h > PARK_EAST_GATE.y - 30;
      expect(overlapsGate).toBe(false);
    }
    expect(onAnyPath(PARK_SLIDE.landing.x, PARK_SLIDE.landing.y)).toBe(false);
  });
});
