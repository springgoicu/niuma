import { describe, expect, it } from 'bun:test';
import { MOVE_SPEED, TICK_MS } from '@niuma/shared-types';
import { cameraAxis, cameraFocus } from '../camera';
import { snapTexel } from '../pixel-scale';

/** 与 session.ts 的 MOVEMENT_CONFIG.LOCAL_DRIFT_LIMIT 保持一致 */
const LOCAL_DRIFT_LIMIT = 128;

/** 世界中心：远离岛屿边界，覆盖「未夹紧」的常规行走 */
const START = 4096;
const ISLAND_SPAN = 4096;

describe('相机吸附与角色同源', () => {
  it('未夹紧时返回值与角色渲染坐标完全相同（round，不是 floor）', () => {
    for (const value of [START, START + 0.25, START + 0.5, START + 0.75, START + 2.75]) {
      expect(cameraFocus(value, START - ISLAND_SPAN, ISLAND_SPAN * 2, 300)).toBe(snapTexel(value));
    }
  });

  it('60fps 行走 10 秒：角色相对屏幕的偏移恒为 0，不再每 4 帧跳 1 纹素', () => {
    const perFrame = MOVE_SPEED / 60;
    let x = START;
    let step = 0;
    for (; step < 600; step += 1) {
      x += perFrame;
      const cam = cameraFocus(x, START - ISLAND_SPAN, ISLAND_SPAN * 2, 300);
      // 未夹紧时相机与角色用同一个 round：偏移必须是 0
      expect(cam - snapTexel(x)).toBe(0);
    }
    // 反例对照：旧实现（相机 floor）在同样的步长下会周期性错开 1 纹素
    let drifted = 0;
    let px = START;
    for (let i = 0; i < 60; i += 1) {
      px += perFrame;
      if (Math.floor(px) - snapTexel(px) !== 0) drifted += 1;
    }
    expect(drifted).toBeGreaterThan(0);
  });
});

describe('相机夹紧', () => {
  const start = 1000;
  const length = 4000;
  const half = 300;

  it('左 / 上边界：贴到包围盒内侧半个视口', () => {
    expect(cameraFocus(start - 500, start, length, half)).toBe(start + half);
    expect(cameraFocus(start, start, length, half)).toBe(start + half);
  });

  it('右 / 下边界：同一规则，相机不越过包围盒', () => {
    expect(cameraFocus(start + length + 500, start, length, half)).toBe(start + length - half);
    expect(cameraFocus(start + length, start, length, half)).toBe(start + length - half);
  });

  it('中间区域跟随角色并吸附到整纹素', () => {
    const value = start + 1234.6;
    const cam = cameraFocus(value, start, length, half);
    expect(cam).toBe(snapTexel(value));
    expect(Number.isInteger(cam)).toBe(true);
  });
});

describe('相机回退', () => {
  it('视口比包围盒还宽时居中', () => {
    expect(cameraAxis(0, 1000, 400, 300)).toBe(1200);
    expect(cameraFocus(0, 1000, 400, 300)).toBe(1200);
  });

  it('NaN / Infinity 回落到中心', () => {
    expect(cameraFocus(Number.NaN, 1000, 4000, 300)).toBe(3000);
    expect(cameraFocus(Number.POSITIVE_INFINITY, 1000, 4000, 300)).toBe(3000);
  });
});

describe('本地和解阈值', () => {
  it('覆盖最坏情况的合法延迟：单向 250ms + 一个 Tick + 发送间隔', () => {
    const worstLagMs = 250 + TICK_MS + 50;
    const worstLegalDrift = (MOVE_SPEED * worstLagMs) / 1000;
    expect(LOCAL_DRIFT_LIMIT).toBeGreaterThan(worstLegalDrift);
  });
});
