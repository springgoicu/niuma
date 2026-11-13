'use client';

import { Container, Graphics, Sprite, Text, type Application, type Texture } from 'pixi.js';
import {
  RING_ARENA,
  RING_AWARD_MS,
  RING_PHASE,
  RING_PODIUM_SLOTS,
  type RingPacket,
} from '@niuma/shared-types';
import {
  RING_COLORS,
  RING_GROUND_FRAME,
  RING_POST_FRAME,
  RING_STEP_FRAME,
  RING_TROPHY_FRAME,
  drawPodiumStep,
  drawRingGround,
  drawRingPost,
  drawTrophy,
} from './ring-art';
import { bake } from './terrain-textures';
import type { DepthSink } from './sort-layer';

/**
 * 擂台的表现层（ADR-0073）。
 *
 * 服务端只给阶段、名次与血量；这里负责三件「看得见」的事：
 * 1. 擂台垫、围绳与角柱是静态的，烘焙一次即可；
 * 2. 颁奖时三阶领奖台升起、冠军头顶奖杯、彩带自上落下；
 * 3. 其余阶段保持安静——比赛中的信息密度交给 HUD，场地不抢注意力。
 */

const CJK_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

/** 领奖台升起：600ms 从垫面弹到台面高度，缓出但不回弹 */
const RISE_MS = 600;
/** 奖杯上下浮动周期 */
const TROPHY_BOB_MS = 1_600;
/**
 * 彩带节奏按 4 秒颁奖窗口排（ADR-0076）：2.2s 内生成完毕，最后一颗正好在
 * 窗口关闭时落尽。窗口只有原来的一半，所以下落速度相应加快，否则彩带会
 * 停半空里被整片切掉。
 */
const CONFETTI_SPAWN_MS = 2_200;
const CONFETTI_LIFE_MS = 1_800;
const CONFETTI_MAX = 46;
const CONFETTI_INTERVAL_MS = 90;
/** 颁奖窗口收尾淡出：最后 240ms 整体渐隐，避免阶段切换时硬切 */
const AWARD_FADE_MS = 240;

const TAU = Math.PI * 2;

interface ConfettiPiece {
  view: Graphics;
  x: number;
  y: number;
  vy: number;
  sway: number;
  swayPhase: number;
  spin: number;
  rot: number;
  age: number;
  life: number;
}

function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export class RingView {
  private readonly groundRoot = new Container();
  private readonly postRoots: Container[] = [];
  private readonly overlayRoot = new Container();
  private readonly podiumRoot = new Container();
  private readonly trophy: Sprite;
  private readonly steps: Sprite[] = [];
  private readonly podiumTexts: Text[] = [];
  private readonly textures: Texture[] = [];
  private readonly texts: Text[] = [];
  private readonly confetti: ConfettiPiece[] = [];

  private textResolution: number;
  private phase: number = RING_PHASE.Idle;
  private elapsedMs = 0;
  private awardAt = -1;
  private spawnAccumulator = 0;
  private rngState = 0x9e3779b9;

  constructor(renderer: Application['renderer'], devicePxPerTexel: number) {
    this.textResolution = devicePxPerTexel;

    // 垫子：位置锁在世界坐标，纹理帧固定 300×260
    const groundTexture = this.track(bake(renderer, (g) => drawRingGround(g, RING_ARENA.w, RING_ARENA.h), {
      frame: RING_GROUND_FRAME,
    }));
    this.groundRoot.position.set(RING_ARENA.x, RING_ARENA.y);
    this.groundRoot.addChild(new Sprite(groundTexture));

    const title = this.makeText('南院擂台', 20, RING_COLORS.cream, 6, '600');
    title.anchor.set(0.5, 0);
    title.position.set(RING_ARENA.w / 2, 26);
    title.alpha = 0.86;
    this.groundRoot.addChild(title);

    const rule = this.makeText('10 血 · 三人为限 · 打完即开奖', 10, RING_COLORS.rope, 2);
    rule.anchor.set(0.5, 0);
    rule.position.set(RING_ARENA.w / 2, 52);
    rule.alpha = 0.7;
    this.groundRoot.addChild(rule);

    // 角柱：四根独立容器，各自按脚底 y 进排序层
    const postTexture = this.track(bake(renderer, (g) => drawRingPost(g), { frame: RING_POST_FRAME }));
    const inset = 34;
    for (const [x, y] of [
      [RING_ARENA.x + inset, RING_ARENA.y + inset],
      [RING_ARENA.x + RING_ARENA.w - inset, RING_ARENA.y + inset],
      [RING_ARENA.x + inset, RING_ARENA.y + RING_ARENA.h - inset],
      [RING_ARENA.x + RING_ARENA.w - inset, RING_ARENA.y + RING_ARENA.h - inset],
    ] as const) {
      const root = new Container();
      const post = new Sprite(postTexture);
      post.anchor.set(0.5, 1);
      root.position.set(x, y);
      root.addChild(post);
      this.postRoots.push(root);
    }

    // 覆盖层：领奖台、奖杯、名次字与彩带共用同一坐标系（擂台左上角为原点）
    this.overlayRoot.position.set(RING_ARENA.x, RING_ARENA.y);
    this.overlayRoot.visible = false;
    this.overlayRoot.addChild(this.podiumRoot);

    const stepTextures = [
      this.track(bake(renderer, (g) => drawPodiumStep(g, RING_COLORS.brass, RING_COLORS.brassDark, 30), {
        frame: RING_STEP_FRAME,
      })),
      this.track(bake(renderer, (g) => drawPodiumStep(g, 0xb9c0c6, 0x7c858c, 20), {
        frame: RING_STEP_FRAME,
      })),
      this.track(bake(renderer, (g) => drawPodiumStep(g, 0xb07a4e, 0x774f2e, 12), {
        frame: RING_STEP_FRAME,
      })),
    ] as const;

    for (let i = 0; i < RING_PODIUM_SLOTS.length; i += 1) {
      const slot = RING_PODIUM_SLOTS[i]!;
      const sprite = new Sprite(stepTextures[i]!);
      sprite.anchor.set(0.5, 0);
      sprite.position.set(slot.x - RING_ARENA.x, slot.y - RING_ARENA.y - 15);
      sprite.visible = false;
      this.podiumRoot.addChild(sprite);
      this.steps.push(sprite);
    }

    this.trophy = new Sprite(
      this.track(bake(renderer, (g) => drawTrophy(g, RING_COLORS.brass, RING_COLORS.brassDark), {
        frame: RING_TROPHY_FRAME,
      })),
    );
    this.trophy.anchor.set(0.5, 1);
    this.trophy.position.set(
      RING_PODIUM_SLOTS[0]!.x - RING_ARENA.x,
      RING_PODIUM_SLOTS[0]!.y - RING_ARENA.y - 70,
    );
    this.trophy.visible = false;
    this.overlayRoot.addChild(this.trophy);

    const titles = ['冠军', '亚军', '季军'];
    const fills = [0xf0d79a, 0xd8dee4, 0xd9a97a];
    for (let i = 0; i < RING_PODIUM_SLOTS.length; i += 1) {
      const slot = RING_PODIUM_SLOTS[i]!;
      const label = this.makeText(titles[i]!, 11, fills[i]!, 1, '600');
      label.anchor.set(0.5, 1);
      label.position.set(slot.x - RING_ARENA.x, slot.y - RING_ARENA.y - 34);
      label.visible = false;
      this.overlayRoot.addChild(label);
      this.podiumTexts.push(label);
    }
  }

  private track(texture: Texture): Texture {
    this.textures.push(texture);
    return texture;
  }

  private makeText(text: string, size: number, fill: number, spacing: number, weight: '400' | '600' = '400'): Text {
    const label = new Text({
      text,
      resolution: this.textResolution,
      style: { fontFamily: CJK_FONT, fontSize: size, fontWeight: weight, fill, letterSpacing: spacing },
    });
    this.texts.push(label);
    return label;
  }

  /** 垫与字进地面层、角柱进排序层、领奖台与彩带进覆盖层 */
  build(depth: DepthSink, ground: Container, overlay: Container): void {
    ground.addChild(this.groundRoot);
    for (const root of this.postRoots) depth.add(root.position.y, root);
    overlay.addChild(this.overlayRoot);
  }

  /** 服务端阶段：只在颁奖开始那一刻播一次开奖动画，重复广播不重播 */
  setState(packet: RingPacket | null): void {
    const phase = packet?.phase ?? RING_PHASE.Idle;
    if (phase === RING_PHASE.Award && this.phase !== RING_PHASE.Award) {
      this.resetAward();
      this.awardAt = this.elapsedMs;
      this.overlayRoot.visible = true;
      this.trophy.visible = true;
      for (const step of this.steps) {
        step.visible = true;
        step.alpha = 0;
        step.y = this.targetY(step) + 18;
      }
    } else if (phase !== RING_PHASE.Award && this.phase === RING_PHASE.Award) {
      this.resetAward();
    }
    this.phase = phase;
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.textResolution === devicePxPerTexel) return;
    this.textResolution = devicePxPerTexel;
    for (const text of this.texts) {
      if (text.resolution !== devicePxPerTexel) text.resolution = devicePxPerTexel;
    }
  }

  /** 每帧推进：领奖台升起、奖杯浮动、彩带下落 */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.elapsedMs += dtMs;

    if (this.overlayRoot.visible && this.awardAt >= 0) {
      const since = this.elapsedMs - this.awardAt;
      // 窗口末尾整体淡出：阶段包到达时 resetAward 会直接隐藏覆盖层
      const fadeStart = RING_AWARD_MS - AWARD_FADE_MS;
      this.overlayRoot.alpha =
        since >= fadeStart ? Math.max(0, 1 - (since - fadeStart) / AWARD_FADE_MS) : 1;
      const progress = easeOutCubic(since / RISE_MS);
      for (const step of this.steps) {
        step.alpha = Math.min(1, progress * 1.4);
        step.y = this.targetY(step) + 18 * (1 - progress);
      }
      if (progress >= 1) {
        for (const label of this.podiumTexts) label.visible = true;
      }

      const bob = Math.sin((this.elapsedMs / TROPHY_BOB_MS) * TAU) * 3;
      this.trophy.y = RING_PODIUM_SLOTS[0]!.y - RING_ARENA.y - 70 + bob;

      if (since < CONFETTI_SPAWN_MS) {
        this.spawnAccumulator += dtMs;
        while (this.spawnAccumulator >= CONFETTI_INTERVAL_MS && this.confetti.length < CONFETTI_MAX) {
          this.spawnAccumulator -= CONFETTI_INTERVAL_MS;
          this.spawnConfetti();
        }
      }
    }

    this.updateConfetti(dtMs);
  }

  private targetY(step: Sprite): number {
    const index = this.steps.indexOf(step);
    const slot = RING_PODIUM_SLOTS[index]!;
    return slot.y - RING_ARENA.y - 15;
  }

  private spawnConfetti(): void {
    const piece = new Graphics();
    const colors = [RING_COLORS.brass, RING_COLORS.cream, RING_COLORS.red, RING_COLORS.teal];
    const color = colors[this.randomInt(colors.length)] ?? RING_COLORS.brass;
    piece.rect(0, 0, 3 + this.randomInt(2), 6).fill(color);
    piece.position.set(this.randomInt(RING_ARENA.w), this.randomInt(40) - 34);
    piece.rotation = this.randomInt(6) * 0.5;
    this.overlayRoot.addChild(piece);

    this.confetti.push({
      view: piece,
      x: piece.position.x,
      y: piece.position.y,
      vy: 70 + this.randomInt(50),
      sway: 6 + this.randomInt(12),
      swayPhase: this.randomInt(628) / 100,
      spin: (this.randomInt(2) === 0 ? -1 : 1) * (0.6 + this.randomInt(3) * 0.4),
      rot: piece.rotation,
      age: 0,
      life: CONFETTI_LIFE_MS - this.randomInt(900),
    });
  }

  private updateConfetti(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let i = this.confetti.length - 1; i >= 0; i -= 1) {
      const piece = this.confetti[i]!;
      piece.age += dtMs;
      piece.y += piece.vy * dt;
      piece.x += Math.sin((piece.age / 1_000) * TAU + piece.swayPhase) * piece.sway * dt;
      piece.rot += piece.spin * dt;
      const life = piece.age / piece.life;
      piece.view.position.set(piece.x, piece.y);
      piece.view.rotation = piece.rot;
      piece.view.alpha = life > 0.72 ? 1 - (life - 0.72) / 0.28 : 1;
      if (piece.age >= piece.life || piece.y > RING_ARENA.h + 40) {
        piece.view.destroy();
        this.confetti.splice(i, 1);
      }
    }
  }

  private resetAward(): void {
    this.awardAt = -1;
    this.overlayRoot.visible = false;
    // 淡出会改 alpha；不复位的话下一局开奖会从半透明开始
    this.overlayRoot.alpha = 1;
    this.trophy.visible = false;
    for (const step of this.steps) step.visible = false;
    for (const label of this.podiumTexts) label.visible = false;
    for (const piece of this.confetti) piece.view.destroy();
    this.confetti.length = 0;
  }

  destroy(): void {
    this.resetAward();
    this.groundRoot.destroy({ children: true });
    for (const root of this.postRoots) root.destroy({ children: true });
    this.overlayRoot.destroy({ children: true });
    for (const texture of this.textures) texture.destroy(true);
  }

  private randomInt(max: number): number {
    // xorshift32：彩带位置不需要密码学随机，但要可复现、不调 Math.random
    let state = this.rngState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.rngState = state >>> 0;
    return this.rngState % max;
  }
}
