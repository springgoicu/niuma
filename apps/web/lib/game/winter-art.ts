'use client';

import { Container, Graphics, Rectangle, Sprite, type Application, type Texture } from 'pixi.js';
import { DOOR_PLAQUES, WELCOME_LANDMARKS, WORLD_LAYOUT } from '@niuma/shared-types';
import { lightToneAt } from './lighting/tone';
import { serverHourFraction } from './server-date';
import { serverNow, serverTzOffsetMin } from './server-clock';
import type { DepthSink } from './sort-layer';
import { WINTER_COLORS as W } from './terrain-palette';
import { bake } from './terrain-textures';

/**
 * 冬季静态道具：雪人、雪堆、树上灯串、屋檐冰棱（ADR-0046）。
 *
 * 全部是纯装饰，**不参与碰撞**，也不进 `packages/shared-types`：
 * 服务端权威结算用的是静态几何，一旦雪人变成障碍，冬夏的可行走区域就会不同，
 * 而服务端并不知道谁在看雪景。所以雪人只摆在视觉上「本来就该绕着走」的位置
 * （中庭四角、庭院边缘），玩家能穿过去也不别扭。
 */

type TextureFactory = Application['renderer'];

const SNOWMAN = { w: 20, h: 34 };
const PILE = { w: 30, h: 16 };
const BULBS = { w: 46, h: 22 };

/**
 * 手写坐标（与地图同一纪律：不依赖随机，改一处就是改一处）。
 * 中庭四角留出十字通道，道具只压边角；休息庭院沿长椅与野餐桌之间点缀。
 */
const SNOWMEN: ReadonlyArray<{ x: number; y: number; variant: 0 | 1 }> = [
  { x: 3862, y: 3906, variant: 0 },
  { x: 4338, y: 4302, variant: 1 },
  { x: 3762, y: 5446, variant: 0 },
];

const PILES: ReadonlyArray<{ x: number; y: number; variant: 0 | 1 | 2 }> = [
  { x: 3918, y: 3862, variant: 1 },
  { x: 4274, y: 3872, variant: 0 },
  { x: 3878, y: 4274, variant: 2 },
  { x: 4312, y: 4238, variant: 1 },
  { x: 3560, y: 5226, variant: 0 },
  { x: 4570, y: 5440, variant: 2 },
  { x: 4040, y: 5610, variant: 1 },
];

/** 灯串挂到哪几棵树上：按树的序号取模，同一棵永远亮同一串，不随帧变化 */
const BULB_TREE_EVERY = 9;

export class WinterArt {
  private readonly textures: Texture[] = [];
  /** 灯串亮度靠逐串 alpha：串数只有几十个，30s 才改一次，比多一层容器更好排序 */
  private readonly bulbs: Sprite[] = [];
  private nextBulbSample = 0;

  /**
   * `depth` 收雪人 / 雪堆 / 灯串（会被树冠与角色正确遮挡），
   * `base` 收屋檐冰棱（贴墙的静态图元，合进一张 Graphics，不逐根建精灵）。
   */
  attach(depth: DepthSink, base: Container, renderer: TextureFactory): void {
    const snowmanTextures = [this.makeSnowman(renderer, 0), this.makeSnowman(renderer, 1)];
    const pileTextures = [0, 1, 2].map((variant) => this.makePile(renderer, variant as 0 | 1 | 2));

    for (const spot of SNOWMEN) {
      this.place(depth, snowmanTextures[spot.variant]!, spot.x, spot.y);
    }
    for (const spot of PILES) {
      this.place(depth, pileTextures[spot.variant]!, spot.x, spot.y);
    }

    this.addBulbs(depth, renderer);
    this.addIcicles(base);
    this.addSnowDrifts(base);
    this.applyBulbBrightness();
  }

  /** 30s 采样一次亮度：与柔光层同频，不新增每帧计算 */
  update(nowMs: number): void {
    if (nowMs < this.nextBulbSample) return;
    this.nextBulbSample = nowMs + 30_000;
    this.applyBulbBrightness();
  }

  destroy(): void {
    for (const sprite of this.bulbs) sprite.destroy();
    this.bulbs.length = 0;
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
  }

  private place(depth: DepthSink, texture: Texture, x: number, y: number): void {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, y);
    depth.add(y, sprite);
  }

  /** 雪人：两团雪球 + 胡萝卜鼻 + 围巾与帽子，variant 只换围巾色 */
  private makeSnowman(renderer: TextureFactory, variant: 0 | 1): Texture {
    const scarf = variant === 0 ? 0xe8856d : 0x6aa8e0;
    const scarfDark = variant === 0 ? 0xc4624c : 0x4a7fb5;
    const texture = bake(
      renderer,
      (g) => {
        // 落地投影：融雪的地面是湿的，影子比常规道具更淡更扁
        g.ellipse(10, 32, 9, 2).fill({ color: W.snowDeep, alpha: 0.4 });
        // 下团
        g.ellipse(10, 25, 8, 7).fill(W.snowShade);
        g.ellipse(10, 24, 7, 6).fill(W.snowBase);
        g.ellipse(8, 22, 3, 2).fill(W.snowLight);
        // 上团
        g.ellipse(10, 13, 6, 6).fill(W.snowShade);
        g.ellipse(10, 12, 5, 5).fill(W.snowBase);
        g.ellipse(8, 10, 2, 2).fill(W.snowLight);
        // 眼睛与胡萝卜鼻：鼻子朝右，雪人才有朝向
        g.rect(8, 11, 1, 1).fill(0x2a3142);
        g.rect(12, 11, 1, 1).fill(0x2a3142);
        g.rect(10, 13, 4, 1).fill(0xe8856d);
        g.rect(14, 13, 1, 1).fill(0xc4624c);
        // 围巾：一圈 + 一段垂下的角
        g.rect(5, 17, 11, 2).fill(scarf);
        g.rect(5, 19, 3, 4).fill(scarfDark);
        g.rect(6, 19, 2, 3).fill(scarf);
        // 帽子：小桶帽，压一圈亮边
        g.rect(6, 5, 9, 2).fill(0x4a5470);
        g.rect(7, 1, 7, 4).fill(0x4a5470);
        g.rect(8, 2, 5, 1).fill(0x6b7794);
        g.rect(10, 3, 1, 2).fill(scarf);
        // 扣子
        g.rect(9, 20, 1, 1).fill(0x4a5470);
        g.rect(10, 23, 1, 1).fill(0x4a5470);
      },
      { frame: new Rectangle(0, 0, SNOWMAN.w, SNOWMAN.h) },
    );
    this.textures.push(texture);
    return texture;
  }

  /** 雪堆：三档高度，边缘留一道雪影，堆里压几粒碎冰 */
  private makePile(renderer: TextureFactory, variant: 0 | 1 | 2): Texture {
    const heights = [8, 11, 14];
    const h = heights[variant]!;
    const texture = bake(
      renderer,
      (g) => {
        const cx = PILE.w / 2;
        const baseY = PILE.h - 2;
        g.ellipse(cx, baseY, 13, 2).fill({ color: W.snowDeep, alpha: 0.35 });
        // 主体：下沿宽、顶上收，像被风吹出来的丘
        g.ellipse(cx, baseY - h * 0.25, 12, h * 0.45).fill(W.snowShade);
        g.ellipse(cx, baseY - h * 0.25, 11, h * 0.38).fill(W.snowBase);
        g.ellipse(cx - 2, baseY - h * 0.4, 6, h * 0.24).fill(W.snowLight);
        // 风痕：几道 2–4px 的浅沟
        for (let i = 0; i < 3; i += 1) {
          const x = cx - 7 + i * 6;
          g.rect(x, baseY - h * 0.2 - i, 3 + (i % 2), 1).fill(W.snowShade);
        }
        // 碎冰：堆顶偶尔露一点冷色
        g.rect(cx + 4, baseY - h * 0.55, 2, 1).fill(W.iceBase);
        g.rect(cx - 6, baseY - h * 0.5, 1, 1).fill(W.iceBase);
      },
      { frame: new Rectangle(0, 0, PILE.w, PILE.h) },
    );
    this.textures.push(texture);
    return texture;
  }

  /**
   * 树上灯串：一棵树一串，锚点在树冠下三分之一。
   *
   * 只挂一部分树（按序号取模）：整片林子都亮就变成装饰灯会，
   * 稀稀拉拉几串才读得出「有人在布置园区」。
   */
  private addBulbs(depth: DepthSink, renderer: TextureFactory): void {
    const texture = bake(
      renderer,
      (g) => {
        // 串线：一段下垂的弧，用 1px 阶梯拼，避免抗锯齿
        const line = 0x8a6446;
        for (let i = 0; i < BULBS.w; i += 1) {
          const sag = Math.sin((i / (BULBS.w - 1)) * Math.PI) * 5;
          g.rect(i, 2 + Math.round(sag), 1, 1).fill(line);
        }
        // 灯泡：暖黄为主，隔几颗换一档亮核
        for (let i = 2; i < BULBS.w - 2; i += 5) {
          const sag = Math.sin((i / (BULBS.w - 1)) * Math.PI) * 5;
          const y = 3 + Math.round(sag);
          g.rect(i, y, 1, 2).fill(W.bulbWarm);
          if (i % 10 === 2) g.rect(i, y, 1, 1).fill(W.bulbCore);
        }
      },
      { frame: new Rectangle(0, 0, BULBS.w, BULBS.h) },
    );
    this.textures.push(texture);

    const trees = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];
    for (let i = 0; i < trees.length; i += BULB_TREE_EVERY) {
      const tree = trees[i]!;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0);
      // 挂在树冠下三分之一：再高会被树冠盖住，再低就飘在树干上
      sprite.position.set(tree.x, tree.y - 44);
      depth.add(tree.y - 44, sprite);
      this.bulbs.push(sprite);
    }
  }

  /** 灯串亮度：白天几乎不显（0.22），黄昏起亮，夜里拉满；30s 才改一次 */
  private applyBulbBrightness(): void {
    const hour = serverHourFraction(serverNow(), serverTzOffsetMin());
    const label = lightToneAt(hour, true).label;
    const alpha = label === 'night' ? 1 : label === 'dusk' ? 0.62 : 0.22;
    for (const sprite of this.bulbs) sprite.alpha = alpha;
  }

  /**
   * 铺装收边的雪齿：雪从草地跨到石砖/木台上时不再是一条直角硬线。
   *
   * 雪层只有「岛轮廓」一级遮罩（`terrain.ts` 的 `addSnowCover`），
   * 而边缘系统的六种材质里没有「铺装 / 室内地板」，所以雪与铺装的交界此前是硬切。
   * 这里沿每条铺装的四条外边各撒一排 1–3px 的雪齿，**画在铺装外侧**：
   * 门洞与拱门 44px 内自动跳过，天然在门口断开，不糊住门槛。
   *
   * 全部合成一张 Graphics：几百个矩形、一次绘制，无逐帧成本，也不参与碰撞。
   */
  private addSnowDrifts(base: Container): void {
    const drifts = new Graphics();
    // 门洞列表：门牌（每处场所入口）与迎宾拱门
    const holes: ReadonlyArray<{ x: number; y: number }> = [
      ...DOOR_PLAQUES.map((plaque) => ({ x: plaque.x, y: plaque.depthY })),
      { x: WELCOME_LANDMARKS.arch.x, y: WELCOME_LANDMARKS.arch.y },
    ];
    const blocked = (x: number, y: number): boolean => {
      for (const hole of holes) {
        if (Math.abs(hole.x - x) < 44 && Math.abs(hole.y - y) < 90) return true;
      }
      return false;
    };
    const tooth = (x: number, y: number, horizontal: boolean): void => {
      if (blocked(x, y)) return;
      const n = (Math.imul(x + 7, 2654435761) ^ Math.imul(y + 13, 2246822519)) >>> 0;
      const tall = 1 + (n % 3);
      const wide = 5 + ((n >>> 5) % 4);
      if (horizontal) {
        drifts.rect(x, y - tall, wide, tall).fill(W.snowBase);
        drifts.rect(x, y - 1, wide, 1).fill(W.snowShade);
      } else {
        drifts.rect(x - tall, y, tall, wide).fill(W.snowBase);
        drifts.rect(x - 1, y, 1, wide).fill(W.snowShade);
      }
    };

    for (const area of WORLD_LAYOUT.paved) {
      // 上沿：雪落在铺装之外（北侧草地上），下沿同理；左右两沿竖着堆
      for (let x = area.x + 2; x < area.x + area.w - 2; x += 9) {
        tooth(x, area.y, true);
        tooth(x, area.y + area.h + 3, true);
      }
      for (let y = area.y + 2; y < area.y + area.h - 2; y += 9) {
        tooth(area.x, y, false);
        tooth(area.x + area.w + 3, y, false);
      }
    }
    base.addChild(drifts);
  }

  /**
   * 屋檐冰棱：沿横向墙的外侧（墙的下沿）挂一排 3–6px 的短冰柱。
   *
   * 只画横向墙：竖墙在正交视角下没有可见的檐口，挂上去会读成墙上的白点。
   * 门洞两侧的墙本来就是拆开的两段，冰棱天然在门口断开。
   */
  private addIcicles(base: Container): void {
    const icicles = new Graphics();
    let drawn = 0;
    for (const solid of WORLD_LAYOUT.solids) {
      if (solid.kind !== 'wall') continue;
      // 横向墙：宽远大于高
      if (solid.w < 24 || solid.w < solid.h * 3) continue;
      const edgeY = solid.y + solid.h;
      for (let x = solid.x + 2; x < solid.x + solid.w - 2; x += 7) {
        // 位置哈希代替随机：同一面墙的冰棱每次进服都长在同一处
        const n = ((Math.imul(x, 2654435761) ^ Math.imul(edgeY, 2246822519)) >>> 0) % 100;
        if (n < 42) continue;
        const length = 3 + (n % 4);
        const color = n > 72 ? W.iceBase : W.iceEdge;
        icicles.rect(x, edgeY, 1, length).fill(color);
        if (length > 4) icicles.rect(x, edgeY + length - 2, 1, 1).fill(W.snowLight);
        drawn += 1;
        if (drawn >= 400) break;
      }
      if (drawn >= 400) break;
    }
    base.addChild(icicles);
  }
}
