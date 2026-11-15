import {
  BOSS_MAX_HP,
  encodeBoss,
  type BossPacket,
} from '@niuma/shared-types';
import { nextServerMidnight } from '../clock';
import type { Transport } from './view';
import type { World } from './world';

/**
 * 发泄区老板的每日血量（ADR-0070 / ADR-0081）。
 *
 * 全园区共享一条血：跨园区零点 → 满血；进程重启 → 按快照接着打（不再凭空回满）。
 * 血量不塞进实体快照——老板是静态地标，没有 AOI 与 id。
 */
export interface BossHitResult {
  hp: number;
  attackerId: number;
  /** 仅 1 → 0 的那一次为真：客户端据此只弹一次「老板倒下」横幅 */
  justDied: boolean;
}

/** 落盘用的最小状态：血量和下一个回满点，别的都能重算 */
export interface BossSaveState {
  hp: number;
  resetAt: number;
}

/**
 * 下一次园区零点。
 *
 * 用固定时区偏移（分钟）而不是 `setHours(24, …)`：容器多半跑 UTC，
 * 而玩家理解的是园区本地零点；固定偏移没有夏令时，也不会在部署环境之间漂。
 */
function nextMidnight(nowMs: number, tzOffsetMin: number): number {
  return nextServerMidnight(nowMs, tzOffsetMin);
}

export class BossRuntime {
  private currentHp = BOSS_MAX_HP;
  private resetAt: number;
  private readonly tzOffsetMin: number;

  constructor(nowMs = Date.now(), tzOffsetMin = -new Date().getTimezoneOffset()) {
    this.tzOffsetMin = tzOffsetMin;
    this.resetAt = nextMidnight(nowMs, tzOffsetMin);
  }

  /** 落盘快照：只读，不改状态 */
  snapshot(): BossSaveState {
    return { hp: this.currentHp, resetAt: this.resetAt };
  }

  /**
   * 从快照恢复。
   *
   * 回满点已经过期（停机跨过了零点）就直接按当前服务器日重算并满血；
   * 没过期就接着打，重启不该给玩家白送一条新血。
   */
  restore(state: BossSaveState, nowMs: number): void {
    if (!Number.isFinite(state.resetAt) || state.resetAt <= nowMs) {
      this.currentHp = BOSS_MAX_HP;
      this.resetAt = nextMidnight(nowMs, this.tzOffsetMin);
      return;
    }
    const hp = Number.isFinite(state.hp) ? Math.floor(state.hp) : BOSS_MAX_HP;
    this.currentHp = Math.max(0, Math.min(BOSS_MAX_HP, hp));
    this.resetAt = Math.floor(state.resetAt);
  }

  get hp(): number {
    return this.currentHp;
  }

  /** 下一个重置时刻：只读，用于测试与调试，不参与业务判断 */
  get nextResetAt(): number {
    return this.resetAt;
  }

  /**
   * 跨过园区零点就把血量与下一个重置点一起推进。返回 true 表示这次调用
   * 真的发生了重置，调用方需要广播一条 `reset` 快照。
   */
  syncDay(nowMs: number): boolean {
    if (nowMs < this.resetAt) return false;
    this.currentHp = BOSS_MAX_HP;
    this.resetAt = nextMidnight(nowMs, this.tzOffsetMin);
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
