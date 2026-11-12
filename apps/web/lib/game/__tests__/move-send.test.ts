import { describe, expect, it } from 'bun:test';
import { POSE, packState, DIRECTION } from '@niuma/shared-types';
import {
  MOVE_IDLE_INTERVAL_MS,
  MOVE_SEND_INTERVAL_MS,
  NEVER_SENT,
  shouldSendMove,
  type MoveSample,
} from '../move-send';

const NEVER: MoveSample = { x: NEVER_SENT, y: NEVER_SENT, state: NEVER_SENT };

describe('上行发包门槛', () => {
  it('首次一定发', () => {
    expect(shouldSendMove(NEVER, 32768, 32768, 0, 0)).toBe(true);
  });

  it('站着不动降到 250ms 保活', () => {
    const last: MoveSample = { x: 32768, y: 32768, state: 0 };
    expect(shouldSendMove(last, 32768, 32768, 0, 0)).toBe(false);
    expect(shouldSendMove(last, 32768, 32768, 0, MOVE_SEND_INTERVAL_MS)).toBe(false);
    expect(shouldSendMove(last, 32768, 32768, 0, MOVE_IDLE_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSendMove(last, 32768, 32768, 0, MOVE_IDLE_INTERVAL_MS)).toBe(true);
  });

  it('位置变了就按 20Hz 放行', () => {
    const last: MoveSample = { x: 32768, y: 32768, state: 0 };
    expect(shouldSendMove(last, 32776, 32768, 0, 0)).toBe(false);
    expect(shouldSendMove(last, 32776, 32768, 0, MOVE_SEND_INTERVAL_MS)).toBe(true);
  });

  it('转身也算变化：朝向在 state 里', () => {
    const sit = packState(DIRECTION.Down, POSE.Sit, false);
    const lookLeft = packState(DIRECTION.Left, POSE.Sit, false);
    const last: MoveSample = { x: 32768, y: 32768, state: sit };
    expect(shouldSendMove(last, 32768, 32768, lookLeft, MOVE_SEND_INTERVAL_MS)).toBe(true);
  });

  /**
   * 这条是整个改动里最容易漏的：叠加位结束后如果不再发包，远端会永久循环播放。
   * 位置没变、只有 state 的 bit 掉下来，也必须走「变化」分支。
   */
  it('叠加位到期清零必须立刻放行，不能被静止节流挡住', () => {
    const venting = packState(DIRECTION.Down, POSE.Idle, false, true);
    const silent = packState(DIRECTION.Down, POSE.Idle, false, false);
    const last: MoveSample = { x: 32768, y: 32768, state: venting };
    expect(shouldSendMove(last, 32768, 32768, silent, MOVE_SEND_INTERVAL_MS)).toBe(true);
    // 但同样受 20Hz 上限约束，不会因为到期瞬间的重排变成连发
    expect(shouldSendMove(last, 32768, 32768, silent, 0)).toBe(false);
  });

  it('没发出去的变化不会被吞：基准不变时下一帧仍然命中', () => {
    const last: MoveSample = { x: 32768, y: 32768, state: 0 };
    expect(shouldSendMove(last, 33000, 32768, 0, 16)).toBe(false);
    expect(shouldSendMove(last, 33000, 32768, 0, 33)).toBe(false);
    expect(shouldSendMove(last, 33000, 32768, 0, 50)).toBe(true);
  });
});
