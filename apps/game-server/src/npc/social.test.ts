import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, DIRECTION, POSE } from '@niuma/shared-types';
import { createAgent, type NpcAgent } from './brain';
import { DEFAULT_NPC_CONFIG } from './config';
import { createRng } from './rng';
import { updateSocial, type NpcSocialContext } from './social';
import { World } from '../sim/world';

const NOW = 1_700_000_000_000;

interface Harness {
  world: World;
  agent: NpcAgent;
  context: NpcSocialContext;
}

function makeHarness(seed = 1, humanDistance = 60): Harness {
  const world = new World();
  const npc = world.createNpc('同事', DEFAULT_APPEARANCE.cow, 4096, 4096, '', NOW)!;
  const human = world.create('真人', DEFAULT_APPEARANCE.cow, 7, 4096 + humanDistance, 4096, '', NOW)!;
  npc.known.add(human.id);
  human.known.add(npc.id);

  const context: NpcSocialContext = {
    world,
    config: DEFAULT_NPC_CONFIG,
    rng: createRng(seed),
  };
  const agent = createAgent(createRng(seed), npc, 0.8, DEFAULT_NPC_CONFIG, NOW);
  return { world, agent, context };
}

describe('对视与让路', () => {
  it('停顿中有人靠近会转头看过去', () => {
    const { agent, context } = makeHarness(2);
    agent.phase = 'pause';
    for (let index = 0; index < 20; index += 1) {
      agent.nextSocialAt = NOW;
      updateSocial(agent, context, NOW + index * 10);
    }
    // 真人在东侧：反复社交后朝向至少对上一次
    expect(agent.player.direction).toBe(DIRECTION.Right);
  });

  it('迎面撞上时停下让路，姿态回到站立', () => {
    const { agent, context } = makeHarness(3);
    agent.phase = 'walk';
    agent.player.applyState(DIRECTION.Left, POSE.Walk, true);

    let yielded = false;
    for (let index = 0; index < 60; index += 1) {
      agent.phase = 'walk';
      agent.nextSocialAt = NOW;
      updateSocial(agent, context, NOW + index * 10);
      // updateSocial 会在让路时改写 phase；用断言避开 TS 对上一行赋值的窄化
      const phase = agent.phase as NpcAgent['phase'];
      if (phase === 'pause') {
        yielded = true;
        break;
      }
    }
    expect(yielded).toBe(true);
    expect(agent.player.pose).toBe(POSE.Idle);
    expect(agent.player.moving).toBe(false);
  });

  it('远处的人不触发让路或招手', () => {
    const { agent, context } = makeHarness(4, 900);
    agent.phase = 'walk';
    for (let index = 0; index < 40; index += 1) {
      agent.nextSocialAt = NOW;
      updateSocial(agent, context, NOW + index * 10);
    }
    expect(agent.phase).toBe('walk');
  });

  it('关掉互动开关后不再对视或让路', () => {
    const { agent, context } = makeHarness(7);
    const quiet: NpcSocialContext = { ...context, config: { ...context.config, interact: false } };
    agent.phase = 'walk';
    for (let index = 0; index < 40; index += 1) {
      agent.nextSocialAt = NOW;
      updateSocial(agent, quiet, NOW + index * 10);
    }
    expect(agent.phase).toBe('walk');
  });
});
