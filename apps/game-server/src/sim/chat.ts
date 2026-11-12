import {
  CHAT_REJECT_REASON,
  MAX_CHAT_CHARS,
  encodeChatBroadcast,
  encodeChatRejected,
  normalizeDanmakuColor,
  normalizeDanmakuMode,
  truncateChat,
  type ChatSendPacket,
  type ModerationFilter,
} from '@niuma/shared-types';
import type { ChatHistory } from './history';
import type { Player, World } from './world';
import type { Transport } from './view';

const WINDOW_MS = 5000;
const WINDOW_LIMIT = 3;

let nextMessageId = 1;

export interface ChatResult {
  sent: boolean;
  reason?: 'empty' | 'rate-limited' | 'too-long' | 'political';
}

/**
 * 园区频道发言（ADR-0056）。
 *
 * 弹幕外观（colorIndex / danmakuMode）与正文走同一条审核链路，但**不做拒绝理由**：
 * 越界的颜色或模式只是伪造包的痕迹，静默回落到安全值再广播，比新增一个拒绝原因
 * 更省协议字节，也不会让正常玩家因为客户端版本差异发不出话。
 */
export function handleChat(
  player: Player,
  packet: ChatSendPacket,
  now: number,
  world: World,
  transport: Transport,
  moderation: ModerationFilter,
  history: ChatHistory,
): ChatResult {
  const text = truncateChat(packet.text);
  if (text.length === 0) return { sent: false, reason: 'empty' };
  if (text.length > MAX_CHAT_CHARS) return { sent: false, reason: 'too-long' };

  if (now - player.chatWindowStart > WINDOW_MS) {
    player.chatWindowStart = now;
    player.chatCount = 0;
  }
  if (player.chatCount >= WINDOW_LIMIT) {
    transport.send(player.wsId, encodeChatRejected(CHAT_REJECT_REASON.RateLimited));
    return { sent: false, reason: 'rate-limited' };
  }
  // 被审核拦下的消息也计入窗口：否则可以拿被拒的请求反复刷回执
  player.chatCount += 1;

  // 政治类整条拒绝；污言秽语用打码后的文本继续广播，发送者自己看到的也是同一条
  const verdict = moderation.inspect(text);
  if (verdict.verdict === 'reject') {
    transport.send(player.wsId, encodeChatRejected(CHAT_REJECT_REASON.Political));
    return { sent: false, reason: 'political' };
  }

  // 服务端是元数据的唯一权威：解码时已归一化一次，这里再守一遍，
  // 让直接调用 handleChat 的内部路径（测试、将来的系统发言）也拿不到越界值。
  const colorIndex = normalizeDanmakuColor(packet.colorIndex);
  const danmakuMode = normalizeDanmakuMode(packet.danmakuMode);

  const msgId = nextMessageId;
  nextMessageId = nextMessageId >= 0xfffe ? 1 : nextMessageId + 1;
  const outgoing = encodeChatBroadcast({
    entityId: player.id,
    msgId,
    colorIndex,
    danmakuMode,
    text: verdict.text,
  });

  // 历史里存打码后的文本：回放看到的必须和当时广播出去的一模一样。
  // 被拒的消息在上面的分支里已经 return，不会进历史。
  // 弹幕颜色/模式不进历史：历史只负责「谁说了什么」，回放不重播弹幕（ADR-0056）。
  history.add({ msgId, entityId: player.id, name: player.name, text: verdict.text, at: now });

  transport.send(player.wsId, outgoing);
  for (const id of player.known) {
    const other = world.get(id);
    if (other) transport.send(other.wsId, outgoing);
  }
  return { sent: true };
}
