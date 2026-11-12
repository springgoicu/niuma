import { describe, expect, it } from 'bun:test';
import { DANMAKU_COLOR_COUNT, DANMAKU_MODE } from '@niuma/shared-types';
import {
  DANMAKU_MODE_OPTIONS,
  DANMAKU_PALETTE,
  DANMAKU_QUICK_PILLS,
  cssHex,
  danmakuColorAt,
  nextDanmakuMode,
} from '../danmaku-palette';
import {
  DANMAKU_TRACK_HEIGHT,
  computeTrackLayout,
  pickFixedLane,
  pickScrollLane,
  type ScrollLaneSnapshot,
} from '../danmaku-track';

const lane = (right: number | null): ScrollLaneSnapshot => ({ right });

describe('弹幕轨道布局', () => {
  it('720p 下铺满 12 条轨道，顶边让开左上角工牌', () => {
    const layout = computeTrackLayout(1280, 720, 'full');
    expect(layout.trackCount).toBe(12);
    expect(layout.bandTop).toBe(88);
    // 相邻轨道中心正好差一条轨高
    expect(layout.laneY(1) - layout.laneY(0)).toBe(DANMAKU_TRACK_HEIGHT);
  });

  it('矮视口也不少于 8 条：轨道太少会让固定弹幕挤成一行', () => {
    expect(computeTrackLayout(800, 300, 'full').trackCount).toBe(8);
  });

  it('超宽屏不无限加轨：上限 12 条', () => {
    expect(computeTrackLayout(2560, 1440, 'full').trackCount).toBe(12);
  });

  it('覆盖区域直接裁剪轨道数', () => {
    expect(computeTrackLayout(1280, 720, 'compact').trackCount).toBe(3);
    expect(computeTrackLayout(1280, 720, 'half').trackCount).toBe(6);
  });

  it('底端轨道：全屏贴着底部安全区，精简收进覆盖带内', () => {
    const full = computeTrackLayout(1280, 720, 'full');
    expect(full.bottomY(0)).toBe(720 - 104 - DANMAKU_TRACK_HEIGHT / 2);
    const compact = computeTrackLayout(1280, 720, 'compact');
    // 3 条轨的带底 = 88 + 3 × 28，再往上半个轨高
    expect(compact.bottomY(0)).toBe(88 + 3 * DANMAKU_TRACK_HEIGHT - DANMAKU_TRACK_HEIGHT / 2);
  });

  it('越界的轨道下标夹到最后一条，不会画到屏幕外', () => {
    const layout = computeTrackLayout(1280, 720, 'compact');
    expect(layout.laneY(99)).toBe(layout.laneY(2));
    expect(layout.bottomY(99)).toBe(layout.bottomY(2));
  });
});

describe('滚动轨道分配', () => {
  it('空轨优先，按从上到下的顺序', () => {
    expect(pickScrollLane([lane(null), lane(null), lane(null)], 1280)).toBe(0);
    // 上一条还贴在右缘附近（1270 > 1280 - 48）→ 本轨不允许进入
    expect(pickScrollLane([lane(1270), lane(null), lane(null)], 1280)).toBe(1);
  });

  it('上一条尾巴已完全入屏就可以复用同一条轨', () => {
    const width = 1280;
    // 刚好压线（宽度 - 间隙）也算可用：间隙是留给文字呼吸的
    expect(pickScrollLane([lane(width - 48)], width)).toBe(0);
    // 还差 1px 没进完：必须等下一帧
    expect(pickScrollLane([lane(width - 47)], width)).toBeNull();
  });

  it('全部繁忙返回 null，由调用方轮替兜底', () => {
    expect(pickScrollLane([lane(1260), lane(1260)], 1280)).toBeNull();
  });

  it('空数组不抛错，直接判为满', () => {
    expect(pickScrollLane([], 1280)).toBeNull();
  });
});

describe('固定弹幕轨道分配', () => {
  it('优先真正空闲的轨', () => {
    // 前两条还没空出来（300 / 500 > 200），第三条空闲
    expect(pickFixedLane([300, 500, 0], 200)).toBe(2);
  });

  it('全忙时退到最早空出来的那条，保证立刻可见', () => {
    expect(pickFixedLane([900, 300, 600], 100)).toBe(1);
  });

  it('同一时刻连发两条不会拿到同一条轨', () => {
    const first = pickFixedLane([0, 0], 0);
    // 调用方会把该轨占用到 4s 停留 + 淡出之后，这里直接用结果模拟
    const second = pickFixedLane([4501, 0], 0);
    expect(first).toBe(0);
    expect(second).toBe(1);
  });
});

describe('弹幕调色板与输入预设', () => {
  it('8 种颜色，协议索引与数组下标一致', () => {
    expect(DANMAKU_PALETTE).toHaveLength(DANMAKU_COLOR_COUNT);
    DANMAKU_PALETTE.forEach((preset, index) => {
      expect(preset.index).toBe(index);
    });
  });

  it('0 号是默认白：越界索引必须回落到它，否则旧消息会换色', () => {
    expect(danmakuColorAt(0).hex).toBe(0xffffff);
    expect(danmakuColorAt(200).hex).toBe(0xffffff);
    expect(danmakuColorAt(-3).hex).toBe(0xffffff);
  });

  it('色值转 CSS 十六进制补足六位', () => {
    expect(cssHex(0xffffff)).toBe('#ffffff');
    expect(cssHex(0x00ff99)).toBe('#00ff99');
    expect(cssHex(0x000000)).toBe('#000000');
  });

  it('模式按 滚动 → 顶端 → 底端 循环', () => {
    expect(DANMAKU_MODE_OPTIONS.map((option) => option.value)).toEqual([
      DANMAKU_MODE.Scroll,
      DANMAKU_MODE.Top,
      DANMAKU_MODE.Bottom,
    ]);
    expect(nextDanmakuMode(DANMAKU_MODE.Scroll)).toBe(DANMAKU_MODE.Top);
    expect(nextDanmakuMode(DANMAKU_MODE.Top)).toBe(DANMAKU_MODE.Bottom);
    expect(nextDanmakuMode(DANMAKU_MODE.Bottom)).toBe(DANMAKU_MODE.Scroll);
  });

  it('快捷词条是 6 条职场黑话，文案不重复', () => {
    expect(DANMAKU_QUICK_PILLS).toHaveLength(6);
    expect(new Set(DANMAKU_QUICK_PILLS).size).toBe(6);
    expect(DANMAKU_QUICK_PILLS[0]).toContain('老板');
  });
});
