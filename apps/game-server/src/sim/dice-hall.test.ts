import { describe, expect, it } from 'bun:test';
import {
  DICE_BET_MS,
  DICE_HALL_SEAT_IDS,
  DICE_MIN_BET,
  DICE_SIDE,
  DICE_TABLES,
  seatById,
} from '@niuma/shared-types';
import { DiceHallRuntime } from './dice-hall';
import { World, type Player } from './world';

/** 某张桌第 skip 个凳子：按座位组筛，避免手写座位 id */
function stoolOf(group: string, skip = 0): number {
  const stools = DICE_HALL_SEAT_IDS.filter((id) => seatById(id)?.group === group);
  if (stools.length <= skip) throw new Error(`没有 ${group} 的第 ${skip} 个凳子`);
  return stools[skip]!;
}

function setup() {
  const frozen: number[] = [];
  const dice = new DiceHallRuntime(
    {
      freeze: (_player, amount) => {
        frozen.push(amount);
        return true;
      },
      clear: () => {},
      payout: () => {},
      refund: () => {},
    },
    0,
  );
  const world = new World();
  return { dice, frozen, world };
}

/** 把玩家放到桌心、坐进指定座位；seat 传 0 表示站着 */
function putPlayer(world: World, tableId: number, seat: number): Player {
  const table = DICE_TABLES.find((item) => item.id === tableId)!;
  const player = world.create('牛马', { species: 'cow' } as never, 0, table.x, table.y);
  if (!player) throw new Error('spawn failed');
  player.seat = seat;
  return player;
}

describe('DiceHallRuntime 入座门（ADR-0093）', () => {
  it('站着不能下注，也不冻结任何钱', () => {
    const { dice, frozen, world } = setup();
    const player = putPlayer(world, 0, 0);
    expect(dice.placeBet(player, 0, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
    expect(frozen).toHaveLength(0);
  });

  it('坐在本桌凳子上才能下注', () => {
    const { dice, frozen, world } = setup();
    const table = DICE_TABLES[0]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    expect(dice.placeBet(player, table.id, DICE_SIDE.Small, DICE_MIN_BET, 0)).toBe(true);
    expect(frozen).toEqual([DICE_MIN_BET]);
    // 本局只能押一次
    expect(dice.placeBet(player, table.id, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
  });

  it('坐在另一桌的凳子上押不了这一桌', () => {
    const { dice, frozen, world } = setup();
    const [a, b] = DICE_TABLES;
    const player = putPlayer(world, a!.id, stoolOf(b!.group));
    expect(dice.placeBet(player, a!.id, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
    expect(frozen).toHaveLength(0);
  });

  it('坐着但离桌太远仍被距离门拦下', () => {
    const { dice, frozen, world } = setup();
    const table = DICE_TABLES[0]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    player.x = table.x + 400;
    player.y = table.y;
    expect(dice.placeBet(player, table.id, DICE_SIDE.Big, DICE_MIN_BET, 0)).toBe(false);
    expect(frozen).toHaveLength(0);
  });

  it('下注窗口关闭后，坐着也押不了', () => {
    const { dice, frozen, world } = setup();
    const table = DICE_TABLES[1]!;
    const player = putPlayer(world, table.id, stoolOf(table.group));
    expect(dice.placeBet(player, table.id, DICE_SIDE.Leopard, DICE_MIN_BET, DICE_BET_MS)).toBe(false);
    expect(frozen).toHaveLength(0);
  });
});
