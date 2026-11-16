import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_KIND,
  ACTIVITY_TEXT_MAX_BYTES,
  activityTierCodeOf,
  activityTierOf,
  formatActivity,
} from '../activity';
import {
  decodeActivity,
  decodeActivityReport,
  encodeActivity,
  encodeActivityReport,
} from '../protocol';
import { OpCode } from '../types';

/** 枚举里值最大的编号：`Object.values` 会把 TS 的字面量类型丢掉，这里显式转 */
const ALL_KINDS = Object.values(ACTIVITY_KIND) as number[];

describe('formatActivity', () => {
  it('已知编号全部有成品文案，未知编号返回 null', () => {
    for (const kind of ALL_KINDS) {
      const text = formatActivity(kind, { name: '阿牛', region: '急救站' });
      expect(text).not.toBeNull();
      expect(text!.length).toBeGreaterThan(0);
    }
    expect(formatActivity(999, { name: '阿牛' })).toBeNull();
  });

  it('空名字兜底成「一名牛马」，不让句子缺主语', () => {
    expect(formatActivity(ACTIVITY_KIND.Wave, { name: '   ' })).toContain('一名牛马');
  });

  it('区域可选：没有区域时不出现半截「在」', () => {
    const withoutRegion = formatActivity(ACTIVITY_KIND.Sit, { name: '阿牛' })!;
    expect(withoutRegion).not.toContain('在  ');
    expect(withoutRegion).not.toContain('在坐');
    const withRegion = formatActivity(ACTIVITY_KIND.Sit, { name: '阿牛', region: '会议室' })!;
    expect(withRegion).toContain('在会议室');
  });
});

describe('activityTierOf', () => {
  it('强演出 / 生活 / 常规三类都落在预期分级', () => {
    expect(activityTierOf(ACTIVITY_KIND.BossDown)).toBe('dramatic');
    expect(activityTierOf(ACTIVITY_KIND.GuardJailed)).toBe('dramatic');
    expect(activityTierOf(ACTIVITY_KIND.Tea)).toBe('life');
    expect(activityTierOf(ACTIVITY_KIND.Incense)).toBe('life');
    expect(activityTierOf(ACTIVITY_KIND.Sit)).toBe('routine');
  });

  it('未知编号按常规处理：不占播报条、只上小地图', () => {
    expect(activityTierOf(999)).toBe('routine');
  });

  it('HUD 数值编码与服务端分级一一对应', () => {
    expect(activityTierCodeOf(ACTIVITY_KIND.BossDown)).toBe(0);
    expect(activityTierCodeOf(ACTIVITY_KIND.Tea)).toBe(1);
    expect(activityTierCodeOf(ACTIVITY_KIND.Sit)).toBe(2);
    expect(activityTierCodeOf(999)).toBe(2);
  });
});

describe('S2C_ACTIVITY 编解码', () => {
  it('往返保留 kind / actor / 坐标（量化误差内）与文案', () => {
    const packet = { kind: ACTIVITY_KIND.VentKnockdown, actorId: 321, x: 4116.5, y: 2048, text: '阿牛在会议室被创飞了' };
    const buffer = encodeActivity(packet);
    expect(buffer[0]).toBe(OpCode.S2C_ACTIVITY);
    const decoded = decodeActivity(buffer);
    expect(decoded.kind).toBe(packet.kind);
    expect(decoded.actorId).toBe(packet.actorId);
    expect(Math.abs(decoded.x - packet.x)).toBeLessThan(1);
    expect(Math.abs(decoded.y - packet.y)).toBeLessThan(1);
    expect(decoded.text).toBe(packet.text);
  });

  it('超长中文按字节截断，长度字段不会溢出', () => {
    const long = '创'.repeat(200);
    const buffer = encodeActivity({ kind: ACTIVITY_KIND.VentKnockdown, actorId: 1, x: 0, y: 0, text: long });
    // 头部 9 字节 + 文案，且长度字段必须与实际负载一致
    expect(buffer[8]).toBe(buffer.byteLength - 9);
    expect(buffer[8]!).toBeLessThanOrEqual(ACTIVITY_TEXT_MAX_BYTES);
    expect(decodeActivity(buffer).text).toContain('创');
  });

  it('长度字段越界时按空文案处理，调用方直接跳过', () => {
    const buffer = encodeActivity({ kind: 21, actorId: 1, x: 0, y: 0, text: '坐下' });
    buffer[8] = 200;
    expect(decodeActivity(buffer).text).toBe('');
  });
});

describe('C2S_ACTIVITY 上报包', () => {
  it('三字节定长往返', () => {
    const buffer = encodeActivityReport({ kind: ACTIVITY_KIND.Incense, sub: 3 });
    expect(buffer.byteLength).toBe(3);
    expect(buffer[0]).toBe(OpCode.C2S_ACTIVITY);
    expect(decodeActivityReport(buffer)).toEqual({ kind: ACTIVITY_KIND.Incense, sub: 3 });
  });

  it('长度不对直接抛错，服务端不会拿错位数据当上报', () => {
    expect(() => decodeActivityReport(new Uint8Array([OpCode.C2S_ACTIVITY, 1]))).toThrow();
  });
});
