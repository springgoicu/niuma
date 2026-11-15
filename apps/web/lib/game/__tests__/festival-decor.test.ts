import { describe, expect, it } from 'bun:test';
import { WORLD_LAYOUT, isOnLand, isWaterAt } from '@niuma/shared-types';
import {
  BUNTING_LAMP_GAP,
  FESTIVAL_LIGHT_COUNT,
  festivalDecorPlan,
  festivalLights,
  readFestivalEnabled,
  type FestivalAnchor,
} from '../festival-decor';

/**
 * 节日装饰（ADR-0063）的纯函数契约。
 *
 * 这些断言都不碰 Pixi：布点是 `WORLD_LAYOUT` 的纯派生，开关是字符串解析，
 * 光池是纯数据；能在 CI 里钉住「不落到水里 / 不落进墙里 / 灯不超过 6 盏」，
 * 而不是等到打开浏览器才发现彩旗挂在了湖面上。
 */

const PLAN = festivalDecorPlan();

function insideSolid(anchor: FestivalAnchor): boolean {
  for (const solid of WORLD_LAYOUT.solids) {
    if (
      anchor.x >= solid.x &&
      anchor.x <= solid.x + solid.w &&
      anchor.y >= solid.y &&
      anchor.y <= solid.y + solid.h
    ) {
      return true;
    }
  }
  return false;
}

describe('?festival 灰度开关', () => {
  it('默认开启，0 / off / false 关闭，1 / on 保持开启', () => {
    expect(readFestivalEnabled('')).toBe(true);
    expect(readFestivalEnabled('?lobby=1')).toBe(true);
    expect(readFestivalEnabled('?festival=0')).toBe(false);
    expect(readFestivalEnabled('?festival=off')).toBe(false);
    expect(readFestivalEnabled('?festival=false')).toBe(false);
    expect(readFestivalEnabled('?festival=%E5%85%B3')).toBe(false);
    expect(readFestivalEnabled('?festival=1')).toBe(true);
    expect(readFestivalEnabled('?festival=on')).toBe(true);
  });

  it('无法识别的值回落为开启：灰度开关不该把装饰误关掉', () => {
    expect(readFestivalEnabled('?festival=maybe')).toBe(true);
    expect(readFestivalEnabled('?festival=')).toBe(true);
  });
});

describe('布点确定性', () => {
  it('同一次构建重复调用得到完全相同的锚点，且不是同一个数组引用', () => {
    const again = festivalDecorPlan();
    expect(again).toEqual(PLAN);
    expect(again).not.toBe(PLAN);
  });

  it('每个锚点都是整数纹素：缩放与 DPR 变化时不会出现半像素抖动', () => {
    for (const anchor of PLAN) {
      expect(Number.isInteger(anchor.x)).toBe(true);
      expect(Number.isInteger(anchor.y)).toBe(true);
      expect(Number.isInteger(anchor.depthY)).toBe(true);
      expect(Number.isFinite(anchor.depthY)).toBe(true);
    }
  });
});

describe('广场与主路彩旗', () => {
  it('四向内圈各一条（广场），外圈主路入口四条（东侧第三对是长椅，不成对）', () => {
    const plaza = PLAN.filter((anchor) => anchor.kind === 'plaza-bunting');
    const road = PLAN.filter((anchor) => anchor.kind === 'road-bunting');
    expect(plaza).toHaveLength(4);
    expect(road).toHaveLength(4);
  });

  it('每一条都挂在两根灯柱之间，长度恰为 232', () => {
    for (const anchor of PLAN) {
      if (anchor.kind !== 'plaza-bunting' && anchor.kind !== 'road-bunting') continue;
      expect(anchor.toX).toBeDefined();
      expect(anchor.toY).toBeDefined();
      const span = Math.max(Math.abs(anchor.toX! - anchor.x), Math.abs(anchor.toY! - anchor.y));
      expect(span).toBe(BUNTING_LAMP_GAP);
    }
  });

  it('所有彩旗端点与中点都在陆地、不在水里', () => {
    for (const anchor of PLAN) {
      if (anchor.kind !== 'plaza-bunting' && anchor.kind !== 'road-bunting') continue;
      const midX = Math.round((anchor.x + anchor.toX!) / 2);
      const midY = Math.round((anchor.y + anchor.toY!) / 2);
      for (const [x, y] of [
        [anchor.x, anchor.y],
        [anchor.toX!, anchor.toY!],
        [midX, midY],
      ] as const) {
        expect(isOnLand(x, y)).toBe(true);
        expect(isWaterAt(x, y)).toBe(false);
      }
    }
  });
});

describe('门楣与树梢', () => {
  it('四处门楣各一条短彩旗，挂在门线上方', () => {
    const gates = PLAN.filter((anchor) => anchor.kind === 'gate-bunting');
    expect(gates).toHaveLength(4);
    for (const gate of gates) {
      expect(gate.y).toBeLessThan(gate.depthY);
      expect(isOnLand(gate.x, gate.depthY)).toBe(true);
    }
  });

  it('树梢灯笼只挂在路边散树上，至少有一处且挂在树冠下', () => {
    const trees = PLAN.filter((anchor) => anchor.kind === 'tree-lantern');
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(tree.depthY).toBe(tree.y);
      expect(tree.toX).toBeUndefined();
      expect(isOnLand(tree.x, tree.y)).toBe(true);
      expect(isWaterAt(tree.x, tree.y)).toBe(false);
    }
  });
});

describe('不改变可行走区域', () => {
  it('所有锚点都不落在碰撞体里：看得见的东西不该同时挡人', () => {
    for (const anchor of PLAN) {
      expect(insideSolid(anchor)).toBe(false);
    }
  });
});

describe('夜间光池', () => {
  it('恰好 6 盏：4 条广场彩旗 + 南北入口各 1 条', () => {
    const lights = festivalLights(PLAN);
    expect(lights).toHaveLength(FESTIVAL_LIGHT_COUNT);
    const plaza = PLAN.filter((anchor) => anchor.lit && anchor.kind === 'plaza-bunting');
    const road = PLAN.filter((anchor) => anchor.lit && anchor.kind === 'road-bunting');
    expect(plaza).toHaveLength(4);
    expect(road).toHaveLength(2);
  });

  it('沿用挂灯口径：半径 48、暖白、可抖动，光心落在陆地上', () => {
    for (const light of festivalLights(PLAN)) {
      expect(light.radius).toBe(48);
      expect(light.color).toBe(LANTERN_LIGHT.color);
      expect(light.intensity).toBeGreaterThan(0);
      expect(light.flicker).toBeGreaterThan(0);
      expect(isOnLand(light.x, light.y)).toBe(true);
    }
  });

  it('不是常驻光源：门楣与树梢灯笼不占光池预算', () => {
    const litKinds = new Set(PLAN.filter((anchor) => anchor.lit).map((anchor) => anchor.kind));
    expect(litKinds.has('gate-bunting')).toBe(false);
    expect(litKinds.has('tree-lantern')).toBe(false);
  });
});
