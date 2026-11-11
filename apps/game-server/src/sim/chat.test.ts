import { describe, expect, it } from 'bun:test';
import {
  CHAT_REJECT_REASON,
  DEFAULT_APPEARANCE,
  createModerationFilter,
  decodeChatBroadcast,
  decodeChatRejected,
  type ModerationFilter,
} from '@niuma/shared-types';
import { handleChat } from './chat';
import type { Transport } from './view';
import { World } from './world';

const filter: ModerationFilter = createModerationFilter({
  political: ['红线词'],
  profanity: ['脏话'],
});

function setup() {
  const world = new World();
  const outbox: Array<{ wsId: number; data: Uint8Array }> = [];
  const transport: Transport = {
    send(wsId, data) {
      outbox.push({ wsId, data });
    },
  };
  const sender = world.create('测试员', DEFAULT_APPEARANCE.cow, 1, 100, 100)!;
  const listener = world.create('旁听生', DEFAULT_APPEARANCE.cow, 2, 120, 100)!;
  sender.known.add(listener.id);
  listener.known.add(sender.id);
  return { world, outbox, transport, sender, listener };
}

describe('handleChat', () => {
  it('正常发言广播给自己与视野内的人', () => {
    const { world, outbox, transport, sender, listener } = setup();
    const result = handleChat(sender, '今天也在加班', 1000, world, transport, filter);

    expect(result.sent).toBe(true);
    expect(outbox).toHaveLength(2);
    expect(outbox.map((packet) => packet.wsId).sort()).toEqual([sender.wsId, listener.wsId].sort());
    for (const packet of outbox) {
      expect(decodeChatBroadcast(packet.data).text).toBe('今天也在加班');
    }
  });

  it('政治类命中整条拒绝：不广播，只给发送者回执', () => {
    const { world, outbox, transport, sender } = setup();
    const result = handleChat(sender, '这里有红线词', 1000, world, transport, filter);

    expect(result).toEqual({ sent: false, reason: 'political' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.wsId).toBe(sender.wsId);
    expect(decodeChatRejected(outbox[0]!.data)).toEqual({ reason: CHAT_REJECT_REASON.Political });
  });

  it('污言秽语打码后照常广播，发送者与旁听者看到同一份', () => {
    const { world, outbox, transport, sender } = setup();
    const result = handleChat(sender, '你个脏话', 1000, world, transport, filter);

    expect(result.sent).toBe(true);
    expect(outbox).toHaveLength(2);
    for (const packet of outbox) {
      expect(decodeChatBroadcast(packet.data).text).toBe('你个**');
    }
  });

  it('限速窗口满后回执限速原因，不再广播', () => {
    const { world, outbox, transport, sender } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(handleChat(sender, `第${i}条`, 1000, world, transport, filter).sent).toBe(true);
    }
    outbox.length = 0;

    const result = handleChat(sender, '第4条', 1000, world, transport, filter);
    expect(result).toEqual({ sent: false, reason: 'rate-limited' });
    expect(outbox).toHaveLength(1);
    expect(decodeChatRejected(outbox[0]!.data)).toEqual({ reason: CHAT_REJECT_REASON.RateLimited });
  });

  it('被审核拦下的发言也占用限速窗口', () => {
    const { world, outbox, transport, sender } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(handleChat(sender, '红线词', 1000, world, transport, filter).reason).toBe('political');
    }
    outbox.length = 0;

    expect(handleChat(sender, '正常一句话', 1000, world, transport, filter)).toEqual({
      sent: false,
      reason: 'rate-limited',
    });
  });

  it('窗口滑过后重新放行', () => {
    const { world, transport, sender } = setup();
    for (let i = 0; i < 3; i += 1) handleChat(sender, `第${i}条`, 1000, world, transport, filter);
    expect(handleChat(sender, '过一会儿', 6100, world, transport, filter).sent).toBe(true);
  });

  it('空串不广播也不回执', () => {
    const { world, outbox, transport, sender } = setup();
    expect(handleChat(sender, '   ', 1000, world, transport, filter)).toEqual({
      sent: false,
      reason: 'empty',
    });
    expect(outbox).toHaveLength(0);
  });
});
