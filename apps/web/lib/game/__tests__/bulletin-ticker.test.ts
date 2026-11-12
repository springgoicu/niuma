import { describe, expect, it } from 'bun:test';
import { TICKER_SLOT_MS, TICKER_WIDTH, tickerOffset, tickerSlot } from '../bulletin-ticker';

describe('世界跑马灯轮播', () => {
  it('每 6 秒换一句，三句循环', () => {
    expect(tickerSlot(0)).toBe(0);
    expect(tickerSlot(TICKER_SLOT_MS - 1)).toBe(0);
    expect(tickerSlot(TICKER_SLOT_MS)).toBe(1);
    expect(tickerSlot(TICKER_SLOT_MS * 2)).toBe(2);
    expect(tickerSlot(TICKER_SLOT_MS * 3)).toBe(0);
    expect(tickerSlot(TICKER_SLOT_MS * 4 + 10)).toBe(1);
  });

  it('异常时间戳不会把槽位算成 NaN', () => {
    expect(tickerSlot(Number.NaN)).toBe(0);
    expect(tickerSlot(-5000)).toBe(0);
    expect(tickerSlot(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('一句从右边缘滑到左边缘之外，中途只往左走', () => {
    const textWidth = 120;
    const start = tickerOffset(0, textWidth);
    expect(start).toBe(TICKER_WIDTH / 2 + 4);
    let previous = start;
    for (let ms = 100; ms < TICKER_SLOT_MS; ms += 100) {
      const x = tickerOffset(ms, textWidth);
      expect(x).toBeLessThan(previous);
      previous = x;
    }
    // 结束时整句已经离开左边缘：右端 < -遮罩半宽
    expect(tickerOffset(TICKER_SLOT_MS - 1, textWidth)).toBeLessThan(-TICKER_WIDTH / 2);
  });

  it('文字越长终点越靠左，空文本也有完整的进出画', () => {
    const shortEnd = tickerOffset(TICKER_SLOT_MS - 1, 20);
    const longEnd = tickerOffset(TICKER_SLOT_MS - 1, 200);
    expect(longEnd).toBeLessThan(shortEnd);
    expect(tickerOffset(TICKER_SLOT_MS - 1, 0)).toBeLessThan(-TICKER_WIDTH / 2);
  });

  it('两端缓入缓出：首尾 10% 走的距离小于中段 10%', () => {
    const step = TICKER_SLOT_MS / 10;
    const head = Math.abs(tickerOffset(step, 100) - tickerOffset(0, 100));
    const middle = Math.abs(tickerOffset(step * 6, 100) - tickerOffset(step * 5, 100));
    expect(head).toBeLessThan(middle);
  });
});
