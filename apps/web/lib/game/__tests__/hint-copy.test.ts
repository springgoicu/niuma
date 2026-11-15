import { describe, expect, it } from 'bun:test';
import { HINT, hintButton, resolveVisibleHint, touchHint } from '../hint-copy';

/** 动作盘上真实存在的按钮名：说法必须指向其中之一，否则玩家找不到按钮 */
const TOUCH_BUTTONS = ['跳', '招手', '发泄', '坐下', '躺平', '互动', '起身'];

describe('触屏提示文案', () => {
  /** 只有「能按」的提示才需要换成按钮说法；纯状态/劝阻文案两端同文 */
  const KEY_HINTS = Object.values(HINT).filter((copy) => hintButton(copy) !== null);

  it('每条带按键的提示都有触屏说法，且不再出现「按 」', () => {
    for (const copy of KEY_HINTS) {
      const touch = touchHint(copy);
      expect(touch).not.toBe(copy);
      expect(touch.includes('按 ')).toBe(false);
    }
  });

  it('触屏说法引用的按钮名与动作盘标签一致', () => {
    for (const copy of KEY_HINTS) {
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

  it('擂台状态提示是纯文本，两端说法一致', () => {
    for (const copy of [HINT.ringFull, HINT.ringFighting, HINT.ringAward]) {
      expect(touchHint(copy)).toBe(copy);
    }
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
    [HINT.tea, 'interact', '打开属性强化', 'F'],
    [HINT.ringJoin, 'interact', '报名擂台', 'F'],
    [HINT.ringLeave, 'interact', '取消报名', 'F'],
    [HINT.ringAwardLeave, 'interact', '领奖离场', 'F'],
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
    for (const copy of [
      HINT.lieOnSeat,
      HINT.sitOnBed,
      HINT.bedOnly,
      HINT.ringFull,
      HINT.ringFighting,
      HINT.ringAward,
    ]) {
      expect(hintButton(copy)).toBeNull();
    }
  });

  it('入座类玩法没坐下时只提醒，不映射成按钮（ADR-0093）', () => {
    for (const copy of [HINT.diceNeedSeat, HINT.arenaNeedSeat, HINT.workNeedSeat]) {
      expect(hintButton(copy)).toBeNull();
      // 手势说法必须提到动作盘上的「坐下」，否则触屏玩家找不到入口
      expect(touchHint(copy)).toContain('「坐下」');
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

describe('提示让位', () => {
  it('瞬时文案只在到期前优先，到期后自动回到环境提示', () => {
    expect(resolveVisibleHint(HINT.interact, '已到达食堂', 2000, 1500)).toBe('已到达食堂');
    // 到期这一刻不再需要玩家走开再走回来「唤醒」
    expect(resolveVisibleHint(HINT.interact, '已到达食堂', 2000, 2000)).toBe(HINT.interact);
    expect(resolveVisibleHint(HINT.interact, '已到达食堂', 2000, 2600)).toBe(HINT.interact);
  });

  it('没有瞬时文案时始终显示环境提示，环境提示为空时就是空', () => {
    expect(resolveVisibleHint(HINT.interact, null, 0, 10)).toBe(HINT.interact);
    expect(resolveVisibleHint(null, null, 0, 10)).toBeNull();
  });
});
