import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  ENTITY_ROLE_GUARD,
  OpCode,
  SPAWN_CENTER,
  decodeSpawn,
  readSync,
} from '@niuma/shared-types';
import { DEFAULT_NPC_CONFIG } from './config';
import { createNpcDirector } from './director';
import { runTick } from '../sim/tick';
import { refreshView, type Transport } from '../sim/view';
import { World } from '../sim/world';
import { SpatialGrid } from '../spatial/grid';

function setup(count = 2, seed = 21) {
  const world = new World();
  const grid = new SpatialGrid();
  const packets: Array<{ wsId: number; data: Uint8Array }> = [];
  const transport: Transport = {
    send(wsId, data) {
      packets.push({ wsId, data });
    },
  };
  const director = createNpcDirector({
    world,
    grid,
    transport,
    config: { ...DEFAULT_NPC_CONFIG, count, seed },
  });
  return { world, grid, packets, transport, director };
}

function joinHuman(world: World, grid: SpatialGrid) {
  const human = world.create('真人', DEFAULT_APPEARANCE.cow, 7, SPAWN_CENTER.x, SPAWN_CENTER.y, '', Date.now())!;
  grid.insert(human.id, human.x, human.y);
  return human;
}

describe('NPC 与真人共享实体通道', () => {
  it('真人进入视野能收到 NPC 的入场包；NPC 自己不收任何包', () => {
    const { world, grid, packets, transport, director } = setup();
    director.spawn();
    const human = joinHuman(world, grid);
    refreshView(human, world, grid, transport);

    const spawnPackets = packets.filter((packet) => packet.data[0] === OpCode.S2C_ENTITY_SPAWN);
    // 第 1 位同事与第 1 位保安从广场出发，1000px 视野内至少能看到他们
    expect(spawnPackets.length).toBeGreaterThanOrEqual(2);
    expect(spawnPackets.every((packet) => packet.wsId === human.wsId)).toBe(true);
    // wsId=0 的下行已经被短路径挡掉：NPC 不会收到自己的包
    expect(packets.some((packet) => packet.wsId === 0)).toBe(false);

    const npcIds = new Set(
      [...world.players.values()].filter((player) => player.isNpc).map((player) => player.id),
    );
    for (const packet of spawnPackets) {
      expect(npcIds.has(decodeSpawn(packet.data).id)).toBe(true);
    }
    expect(human.known.size).toBe(spawnPackets.length);

    // 广场固定位：一名普通同事（无 role 段）+ 一名保安（0xfd 段）
    const roles = spawnPackets.map((packet) => decodeSpawn(packet.data).role);
    expect(roles).toContain(ENTITY_ROLE_GUARD);
    expect(roles.some((role) => role === undefined)).toBe(true);
  });

  it('known 双向对称：NPC 也把真人放进自己的邻居集合', () => {
    const { world, grid, transport, director } = setup(4, 22);
    director.spawn();
    const human = joinHuman(world, grid);
    refreshView(human, world, grid, transport);

    expect(human.known.size).toBeGreaterThan(0);
    for (const id of human.known) {
      const npc = world.get(id)!;
      expect(npc.known.has(human.id)).toBe(true);
    }
  });

  it('NPC 走起来后，真人能收到带 NPC id 的同步包', () => {
    const { world, grid, packets, transport, director } = setup();
    director.spawn();
    const human = joinHuman(world, grid);
    refreshView(human, world, grid, transport);
    // 清掉入场包，只看 Tick 同步
    packets.length = 0;

    // 推到初始停顿之后，让所有人都进入 walk
    director.update(Date.now() + 4_000);
    const result = runTick(world, grid, transport, 1);
    expect(result.entries).toBeGreaterThan(0);

    const syncPackets = packets.filter((packet) => packet.data[0] === OpCode.S2C_SYNC_ENTITIES);
    expect(syncPackets.length).toBe(1);
    expect(syncPackets[0]!.wsId).toBe(human.wsId);

    const npcIds = new Set(
      [...world.players.values()].filter((player) => player.isNpc).map((player) => player.id),
    );
    const seen = new Set<number>();
    readSync(syncPackets[0]!.data, (id) => seen.add(id));
    expect(seen.size).toBeGreaterThan(0);
    for (const id of seen) expect(npcIds.has(id)).toBe(true);
    // 同步条目不包括真人自己：自己不需要通过 AOI 收自己的位置
    expect(seen.has(human.id)).toBe(false);
  });

  it('真人离开视野外不会收到 NPC 的包：只有 known 里的人收', () => {
    const { world, grid, packets, transport, director } = setup(2, 23);
    director.spawn();
    const human = joinHuman(world, grid);
    refreshView(human, world, grid, transport);

    // 走到岛的另一侧，再刷新一次视野：双向订阅一起断开
    human.x = 900;
    human.y = 900;
    grid.update(human.id, human.x, human.y);
    refreshView(human, world, grid, transport);
    expect(human.known.size).toBe(0);
    packets.length = 0;

    director.update(Date.now() + 4_000);
    runTick(world, grid, transport, 1);
    expect(packets.length).toBe(0);
  });
});
