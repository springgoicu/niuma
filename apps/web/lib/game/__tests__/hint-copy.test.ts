import { describe, expect, it } from 'bun:test';
import { HINT, touchHint } from '../hint-copy';

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
