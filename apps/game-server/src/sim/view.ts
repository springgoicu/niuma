import {
  ByteWriter,
  VIEW_RADIUS,
  encodeDespawn,
  encodeDespawnInto,
  encodeSpawnInto,
  quantizeCoord,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { Player, World } from './world';

export interface Transport {
  send(wsId: number, data: Uint8Array): void;
}

export const DESPAWN_OUT_OF_VIEW = 0;
export const DESPAWN_DISCONNECTED = 1;

const nearScratch = new Set<number>();
const removals: number[] = [];

/**
 * 离场包共用一条缓冲：一次视野重算可能连发几十条，不必每条都新建 4 字节视图。
 * 前提与 `syncWriter` 完全相同——Bun 的 `socket.send` 同步拷贝，
 * 整个服务端的下行都建立在这个前提上，这里没有新增假设。
 */
const despawnWriter = new ByteWriter(8);

function withinView(a: Player, b: Player): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= VIEW_RADIUS * VIEW_RADIUS;
}

/**
 * 把某个玩家的入场包编码到他自己持有的缓冲里。
 * 名字、外观与状态走 `spawnBody` 的缓存，这里只现写 6 字节头与在线秒数，
 * 所以除了首次构建 body 之外，稳态下一份入场包不产生任何分配。
 *
 * 在线秒数必须现算：它每秒变化，写进 `spawnBody` 会让后进入视野的人看到旧值。
 * 这段逻辑只在视野重算时执行，不在 20Hz Tick 热路径。
 */
function spawnPacketOf(player: Player): Uint8Array {
  const writer = player.spawnWriter;
  writer.reset();
  const onlineSec = player.joinedAt > 0 ? Math.max(0, Math.floor((Date.now() - player.joinedAt) / 1000)) : 0;
  encodeSpawnInto(
    writer,
    player.id,
    quantizeCoord(player.x),
    quantizeCoord(player.y),
    player.state,
    player.spawnBody,
    onlineSec,
    player.career,
    player.careerSegment,
    player.likes,
    player.role,
  );
  return writer.finish();
}

function sendDespawn(transport: Transport, wsId: number, id: number, reason: number): void {
  despawnWriter.reset();
  encodeDespawnInto(despawnWriter, id, reason);
  transport.send(wsId, despawnWriter.finish());
}

/**
 * 视野差量维护：只在跨格或上下线时调用。
 * 可见性是对称的，所以新增/移除必须同时修正双方的 known 集合，
 * 否则会出现「我看得见他、他看不见我」的幽灵实体。
 */
export function refreshView(player: Player, world: World, grid: SpatialGrid, transport: Transport): void {
  player.needsViewRefresh = false;
  nearScratch.clear();
  grid.queryNear(player.x, player.y, VIEW_RADIUS, nearScratch);

  for (const id of nearScratch) {
    if (id === player.id) {
      nearScratch.delete(id);
      continue;
    }
    const other = world.get(id);
    // 房间频道隔离：公寓里的玩家与屋外玩家互不可见（坐标是同一个矩形）
    if (!other || other.roomId !== player.roomId || !withinView(player, other)) nearScratch.delete(id);
  }

  removals.length = 0;
  for (const id of player.known) {
    if (!nearScratch.has(id)) removals.push(id);
  }
  for (const id of removals) {
    player.known.delete(id);
    // NPC 没有连接（wsId=0）：只维护 known，不构造下行包
    if (player.wsId !== 0) sendDespawn(transport, player.wsId, id, DESPAWN_OUT_OF_VIEW);
    const other = world.get(id);
    if (other && other.known.delete(player.id) && other.wsId !== 0) {
      sendDespawn(transport, other.wsId, player.id, DESPAWN_OUT_OF_VIEW);
    }
  }

  // 自己的包在循环外算一次：N 个已在场者原本各编一遍同一个玩家，
  // 200 人同秒涌入时光这一条支路就是 O(N²) 次编码。
  let selfPacket: Uint8Array | null = null;
  for (const id of nearScratch) {
    if (player.known.has(id)) continue;
    const other = world.get(id);
    if (!other) continue;
    player.known.add(id);
    if (player.wsId !== 0) transport.send(player.wsId, spawnPacketOf(other));
    if (!other.known.has(player.id)) {
      other.known.add(player.id);
      // 对方的 known 也要补齐，但它没有连接时不必为它编码入场包
      if (other.wsId !== 0) {
        selfPacket ??= spawnPacketOf(player);
        transport.send(other.wsId, selfPacket);
      }
    }
  }
}

/** 下线：所有曾看见他的玩家都要收到 despawn，随后才能从世界移除 */
export function broadcastDespawn(player: Player, world: World, transport: Transport): void {
  const packet = encodeDespawn(player.id, DESPAWN_DISCONNECTED);
  for (const id of player.known) {
    const other = world.get(id);
    if (!other) continue;
    other.known.delete(player.id);
    transport.send(other.wsId, packet);
  }
  player.known.clear();
}
