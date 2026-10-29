import { VIEW_RADIUS, encodeDespawn, encodeSpawn, quantizeCoord } from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { Player, World } from './world';

export interface Transport {
  send(wsId: number, data: Uint8Array): void;
}

export const DESPAWN_OUT_OF_VIEW = 0;
export const DESPAWN_DISCONNECTED = 1;

const nearScratch = new Set<number>();
const removals: number[] = [];

function withinView(a: Player, b: Player): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= VIEW_RADIUS * VIEW_RADIUS;
}

function spawnPacketOf(player: Player): Uint8Array {
  return encodeSpawn({
    id: player.id,
    x: quantizeCoord(player.x),
    y: quantizeCoord(player.y),
    state: player.state,
    name: player.name,
    appearance: player.appearance,
  });
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
    if (!other || !withinView(player, other)) nearScratch.delete(id);
  }

  removals.length = 0;
  for (const id of player.known) {
    if (!nearScratch.has(id)) removals.push(id);
  }
  for (const id of removals) {
    player.known.delete(id);
    transport.send(player.wsId, encodeDespawn(id, DESPAWN_OUT_OF_VIEW));
    const other = world.get(id);
    if (other && other.known.delete(player.id)) {
      transport.send(other.wsId, encodeDespawn(player.id, DESPAWN_OUT_OF_VIEW));
    }
  }

  for (const id of nearScratch) {
    if (player.known.has(id)) continue;
    const other = world.get(id);
    if (!other) continue;
    player.known.add(id);
    transport.send(player.wsId, spawnPacketOf(other));
    if (!other.known.has(player.id)) {
      other.known.add(player.id);
      transport.send(other.wsId, spawnPacketOf(player));
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
