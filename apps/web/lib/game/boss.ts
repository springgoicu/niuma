'use client';

import { Container, Rectangle, Sprite, Text, type Application } from 'pixi.js';
import { BOSS, BOSS_ARENA, BOSS_MAX_HP } from '@niuma/shared-types';
import { BOSS_COLOR, BOSS_GRAY, drawBossBody, drawBossGround, drawBossPlate } from './boss-art';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 发泄区老板（ADR-0070）的视图。
 *
 * 三件事必须成立：
 * 1. **比例**：老板 200×256 texel，是角色（48 高）的五倍多，站在区心动都不动就有压迫感；
 *    脚底 y 进排序层，玩家能绕到背后被肚子挡住。
 * 2. **血条不重建**：满血条烘焙一次，之后每帧只写 `scale.x` 与 `text`（8Hz 节流），
 *    10000 点血连打一下午也不会产生垃圾。
 * 3. **倒下是一次状态切换**：整只换灰纹理、名牌换成纸板「老板倒下」，不是调透明度。
 */

const CJK_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

const PLATE_W = 96;
const PLATE_H = 28;
const BAR_W = 128;
const BAR_H = 10;
/** 血条槽到名牌之间留 4px，名牌底边压在老板头顶上方 */
const BAR_TOP = -(BOSS.height + 10);
const PLATE_TOP = BAR_TOP - 4 - PLATE_H;

/** 待机呼吸：3.4s 一次单纹素上浮，不做小数缩放，1px 描边不糊 */
const BREATH_MS = 3_400;
/** 受击抖动：140ms 内左右各跳两格 */
const SHAKE_MS = 140;
/** 倒地：300ms 内下沉 2px 再回位 */
const DIE_MS = 300;
/** 血量数字 8Hz 刷新，够跟手又不让 Text 每帧重建 */
const TEXT_INTERVAL_MS = 125;

const TAU = Math.PI * 2;

export class BossView {
  private readonly groundRoot = new Container();
  private readonly root = new Container();
  /** 老板本体：换纹理做倒地灰版，位置只承载抖动与呼吸 */
  private readonly body: Sprite;
  private readonly labels = new Container();
  private readonly barFill: Sprite;
  private readonly barBack: Sprite;
  private readonly plate: Sprite;
  private readonly plateText: Text;
  private readonly hpText: Text;
  private readonly texts: Text[] = [];
  /** 残血 / 倒下的吐槽气泡：只在档位翻转时改文案，不逐帧写 text */
  private readonly alertRoot = new Container();
  private alertText: Text | null = null;
  private alertTier: 0 | 1 | 2 = 0;
  private readonly alertBubbleTexture;
  private readonly colorTexture;
  private readonly grayTexture;
  private readonly woodPlate;
  private readonly cardPlate;
  private readonly barFillTexture;
  private readonly groundTexture;

  private hp = -1;
  private alive = true;
  private textResolution: number;
  private elapsedMs = 0;
  private shakeUntil = 0;
  private deadAt = -1;
  private textDirty = true;
  private lastTextAt = -Infinity;

  constructor(renderer: Application['renderer'], devicePxPerTexel: number) {
    this.textResolution = devicePxPerTexel;

    this.groundRoot.position.set(BOSS_ARENA.x, BOSS_ARENA.y);
    // 显式 frame：警示条斜纹会画出垫子边界，交给 bounds 自动量会把画布撑大、锚点整体偏移
    this.groundTexture = bake(renderer, (g) => drawBossGround(g, BOSS_ARENA.w, BOSS_ARENA.h), {
      frame: new Rectangle(0, 0, BOSS_ARENA.w, BOSS_ARENA.h),
    });
    const ground = new Sprite(this.groundTexture);
    this.groundRoot.addChild(ground);

    // 区名与印章：CJK 只能交给系统字体，字号按 texel 给，分辨率跟设备像素走
    const arenaTitle = this.makeText('发泄区', 24, 0xede6d6, 8, '600');
    arenaTitle.anchor.set(0.5, 0);
    // 靠右：垫子北侧正中会被 200 宽的老板头挡住，右边的空地才是能读字的
    arenaTitle.position.set(BOSS_ARENA.w - 100, 30);
    arenaTitle.alpha = 0.92;
    this.groundRoot.addChild(arenaTitle);

    const stamp = this.makeText('禁止内卷', 12, 0xd94f3d, 1, '600');
    stamp.anchor.set(0.5, 0.5);
    stamp.position.set(60, 37);
    stamp.alpha = 0.9;
    this.groundRoot.addChild(stamp);

    this.root.position.set(BOSS.x, BOSS.y);
    // 影子比脚底多出 5px，同样要锁 200×256：脚底必须正好落在 BOSS.y 上，和碰撞对齐
    const bodyFrame = new Rectangle(0, 0, BOSS.width, BOSS.height);
    this.colorTexture = bake(renderer, (g) => drawBossBody(g, BOSS_COLOR), { frame: bodyFrame });
    this.grayTexture = bake(renderer, (g) => drawBossBody(g, BOSS_GRAY), { frame: bodyFrame });
    this.body = new Sprite(this.colorTexture);
    this.body.anchor.set(0.5, 1);
    this.root.addChild(this.body);

    this.barFillTexture = bake(renderer, (g) => {
      g.rect(0, 0, BAR_W - 4, BAR_H - 4).fill(0xffffff);
      g.rect(0, 0, BAR_W - 4, 2).fill({ color: 0xffffff, alpha: 0.75 });
    }, {
      frame: new Rectangle(0, 0, BAR_W - 4, BAR_H - 4),
    });
    this.barBack = new Sprite(
      bake(renderer, (g) => {
        g.roundRect(0, 0, BAR_W, BAR_H, 3).fill(0x15171b);
        g.roundRect(1, 1, BAR_W - 2, BAR_H - 2, 2).fill(0x2f333a);
        g.rect(2, 2, BAR_W - 4, 1).fill({ color: 0x5b616b, alpha: 0.5 });
      }, {
        frame: new Rectangle(0, 0, BAR_W, BAR_H),
      }),
    );
    this.barBack.anchor.set(0.5, 0);
    this.barBack.position.set(0, BAR_TOP);

    this.barFill = new Sprite(this.barFillTexture);
    this.barFill.anchor.set(0, 0);
    this.barFill.position.set(-BAR_W / 2 + 2, BAR_TOP + 2);
    this.barFill.tint = 0xd94f3d;

    const plateFrame = new Rectangle(0, 0, PLATE_W, PLATE_H);
    this.woodPlate = bake(renderer, (g) => drawBossPlate(g, PLATE_W, PLATE_H, 'wood'), { frame: plateFrame });
    this.cardPlate = bake(renderer, (g) => drawBossPlate(g, PLATE_W, PLATE_H, 'cardboard'), {
      frame: plateFrame,
    });
    this.plate = new Sprite(this.woodPlate);
    this.plate.anchor.set(0.5, 0);
    this.plate.position.set(0, PLATE_TOP);

    this.plateText = this.makeText('老板', 13, 0xf5efd8, 2, '600');
    this.plateText.anchor.set(0.5, 0.5);
    this.plateText.position.set(0, PLATE_TOP + PLATE_H / 2);

    this.hpText = this.makeText('', 9, 0xede6d6, 1, '400');
    this.hpText.anchor.set(0, 0.5);
    this.hpText.position.set(BAR_W / 2 + 8, BAR_TOP + BAR_H / 2);

    // 残血吐槽气泡：奶白硬边 + 小尖角，压在名牌上方；默认不显示
    const bubbleTexture = bake(
      renderer,
      (g) => {
        g.roundRect(0, 0, 118, 22, 4).fill(0x1b2233);
        g.roundRect(1, 1, 116, 20, 3).fill(0xf5efd8);
        g.rect(2, 2, 114, 1).fill(0xfffcf2);
        // 尖角指向老板头顶
        g.poly([54, 22, 64, 22, 59, 28]).fill(0x1b2233);
        g.poly([55, 22, 63, 22, 59, 27]).fill(0xf5efd8);
      },
      { frame: new Rectangle(0, 0, 118, 28) },
    );
    this.alertBubbleTexture = bubbleTexture;
    const bubble = new Sprite(bubbleTexture);
    bubble.anchor.set(0.5, 1);
    bubble.position.set(0, PLATE_TOP - 2);
    this.alertRoot.addChild(bubble);
    this.alertText = this.makeText('', 11, 0x2a3142, 1, '600');
    this.alertText.anchor.set(0.5, 1);
    this.alertText.position.set(0, PLATE_TOP - 6);
    this.alertRoot.addChild(this.alertText);
    this.alertRoot.visible = false;

    this.labels.position.copyFrom(this.root.position);
    this.labels.addChild(this.barBack, this.barFill, this.plate, this.plateText, this.hpText, this.alertRoot);
    this.applyHp(BOSS_MAX_HP);
  }

  private makeText(text: string, size: number, fill: number, spacing: number, weight: '400' | '600'): Text {
    const label = new Text({
      text,
      resolution: this.textResolution,
      style: { fontFamily: CJK_FONT, fontSize: size, fontWeight: weight, fill, letterSpacing: spacing },
    });
    this.texts.push(label);
    return label;
  }

  /** 地面垫子进地面装饰层，本体按脚底 y 进排序层，名牌与血条进标签层 */
  build(depth: DepthSink, ground: Container, labels: Container): void {
    ground.addChild(this.groundRoot);
    depth.add(BOSS.y, this.root);
    labels.addChild(this.labels);
  }

  /** 服务端广播的血量：0 点即倒地，归零只切换一次状态 */
  setHp(hp: number): void {
    this.applyHp(hp);
  }

  /**
   * 血量档位（0 正常 / 1 残血 / 2 倒下）：只有翻转时才写一次文案。
   *
   * 与血条颜色同一把尺子（<30% 转橙），但房间氛围读的是这里，不各自再算一遍比例。
   */
  setAlert(tier: 0 | 1 | 2): void {
    if (tier === this.alertTier) return;
    this.alertTier = tier;
    const bubble = this.alertRoot;
    if (tier === 0) {
      bubble.visible = false;
      return;
    }
    bubble.visible = true;
    const text = tier === 2 ? '让我缓一会儿…' : '这届牛马有点猛…';
    const label = this.alertText;
    if (label && label.text !== text) label.text = text;
  }

  /** 本地踢中反馈：立刻抖一下，不等服务端回包 */
  flashHit(): void {
    this.shakeUntil = this.elapsedMs + SHAKE_MS;
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.textResolution === devicePxPerTexel) return;
    this.textResolution = devicePxPerTexel;
    for (const text of this.texts) {
      if (text.resolution !== devicePxPerTexel) text.resolution = devicePxPerTexel;
    }
  }

  /** 每帧推进：呼吸、抖动、倒地下沉与数字节流，全部只写标量 */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.elapsedMs += dtMs;
    const now = this.elapsedMs;

    const remain = this.shakeUntil - now;
    const shakeX = remain > 0 ? (Math.floor(remain / 35) % 2 === 0 ? 1 : -1) : 0;
    this.body.tint = remain > 0 ? 0xffe4e4 : 0xffffff;

    // 呼吸只有活着才有：倒下的人不会再起伏
    const bob = this.alive && Math.sin((now / BREATH_MS) * TAU) > 0.55 ? 1 : 0;

    let drop = 0;
    if (this.deadAt >= 0) {
      const since = now - this.deadAt;
      if (since < DIE_MS) drop = Math.round(Math.sin((since / DIE_MS) * Math.PI) * 2);
      else this.deadAt = -1;
    }

    const y = bob + drop;
    if (this.body.position.x !== shakeX || this.body.position.y !== y) {
      this.body.position.set(shakeX, y);
    }

    if (this.textDirty && now - this.lastTextAt >= TEXT_INTERVAL_MS) this.syncText(now);
  }

  private applyHp(hp: number): void {
    const next = Math.max(0, Math.min(BOSS_MAX_HP, Math.round(hp)));
    if (next === this.hp) return;
    this.hp = next;

    const alive = next > 0;
    if (alive !== this.alive) {
      this.alive = alive;
      this.body.texture = alive ? this.colorTexture : this.grayTexture;
      this.plate.texture = alive ? this.woodPlate : this.cardPlate;
      this.plateText.text = alive ? '老板' : '老板倒下';
      this.plateText.style.fontSize = alive ? 13 : 12;
      this.plateText.style.fill = alive ? 0xf5efd8 : 0x3a2a1c;
      if (!alive) this.deadAt = this.elapsedMs;
    }

    const ratio = next / BOSS_MAX_HP;
    this.barFill.scale.x = ratio;
    // 残血转橙：玩家在远处也能从颜色读出「今天快打死了」
    this.barFill.tint = ratio > 0 && ratio < 0.3 ? 0xf2994a : 0xd94f3d;
    this.textDirty = true;
  }

  private syncText(now: number): void {
    this.textDirty = false;
    this.lastTextAt = now;
    const text = `${this.hp} / ${BOSS_MAX_HP}`;
    if (this.hpText.text !== text) this.hpText.text = text;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.labels.destroy({ children: true });
    this.groundRoot.destroy({ children: true });
    this.colorTexture.destroy(true);
    this.grayTexture.destroy(true);
    this.woodPlate.destroy(true);
    this.cardPlate.destroy(true);
    this.barFillTexture.destroy(true);
    this.groundTexture.destroy(true);
    this.alertBubbleTexture.destroy(true);
  }
}
