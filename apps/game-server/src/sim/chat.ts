import {
  CHAT_REJECT_REASON,
  MAX_CHAT_CHARS,
  encodeChatBroadcast,
  encodeChatRejected,
  truncateChat,
  type ModerationFilter,
} from '@niuma/shared-types';
import type { Player, World } from './world';
import type { Transport } from './view';

const WINDOW_MS = 5000;
const WINDOW_LIMIT = 3;

let nextMessageId = 1;

export interface ChatResult {
  sent: boolean;
  reason?: 'empty' | 'rate-limited' | 'too-long' | 'political';
}

export function handleChat(
  player: Player,
  rawText: string,
  now: number,
  world: World,
  transport: Transport,
  moderation: ModerationFilter,
): ChatResult {
  const text = truncateChat(rawText);
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

  const packet = encodeChatBroadcast({
    entityId: player.id,
    msgId: nextMessageId,
    text: verdict.text,
  });
  nextMessageId = nextMessageId >= 0xfffe ? 1 : nextMessageId + 1;

  transport.send(player.wsId, packet);
  for (const id of player.known) {
    const other = world.get(id);
    if (other) transport.send(other.wsId, packet);
  }
  return { sent: true };
}
