import { describe, expect, it } from 'bun:test';
import {
  CRITTER_FLEE,
  CRITTER_IDLE,
  CRITTER_WANDER,
  createButterfly,
  createFish,
  createGroundCritter,
  stepButterfly,
  stepFish,
  stepGroundCritter,
  type GroundCritter,
} from '../critter-motion';
import { FRAME_GRAZE, FRAME_IDLE, FRAME_SIT_B, FRAME_WALK_A, FRAME_WALK_B } from '../critter-art';
import { seeded } from '../seeded';

const ALWAYS = () => true;
const NEVER = () => false;

function critterAt(x: number, y: number): GroundCritter {
  return createGroundCritter({
    x,
    y,
    homeX: x,
    homeY: y,
    variant: 0,
    dirX: 1,
    dirY: 0,
  });
}

/** 推进若干毫秒，每帧 16ms，玩家放得很远 */
function advance(c: GroundCritter, ms: number, canStand = ALWAYS): void {
  const random = seeded(0x1234);
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    stepGroundCritter(c, 16, -100000, -100000, random, canStand);
  }
}

describe('地面小动物行为', () => {
  it('待机帧始终是坐姿：抬头 / 抖耳眨眼 / 低头啃草轮转', () => {
    const c = critterAt(1000, 1000);
    const seen = new Set<number>();
    for (let elapsed = 0; elapsed < 8000; elapsed += 16) {
      stepGroundCritter(c, 16, -100000, -100000, seeded(elapsed), ALWAYS);
      if (c.state === CRITTER_IDLE) {
        expect([FRAME_IDLE, FRAME_SIT_B, FRAME_GRAZE]).toContain(c.frame);
        seen.add(c.frame);
      }
    }
    expect(seen.size).toBe(3);
  });

  it('行走 / 逃跑只用站立行走帧', () => {
    const c = critterAt(1000, 1000);
    c.state = CRITTER_WANDER;
    c.stateLeftMs = 5000;
    c.frame = FRAME_WALK_A;
    c.frameLeftMs = 1;
    for (let elapsed = 0; elapsed < 1200; elapsed += 16) {
      stepGroundCritter(c, 16, -100000, -100000, seeded(elapsed), ALWAYS);
      if (c.state !== CRITTER_IDLE) expect([FRAME_WALK_A, FRAME_WALK_B]).toContain(c.frame);
    }
  });

  it('待机超时后进入游走，游走中会真的位移', () => {
    const c = critterAt(1000, 1000);
    expect(c.state).toBe(CRITTER_IDLE);
    advance(c, 1200);
    expect(c.state).toBe(CRITTER_WANDER);
    const beforeX = c.x;
    const beforeY = c.y;
    advance(c, 300);
    expect(Math.abs(c.x - beforeX) + Math.abs(c.y - beforeY)).toBeGreaterThan(0);
  });

  it('玩家靠近时受惊逃跑，方向背离玩家', () => {
    const c = critterAt(1000, 940);
    const random = seeded(7);
    stepGroundCritter(c, 16, 1000, 1000, random, ALWAYS);
    expect(c.state).toBe(CRITTER_FLEE);
    expect(c.dirY).toBeLessThan(0);
    expect(c.cooldownMs).toBeGreaterThan(0);
  });

  it('逃跑结束后回到待机，冷却期内不会被同一个玩家反复触发', () => {
    const c = critterAt(1000, 940);
    const random = seeded(9);
    stepGroundCritter(c, 16, 1000, 1000, random, ALWAYS);
    expect(c.state).toBe(CRITTER_FLEE);
    for (let i = 0; i < 80; i += 1) stepGroundCritter(c, 16, 1000, 1000, random, ALWAYS);
    expect(c.state).toBe(CRITTER_IDLE);
    expect(c.cooldownMs).toBeGreaterThan(0);
  });

  it('前方被挡时会换向，而不是继续顶着障碍走', () => {
    const c = critterAt(500, 500);
    c.state = CRITTER_WANDER;
    c.stateLeftMs = 5000;
    c.dirX = 1;
    c.dirY = 0;
    const random = seeded(11);
    stepGroundCritter(c, 120, -100000, -100000, random, NEVER);
    // 三面都挡时退回待机；否则方向必须改变
    const turned = c.dirX !== 1 || c.dirY !== 0;
    expect(turned || c.state === CRITTER_IDLE).toBe(true);
  });

  it('四面全挡时停在原地，不会穿墙', () => {
    const c = critterAt(500, 500);
    c.state = CRITTER_WANDER;
    c.stateLeftMs = 5000;
    // 探测到期：真实路径里 beginWander 就是带着「本帧该探测」进场的
    c.probeMs = 100;
    const x = c.x;
    const y = c.y;
    for (let i = 0; i < 20; i += 1) {
      stepGroundCritter(c, 16, -100000, -100000, seeded(i), NEVER);
    }
    expect(c.x).toBe(x);
    expect(c.y).toBe(y);
  });

  it('离巢超过 220px 后方向朝巢点回拉', () => {
    const c = critterAt(1000, 1000);
    c.homeX = 1000;
    c.homeY = 1000;
    c.x = 1400;
    c.dirX = 1;
    c.dirY = 0;
    c.state = CRITTER_WANDER;
    c.stateLeftMs = 5000;
    stepGroundCritter(c, 16, -100000, -100000, seeded(3), ALWAYS);
    expect(c.dirX).toBeLessThan(1);
    expect(Math.abs(c.dirY)).toBeLessThan(0.5);
  });

  it('朝向与位移方向一致：横向用侧视，纵向用正/背视', () => {
    const c = critterAt(1000, 1000);
    c.dirX = 1;
    c.dirY = 0;
    c.state = CRITTER_WANDER;
    c.stateLeftMs = 5000;
    stepGroundCritter(c, 16, -100000, -100000, seeded(5), ALWAYS);
    expect(c.view).toBe(1);
    expect(c.flip).toBe(false);

    c.dirX = -1;
    c.dirY = 0;
    stepGroundCritter(c, 16, -100000, -100000, seeded(5), ALWAYS);
    expect(c.flip).toBe(true);

    c.dirX = 0;
    c.dirY = 1;
    stepGroundCritter(c, 16, -100000, -100000, seeded(5), ALWAYS);
    expect(c.view).toBe(0);

    c.dirY = -1;
    stepGroundCritter(c, 16, -100000, -100000, seeded(5), ALWAYS);
    expect(c.view).toBe(2);
  });
});

describe('蝴蝶', () => {
  it('始终落在椭圆轨道上，高度是整数且不为负', () => {
    const b = createButterfly({
      homeX: 2000,
      homeY: 2000,
      variant: 0,
      phase: 0.3,
      radiusX: 40,
      radiusY: 24,
      speed: 0.5,
    });
    for (let i = 0; i < 400; i += 1) {
      stepButterfly(b, 16);
      const dx = (b.x - b.homeX) / b.radiusX;
      const dy = (b.y - b.homeY) / b.radiusY;
      expect(dx * dx + dy * dy).toBeCloseTo(1, 6);
      expect(Number.isInteger(b.height)).toBe(true);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it('振翅帧 90ms 交替一次', () => {
    const b = createButterfly({
      homeX: 0,
      homeY: 0,
      variant: 1,
      phase: 0,
      radiusX: 30,
      radiusY: 20,
      speed: 0.4,
    });
    const first = b.frame;
    stepButterfly(b, 95);
    expect(b.frame).not.toBe(first);
    stepButterfly(b, 95);
    expect(b.frame).toBe(first);
  });
});

describe('小鱼（ADR-0045）', () => {
  const SPAWN = {
    x: 1000,
    y: 1000,
    homeX: 1000,
    homeY: 1000,
    dirX: 1,
    dirY: 0,
    range: 100,
    variant: 1,
    speed: 20,
    phase: 0,
  };

  it('沿切向往返，不越过 ±range', () => {
    const fish = createFish(SPAWN);
    for (let i = 0; i < 1200; i += 1) {
      stepFish(fish, 16);
      expect(Math.abs(fish.travel)).toBeLessThanOrEqual(100.001);
      expect(fish.x).toBeGreaterThanOrEqual(897);
      expect(fish.x).toBeLessThanOrEqual(1103);
      // 侧向摆尾不超过 4px：河宽只有 64，鱼不能摆到岸上
      expect(Math.abs(fish.y - fish.homeY)).toBeLessThanOrEqual(4);
    }
  });

  it('到端点转身，头朝向随之翻转', () => {
    const fish = createFish({ ...SPAWN, speed: 40 });
    expect(fish.heading).toBe(1);
    expect(fish.facesLeft).toBe(false);
    let turned = false;
    for (let i = 0; i < 600; i += 1) {
      stepFish(fish, 16);
      if (fish.heading === -1) {
        turned = true;
        break;
      }
    }
    expect(turned).toBe(true);
    expect(fish.facesLeft).toBe(true);

    // 再走回另一端，朝向恢复
    for (let i = 0; i < 1200; i += 1) {
      stepFish(fish, 16);
      if (fish.heading === 1) break;
    }
    expect(fish.heading).toBe(1);
    expect(fish.facesLeft).toBe(false);
  });

  it('尾摆帧 140ms 交替一次', () => {
    const fish = createFish(SPAWN);
    const first = fish.frame;
    stepFish(fish, 145);
    expect(fish.frame).not.toBe(first);
    stepFish(fish, 145);
    expect(fish.frame).toBe(first);
  });
});
