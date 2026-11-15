import { describe, expect, it } from 'vitest';
import { VENT_ROOM, WALL_THICKNESS } from '../world/campus';
import { pointInPolygon } from '../world/geometry';
import {
  BOSS,
  BOSS_ARENA,
  BOSS_HIT_RECT,
  BOSS_MAX_HP,
  BOSS_SOLID,
  DIRECTION,
  WORLD_LAYOUT,
  bossHitPoint,
  isBlocked,
  isInBossArena,
  isOnLand,
  rectContains,
  regionAt,
  withinVentCone,
} from '../index';

/**
 * 发泄区（ADR-0070 / ADR-0097）的几何契约：橡胶地铺在企业楼南排的发泄室里、
 * 老板挡得住人，但正面必须留出伸手就能踢到肚子的身位。
 */

const { solids, props, paths, lakes, looseTrees, groves } = WORLD_LAYOUT;

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('发泄区地面', () => {
  it('铺在企业楼发泄室里，四边都给玩家留出走动空间', () => {
    for (const [x, y] of [
      [BOSS_ARENA.x, BOSS_ARENA.y],
      [BOSS_ARENA.x + BOSS_ARENA.w, BOSS_ARENA.y],
      [BOSS_ARENA.x, BOSS_ARENA.y + BOSS_ARENA.h],
      [BOSS_ARENA.x + BOSS_ARENA.w, BOSS_ARENA.y + BOSS_ARENA.h],
    ] as const) {
      expect(rectContains(VENT_ROOM, x, y)).toBe(true);
      expect(isOnLand(x, y, 20)).toBe(true);
    }
    // 垫子与房间外墙之间至少留 20px（外墙厚 10px）
    expect(BOSS_ARENA.x - VENT_ROOM.x).toBeGreaterThanOrEqual(WALL_THICKNESS + 10);
    expect(VENT_ROOM.x + VENT_ROOM.w - (BOSS_ARENA.x + BOSS_ARENA.w)).toBeGreaterThanOrEqual(WALL_THICKNESS + 10);
    expect(BOSS_ARENA.y - VENT_ROOM.y).toBeGreaterThanOrEqual(WALL_THICKNESS + 10);
    expect(VENT_ROOM.y + VENT_ROOM.h - (BOSS_ARENA.y + BOSS_ARENA.h)).toBeGreaterThanOrEqual(WALL_THICKNESS + 10);
  });

  it('区域名是发泄区，不再显示成企业区或工作区', () => {
    expect(isInBossArena(BOSS.x, BOSS.y - 20)).toBe(true);
    expect(regionAt(BOSS.x, BOSS.y - 20)).toBe('发泄区');
    expect(regionAt(BOSS.x, BOSS.y - 20)).not.toBe('中央迎宾广场');
  });

  it('区内不长树、不摆道具，也不与任何碰撞体重叠', () => {
    for (const tree of [...groves.flatMap((grove) => grove.trees), ...looseTrees]) {
      expect(rectContains(BOSS_ARENA, tree.x, tree.y)).toBe(false);
    }
    for (const prop of props) {
      expect(rectContains(BOSS_ARENA, prop.x, prop.y)).toBe(false);
    }
    for (const solid of solids) {
      const isBossFoot = solid.x === BOSS_SOLID.x && solid.y === BOSS_SOLID.y;
      if (isBossFoot) continue;
      expect(overlaps(BOSS_ARENA, solid), JSON.stringify(solid)).toBe(false);
    }
    // 发泄室在楼里，土路不会穿进室内
    for (const path of paths) {
      for (const [x, y] of [
        [BOSS_ARENA.x, BOSS_ARENA.y],
        [BOSS_ARENA.x + BOSS_ARENA.w, BOSS_ARENA.y],
        [BOSS_ARENA.x, BOSS_ARENA.y + BOSS_ARENA.h],
        [BOSS_ARENA.x + BOSS_ARENA.w, BOSS_ARENA.y + BOSS_ARENA.h],
      ] as const) {
        expect(pointInPolygon(x, y, path.polygon)).toBe(false);
      }
    }
    for (const lake of lakes) {
      expect(overlaps(BOSS_ARENA, lake.rect)).toBe(false);
    }
  });
});

describe('老板脚底与受击区', () => {
  it('脚底碰撞已登记，且只挡脚下一截', () => {
    const foot = solids.find((solid) => solid.x === BOSS_SOLID.x && solid.y === BOSS_SOLID.y);
    expect(foot).toBeDefined();
    expect(foot!.w).toBe(BOSS_SOLID.w);
    expect(foot!.h).toBe(BOSS_SOLID.h);
    expect(isBlocked(BOSS.x, BOSS_SOLID.y + BOSS_SOLID.h - 1)).toBe(true);
    // 脚底南侧 12px：玩家贴住脚底就能出招，不会被隐形墙推开
    expect(isBlocked(BOSS.x, BOSS_SOLID.y + BOSS_SOLID.h + 12)).toBe(false);
  });

  it('受击区在脚底上方，最近点落在矩形边上', () => {
    expect(BOSS_HIT_RECT.y + BOSS_HIT_RECT.h).toBe(BOSS_SOLID.y + BOSS_SOLID.h);
    expect(bossHitPoint(BOSS.x, BOSS.y + 40)).toEqual({ x: BOSS.x, y: BOSS.y });
    expect(bossHitPoint(BOSS_ARENA.x - 100, BOSS_ARENA.y - 100)).toEqual({
      x: BOSS_HIT_RECT.x,
      y: BOSS_HIT_RECT.y,
    });
  });

  it('从脚底正面向上踢，扇形能覆盖到肚子', () => {
    const feetY = BOSS_SOLID.y + BOSS_SOLID.h + 12;
    const hit = bossHitPoint(BOSS.x, feetY);
    expect(withinVentCone(BOSS.x, feetY, DIRECTION.Up, hit.x, hit.y)).toBe(true);
    // 背对老板则打不到
    expect(withinVentCone(BOSS.x, feetY, DIRECTION.Down, hit.x, hit.y)).toBe(false);
  });

  it('满血是每天 10000 点', () => {
    expect(BOSS_MAX_HP).toBe(10000);
    expect(BOSS.width).toBe(200);
    expect(BOSS.height).toBe(256);
  });
});
