import {
  DICE_BOARD_LIMIT,
  DICE_BOARD_METRIC,
  DICE_BOARD_SCOPE,
  DICE_LEDGER_MAX_PLAYERS,
  DICE_PLAYER_HISTORY,
  MAX_COINS,
  diceWinRate,
  isDeviceId,
  truncateName,
  type DiceAggregatePacket,
  type DiceBoardEntry,
  type DiceSelfSnapshot,
} from '@niuma/shared-types';

/**
 * 赌桌战绩账本（ADR-0110）。
 *
 * 按匿名设备号归户，和 `WalletBook` 一样活得比会话长：断线、重启都不清零。
 * 只存「玩家自己的结果」，不存别人的设备号——结算单与榜单需要全桌明细，
 * 那是 `DiceHallRuntime` 手里这一局的事，出网前只保留昵称。
 */

/** 单张桌的累计口径；`net` 为正表示这条桌赢过多少 */
export interface DiceTableAgg {
  rounds: number;
  wins: number;
  losses: number;
  /** 退款 / 平局：退出本金但没分胜负，不进胜率分母 */
  refunds: number;
  totalBet: number;
  totalPayout: number;
  net: number;
  bestWin: number;
}

/** 一位玩家自己的一局回放（不含其他下注者，避免历史把别人也存进来） */
export interface DicePlayerRound {
  table: number;
  round: number;
  dice: [number, number, number];
  hit: number;
  bet: number;
  payout: number;
  net: number;
  refunded: boolean;
}

export interface DicePlayerRecord {
  id: string;
  name: string;
  lastSeenAt: number;
  /** 两张桌各一份，合并榜在读取时求和 */
  tables: [DiceTableAgg, DiceTableAgg];
  history: DicePlayerRound[];
}

/** 一局结算的完整事实；`playerId` 只用于运行期标「哪一行是我」，落盘前剥掉 */
export interface DiceRoundEntry {
  playerId: number;
  deviceId: string;
  name: string;
  side: number;
  bet: number;
  payout: number;
  net: number;
  refunded: boolean;
}

export interface DiceRoundRecord {
  tableId: number;
  roundId: number;
  dice: [number, number, number];
  hit: number;
  raid: boolean;
  endedAt: number;
  entries: DiceRoundEntry[];
}

export interface DiceRoundSave {
  tableId: number;
  roundId: number;
  dice: [number, number, number];
  hit: number;
  raid: boolean;
  endedAt: number;
  entries: Array<Omit<DiceRoundEntry, 'playerId'>>;
}

export interface DiceLedgerSaveState {
  players: DicePlayerRecord[];
  lastRounds: DiceRoundSave[];
}

const MAX_AGG = MAX_COINS;

function emptyAgg(): DiceTableAgg {
  return {
    rounds: 0,
    wins: 0,
    losses: 0,
    refunds: 0,
    totalBet: 0,
    totalPayout: 0,
    net: 0,
    bestWin: 0,
  };
}

function emptyRecord(id: string, name: string, lastSeenAt: number): DicePlayerRecord {
  return { id, name, lastSeenAt, tables: [emptyAgg(), emptyAgg()], history: [] };
}

function tableIndex(tableId: number): 0 | 1 {
  return tableId === 1 ? 1 : 0;
}

function clampCount(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

function clampSigned(value: unknown): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_AGG, Math.min(MAX_AGG, Math.floor(value as number)));
}

function clampAgg(raw: unknown): DiceTableAgg {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<DiceTableAgg>;
  return {
    rounds: clampCount(source.rounds),
    wins: clampCount(source.wins),
    losses: clampCount(source.losses),
    refunds: clampCount(source.refunds),
    totalBet: clampCount(source.totalBet),
    totalPayout: clampCount(source.totalPayout),
    net: clampSigned(source.net),
    bestWin: clampCount(source.bestWin),
  };
}

function sanitizeRound(raw: unknown): DicePlayerRound | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<DicePlayerRound>;
  const dice = Array.isArray(source.dice) ? source.dice : [];
  if (dice.length < 3) return null;
  return {
    table: tableIndex(Number(source.table) === 1 ? 1 : 0),
    round: Math.max(0, Math.min(0xffff, clampCount(source.round))),
    dice: [
      clampCount(dice[0]) & 0x0f,
      clampCount(dice[1]) & 0x0f,
      clampCount(dice[2]) & 0x0f,
    ],
    hit: source.hit === -1 ? -1 : Math.max(0, Math.min(2, clampCount(source.hit))),
    bet: clampCount(source.bet),
    payout: clampCount(source.payout),
    net: clampSigned(source.net),
    refunded: source.refunded === true,
  };
}

function sanitizePlayer(raw: unknown): DicePlayerRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<DicePlayerRecord>;
  const id = typeof source.id === 'string' ? source.id : '';
  if (!isDeviceId(id)) return null;
  const tables = Array.isArray(source.tables) ? source.tables : [];
  const history = Array.isArray(source.history)
    ? source.history
        .map(sanitizeRound)
        .filter((row): row is DicePlayerRound => row !== null)
        .slice(0, DICE_PLAYER_HISTORY)
    : [];
  return {
    id,
    name: truncateName(typeof source.name === 'string' ? source.name : ''),
    lastSeenAt: Number.isFinite(source.lastSeenAt) ? Math.max(0, Math.floor(source.lastSeenAt as number)) : 0,
    tables: [clampAgg(tables[0]), clampAgg(tables[1])],
    history,
  };
}

function sanitizeRoundSave(raw: unknown): DiceRoundSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<DiceRoundSave>;
  const tableId = Number(source.tableId);
  if (tableId !== 0 && tableId !== 1) return null;
  const dice = Array.isArray(source.dice) ? source.dice : [];
  if (dice.length < 3) return null;
  const entries: DiceRoundSave['entries'] = [];
  if (Array.isArray(source.entries)) {
    for (const item of source.entries.slice(0, 12)) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Partial<DiceRoundSave['entries'][number]>;
      const deviceId = typeof entry.deviceId === 'string' ? entry.deviceId : '';
      entries.push({
        deviceId: isDeviceId(deviceId) ? deviceId : '',
        name: truncateName(typeof entry.name === 'string' ? entry.name : ''),
        side: Math.max(0, Math.min(2, clampCount(entry.side))),
        bet: clampCount(entry.bet),
        payout: clampCount(entry.payout),
        net: clampSigned(entry.net),
        refunded: entry.refunded === true,
      });
    }
  }
  return {
    tableId,
    roundId: Math.max(0, Math.min(0xffff, clampCount(source.roundId))),
    dice: [
      clampCount(dice[0]) & 0x0f,
      clampCount(dice[1]) & 0x0f,
      clampCount(dice[2]) & 0x0f,
    ],
    hit: source.hit === -1 ? -1 : Math.max(0, Math.min(2, clampCount(source.hit))),
    raid: source.raid === true,
    endedAt: Number.isFinite(source.endedAt) ? Math.max(0, Math.floor(source.endedAt as number)) : 0,
    entries,
  };
}

/** 读档侧的规整：坏行直接丢掉，绝不把整档判坏（园区开服比数据完美重要） */
export function normalizeDiceLedgerState(raw: unknown): DiceLedgerSaveState {
  if (!raw || typeof raw !== 'object') return { players: [], lastRounds: [] };
  const source = raw as { players?: unknown; lastRounds?: unknown };
  const players = Array.isArray(source.players)
    ? source.players
        .map(sanitizePlayer)
        .filter((row): row is DicePlayerRecord => row !== null)
        .slice(0, DICE_LEDGER_MAX_PLAYERS)
    : [];
  const lastRounds = Array.isArray(source.lastRounds)
    ? source.lastRounds
        .map(sanitizeRoundSave)
        .filter((row): row is DiceRoundSave => row !== null)
        .slice(0, 2)
    : [];
  return { players, lastRounds };
}

export class DiceLedger {
  private readonly players = new Map<string, DicePlayerRecord>();
  private readonly lastRounds = new Map<number, DiceRoundRecord>();
  private readonly capacity: number;

  constructor(capacity = DICE_LEDGER_MAX_PLAYERS) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /** 记一局：累计统计 + 最近一局的完整名单（名单只留在内存里给下一次下发） */
  record(round: DiceRoundRecord): void {
    const previous = this.lastRounds.get(round.tableId);
    if (previous && previous.roundId === round.roundId && previous.endedAt === round.endedAt) return;
    this.lastRounds.set(round.tableId, round);
    for (const entry of round.entries) {
      const stat = this.applyEntry(round, entry);
      if (stat) this.players.set(entry.deviceId, stat);
    }
    this.prune();
  }

  private applyEntry(round: DiceRoundRecord, entry: DiceRoundEntry): DicePlayerRecord | null {
    if (!isDeviceId(entry.deviceId)) return null;
    const existing = this.players.get(entry.deviceId);
    const record = existing ?? emptyRecord(entry.deviceId, entry.name, round.endedAt);
    record.name = truncateName(entry.name);
    record.lastSeenAt = Math.max(record.lastSeenAt, round.endedAt);
    const agg = record.tables[tableIndex(round.tableId)];
    agg.rounds += 1;
    agg.totalBet = Math.min(MAX_AGG, agg.totalBet + entry.bet);
    agg.totalPayout = Math.min(MAX_AGG, agg.totalPayout + entry.payout);
    agg.net = clampSigned(agg.net + entry.net);
    if (entry.refunded || entry.net === 0) {
      agg.refunds += 1;
    } else if (entry.net > 0) {
      agg.wins += 1;
      agg.bestWin = Math.max(agg.bestWin, entry.net);
    } else {
      agg.losses += 1;
    }
    record.history.unshift({
      table: tableIndex(round.tableId),
      round: round.roundId,
      dice: round.dice,
      hit: round.hit,
      bet: entry.bet,
      payout: entry.payout,
      net: entry.net,
      refunded: entry.refunded,
    });
    if (record.history.length > DICE_PLAYER_HISTORY) record.history.length = DICE_PLAYER_HISTORY;
    return record;
  }

  lastRound(tableId: number): DiceRoundRecord | undefined {
    return this.lastRounds.get(tableIndex(tableId));
  }

  statOf(deviceId: string): DicePlayerRecord | undefined {
    return isDeviceId(deviceId) ? this.players.get(deviceId) : undefined;
  }

  historyOf(deviceId: string): DicePlayerRound[] {
    return this.statOf(deviceId)?.history ?? [];
  }

  /**
   * 本人战绩快照：三份累计口径 + 最近若干局，供面板「我的战绩」页签。
   *
   * 和榜单一起下发（同一个 0x5d 包），不为逐局历史再开一条请求：
   * 玩家打开一次面板只花一次冷却，服务端也只扫一遍账本。
   */
  snapshotOf(deviceId: string): DiceSelfSnapshot | null {
    const record = this.statOf(deviceId);
    if (!record) return null;
    return {
      all: aggPacket(scopeAgg(record, DICE_BOARD_SCOPE.All)),
      table0: aggPacket(record.tables[0]),
      table1: aggPacket(record.tables[1]),
      history: record.history.map((row) => ({
        table: row.table,
        roundId: row.round,
        dice: [row.dice[0], row.dice[1], row.dice[2]] as [number, number, number],
        hit: row.hit,
        bet: row.bet,
        payout: row.payout,
        net: row.net,
        refunded: row.refunded,
      })),
    };
  }

  /** 该口径下的累计：单桌榜只看这一桌，总榜把两桌相加 */
  aggOf(deviceId: string, scope: number): DiceTableAgg | undefined {
    const record = this.statOf(deviceId);
    if (!record) return undefined;
    return scopeAgg(record, scope);
  }

  /**
   * 榜单：先按口径排序，再截前 `limit` 名；本人不在前列时补在末尾，
   * 让「我的名次」永远有答案而不是一句「未上榜」。
   */
  board(
    scope: number,
    metric: number,
    viewerId: string,
    limit = DICE_BOARD_LIMIT,
  ): { total: number; entries: DiceBoardEntry[] } {
    const rows: Array<{ id: string; name: string; net: number; winRate: number; rounds: number }> = [];
    for (const record of this.players.values()) {
      const agg = scopeAgg(record, scope);
      if (agg.rounds <= 0) continue;
      const winRate = diceWinRate(agg.wins, agg.rounds, agg.refunds);
      if (metric === DICE_BOARD_METRIC.WinRate && winRate < 0) continue;
      rows.push({ id: record.id, name: record.name, net: agg.net, winRate, rounds: agg.rounds });
    }
    rows.sort(metric === DICE_BOARD_METRIC.WinRate ? compareByWinRate : compareByNet);
    const size = Math.max(1, Math.min(60, Math.floor(limit)));
    const entries: DiceBoardEntry[] = rows.slice(0, size).map((row, index) => ({
      rank: index + 1,
      name: row.name,
      net: row.net,
      winRate: row.winRate,
      rounds: row.rounds,
      self: row.id === viewerId,
    }));
    const selfIndex = rows.findIndex((row) => row.id === viewerId);
    if (selfIndex >= size) {
      const row = rows[selfIndex]!;
      entries.push({
        rank: selfIndex + 1,
        name: row.name,
        net: row.net,
        winRate: row.winRate,
        rounds: row.rounds,
        self: true,
      });
    }
    return { total: rows.length, entries };
  }

  toJSON(): DiceLedgerSaveState {
    const players = [...this.players.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => ({
        ...record,
        tables: [record.tables[0], record.tables[1]] as [DiceTableAgg, DiceTableAgg],
        history: record.history.map((row) => ({ ...row, dice: [...row.dice] as [number, number, number] })),
      }));
    const lastRounds = [...this.lastRounds.values()]
      .sort((a, b) => a.tableId - b.tableId)
      .map((round) => ({
        tableId: round.tableId,
        roundId: round.roundId,
        dice: [...round.dice] as [number, number, number],
        hit: round.hit,
        raid: round.raid,
        endedAt: round.endedAt,
        entries: round.entries.map(({ playerId: _playerId, ...entry }) => entry),
      }));
    return { players, lastRounds };
  }

  /** 读档后接管：只接管规整过的快照，运行期产生的 `playerId` 一律回到 0 */
  restore(state: DiceLedgerSaveState): void {
    this.players.clear();
    this.lastRounds.clear();
    for (const record of state.players) {
      if (this.players.size >= this.capacity) break;
      this.players.set(record.id, record);
    }
    for (const round of state.lastRounds) {
      this.lastRounds.set(round.tableId, {
        ...round,
        entries: round.entries.map((entry) => ({ ...entry, playerId: 0 })),
      });
    }
  }

  /** 容量控制：只在超出上限时淘汰最后参与时间最早的那位，O(n²) 但 n ≤ 200 */
  private prune(): void {
    while (this.players.size > this.capacity) {
      let oldestId: string | null = null;
      let oldestAt = Infinity;
      for (const [id, record] of this.players) {
        if (record.lastSeenAt < oldestAt) {
          oldestAt = record.lastSeenAt;
          oldestId = id;
        }
      }
      if (!oldestId) return;
      this.players.delete(oldestId);
    }
  }
}

/** 内部累计 → 协议口径：字段一一对应，单独抽出来是为了避免快照手抄错字段 */
function aggPacket(agg: DiceTableAgg): DiceAggregatePacket {
  return {
    rounds: agg.rounds,
    wins: agg.wins,
    losses: agg.losses,
    refunds: agg.refunds,
    totalBet: agg.totalBet,
    totalPayout: agg.totalPayout,
    net: agg.net,
    bestWin: agg.bestWin,
  };
}

function scopeAgg(record: DicePlayerRecord, scope: number): DiceTableAgg {
  if (scope === DICE_BOARD_SCOPE.Table0) return record.tables[0];
  if (scope === DICE_BOARD_SCOPE.Table1) return record.tables[1];
  const left = record.tables[0];
  const right = record.tables[1];
  return {
    rounds: left.rounds + right.rounds,
    wins: left.wins + right.wins,
    losses: left.losses + right.losses,
    refunds: left.refunds + right.refunds,
    totalBet: Math.min(MAX_AGG, left.totalBet + right.totalBet),
    totalPayout: Math.min(MAX_AGG, left.totalPayout + right.totalPayout),
    net: clampSigned(left.net + right.net),
    bestWin: Math.max(left.bestWin, right.bestWin),
  };
}

function compareByNet(
  a: { net: number; winRate: number; rounds: number; name: string; id: string },
  b: { net: number; winRate: number; rounds: number; name: string; id: string },
): number {
  return (
    b.net - a.net ||
    b.winRate - a.winRate ||
    b.rounds - a.rounds ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

function compareByWinRate(
  a: { net: number; winRate: number; rounds: number; name: string; id: string },
  b: { net: number; winRate: number; rounds: number; name: string; id: string },
): number {
  return (
    b.winRate - a.winRate ||
    b.net - a.net ||
    b.rounds - a.rounds ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}
