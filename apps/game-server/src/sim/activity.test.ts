import { describe, expect, it } from 'bun:test';
import {
  ACTIVITY_KIND,
  DEFAULT_APPEARANCE,
  OpCode,
  decodeActivity,
  type ActivityPacket,
} from '@niuma/shared-types';
import { ActivityHub } from './activity';
import type { Transport } from './view';
import { World, type Player } from './world';

interface Harness {
  world: World;
  hub: ActivityHub;
  actor: Player;
  sent: Array<{ wsId: number; packet: ActivityPacket }>;
}

function setup(): Harness {
  const world = new World();
  const sent: Array<{ wsId: number; packet: ActivityPacket }> = [];
  const transport: Transport = {
    send: (wsId, data) => {
      if (data[0] !== OpCode.S2C_ACTIVITY) return;
      sent.push({ wsId, packet: decodeActivity(data) });
    },
  };
  const hub = new ActivityHub(world, transport, 1_000);
  const actor = world.create('阿牛', DEFAULT_APPEARANCE.cow, 11, 4116, 2048)!;
  return { world, hub, actor, sent };
}

function addViewer(world: World, name: string, wsId: number, knownActorId?: number): Player {
  const viewer = world.create(name, DEFAULT_APPEARANCE.cow, wsId, 4116, 2048)!;
  if (knownActorId !== undefined) viewer.known.add(knownActorId);
  return viewer;
}

describe('ActivityHub 送达范围', () => {
  it('看不见主角的远端玩家收到播报，AOI 内的旁观者不重复收到', () => {
    const env = setup();
    addViewer(env.world, '近', 12, env.actor.id);
    addViewer(env.world, '远', 13);

    env.hub.emit(ACTIVITY_KIND.VentKnockdown, env.actor.id, 2_000);
    expect(env.sent.map((entry) => entry.wsId)).toEqual([13]);
  });

  it('生活类演出身边人也收：气泡只在本机播放，AOI 内看不到', () => {
    const env = setup();
    addViewer(env.world, '近', 12, env.actor.id);
    env.hub.emit(ACTIVITY_KIND.Tea, env.actor.id, 2_000);
    expect(env.sent).toHaveLength(1);
  });

  it('本人不收到自己的播报，NPC（wsId=0）也不占下行带宽', () => {
    const env = setup();
    addViewer(env.world, 'npc', 0);
    env.hub.emit(ACTIVITY_KIND.Sit, env.actor.id, 2_000);
    expect(env.sent).toHaveLength(0);
  });

  it('主角已离场时静默跳过，不 throw', () => {
    const env = setup();
    env.hub.emit(ACTIVITY_KIND.BossDown, 9_999, 2_000);
    expect(env.sent).toHaveLength(0);
  });
});

describe('ActivityHub 去重与限流', () => {
  it('同一主角同一事件在窗口内只发一次', () => {
    const env = setup();
    addViewer(env.world, '远', 13);
    env.hub.emit(ACTIVITY_KIND.VentKnockdown, env.actor.id, 2_000);
    env.hub.emit(ACTIVITY_KIND.VentKnockdown, env.actor.id, 2_200);
    expect(env.sent).toHaveLength(1);
    env.hub.emit(ACTIVITY_KIND.VentKnockdown, env.actor.id, 2_600);
    expect(env.sent).toHaveLength(2);
  });

  it('常规动作的窗口比生活类更长：坐下不会连着刷屏', () => {
    const env = setup();
    addViewer(env.world, '远', 13);
    env.hub.emit(ACTIVITY_KIND.Sit, env.actor.id, 2_000);
    env.hub.emit(ACTIVITY_KIND.Sit, env.actor.id, 3_000);
    expect(env.sent).toHaveLength(1);
  });

  it('令牌桶打空后只丢常规事件，强演出照发', () => {
    const env = setup();
    addViewer(env.world, '远', 13);
    // 40 名不同主角各发一条常规事件：桶容量 40，第 41 条必须被丢掉。
    // 主角一律 wsId=0，否则他们互相也是接收者，计数就不是「一条事件一包」了
    for (let index = 0; index < 41; index += 1) {
      const actor = env.world.create(`牛马${index}`, DEFAULT_APPEARANCE.cow, 0, 4116, 2048)!;
      env.hub.emit(ACTIVITY_KIND.Sit, actor.id, 2_000);
    }
    // setup 里的主角阿牛也是在线玩家，会收到别人的播报；只数发给「远」的那一份
    expect(env.sent.filter((entry) => entry.wsId === 13)).toHaveLength(40);
    env.hub.emit(ACTIVITY_KIND.GuardJailed, env.actor.id, 2_000);
    expect(env.sent.filter((entry) => entry.wsId === 13)).toHaveLength(41);
  });
});

describe('ActivityHub 客户端上报', () => {
  it('白名单内的事件接受并转发；权威事件不允许伪造', () => {
    const env = setup();
    addViewer(env.world, '远', 13);
    expect(env.hub.report(env.actor, ACTIVITY_KIND.Incense, 2_000)).toBe(true);
    expect(env.sent).toHaveLength(1);
    expect(env.hub.report(env.actor, ACTIVITY_KIND.BossDown, 2_100)).toBe(false);
    expect(env.sent).toHaveLength(1);
  });

  it('每秒只收一条上报，连按设施也只播一次', () => {
    const env = setup();
    addViewer(env.world, '远', 13);
    expect(env.hub.report(env.actor, ACTIVITY_KIND.Coffee, 2_000)).toBe(true);
    expect(env.hub.report(env.actor, ACTIVITY_KIND.Coffee, 2_400)).toBe(false);
    expect(env.hub.report(env.actor, ACTIVITY_KIND.Coffee, 3_100)).toBe(true);
  });

  it('离场后清掉去重记录：id 复用不会吞掉新玩家第一条', () => {
    const env = setup();
    addViewer(env.world, '远', 13);
    env.hub.emit(ACTIVITY_KIND.Sit, env.actor.id, 2_000);
    env.hub.forget(env.actor.id);
    env.hub.emit(ACTIVITY_KIND.Sit, env.actor.id, 2_100);
    expect(env.sent).toHaveLength(2);
  });
});
