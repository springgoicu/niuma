import { describe, expect, it } from 'bun:test';
import {
  DICE_BET_MS,
  DICE_HALL_SEAT_IDS,
  DICE_MIN_BET,
  DICE_REVEAL_MS,
  DICE_ROLL_MS,
  DICE_SIDE,
  DICE_TABLES,
  seatById,
} from '@niuma/shared-types';
import { DiceHallRuntime, type DiceHallPorts } from './dice-hall';
import { DiceLedger } from './dice-ledger';
import { World, type Player } from './world';

/** 某张桌第 skip 个凳子：按座位组筛，避免手写座位 id */
function stoolOf(group: string, skip = 0): number {
  const stools = DICE_HALL_SEAT_IDS.filter((id) => seatById(id)?.group === group);
  if (stools.length <= skip) throw new Error(`没有 ${group} 的第 ${skip} 个凳子`);
  return stools[skip]!;
}

interface PortsLog {
  frozen: number[];
  cleared: string[];
  paid: Array<{ key: string; amount: number }>;
  refunded: string[];
}

/** 经济端口的测试替身：`payout` 必须把**真实入账**返回，结算单以它为准 */
function ports(): { log: PortsLog; ports: DiceHallPorts } {
  const log: PortsLog = { frozen: [], cleared: [], paid: [], refunded: [] };
  return {
    log,
    ports: {
      freeze: (_player, _key, amount) => {
        log.frozen.push(amount);
        return true;
      },
      clear: (_player, key) => {
        log.cleared.push(key);
      },
      payout: (_player, key, amount) => {
        log.paid.push({ key, amount });
        return amount;
      },
      refund: (_player, key) => {
        log.refunded.push(key);
      },
    },
  };
}

function setup(randomValues: number[] = []) {
  const ledger = new DiceLedger();
  const { log, ports: stub } = ports();
  let cursor = 0;
  const dice = new DiceHallRuntime(stub, 0, () => randomValues[cursor++] ?? 0, ledger);
  const world = new World();
  return { dice, log, ledger, world };
}

/** 把玩家放到桌心、坐进指定座位；seat 传 0 表示站着 */
function putPlayer(world: World, tableId: number, seat: number, name = '牛马'): Player {
  const table = DICE_TABLES.find((item) => item.id === tableId)!;
  const player = world.create(name, { species: 'cow' } as never, 0, table.x, table.y);
  if (!player) throw new Error('spawn failed');
  player.name = name;
  player.seat = seat;
  return player;
}

describe('DiceHallRuntime 入座门（ADR-0093）', () => {
  it('站着不能下注，也不冻结任何钱', () => {
    const { dice, log, world } = setup();
    const player = putPlayer(world, 0, 0);
    expect(dice.placeBet(player, 0, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
    expect(log.frozen).toHaveLength(0);
  });

  it('坐在本桌凳子上才能下注', () => {
    const { dice, log, world } = setup();
    const table = DICE_TABLES[0]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    expect(dice.placeBet(player, table.id, DICE_SIDE.Small, DICE_MIN_BET, 0)).toBe(true);
    expect(log.frozen).toEqual([DICE_MIN_BET]);
    // 本局只能押一次
    expect(dice.placeBet(player, table.id, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
  });

  it('坐在另一桌的凳子上押不了这一桌', () => {
    const { dice, log, world } = setup();
    const [a, b] = DICE_TABLES;
    const player = putPlayer(world, a!.id, stoolOf(b!.group));
    expect(dice.placeBet(player, a!.id, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
    expect(log.frozen).toHaveLength(0);
  });

  it('坐着但离桌太远仍被距离门拦下', () => {
    const { dice, log, world } = setup();
    const table = DICE_TABLES[0]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    player.x = table.x + 400;
    player.y = table.y;
    expect(dice.placeBet(player, table.id, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
    expect(log.frozen).toHaveLength(0);
  });

  it('下注窗口关闭后，坐着也押不了', () => {
    const { dice, log, world } = setup();
    const table = DICE_TABLES[1]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    expect(dice.placeBet(player, table.id, DICE_SIDE.Leopard, DICE_MIN_BET, DICE_BET_MS)).toBe(false);
    expect(log.frozen).toHaveLength(0);
  });
});

describe('赌桌随机与亮牌门禁（ADR-0104）', () => {
  it('骰面来自注入的随机源，投注期与摇骰期都不下发点数', () => {
    const { dice, log, world } = setup([0, 0, 0, 0.9]);
    const table = DICE_TABLES[0]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    expect(dice.placeBet(player, table.id, DICE_SIDE.Leopard, DICE_MIN_BET, 0)).toBe(true);
    expect(log.frozen[0]).toBe(DICE_MIN_BET);

    // 投注期：快照不带点数
    expect(dice.snapshot(player, 0)[0]!.dice).toEqual([0, 0, 0]);
    // 进入 Rolling：骰面已经摇出，但仍不下发
    dice.tick(DICE_BET_MS, world);
    expect(dice.table(table.id)?.phase).toBe(2);
    expect(dice.snapshot(player, DICE_BET_MS)[0]!.dice).toEqual([0, 0, 0]);
    expect(dice.snapshot(player, DICE_BET_MS)[0]!.raid).toBe(false);

    // 进入 Reveal：三点豹子亮牌
    dice.tick(DICE_BET_MS + DICE_ROLL_MS, world);
    expect(dice.snapshot(player, DICE_BET_MS + DICE_ROLL_MS)[0]!.dice).toEqual([1, 1, 1]);
  });
});

describe('赌桌结算单（ADR-0110）', () => {
  const WINNER_DEVICE = 'aaaaaaaaaaaaaaaa';
  const LOSER_DEVICE = 'bbbbbbbbbbbbbbbb';

  function seatTwo(world: World, tableId: number): [Player, Player] {
    const table = DICE_TABLES.find((item) => item.id === tableId)!;
    const winner = putPlayer(world, tableId, stoolOf(table.group, 0), '摸鱼王');
    winner.deviceId = WINNER_DEVICE;
    const loser = putPlayer(world, tableId, stoolOf(table.group, 1), '划水牛');
    loser.deviceId = LOSER_DEVICE;
    return [winner, loser];
  }

  it('赢家按真实入账减本金，输家记负本金，同一包按设备标出「我」', () => {
    const { dice, ledger, world, log } = setup([0.5, 0.7, 0.9, 0.9]); // 4 5 6 → 大
    const [winner, loser] = seatTwo(world, 0);
    expect(dice.placeBet(winner, 0, DICE_SIDE.Big, 100, 0)).toBe(true);
    expect(dice.placeBet(loser, 0, DICE_SIDE.Small, 100, 0)).toBe(true);

    dice.tick(DICE_BET_MS, world);
    const settled = dice.tick(DICE_BET_MS + DICE_ROLL_MS, world);
    // 两张桌同时进入亮牌：空桌也会留一条「没人下注」的结算
    expect(settled.settled).toContain(0);
    expect(log.paid[0]!.amount).toBe(200);

    const round = ledger.lastRound(0)!;
    expect(round.hit).toBe(DICE_SIDE.Big);
    expect(round.entries).toHaveLength(2);
    const winRow = round.entries.find((entry) => entry.deviceId === WINNER_DEVICE)!;
    const loseRow = round.entries.find((entry) => entry.deviceId === LOSER_DEVICE)!;
    expect(winRow).toMatchObject({ bet: 100, payout: 200, net: 100, refunded: false });
    expect(loseRow).toMatchObject({ bet: 100, payout: 0, net: -100, refunded: false });

    const forWinner = dice.resultFor(winner, 0)!;
    expect(forWinner.entries.map((entry) => entry.self)).toEqual([true, false]);
    const forLoser = dice.resultFor(loser, 0)!;
    expect(forLoser.entries.map((entry) => entry.self)).toEqual([false, true]);
  });

  it('保安查岗照常抽水，结算单显示抽水后的到手而不是理论派彩', () => {
    const { dice, ledger, world } = setup([0.5, 0.7, 0.9, 0.01]); // 4 5 6，查岗命中
    const [winner, loser] = seatTwo(world, 0);
    dice.placeBet(winner, 0, DICE_SIDE.Big, 100, 0);
    dice.placeBet(loser, 0, DICE_SIDE.Small, 100, 0);
    dice.tick(DICE_BET_MS, world);
    dice.tick(DICE_BET_MS + DICE_ROLL_MS, world);
    const row = ledger.lastRound(0)!.entries.find((entry) => entry.deviceId === WINNER_DEVICE)!;
    expect(row.payout).toBe(190);
    expect(row.net).toBe(90);
  });

  it('命中档没人押：全员退款，净额记 0 而不是输光', () => {
    const { dice, ledger, world, log } = setup([0.5, 0.7, 0.9, 0.9]); // 大
    const [winner, loser] = seatTwo(world, 0);
    dice.placeBet(winner, 0, DICE_SIDE.Leopard, 50, 0);
    dice.placeBet(loser, 0, DICE_SIDE.Small, 50, 0);
    dice.tick(DICE_BET_MS, world);
    dice.tick(DICE_BET_MS + DICE_ROLL_MS, world);
    const round = ledger.lastRound(0)!;
    expect(round.hit).toBe(-1);
    expect(round.entries.every((entry) => entry.refunded && entry.net === 0)).toBe(true);
    expect(log.refunded).toHaveLength(2);
    expect(log.paid).toHaveLength(0);
  });

  it('无人下注也留一条空结算，面板能说「本局没人下注」', () => {
    const { dice, ledger, world } = setup([0.5, 0.7, 0.9, 0.9]);
    dice.tick(DICE_BET_MS, world);
    dice.tick(DICE_BET_MS + DICE_ROLL_MS, world);
    expect(ledger.lastRound(0)).toMatchObject({ roundId: 1, hit: -1, entries: [] });
    expect(dice.resultFor(putPlayer(world, 0, 0), 0)!.entries).toHaveLength(0);
  });

  it('下一局开始后仍能补看上一局，直到新一局结算覆盖它', () => {
    const { dice, ledger, world } = setup([0.5, 0.7, 0.9, 0.9]);
    const [winner, loser] = seatTwo(world, 0);
    dice.placeBet(winner, 0, DICE_SIDE.Big, 10, 0);
    dice.placeBet(loser, 0, DICE_SIDE.Small, 10, 0);
    dice.tick(DICE_BET_MS, world);
    dice.tick(DICE_BET_MS + DICE_ROLL_MS, world);
    dice.tick(DICE_BET_MS + DICE_ROLL_MS + DICE_REVEAL_MS, world);
    expect(ledger.lastRound(0)!.roundId).toBe(1);
    expect(dice.resultFor(winner, 0)!.entries[0]!.self).toBe(true);
  });
});
