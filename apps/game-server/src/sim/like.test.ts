import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, LIKE_FLAG_SELF, MAX_LIKES, decodeLike } from '@niuma/shared-types';
import { LIKE_COOLDOWN_MS, handleLike } from './like';
import { World, type Player } from './world';
import type { Transport } from './view';

const NOW = 1_700_000_000_000;

interface Sent {
  wsId: number;
  targetId: number;
  likes: number;
  flags: number;
}

function harness(): {
  world: World;
  a: Player;
  b: Player;
  c: Player;
  sent: Sent[];
  transport: Transport;
} {
  const world = new World();
  const a = world.create('牛A', DEFAULT_APPEARANCE.cow, 1, 0, 0)!;
  const b = world.create('牛B', DEFAULT_APPEARANCE.cow, 2, 10, 0)!;
  const c = world.create('牛C', DEFAULT_APPEARANCE.cow, 3, 20, 0)!;
  // 视野对称：A 看得见 B，B 看得见 A / C，C 看得见 B
  a.known.add(b.id);
  b.known.add(a.id);
  b.known.add(c.id);
  c.known.add(b.id);
  const sent: Sent[] = [];
  const transport: Transport = {
    send(wsId, data) {
      const packet = decodeLike(data);
      if (packet) sent.push({ wsId, targetId: packet.targetId, likes: packet.likes, flags: packet.flags });
    },
  };
  return { world, a, b, c, sent, transport };
}

describe('工牌点赞裁决', () => {
  it('成功点赞：目标 + 目标视野内的人收 flag0，点赞者单独收 flag1', () => {
    const { world, a, b, c, sent, transport } = harness();
    handleLike(a, b.id, NOW, world, transport);
    expect(b.likes).toBe(1);
    expect(sent).toEqual([
      { wsId: b.wsId, targetId: b.id, likes: 1, flags: 0 },
      { wsId: c.wsId, targetId: b.id, likes: 1, flags: 0 },
      { wsId: a.wsId, targetId: b.id, likes: 1, flags: LIKE_FLAG_SELF },
    ]);
  });

  it('同一连接对同一目标只算一次：重复请求只回点赞者一条确认', () => {
    const { world, a, b, sent, transport } = harness();
    handleLike(a, b.id, NOW, world, transport);
    sent.length = 0;
    handleLike(a, b.id, NOW + LIKE_COOLDOWN_MS, world, transport);
    expect(b.likes).toBe(1);
    expect(sent).toEqual([
      { wsId: a.wsId, targetId: b.id, likes: 1, flags: LIKE_FLAG_SELF },
    ]);
  });

  it('限频窗口内的第二次点赞被丢掉，窗口过后才放行', () => {
    const { world, a, b, c, sent, transport } = harness();
    a.known.add(c.id);
    handleLike(a, b.id, NOW, world, transport);
    sent.length = 0;
    handleLike(a, c.id, NOW + LIKE_COOLDOWN_MS - 1, world, transport);
    expect(c.likes).toBe(0);
    expect(sent.length).toBe(0);
    handleLike(a, c.id, NOW + LIKE_COOLDOWN_MS, world, transport);
    expect(c.likes).toBe(1);
    expect(sent.some((item) => item.wsId === a.wsId && item.flags === LIKE_FLAG_SELF)).toBe(true);
  });

  it('自赞、看不见的人、未知目标都不产生任何包', () => {
    const { world, a, sent, transport } = harness();
    const outsider = world.create('视野外', DEFAULT_APPEARANCE.cow, 4, 100, 0)!;
    handleLike(a, a.id, NOW, world, transport);
    handleLike(a, outsider.id, NOW + 1, world, transport);
    handleLike(a, 99_999, NOW + 2, world, transport);
    expect(sent.length).toBe(0);
  });

  it('计数到 u16 上限就停增，不溢回 0', () => {
    const { world, a, b, transport } = harness();
    b.likes = MAX_LIKES;
    handleLike(a, b.id, NOW, world, transport);
    expect(b.likes).toBe(MAX_LIKES);
  });

  it('点赞者离开后从所有目标的去重集合里清掉，id 复用不会挡新玩家', () => {
    const { world, a, b } = harness();
    b.likedBy.add(a.id);
    world.destroy(a.id);
    expect(b.likedBy.has(a.id)).toBe(false);
  });
});
