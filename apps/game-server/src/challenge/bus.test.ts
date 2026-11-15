import { P2P_GAME_TYPE, P2P_INVITE_REASON, P2P_INVITE_TTL_MS } from '@niuma/shared-types';
import { describe, expect, it } from 'bun:test';
import { EconomyService } from '../economy/service';
import { Player } from '../sim/world';
import { ChallengeBus } from './bus';
import { duelHandler } from './handlers/duel';

function makePlayer(id: number, coins: number, x = 100, y = 100): Player {
  const player = new Player();
  player.id = id;
  player.wsId = id;
  player.name = `p${id}`;
  player.x = x;
  player.y = y;
  player.coins = coins;
  return player;
}

function setup(random = () => 0.2) {
  const a = makePlayer(1, 100);
  const b = makePlayer(2, 100, 120, 100);
  const c = makePlayer(3, 100, 900, 100);
  const players = new Map([
    [a.id, a],
    [b.id, b],
    [c.id, c],
  ]);
  const sent: Array<{ wsId: number; packet: Uint8Array }> = [];
  const economy = new EconomyService((wsId, packet) => sent.push({ wsId, packet }));
  const bus = new ChallengeBus({
    send: (player, packet) => sent.push({ wsId: player.wsId, packet }),
    economy,
    findPlayer: (id) => players.get(id),
    random,
  });
  bus.register(duelHandler);
  return { a, b, c, bus, economy, sent };
}

describe('ChallengeBus', () => {
  it('接受后冻结双方赌注，赢家拿走税后奖池', () => {
    const { a, b, bus } = setup();
    expect(bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000)).toBe(
      P2P_INVITE_REASON.None,
    );
    expect(a.coins).toBe(100);
    bus.respond(b, { inviteId: b.pendingInviteId, accept: true }, 1010);
    expect(a.coins).toBe(80);
    expect(b.coins).toBe(80);
    expect(a.busyMatchId).toBeGreaterThan(0);
    // 切磋靠剩余血量决胜：100 HP、每下 12 伤害，连打 9 下把 b 打空
    for (let hit = 0; hit < 9; hit += 1) {
      bus.duelPort.hit(a, b, 1020 + hit);
    }
    // 奖池 40 抽 5% 园区税：赢家只拿回 38
    expect(a.coins).toBe(80 + 38);
    expect(b.coins).toBe(80);
    expect(a.busyMatchId).toBe(0);
    expect(b.busyMatchId).toBe(0);
  });

  it('打满全场仍平分秋色时按平局全额退款', () => {
    const { a, b, bus } = setup();
    bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000);
    bus.respond(b, { inviteId: b.pendingInviteId, accept: true }, 1010);
    // 谁也不挨打：到点按剩余血量裁决，同分判平，托管原路退回
    bus.tick(1010 + duelHandler.durationMs);
    expect(a.coins).toBe(100);
    expect(b.coins).toBe(100);
    expect(a.busyMatchId).toBe(0);
    expect(b.busyMatchId).toBe(0);
  });

  it('拒绝只清状态，不动余额', () => {
    const { a, b, bus } = setup();
    bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000);
    bus.respond(b, { inviteId: b.pendingInviteId, accept: false }, 1010);
    expect(a.pendingInviteId).toBe(0);
    expect(b.pendingInviteId).toBe(0);
    expect(a.coins).toBe(100);
    expect(b.coins).toBe(100);
    expect(bus.activeCount).toBe(0);
  });

  it('15 秒未回应自动过期并清空忙碌', () => {
    const { a, b, bus } = setup();
    bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000);
    bus.tick(1000 + P2P_INVITE_TTL_MS);
    expect(bus.pendingCount).toBe(0);
    expect(a.pendingInviteId).toBe(0);
    expect(b.pendingInviteId).toBe(0);
  });

  it('对局中掉线按对手获胜结算，双方不再忙碌', () => {
    const { a, b, bus } = setup();
    bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000);
    bus.respond(b, { inviteId: b.pendingInviteId, accept: true }, 1010);
    bus.onDisconnect(a, 1200);
    // 对手掉线判胜同样只派奖池的 95%：80 + 38
    expect(b.coins).toBe(118);
    expect(a.coins).toBe(80);
    expect(bus.activeCount).toBe(0);
    expect(b.busyMatchId).toBe(0);
  });

  it('忙碌与超距在邀请阶段就被拒绝', () => {
    const { a, b, c, bus } = setup();
    expect(bus.invite(a, { targetId: c.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000)).toBe(
      P2P_INVITE_REASON.OutOfRange,
    );
    expect(a.pendingInviteId).toBe(0);
    expect(bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000)).toBe(
      P2P_INVITE_REASON.None,
    );
    // 同一个发起方在 pending 期间再发：Busy
    expect(bus.invite(a, { targetId: c.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1010)).toBe(
      P2P_INVITE_REASON.Busy,
    );
  });
});
