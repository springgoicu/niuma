import { describe, expect, it } from 'bun:test';
import { DISTRICTS, PLAZA_REGION_NAME, VENUES } from '@niuma/shared-types';
import {
  ARRIVAL_CONFIRM_TICKS,
  ARRIVAL_COOLDOWN_MS,
  arrivalCopy,
  initialArrivalState,
  stepArrival,
  type ArrivalState,
} from '../arrival-copy';

/** 副标题是一行小字，超过这个长度会在横幅里被截断 */
const MAX_SUBTITLE = 20;

describe('过门区域横幅的文案（纯数据）', () => {
  it('五区与每个场所都有自己的副标题，不会落到兜底文案', () => {
    const fallback = arrivalCopy('不存在的区域').subtitle;
    for (const district of DISTRICTS) {
      const copy = arrivalCopy(district.name);
      expect(copy.title).toBe(district.name);
      expect(copy.subtitle).not.toBe(fallback);
      expect(copy.color).toBe(district.color);
    }
    for (const venue of VENUES) {
      const copy = arrivalCopy(venue.name);
      expect(copy.title).toBe(venue.name);
      expect(copy.subtitle.length).toBeGreaterThan(0);
      expect(copy.subtitle).not.toBe(fallback);
    }
  });

  it('广场与野地各有自己的文案，未知区域也有兜底而不是空条', () => {
    expect(arrivalCopy(PLAZA_REGION_NAME).subtitle).not.toBe(arrivalCopy('园区野地').subtitle);
    expect(arrivalCopy('园区野地').subtitle.length).toBeGreaterThan(0);
    expect(arrivalCopy('不存在的区域').subtitle.length).toBeGreaterThan(0);
  });

  it('副标题都控制在一行之内', () => {
    const names = [PLAZA_REGION_NAME, '园区野地', ...DISTRICTS.map((d) => d.name), ...VENUES.map((v) => v.name)];
    for (const name of names) {
      expect(arrivalCopy(name).subtitle.length, name).toBeLessThanOrEqual(MAX_SUBTITLE);
    }
  });
});

describe('过门区域横幅的防抖与冷却', () => {
  const T0 = 1_000_000;

  function advance(state: ArrivalState, region: string, times: number, step: number, start = T0): ArrivalState {
    let current = state;
    let now = start;
    for (let i = 0; i < times; i += 1) {
      current = stepArrival(current, region, now).next;
      now += step;
    }
    return current;
  }

  it('第一拍不弹，连续两拍确认后才弹', () => {
    const first = stepArrival(initialArrivalState(), '企业区', T0);
    expect(first.fire).toBe(false);
    let state = first.next;
    let fired = false;
    for (let tick = 1; tick < ARRIVAL_CONFIRM_TICKS; tick += 1) {
      const result = stepArrival(state, '企业区', T0 + 500 * tick);
      state = result.next;
      fired = fired || result.fire;
    }
    expect(fired).toBe(true);
    expect(state.shown).toBe('企业区');
  });

  it('一直待在同一个区域不会反复弹', () => {
    const state = advance(initialArrivalState(), '游乐区', ARRIVAL_CONFIRM_TICKS, 500);
    for (let tick = 0; tick < 20; tick += 1) {
      const result = stepArrival(state, '游乐区', T0 + 500 * tick);
      expect(result.fire).toBe(false);
    }
  });

  it('门口来回蹭（区域名在两拍内跳动）不算进新区域', () => {
    let state = initialArrivalState();
    let fired = false;
    const bounce = ['生活区', '中央迎宾广场', '生活区', '中央迎宾广场'];
    bounce.forEach((region, index) => {
      const result = stepArrival(state, region, T0 + 500 * index);
      state = result.next;
      fired = fired || result.fire;
    });
    expect(fired).toBe(false);
  });

  it('冷却期内进第二处不弹，冷却一过再进才弹', () => {
    // 先进企业区并弹出
    let state = advance(initialArrivalState(), '企业区', ARRIVAL_CONFIRM_TICKS, 500);
    let now = T0 + 500 * ARRIVAL_CONFIRM_TICKS;
    // 立刻进服务区：确认够了但冷却未过
    for (let tick = 0; tick < ARRIVAL_CONFIRM_TICKS; tick += 1) {
      const result = stepArrival(state, '服务区', now);
      state = result.next;
      now += 500;
      expect(result.fire).toBe(false);
    }
    expect(state.shown).toBe('企业区');
    // 冷却过了仍站在服务区：下一拍就补上
    let fired = false;
    for (let tick = 0; tick < 4; tick += 1) {
      const result = stepArrival(state, '服务区', now + ARRIVAL_COOLDOWN_MS);
      state = result.next;
      fired = fired || result.fire;
    }
    expect(fired).toBe(true);
    expect(state.shown).toBe('服务区');
  });

  it('断线时区域名为空：只清确认计数，回来后不重弹原区域', () => {
    const shown = advance(initialArrivalState(), '景观区', ARRIVAL_CONFIRM_TICKS, 500);
    const cleared = stepArrival(shown, '', T0 + 5000).next;
    expect(cleared.pending).toBe('');
    expect(cleared.shown).toBe('景观区');
    const back = stepArrival(cleared, '景观区', T0 + 5500);
    expect(back.fire).toBe(false);
  });
});
