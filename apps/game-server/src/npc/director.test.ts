import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, PLAYER_RADIUS, POSE, isBlocked } from '@niuma/shared-types';
import { DEFAULT_NPC_CONFIG } from './config';
import { createNpcDirector } from './director';
import { NPC_ROLE_GUARD } from './roster';
import type { EscortEvent } from '../sim/detention';
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

describe('昏迷送医与康复续接（ADR-0106 / ADR-0109）', () => {
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

  it('康复续接只清状态，不把保安写回倒地点', () => {
    const { world, director } = setup(1, 2);
    director.spawn();
    const guard = [...world.players.values()].find((player) => player.role === NPC_ROLE_GUARD)!;
    const now = Date.now();

    guard.incapacitated = true;
    guard.stunUntil = now + 60_000;
    // 床尾坐标由 clinic 先写好：这里就是「人在急救站」，归位不该动它
    guard.x = 1;
    guard.y = 1;

    expect(director.restore(guard.id, now)).toBe(true);

    expect(guard.x).toBe(1);
    expect(guard.y).toBe(1);
    expect(guard.incapacitated).toBe(false);
    expect(guard.stunUntil).toBe(0);
    expect(guard.pose).toBe(POSE.Idle);
  });

  it('不在名册里的实体归位返回 false，让 clinic 退化为原地站起', () => {
    const { director } = setup(1, 2);
    director.spawn();
    expect(director.restore(9999, Date.now())).toBe(false);
  });

  it('押送途中被创倒：当帧回报 guard_down，收尾不扶站，康复后不再续追（ADR-0113）', () => {
    const { world, director } = setup(1, 2);
    director.spawn();
    const events: EscortEvent[] = [];
    director.setEscortListener((event) => events.push(event));

    const guards = [...world.players.values()].filter((player) => player.role === NPC_ROLE_GUARD);
    const guard = guards[0]!;
    // 其余保安先按在病床上：保证这一单只能派给他，后续断言也不受「谁更近」影响
    for (const other of guards.slice(1)) other.incapacitated = true;

    const now = Date.now();
    const target = world.create('目标', DEFAULT_APPEARANCE.cow, 12, guard.x + 20, guard.y, '', now)!;
    expect(director.dispatchEscort(target.id, now)).toBe(guard.id);

    guard.incapacitated = true;
    // 倒地姿态由急救链写：押送收尾不能再把它改回站姿
    guard.applyState(guard.direction, POSE.Lie, false);

    director.update(now + 50);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'abort',
      reason: 'guard_down',
      guardId: guard.id,
      targetId: target.id,
    });
    expect(guard.pose).toBe(POSE.Lie);

    // 康复后回巡逻：没有在途押送任务，还能正常接新单
    expect(director.restore(guard.id, now + 60)).toBe(true);
    expect(guard.incapacitated).toBe(false);
    expect(guard.pose).toBe(POSE.Idle);

    const another = world.create('另一个目标', DEFAULT_APPEARANCE.cow, 13, guard.x + 20, guard.y, '', now)!;
    expect(director.dispatchEscort(another.id, now + 100)).toBe(guard.id);
  });
});
