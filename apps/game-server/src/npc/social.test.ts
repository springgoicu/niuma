import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, DIRECTION, POSE, decodeChatBroadcast } from '@niuma/shared-types';
import { createAgent, type NpcAgent } from './brain';
import { DEFAULT_NPC_CONFIG } from './config';
import { createRng } from './rng';
import { updateSocial, type NpcSocialContext } from './social';
import { NPC_REGIONS } from './spots';
import { ChatHistory } from '../sim/history';
import { World } from '../sim/world';

const NOW = 1_700_000_000_000;

interface Harness {
  world: World;
  agent: NpcAgent;
  humanWsId: number;
  packets: Array<{ wsId: number; data: Uint8Array }>;
  history: ChatHistory;
  context: NpcSocialContext;
}

function makeHarness(seed = 1, humanDistance = 60): Harness {
  const world = new World();
  const npc = world.createNpc('同事', DEFAULT_APPEARANCE.cow, 4096, 4096, '', NOW)!;
  const human = world.create('真人', DEFAULT_APPEARANCE.cow, 7, 4096 + humanDistance, 4096, '', NOW)!;
  npc.known.add(human.id);
  human.known.add(npc.id);

  const packets: Array<{ wsId: number; data: Uint8Array }> = [];
  const history = new ChatHistory(20, 60_000);
  const context: NpcSocialContext = {
    world,
    transport: {
      send(wsId, data) {
        packets.push({ wsId, data });
      },
    },
    history,
    config: DEFAULT_NPC_CONFIG,
    rng: createRng(seed),
    chatLines: [],
  };
  const agent = createAgent(createRng(seed), npc, NPC_REGIONS[0]!, 0.8, 3, DEFAULT_NPC_CONFIG, NOW);
  return { world, agent, humanWsId: human.wsId, packets, history, context };
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
});

describe('低频发言', () => {
  it('到点且附近有人时发一条，进入历史并广播给可见的人', () => {
    const { agent, context, history, packets, humanWsId } = makeHarness(5);
    agent.nextChatAt = NOW;
    agent.nextSocialAt = NOW;
    updateSocial(agent, context, NOW);

    const page = history.latestPage(10, NOW);
    expect(page.lines.length).toBe(1);
    const line = page.lines[0]!;
    expect(line.entityId).toBe(agent.player.id);
    expect(line.name).toBe('同事');
    expect(line.text.length).toBeGreaterThan(0);

    const chatPackets = packets.filter((packet) => packet.data[0] === 0x04);
    expect(chatPackets.length).toBeGreaterThan(0);
    expect(chatPackets.some((packet) => packet.wsId === humanWsId)).toBe(true);
    const decoded = decodeChatBroadcast(chatPackets[0]!.data);
    expect(decoded.entityId).toBe(agent.player.id);
    expect(decoded.text).toBe(line.text);
    // 下一次发言被推后到分钟级，不会每 500ms 刷一句
    expect(agent.nextChatAt).toBeGreaterThan(NOW + 60_000);
  });

  it('附近没人时不自言自语，只把检查时间推后', () => {
    const { agent, context, history } = makeHarness(6);
    agent.player.known.clear();
    agent.nextChatAt = NOW;
    agent.nextSocialAt = NOW;
    updateSocial(agent, context, NOW);

    expect(history.latestPage(10, NOW).lines.length).toBe(0);
    expect(agent.nextChatAt).toBeGreaterThanOrEqual(NOW + 30_000);
    expect(agent.nextChatAt).toBeLessThanOrEqual(NOW + 60_000);
  });

  it('关掉发言开关后一句话都不说', () => {
    const { agent, context, history } = makeHarness(7);
    const quiet: NpcSocialContext = { ...context, config: { ...context.config, chat: false } };
    agent.nextChatAt = NOW;
    for (let index = 0; index < 20; index += 1) {
      agent.nextSocialAt = NOW;
      updateSocial(agent, quiet, NOW + index * 10);
    }
    expect(history.latestPage(10, NOW).lines.length).toBe(0);
  });

  it('外置台词池优先于内置池', () => {
    const { agent, context, history } = makeHarness(8);
    const custom: NpcSocialContext = { ...context, chatLines: ['这是一句外置台词'] };
    agent.nextChatAt = NOW;
    agent.nextSocialAt = NOW;
    updateSocial(agent, custom, NOW);
    expect(history.latestPage(10, NOW).lines[0]?.text).toBe('这是一句外置台词');
  });
});
