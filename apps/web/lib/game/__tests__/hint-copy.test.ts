import { describe, expect, it } from 'bun:test';
import { HINT, hintButton, touchHint } from '../hint-copy';

/** 动作盘上真实存在的按钮名：说法必须指向其中之一，否则玩家找不到按钮 */
const TOUCH_BUTTONS = ['坐下', '躺平', '互动', '起身'];

describe('触屏提示文案', () => {
  it('每条带按键的提示都有触屏说法，且不再出现「按 」', () => {
    for (const copy of Object.values(HINT)) {
      const touch = touchHint(copy);
      expect(touch).not.toBe(copy);
      expect(touch.includes('按 ')).toBe(false);
    }
  });

  it('触屏说法引用的按钮名与动作盘标签一致', () => {
    for (const copy of Object.values(HINT)) {
      const button = touchHint(copy).match(/「([^」]+)」/)?.[1];
      expect(button).toBeDefined();
      expect(TOUCH_BUTTONS).toContain(button!);
    }
  });

  it('不含按键的提示原样透传', () => {
    expect(touchHint('移动即可起身')).toBe('移动即可起身');
    expect(touchHint('已到达食堂')).toBe('已到达食堂');
    expect(touchHint('附近没有可互动的设施')).toBe('附近没有可互动的设施');
  });
});

describe('放假告示板文案', () => {
  it('用「查看放假倒计时」，不再出现「查解」', () => {
    expect(HINT.bulletin).toBe('[F] 查看放假倒计时');
    expect(touchHint(HINT.bulletin)).toBe('点「互动」查看放假倒计时');
  });
});

describe('设施提示按钮映射', () => {
  /** 可互动提示 → 动作 / 动作名 / 键帽。新增互动设施时这张表必须同步长一行 */
  const BUTTONS = [
    [HINT.seat, 'sit', '坐下', 'Z'],
    [HINT.toilet, 'sit', '使用马桶', 'Z'],
    [HINT.bed, 'lie', '躺平', 'X'],
    [HINT.board, 'interact', '查看牛马榜', 'F'],
    [HINT.bulletin, 'interact', '查看放假倒计时', 'F'],
    [HINT.interact, 'interact', '互动', 'F'],
    [HINT.shrine, 'interact', '上香祈福', 'F'],
    [HINT.tea, 'interact', '续杯养生茶', 'F'],
  ] as const;

  it('每条可互动提示都映射到动作、动作名与键帽', () => {
    for (const [copy, action, label, key] of BUTTONS) {
      const button = hintButton(copy);
      expect(button).not.toBeNull();
      expect(button!.action).toBe(action);
      expect(button!.label).toBe(label);
      expect(button!.key).toBe(key);
    }
  });

  it('键帽出现在桌面文案里，动作名出现在触屏说法里', () => {
    for (const [copy, , label, key] of BUTTONS) {
      expect(copy).toContain(key);
      expect(touchHint(copy)).toContain(label);
    }
  });

  it('劝阻文案保持纯文本，不映射成按钮', () => {
    for (const copy of [HINT.lieOnSeat, HINT.sitOnBed, HINT.bedOnly]) {
      expect(hintButton(copy)).toBeNull();
    }
  });

  it('状态文案与未知文案不映射成按钮', () => {
    for (const copy of ['移动即可起身', '已到达食堂', '附近没有可互动的设施', '']) {
      expect(hintButton(copy)).toBeNull();
    }
  });

  it('原型链上的名字不会被当成按钮', () => {
    for (const copy of ['toString', 'constructor', '__proto__']) {
      expect(hintButton(copy)).toBeNull();
    }
  });
});
