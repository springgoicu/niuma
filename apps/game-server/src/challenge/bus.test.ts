import { P2P_GAME_TYPE, P2P_INVITE_REASON, P2P_INVITE_TTL_MS } from '@niuma/shared-types';
import { describe, expect, it } from 'vitest';
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
  it('接受后冻结双方赌注，赢家拿走两份', () => {
    const { a, b, bus } = setup();
    expect(bus.invite(a, { targetId: b.id, gameType: P2P_GAME_TYPE.Duel, wager: 20, extra: 0 }, 1000)).toBe(
      P2P_INVITE_REASON.None,
    );
    expect(a.coins).toBe(100);
    bus.respond(b, { inviteId: b.pendingInviteId, accept: true }, 1010);
    expect(a.coins).toBe(80);
    expect(b.coins).toBe(80);
    expect(a.busyMatchId).toBeGreaterThan(0);
    bus.tick(1010 + duelHandler.durationMs);
    // random 固定偏向 a，因此 a 拿到 40 币奖池
    expect(a.coins).toBe(120);
    expect(b.coins).toBe(80);
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
    expect(b.coins).toBe(120);
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
