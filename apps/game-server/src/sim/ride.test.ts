import { describe, expect, it } from 'bun:test';
import {
  DIRECTION,
  PARK_SLIDE,
  POSE,
  SLIDE_PHASE,
  decodeSlideEvent,
  packState,
  quantizeCoord,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import { applyMove } from './movement';
import { advanceRides, isRiding, startRide } from './ride';
import { Player, World } from './world';

/**
 * 滑梯是服务端权威的脚本化位移：开始校验、逐 Tick 轨迹、落点与滑行期间的
 * 输入屏蔽都在这里钉住。位置只由共享折线决定，客户端上报不能改落点。
 */

const START = 1000;

function rider(x = PARK_SLIDE.landing.x, y = PARK_SLIDE.landing.y): Player {
  const player = new Player();
  player.id = 5;
  player.wsId = 7;
  player.x = x;
  player.y = y;
  player.applyState(DIRECTION.Down, POSE.Idle, false);
  return player;
}

function worldOf(player: Player): World {
  const world = new World();
  world.players.set(player.id, player);
  return world;
}

function fakeGrid(): SpatialGrid {
  return { update: () => false } as unknown as SpatialGrid;
}

describe('滑梯开始校验', () => {
  it('站在缓冲区旁可以开始，角色被放到塔顶并锁成坐姿', () => {
    const player = rider();
    expect(startRide(player, PARK_SLIDE.id, START)).toBe(true);
    expect(player.rideSlide).toBe(PARK_SLIDE.id);
    expect(player.rideEndsAt).toBe(START + PARK_SLIDE.rideMs);
    expect(player.x).toBe(PARK_SLIDE.top.x);
    expect(player.y).toBe(PARK_SLIDE.top.y);
    expect(player.pose).toBe(POSE.Sit);
    expect(isRiding(player, START + 1)).toBe(true);
  });

  it('站得太远 / 坐着 / 硬直 / 冷却中都不受理', () => {
    const far = rider(PARK_SLIDE.landing.x + 200, PARK_SLIDE.landing.y);
    expect(startRide(far, PARK_SLIDE.id, START)).toBe(false);

    const seated = rider();
    seated.seat = 1;
    expect(startRide(seated, PARK_SLIDE.id, START)).toBe(false);

    const stunned = rider();
    stunned.stunUntil = START + 500;
    expect(startRide(stunned, PARK_SLIDE.id, START)).toBe(false);

    const cooling = rider();
    expect(startRide(cooling, PARK_SLIDE.id, START)).toBe(true);
    // 同一时刻不能第二次出发；滑完之后也要等满 1.2s 冷却
    expect(startRide(cooling, PARK_SLIDE.id, START + 100)).toBe(false);
    advanceRides(worldOf(cooling), fakeGrid(), { send: () => undefined }, START + PARK_SLIDE.rideMs);
    expect(startRide(cooling, PARK_SLIDE.id, START + PARK_SLIDE.rideMs + 100)).toBe(false);
    expect(startRide(cooling, PARK_SLIDE.id, START + 1300)).toBe(true);
  });

  it('不存在的滑梯 id 不改变任何状态', () => {
    const player = rider();
    expect(startRide(player, 999, START)).toBe(false);
    expect(player.rideSlide).toBe(0);
    expect(player.x).toBe(PARK_SLIDE.landing.x);
  });
});

describe('滑行推进与落点', () => {
  it('逐 Tick 沿折线推进，结束回到落地点并广播 finish', () => {
    const player = rider();
    const world = worldOf(player);
    const grid = fakeGrid();
    const sent: Array<{ wsId: number; phase: number }> = [];
    const transport = {
      send: (wsId: number, data: Uint8Array) => {
        const packet = decodeSlideEvent(data);
        if (packet) sent.push({ wsId, phase: packet.phase });
      },
    };

    expect(startRide(player, PARK_SLIDE.id, START)).toBe(true);
    advanceRides(world, grid, transport, START + 100);
    expect(player.pose).toBe(POSE.Sit);
    expect(player.y).toBeGreaterThan(PARK_SLIDE.top.y);
    expect(player.y).toBeLessThan(PARK_SLIDE.landing.y);

    advanceRides(world, grid, transport, START + PARK_SLIDE.rideMs);
    expect(player.x).toBe(PARK_SLIDE.landing.x);
    expect(player.y).toBe(PARK_SLIDE.landing.y);
    expect(player.rideSlide).toBe(0);
    expect(player.pose).toBe(POSE.Idle);
    expect(player.lastMoveAt).toBe(START + PARK_SLIDE.rideMs);
    expect(sent).toEqual([{ wsId: 7, phase: SLIDE_PHASE.Finish }]);
  });

  it('滑行期间客户端 move 被忽略：位置与坐姿只认服务端折线', () => {
    const player = rider();
    expect(startRide(player, PARK_SLIDE.id, START)).toBe(true);
    const rideX = player.x;
    const rideY = player.y;

    const state = packState(DIRECTION.Left, POSE.Walk, true);
    applyMove(
      player,
      { id: 5, x: quantizeCoord(0), y: quantizeCoord(0), state },
      START + 200,
    );

    expect(player.x).toBe(rideX);
    expect(player.y).toBe(rideY);
    expect(player.pose).toBe(POSE.Sit);
    expect(player.moving).toBe(false);
    expect(player.direction).toBe(DIRECTION.Down);
  });

  it('结束时把 lastMoveAt 重置到当前：下一包不会被速度窗口误判成瞬移', () => {
    const player = rider();
    const world = worldOf(player);
    const grid = fakeGrid();
    const transport = { send: () => undefined };
    const end = START + PARK_SLIDE.rideMs;
    expect(startRide(player, PARK_SLIDE.id, START)).toBe(true);
    advanceRides(world, grid, transport, end);
    expect(player.lastMoveAt).toBe(end);

    // 落点向东南走 8px 的正常包应该被完整接受，而不是被截断
    const beforeX = player.x;
    const beforeY = player.y;
    applyMove(
      player,
      { id: 5, x: quantizeCoord(beforeX + 8), y: quantizeCoord(beforeY + 8), state: packState(DIRECTION.Down, POSE.Walk, true) },
      end + 50,
    );
    expect(player.x).toBeCloseTo(beforeX + 8, 1);
    expect(player.y).toBeCloseTo(beforeY + 8, 1);
  });
});
