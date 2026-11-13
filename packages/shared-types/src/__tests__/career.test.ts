import { describe, expect, it } from 'vitest';
import {
  CAREER_FIXED_BYTES,
  CAREER_MAX_BYTES,
  EMPTY_CAREER,
  MAX_COUNT,
  MAX_DAY_MINUTES,
  MAX_STEPS,
  clampSessionCarry,
  dateToEpochDays,
  epochDaysToDate,
  sanitizeCareer,
  truncateProvince,
} from '../career';
import {
  DEFAULT_APPEARANCE,
  decodeCareer,
  decodeHello,
  decodeSpawn,
  encodeCareer,
  encodeHello,
  encodeSpawn,
} from '..';

describe('career summary', () => {
  it('clamps negative, NaN and oversized numbers instead of throwing', () => {
    const safe = sanitizeCareer({
      firstJoinDate: '2026-01-01',
      todayMinutes: Number.POSITIVE_INFINITY,
      todayToiletMinutes: Number.NaN,
      todaySteps: 1e12,
      todayKnockdown: -1,
      todayVented: 1e9,
      todayOvertime: Number.NaN,
      province: '  浙江  ',
    });
    expect(safe.todayMinutes).toBe(MAX_DAY_MINUTES);
    expect(safe.todayToiletMinutes).toBe(0);
    expect(safe.todaySteps).toBe(MAX_STEPS);
    expect(safe.todayKnockdown).toBe(0);
    expect(safe.todayVented).toBe(MAX_COUNT);
    expect(safe.todayOvertime).toBe(0);
    expect(safe.province).toBe('浙江');
  });

  it('drops invalid first-join dates instead of inventing one', () => {
    expect(sanitizeCareer({ firstJoinDate: '2026-13-40' }).firstJoinDate).toBe('');
    expect(sanitizeCareer({ firstJoinDate: 'not-a-date' }).firstJoinDate).toBe('');
    expect(sanitizeCareer({ firstJoinDate: '2026-02-28' }).firstJoinDate).toBe('2026-02-28');
  });

  it('truncates province by both characters and UTF-8 bytes', () => {
    expect(truncateProvince('一二三四五六七八九十十一').length).toBeLessThanOrEqual(10);
    const emoji = truncateProvince('😀😀😀😀😀😀😀😀😀😀');
    expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(30);
    expect(emoji.endsWith('😀')).toBe(true);
    expect(truncateProvince(undefined)).toBe('');
  });

  it('round-trips every today field through the binary payload', () => {
    const career = {
      firstJoinDate: '2026-03-04',
      todayMinutes: 361,
      todayToiletMinutes: 88,
      todaySteps: 123_456,
      todayKnockdown: 21,
      todayVented: 13,
      todayOvertime: 1,
      province: '浙江',
    };
    expect(decodeCareer(encodeCareer(career))).toEqual(career);
  });

  it('续算秒数取「上报值 / 一天 / 进程运行时长」三者最小', () => {
    expect(clampSessionCarry(3_600, 7_200)).toBe(3_600);
    expect(clampSessionCarry(99_999, 7_200)).toBe(7_200);
    expect(clampSessionCarry(200_000, 200_000)).toBe(86_400);
    expect(clampSessionCarry(3_600, 0)).toBe(0);
  });

  it('负数、NaN 与缺失都按新会话处理', () => {
    expect(clampSessionCarry(0, 7_200)).toBe(0);
    expect(clampSessionCarry(-5, 7_200)).toBe(0);
    expect(clampSessionCarry(Number.NaN, 7_200)).toBe(0);
    expect(clampSessionCarry(100, Number.NaN)).toBe(0);
  });

  it('decodes a legacy v1 payload but only maps todayMinutes', () => {
    // v1 固定 34 字节 + 省份 6 字节；这里手工构造，确保版本偏移没有被改坏
    const legacy = new Uint8Array(34 + 6);
    const view = new DataView(legacy.buffer);
    let at = 0;
    legacy[at++] = 1;
    view.setUint16(at, dateToEpochDays('2026-03-04'), true);
    at += 2;
    view.setUint32(at, 12_345, true);
    at += 4;
    view.setUint16(at, 42, true);
    at += 2;
    view.setUint16(at, 361, true);
    at += 2;
    view.setUint16(at, 1_234, true);
    at += 2;
    view.setUint16(at, 9, true);
    at += 2;
    view.setUint32(at, 123_456, true);
    at += 4;
    view.setUint32(at, 8_765, true);
    at += 4;
    view.setUint16(at, 88, true);
    at += 2;
    view.setUint16(at, 13, true);
    at += 2;
    view.setUint16(at, 7, true);
    at += 2;
    view.setUint32(at, 61, true);
    at += 4;
    legacy[at++] = 6;
    legacy.set(new TextEncoder().encode('浙江'), at);

    const decoded = decodeCareer(legacy);
    expect(decoded?.todayMinutes).toBe(361);
    expect(decoded?.todaySteps).toBe(0);
    expect(decoded?.todayVented).toBe(0);
    expect(decoded?.todayKnockdown).toBe(0);
    expect(decoded?.todayOvertime).toBe(0);
    expect(decoded?.todayToiletMinutes).toBe(0);
    expect(decoded?.province).toBe('浙江');
  });

  it('keeps a payload inside the fixed length budget', () => {
    const payload = encodeCareer({ ...EMPTY_CAREER, province: '内蒙古自治区呼伦贝尔' });
    expect(payload.byteLength).toBeGreaterThanOrEqual(CAREER_FIXED_BYTES);
    expect(payload.byteLength).toBeLessThanOrEqual(CAREER_MAX_BYTES);
    expect(decodeCareer(payload)?.province).toBe('内蒙古自治区呼伦贝尔');
    expect(new TextEncoder().encode(decodeCareer(payload)?.province ?? '').length).toBeLessThanOrEqual(30);
  });

  it('encodes the first-join date as UTC days and back without local-time drift', () => {
    expect(epochDaysToDate(dateToEpochDays('2026-03-04'))).toBe('2026-03-04');
    expect(epochDaysToDate(0)).toBe('');
    const decoded = decodeCareer(encodeCareer({ ...EMPTY_CAREER, firstJoinDate: '2026-03-04' }));
    expect(decoded?.firstJoinDate).toBe('2026-03-04');
  });

  it('survives old HELLO and SPAWN packets that do not carry a career segment', () => {
    expect(decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow)).career).toBeUndefined();
    expect(
      decodeSpawn(encodeSpawn({ id: 1, x: 0, y: 0, state: 0, name: '牛', appearance: DEFAULT_APPEARANCE.cow }))
        .career,
    ).toBeUndefined();
  });
});
