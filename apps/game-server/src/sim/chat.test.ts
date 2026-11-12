import { describe, expect, it } from 'bun:test';
import {
  CHAT_REJECT_REASON,
  DANMAKU_MODE,
  DEFAULT_APPEARANCE,
  createModerationFilter,
  decodeChatBroadcast,
  decodeChatRejected,
  type ChatSendPacket,
  type DanmakuMode,
  type ModerationFilter,
} from '@niuma/shared-types';
import { broadcastChatLine, handleChat } from './chat';
import { ChatHistory } from './history';
import type { Transport } from './view';
import { World } from './world';

const filter: ModerationFilter = createModerationFilter({
  political: ['红线词'],
  profanity: ['脏话'],
});

/** 默认白 + 滚动：大多数用例只关心正文与审核，外观单独测 */
function say(text: string, colorIndex = 0, danmakuMode: DanmakuMode = DANMAKU_MODE.Scroll): ChatSendPacket {
  return { colorIndex, danmakuMode, text };
}

function setup() {
  const world = new World();
  const outbox: Array<{ wsId: number; data: Uint8Array }> = [];
  const transport: Transport = {
    send(wsId, data) {
      outbox.push({ wsId, data });
    },
  };
  const history = new ChatHistory(200, 60 * 60 * 1000);
  const sender = world.create('测试员', DEFAULT_APPEARANCE.cow, 1, 100, 100)!;
  const listener = world.create('旁听生', DEFAULT_APPEARANCE.cow, 2, 120, 100)!;
  sender.known.add(listener.id);
  listener.known.add(sender.id);
  return { world, outbox, transport, sender, listener, history };
}

describe('broadcastChatLine', () => {
  it('NPC 也能发言：写历史并只发给可见集合', () => {
    const { world, outbox, transport, listener, history } = setup();
    const npc = world.createNpc('同事', DEFAULT_APPEARANCE.cow, 100, 100, '', 1_000)!;
    npc.known.add(listener.id);
    listener.known.add(npc.id);

    const msgId = broadcastChatLine(npc, '咖啡没了', 2_000, world, transport, history, 3, DANMAKU_MODE.Scroll);
    expect(msgId).toBeGreaterThan(0);
    expect(history.latestPage(10, 2_000).lines.at(-1)).toMatchObject({
      entityId: npc.id,
      name: '同事',
      text: '咖啡没了',
    });
    // 发给 NPC 自己的 wsId=0 会被真实 transport 忽略；关键是旁听生收到了
    expect(outbox.some((packet) => packet.wsId === listener.wsId)).toBe(true);
    for (const packet of outbox) {
      expect(decodeChatBroadcast(packet.data).text).toBe('咖啡没了');
    }
  });

  it('msgId 与玩家消息共用同一计数器，不会撞号', () => {
    const { world, transport, sender, history } = setup();
    const result = handleChat(sender, say('一'), 1_000, world, transport, filter, history);
    expect(result.sent).toBe(true);
    const first = history.latestPage(10, 1_000).lines.at(-1)!.msgId;
    const second = broadcastChatLine(sender, '二', 2_000, world, transport, history, 0, DANMAKU_MODE.Scroll);
    expect(second).toBe(first + 1);
  });
});

describe('handleChat', () => {
  it('正常发言广播给自己与视野内的人', () => {
    const { world, outbox, transport, sender, listener, history } = setup();
    const result = handleChat(sender, say('今天也在加班'), 1000, world, transport, filter, history);

    expect(result.sent).toBe(true);
    expect(outbox).toHaveLength(2);
    expect(outbox.map((packet) => packet.wsId).sort()).toEqual([sender.wsId, listener.wsId].sort());
    for (const packet of outbox) {
      expect(decodeChatBroadcast(packet.data).text).toBe('今天也在加班');
    }
  });

  it('弹幕颜色与模式原样透传给所有接收者', () => {
    const { world, outbox, transport, sender, history } = setup();
    handleChat(sender, say('需求加急', 2, DANMAKU_MODE.Top), 1000, world, transport, filter, history);

    expect(outbox).toHaveLength(2);
    for (const packet of outbox) {
      const decoded = decodeChatBroadcast(packet.data);
      expect(decoded.colorIndex).toBe(2);
      expect(decoded.danmakuMode).toBe(DANMAKU_MODE.Top);
    }
  });

  it('越界的颜色与模式回落到默认值，而不是拒绝发言', () => {
    const { world, outbox, transport, sender, history } = setup();
    // 伪造客户端可以送任何 u8；服务端只认调色板内的值
    const forged = { colorIndex: 200, danmakuMode: 42, text: '越界也没关系' } as unknown as ChatSendPacket;
    const result = handleChat(sender, forged, 1000, world, transport, filter, history);

    expect(result.sent).toBe(true);
    expect(outbox).toHaveLength(2);
    for (const packet of outbox) {
      const decoded = decodeChatBroadcast(packet.data);
      expect(decoded.colorIndex).toBe(0);
      expect(decoded.danmakuMode).toBe(DANMAKU_MODE.Scroll);
      expect(decoded.text).toBe('越界也没关系');
    }
  });

  it('打码后颜色与模式仍然保留：外观与正文互不影响', () => {
    const { world, outbox, transport, sender, history } = setup();
    handleChat(sender, say('你个脏话', 5, DANMAKU_MODE.Bottom), 1000, world, transport, filter, history);

    const decoded = decodeChatBroadcast(outbox[0]!.data);
    expect(decoded.text).toBe('你个**');
    expect(decoded.colorIndex).toBe(5);
    expect(decoded.danmakuMode).toBe(DANMAKU_MODE.Bottom);
  });

  it('政治类命中整条拒绝：不广播，只给发送者回执', () => {
    const { world, outbox, transport, sender, history } = setup();
    const result = handleChat(sender, say('这里有红线词'), 1000, world, transport, filter, history);

    expect(result).toEqual({ sent: false, reason: 'political' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.wsId).toBe(sender.wsId);
    expect(decodeChatRejected(outbox[0]!.data)).toEqual({ reason: CHAT_REJECT_REASON.Political });
  });

  it('污言秽语打码后照常广播，发送者与旁听者看到同一份', () => {
    const { world, outbox, transport, sender, history } = setup();
    const result = handleChat(sender, say('你个脏话'), 1000, world, transport, filter, history);

    expect(result.sent).toBe(true);
    expect(outbox).toHaveLength(2);
    for (const packet of outbox) {
      expect(decodeChatBroadcast(packet.data).text).toBe('你个**');
    }
  });

  it('限速窗口满后回执限速原因，不再广播', () => {
    const { world, outbox, transport, sender, history } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(handleChat(sender, say(`第${i}条`), 1000, world, transport, filter, history).sent).toBe(true);
    }
    outbox.length = 0;

    const result = handleChat(sender, say('第4条'), 1000, world, transport, filter, history);
    expect(result).toEqual({ sent: false, reason: 'rate-limited' });
    expect(outbox).toHaveLength(1);
    expect(decodeChatRejected(outbox[0]!.data)).toEqual({ reason: CHAT_REJECT_REASON.RateLimited });
  });

  it('被审核拦下的发言也占用限速窗口', () => {
    const { world, outbox, transport, sender, history } = setup();
    for (let i = 0; i < 3; i += 1) {
      expect(handleChat(sender, say('红线词'), 1000, world, transport, filter, history).reason).toBe('political');
    }
    outbox.length = 0;

    expect(handleChat(sender, say('正常一句话'), 1000, world, transport, filter, history)).toEqual({
      sent: false,
      reason: 'rate-limited',
    });
  });

  it('窗口滑过后重新放行', () => {
    const { world, transport, sender, history } = setup();
    for (let i = 0; i < 3; i += 1) handleChat(sender, say(`第${i}条`), 1000, world, transport, filter, history);
    expect(handleChat(sender, say('过一会儿'), 6100, world, transport, filter, history).sent).toBe(true);
  });

  it('空串不广播也不回执', () => {
    const { world, outbox, transport, sender, history } = setup();
    expect(handleChat(sender, say('   '), 1000, world, transport, filter, history)).toEqual({
      sent: false,
      reason: 'empty',
    });
    expect(outbox).toHaveLength(0);
  });

  it('广播成功后写入历史：打码照写、被拒的不写', () => {
    const { world, transport, sender, history } = setup();
    handleChat(sender, say('今天也在加班'), 1000, world, transport, filter, history);
    handleChat(sender, say('这里有红线词'), 1100, world, transport, filter, history);
    handleChat(sender, say('你个脏话', 6, DANMAKU_MODE.Top), 1200, world, transport, filter, history);

    const page = history.latestPage(10, 5000);
    // 历史里的正文必须和当时广播出去的一字不差：回放不能绕过打码
    expect(page.lines.map((line) => line.text)).toEqual(['今天也在加班', '你个**']);
    expect(page.lines[0]!.name).toBe('测试员');
    expect(page.lines[0]!.at).toBe(1000);
    // 弹幕外观不进历史：历史条目只有正文与昵称
    expect(Object.keys(page.lines[0]!)).toEqual(['msgId', 'entityId', 'name', 'text', 'at']);
    expect(page.hasMore).toBe(false);
  });
});

describe('聊天冷却与临时禁言', () => {
  const COOLDOWN = 500;

  it('间隔不足 500ms 的第二条被拒，不会打断第一条', () => {
    const { world, transport, sender, history } = setup();
    expect(handleChat(sender, say('一'), 1_000, world, transport, filter, history, COOLDOWN).sent).toBe(true);
    const second = handleChat(sender, say('二'), 1_200, world, transport, filter, history, COOLDOWN);
    expect(second).toEqual({ sent: false, reason: 'cooldown' });
    expect(handleChat(sender, say('三'), 1_600, world, transport, filter, history, COOLDOWN).sent).toBe(true);
  });

  it('连续撞冷却 8 次触发 60 秒禁言', () => {
    const { world, transport, sender, history } = setup();
    handleChat(sender, say('起始'), 1_000, world, transport, filter, history, COOLDOWN);
    // 每次只推 1ms：既过不了 500ms 冷却，又落在同一个 10s 统计窗口里
    for (let i = 0; i < 8; i += 1) {
      handleChat(sender, say(`刷${i}`), 1_001 + i, world, transport, filter, history, COOLDOWN);
    }
    expect(sender.chatMutedUntil).toBeGreaterThan(1_200);
    // 禁言期间哪怕间隔够长也发不出去
    const muted = handleChat(sender, say('解禁了吗'), 5_000, world, transport, filter, history, COOLDOWN);
    expect(muted).toEqual({ sent: false, reason: 'muted' });
  });

  it('禁言到期后自动恢复', () => {
    const { world, transport, sender, history } = setup();
    handleChat(sender, say('起始'), 1_000, world, transport, filter, history, COOLDOWN);
    for (let i = 0; i < 8; i += 1) {
      handleChat(sender, say(`刷${i}`), 1_001 + i, world, transport, filter, history, COOLDOWN);
    }
    const afterMute = sender.chatMutedUntil + 1;
    expect(handleChat(sender, say('回来了'), afterMute, world, transport, filter, history, COOLDOWN).sent).toBe(true);
  });

  it('cooldownMs=0 时这一层完全关闭，只留 5s/3 条窗口', () => {
    const { world, transport, sender, history } = setup();
    for (const [i, now] of [1_000, 1_050, 1_100].entries()) {
      expect(handleChat(sender, say(`连发${i}`), now, world, transport, filter, history, 0).sent).toBe(true);
    }
    // 第 4 条被 5s/3 条窗口挡住，而不是冷却
    const fourth = handleChat(sender, say('第四'), 1_150, world, transport, filter, history, 0);
    expect(fourth).toEqual({ sent: false, reason: 'rate-limited' });
  });

  it('冷却只影响上行频率，不影响已有窗口的其他拒绝原因', () => {
    const { world, transport, sender, history } = setup();
    expect(handleChat(sender, say(''), 1_000, world, transport, filter, history, COOLDOWN)).toEqual({
      sent: false,
      reason: 'empty',
    });
    // 空消息不占用冷却：紧接着的一条正常内容仍能发出去
    expect(handleChat(sender, say('正常'), 1_010, world, transport, filter, history, COOLDOWN).sent).toBe(true);
  });
});
