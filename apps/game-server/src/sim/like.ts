import { LIKE_FLAG_SELF, MAX_LIKES, encodeLike } from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

/** 同一连接两次点赞的最小间隔：挡住伪造包把点赞广播当放大器 */
export const LIKE_COOLDOWN_MS = 400;

/**
 * 工牌点赞（ADR-0057）：服务端裁决 + 内存计数。
 *
 * 规则收在这一个深模块里，dispatch 只负责解码：
 * - 只能点自己看得见的人（`known` 与点选工牌的可见性同源）；
 * - 不能自赞；
 * - 同一连接对同一目标只算一次，重复请求只回点赞者一条「你已点赞」，不涨数、不广播；
 * - 400ms 限频；
 * - 目标本人与目标视野内的人收 flag0，点赞者单独收 flag1。
 *
 * 点赞数只用于展示与「人气」榜，不参与任何权威判定；目标离园即随 Player 回收清零。
 */
export function handleLike(
  player: Player,
  targetId: number,
  now: number,
  world: World,
  transport: Transport,
  /**
   * 计数落盘钩子（ADR-0081）：服务端把赞累加进匿名档案并打脏标记。
   * 不传就退化为纯内存计数，测试与无持久化部署零改动。
   */
  onCounted?: (target: Player) => void,
  /**
   * 点赞成功钩子（ADR-0112）：只在真正涨数时回调一次，重复点赞与自赞不触发。
   * 全园区播报挂在在这里，`like.ts` 本身不认识播报中枢。
   */
  onLiked?: (target: Player) => void,
): void {
  if (now - player.lastLikeAt < LIKE_COOLDOWN_MS) return;
  const target = world.get(targetId);
  if (!target || target.id === player.id) return;
  // 工牌只能点选可见角色打开；伪造包也不能给视野外的人刷赞
  if (!player.known.has(targetId)) return;
  player.lastLikeAt = now;

  if (target.likedBy.has(player.id)) {
    // 幂等确认：客户端可能丢了第一条 ack，重发只给自己，不重复计数
    transport.send(player.wsId, encodeLike(target.id, target.likes, LIKE_FLAG_SELF));
    return;
  }

  target.likedBy.add(player.id);
  target.likes = Math.min(MAX_LIKES, target.likes + 1);
  // 钩子可以把展示数改成匿名档案的累计值（跨重启延续），广播读的是改完之后的值
  onCounted?.(target);
  target.likes = Math.min(MAX_LIKES, Math.max(0, Math.floor(target.likes)));
  onLiked?.(target);

  const broadcast = encodeLike(target.id, target.likes, 0);
  transport.send(target.wsId, broadcast);
  for (const id of target.known) {
    // 点赞者单独收 flag1，避免同一帧里先收 flag0 再收 flag1
    if (id === player.id) continue;
    const other = world.get(id);
    if (other) transport.send(other.wsId, broadcast);
  }
  transport.send(player.wsId, encodeLike(target.id, target.likes, LIKE_FLAG_SELF));
}
