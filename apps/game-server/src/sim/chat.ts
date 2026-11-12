import {
  CHAT_REJECT_REASON,
  MAX_CHAT_CHARS,
  encodeChatBroadcast,
  encodeChatRejected,
  normalizeDanmakuColor,
  normalizeDanmakuMode,
  truncateChat,
  type ChatSendPacket,
  type DanmakuMode,
  type ModerationFilter,
} from '@niuma/shared-types';
import type { ChatHistory } from './history';
import type { Player, World } from './world';
import type { Transport } from './view';

const WINDOW_MS = 5000;
const WINDOW_LIMIT = 3;

/** 冷却窗口内连续撞墙多少次就临时禁言（正常玩家手速再快也到不了） */
const STRIKE_LIMIT = 8;
/** 撞墙计数的统计窗口：过了这段时间重新算 */
const STRIKE_WINDOW_MS = 10_000;
/** 临时禁言时长：够长到让脚本无利可图，又短到不冤枉手滑的正常人 */
const MUTE_MS = 60_000;

let nextMessageId = 1;

export interface ChatResult {
  sent: boolean;
  reason?: 'empty' | 'rate-limited' | 'too-long' | 'political' | 'cooldown' | 'muted';
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
  /** 两句之间的最小间隔（毫秒）；0 = 关闭这一层，只留 5s/3 条窗口 */
  cooldownMs = 0,
): ChatResult {
  const text = truncateChat(packet.text);
  if (text.length === 0) return { sent: false, reason: 'empty' };
  if (text.length > MAX_CHAT_CHARS) return { sent: false, reason: 'too-long' };

  // 禁言只拦上行，不踢线：踢线等于替攻击者决定「这个 IP 什么时候下线」，
  // 而正常玩家被踢一次就会以为是服务器坏了。禁言期间仍回一条拒绝回执，
  // 让客户端把「发送失败」显示出来，不至于让玩家以为消息发出去丢在路上了。
  if (player.chatMutedUntil > now) {
    transport.send(player.wsId, encodeChatRejected(CHAT_REJECT_REASON.RateLimited));
    return { sent: false, reason: 'muted' };
  }

  if (cooldownMs > 0 && now - player.lastChatAt < cooldownMs) {
    if (now - player.chatStrikeStart > STRIKE_WINDOW_MS) {
      player.chatStrikeStart = now;
      player.chatStrikes = 0;
    }
    player.chatStrikes += 1;
    if (player.chatStrikes >= STRIKE_LIMIT) {
      player.chatMutedUntil = now + MUTE_MS;
      player.chatStrikes = 0;
      console.warn(`[guard] chat muted ws=${player.wsId} for ${MUTE_MS / 1000}s`);
    }
    transport.send(player.wsId, encodeChatRejected(CHAT_REJECT_REASON.RateLimited));
    return { sent: false, reason: 'cooldown' };
  }

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
  // 记录「真的放行」的时刻：只记通过冷却的那条，被拒的不算，
  // 否则连刷时每条都在把 lastChatAt 往后推，冷却窗口永远不结束。
  player.lastChatAt = now;

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
  broadcastChatLine(player, verdict.text, now, world, transport, history, colorIndex, danmakuMode);
  return { sent: true };
}

/**
 * 把一句**已经过审并截断**的话广播出去：分配 msgId、写历史、发给可见集合。
 *
 * 玩家聊天与 NPC 低频台词共用这一份，`msgId` 只在模块内分配一次；
 * 调用方负责审核（NPC 台词在 director 加载时已过滤），这里不再重复审核。
 * 说话者自己也收：真人需要看到自己的弹幕，NPC 的 wsId=0 会被 transport 直接忽略。
 *
 * 历史里存的是打码后的文本，回放与当时广播出去的一模一样；
 * 弹幕颜色/模式不进历史（ADR-0056）。
 */
export function broadcastChatLine(
  speaker: Player,
  text: string,
  now: number,
  world: World,
  transport: Transport,
  history: ChatHistory,
  colorIndex: number,
  danmakuMode: DanmakuMode,
): number {
  const msgId = nextMessageId;
  nextMessageId = nextMessageId >= 0xfffe ? 1 : nextMessageId + 1;
  const outgoing = encodeChatBroadcast({
    entityId: speaker.id,
    msgId,
    colorIndex,
    danmakuMode,
    text,
  });

  history.add({ msgId, entityId: speaker.id, name: speaker.name, text, at: now });

  transport.send(speaker.wsId, outgoing);
  for (const id of speaker.known) {
    const other = world.get(id);
    if (other) transport.send(other.wsId, outgoing);
  }
  return msgId;
}
