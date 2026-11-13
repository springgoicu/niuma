import {
  BOSS_MAX_HP,
  encodeBoss,
  type BossPacket,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { World } from './world';

/**
 * 发泄区老板的每日血量（ADR-0070）。
 *
 * 全园区共享一条血，只活在进程内存里：进程重启 → 满血，跨本地零点 → 满血。
 * 不做持久化，也不把血量塞进实体快照——老板是静态地标，没有 AOI 与 id。
 */
export interface BossHitResult {
  hp: number;
  attackerId: number;
  /** 仅 1 → 0 的那一次为真：客户端据此只弹一次「老板倒下」横幅 */
  justDied: boolean;
}

/**
 * 下一次本地零点的毫秒时间戳。
 *
 * 用 `setHours(24, 0, 0, 0)` 而不是手写 24 小时加法：夏令时切换日也能落在
 * 当地真正的午夜，不依赖任何时区库。
 */
function nextLocalMidnight(nowMs: number): number {
  const next = new Date(nowMs);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

export class BossRuntime {
  private currentHp = BOSS_MAX_HP;
  private resetAt: number;

  constructor(nowMs = Date.now()) {
    this.resetAt = nextLocalMidnight(nowMs);
  }

  get hp(): number {
    return this.currentHp;
  }

  /** 下一个重置时刻：只读，用于测试与调试，不参与业务判断 */
  get nextResetAt(): number {
    return this.resetAt;
  }

  /**
   * 跨过本地零点就把血量与下一个重置点一起推进。返回 true 表示这次调用
   * 真的发生了重置，调用方需要广播一条 `reset` 快照。
   */
  syncDay(nowMs: number): boolean {
    if (nowMs < this.resetAt) return false;
    this.currentHp = BOSS_MAX_HP;
    this.resetAt = nextLocalMidnight(nowMs);
    return true;
  }

  /**
   * 一次真实命中：扣 1 点，下限 0；已倒下返回 null。
   *
   * 自己也先 `syncDay` 一次：就算 Tick 因为休眠、时钟跳变或长阻塞错过零点，
   * 跨日后的第一脚也会先回到满血再扣，不会把昨日尸体继续打。
   */
  hit(attackerId: number, nowMs = Date.now()): BossHitResult | null {
    this.syncDay(nowMs);
    if (this.currentHp <= 0) return null;
    this.currentHp -= 1;
    return { hp: this.currentHp, attackerId, justDied: this.currentHp === 0 };
  }
}

/**
 * 把老板血量发给所有真人连接。
 *
 * 不走 AOI：血量是园区共享状态，哪怕在摸鱼湖最远端也要和广场上看到同一个数。
 * NPC 的 `wsId = 0`，没有连接，跳过。
 */
export function broadcastBoss(world: World, transport: Transport, packet: BossPacket): void {
  const payload = encodeBoss(packet);
  for (const player of world.players.values()) {
    if (player.wsId === 0) continue;
    transport.send(player.wsId, payload);
  }
}
