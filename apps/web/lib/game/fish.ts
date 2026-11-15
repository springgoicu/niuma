'use client';

import { Container, Sprite } from 'pixi.js';
import { fishCell, type CritterArt } from './critter-art';
import { createFish, stepFish, type Fish } from './critter-motion';
import { planFish } from './critter-spawn';
import type { CameraBounds } from './critters';

/**
 * 河道小鱼层（ADR-0045）：纯客户端氛围，与 ADR-0042 的小动物共用同一张图集。
 *
 * 性能契约与 CritterField 一致：
 * 1. 构造期一次性建满精灵，运行期不增删、不 `new`；
 * 2. 屏外不跑状态机，只置 `visible = false`，同屏通常 2–5 条；
 * 3. 帧内零分配：坐标 / 纹理 / 镜像都先比较再写；
 * 4. 不进 y 排序层、不写 depth：鱼在水面之上、角色与树之下，也不应该被桥板挡住
 *    ——桥面属地面层，撒点阶段已经把鱼窝与往返端点避开桥/码头（`planFish`）。
 */
export class FishField {
  readonly layer = new Container();

  private readonly fish: Fish[] = [];
  private readonly sprites: Sprite[] = [];
  private readonly tex: Int16Array;
  private readonly px: Int32Array;
  private readonly py: Int32Array;
  private readonly flip: Int8Array;
  private visible = 0;

  constructor(
    private readonly art: CritterArt,
    seed: number,
  ) {
    const spawns = planFish(seed);
    this.tex = new Int16Array(spawns.length).fill(-1);
    this.px = new Int32Array(spawns.length).fill(0x7fffffff);
    this.py = new Int32Array(spawns.length).fill(0x7fffffff);
    this.flip = new Int8Array(spawns.length).fill(2);

    for (let i = 0; i < spawns.length; i += 1) {
      const fish = createFish(spawns[i]!);
      this.fish[i] = fish;
      const sprite = new Sprite(art.frames[fishCell(fish.variant, fish.frame)]!);
      sprite.anchor.set(0.5, 0.5);
      // 轻微透明：鱼在水面之下，不该像贴纸一样盖住水纹
      sprite.alpha = 0.92;
      sprite.position.set(Math.round(fish.x), Math.round(fish.y));
      this.sprites[i] = sprite;
      this.px[i] = sprite.position.x;
      this.py[i] = sprite.position.y;
      this.layer.addChild(sprite);
    }
  }

  get fishCount(): number {
    return this.fish.length;
  }

  /** 仅调试/验收读取，不参与帧循环 */
  get visibleCount(): number {
    return this.visible;
  }

  update(dtMs: number, bounds: CameraBounds | null, focusX: number, focusY: number): void {
    const pad = 96;
    const minX = (bounds ? bounds.minX : focusX - 1200) - pad;
    const maxX = (bounds ? bounds.maxX : focusX + 1200) + pad;
    const minY = (bounds ? bounds.minY : focusY - 1200) - pad;
    const maxY = (bounds ? bounds.maxY : focusY + 1200) + pad;
    const frames = this.art.frames;
    let visible = 0;

    for (let i = 0; i < this.fish.length; i += 1) {
      const fish = this.fish[i]!;
      const sprite = this.sprites[i]!;
      if (fish.x < minX || fish.x > maxX || fish.y < minY || fish.y > maxY) {
        if (sprite.visible) sprite.visible = false;
        continue;
      }
      if (!sprite.visible) sprite.visible = true;
      visible += 1;

      // 焦点 ≈ 本地角色：玩家靠近时鱼会加速摆尾散开，走远后自动恢复
      stepFish(fish, dtMs, focusX, focusY);

      const x = Math.round(fish.x);
      const y = Math.round(fish.y);
      if (x !== this.px[i] || y !== this.py[i]) {
        this.px[i] = x;
        this.py[i] = y;
        sprite.position.set(x, y);
      }

      const textureIndex = fishCell(fish.variant, fish.frame);
      if (textureIndex !== this.tex[i]) {
        this.tex[i] = textureIndex;
        sprite.texture = frames[textureIndex]!;
      }

      const flip: -1 | 1 = fish.facesLeft ? -1 : 1;
      if (flip !== this.flip[i]) {
        this.flip[i] = flip;
        sprite.scale.x = flip;
      }
    }

    this.visible = visible;
  }

  /** 图集由 renderer 持有：这里只销毁自己的精灵 */
  destroy(): void {
    for (const sprite of this.sprites) sprite.destroy({ texture: false, textureSource: false });
    this.layer.destroy({ children: true });
    this.sprites.length = 0;
    this.fish.length = 0;
  }
}
