'use client';

import { Container, Graphics } from 'pixi.js';
import {
  BOSS_SHOCK,
  BOSS_SHOCK_PHASE,
  redPacketSpots,
  type BossShockPacket,
  type RedPacketSpot,
} from '@niuma/shared-types';

/**
 * 世界事件的地面表现（ADR-0088）：红包雨与画饼冲击波。
 *
 * 一个 `Graphics` 重画全场，理由与 `BuffFx` 一样：同时在场的东西最多 25 个小红包 +
 * 一个冲击波圈，每帧几张矩形比给每个红包常备 Sprite 更省，也没有对象池要维护。
 *
 * 红包位置不来自服务端实体，而是 `redPacketSpots(seed)` 的确定性撒点：
 * 服务端与客户端读同一个纯函数，因此不需要为它扩 `S2C_ENTITY_SPAWN`。
 */

const PACKET_BOB_MS = 900;
const SHOCK_FLASH_MS = 420;

export class WorldEventFx {
  readonly container = new Container();
  private readonly gfx = new Graphics();

  private seed = -1;
  private spots: RedPacketSpot[] = [];
  private readonly claimed = new Set<number>();

  /** 冲击波：预警开始 / 命中/ 圆心与半径 */
  private shockSince = 0;
  private shockStage = 0;
  private shockX = 0;
  private shockY = 0;
  // 显式标注 number：`BOSS_SHOCK.Radius` 是 `as const` 的字面量类型 320，
  // 不标注就收不下降级写回的真实半径
  private shockRadius: number = BOSS_SHOCK.Radius;

  constructor() {
    this.container.addChild(this.gfx);
  }

  /** 红包雨开场：写入撒点并清空本地已领集合 */
  setSpots(seed: number): void {
    if (seed === this.seed) return;
    this.seed = seed;
    this.claimed.clear();
    this.spots = redPacketSpots(seed);
  }

  /** 事件结束（结算横幅之后）：红包全部收起 */
  clearSpots(): void {
    this.seed = -1;
    this.spots = [];
    this.claimed.clear();
    this.gfx.clear();
  }

  /** 某个红包被抢走：本地立刻抹掉，不等下一帧的服务端回包 */
  claim(index: number): void {
    this.claimed.add(index);
  }

  /** 冲击波：预警画 2 秒红圈，命中帧闪一下并扩散 */
  showShock(packet: BossShockPacket, now: number): void {
    this.shockSince = now;
    this.shockStage = packet.phase;
    this.shockX = packet.x;
    this.shockY = packet.y;
    this.shockRadius = packet.radius > 0 ? packet.radius : BOSS_SHOCK.Radius;
  }

  update(now: number): void {
    this.gfx.clear();
    this.drawPackets(now);
    this.drawShock(now);
  }

  private drawPackets(now: number): void {
    if (this.spots.length === 0) return;
    const phase = (now % PACKET_BOB_MS) / PACKET_BOB_MS;
    const bob = Math.round(Math.sin(phase * Math.PI * 2) * 2);
    for (let i = 0; i < this.spots.length; i += 1) {
      if (this.claimed.has(i)) continue;
      const spot = this.spots[i]!;
      const x = spot.x;
      const y = spot.y + bob;
      // 地面光晕：金色低透明度椭圆，先画，让红包看起来是「落在光里」而不是浮空
      this.gfx.ellipse(x, spot.y + 8, 9, 3).fill({ color: 0xf5c451, alpha: 0.18 });
      // 红包本体：竖长钱包 + 深色封口 + 中间金色圆点
      this.gfx.rect(x - 5, y - 8, 10, 14).fill({ color: 0xd8322c, alpha: 0.95 });
      this.gfx.rect(x - 5, y - 8, 10, 4).fill({ color: 0x8f1d1a, alpha: 0.95 });
      this.gfx.circle(x, y, 2).fill({ color: 0xf5c451, alpha: 1 });
      // 闪光：两个十字亮片，用相位错开，读成「闪一下」
      const twinkle = (phase + i * 0.13) % 1;
      if (twinkle < 0.5) {
        const a = 1 - twinkle * 2;
        this.gfx.rect(x - 1, y - 15, 2, 4).fill({ color: 0xfff3c4, alpha: a });
        this.gfx.rect(x + 6, y - 4, 2, 4).fill({ color: 0xfff3c4, alpha: a * 0.8 });
      }
    }
  }

  private drawShock(now: number): void {
    if (this.shockSince === 0) return;
    const elapsed = now - this.shockSince;
    if (this.shockStage === BOSS_SHOCK_PHASE.Warn) {
      if (elapsed > BOSS_SHOCK.WarnMs + 200) {
        this.shockSince = 0;
        return;
      }
      const remain = Math.max(0, 1 - elapsed / BOSS_SHOCK.WarnMs);
      // 外圈：固定半径的红色虚线感描边（8 段弧，缝隙随倒计时收紧）
      this.gfx.circle(this.shockX, this.shockY, this.shockRadius).stroke({
        width: 2,
        color: 0xe6483c,
        alpha: 0.35 + 0.5 * (1 - remain),
      });
      // 内圈：从外缘向圆心收缩的填充盘，读成「警告正在逼近」
      const inner = this.shockRadius * (0.25 + 0.75 * remain);
      this.gfx.circle(this.shockX, this.shockY, inner).fill({ color: 0xe6483c, alpha: 0.08 });
      for (let i = 0; i < 8; i += 1) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = a0 + Math.PI / 8;
        this.gfx
          .arc(this.shockX, this.shockY, this.shockRadius, a0, a1)
          .stroke({ width: 3, color: 0xff6b5c, alpha: 0.75 });
      }
      return;
    }
    // 命中帧：一个快速扩散并淡出的实心环
    if (elapsed > SHOCK_FLASH_MS) {
      this.shockSince = 0;
      return;
    }
    const t = elapsed / SHOCK_FLASH_MS;
    const radius = this.shockRadius * (0.6 + 0.4 * t);
    this.gfx.circle(this.shockX, this.shockY, radius).stroke({
      width: 4,
      color: 0xff8a7a,
      alpha: 0.8 * (1 - t),
    });
    this.gfx.circle(this.shockX, this.shockY, radius * 0.92).fill({
      color: 0xe6483c,
      alpha: 0.16 * (1 - t),
    });
  }
}
