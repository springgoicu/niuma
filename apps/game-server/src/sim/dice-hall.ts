import {
  DICE_BET_MS,
  DICE_BOARD_METRIC,
  DICE_BOARD_SCOPE,
  DICE_GUARD_RAID_CHANCE,
  DICE_MAX_BET,
  DICE_MIN_BET,
  DICE_PHASE,
  DICE_RAID_TAKE,
  DICE_REVEAL_MS,
  DICE_ROLL_MS,
  DICE_SIDE,
  DICE_TABLES,
  HOTSPOT_SERVER_SLACK,
  WALLET_REASON,
  classifyDice,
  encodeDiceResult,
  encodeDiceState,
  hotspotById,
  isDeviceId,
  isWithinHotspot,
  seatMatchesHotspot,
  splitPool,
  truncateName,
  type DiceBoardPacket,
  type DiceBoardRequest,
  type DicePhase,
  type DiceResultEntry,
  type DiceResultPacket,
  type DiceTablePacket,
} from '@niuma/shared-types';
import { DiceLedger, type DiceRoundRecord } from './dice-ledger';
import type { Player, World } from './world';
import type { Transport } from './view';

/** 经济端口：彩池结算需要的四个动作，全部由 `EconomyService` 提供 */
export interface DiceHallPorts {
  /** 冻结注额（成功才记注），key 按「桌 + 玩家」隔离 */
  freeze: (player: Player, key: string, amount: number) => boolean;
  /** 清账（输掉），只清这一桌的 key */
  clear: (player: Player, key: string) => void;
  /**
   * 派彩，返回**真实入账**的金额。
   *
   * 结算单的净盈亏必须以这个返回值为准：托管账可能已被别的流程清掉，
   * 此时经济层会原路退本金（返回 0），客户端不能按理论派彩显示「赢了」。
   */
  payout: (player: Player, key: string, amount: number, reason: number) => number;
  /** 原路退还（无人命中 / 平局） */
  refund: (player: Player, key: string) => void;
}

/**
 * 赌桌的托管 key：两张桌各一本账。
 *
 * 同一玩家在另一张桌的注额、擂台报名费与 P2P 赌注都在这本账之外，
 * 任一桌结算不会顺手清掉别的玩法。
 */
export function diceEscrowKey(tableId: number, playerId: number): string {
  return `dice:${tableId === 1 ? 1 : 0}:${Math.max(0, Math.floor(playerId))}`;
}

interface DiceBet {
  side: number;
  amount: number;
}

interface TableState {
  id: number;
  phase: DicePhase;
  phaseEndsAt: number;
  roundId: number;
  dice: [number, number, number];
  raid: boolean;
  bets: Map<number, DiceBet>;
}

/** 一次推进的结果：`settled` 里的桌刚亮牌，需要逐人发结算单（ADR-0110） */
export interface DiceTickResult {
  changed: boolean;
  settled: number[];
}

/**
 * 赌桌公共局状态机（每张桌一份，互相独立）。
 *
 * 结算用彩池而不是固定赔率：押中档位的人按注额比例分走全池，
 * 平台不抽水、货币不增发，天然支持「多人同赢同输」。
 * 命中档位无人下注时全额退款；每局 5% 概率触发保安查岗，命中者再被抽走 5%。
 */
export class DiceHallRuntime {
  private readonly tables: TableState[];

  /**
   * `random` 只在服务端调用，返回 [0, 1)。默认 `Math.random`；
   * 单测注入序列即可复现同一局。**局号不再参与骰面**——它随投注包下发，
   * 用局号推导等于把答案提前告诉改包客户端（ADR-0104）。
   */
  constructor(
    private readonly ports: DiceHallPorts,
    now: number,
    private readonly random: () => number = Math.random,
    readonly ledger: DiceLedger = new DiceLedger(),
  ) {
    this.tables = DICE_TABLES.map((spec) => ({
      id: spec.id,
      phase: DICE_PHASE.Betting,
      phaseEndsAt: now + DICE_BET_MS,
      roundId: 1,
      dice: [0, 0, 0] as [number, number, number],
      raid: false,
      bets: new Map<number, DiceBet>(),
    }));
  }

  table(id: number): TableState | undefined {
    return this.tables.find((table) => table.id === id);
  }

  /** 下注：只有下注窗口、未押过、本桌在座、够近、注额合法才受理（ADR-0093） */
  placeBet(player: Player, tableId: number, side: number, amount: number, now: number): boolean {
    const table = this.table(tableId);
    if (!table) return false;
    if (table.phase !== DICE_PHASE.Betting || now >= table.phaseEndsAt) return false;
    if (side !== DICE_SIDE.Big && side !== DICE_SIDE.Small && side !== DICE_SIDE.Leopard) return false;
    if (!Number.isFinite(amount)) return false;
    const stake = Math.floor(amount);
    if (stake < DICE_MIN_BET || stake > DICE_MAX_BET) return false;
    if (table.bets.has(player.id)) return false;
    const hotspot = hotspotById(`dice-table-${tableId}`);
    if (!hotspot) return false;
    // 座位门：必须坐在这一桌自己的圆凳上（坐下即入局，站着只能看）
    if (!seatMatchesHotspot(hotspot, player.seat)) return false;
    // 距离门：仍要处在这一桌的热区里，防止坐下后远程伪造包
    if (!isWithinHotspot(hotspot, player.x, player.y, HOTSPOT_SERVER_SLACK)) return false;
    if (!this.ports.freeze(player, diceEscrowKey(table.id, player.id), stake)) return false;
    table.bets.set(player.id, { side, amount: stake });
    return true;
  }

  /** 每 Tick 推进；返回是否需要广播，以及刚亮牌、需要发结算单的桌 */
  tick(now: number, world: World): DiceTickResult {
    let changed = false;
    const settled: number[] = [];
    for (const table of this.tables) {
      if (now < table.phaseEndsAt) continue;
      changed = true;
      if (table.phase === DICE_PHASE.Betting) {
        table.dice = rollWith(this.random);
        table.raid = this.random() < DICE_GUARD_RAID_CHANCE;
        table.phase = DICE_PHASE.Rolling;
        table.phaseEndsAt = now + DICE_ROLL_MS;
      } else if (table.phase === DICE_PHASE.Rolling) {
        this.settle(table, now, world);
        settled.push(table.id);
        table.phase = DICE_PHASE.Reveal;
        table.phaseEndsAt = now + DICE_REVEAL_MS;
      } else {
        table.phase = DICE_PHASE.Betting;
        table.phaseEndsAt = now + DICE_BET_MS;
        table.roundId = table.roundId >= 0xffff ? 1 : table.roundId + 1;
        table.dice = [0, 0, 0];
        table.raid = false;
      }
    }
    return { changed, settled };
  }

  /** 1Hz 心跳：亮牌期也要让倒计时走起来，否则 HUD 会停在开局那一刻 */
  needsHeartbeat(now: number): boolean {
    return this.tables.some((table) => table.phase !== DICE_PHASE.Betting || now < table.phaseEndsAt);
  }

  /** 一局的结算事实：账本只留最近一条，供亮牌后进场的人补看 */
  resultFor(player: Player, tableId: number): DiceResultPacket | null {
    const round = this.ledger.lastRound(tableId);
    if (!round) return null;
    const byDevice = isDeviceId(player.deviceId);
    const entries: DiceResultEntry[] = round.entries.map((entry) => ({
      name: entry.name,
      side: entry.side,
      bet: entry.bet,
      payout: entry.payout,
      net: entry.net,
      refunded: entry.refunded,
      self: byDevice
        ? entry.deviceId === player.deviceId
        : entry.playerId > 0 && entry.playerId === player.id,
    }));
    return {
      table: round.tableId,
      roundId: round.roundId,
      dice: round.dice,
      hit: round.hit,
      raid: round.raid,
      entries,
    };
  }

  /** 排行榜快照：排序与容量都由账本负责，运行时只做玩家身份到设备号的翻译 */
  board(player: Player, request: DiceBoardRequest): DiceBoardPacket {
    const scope = request.scope === DICE_BOARD_SCOPE.Table0 || request.scope === DICE_BOARD_SCOPE.Table1
      ? request.scope
      : DICE_BOARD_SCOPE.All;
    const metric = request.metric === DICE_BOARD_METRIC.WinRate
      ? DICE_BOARD_METRIC.WinRate
      : DICE_BOARD_METRIC.Net;
    const viewerId = isDeviceId(player.deviceId) ? player.deviceId : '';
    const board = this.ledger.board(scope, metric, viewerId);
    return {
      scope,
      metric,
      total: board.total,
      entries: board.entries,
      // 同一趟把「我的战绩」带回去：面板两个页签共用一次请求
      self: viewerId ? this.ledger.snapshotOf(viewerId) : null,
    };
  }

  private settle(table: TableState, now: number, world: World): void {
    const [a, b, c] = table.dice;
    const hit = classifyDice(a, b, c);
    let pool = 0;
    const winners: Array<{ id: number; amount: number }> = [];
    for (const [id, bet] of table.bets) {
      pool += bet.amount;
      if (bet.side === hit) winners.push({ id, amount: bet.amount });
    }
    const record: DiceRoundRecord = {
      tableId: table.id,
      roundId: table.roundId,
      dice: table.dice,
      hit: winners.length > 0 ? hit : -1,
      raid: table.raid,
      endedAt: now,
      entries: [],
    };
    if (table.bets.size > 0 && winners.length === 0) {
      // 命中档位没人押：全额退款，谁也不算输；结算单也要留一条「全员退款」
      for (const [id, bet] of table.bets) {
        const player = world.get(id);
        if (player) this.ports.refund(player, diceEscrowKey(table.id, id));
        record.entries.push({
          playerId: id,
          deviceId: player?.deviceId ?? '',
          name: betName(player),
          side: bet.side,
          bet: bet.amount,
          payout: bet.amount,
          net: 0,
          refunded: true,
        });
      }
      table.bets.clear();
      this.ledger.record(record);
      return;
    }
    if (table.bets.size > 0) {
      const payouts = splitPool(winners, pool);
      const granted = new Map<number, number>();
      for (const entry of payouts) {
        const player = world.get(entry.id);
        if (!player) continue;
        // 保安查岗：本局命中的彩池抽走 5%
        const take = table.raid ? Math.floor(entry.amount * DICE_RAID_TAKE) : 0;
        const paid = this.ports.payout(
          player,
          diceEscrowKey(table.id, entry.id),
          entry.amount - take,
          WALLET_REASON.DiceWin,
        );
        granted.set(entry.id, Math.max(0, Math.floor(paid)));
      }
      for (const [id, bet] of table.bets) {
        const player = world.get(id);
        if (player) {
          if (granted.has(id)) {
            const paid = granted.get(id)!;
            record.entries.push({
              playerId: id,
              deviceId: player.deviceId,
              name: betName(player),
              side: bet.side,
              bet: bet.amount,
              payout: paid,
              // 托管账已被清掉时经济层会退本金，此时真实结果是「没输没赢」
              net: paid > 0 ? paid - bet.amount : 0,
              refunded: paid <= 0,
            });
          } else {
            this.ports.clear(player, diceEscrowKey(table.id, id));
            record.entries.push({
              playerId: id,
              deviceId: player.deviceId,
              name: betName(player),
              side: bet.side,
              bet: bet.amount,
              payout: 0,
              net: -bet.amount,
              refunded: false,
            });
          }
        }
      }
      table.bets.clear();
    }
    this.ledger.record(record);
  }

  /** 组装下行快照：只带观看者自己的注额，避免把全桌注额摊给所有人 */
  snapshot(viewer: Player, now: number): DiceTablePacket[] {
    return this.tables.map((table) => {
      const own = table.bets.get(viewer.id);
      return {
        id: table.id,
        phase: table.phase,
        remainingMs: Math.max(0, table.phaseEndsAt - now),
        roundId: table.roundId,
        // 只有亮牌期才下发点数与查岗：Rolling 阶段发出去等于把 1.5s 悬念提前揭晓
        dice:
          table.phase === DICE_PHASE.Reveal
            ? (table.dice as [number, number, number])
            : ([0, 0, 0] as const),
        totalPot: sumBets(table.bets),
        mySide: own ? own.side : -1,
        myBet: own ? own.amount : 0,
        raid: table.phase === DICE_PHASE.Reveal ? table.raid : false,
      };
    });
  }

  /** 断线清理：把该玩家未结算的注额原路退回（只退这一桌的 key） */
  onDisconnect(playerId: number, world: World): void {
    for (const table of this.tables) {
      if (!table.bets.has(playerId)) continue;
      table.bets.delete(playerId);
      const player = world.get(playerId);
      if (player) this.ports.refund(player, diceEscrowKey(table.id, playerId));
    }
  }
}

function betName(player: Player | undefined): string {
  return truncateName(player?.name ?? '');
}

function sumBets(bets: ReadonlyMap<number, DiceBet>): number {
  let total = 0;
  for (const bet of bets.values()) total += bet.amount;
  return total;
}

/** 三颗 1–6：只读注入的随机源，不从局号推导 */
function rollWith(random: () => number): [number, number, number] {
  const next = (): number => {
    const value = random();
    const normalized = Number.isFinite(value) ? Math.min(0.999_999, Math.max(0, value)) : 0;
    return Math.floor(normalized * 6) + 1;
  };
  return [next(), next(), next()];
}

/** 广播给所有在线连接：一包两张桌，按人填自己的注额 */
export function broadcastDice(
  dice: DiceHallRuntime,
  world: World,
  transport: Transport,
  now = Date.now(),
): void {
  for (const player of world.players.values()) {
    if (player.wsId === 0) continue;
    transport.send(player.wsId, encodeDiceState({ tables: dice.snapshot(player, now) }));
  }
}

/**
 * 亮牌结算单：逐人下发，只带昵称与金额。
 *
 * 一桌上限 6 人、一局一包，比在 1Hz 心跳里塞名单更省；`self` 由服务端标，
 * 客户端不靠昵称猜「哪一行是我」。
 */
export function broadcastDiceResults(
  dice: DiceHallRuntime,
  world: World,
  transport: Transport,
  tableIds: number[],
): void {
  if (tableIds.length === 0) return;
  for (const player of world.players.values()) {
    if (player.wsId === 0) continue;
    for (const tableId of tableIds) {
      const packet = dice.resultFor(player, tableId);
      if (packet) transport.send(player.wsId, encodeDiceResult(packet));
    }
  }
}

/** 进场/重连补发：让面板打开时就能看到最近一局的结算，而不是等到下一局 */
export function sendDiceResultsTo(
  dice: DiceHallRuntime,
  player: Player,
  transport: Transport,
): void {
  for (const table of DICE_TABLES) {
    const packet = dice.resultFor(player, table.id);
    if (packet) transport.send(player.wsId, encodeDiceResult(packet));
  }
}
