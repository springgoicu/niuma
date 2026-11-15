import { describe, expect, it } from 'bun:test';
import {
  DISTRICTS,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  WORLD_LAYOUT,
  isBlocked,
  isOnPlaza,
  isWaterAt,
  pointInPolygon,
  rectContains,
} from '@niuma/shared-types';
import { JUNCTION_SIZE, roadDressingPlan, roadPostPlan } from '../road-dressing';

/**
 * 路面叙事（ADR-0099）：路口铺砖、斑马线、指引箭头。
 *
 * 这里只断言**纯数据**：不加载 Pixi。真正要守住的是三条——
 * 铺砖不落到水里与楼里、斑马线落在广场石面上、箭头一定压在车道上。
 */

const plan = roadDressingPlan();

describe('路面装饰（ADR-0099）', () => {
  it('路口数量与落点都在可铺的位置上', () => {
    expect(plan.junctions.length).toBeGreaterThan(6);
    expect(plan.junctions.length).toBeLessThan(40);
    for (const tile of plan.junctions) {
      expect(isWaterAt(tile.x, tile.y)).toBe(false);
      for (const building of WORLD_LAYOUT.buildings) {
        expect(rectContains(building.rect, tile.x, tile.y)).toBe(false);
      }
      // 广场自己已经是整片石砖，不再叠拼花
      expect(isOnPlaza(tile.x, tile.y)).toBe(false);
      expect(Number.isInteger(tile.x)).toBe(true);
      expect(Number.isInteger(tile.y)).toBe(true);
    }
  });

  it('路口不会挤在一起：两两间距大于合并阈值', () => {
    for (let i = 0; i < plan.junctions.length; i += 1) {
      for (let j = i + 1; j < plan.junctions.length; j += 1) {
        const a = plan.junctions[i]!;
        const b = plan.junctions[j]!;
        const apart = Math.abs(a.x - b.x) > 20 || Math.abs(a.y - b.y) > 20;
        expect(apart, `路口 (${a.x},${a.y}) 与 (${b.x},${b.y}) 叠在一起`).toBe(true);
      }
    }
  });

  it('五座街口各有五道斑马线，且都落在广场石面上', () => {
    expect(plan.crossings.length).toBe(25);
    for (const stripe of plan.crossings) {
      const cx = stripe.x + stripe.w / 2;
      const cy = stripe.y + stripe.h / 2;
      const dx = cx - PLAZA_CENTER.x;
      const dy = cy - PLAZA_CENTER.y;
      const distance = Math.hypot(dx, dy);
      // 从圆庭外沿往内退 26px 起步，整组不会跑到广场外面
      expect(distance).toBeLessThan(PLAZA_RADIUS + 8);
      expect(distance).toBeGreaterThan(PLAZA_RADIUS - 120);
      expect(isWaterAt(cx, cy)).toBe(false);
    }
  });

  it('指引箭头压在四条主路上，且不落进广场与水面', () => {
    expect(plan.arrows.length).toBeGreaterThan(6);
    const mains = WORLD_LAYOUT.paths.filter((path) => path.halfWidth === 56);
    expect(mains.length).toBe(4);
    for (const arrow of plan.arrows) {
      expect(isWaterAt(arrow.x, arrow.y)).toBe(false);
      expect(isOnPlaza(arrow.x, arrow.y)).toBe(false);
      const onMain = mains.some(
        (path) => rectContains(path.rect, arrow.x, arrow.y) && pointInPolygon(arrow.x, arrow.y, path.polygon),
      );
      expect(onMain, `箭头 (${arrow.x},${arrow.y}) 不在主路上`).toBe(true);
      // 单位方向：长度约 1，箭头才不会画成一个点
      expect(Math.hypot(arrow.dirX, arrow.dirY)).toBeCloseTo(1, 6);
    }
  });

  it('铺砖边长是 4 的整数倍，保证错缝落在整纹素上', () => {
    expect(JUNCTION_SIZE % 4).toBe(0);
    expect(Number.isInteger(JUNCTION_SIZE)).toBe(true);
  });

  it('计划是缓存的同一份对象：不进帧循环，也不重复算', () => {
    expect(roadDressingPlan()).toBe(plan);
  });
});

describe('路侧指示桩（ADR-0099）', () => {
  const posts = roadPostPlan();

  it('五座街口至少各立一根，落点都站得住', () => {
    expect(posts.length).toBeGreaterThanOrEqual(5);
    expect(posts.length).toBeLessThanOrEqual(9);
    for (const post of posts) {
      expect(Number.isInteger(post.x)).toBe(true);
      expect(Number.isInteger(post.y)).toBe(true);
      expect(isWaterAt(post.x, post.y)).toBe(false);
      // 桩子不挡人：不进 WORLD_LAYOUT.props，也不该压在任何碰撞体里
      expect(isBlocked(post.x, post.y)).toBe(false);
      for (const building of WORLD_LAYOUT.buildings) {
        expect(rectContains(building.rect, post.x, post.y)).toBe(false);
      }
    }
  });

  it('牌面挂的是最近大区的区色，不是随手写的十六进制', () => {
    const colors = new Set(DISTRICTS.map((district) => district.color));
    for (const post of posts) expect(colors.has(post.color)).toBe(true);
  });

  it('桩子两两不挤在一起', () => {
    for (let i = 0; i < posts.length; i += 1) {
      for (let j = i + 1; j < posts.length; j += 1) {
        const a = posts[i]!;
        const b = posts[j]!;
        expect(Math.abs(a.x - b.x) >= 40 || Math.abs(a.y - b.y) >= 40).toBe(true);
      }
    }
  });
});
