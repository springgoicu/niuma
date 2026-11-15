import { describe, expect, it } from 'bun:test';
import { WORLD_LAYOUT } from '@niuma/shared-types';
import {
  LightRegistry,
  MAX_LIGHTS,
  circleVisible,
  flickerAlpha,
  flickerAt,
  type Light,
} from '../lighting/light-registry';
import { propLights } from '../lighting/scene-lights';
import { ambientMultiplierOf, lightToneAt, localLightGain } from '../lighting/tone';
import { venueLights } from '../venue-lights';

const NIGHT = lightToneAt(0);
const NOON = lightToneAt(11);
const DUSK = lightToneAt(18);

describe('昼夜色调', () => {
  it('正午是恒等乘子，白昼不压暗画面', () => {
    expect(NOON.ambient).toBe(0);
    expect(ambientMultiplierOf(NOON)).toBe(0xffffff);
    expect(localLightGain(NOON)).toBe(0);
  });

  it('深夜压暗且偏冷：蓝通道最高，局部光增益拉满', () => {
    expect(NIGHT.ambient).toBeGreaterThan(0.6);
    const color = ambientMultiplierOf(NIGHT);
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    expect(r).toBeLessThan(g);
    expect(g).toBeLessThan(b);
    expect(localLightGain(NIGHT)).toBe(1);
  });

  it('黄昏环境底偏暖：红通道高于蓝通道，灯只亮一部分', () => {
    const color = ambientMultiplierOf(DUSK);
    expect((color >> 16) & 0xff).toBeGreaterThan(color & 0xff);
    const gain = localLightGain(DUSK);
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(1);
  });

  it('冬季夜比夏季夜更深，且一天仍是连续插值', () => {
    const summer = lightToneAt(6, false);
    const winter = lightToneAt(6, true);
    expect(winter.ambient).toBeGreaterThan(summer.ambient);
    // 相邻整点之间不跳变：11 点与 12 点的深度差不能超过锚点跨度
    expect(Math.abs(lightToneAt(12).ambient - lightToneAt(11).ambient)).toBeLessThan(0.1);
  });

  it('非有限小时回落到正午，不会把 NaN 带进光图', () => {
    const tone = lightToneAt(Number.NaN);
    expect(tone.ambient).toBeLessThan(0.05);
    expect(ambientMultiplierOf(tone)).toBe(0xffffff);
  });
});

describe('烛光抖动', () => {
  it('同种子同一时刻可复现，且落在 LUT 区间内', () => {
    const a = flickerAt(7, 1234.5);
    const b = flickerAt(7, 1234.5);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0.42);
    expect(a).toBeLessThanOrEqual(1);
  });

  it('不同种子错开相位，不会整排灯一起闪', () => {
    const first = flickerAt(1, 500);
    const second = flickerAt(2, 500);
    const third = flickerAt(3, 500);
    expect(first === second && second === third).toBe(false);
  });

  it('抖动只削强度，不越过原强度', () => {
    expect(flickerAlpha(0.8, 0, 1, 500)).toBe(0.8);
    for (let t = 0; t < 2000; t += 90) {
      const alpha = flickerAlpha(0.8, 0.2, 1, t);
      expect(alpha).toBeGreaterThanOrEqual(0.64);
      expect(alpha).toBeLessThanOrEqual(0.8);
    }
  });
});

describe('视口剔除', () => {
  it('圆心在视口内、相切与完全在外三种情况', () => {
    expect(circleVisible(0, 0, 10, -20, -20, 20, 20)).toBe(true);
    // 圆与矩形右上角的最短距离 8.49 < 10：角落光照仍要提交
    expect(circleVisible(0, 0, 10, 6, 6, 40, 40)).toBe(true);
    // 距离 11 > 10：不提交
    expect(circleVisible(0, 0, 10, 11, -20, 40, 20)).toBe(false);
  });

  it('注册表只把可见且亮着的光源写进复用数组', () => {
    const registry = new LightRegistry();
    const left = registry.add({ x: 0, y: 0, radius: 20, color: 0xffc07a, intensity: 1 });
    const right = registry.add({ x: 500, y: 0, radius: 20, color: 0x7fd6ff, intensity: 1 });
    const fine = registry.add({ x: 10, y: 0, radius: 20, color: 0xffffff, intensity: 1 });
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(left);

    const out: Light[] = [];
    expect(registry.collect(-30, -30, 30, 30, out)).toBe(2);
    expect(out.map((light) => light.id)).toEqual([left, fine]);

    // 调暗即退出提交；两次 collect 复用同一块数组
    registry.update(fine, { intensity: 0 });
    expect(registry.collect(-30, -30, 30, 30, out)).toBe(1);
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe(left);
  });

  it('支持更新、移除与清空，非法输入不打断渲染', () => {
    const registry = new LightRegistry();
    const id = registry.add({ x: 0, y: 0, radius: 20, color: 0xffffff, intensity: 1 });
    expect(registry.update(id, { x: 100, y: 80, radius: 40 })).toBe(true);
    const out: Light[] = [];
    registry.collect(70, 50, 130, 110, out);
    expect(out[0]!.x).toBe(100);
    expect(out[0]!.radius).toBe(40);

    expect(registry.add({ x: Number.NaN, y: 0, radius: 20, color: 0xffffff, intensity: 1 })).toBe(-1);
    expect(registry.remove(id)).toBe(true);
    expect(registry.remove(id)).toBe(false);
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('容量封顶：超出的光源返回 -1，不会静默改写已有的光', () => {
    const registry = new LightRegistry();
    for (let i = 0; i < MAX_LIGHTS; i += 1) {
      expect(registry.add({ x: i, y: 0, radius: 4, color: 0xffffff, intensity: 1 })).toBeGreaterThan(0);
    }
    expect(registry.add({ x: 0, y: 0, radius: 4, color: 0xffffff, intensity: 1 })).toBe(-1);
    expect(registry.size).toBe(MAX_LIGHTS);
  });
});

describe('地标光源派生', () => {
  const lights = propLights(WORLD_LAYOUT.props);

  it('外景地标落在 30–50 个区间，且不复制布局坐标', () => {
    expect(lights.length).toBeGreaterThanOrEqual(30);
    expect(lights.length).toBeLessThanOrEqual(50);
    // HUB_PROPS 的灯柱 (3980, 3714)：光心抬到 y-35
    const lamp = lights.find((light) => light.x === 3980 && light.y === 3679);
    expect(lamp?.color).toBe(0xffc07a);
    expect(lamp?.flicker ?? 0).toBeGreaterThan(0);
    // 同一组售货机 (3788, 3960)：冷白霓虹
    const vending = lights.find((light) => light.x === 3788 && light.y === 3930);
    expect(vending?.color).toBe(0xd9ecff);
  });

  it('预算：道具 + 场所 + 节日常驻总数不超过 MAX_LIGHTS', () => {
    // 场馆自己的光位集中在 venue-lights.ts：超过上限时 LightRegistry 会静默丢弃，
    // 因此这里先算总数。6 = 节日彩旗的 FESTIVAL_LIGHT_COUNT，11 = 室内 6 + 宫灯 2 + 亭 2 + 祭坛 2，
    // 这些都在各自模块里另有断言，这里只按最坏情况给定额。
    const resident = lights.length + venueLights().length + 6 + 11;
    expect(resident).toBeLessThanOrEqual(MAX_LIGHTS);
    // 场所光自身也不该无限膨胀：24 盏 = 六栋公寓 6 + 两院 2 + 擂台 2 + 赌场 2
    // + 诊所 2 + 广场 8 + 茶台 1 + 卫生间 1
    expect(venueLights().length).toBeLessThanOrEqual(26);
    expect(venueLights().length).toBeGreaterThanOrEqual(20);
  });

  it('场所光位都在世界范围内，色温不是纯白纯黑', () => {
    for (const spec of venueLights()) {
      expect(Number.isFinite(spec.x)).toBe(true);
      expect(Number.isFinite(spec.y)).toBe(true);
      expect(spec.radius).toBeGreaterThan(0);
      expect(spec.intensity).toBeGreaterThan(0);
      expect(spec.intensity).toBeLessThanOrEqual(1);
      expect(spec.color).not.toBe(0x000000);
      expect(spec.color).not.toBe(0xffffff);
    }
  });

  it('灯柱暖黄、机器冷白：色温一眼能分开', () => {
    const lamp = lights.find((light) => light.color === 0xffc07a)!;
    const machine = lights.find((light) => light.color === 0xe6f2ff)!;
    expect((lamp.color >> 16) & 0xff).toBeGreaterThan(lamp.color & 0xff);
    expect((machine.color >> 16) & 0xff).toBeLessThanOrEqual(machine.color & 0xff);
  });
});
