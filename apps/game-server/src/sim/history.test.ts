import { describe, expect, it } from 'bun:test';
import { ChatHistory, type ChatLine } from './history';

const TTL = 60_000;
/** 默认取样时刻：刚写完就查，不让 TTL 干扰分页断言 */
const NOW = 2_000;

function line(msgId: number, at: number, text = `第${msgId}条`): ChatLine {
  return { msgId, entityId: 1, name: '测试员', text, at };
}

function fill(history: ChatHistory, count: number, startAt = 1_000): void {
  for (let i = 1; i <= count; i += 1) history.add(line(i, startAt + i));
}

describe('ChatHistory', () => {
  it('最新一页按时间从旧到新返回，并标明还有更早的', () => {
    const history = new ChatHistory(200, TTL);
    fill(history, 25);

    const page = history.latestPage(10, NOW);
    expect(page.lines.map((entry) => entry.msgId)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
    expect(page.hasMore).toBe(true);
  });

  it('容量满后覆盖最旧的一格，不会越写越长', () => {
    const history = new ChatHistory(3, TTL);
    fill(history, 5);

    const page = history.latestPage(10, NOW);
    expect(page.lines.map((entry) => entry.msgId)).toEqual([3, 4, 5]);
    expect(page.hasMore).toBe(false);
  });

  it('按 msgId 上翻：只返回该条之前的一页', () => {
    const history = new ChatHistory(200, TTL);
    fill(history, 25);

    const first = history.before(16, 10, NOW);
    expect(first.lines.map((entry) => entry.msgId)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(first.hasMore).toBe(true);

    const second = history.before(6, 10, NOW);
    expect(second.lines.map((entry) => entry.msgId)).toEqual([1, 2, 3, 4, 5]);
    expect(second.hasMore).toBe(false);
  });

  it('游标已被淘汰或伪造时返回空页，让客户端停下', () => {
    const history = new ChatHistory(3, TTL);
    fill(history, 5);

    expect(history.before(1, 10, NOW)).toEqual({ lines: [], hasMore: false });
    expect(history.before(65535, 10, NOW)).toEqual({ lines: [], hasMore: false });
  });

  it('超过 TTL 的消息不再补发', () => {
    const history = new ChatHistory(200, TTL);
    history.add(line(1, 0));
    history.add(line(2, 50_000));

    const page = history.latestPage(10, 100_000);
    expect(page.lines.map((entry) => entry.msgId)).toEqual([2]);
  });

  it('msgId 回绕后仍按写入位置分页', () => {
    const history = new ChatHistory(200, TTL);
    history.add(line(0xfffe, 1_000));
    history.add(line(0xffff, 1_001));
    history.add(line(1, 1_002));
    history.add(line(2, 1_003));

    expect(history.latestPage(2, NOW).lines.map((entry) => entry.msgId)).toEqual([1, 2]);
    const older = history.before(1, 2, NOW);
    expect(older.lines.map((entry) => entry.msgId)).toEqual([0xfffe, 0xffff]);
    expect(older.hasMore).toBe(false);
  });

  it('页长为 0 时也只返回一条，不会退化成整表', () => {
    const history = new ChatHistory(200, TTL);
    fill(history, 5);

    expect(history.latestPage(0, NOW).lines).toHaveLength(1);
  });
});
