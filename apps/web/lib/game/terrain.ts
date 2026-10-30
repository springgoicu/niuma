'use client';

import { Container, Graphics, Sprite, TilingSprite, type Application, type Texture } from 'pixi.js';
import {
  LAKE_SHORE,
  WORLD_HEIGHT,
  WORLD_LAYOUT,
  WORLD_WIDTH,
  distanceSqToPolygon,
  pointInPolygon,
  type FenceSegment,
  type LakeShape,
  type WorldRect,
} from '@niuma/shared-types';
import { seeded } from './seeded';
import { TERRAIN_COLORS as C } from './terrain-palette';
import {
  makeDirtTexture,
  makeGrassTexture,
  makePlanterTexture,
  makePlazaTexture,
  makeReedTexture,
  makeRockTexture,
  makeTreeTextures,
  makeWaterTexture,
} from './terrain-textures';

/**
 * 地形视图：把 shared-types 的静态布局铺成 Pixi 图层。
 *
 * 图层纪律：
 * - 地面（草地 / 林地 / 广场 / 土路 / 岸线 / 水面 / 桥）全部在 `ground`，角色永远压在它们上面；
 * - 树与围栏进调用方传入的 y 排序容器，和角色统一按脚底 y 决前后；
 * - 所有纹理在构造期一次性生成，`update` 只滚 `tilePosition`，`cull` 只翻 `renderable`。
 */

type TextureFactory = Application['renderer'];

const WATER_TILE = 32;
/** 水面滚动的最小时间片：湖慢河快靠 `every` 区分 */
const WATER_TICK_MS = 140;
const FENCE_POST_GAP = 56;

interface TerrainTextures {
  grass: Texture;
  plaza: Texture;
  dirt: Texture;
  water: Texture;
  trees: Texture[];
  rock: Texture;
  reed: Texture;
  planter: Texture;
}

interface WaterSurface {
  sprite: TilingSprite;
  axis: 'x' | 'y';
  /** 每 N 个时间片滚动 1px */
  every: number;
}

interface Cullable {
  sprite: Sprite;
  x: number;
  y: number;
  padX: number;
  padY: number;
}

export class TerrainView {
  readonly ground = new Container();
  private readonly textures: TerrainTextures;
  private readonly surfaces: WaterSurface[] = [];
  private readonly cullables: Cullable[] = [];
  private waterElapsed = 0;
  private waterFrame = 0;

  constructor(renderer: TextureFactory) {
    this.textures = {
      grass: makeGrassTexture(renderer),
      plaza: makePlazaTexture(renderer),
      dirt: makeDirtTexture(renderer),
      water: makeWaterTexture(renderer),
      trees: makeTreeTextures(renderer),
      rock: makeRockTexture(renderer),
      reed: makeReedTexture(renderer),
      planter: makePlanterTexture(renderer),
    };
  }

  /** `sorted` 必须已开启 sortableChildren，树与围栏会按脚底 y 插进去 */
  build(sorted: Container): void {
    this.addGrass();
    this.addForestFloor();
    this.addPlaza();
    this.addPaths();
    for (const lake of WORLD_LAYOUT.lakes) this.addLake(lake);
    this.addRivers();
    this.addBridges();
    this.addDecor();
    this.addTrees(sorted);
    this.addPlanters(sorted);
    for (const segment of WORLD_LAYOUT.fence.segments) this.addFence(sorted, segment);
  }

  private addGrass(): void {
    const grass = new TilingSprite({
      texture: this.textures.grass,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    });
    this.ground.addChild(grass);
  }

  /** 林下地面：整块压暗，四边抖出参差的锯齿，避免成一块硬矩形 */
  private addForestFloor(): void {
    WORLD_LAYOUT.forests.forEach((forest, index) => {
      const random = seeded(0x1f3a + index * 7919);
      const { x, y, w, h } = forest.rect;
      const g = new Graphics();
      g.rect(x, y, w, h).fill(C.forestFloor);
      for (let px = x; px < x + w; px += 24) {
        const top = 6 + Math.round(random() * 14);
        const bottom = 6 + Math.round(random() * 14);
        g.rect(px, y - top, 18, top).fill(C.forestFloor);
        g.rect(px + 10, y + h, 18, bottom).fill(C.forestFloor);
      }
      for (let py = y; py < y + h; py += 24) {
        const left = 6 + Math.round(random() * 14);
        const right = 6 + Math.round(random() * 14);
        g.rect(x - left, py, left, 18).fill(C.forestFloor);
        g.rect(x + w, py + 10, right, 18).fill(C.forestFloor);
      }
      this.ground.addChild(g);
    });
  }

  private addPlaza(): void {
    const plaza = WORLD_LAYOUT.plaza;
    const curb = new Graphics();
    curb.rect(plaza.x - 6, plaza.y - 6, plaza.w + 12, plaza.h + 12).fill(C.plazaCurb);
    this.ground.addChild(curb);

    const tiles = new TilingSprite({ texture: this.textures.plaza, width: plaza.w, height: plaza.h });
    tiles.position.set(plaza.x, plaza.y);
    this.ground.addChild(tiles);
  }

  private addPaths(): void {
    for (const path of WORLD_LAYOUT.paths) {
      const tiles = new TilingSprite({ texture: this.textures.dirt, width: path.w, height: path.h });
      tiles.position.set(path.x, path.y);
      this.ground.addChild(tiles);
    }
  }

  private addLake(lake: LakeShape): void {
    const flat: number[] = [];
    for (const [x, y] of lake.points) flat.push(x, y);

    // 岸线画在轮廓上：外侧 LAKE_SHORE 宽留成沙滩，内侧被水面盖住
    const shore = new Graphics();
    shore.poly(flat).stroke({ width: LAKE_SHORE * 2, color: C.sand });
    shore.poly(flat).stroke({ width: 4, color: C.sandLight });
    this.ground.addChild(shore);

    const water = this.addWaterSurface(lake.rect, 'x', 3);
    const mask = new Graphics();
    mask.poly(flat).fill(0xffffff);
    this.ground.addChild(mask);
    water.mask = mask;
  }

  private addRivers(): void {
    for (const river of WORLD_LAYOUT.rivers) {
      this.addWaterSurface(river.rect, 'y', 1);
    }
  }

  private addWaterSurface(rect: WorldRect, axis: 'x' | 'y', every: number): TilingSprite {
    const water = new TilingSprite({ texture: this.textures.water, width: rect.w, height: rect.h });
    water.position.set(rect.x, rect.y);
    // 平铺偏移按世界坐标对齐：河流由多个阶梯矩形拼成，逐段从 0 起算会看到波纹错位
    water.tilePosition.set(rect.x % WATER_TILE, rect.y % WATER_TILE);
    this.ground.addChild(water);
    this.surfaces.push({ sprite: water, axis, every });
    return water;
  }

  private addBridges(): void {
    for (const bridge of WORLD_LAYOUT.bridges) {
      const g = new Graphics();
      g.rect(bridge.x, bridge.y, bridge.w, bridge.h).fill(C.bridgeWood);
      // 木板缝垂直于通行方向：桥是东西向的，缝就竖着排
      for (let x = bridge.x + 6; x < bridge.x + bridge.w; x += 10) {
        g.rect(x, bridge.y, 1, bridge.h).fill(C.bridgeSeam);
      }
      // 两侧栏杆压在桥沿上
      g.rect(bridge.x, bridge.y - 4, bridge.w, 4).fill(C.fenceDark);
      g.rect(bridge.x, bridge.y - 4, bridge.w, 2).fill(C.bridgeRail);
      g.rect(bridge.x, bridge.y + bridge.h, bridge.w, 4).fill(C.fenceDark);
      g.rect(bridge.x, bridge.y + bridge.h + 2, bridge.w, 2).fill(C.bridgeRail);
      this.ground.addChild(g);
    }
  }

  /** 岸边碎石与芦苇：纯点缀，不参与碰撞 */
  private addDecor(): void {
    const random = seeded(0x6c2f1a);
    for (const lake of WORLD_LAYOUT.lakes) {
      let placed = 0;
      for (let attempt = 0; attempt < 600 && placed < 54; attempt += 1) {
        const x = lake.rect.x + random() * lake.rect.w;
        const y = lake.rect.y + random() * lake.rect.h;
        if (pointInPolygon(x, y, lake.points)) continue;
        const distance = distanceSqToPolygon(x, y, lake.points);
        if (distance < 144 || distance > 46 * 46) continue;
        this.addDecal(random() > 0.45 ? 'reed' : 'rock', x, y);
        placed += 1;
      }
    }
    for (const river of WORLD_LAYOUT.rivers) {
      for (let i = 0; i < 6; i += 1) {
        const x = random() > 0.5 ? river.rect.x - 10 : river.rect.x + river.rect.w + 10;
        const y = river.rect.y + random() * river.rect.h;
        this.addDecal('reed', x, y);
      }
    }
  }

  private addDecal(kind: 'rock' | 'reed', x: number, y: number): void {
    const sprite = new Sprite(kind === 'rock' ? this.textures.rock : this.textures.reed);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(Math.round(x), Math.round(y));
    this.ground.addChild(sprite);
  }

  private addTrees(sorted: Container): void {
    for (const forest of WORLD_LAYOUT.forests) {
      for (const tree of forest.trees) {
        const sprite = new Sprite(this.textures.trees[tree.variant % this.textures.trees.length]!);
        sprite.anchor.set(0.5, 1);
        sprite.position.set(tree.x, tree.y);
        sprite.zIndex = tree.y;
        sorted.addChild(sprite);
        // 树冠向上长 60px、向两边各探 20px，裁剪范围要覆盖到
        this.cullables.push({ sprite, x: tree.x, y: tree.y, padX: 26, padY: 72 });
      }
    }
  }

  private addPlanters(sorted: Container): void {
    for (const planter of WORLD_LAYOUT.planters) {
      const sprite = new Sprite(this.textures.planter);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(planter.x, planter.y);
      sprite.zIndex = planter.y;
      sorted.addChild(sprite);
      this.cullables.push({ sprite, x: planter.x, y: planter.y, padX: 18, padY: 34 });
    }
  }

  private addFence(sorted: Container, segment: FenceSegment): void {
    if (segment.y1 === segment.y2) {
      const left = Math.min(segment.x1, segment.x2);
      const right = Math.max(segment.x1, segment.x2);
      const g = this.drawFenceSpan(left, segment.y1, right - left, true);
      g.zIndex = segment.y1;
      sorted.addChild(g);
      return;
    }
    const from = Math.min(segment.y1, segment.y2);
    const to = Math.max(segment.y1, segment.y2);
    for (let y = from; y < to; y += 96) {
      const end = Math.min(y + 96, to);
      const g = this.drawFenceSpan(segment.x1, y, end - y, false);
      // 竖向栏板按分段下沿排序：走过的人各归各的前后
      g.zIndex = end;
      sorted.addChild(g);
    }
  }

  /** 一段栏板：两根横栏 + 等距立柱；竖向栏板把角色反转 90° 画 */
  private drawFenceSpan(x: number, y: number, length: number, horizontal: boolean): Graphics {
    const g = new Graphics();
    if (horizontal) {
      g.rect(x, y - 13, length, 4).fill(C.fenceDark);
      g.rect(x, y - 13, length, 2).fill(C.fenceRail);
      g.rect(x, y - 6, length, 4).fill(C.fenceDark);
      g.rect(x, y - 6, length, 2).fill(C.fenceRail);
      for (let post = 0; post <= length - 5; post += FENCE_POST_GAP) {
        g.rect(x + post, y - 20, 6, 20).fill(C.fenceDark);
        g.rect(x + post + 1, y - 19, 4, 18).fill(C.fenceRail);
        g.rect(x + post + 1, y - 19, 1, 18).fill(C.fenceLight);
      }
      return g;
    }
    g.rect(x - 13, y, 4, length).fill(C.fenceDark);
    g.rect(x - 13, y, 2, length).fill(C.fenceLight);
    g.rect(x - 6, y, 4, length).fill(C.fenceDark);
    g.rect(x - 6, y, 2, length).fill(C.fenceLight);
    for (let post = 0; post <= length - 6; post += FENCE_POST_GAP) {
      g.rect(x - 10, y + post, 12, 6).fill(C.fenceDark);
      g.rect(x - 9, y + post + 1, 10, 4).fill(C.fenceRail);
    }
    return g;
  }

  /** 水面只滚平铺偏移，整数像素步进，帧率无关 */
  update(dtMs: number): void {
    this.waterElapsed += dtMs;
    while (this.waterElapsed >= WATER_TICK_MS) {
      this.waterElapsed -= WATER_TICK_MS;
      this.waterFrame += 1;
      for (const surface of this.surfaces) {
        if (this.waterFrame % surface.every !== 0) continue;
        const { sprite } = surface;
        if (surface.axis === 'y') {
          sprite.tilePosition.y = (sprite.tilePosition.y + 1) % WATER_TILE;
        } else {
          sprite.tilePosition.x = (sprite.tilePosition.x + 1) % WATER_TILE;
        }
      }
    }
  }

  /** 视口裁剪：树与围栏不进画面就翻 renderable，排序与绘制都省掉 */
  cull(minX: number, minY: number, maxX: number, maxY: number): void {
    for (const entry of this.cullables) {
      const top = entry.y - entry.padY;
      entry.sprite.renderable =
        entry.x + entry.padX >= minX &&
        entry.x - entry.padX <= maxX &&
        entry.y >= minY &&
        top <= maxY;
    }
  }

  destroy(): void {
    this.ground.destroy({ children: true });
    for (const tree of this.textures.trees) tree.destroy(true);
    this.textures.grass.destroy(true);
    this.textures.plaza.destroy(true);
    this.textures.dirt.destroy(true);
    this.textures.water.destroy(true);
    this.textures.rock.destroy(true);
    this.textures.reed.destroy(true);
    this.textures.planter.destroy(true);
  }
}
