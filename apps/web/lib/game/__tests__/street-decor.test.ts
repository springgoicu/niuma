import { describe, expect, it } from 'bun:test';
import {
  APARTMENT_GARDEN,
  APARTMENT_GARDEN_PATH,
  APARTMENT_SPECS,
  ISLAND,
  TREE_MIN_GAP,
  WORLD_LAYOUT,
  isOnLand,
  isWaterAt,
  pointInPolygon,
  rectContains,
} from '@niuma/shared-types';
import {
  APARTMENT_GARDEN_BANDS,
  GARDEN_PATH_COLS,
  STREET_ANCHORS,
  STREET_DECOR_BANDS,
  STREET_DECOR_KINDS,
  STREET_GRATE_ANCHORS,
  STREET_STEP_SIZE,
  apartmentGardenPath,
  streetDecorPlan,
} from '../street-decor';

/**
 * 过渡带装饰的纯函数契约。
 *
 * 这些断言都不碰 Pixi：落点是既有布局的纯派生，因此能在 CI 里钉住
 * 「不落进路面 / 水面 / 墙里」「树间距 ≥ 80」「花色种类齐全」这几条红线，
 * 而不是等到打开浏览器才发现灌木长在广场中央。
 */

const PLAN = streetDecorPlan();
const TREES = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];

function insideSolid(x: number, y: number): boolean {
  for (const solid of WORLD_LAYOUT.solids) if (rectContains(solid, x, y)) return true;
  return false;
}

function onPath(x: number, y: number): boolean {
  for (const path of WORLD_LAYOUT.paths) {
    if (rectContains(path.rect, x, y) && pointInPolygon(x, y, path.polygon)) return true;
  }
  return false;
}

function onPaved(x: number, y: number): boolean {
  for (const area of WORLD_LAYOUT.paved) if (rectContains(area, x, y)) return true;
  return false;
}

function nearestTreeDistance(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const tree of TREES) {
    const dx = tree.x - x;
    const dy = tree.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < best) best = distance;
  }
  return Math.sqrt(best);
}

describe('过渡带装饰计划', () => {
  it('同一份布局重复调用得到完全相同的计划，且不是同一个数组引用', () => {
    const again = streetDecorPlan();
    expect(again).toEqual(PLAN);
    expect(again).not.toBe(PLAN);
  });

  it('落点全是整数纹素：像素对齐不允许半像素', () => {
    for (const prop of PLAN.props) {
      expect(Number.isInteger(prop.x)).toBe(true);
      expect(Number.isInteger(prop.y)).toBe(true);
    }
    for (const bit of PLAN.ground) {
      expect(Number.isInteger(bit.x)).toBe(true);
      expect(Number.isInteger(bit.y)).toBe(true);
    }
  });

  it('立式小物不进路面、水面、铺装、墙面与广场', () => {
    for (const prop of PLAN.props) {
      expect(isOnLand(prop.x, prop.y)).toBe(true);
      expect(isWaterAt(prop.x, prop.y)).toBe(false);
      expect(onPath(prop.x, prop.y)).toBe(false);
      expect(onPaved(prop.x, prop.y)).toBe(false);
      expect(insideSolid(prop.x, prop.y)).toBe(false);
    }
  });

  it('立式小物与任意一棵树保持 ≥80px：树冠不会把小物吃掉', () => {
    for (const prop of PLAN.props) {
      expect(nearestTreeDistance(prop.x, prop.y)).toBeGreaterThanOrEqual(TREE_MIN_GAP);
    }
  });

  it('地面件只落在草地草缘：不进路面、水面与建筑', () => {
    for (const bit of PLAN.ground) {
      expect(isOnLand(bit.x, bit.y)).toBe(true);
      expect(isWaterAt(bit.x, bit.y)).toBe(false);
      expect(onPath(bit.x, bit.y)).toBe(false);
      expect(insideSolid(bit.x, bit.y)).toBe(false);
    }
  });

  it('五种小物都出现了：灌木两档 + 邮筒 + 消防栓 + 垃圾桶', () => {
    const kinds = new Set(PLAN.props.map((prop) => prop.kind));
    for (const kind of STREET_DECOR_KINDS) expect(kinds.has(kind)).toBe(true);
  });

  it('两种地面件都出现了：路肩碎石与排水篦子', () => {
    const kinds = new Set(PLAN.ground.map((bit) => bit.kind));
    expect(kinds.has('step')).toBe(true);
    expect(kinds.has('grate')).toBe(true);
  });

  it('密度落在合理区间：够读得出人烟，又不至于把草地带铺满', () => {
    const shrubs = PLAN.props.filter((prop) => prop.kind === 'shrub' || prop.kind === 'shrubTall');
    expect(shrubs.length).toBeGreaterThanOrEqual(12);
    expect(shrubs.length).toBeLessThanOrEqual(90);
    expect(PLAN.ground.length).toBeLessThanOrEqual(STREET_DECOR_BANDS.length * 64 + STREET_GRATE_ANCHORS.length);
  });

  it('按 y 排序：宿主按脚底 y 入层，顺序稳定才不会闪烁', () => {
    for (let i = 1; i < PLAN.props.length; i += 1) {
      const prev = PLAN.props[i - 1]!;
      const next = PLAN.props[i]!;
      expect(prev.y < next.y || (prev.y === next.y && prev.x <= next.x)).toBe(true);
    }
  });

  it('手写锚点全部落成，没有静默消失的小物', () => {
    for (const anchor of STREET_ANCHORS) {
      const hit = PLAN.props.some((prop) => prop.x === anchor.x && prop.y === anchor.y);
      expect(hit).toBe(true);
    }
  });

  it('装饰不污染共享布局：不写 solids、不写 props，地图与碰撞纹丝不动', () => {
    expect(WORLD_LAYOUT.solids.some((solid) => solid.kind === 'prop' && solid.w === 0)).toBe(false);
    for (const prop of PLAN.props) {
      expect(WORLD_LAYOUT.props.some((item) => item.x === prop.x && item.y === prop.y)).toBe(false);
    }
  });

  it('五条过渡带都在陆地内：派生装饰不能长到边界林墙里', () => {
    for (const band of STREET_DECOR_BANDS) {
      expect(isOnLand(band.x, band.y)).toBe(true);
      expect(isOnLand(band.x + band.w, band.y + band.h)).toBe(true);
      expect(band.x).toBeGreaterThan(ISLAND.bounds.x);
      expect(band.y).toBeGreaterThan(ISLAND.bounds.y);
    }
  });
});

describe('公寓门前口袋花园（ADR-0101）', () => {
  it('石板小径三列密铺，每一块都落在小径矩形里', () => {
    const stones = apartmentGardenPath();
    expect(stones.length).toBeGreaterThan(0);
    expect(stones.every((bit) => bit.kind === 'stone')).toBe(true);
    // 行数 × 三列：列数由常量派生，落点数量必须是它的整数倍
    expect(stones.length % GARDEN_PATH_COLS).toBe(0);
    for (const bit of stones) {
      const left = bit.x - Math.floor(STREET_STEP_SIZE.w / 2);
      const top = bit.y - STREET_STEP_SIZE.h;
      expect(rectContains(APARTMENT_GARDEN_PATH, left, top), `${bit.x},${bit.y} 石板探出小径`).toBe(true);
      expect(
        rectContains(APARTMENT_GARDEN_PATH, left + STREET_STEP_SIZE.w - 1, top + STREET_STEP_SIZE.h - 1),
      ).toBe(true);
    }
  });

  it('花园灌木落在花园里，且不长到石板小径与楼体上', () => {
    const gardenProps = PLAN.props.filter((prop) => rectContains(APARTMENT_GARDEN, prop.x, prop.y));
    expect(gardenProps.length).toBeGreaterThanOrEqual(6);
    expect(gardenProps.length).toBeLessThanOrEqual(80);
    for (const prop of gardenProps) {
      expect(['shrub', 'shrubTall']).toContain(prop.kind);
      expect(rectContains(APARTMENT_GARDEN_PATH, prop.x, prop.y)).toBe(false);
      for (const spec of APARTMENT_SPECS) expect(rectContains(spec.rect, prop.x, prop.y)).toBe(false);
    }
    // 两条灌木带自身也必须落在花园里
    for (const band of APARTMENT_GARDEN_BANDS) {
      expect(rectContains(APARTMENT_GARDEN, band.x, band.y)).toBe(true);
    }
  });

  it('花园石板进了同一份装饰计划，且不新增碰撞', () => {
    const stones = PLAN.ground.filter((bit) => bit.kind === 'stone');
    expect(stones.length).toBe(apartmentGardenPath().length);
    for (const bit of stones) {
      expect(insideSolid(bit.x, bit.y)).toBe(false);
      expect(onPath(bit.x, bit.y)).toBe(false);
    }
  });
});
