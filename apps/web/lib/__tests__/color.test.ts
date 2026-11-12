import { describe, expect, it } from 'bun:test';
import { normalizeColor } from '@niuma/shared-types';
import { hexToHsv, hsvToHex, resolveHsvDraft, type Hsv } from '../color';

/** store 里存的颜色一律是 565 归一后的值，草稿发出的颜色也得先过这一道 */
const emit = (h: number, s: number, v: number) => normalizeColor(hsvToHex(h, s, v));

describe('滑轨草稿与 store 颜色解耦', () => {
  it('色相拖到 360° 后颜色已是 0° 的红，滑轨仍停在末端', () => {
    const red = emit(360, 100, 100);
    const draft: Hsv = { h: 360, s: 100, v: 100 };

    // 回读只会得到 0°，滑块会跳回最前端——这正是要避免的那一跳
    expect(hexToHsv(red).h).toBe(0);
    expect(resolveHsvDraft(red, red, draft)).toBe(draft);
  });

  it('饱和度拖到 0 后色相滑轨保留原角度', () => {
    const gray = emit(212, 0, 40);
    const draft: Hsv = { h: 212, s: 0, v: 40 };

    // 565 会把「灰」量化成带轻微色偏的值，回读色相直接跑掉
    expect(hexToHsv(gray).h).not.toBe(212);
    expect(resolveHsvDraft(gray, gray, draft).h).toBe(212);
  });

  it('明度拖到 0 也不丢色相与饱和度', () => {
    const black = emit(212, 60, 0);
    const draft: Hsv = { h: 212, s: 60, v: 0 };

    expect(resolveHsvDraft(black, black, draft)).toEqual(draft);
  });

  it('外部改色（预设、整妆、hex 输入、读档）才回读 store', () => {
    const preset = normalizeColor(0xc94f3a);
    const draft: Hsv = { h: 360, s: 100, v: 100 };

    expect(resolveHsvDraft(preset, emit(360, 100, 100), draft)).toEqual(hexToHsv(preset));
  });

  it('565 量化会放大低饱和色的反推偏差，这是必须保留草稿的理由', () => {
    const weak = emit(212, 8, 72);
    expect(Math.abs(hexToHsv(weak).h - 212)).toBeGreaterThan(4);
  });
});
