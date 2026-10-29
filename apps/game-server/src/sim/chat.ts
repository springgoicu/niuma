import { MAX_CHAT_CHARS, encodeChatBroadcast, truncateChat } from '@niuma/shared-types';
import type { Player, World } from './world';
import type { Transport } from './view';

const WINDOW_MS = 5000;
const WINDOW_LIMIT = 3;

let nextMessageId = 1;

export interface ChatResult {
  sent: boolean;
  reason?: 'empty' | 'rate-limited' | 'too-long';
}

export function handleChat(
  player: Player,
  rawText: string,
  now: number,
  world: World,
  transport: Transport,
): ChatResult {
  const text = truncateChat(rawText);
  if (text.length === 0) return { sent: false, reason: 'empty' };
  if (text.length > MAX_CHAT_CHARS) return { sent: false, reason: 'too-long' };

  if (now - player.chatWindowStart > WINDOW_MS) {
    player.chatWindowStart = now;
    player.chatCount = 0;
  }
  if (player.chatCount >= WINDOW_LIMIT) return { sent: false, reason: 'rate-limited' };
  player.chatCount += 1;

  const packet = encodeChatBroadcast({ entityId: player.id, msgId: nextMessageId, text });
  nextMessageId = nextMessageId >= 0xfffe ? 1 : nextMessageId + 1;

  transport.send(player.wsId, packet);
  for (const id of player.known) {
    const other = world.get(id);
    if (other) transport.send(other.wsId, packet);
  }
  return { sent: true };
}
