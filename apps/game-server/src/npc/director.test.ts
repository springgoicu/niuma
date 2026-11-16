import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, PLAYER_RADIUS, POSE, isBlocked } from '@niuma/shared-types';
import { DEFAULT_NPC_CONFIG } from './config';
import { createNpcDirector } from './director';
import { NPC_ROLE_GUARD } from './roster';
import { runTick } from '../sim/tick';
import type { Transport } from '../sim/view';
import { World } from '../sim/world';
import { SpatialGrid } from '../spatial/grid';

function setup(count = 2, seed = 1) {
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

describe('NPC 生成', () => {
  it('默认生成 2 位同事 + 3 位保安：不占真人名额，全部进入空间索引', () => {
    const { world, grid, director } = setup();
    director.spawn();
    expect(director.count).toBe(5);
    expect(director.guardCount).toBe(3);
    expect(world.npcCount).toBe(5);
    expect(world.humans).toBe(0);
    expect(world.size).toBe(5);
    expect(grid.size).toBe(5);
    for (const player of world.players.values()) {
      expect(player.isNpc).toBe(true);
      expect(player.wsId).toBe(0);
      expect(isBlocked(player.x, player.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it('count=0 时一个都不生成：这是完整回滚开关', () => {
    const { world, grid, director } = setup(0);
    director.spawn();
    expect(director.count).toBe(0);
    expect(world.size).toBe(0);
    expect(grid.size).toBe(0);
  });

  it('重复 spawn 不会生成第二批', () => {
    const { world, director } = setup(2);
    director.spawn();
    director.spawn();
    expect(world.npcCount).toBe(5);
  });

  it('数量按配置生效，保安固定 3 位，且每人都有合法名字与考勤', () => {
    const { world, director } = setup(6, 9);
    director.spawn();
    expect(world.npcCount).toBe(9);
    expect(director.guardCount).toBe(3);
    for (const player of world.players.values()) {
      expect(player.name.length).toBeGreaterThan(0);
      expect(player.career.firstJoinDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('NPC 推进', () => {
  it('连续 2000 Tick 始终站在可走位置，不产生 NaN', () => {
    const { world, director } = setup(2, 3);
    director.spawn();
    const now = Date.now();
    for (let index = 0; index < 2_000; index += 1) {
      director.update(now + index * 50);
      for (const player of world.players.values()) {
        expect(Number.isFinite(player.x)).toBe(true);
        expect(Number.isFinite(player.y)).toBe(true);
        expect(isBlocked(player.x, player.y, PLAYER_RADIUS)).toBe(false);
      }
    }
    expect(director.updateMs).toBeGreaterThanOrEqual(0);
  });

  it('初始停顿期间不产生 dirty：静止的同事一个字节都不发', () => {
    const { world, grid, packets, transport, director } = setup(2, 4);
    director.spawn();
    // 先跑一帧，清掉出生时的 needsViewRefresh 与基准
    runTick(world, grid, transport, 1);
    packets.length = 0;

    // 刚出生都在 400–2400ms 的初始停顿内，100ms 后仍然静止
    director.update(Date.now() + 100);
    runTick(world, grid, transport, 2);
    expect(packets.length).toBe(0);
  });

  it('坐标异常时被拉回安全点，不让 Tick 抛出', () => {
    const { world, director } = setup(3, 5);
    director.spawn();
    const first = world.players.values().next().value!;
    first.x = Number.NaN;
    first.y = Number.POSITIVE_INFINITY;
    expect(() => director.update(Date.now() + 50)).not.toThrow();
    expect(Number.isFinite(first.x)).toBe(true);
    expect(Number.isFinite(first.y)).toBe(true);
    expect(isBlocked(first.x, first.y, PLAYER_RADIUS)).toBe(false);
  });
});

describe('昏迷送医与康复归位（ADR-0106）', () => {
  it('昏迷的保安不接押送 / 盯梢派单，康复后恢复接单', () => {
    const { world, director } = setup(1, 2);
    director.spawn();
    const guards = [...world.players.values()].filter((player) => player.role === NPC_ROLE_GUARD);
    expect(guards.length).toBeGreaterThan(0);

    const now = Date.now();
    const target = world.create('目标', DEFAULT_APPEARANCE.cow, 12, guards[0]!.x + 20, guards[0]!.y, '', now)!;

    for (const guard of guards) guard.incapacitated = true;
    expect(director.dispatchEscort(target.id, now)).toBe(0);
    expect(director.dispatchFollow(target.id, now + 30_000, now)).toBe(0);

    guards[0]!.incapacitated = false;
    expect(director.dispatchEscort(target.id, now)).toBe(guards[0]!.id);
  });

  it('康复归位把保安写回倒地点并清掉昏迷与硬直', () => {
    const { world, director } = setup(1, 2);
    director.spawn();
    const guard = [...world.players.values()].find((player) => player.role === NPC_ROLE_GUARD)!;
    const now = Date.now();
    const spot = { x: guard.x + 120, y: guard.y + 60 };

    guard.incapacitated = true;
    guard.stunUntil = now + 60_000;
    guard.x = 1;
    guard.y = 1;

    expect(director.restore(guard.id, spot, now)).toBe(true);

    expect(guard.x).toBe(spot.x);
    expect(guard.y).toBe(spot.y);
    expect(guard.incapacitated).toBe(false);
    expect(guard.stunUntil).toBe(0);
    expect(guard.pose).toBe(POSE.Idle);
  });

  it('不在名册里的实体归位返回 false，让 clinic 退化为原地站起', () => {
    const { director } = setup(1, 2);
    director.spawn();
    expect(director.restore(9999, { x: 100, y: 100 }, Date.now())).toBe(false);
  });
});
