import { describe, expect, it } from 'bun:test';
import {
  AMBULANCE_PACKET_BYTES,
  CLINIC_NURSE_SPOTS,
  CLINIC_VEHICLE_ENTRY,
  DEFAULT_APPEARANCE,
  DIRECTION,
  ENTITY_ROLE_NURSE,
  OpCode,
  POSE,
  TICK_MS,
  VENT_STUN_MS,
  decodeAmbulance,
  type AmbulancePacket,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { AmbulanceManager } from './clinic';
import { SeatRegistry } from './seats';
import { World, type Player } from './world';

interface Harness {
  world: World;
  grid: SpatialGrid;
  manager: AmbulanceManager;
  nurses: Player[];
}

function setup(now = 0): Harness {
  const world = new World();
  const grid = new SpatialGrid();
  const manager = new AmbulanceManager({
    world,
    grid,
    transport: {
      send() {},
    },
    seats: new SeatRegistry(),
    broadcastSeats: () => {},
    now,
  });
  const nurses = [...world.players.values()].filter((player) => player.role === ENTITY_ROLE_NURSE);
  return { world, grid, manager, nurses };
}

/** 复现一次创飞的结算结果：位移 + 倒地 + 硬直（写入方是 `sim/vent`） */
function knockDown(h: Harness, nurse: Player, now: number): void {
  nurse.x += 32;
  nurse.applyState(DIRECTION.Down, POSE.Lie, false);
  nurse.stunUntil = now + VENT_STUN_MS;
  h.grid.update(nurse.id, nurse.x, nurse.y);
}

function tick(now: number): number {
  return Math.floor(now / TICK_MS);
}

describe('护士站桩 NPC 的硬直回位（ADR-0090）', () => {
  it('按站位生成两名护士，站立朝下', () => {
    const h = setup();
    expect(h.nurses).toHaveLength(CLINIC_NURSE_SPOTS.length);
    h.nurses.forEach((nurse, index) => {
      const spot = CLINIC_NURSE_SPOTS[index]!;
      expect(nurse.x).toBe(spot.x);
      expect(nurse.y).toBe(spot.y);
      expect(nurse.pose).toBe(POSE.Idle);
      expect(nurse.direction).toBe(DIRECTION.Down);
    });
  });

  it('硬直未结束时保持倒地，不被提前扶起来', () => {
    const h = setup();
    const nurse = h.nurses[0]!;
    const knockedAt = 5_000;
    knockDown(h, nurse, knockedAt);
    const restX = nurse.x;

    h.manager.update(knockedAt + VENT_STUN_MS - 100, tick(knockedAt + VENT_STUN_MS - 100));

    expect(nurse.pose).toBe(POSE.Lie);
    expect(nurse.x).toBe(restX);
    expect(nurse.stunUntil).toBe(knockedAt + VENT_STUN_MS);
  });

  it('硬直结束自己站回原位，清硬直并刷新 AOI', () => {
    const h = setup();
    const nurse = h.nurses[0]!;
    const spot = CLINIC_NURSE_SPOTS[0]!;
    const knockedAt = 5_000;
    knockDown(h, nurse, knockedAt);
    expect(nurse.x).not.toBe(spot.x);

    const endedAt = knockedAt + VENT_STUN_MS;
    h.manager.update(endedAt, tick(endedAt));

    expect(nurse.pose).toBe(POSE.Idle);
    expect(nurse.direction).toBe(DIRECTION.Down);
    expect(nurse.x).toBe(spot.x);
    expect(nurse.y).toBe(spot.y);
    expect(nurse.stunUntil).toBe(0);
    expect(nurse.needsViewRefresh).toBe(true);
  });

  it('两名护士各自站回自己的位置', () => {
    const h = setup();
    const [first, second] = h.nurses;
    knockDown(h, first!, 5_000);
    knockDown(h, second!, 5_000);

    const endedAt = 5_000 + VENT_STUN_MS;
    h.manager.update(endedAt, tick(endedAt));

    expect([first!.x, first!.y]).toEqual([CLINIC_NURSE_SPOTS[0]!.x, CLINIC_NURSE_SPOTS[0]!.y]);
    expect([second!.x, second!.y]).toEqual([CLINIC_NURSE_SPOTS[1]!.x, CLINIC_NURSE_SPOTS[1]!.y]);
  });
});

describe('护士站围挡后的救护车进站（ADR-0092）', () => {
  it('柜台背后的伤员由救护车从南侧通道口进站接起', () => {
    const world = new World();
    const grid = new SpatialGrid();
    const cars: AmbulancePacket[] = [];
    const manager = new AmbulanceManager({
      world,
      grid,
      transport: {
        send(_wsId, packet) {
          if (packet.byteLength !== AMBULANCE_PACKET_BYTES) return;
          if (packet[0] !== OpCode.S2C_AMBULANCE) return;
          cars.push(decodeAmbulance(packet));
        },
      },
      seats: new SeatRegistry(),
      broadcastSeats: () => {},
      now: 0,
    });

    const attacker = world.create('甲', DEFAULT_APPEARANCE.cow, 11, 5_060, 4_330)!;
    // 柜台背后（护士站位一侧）：正是打护士后被打倒的高频点
    const victim = world.create('乙', DEFAULT_APPEARANCE.cow, 12, 5_060, 4_272)!;
    grid.insert(attacker.id, attacker.x, attacker.y);
    grid.insert(victim.id, victim.x, victim.y);

    const downAt = 1_000;
    for (let i = 0; i < 3; i += 1) manager.observeHit(attacker, victim, downAt);
    expect(victim.incapacitated).toBe(true);

    let nearestToEntry = Infinity;
    for (let elapsed = 0; elapsed <= 20_000 && victim.carriedBy === 0; elapsed += TICK_MS) {
      manager.update(downAt + elapsed, tick(downAt + elapsed));
      for (const car of cars) {
        if (car.id !== 1) continue;
        nearestToEntry = Math.min(
          nearestToEntry,
          Math.hypot(car.x - CLINIC_VEHICLE_ENTRY.x, car.y - CLINIC_VEHICLE_ENTRY.y),
        );
      }
      cars.length = 0;
    }

    // 先到通道口再进站：没走到通道口就摸到人，说明靠的是 8 秒脱困瞬移
    expect(nearestToEntry).toBeLessThan(24);
    expect(victim.carriedBy).not.toBe(0);
  });
});
