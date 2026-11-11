'use client';

import { Container, Graphics, Sprite, TilingSprite, type Application, type Texture } from 'pixi.js';
import {
  ISLAND,
  ISLAND_SAND,
  ISLAND_SHALLOW,
  LAKE_SHORE,
  RIVER_SHORE,
  WORLD_HEIGHT,
  WORLD_LAYOUT,
  WORLD_WIDTH,
  distanceSqToPolygon,
  pointInPolygon,
  rectContains,
  type LakeShape,
  type Point,
  type WorldRect,
} from '@niuma/shared-types';
import {
  CORNER_RADIUS,
  contourPolygon,
  offsetContour,
  organicContour,
  polygonContour,
  roundedRectContour,
  traceContour,
  type ContourPoint,
} from './autotile';
import { WILDFLOWER_KINDS, bloomDecalKind, scatterDecals, type DecalPlacement } from './decals';
import { isOutdoorGround } from './ground';
import { seeded } from './seeded';
import type { DepthSink } from './sort-layer';
import {
  EDGE_STYLE,
  MATERIAL,
  buildMaterialGrid,
  edgeGlyphs,
  type MaterialGrid,
  type MaterialId,
} from './terrain-edge';
import { TERRAIN_COLORS as C } from './terrain-palette';
import {
  PROP_SHADOW,
  TREE_H,
  makeDecalAtlas,
  makeDirtTexture,
  makeGrassTexture,
  makePlanterTexture,
  makePropShadowTexture,
  makeReedTexture,
  makeRockTexture,
  makeSeaTexture,
  makeTreeTextures,
  makeWaterTexture,
  type DecalAtlas,
  type TreeTextures,
} from './terrain-textures';

/**
 * 地形视图（本项目的 MapRenderer）：把 shared-types 的静态布局铺成 Pixi 图层。
 *
 * 地面过渡用「位掩码 + 解析轮廓 + 遮罩平铺」而不是 47 张 autotile 拼贴：
 * 拼贴块内部的材质相位无法和外层 TilingSprite 对齐，接缝处会露出半块砖（ADR-0013 / ADR-0016）。
 *
 * 帧循环纪律：所有纹理、轮廓与边缘图元在构造期一次性生成，
 * `update` 只滚 `tilePosition`，`cull` 只翻 `renderable`，`occlude` 只改 `alpha`。
 */

type TextureFactory = Application['renderer'];

/** 必须与 makeWaterTexture 的 size 一致：回绕模数用错，水面每隔几秒会跳一下 */
const WATER_TILE = 96;
/** 必须与 makeSeaTexture 的 size 一致 */
const SEA_TILE = 96;
/** 必须与 makeDirtTexture 的 size 一致 */
const DIRT_TILE = 128;
/** 海面平铺超出世界矩形的余量：超宽视口贴到岛边也不会看到硬边 */
const SEA_EXTENT = 2048;
/** 水面滚动的最小时间片：湖慢河快靠 `every` 区分 */
const WATER_TICK_MS = 140;
/** 花海花朵密度：普通草地 0.12，花海要密到看得出「一片」 */
const FLOWER_FIELD_CHANCE = 0.4;
/** 全岛零散野花：只做点缀，压到普通贴花的五分之一 */
const WILDFLOWER_CHANCE = 0.025;
/** 芦苇离岸距离：站在沙带外缘，不压到水面 */
const REED_OFFSET = 15;

/** 角色的包围盒（texel）：遮挡判定用它去和树冠盒求交 */
const PONY_HALF_W = 13;
const PONY_HEIGHT = 48;
/** 树冠相对树根的高度范围：树干 28–36 高，树冠从 108 一直盖到 26 */
const CANOPY_TOP = TREE_H;
const CANOPY_BOTTOM = 26;
/** 树冠网格索引的单元边长 */
const OCCLUSION_CELL = 128;

interface TerrainTextures {
  grass: Texture;
  dirt: Texture;
  water: Texture;
  sea: Texture;
  trees: TreeTextures[];
  rock: Texture;
  reed: Texture;
  planter: Texture;
  decals: DecalAtlas;
  /** 树 / 花箱 / 石头的底座投影，全部按 0x1E2846 @0.2 烘焙 */
  shadows: { tree: Texture; planter: Texture; rock: Texture };
}

/** 一段待绘制的边缘：底色全部画完之后再统一出图，草缘永远最后压上 */
interface EdgeJob {
  self: MaterialId;
  other: MaterialId;
  contour: ContourPoint[];
  /** 是否画内缘暗边；岸沙带这类「以海岸线为中线」的带状材质没有内侧边 */
  rim: boolean;
  /** 强制齿的生长方向；缺省由「对面是不是草」推断 */
  grow?: 'in' | 'out';
  seed: number;
}

interface WaterSurface {
  sprite: TilingSprite;
  axis: 'x' | 'y';
  /** 每 N 个时间片滚动 1px */
  every: number;
  /** 平铺周期；水面与海面尺寸不同，回绕必须各用各的 */
  tile: number;
}

export interface TerrainOptions {
  /**
   * `?flat=1`：退回「矩形 TilingSprite」的旧画法。
   * 圆角轮廓与草缘一旦在线上出现观感回归，这一个开关就能把地形切回原样，
   * 不用回滚整次发布（ADR-0013 的灰度开关）。广场自 ADR-0017 起不铺装，
   * 这个开关只影响土路的轮廓与草缘。
   */
  flat?: boolean;
  /** `?edge=0`：只关边缘层（草尖/圆弧/内缘暗边），底色与轮廓照旧 */
  edge?: boolean;
}

interface Cullable {
  sprite: Sprite;
  x: number;
  y: number;
  padX: number;
  padY: number;
}

interface CanopyEntry {
  sprite: Sprite;
  /** 世界坐标下的树冠盒 */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 树根 y：角色只有站在这条线以上（y 更小）才可能被遮住 */
  baseY: number;
}

/** 折线 / 多边形展开成 Pixi Graphics 需要的扁平数组 */
function flattenPoints(points: ReadonlyArray<Point>): number[] {
  const flat: number[] = [];
  for (const [x, y] of points) flat.push(x, y);
  return flat;
}

/** 海岸线折线展开成 Pixi 需要的扁平数组 */
function islandPolygon(): number[] {
  return flattenPoints(ISLAND.points);
}

/**
 * 河岸沙带只画岛内的一段：河口处沙带自然断开，
 * 不会在入海口横一条把河封死的沙坝。
 */
function clipBankToLand(bank: ReadonlyArray<Point>): Point[] {
  return bank.filter(([x, y]) => pointInPolygon(x, y, ISLAND.points));
}

/** 128px 单元的空间哈希键：坐标恒为正，直接位拼 */
function cellKey(x: number, y: number): number {
  return (Math.floor(x / OCCLUSION_CELL) << 16) ^ Math.floor(y / OCCLUSION_CELL);
}

/**
 * 地形视图：本项目的 MapRenderer。
 *
 * 三层结构（与 ADR-0013 的图层纪律一致）：
 * - `base`：材质底色与轮廓遮罩（海 → 浅滩 → 草 → 沙 → 土路 → 水 → 桥，广场只画路缘，ADR-0017）；
 * - `edge`：位掩码驱动的边缘层，等所有底色画完才统一生成，草缘永远最后压上；
 * - `decals`：程序化贴花，压在地面之上、尘土与角色之下。
 *
 * 帧循环纪律不变：所有轮廓、图元、纹理在构造期一次生成，
 * `update` 只滚 `tilePosition`，`cull` 只翻 `renderable`，`occlude` 只改 `alpha`。
 */
export class TerrainView {
  readonly base = new Container();
  readonly edge = new Container();
  /** 贴花层：地面之上、尘土与角色之下 */
  readonly decals = new Container();
  private readonly textures: TerrainTextures;
  private readonly surfaces: WaterSurface[] = [];
  private readonly cullables: Cullable[] = [];
  private readonly canopies: CanopyEntry[] = [];
  private readonly canopyGrid = new Map<number, CanopyEntry[]>();
  private readonly litCanopies = new Set<CanopyEntry>();
  private readonly nextLit = new Set<CanopyEntry>();
  /** 边缘任务：底色阶段只登记，底色全部落盘后再统一出图 */
  private readonly edges: EdgeJob[] = [];
  private depth: DepthSink | null = null;
  private grid: MaterialGrid | null = null;
  private readonly edgeEnabled: boolean;
  private waterElapsed = 0;
  private waterFrame = 0;

  constructor(
    renderer: TextureFactory,
    private readonly options: TerrainOptions = {},
  ) {
    // 材质网格有 66k 格，只有真的要画边缘时才开始算
    this.edgeEnabled = !this.options.flat && this.options.edge !== false;
    this.textures = {
      grass: makeGrassTexture(renderer),
      dirt: makeDirtTexture(renderer),
      water: makeWaterTexture(renderer),
      sea: makeSeaTexture(renderer),
      trees: makeTreeTextures(renderer),
      rock: makeRockTexture(renderer),
      reed: makeReedTexture(renderer),
      planter: makePlanterTexture(renderer),
      decals: makeDecalAtlas(renderer),
      shadows: {
        tree: makePropShadowTexture(renderer, PROP_SHADOW.tree.w, PROP_SHADOW.tree.h),
        planter: makePropShadowTexture(renderer, PROP_SHADOW.planter.w, PROP_SHADOW.planter.h),
        rock: makePropShadowTexture(renderer, PROP_SHADOW.rock.w, PROP_SHADOW.rock.h),
      },
    };
  }

  /** `depth` 负责按脚底 y 把树与道具放进正确的深度层 */
  build(depth: DepthSink): void {
    this.depth = depth;
    this.addSea();
    this.addShoreShelf();
    this.addGrass();
    this.addShoreSand();
    this.addForestFloor();
    this.addFlowerMeadow();
    this.addPlaza();
    this.addPaths();
    for (const lake of WORLD_LAYOUT.lakes) this.addLake(lake);
    this.addRivers();
    this.addBridges();
    this.addDocks();
    // 底色全部就位后再画边缘：草缘压在土、石、水、沙的暗边之上
    this.flushEdges();
    this.addDecor();
    this.addDecals();
    this.addTrees(depth);
    this.addPlanters(depth);
  }

  /** 深海铺在最底层，外扩一圈：任何视口都不会露出世界外的黑色 */
  private addSea(): void {
    const sea = new TilingSprite({
      texture: this.textures.sea,
      width: WORLD_WIDTH + SEA_EXTENT * 2,
      height: WORLD_HEIGHT + SEA_EXTENT * 2,
    });
    sea.position.set(-SEA_EXTENT, -SEA_EXTENT);
    this.base.addChild(sea);
    // 海面比湖面慢：每 10 个时间片滚 1px
    this.surfaces.push({ sprite: sea, axis: 'x', every: 10, tile: SEA_TILE });
  }

  /** 浅滩：中心线两侧各 72px，内侧随后被草地盖住，只留外海一侧的浅水 */
  private addShoreShelf(): void {
    const shelf = new Graphics();
    // bevel：海岸线是直角折线，miter 会在海湾拐角扎出上百像素的长刺
    shelf.poly(islandPolygon()).stroke({ width: ISLAND_SHALLOW * 2, color: C.shoreShallow, join: 'bevel' });
    this.base.addChild(shelf);
  }

  /**
   * 沙滩：压在海陆交界线上，一半在水里一半在陆地。
   * 沙滩没有自己的矩形，它的两条边都在同一条海岸线上——内缘朝草地、外缘朝浅滩，
   * 各自偏移 26px 后单独登记边缘，草才会从陆地一侧长进沙里。
   */
  private addShoreSand(): void {
    const sand = new Graphics();
    sand.poly(islandPolygon()).stroke({ width: ISLAND_SAND * 2, color: C.sand, join: 'bevel' });
    this.base.addChild(sand);

    if (!this.edgeEnabled) return;
    // 用未倒角的原始海岸线做偏移：圆角半径 12 < 沙带宽 26，
    // 先倒角再内缩会让圆弧上的每个点各走各的法线，在角上收成一个结
    const ring: ContourPoint[] = ISLAND.points.map(([x, y]) => ({ x, y }));
    // 陆地侧：草压着沙长。沙在轮廓外侧、草在内侧，齿必须朝外才是「盖进沙里」；
    // 沙的暗边会落在草上，所以这条线不画内缘
    this.edges.push({
      self: MATERIAL.sand,
      other: MATERIAL.grass,
      contour: offsetContour(ring, -ISLAND_SAND),
      rim: false,
      grow: 'out',
      seed: 0x5a4d31,
    });
    // 海侧：沙探进浅滩，补一条湿沙暗边
    this.edges.push({
      self: MATERIAL.sand,
      other: MATERIAL.shallow,
      contour: offsetContour(ring, ISLAND_SAND),
      rim: true,
      seed: 0x6b5e42,
    });
  }

  /** 草地按海岸线裁成岛：铺满世界矩形，再用多边形遮罩切掉海面 */
  private addGrass(): void {
    const grass = new TilingSprite({
      texture: this.textures.grass,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    });
    const mask = new Graphics();
    mask.poly(islandPolygon()).fill(0xffffff);
    this.base.addChild(mask);
    grass.mask = mask;
    this.base.addChild(grass);
  }

  /**
   * 林下地面：草地之上的一层半透明草色，不是另一种地面。
   * 透明让 256px 草纹透上来，整张图才不会出现「草地被切成几块」。
   */
  private addForestFloor(): void {
    WORLD_LAYOUT.forests.forEach((forest, index) => {
      const { x, y, w, h } = forest.rect;
      const g = new Graphics();
      if (this.options.flat) {
        g.rect(x, y, w, h).fill({ color: C.forestFloor, alpha: 0.55 });
      } else {
        const contour = organicContour(forest.rect, 0x1f3a + index * 7919, 14, 24);
        traceContour(g, contour);
        g.fill({ color: C.forestFloor, alpha: 0.55 });
        // Pixi 8 的 alignment：1 = 内侧，0.5 = 居中，0 = 外侧
        g.poly(contourPolygon(contour)).stroke({ color: C.grassDeep, width: 3, alignment: 1, alpha: 0.45 });
      }
      this.base.addChild(g);
    });
  }

  /**
   * 花海底色：草甸本身还是草，只是一层更亮更暖的绿。
   * 真正让它成为「花海」的是叠在上面的花朵贴花。
   */
  private addFlowerMeadow(): void {
    WORLD_LAYOUT.flowerFields.forEach((field, index) => {
      const g = new Graphics();
      const contour = organicContour(field.rect, 0x6f1d + index * 3571, 10, 26);
      traceContour(g, contour);
      g.fill({ color: C.meadowTint, alpha: 0.4 });
      g.poly(contourPolygon(contour)).stroke({ color: C.meadowShade, width: 2, alignment: 1, alpha: 0.5 });
      this.base.addChild(g);
    });
  }

  /** 办公区路缘：整片广场地面就是草地，这里只画一圈石色边圈出范围 */
  private addPlaza(): void {
    const plaza = WORLD_LAYOUT.plaza;
    const contour = roundedRectContour(plaza, CORNER_RADIUS);
    const flat = contourPolygon(contour);

    // 广场不是铺装（ADR-0017）：地面就是 `addGrass` 铺满全岛的那张草纹，
    // 这里只留一圈石色路缘标出办公区。外圈 2px 深缝压住草与石的交界，
    // 内侧 10px 面层向外收；ADR-0028 删除围栏后，办公区的辨识交给树篱、花箱与工位。
    const curb = new Graphics();
    // alignment 0 = 描边落在轮廓外侧（Pixi 8 的 1 才是内侧）
    curb.poly(flat).stroke({ color: C.plazaSeam, width: 12, alignment: 0, join: 'round' });
    curb.poly(flat).stroke({ color: C.plazaCurb, width: 10, alignment: 0, join: 'round' });
    this.base.addChild(curb);
  }

  /** 四条土路：原来是直接铺矩形，这就是「90° 直角硬拼」的根因 */
  private addPaths(): void {
    for (const path of WORLD_LAYOUT.paths) {
      this.paintRegion(
        MATERIAL.dirt,
        MATERIAL.grass,
        path,
        this.textures.dirt,
        DIRT_TILE,
        roundedRectContour(path, CORNER_RADIUS),
      );
    }
  }

  /**
   * 一片地面材质：底色 + 轮廓遮罩，并登记边缘任务。
   *
   * 边缘不在这里画：底色全部落盘后由 `flushEdges` 统一出图，
   * 草缘才能压在所有材质的暗边之上——这正是「草自然覆盖泥地」的层序。
   */
  private paintRegion(
    self: MaterialId,
    other: MaterialId,
    rect: WorldRect,
    texture: Texture,
    tileSize: number,
    contour: ContourPoint[],
  ): void {
    const tiles = new TilingSprite({ texture, width: rect.w, height: rect.h });
    tiles.position.set(rect.x, rect.y);
    // 平铺相位按世界坐标对齐：几条路交在一起时纹理不会各自从 0 起算
    tiles.tilePosition.set(rect.x % tileSize, rect.y % tileSize);

    if (this.options.flat) {
      this.base.addChild(tiles);
      return;
    }

    const mask = new Graphics();
    traceContour(mask, contour);
    mask.fill(0xffffff);
    tiles.mask = mask;
    this.base.addChild(mask, tiles);

    if (this.edgeEnabled) {
      this.edges.push({
        self,
        other,
        contour,
        rim: true,
        seed: 0x9e37 + rect.x * 31 + rect.y,
      });
    }
  }

  /**
   * 边缘层：底色全部落盘后统一出图，顺序就是「谁压谁」。
   *
   * 1. 本体色相压暗的内缘（alignment 1 = 内侧），替代硬黑描边；
   * 2. 对面是草时，2px 草色骑在轮廓上——这是「草盖住泥」的连续底边；
   * 3. 位掩码驱动的草尖与外凸圆弧，全部 1×1 / 1×N 整数 rect，不引入抗锯齿。
   */
  private flushEdges(): void {
    if (!this.edgeEnabled || this.edges.length === 0) return;
    const grid = this.materialGrid();
    for (const job of this.edges) {
      const g = new Graphics();
      const flat = contourPolygon(job.contour);
      const style = EDGE_STYLE[job.self];

      if (job.rim) {
        g.poly(flat).stroke({ color: style.rim, width: style.rimWidth, alignment: 1, join: 'round' });
      }
      if (job.other === MATERIAL.grass) {
        g.poly(flat).stroke({ color: C.grassTuft, width: 2, alignment: 0.5, join: 'round' });
      }
      for (const glyph of edgeGlyphs(job.contour, {
        self: job.self,
        other: job.other,
        grow: job.grow,
        seed: job.seed,
        grid,
      })) {
        g.rect(glyph.x, glyph.y, glyph.w, glyph.h).fill(glyph.color);
      }
      this.edge.addChild(g);
    }
    this.edges.length = 0;
  }

  /** 材质网格按需构建：`?edge=0` 时一格都不算 */
  private materialGrid(): MaterialGrid {
    this.grid ??= buildMaterialGrid();
    return this.grid;
  }

  private addLake(lake: LakeShape): void {
    const flat = flattenPoints(lake.points);
    // 圆角只作用于水面遮罩与草缘：碰撞仍是原始多边形，误差在几像素内
    const contour = polygonContour(lake.points, 12);

    // 岸线画在轮廓上：外侧 LAKE_SHORE 宽留成沙滩，内侧被水面盖住
    const shore = new Graphics();
    shore.poly(flat).stroke({ width: LAKE_SHORE * 2, color: C.sand, join: 'round' });
    shore.poly(flat).stroke({ width: 4, color: C.sandLight, join: 'round' });
    this.base.addChild(shore);

    const water = this.addWaterSurface(lake.rect, 'x', 3);
    const mask = new Graphics();
    traceContour(mask, contour);
    mask.fill(0xffffff);
    this.base.addChild(mask);
    water.mask = mask;

    if (this.edgeEnabled) {
      this.edges.push({ self: MATERIAL.water, other: MATERIAL.sand, contour, rim: true, seed: 0x4c1a2f });
      // 沙带外缘：草从草地一侧盖进沙里，湖岸才不会是一条硬色边。
      // 同样用原始多边形偏移，避免 12px 圆角被 22px 外扩拉出结
      this.edges.push({
        self: MATERIAL.sand,
        other: MATERIAL.grass,
        contour: offsetContour(
          lake.points.map(([x, y]) => ({ x, y })),
          LAKE_SHORE,
        ),
        rim: false,
        grow: 'in',
        seed: 0x5e2b17,
      });
    }
  }

  /**
   * 河道：一条连续的水面多边形，不再逐段铺矩形。
   * 沙滩沿左右岸画两条开口折线——河口不封口，河水直接汇进海面。
   */
  private addRivers(): void {
    for (const river of WORLD_LAYOUT.rivers) {
      const shore = new Graphics();
      for (const bank of [river.leftBank, river.rightBank]) {
        const land = clipBankToLand(bank);
        if (land.length < 2) continue;
        const flat = flattenPoints(land);
        // 外侧 RIVER_SHORE 宽留成沙滩，内侧被水面盖住
        shore.poly(flat).stroke({ width: RIVER_SHORE * 2, color: C.sand, join: 'round' });
        shore.poly(flat).stroke({ width: 4, color: C.sandLight, join: 'round' });
      }
      this.base.addChild(shore);

      const contour = polygonContour(river.polygon, 16);
      const water = this.addWaterSurface(river.rect, 'y', 1);
      const mask = new Graphics();
      traceContour(mask, contour);
      mask.fill(0xffffff);
      this.base.addChild(mask);
      water.mask = mask;

      if (this.edgeEnabled) {
        this.edges.push({ self: MATERIAL.water, other: MATERIAL.sand, contour, rim: true, seed: 0x7d31a5 });
        // 河岸沙带外缘：河口处探针会命中水，齿自然在入海口收住
        this.edges.push({
          self: MATERIAL.sand,
          other: MATERIAL.grass,
          contour: offsetContour(
            river.polygon.map(([x, y]) => ({ x, y })),
            RIVER_SHORE,
          ),
          rim: false,
          grow: 'in',
          seed: 0x6a1f43,
        });
      }
    }
  }

  private addWaterSurface(rect: WorldRect, axis: 'x' | 'y', every: number): TilingSprite {
    const water = new TilingSprite({ texture: this.textures.water, width: rect.w, height: rect.h });
    water.position.set(rect.x, rect.y);
    // 平铺偏移按世界坐标对齐：湖与河共用同一相位，接水处波纹不会各算各的
    water.tilePosition.set(rect.x % WATER_TILE, rect.y % WATER_TILE);
    this.base.addChild(water);
    this.surfaces.push({ sprite: water, axis, every, tile: WATER_TILE });
    return water;
  }

  private addBridges(): void {
    for (const bridge of WORLD_LAYOUT.bridges) this.addDeck(bridge, true);
  }

  /** 码头：与桥同一种木栈道，只是一端伸进水面、不设栏杆（ADR-0028） */
  private addDocks(): void {
    for (const dock of WORLD_LAYOUT.docks) this.addDeck(dock, false);
  }

  /**
   * 木栈道：木板缝垂直于通行方向，长边两侧压栏杆。
   *
   * 南北向（h > w）时缝横排、栏杆压左右沿，否则缝竖排、栏杆压上下沿——
   * 写死一个方向会让南北向的桥栏杆横在路中间（ADR-0028）。
   */
  private addDeck(deck: WorldRect, rail: boolean): void {
    const vertical = deck.h > deck.w;
    const g = new Graphics();
    g.rect(deck.x, deck.y, deck.w, deck.h).fill(C.bridgeWood);
    if (vertical) {
      for (let y = deck.y + 8; y < deck.y + deck.h; y += 14) {
        g.rect(deck.x, y, deck.w, 1).fill(C.bridgeSeam);
      }
    } else {
      for (let x = deck.x + 8; x < deck.x + deck.w; x += 14) {
        g.rect(x, deck.y, 1, deck.h).fill(C.bridgeSeam);
      }
    }
    if (rail) {
      if (vertical) {
        g.rect(deck.x - 5, deck.y, 5, deck.h).fill(C.fenceDark);
        g.rect(deck.x - 5, deck.y, 3, deck.h).fill(C.bridgeRail);
        g.rect(deck.x + deck.w, deck.y, 5, deck.h).fill(C.fenceDark);
        g.rect(deck.x + deck.w + 3, deck.y, 3, deck.h).fill(C.bridgeRail);
      } else {
        g.rect(deck.x, deck.y - 5, deck.w, 5).fill(C.fenceDark);
        g.rect(deck.x, deck.y - 5, deck.w, 3).fill(C.bridgeRail);
        g.rect(deck.x, deck.y + deck.h, deck.w, 5).fill(C.fenceDark);
        g.rect(deck.x, deck.y + deck.h + 3, deck.w, 3).fill(C.bridgeRail);
      }
    }
    this.base.addChild(g);
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
        if (distance < 225 || distance > 58 * 58) continue;
        this.addDecalSprite(random() > 0.45 ? 'reed' : 'rock', x, y);
        placed += 1;
      }
    }
    // 河岸：沿两条岸线每 72px 采样一次，外法线朝水面外挑 15px（ADR-0045 加密）
    for (const river of WORLD_LAYOUT.rivers) {
      const banks: Array<{ bank: ReadonlyArray<Point>; outward: 1 | -1 }> = [
        { bank: river.leftBank, outward: 1 },
        { bank: river.rightBank, outward: -1 },
      ];
      for (const { bank, outward } of banks) {
        let placed = 0;
        for (let i = 0; i < bank.length - 1 && placed < 24; i += 1) {
          const [x0, y0] = bank[i]!;
          const [x1, y1] = bank[i + 1]!;
          const dx = x1 - x0;
          const dy = y1 - y0;
          const length = Math.sqrt(dx * dx + dy * dy) || 1;
          const steps = Math.max(1, Math.floor(length / 72));
          for (let s = 0; s < steps && placed < 24; s += 1) {
            const t = (s + 0.5) / steps;
            const bx = x0 + dx * t;
            const by = y0 + dy * t;
            if (!pointInPolygon(bx, by, ISLAND.points)) continue;
            const rx = bx + (dy / length) * REED_OFFSET * outward;
            const ry = by + (-dx / length) * REED_OFFSET * outward;
            if (!pointInPolygon(rx, ry, ISLAND.points)) continue;
            if (WORLD_LAYOUT.bridges.some((bridge) => rectContains(bridge, rx, ry))) continue;
            if (random() > 0.5) continue;
            this.addDecalSprite(random() > 0.35 ? 'reed' : 'rock', rx, ry);
            placed += 1;
          }
        }
      }
    }
  }

  private addDecalSprite(kind: 'rock' | 'reed', x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (kind === 'rock') this.addPropShadow(px, py, this.textures.shadows.rock);
    const sprite = new Sprite(kind === 'rock' ? this.textures.rock : this.textures.reed);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(px, py);
    // 碎石与芦苇按脚底 y 进深度层：人走过去时前后关系才对
    if (this.depth) this.depth.add(py, sprite);
    else this.base.addChild(sprite);
    this.cullables.push({ sprite, x: px, y: py, padX: 12, padY: 26 });
  }

  /**
   * 底座投影：压 0.2 一档的冷靛蓝椭圆，让大物件「坐」在地上。
   * zIndex 取 y - 0.5，永远排在同位置物体之下，又不会掉到更靠上的物件下面。
   */
  private addPropShadow(x: number, y: number, texture: Texture): void {
    if (!this.depth) return;
    const shadow = new Sprite(texture);
    shadow.anchor.set(0.5, 0.5);
    shadow.position.set(Math.round(x), Math.round(y) - 1);
    // 取 y - 0.5 而不是 y：同位置的影子压在本体之下，又不会掉到更靠上的物件后面
    this.depth.add(y - 0.5, shadow);
    this.cullables.push({ sprite: shadow, x, y, padX: 32, padY: 14 });
  }

  /**
   * 贴花层：草地基底（三叶草 / 雏菊 / 草尖 / 石粒）+ 全岛零散野花 + 三片花海。
   * 三层共用同一张图集与同一套视口裁剪，帧循环里只翻 renderable。
   */
  private addDecals(): void {
    const bounds = { x: ISLAND.bounds.x, y: ISLAND.bounds.y, w: ISLAND.bounds.w, h: ISLAND.bounds.h };
    this.addDecalSprites(
      scatterDecals(bounds, (x, y) => this.decalAllowed(x, y), 0x5eed1a),
    );
    this.addDecalSprites(
      scatterDecals(bounds, (x, y) => this.decalAllowed(x, y), 0x1a7f3c, WILDFLOWER_CHANCE, WILDFLOWER_KINDS),
    );
    for (const field of WORLD_LAYOUT.flowerFields) {
      this.addDecalSprites(
        scatterDecals(
          field.rect,
          (x, y) => this.grassDecorAllowed(x, y),
          0x3c9e + field.palette * 7919,
          FLOWER_FIELD_CHANCE,
          [bloomDecalKind(field.palette)],
        ),
      );
    }
  }

  private addDecalSprites(placements: readonly DecalPlacement[]): void {
    const { frames } = this.textures.decals;
    for (const placement of placements) {
      const sprite = new Sprite(frames[placement.kind] ?? frames[0]!);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(placement.x, placement.y);
      if (placement.flip) sprite.scale.x = -1;
      this.decals.addChild(sprite);
      this.cullables.push({ sprite, x: placement.x, y: placement.y, padX: 10, padY: 20 });
    }
  }

  /**
   * 草地贴花只长在草地上：水面、土路、桥面都不生成（广场已是草地，ADR-0017）。
   * 判定本体在 `ground.ts`——小动物撒点读的是同一份规则。
   */
  private grassDecorAllowed(x: number, y: number): boolean {
    return isOutdoorGround(x, y);
  }

  /** 基础层不进花海：花海由 addDecals 单独按配色撒，避免三种花混成噪点 */
  private decalAllowed(x: number, y: number): boolean {
    if (!this.grassDecorAllowed(x, y)) return false;
    for (const field of WORLD_LAYOUT.flowerFields) if (rectContains(field.rect, x, y)) return false;
    return true;
  }

  private addTrees(depth: DepthSink): void {
    const trees = [
      ...WORLD_LAYOUT.forests.flatMap((forest) => forest.trees),
      ...WORLD_LAYOUT.wildTrees,
    ];
    for (const tree of trees) {
      const parts = this.textures.trees[tree.variant % this.textures.trees.length]!;
      this.addPropShadow(tree.x, tree.y, this.textures.shadows.tree);
      const trunk = this.treeSprite(depth, parts.trunk, tree.x, tree.y);
      // 树干与树冠同帧同锚点、同 zIndex：角色在树后时两层都在其上，
      // 遮挡只把树冠 alpha 压到 0.85，树干保持不透明（ADR-0013）。
      const canopy = this.treeSprite(depth, parts.canopy, tree.x, tree.y);
      // 树冠向上长到 108px、向两边各探 36px，裁剪范围要覆盖到
      this.cullables.push({ sprite: trunk, x: tree.x, y: tree.y, padX: 36, padY: 112 });
      this.cullables.push({ sprite: canopy, x: tree.x, y: tree.y, padX: 36, padY: 112 });
      this.trackCanopy(canopy, tree.x, tree.y);
    }
  }

  private treeSprite(depth: DepthSink, texture: Texture, x: number, y: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, y);
    depth.add(y, sprite);
    return sprite;
  }

  /** 只登记树冠：遮挡判定只关心树冠，树干永远不透明 */
  private trackCanopy(sprite: Sprite, x: number, y: number): void {
    const entry: CanopyEntry = {
      sprite,
      left: x - 36,
      right: x + 36,
      top: y - CANOPY_TOP,
      bottom: y - CANOPY_BOTTOM,
      baseY: y,
    };
    this.canopies.push(entry);
    const key = cellKey(x, y);
    const bucket = this.canopyGrid.get(key);
    if (bucket) bucket.push(entry);
    else this.canopyGrid.set(key, [entry]);
  }

  private addPlanters(depth: DepthSink): void {
    for (const planter of WORLD_LAYOUT.planters) {
      this.addPropShadow(planter.x, planter.y, this.textures.shadows.planter);
      const sprite = new Sprite(this.textures.planter);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(planter.x, planter.y);
      depth.add(planter.y, sprite);
      this.cullables.push({ sprite, x: planter.x, y: planter.y, padX: 16, padY: 36 });
    }
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
          sprite.tilePosition.y = (sprite.tilePosition.y + 1) % surface.tile;
        } else {
          sprite.tilePosition.x = (sprite.tilePosition.x + 1) % surface.tile;
        }
      }
    }
  }

  /**
   * 树冠遮挡：角色站在树后（脚底 y 小于树根）且包围盒与树冠盒相交时，
   * 只把树冠压到 0.85，树干保持不透明。
   *
   * 每帧只处理「进入 / 离开」的差异；命中查询走 128px 空间索引，
   * 60 个角色 × 邻近 8 棵树 ≈ 数百次比较，且不产生任何分配。
   */
  occlude(positions: Float32Array, count: number): void {
    if (this.canopies.length === 0) return;
    this.nextLit.clear();

    for (let i = 0; i < count; i += 1) {
      const px = positions[i * 2]!;
      const py = positions[i * 2 + 1]!;
      const left = px - PONY_HALF_W;
      const right = px + PONY_HALF_W;
      const top = py - PONY_HEIGHT;

      const fromX = Math.floor(left / OCCLUSION_CELL);
      const toX = Math.floor(right / OCCLUSION_CELL);
      const fromY = Math.floor(top / OCCLUSION_CELL);
      const toY = Math.floor(py / OCCLUSION_CELL);
      for (let cy = fromY; cy <= toY; cy += 1) {
        for (let cx = fromX; cx <= toX; cx += 1) {
          const bucket = this.canopyGrid.get((cx << 16) ^ cy);
          if (!bucket) continue;
          for (const entry of bucket) {
            // 站在树前面（y 更大）的人本来就该压住整棵树，不需要透明
            if (py >= entry.baseY) continue;
            if (right < entry.left || left > entry.right) continue;
            if (py < entry.top || top > entry.bottom) continue;
            this.nextLit.add(entry);
          }
        }
      }
    }

    for (const entry of this.litCanopies) {
      if (!this.nextLit.has(entry)) entry.sprite.alpha = 1;
    }
    for (const entry of this.nextLit) {
      if (!this.litCanopies.has(entry)) entry.sprite.alpha = 0.85;
    }
    this.litCanopies.clear();
    for (const entry of this.nextLit) this.litCanopies.add(entry);
  }

  /** 视口裁剪：贴花与树不进画面就翻 renderable，排序与绘制都省掉 */
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
    this.base.destroy({ children: true });
    this.edge.destroy({ children: true });
    this.decals.destroy({ children: true });
    for (const tree of this.textures.trees) {
      tree.trunk.destroy(true);
      tree.canopy.destroy(true);
    }
    this.textures.grass.destroy(true);
    this.textures.dirt.destroy(true);
    this.textures.water.destroy(true);
    this.textures.sea.destroy(true);
    this.textures.rock.destroy(true);
    this.textures.reed.destroy(true);
    this.textures.planter.destroy(true);
    this.textures.decals.texture.destroy(true);
    this.textures.shadows.tree.destroy(true);
    this.textures.shadows.planter.destroy(true);
    this.textures.shadows.rock.destroy(true);
  }
}
