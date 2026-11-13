import { describe, expect, it } from 'bun:test';
import {
  ISLAND,
  WORLD_LAYOUT,
  distanceSqToPolygon,
  isBlocked,
  isWaterAt,
  pointInPolygon,
} from '@niuma/shared-types';
import {
  BUTTERFLY_POPULATION,
  FISH_POPULATION,
  GROUND_POPULATION,
  planButterflies,
  planFish,
  planGroundCritters,
} from '../critter-spawn';
import { isOutdoorGround } from '../ground';

const SEED = 0x51ce_b0b;

describe('小动物撒点', () => {
  it('同一种子可复现：两批坐标逐位相等', () => {
    expect(planGroundCritters(SEED)).toEqual(planGroundCritters(SEED));
    expect(planButterflies(SEED)).toEqual(planButterflies(SEED));
  });

  it('不同种子给出不同布局', () => {
    const a = planGroundCritters(SEED);
    const b = planGroundCritters(SEED + 1);
    expect(a).not.toEqual(b);
  });

  it('人口达到目标量级，且不超过上限', () => {
    const ground = planGroundCritters(SEED);
    expect(ground.length).toBe(GROUND_POPULATION);
    expect(planButterflies(SEED).length).toBe(BUTTERFLY_POPULATION);
  });

  it('任意种子都能撒满：拒绝采样有界重试不会导致缺员', () => {
    // 地图改了水域/道路之后，若某些格子全部失效，这里会先炸，而不是等玩家进服发现动物变少
    for (let i = 1; i <= 12; i += 1) {
      expect(planGroundCritters((i * 2654435761) >>> 0).length).toBe(GROUND_POPULATION);
      expect(planButterflies((i * 40503) >>> 0).length).toBe(BUTTERFLY_POPULATION);
    }
  });

  it('每一只都站在户外草地上，不落水、不进墙', () => {
    for (const critter of planGroundCritters(SEED)) {
      expect(isOutdoorGround(critter.x, critter.y)).toBe(true);
      expect(isBlocked(critter.x, critter.y, 6)).toBe(false);
    }
  });

  it('两两间距不小于 80px：出生不会挤成一堆', () => {
    const ground = planGroundCritters(SEED);
    for (let i = 0; i < ground.length; i += 1) {
      for (let j = i + 1; j < ground.length; j += 1) {
        const dx = ground[i]!.x - ground[j]!.x;
        const dy = ground[i]!.y - ground[j]!.y;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(80);
      }
    }
  });

  it('地面动物全部是兔子：只保留三套配色，不再带物种字段', () => {
    for (const critter of planGroundCritters(SEED)) {
      expect('species' in critter).toBe(false);
      expect(critter.variant).toBeGreaterThanOrEqual(0);
      expect(critter.variant).toBeLessThanOrEqual(2);
      expect(Math.abs(critter.dirX) + Math.abs(critter.dirY)).toBeGreaterThan(0.9);
    }
  });

  it('蝴蝶轨道参数在预算内，巢点落在岛上', () => {
    const bounds = ISLAND.bounds;
    for (const butterfly of planButterflies(SEED)) {
      expect(butterfly.radiusX).toBeGreaterThanOrEqual(26);
      expect(butterfly.radiusX).toBeLessThanOrEqual(64);
      expect(butterfly.radiusY).toBeGreaterThanOrEqual(18);
      expect(butterfly.radiusY).toBeLessThanOrEqual(40);
      expect(butterfly.speed).toBeGreaterThan(0.3);
      expect(butterfly.homeX).toBeGreaterThanOrEqual(bounds.x);
      expect(butterfly.homeX).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(butterfly.homeY).toBeGreaterThanOrEqual(bounds.y);
      expect(butterfly.homeY).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });
});

describe('小鱼撒点（ADR-0047）', () => {
  it('同一种子可复现，人口固定', () => {
    expect(planFish(SEED)).toEqual(planFish(SEED));
    expect(planFish(SEED)).not.toEqual(planFish(SEED + 1));
    expect(planFish(SEED).length).toBe(FISH_POPULATION);
  });

  it('多种子都能撒满：三湖不会因某个哈希少鱼', () => {
    for (let i = 1; i <= 12; i += 1) {
      expect(planFish((i * 2654435761) >>> 0).length).toBe(FISH_POPULATION);
    }
  });

  it('鱼窝、往返端点与中点都在湖水里', () => {
    for (const fish of planFish(SEED)) {
      expect(isWaterAt(fish.x, fish.y)).toBe(true);
      for (const t of [-1, -0.5, 0.5, 1]) {
        expect(isWaterAt(fish.x + fish.dirX * fish.range * t, fish.y + fish.dirY * fish.range * t)).toBe(true);
      }
      expect(fish.range).toBeGreaterThanOrEqual(40);
      expect(fish.range).toBeLessThanOrEqual(120);
      expect(fish.variant).toBeGreaterThanOrEqual(0);
      expect(fish.variant).toBeLessThanOrEqual(2);
      expect(Math.abs(Math.hypot(fish.dirX, fish.dirY) - 1)).toBeLessThan(0.001);
    }
  });

  it('鱼窝离岸至少 60px，往返端点离岸至少 30px', () => {
    for (const fish of planFish(SEED)) {
      const lake = WORLD_LAYOUT.lakes.find((item) => pointInPolygon(fish.x, fish.y, item.points));
      expect(lake).toBeDefined();
      expect(distanceSqToPolygon(fish.x, fish.y, lake!.points)).toBeGreaterThanOrEqual(60 * 60);
      for (const t of [-1, 1]) {
        const px = fish.x + fish.dirX * fish.range * t;
        const py = fish.y + fish.dirY * fish.range * t;
        expect(distanceSqToPolygon(px, py, lake!.points)).toBeGreaterThanOrEqual(30 * 30);
      }
    }
  });

  it('鱼两两间距不小于 100px', () => {
    const fish = planFish(SEED);
    for (let i = 0; i < fish.length; i += 1) {
      for (let j = i + 1; j < fish.length; j += 1) {
        const dx = fish[i]!.x - fish[j]!.x;
        const dy = fish[i]!.y - fish[j]!.y;
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(100);
      }
    }
  });
});
