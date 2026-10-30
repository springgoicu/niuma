import { describe, expect, it } from 'bun:test';
import { FifoQueue } from './queue';

describe('FifoQueue', () => {
  it('dequeues in arrival order', () => {
    const queue = new FifoQueue<string>();
    queue.enqueue(11, 'a', 0);
    queue.enqueue(22, 'b', 0);
    queue.enqueue(33, 'c', 0);
    expect(queue.shift()?.wsId).toBe(11);
    expect(queue.shift()?.wsId).toBe(22);
    expect(queue.length).toBe(1);
  });

  it('refuses a duplicate wsId instead of giving it two slots', () => {
    const queue = new FifoQueue<string>();
    expect(queue.enqueue(7, 'a', 0)).not.toBeNull();
    expect(queue.enqueue(7, 'b', 0)).toBeNull();
    expect(queue.length).toBe(1);
  });

  it('keeps positions contiguous after a middle removal', () => {
    const queue = new FifoQueue<string>();
    for (let i = 1; i <= 5; i += 1) queue.enqueue(i, `p${i}`, 0);
    queue.refreshPositions();
    expect(queue.positionOf(3)).toBe(3);

    queue.remove(2);
    queue.refreshPositions();
    expect(queue.length).toBe(4);
    expect(queue.positionOf(3)).toBe(2);
    expect(queue.positionOf(5)).toBe(4);
    expect(queue.positionOf(2)).toBe(0);
  });

  it('stays in order and keeps exact positions after compaction', () => {
    const queue = new FifoQueue<number>();
    for (let i = 1; i <= 200; i += 1) queue.enqueue(i, i, 0);
    // 删掉 3/4，触发惰性删除的原地压缩
    for (let i = 1; i <= 150; i += 1) queue.remove(i);
    expect(queue.length).toBe(50);

    queue.refreshPositions();
    const survivors: number[] = [];
    for (const entry of queue.entries()) survivors.push(entry.wsId);
    expect(survivors).toEqual(Array.from({ length: 50 }, (_, i) => 151 + i));
    expect(queue.positionOf(151)).toBe(1);
    expect(queue.positionOf(200)).toBe(50);
  });

  it('reports a tail position that is immediately usable', () => {
    const queue = new FifoQueue<string>();
    queue.enqueue(1, 'a', 0);
    const tail = queue.enqueue(2, 'b', 100);
    expect(tail?.position).toBe(2);
    expect(queue.positionOf(2)).toBe(2);
    expect(queue.enqueuedAtOf(2)).toBe(100);
  });

  it('ignores removals of entries that already left', () => {
    const queue = new FifoQueue<string>();
    queue.enqueue(5, 'a', 0);
    expect(queue.remove(5)).toBe(true);
    expect(queue.remove(5)).toBe(false);
    expect(queue.shift()).toBeNull();
  });
});
