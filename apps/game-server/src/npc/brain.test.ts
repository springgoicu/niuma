import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  MOVE_SPEED,
  PLAYER_RADIUS,
  POSE,
  TICK_MS,
  WORLD_LAYOUT,
  findFreePoint,
  isBlocked,
  unpackState,
} from '@niuma/shared-types';
import { DEFAULT_NPC_CONFIG } from './config';
import {
  createAgent,
  pickPauseMs,
  startWave,
  updateAgent,
  type NpcAgent,
} from './brain';
import { createRng } from './rng';
import { pickSpawnPoint } from './spots';
import { World } from '../sim/world';

const NOW = 1_700_000_000_000;

function makeAgent(seed: number): { agent: NpcAgent; rng: ReturnType<typeof createRng> } {
  const world = new World();
  const rng = createRng(seed);
  const spawn = pickSpawnPoint(rng);
  const player = world.createNpc('测试同事', DEFAULT_APPEARANCE.cow, spawn.x, spawn.y, '', NOW)!;
  return { agent: createAgent(rng, player, 0.8, DEFAULT_NPC_CONFIG, NOW), rng };
}

describe('停顿时长', () => {
  it('落在三档区间内，长停约占两成', () => {
    const rng = createRng(8);
    let long = 0;
    for (let index = 0; index < 2_000; index += 1) {
      const ms = pickPauseMs(rng, DEFAULT_NPC_CONFIG);
      const inShort = ms >= 1_200 && ms <= 3_000;
      const inNormal = ms >= 3_000 && ms <= 12_000;
      const inLong = ms >= 20_000 && ms <= 60_000;
      expect(inShort || inNormal || inLong).toBe(true);
      if (inLong) long += 1;
    }
    expect(long).toBeGreaterThan(300);
    expect(long).toBeLessThan(500);
  });
});

describe('走走停停', () => {
  it('行走每 Tick 的位移不超过步速 × 帧长，且不会穿进障碍', () => {
    const { agent, rng } = makeAgent(2);
    agent.phase = 'walk';
    const step = agent.speed * (TICK_MS / 1000);
    expect(agent.speed).toBeLessThanOrEqual(MOVE_SPEED);

    for (let index = 0; index < 400; index += 1) {
      const beforeX = agent.player.x;
      const beforeY = agent.player.y;
      updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + index * TICK_MS);
      if (agent.phase !== 'walk') break;
      const moved = Math.hypot(agent.player.x - beforeX, agent.player.y - beforeY);
      expect(moved).toBeLessThanOrEqual(step + 0.5);
      expect(isBlocked(agent.player.x, agent.player.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it('连续跑 2000 Tick 不越界、不产生 NaN、不卡死在同一处', () => {
    const { agent, rng } = makeAgent(3);
    const start = { x: agent.player.x, y: agent.player.y };
    let travelled = 0;
    let previous = { x: start.x, y: start.y };

    for (let index = 0; index < 2_000; index += 1) {
      updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + index * TICK_MS);
      const { x, y } = agent.player;
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(isBlocked(x, y, PLAYER_RADIUS)).toBe(false);
      travelled += Math.hypot(x - previous.x, y - previous.y);
      previous = { x, y };
    }

    // 100 秒里至少走过 100px：证明状态机没有在第一帧就停住
    expect(travelled).toBeGreaterThan(100);
  });

  it('撞进死角会换路点，不会永远贴在墙上', () => {
    const { agent, rng } = makeAgent(4);
    const solid = WORLD_LAYOUT.solids.find((entry) => entry.w >= 40 && entry.h >= 40);
    expect(solid).toBeDefined();
    const wallX = solid!.x + solid!.w / 2;
    const wallY = solid!.y + solid!.h / 2;
    expect(isBlocked(wallX, wallY, PLAYER_RADIUS)).toBe(true);

    const start = findFreePoint(wallX, wallY + 220, PLAYER_RADIUS, true);
    agent.player.x = start.x;
    agent.player.y = start.y;
    agent.phase = 'walk';
    agent.target = { x: wallX, y: wallY };
    agent.lastProgressAt = NOW;
    agent.lastProgressX = start.x;
    agent.lastProgressY = start.y;
    agent.stuckCount = 0;

    let maxDistance = 0;
    for (let index = 0; index < 2_400; index += 1) {
      updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + index * TICK_MS);
      maxDistance = Math.max(maxDistance, Math.hypot(agent.player.x - start.x, agent.player.y - start.y));
      expect(isBlocked(agent.player.x, agent.player.y, PLAYER_RADIUS)).toBe(false);
    }
    // 卡住两次后必须换点：2 分钟内至少离开原位 40px
    expect(maxDistance).toBeGreaterThan(40);
  });

  it('停顿时会换视线方向：站着也不是雕像', () => {
    const { agent, rng } = makeAgent(6);
    agent.phase = 'pause';
    agent.pauseUntil = NOW + 20_000;
    agent.lookAt = NOW;
    const directions = new Set<number>();
    for (let index = 0; index < 200; index += 1) {
      updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + index * TICK_MS);
      directions.add(agent.player.direction);
    }
    expect(directions.size).toBeGreaterThan(1);
  });
});

describe('受击与挥手', () => {
  it('硬直期间保持躺姿且不移动，结束后自己站起来', () => {
    const { agent, rng } = makeAgent(5);
    const { player } = agent;
    player.applyState(player.direction, POSE.Lie, false);
    player.stunUntil = NOW + 1_500;
    const x = player.x;
    const y = player.y;

    updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + 50);
    expect(player.x).toBe(x);
    expect(player.y).toBe(y);
    expect(player.pose).toBe(POSE.Lie);

    updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + 1_600);
    expect(player.pose).toBe(POSE.Idle);
    expect(agent.phase).toBe('pause');
  });

  it('昏迷期间硬直结束也不起身，等救护车归位（ADR-0106）', () => {
    const { agent, rng } = makeAgent(5);
    const { player } = agent;
    player.applyState(player.direction, POSE.Lie, false);
    player.stunUntil = NOW + 1_500;
    player.incapacitated = true;

    updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + 1_600);

    expect(player.pose).toBe(POSE.Lie);
    expect(player.incapacitated).toBe(true);
  });

  it('挥手位约 1 秒后由服务端清掉，不会吞掉后续动作', () => {
    const { agent, rng } = makeAgent(7);
    startWave(agent, NOW);
    expect(unpackState(agent.player.state).wave).toBe(true);

    updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + 500);
    expect(unpackState(agent.player.state).wave).toBe(true);

    updateAgent(agent, rng, DEFAULT_NPC_CONFIG, NOW + 1_000);
    expect(unpackState(agent.player.state).wave).toBe(false);
  });
});
