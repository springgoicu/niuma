import { quantizeCoord, writeSyncEntry, writeSyncHeader } from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { World } from './world';
import { refreshView, type Transport } from './view';

export interface TickResult {
  duration: number;
  players: number;
  packets: number;
  entries: number;
}

/**
 * 单个 Tick：
 * 1) 只对需要刷新视野的玩家重算订阅；
 * 2) 只对本 Tick 移动/变状态的实体做一次编码，按视野分发给订阅者；
 * 3) 每人的发送缓冲复用，flush 后立刻可被下一 Tick 覆盖。
 *
 * 关键点：可见性是对称的，player.known 就是「看得见我的人」，
 * 因此广播不需要再做一次空间查询 —— 否则 200 人同屏会退化成 4 万次集合操作/Tick。
 */
export function runTick(world: World, grid: SpatialGrid, transport: Transport, tick: number): TickResult {
  const started = performance.now();
  let packets = 0;
  let entries = 0;

  for (const player of world.players.values()) {
    if (player.needsViewRefresh) refreshView(player, world, grid, transport);
  }

  for (const player of world.players.values()) {
    player.syncWriter.reset();
    writeSyncHeader(player.syncWriter, tick, 0);
    player.syncCount = 0;
  }

  for (const player of world.players.values()) {
    if (!player.dirty) continue;
    player.dirty = false;
    const x = quantizeCoord(player.x);
    const y = quantizeCoord(player.y);

    const id = player.id;
    const state = player.state;
    writeSyncEntry(player.syncWriter, id, x, y, state);
    player.syncCount += 1;

    // 只写标量：这一圈在 200 人全同屏时是每 Tick 4 万次，
    // 任何一次对象构造都会变成每秒 80 万个短命对象。
    for (const viewerId of player.known) {
      const viewer = world.get(viewerId);
      if (!viewer) continue;
      writeSyncEntry(viewer.syncWriter, id, x, y, state);
      viewer.syncCount += 1;
    }
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
