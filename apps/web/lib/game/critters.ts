'use client';

import { Container, Sprite } from 'pixi.js';
import { isBlocked, isWadingAt } from '@niuma/shared-types';
import {
  CRITTER_CELL,
  CRITTER_FEET,
  GROUND_FRAMES,
  GROUND_VIEWS,
  butterflyCell,
  groundCell,
  type CritterArt,
} from './critter-art';
import {
  createButterfly,
  createGroundCritter,
  stepButterfly,
  stepGroundCritter,
  type Butterfly,
  type GroundCritter,
} from './critter-motion';
import { planButterflies, planGroundCritters } from './critter-spawn';
import { seeded } from './seeded';
import type { DepthSink } from './sort-layer';

/**
 * 园区氛围层：地面小动物 + 蝴蝶。
 *
 * 性能契约（ADR-0042）：
 * 1. **人口固定**：构造期一次性建满精灵，运行期不增删、不 `new`；
 * 2. **视口外不更新**：屏外的动物既不跑状态机也不写坐标，只是 `visible = false`；
 *    同屏通常 2–4 只，真正参与模拟的也就是这几只；
 * 3. **帧内零分配**：所有状态是长生命周期标量对象，纹理/坐标/flip 都先比较再写，
 *    避免每帧把 Pixi 的脏标记推起来；
 * 4. **贴图来自单张图集**：所有小动物共用一个 `TextureSource`，稳定合批。
 */

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 视口外的余量：与角色裁剪同一思路，回来时不会「凭空出现」在屏幕边缘 */
const CULL_PAD = 96;
/** 小动物的碰撞半径：能钻树缝、但不进水里 */
const CRITTER_RADIUS = 4;
const ANCHOR_Y = CRITTER_FEET / CRITTER_CELL;

export class CritterField {
  /** 蝴蝶单独一层：飞在空中，不进 y 排序层，也不会被树冠吃掉 */
  readonly butterflyLayer = new Container();

  private readonly ground: GroundCritter[] = [];
  private readonly flying: Butterfly[] = [];
  private readonly groundSprites: Sprite[] = [];
  private readonly flySprites: Sprite[] = [];

  /** 每只动物的帧基址 / 上次写入的纹理与坐标 / 上次的镜像状态：全部 TypedArray，零分配 */
  private readonly groundBase: Int32Array;
  private readonly groundTex: Int16Array;
  private readonly groundX: Int32Array;
  private readonly groundY: Int32Array;
  private readonly groundFlip: Int8Array;
  private readonly flyTex: Int16Array;
  private readonly flyX: Int32Array;
  private readonly flyY: Int32Array;

  /** 碰撞判定是稳定引用：构造期建一次，帧循环里传引用而不是新建闭包 */
  private readonly canStand = (x: number, y: number): boolean =>
    !isBlocked(x, y, CRITTER_RADIUS) && !isWadingAt(x, y);

  private readonly random: () => number;
  private readonly art: CritterArt;
  private readonly depth: DepthSink;
  private visible = 0;

  constructor(depth: DepthSink, art: CritterArt, seed: number) {
    this.depth = depth;
    this.art = art;
    this.random = seeded(seed);

    const spawns = planGroundCritters(seed);
    const butterflies = planButterflies(seed);

    this.groundBase = new Int32Array(spawns.length);
    this.groundTex = new Int16Array(spawns.length).fill(-1);
    this.groundX = new Int32Array(spawns.length).fill(0x7fffffff);
    this.groundY = new Int32Array(spawns.length).fill(0x7fffffff);
    this.groundFlip = new Int8Array(spawns.length).fill(2);

    for (let i = 0; i < spawns.length; i += 1) {
      const critter = createGroundCritter(spawns[i]!);
      this.ground[i] = critter;
      this.groundBase[i] = ((critter.species * 3 + critter.variant) * GROUND_VIEWS) * GROUND_FRAMES;
      const sprite = new Sprite(art.frames[groundCell(critter.species, critter.variant, critter.view, critter.frame)]!);
      sprite.anchor.set(0.5, ANCHOR_Y);
      sprite.position.set(Math.round(critter.x), Math.round(critter.y));
      this.groundSprites[i] = sprite;
      this.groundX[i] = sprite.position.x;
      this.groundY[i] = sprite.position.y;
      depth.add(sprite.position.y, sprite);
    }

    this.flyTex = new Int16Array(butterflies.length).fill(-1);
    this.flyX = new Int32Array(butterflies.length).fill(0x7fffffff);
    this.flyY = new Int32Array(butterflies.length).fill(0x7fffffff);

    for (let i = 0; i < butterflies.length; i += 1) {
      const butterfly = createButterfly(butterflies[i]!);
      this.flying[i] = butterfly;
      const sprite = new Sprite(art.frames[butterflyCell(butterfly.variant, butterfly.frame)]!);
      sprite.anchor.set(0.5, ANCHOR_Y);
      sprite.position.set(Math.round(butterfly.x), Math.round(butterfly.y - butterfly.height));
      this.flySprites[i] = sprite;
      this.flyX[i] = sprite.position.x;
      this.flyY[i] = sprite.position.y;
      this.butterflyLayer.addChild(sprite);
    }
  }

  get groundCount(): number {
    return this.ground.length;
  }

  get butterflyCount(): number {
    return this.flying.length;
  }

  /** 仅调试/验收读取，不参与帧循环 */
  get visibleCount(): number {
    return this.visible;
  }

  /**
   * 推进一帧。`bounds` 来自相机，屏外动物直接跳过状态机；
   * `focusX/focusY` 只用于判断蝴蝶的相对距离（它们的巢点固定）。
   */
  update(dtMs: number, focusX: number, focusY: number, bounds: CameraBounds | null): void {
    const minX = (bounds ? bounds.minX : focusX - 1200) - CULL_PAD;
    const maxX = (bounds ? bounds.maxX : focusX + 1200) + CULL_PAD;
    const minY = (bounds ? bounds.minY : focusY - 1200) - CULL_PAD;
    const maxY = (bounds ? bounds.maxY : focusY + 1200) + CULL_PAD;
    const frames = this.art.frames;
    let visible = 0;

    for (let i = 0; i < this.ground.length; i += 1) {
      const critter = this.ground[i]!;
      const sprite = this.groundSprites[i]!;
      if (critter.x < minX || critter.x > maxX || critter.y < minY || critter.y > maxY) {
        // 屏外：不跑状态机、不写坐标，只保证它不会被画出来
        if (sprite.visible) sprite.visible = false;
        continue;
      }
      if (!sprite.visible) sprite.visible = true;
      visible += 1;

      stepGroundCritter(critter, dtMs, focusX, focusY, this.random, this.canStand);

      const px = Math.round(critter.x);
      const py = Math.round(critter.y);
      if (px !== this.groundX[i] || py !== this.groundY[i]) {
        this.groundX[i] = px;
        this.groundY[i] = py;
        sprite.position.set(px, py);
        // 脚底 y 即深度：走到树后会被树冠挡住
        this.depth.update(sprite, py);
      }

      const textureIndex = this.groundBase[i]! + critter.view * GROUND_FRAMES + critter.frame;
      if (textureIndex !== this.groundTex[i]) {
        this.groundTex[i] = textureIndex;
        sprite.texture = frames[textureIndex]!;
      }

      const flip: -1 | 1 = critter.flip ? -1 : 1;
      if (flip !== this.groundFlip[i]) {
        this.groundFlip[i] = flip;
        sprite.scale.x = flip;
      }
    }

    for (let i = 0; i < this.flying.length; i += 1) {
      const butterfly = this.flying[i]!;
      const sprite = this.flySprites[i]!;
      if (butterfly.x < minX || butterfly.x > maxX || butterfly.y < minY || butterfly.y > maxY) {
        if (sprite.visible) sprite.visible = false;
        continue;
      }
      if (!sprite.visible) sprite.visible = true;
      visible += 1;

      stepButterfly(butterfly, dtMs);

      const px = Math.round(butterfly.x);
      const py = Math.round(butterfly.y - butterfly.height);
      if (px !== this.flyX[i] || py !== this.flyY[i]) {
        this.flyX[i] = px;
        this.flyY[i] = py;
        sprite.position.set(px, py);
      }

      const textureIndex = butterflyCell(butterfly.variant, butterfly.frame);
      if (textureIndex !== this.flyTex[i]) {
        this.flyTex[i] = textureIndex;
        sprite.texture = frames[textureIndex]!;
      }
    }

    this.visible = visible;
  }

  /** 图集由 renderer 持有（鱼层共用）：这里只销毁自己的精灵 */
  destroy(): void {
    for (const sprite of this.groundSprites) sprite.destroy({ texture: false, textureSource: false });
    for (const sprite of this.flySprites) sprite.destroy({ texture: false, textureSource: false });
    this.butterflyLayer.destroy({ children: true });
    this.groundSprites.length = 0;
    this.flySprites.length = 0;
  }
}
