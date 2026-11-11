import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, SYSTEM_NOTICE_KIND, decodeSystemNotice } from '@niuma/shared-types';
import { announceEnter, announceLeave, broadcastSystemNotice } from './notice';
import type { Transport } from './view';
import { World } from './world';

/** 两名玩家互相可见：`refreshView` 跑完之后的稳态 */
function setup() {
  const world = new World();
  const outbox: Array<{ wsId: number; data: Uint8Array }> = [];
  const transport: Transport = {
    send(wsId, data) {
      outbox.push({ wsId, data });
    },
  };
  const viewer = world.create('老员工', DEFAULT_APPEARANCE.cow, 1, 100, 100)!;
  const newcomer = world.create('新来的', DEFAULT_APPEARANCE.cow, 2, 120, 100)!;
  viewer.known.add(newcomer.id);
  newcomer.known.add(viewer.id);
  return { world, outbox, transport, viewer, newcomer };
}

describe('系统播报', () => {
  it('进园只发给看得见他的人，不发给本人', () => {
    const { world, outbox, transport, viewer, newcomer } = setup();
    announceEnter(newcomer, world, transport);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.wsId).toBe(viewer.wsId);
    const packet = decodeSystemNotice(outbox[0]!.data);
    expect(packet.kind).toBe(SYSTEM_NOTICE_KIND.Enter);
    expect(packet.entityId).toBe(newcomer.id);
    expect(packet.text).toBe('新来的 进入了园区');
  });

  it('离园同样只发给视野内的人，文案是中性的「离开了园区」', () => {
    const { world, outbox, transport, viewer, newcomer } = setup();
    announceLeave(newcomer, world, transport);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.wsId).toBe(viewer.wsId);
    expect(decodeSystemNotice(outbox[0]!.data)).toEqual({
      kind: SYSTEM_NOTICE_KIND.Leave,
      entityId: newcomer.id,
      text: '新来的 离开了园区',
    });
  });

  it('没有旁观者时不发包：视野空着不该产生流量', () => {
    const { world, outbox, transport, newcomer } = setup();
    newcomer.known.clear();
    announceEnter(newcomer, world, transport);
    expect(outbox).toHaveLength(0);
  });

  it('空文案直接跳过，不发一条看不见字的系统消息', () => {
    const { world, outbox, transport, viewer } = setup();
    broadcastSystemNotice(world, transport, [viewer.id], SYSTEM_NOTICE_KIND.OnDuty, '');
    expect(outbox).toHaveLength(0);
  });

  it('观众已被世界移除时不抛错，只是在发送前跳过', () => {
    const { world, outbox, transport, viewer, newcomer } = setup();
    world.destroy(viewer.id);
    announceLeave(newcomer, world, transport);
    expect(outbox).toHaveLength(0);
  });
});
