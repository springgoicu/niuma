import { describe, expect, it } from 'bun:test';
import { ACTION_CODE } from '../input';
import {
  ACTION_RING,
  CONTROL_BYTES,
  ControlBlock,
  createControlWriter,
  type ControlMessage,
} from '../runtime/control-channel';

/** 私有块（无跨源隔离时的形状）：读写走普通数组，不走 Atomics */
function privateBlock(): ControlBlock {
  return new ControlBlock(new ArrayBuffer(CONTROL_BYTES));
}

describe('控制块：按键与摇杆', () => {
  it('掩码原样往返', () => {
    const block = privateBlock();
    expect(block.readKeys()).toBe(0);
    block.writeKeys(0b0110);
    expect(block.readKeys()).toBe(0b0110);
    block.writeKeys(0);
    expect(block.readKeys()).toBe(0);
  });

  it('摇杆按 1/1000 定点存储，读回误差不超过半格', () => {
    const block = privateBlock();
    const out = { x: 0, y: 0 };
    block.writeTouch(0.5, -1);
    block.readTouch(out);
    expect(out.x).toBeCloseTo(0.5, 3);
    expect(out.y).toBeCloseTo(-1, 3);
  });

  it('摇杆越界输入被钳到 ±1', () => {
    const block = privateBlock();
    const out = { x: 0, y: 0 };
    block.writeTouch(3, -7);
    block.readTouch(out);
    expect(out.x).toBe(1);
    expect(out.y).toBe(-1);
  });
});

describe('控制块：动作环', () => {
  it('先进先出，排空后返回 0', () => {
    const block = privateBlock();
    block.pushAction(1);
    block.pushAction(4);
    expect(block.takeAction()).toBe(1);
    expect(block.takeAction()).toBe(4);
    expect(block.takeAction()).toBe(0);
  });

  it('序号回绕后仍然按顺序取出', () => {
    const block = privateBlock();
    for (let i = 0; i < ACTION_RING * 4; i += 1) {
      block.pushAction((i % 6) + 1);
      expect(block.takeAction()).toBe((i % 6) + 1);
    }
    expect(block.takeAction()).toBe(0);
  });

  it('积压超过环容量时跳到最新一格，不重放过期按键', () => {
    const block = privateBlock();
    for (let i = 1; i <= ACTION_RING + 3; i += 1) block.pushAction(i);
    // 读端落后太多：只保留最新那条，其余直接丢弃
    expect(block.takeAction()).toBe(ACTION_RING + 3);
    expect(block.takeAction()).toBe(0);
  });
});

describe('控制块：视口', () => {
  it('只在真变化时返回 true', () => {
    const block = privateBlock();
    const out = { width: 0, height: 0, dpr: 1 };
    block.writeViewport(1280, 720, 2);
    expect(block.readViewport(out)).toBe(true);
    expect(out).toEqual({ width: 1280, height: 720, dpr: 2 });
    expect(block.readViewport(out)).toBe(false);
    block.writeViewport(1280, 720, 3);
    expect(block.readViewport(out)).toBe(true);
    expect(out.dpr).toBe(3);
  });
});

describe('控制块：落点快照', () => {
  it('往返精确到 1/16 像素，且同一份快照只读一次', () => {
    const block = privateBlock();
    const out = { x: 0, y: 0, direction: 1, pose: 2, seatId: 0 } as {
      x: number;
      y: number;
      direction: 1;
      pose: 2;
      seatId: number;
    };
    block.writeSnapshot({ x: 1234.5, y: 987.25, direction: 1, pose: 2, seatId: 37 });
    expect(block.readSnapshot(out)).toBe(true);
    expect(out.x).toBeCloseTo(1234.5, 2);
    expect(out.y).toBeCloseTo(987.25, 2);
    expect(out.direction).toBe(1);
    expect(out.pose).toBe(2);
    expect(out.seatId).toBe(37);
    // 没有新写入就不重复落盘
    expect(block.readSnapshot(out)).toBe(false);
  });
});

describe('控制写端：两种传输给出同一份可读状态', () => {
  it('共享内存零消息；退回消息通道时对端 apply 后读到完全相同的值', () => {
    const messages: ControlMessage[] = [];
    const writer = createControlWriter((message) => messages.push(message));
    writer.writeKeys(0b0101);
    writer.writeTouch(0.25, -0.5);
    writer.pushAction(ACTION_CODE.interact);
    writer.writeViewport(1024, 768, 2);

    // 对端：有共享内存就是同一块；没有就把每条消息逐条落进私有块
    const peer = writer.buffer ? new ControlBlock(writer.buffer) : new ControlBlock(new ArrayBuffer(CONTROL_BYTES));
    for (const message of messages) peer.apply(message);
    if (writer.buffer) expect(messages).toHaveLength(0);

    expect(peer.readKeys()).toBe(0b0101);
    const touch = peer.readTouch({ x: 0, y: 0 });
    expect(touch.x).toBeCloseTo(0.25, 3);
    expect(touch.y).toBeCloseTo(-0.5, 3);
    expect(peer.takeAction()).toBe(ACTION_CODE.interact);
    const viewport = { width: 0, height: 0, dpr: 1 };
    expect(peer.readViewport(viewport)).toBe(true);
    expect(viewport).toEqual({ width: 1024, height: 768, dpr: 2 });

    // 写端从不回读快照：共享内存时由主线程直接读块，消息模式由 Worker 单独回传
    expect(writer.readSnapshot({ x: 0, y: 0, direction: 0, pose: 0, seatId: 0 })).toBe(false);
  });
});
