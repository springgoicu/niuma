import { describe, expect, it } from 'bun:test';
import { DICE_BOARD_METRIC, DICE_BOARD_SCOPE, diceWinRate } from '@niuma/shared-types';
import { DiceLedger, normalizeDiceLedgerState, type DiceRoundRecord } from './dice-ledger';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

function round(
  tableId: number,
  roundId: number,
  entries: Array<{ id: string; name: string; bet: number; payout: number; net: number; refunded?: boolean }>,
  endedAt = 1000,
): DiceRoundRecord {
  return {
    tableId,
    roundId,
    dice: [3, 3, 5],
    hit: 0,
    raid: false,
    endedAt,
    entries: entries.map((entry, index) => ({
      playerId: index + 1,
      deviceId: entry.id,
      name: entry.name,
      side: 0,
      bet: entry.bet,
      payout: entry.payout,
      net: entry.net,
      refunded: entry.refunded === true,
    })),
  };
}

describe('DiceLedger 归户与累计', () => {
  it('同一设备跨两桌累加，单桌口径只看自己那桌', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: A, name: '摸鱼王', bet: 100, payout: 180, net: 80 }], 1000));
    ledger.record(round(1, 2, [{ id: A, name: '摸鱼王', bet: 50, payout: 0, net: -50 }], 2000));
    const all = ledger.aggOf(A, DICE_BOARD_SCOPE.All)!;
    expect(all.rounds).toBe(2);
    expect(all.net).toBe(30);
    expect(all.totalBet).toBe(150);
    expect(ledger.aggOf(A, DICE_BOARD_SCOPE.Table0)!.net).toBe(80);
    expect(ledger.aggOf(A, DICE_BOARD_SCOPE.Table1)!.net).toBe(-50);
    expect(ledger.historyOf(A)).toHaveLength(2);
  });

  it('本人快照带三份口径与最近几局，没有战绩时返回 null', () => {
    const ledger = new DiceLedger();
    expect(ledger.snapshotOf(A)).toBeNull();
    ledger.record(round(0, 11, [{ id: A, name: '摸鱼王', bet: 100, payout: 180, net: 80 }], 1000));
    ledger.record(round(1, 12, [{ id: A, name: '摸鱼王', bet: 50, payout: 0, net: -50 }], 2000));
    const snapshot = ledger.snapshotOf(A)!;
    expect(snapshot.all.rounds).toBe(2);
    expect(snapshot.all.net).toBe(30);
    expect(snapshot.table0.net).toBe(80);
    expect(snapshot.table1.net).toBe(-50);
    expect(snapshot.all.bestWin).toBe(80);
    // 最新一局在最前：面板「最近 20 局」直接从上往下读
    expect(snapshot.history[0]).toMatchObject({ table: 1, roundId: 12, net: -50 });
    expect(snapshot.history[1]).toMatchObject({ table: 0, roundId: 11, net: 80 });
    // 别人的快照互不串号
    expect(ledger.snapshotOf(B)).toBeNull();
  });

  it('退款 / 平局不计胜负，也不进胜率分母', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: A, name: '甲', bet: 100, payout: 100, net: 0, refunded: true }], 1000));
    ledger.record(round(0, 2, [{ id: A, name: '甲', bet: 100, payout: 220, net: 120 }], 2000));
    ledger.record(round(0, 3, [{ id: A, name: '甲', bet: 100, payout: 0, net: -100 }], 3000));
    const agg = ledger.aggOf(A, DICE_BOARD_SCOPE.All)!;
    expect(agg.rounds).toBe(3);
    expect(agg.wins).toBe(1);
    expect(agg.losses).toBe(1);
    expect(agg.refunds).toBe(1);
    expect(diceWinRate(agg.wins, agg.rounds, agg.refunds)).toBe(0.5);
  });

  it('只有退款局时胜率是 -1（显示「—」而不是 0%）', () => {
    expect(diceWinRate(0, 2, 2)).toBe(-1);
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: A, name: '甲', bet: 10, payout: 10, net: 0, refunded: true }]));
    expect(ledger.board(DICE_BOARD_SCOPE.All, DICE_BOARD_METRIC.WinRate, A).total).toBe(0);
  });

  it('没有合法设备号的注额不进榜，但那一局照常结算', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: '', name: '游客', bet: 10, payout: 30, net: 20 }]));
    expect(ledger.board(DICE_BOARD_SCOPE.All, DICE_BOARD_METRIC.Net, '').total).toBe(0);
    expect(ledger.lastRound(0)?.roundId).toBe(1);
  });
});

describe('DiceLedger 榜单', () => {
  it('净收益榜按金额降序，并列时先看胜率再看局数', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: B, name: '乙', bet: 10, payout: 110, net: 100 }]));
    ledger.record(
      round(0, 2, [
        { id: A, name: '甲', bet: 10, payout: 110, net: 100 },
        { id: C, name: '丙', bet: 10, payout: 30, net: 20 },
      ]),
    );
    // 乙只赢 1 局、甲赢 1 局：同额时甲、乙先按胜率（都 100%）再按局数，仍并列则按昵称
    const board = ledger.board(DICE_BOARD_SCOPE.All, DICE_BOARD_METRIC.Net, '');
    expect(board.total).toBe(3);
    expect(board.entries[0]!.net).toBe(100);
    expect(board.entries[1]!.net).toBe(100);
    expect(board.entries[2]!.net).toBe(20);
    expect(board.entries.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('胜率榜只收有胜负的玩家，并把本人补进列表', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: A, name: '甲', bet: 10, payout: 20, net: 10 }]));
    ledger.record(round(0, 2, [{ id: B, name: '乙', bet: 10, payout: 0, net: -10 }]));
    ledger.record(round(0, 3, [{ id: C, name: '丙', bet: 10, payout: 10, net: 0, refunded: true }]));
    const board = ledger.board(DICE_BOARD_SCOPE.All, DICE_BOARD_METRIC.WinRate, B);
    expect(board.total).toBe(2);
    expect(board.entries.map((row) => row.name)).toEqual(['甲', '乙']);
    expect(board.entries[1]!.self).toBe(true);
  });

  it('本人排在 limit 之外时，服务端补一行并保留真实名次', () => {
    const ledger = new DiceLedger(200);
    for (let i = 0; i < 25; i += 1) {
      const id = i.toString(16).padStart(16, '0');
      ledger.record(round(0, i + 1, [{ id, name: `玩家${i}`, bet: 10, payout: 30 + i, net: 20 + i }]));
    }
    const viewer = (0).toString(16).padStart(16, '0');
    const board = ledger.board(DICE_BOARD_SCOPE.All, DICE_BOARD_METRIC.Net, viewer, 10);
    expect(board.entries).toHaveLength(11);
    expect(board.entries[10]!.rank).toBe(25);
    expect(board.entries[10]!.self).toBe(true);
  });
});

describe('DiceLedger 容量与读档', () => {
  it('超出容量按最后参与时间淘汰', () => {
    const ledger = new DiceLedger(1);
    ledger.record(round(0, 1, [{ id: A, name: '甲', bet: 10, payout: 20, net: 10 }], 1000));
    ledger.record(round(0, 2, [{ id: B, name: '乙', bet: 10, payout: 20, net: 10 }], 2000));
    expect(ledger.statOf(A)).toBeUndefined();
    expect(ledger.statOf(B)).toBeDefined();
  });

  it('落盘的最近一局会剥掉会话 id，读档后不会把新玩家误标成「我」', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 7, [{ id: A, name: '甲', bet: 10, payout: 20, net: 10 }], 5000));
    const saved = normalizeDiceLedgerState(JSON.parse(JSON.stringify(ledger.toJSON())));
    expect(saved.lastRounds[0]!.entries[0]).not.toHaveProperty('playerId');
    const restored = new DiceLedger();
    restored.restore(saved);
    expect(restored.lastRound(0)!.entries[0]!.playerId).toBe(0);
    expect(restored.historyOf(A)).toHaveLength(1);
    expect(restored.aggOf(A, DICE_BOARD_SCOPE.All)!.net).toBe(10);
  });

  it('坏行只丢自己，不整档判坏；重复 restore 不会叠加', () => {
    const ledger = new DiceLedger();
    ledger.record(round(0, 1, [{ id: A, name: '甲', bet: 10, payout: 20, net: 10 }]));
    const saved = normalizeDiceLedgerState({
      players: [
        ledger.toJSON().players[0],
        { id: 'not-a-device' },
        { id: B, tables: 'broken', history: [{ round: 1 }] },
      ],
      lastRounds: 'broken',
    });
    expect(saved.players).toHaveLength(2);
    expect(saved.lastRounds).toHaveLength(0);
    const restored = new DiceLedger();
    restored.restore(saved);
    restored.restore(saved);
    expect(restored.statOf(A)!.tables[0].rounds).toBe(1);
  });
});
