import {
  SYNC_FORMAT_COMPACT,
  quantizeCoord,
  writeSyncEntry,
  writeSyncEntryCompact,
  writeSyncHeader,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { Player, World } from './world';
import { refreshView, type Transport } from './view';

export interface TickResult {
  duration: number;
  players: number;
  packets: number;
  entries: number;
}

/**
 * 包头留到第一条条目到来时才写：人群静止时整 Tick 不碰发送缓冲。
 * 计数在偏移 5，与 `patchU16(5, count)` 对应。
 */
function pushSync(player: Player, id: number, x: number, y: number, state: number, tick: number): void {
  if (player.syncCount === 0) {
    player.syncWriter.reset();
    writeSyncHeader(player.syncWriter, tick, 0);
  }
  // 格式是连接级契约：同一个实体对不同观察者可能分别编成 6 或 7 字节
  if (player.syncFormat === SYNC_FORMAT_COMPACT) {
    writeSyncEntryCompact(player.syncWriter, id, x, y, state);
  } else {
    writeSyncEntry(player.syncWriter, id, x, y, state);
  }
  player.syncCount += 1;
}

/**
 * 单个 Tick：
 * 1) 只对需要刷新视野的玩家重算订阅；
 * 2) 只对本 Tick 真正变了的实体做一次编码，按视野分发给订阅者；
 * 3) 每人的发送缓冲复用，flush 后立刻可被下一 Tick 覆盖。
 *
 * 关键点：可见性是对称的，player.known 就是「看得见我的人」，
 * 因此广播不需要再做一次空间查询 —— 否则 200 人同屏会退化成 4 万次集合操作/Tick。
 *
 * 另一个关键点：`dirty` 只在三元组变化时由 `applyMove` 置位。坐着不动的玩家
 * 一个条目都不产生，整个 Tick 只多一次布尔判断。
 */
export function runTick(
  world: World,
  grid: SpatialGrid,
  transport: Transport,
  tick: number,
  now = Date.now(),
  onEnterView?: (viewer: Player, target: Player) => void,
): TickResult {
  const started = performance.now();
  let packets = 0;
  let entries = 0;

  for (const player of world.players.values()) {
    if (player.needsViewRefresh) refreshView(player, world, grid, transport, now, onEnterView);
    player.syncCount = 0;
  }

  for (const player of world.players.values()) {
    if (!player.dirty) continue;
    player.dirty = false;
    const x = quantizeCoord(player.x);
    const y = quantizeCoord(player.y);
    const state = player.state;
    const id = player.id;

    // NPC 没有连接：不把自身条目写进自己的发送缓冲，但照样推给观察者
    if (player.wsId !== 0) pushSync(player, id, x, y, state, tick);

    // 只写标量：这一圈在 200 人全同屏时是每 Tick 4 万次，
    // 任何一次对象构造都会变成每秒 80 万个短命对象。
    for (const viewerId of player.known) {
      const viewer = world.get(viewerId);
      // NPC 没有连接：不把邻居的条目写进它的发送缓冲，省掉一次编码与空发送
      if (!viewer || viewer.wsId === 0) continue;
      pushSync(viewer, id, x, y, state, tick);
    }

    // 去脏基准在本 Tick 处理完就回写：发给观察者的正是这一份三元组。
    // NPC 也必须收敛，否则静止的同事会在每个 Tick 重新变脏（它没有自己的发包路径）。
    player.lastBroadcastQx = x;
    player.lastBroadcastQy = y;
    player.lastBroadcastState = state;
  }

  for (const player of world.players.values()) {
    if (player.syncCount === 0) continue;
    player.syncWriter.patchU16(5, player.syncCount);
    transport.send(player.wsId, player.syncWriter.finish());
    packets += 1;
    entries += player.syncCount;
  }

  return { duration: performance.now() - started, players: world.size, packets, entries };
}
