import type { Player } from '../sim/world';

/** 一局进行中的互动：赌注已冻结，结算/退款只能发生一次 */
export interface ActiveMatch {
  id: number;
  gameType: number;
  wager: number;
  extra: number;
  /** 发起方 */
  a: Player;
  /** 被邀请方 */
  b: Player;
  startedAt: number;
  endsAt: number;
  /** 处理器自己的状态（骰子结果 / 猜拳回合 / 切磋血量） */
  data: Record<string, unknown>;
  resolved: boolean;
}

/** 亮牌包中由玩法决定的部分；总线补上对局与双方 id */
export interface ShowdownInput {
  round: number;
  winnerId: number;
  flags: number;
  dice?: readonly number[];
  aAction?: number;
  bAction?: number;
  durationMs: number;
}

/** 切磋头槌结算结果：hit=false 表示被跳跃无敌帧闪掉 */
export interface DuelVentResolution {
  hit: boolean;
  damage: number;
  hp: number;
  ended: boolean;
}

/**
 * 处理器能用的能力：发红包、提前结束、确定性随机、AOI 亮牌广播。
 *
 * 广播统一走总线而不是处理器自己遍历 `known`：参与者与围观者的去重、
 * 离线玩家跳过、切磋状态与亮牌的同一份收件人集合都只在这里维护一次。
 */
export interface ChallengeContext {
  readonly now: number;
  /** 立即结算；winnerId 为 0 表示平局，双方退款 */
  finish(winnerId: number, endReason: number): void;
  /** 中止并退款 */
  cancel(endReason: number): void;
  send(player: Player, packet: Uint8Array): void;
  /** 发给双方 + 双方 AOI 并集，路人也能围观 */
  broadcast(packet: Uint8Array): void;
  /** 头顶亮牌：骰子 / 猜拳 / 切磋结算共用 */
  showdown(input: ShowdownInput): void;
  /** 切磋实时血量与倒计时 */
  duelState(hpA: number, hpB: number, flags: number): void;
  random(): number;
}

/**
 * 玩法处理器（插件点）。
 *
 * 总线只保证「邀请、托管、清理」三件事；新增玩法只需实现这个接口并注册 gameType。
 */
export interface ChallengeHandler {
  readonly gameType: number;
  readonly name: string;
  /** 从接受到自动结算的时长；0 表示由处理器自己调 finish */
  readonly durationMs: number;
  /** 赢家可拿走的奖池比例，10000 = 全额；P2P_TAX_BPS = 500 表示抽 5% */
  readonly payoutBps?: number;
  onStart?(match: ActiveMatch, ctx: ChallengeContext): void;
  onInput?(match: ActiveMatch, player: Player, payload: Uint8Array, ctx: ChallengeContext): void;
  /** 猜拳出拳等单字节行动；比 onInput 更明确，服务端不再拆包 */
  onAction?(match: ActiveMatch, player: Player, action: number, ctx: ChallengeContext): void;
  /** 切磋头槌：返回 null 表示这一下不该走切磋战斗域 */
  onVentHit?(
    match: ActiveMatch,
    attacker: Player,
    target: Player,
    ctx: ChallengeContext,
  ): DuelVentResolution | null;
  onTick(match: ActiveMatch, ctx: ChallengeContext): void;
  /** 退款已经由总线完成，处理器只做自己的清理 */
  onCancel?(match: ActiveMatch, endReason: number, ctx: ChallengeContext): void;
}

/** 供 `resolveVents` 使用的切磋战斗端口，避免模拟层反向依赖总线实现 */
export interface DuelCombatPort {
  /** 当前是否处于切磋中：切磋中只允许命中对手 */
  isDueling(player: Player): boolean;
  /** 当前对手；不在切磋中返回 null */
  opponentOf(player: Player): Player | null;
  /** 尝试结算一次头槌；null 表示双方不在同一场切磋 */
  hit(attacker: Player, target: Player, now: number): DuelVentResolution | null;
}
