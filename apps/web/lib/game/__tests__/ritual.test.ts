import { describe, expect, it } from 'bun:test';
import { SHRINE_ALTAR, TEA_STATION, WORLD_LAYOUT } from '@niuma/shared-types';
import { MAX_LIGHTS } from '../lighting/light-registry';
import { FIXED_LANTERNS, LANTERN_HEIGHT, lanternLights } from '../lighting/lanterns';
import { festivalDecorPlan, festivalLights, FESTIVAL_LIGHT_COUNT } from '../festival-decor';
import { propLights } from '../lighting/scene-lights';
import { bowTexelsAt, BOW_DURATION_MS } from '../pony-motion';
import { isNearShrine, isNearTeaStation, SHRINE_INTERACT_RANGE, TEA_INTERACT_RANGE } from '../interactions';
import { isFirstIncenseToday } from '../incense-day';
import { localDateKey } from '../local-date';

/**
 * 职场玄学两处（ADR-0061）的纯函数契约。
 *
 * 这些断言都不碰 Pixi：作揖包络、感应区、当日首香与灯笼光源表都是纯数据，
 * 能在 CI 里钉住，而不用等到「打开浏览器按一下」才发现按不出来。
 */

describe('作揖包络', () => {
  it('只在 900ms 窗口内下沉，窗口外恒为 0', () => {
    expect(bowTexelsAt(-1)).toBe(0);
    expect(bowTexelsAt(0)).toBe(0);
    expect(bowTexelsAt(BOW_DURATION_MS)).toBe(0);
    expect(bowTexelsAt(99999)).toBe(0);
  });

  it('下沉量只有 0/1/2 三档，且中段确实压到最深', () => {
    const seen = new Set<number>();
    for (let t = 0; t < BOW_DURATION_MS; t += 10) {
      const value = bowTexelsAt(t);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(2);
      seen.add(value);
    }
    expect(seen.has(2)).toBe(true);
    expect(seen.has(0)).toBe(true);
  });

  it('起点与终点都回到站姿：不会一直弓着', () => {
    expect(bowTexelsAt(1)).toBe(0);
    expect(bowTexelsAt(BOW_DURATION_MS - 1)).toBe(0);
  });
});

describe('上香与续杯的感应区', () => {
  it('供案 72px、茶台 48px，且都按案面底边中心判定', () => {
    expect(isNearShrine(SHRINE_ALTAR.x, SHRINE_ALTAR.y)).toBe(true);
    expect(isNearShrine(SHRINE_ALTAR.x + SHRINE_INTERACT_RANGE + 1, SHRINE_ALTAR.y)).toBe(false);
    expect(isNearTeaStation(TEA_STATION.x, TEA_STATION.y)).toBe(true);
    expect(isNearTeaStation(TEA_STATION.x + TEA_INTERACT_RANGE + 1, TEA_STATION.y)).toBe(false);
  });

  it('非法坐标一律判否：NaN 不该让 F 键在任意位置生效', () => {
    expect(isNearShrine(Number.NaN, 0)).toBe(false);
    expect(isNearTeaStation(0, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('茶台的感应区比饮水机（56px）更窄：站在饮水机前不会被茶台截走', () => {
    expect(TEA_INTERACT_RANGE).toBeLessThan(56);
  });
});

describe('当日首香', () => {
  it('同一天重复上香不再算首香，隔天自动恢复', () => {
    const today = localDateKey();
    expect(isFirstIncenseToday('')).toBe(true);
    expect(isFirstIncenseToday(today)).toBe(false);
    expect(isFirstIncenseToday('2000-01-01')).toBe(true);
  });
});

describe('宫灯光源表', () => {
  it('拱门 2 盏 + 门柱 4 盏，每盏半径 48 的暖红', () => {
    expect(FIXED_LANTERNS).toHaveLength(6);
    const lights = lanternLights(FIXED_LANTERNS);
    expect(lights).toHaveLength(6);
    for (const light of lights) {
      expect(light.radius).toBe(48);
      expect(light.color).toBe(0xff5a3c);
      expect(light.intensity).toBeGreaterThan(0);
      expect(Number.isFinite(light.x)).toBe(true);
      expect(Number.isFinite(light.y)).toBe(true);
    }
  });

  it('灯身高度足够露出檐下：提绳顶端到流苏尾不短于 20px', () => {
    expect(LANTERN_HEIGHT).toBeGreaterThanOrEqual(20);
  });

  it('外景光源 + 摸鱼亭四角 + 固定宫灯 + 供案两盏 + 节日彩旗仍在 64 盏预算内', () => {
    // 超限时 `LightRegistry.add` 会静默返回 -1，灯就凭空消失了，必须在这里钉死
    const outdoor = propLights(WORLD_LAYOUT.props).length;
    const festival = festivalLights(festivalDecorPlan()).length;
    expect(festival).toBe(FESTIVAL_LIGHT_COUNT);
    const fixed = outdoor + FIXED_LANTERNS.length + 4 + 2 + festival;
    // 再留 8 盏给室内（interior-art 现场收集，数量随房间陈设变化）
    expect(fixed + 8).toBeLessThanOrEqual(MAX_LIGHTS);
  });

  it('lanternLights 不修改入参：纯函数，重复调用结果一致', () => {
    const a = lanternLights(FIXED_LANTERNS);
    const b = lanternLights(FIXED_LANTERNS);
    expect(a).toEqual(b);
    expect(FIXED_LANTERNS[0]).not.toHaveProperty('radius');
  });
});
