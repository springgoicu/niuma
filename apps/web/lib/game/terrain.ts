'use client';

import { Container, Graphics, Sprite, TilingSprite, type Application, type Texture } from 'pixi.js';
import {
  BAMBOO_SHOOT_ZONES,
  ISLAND,
  ISLAND_SAND,
  LAKE_SHORE,
  PATH_MAIN_HALF_WIDTH,
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
  contourPolygon,
  offsetContour,
  organicContour,
  polygonContour,
  resampleContour,
  roundedRectContour,
  traceContour,
  type ContourPoint,
} from './autotile';
import { buildBorderForest } from './border-forest';
import {
  LEAF_KINDS,
  PETAL_KINDS,
  SHOOT_KINDS,
  WILDFLOWER_KINDS,
  bloomDecalKind,
  scatterDecals,
  type DecalPlacement,
} from './decals';
import { isOutdoorGround } from './ground';
import { seeded } from './seeded';
import { SpatialCuller } from './spatial-cull';
import type { DepthSink } from './sort-layer';
import {
  EDGE_STYLE,
  MATERIAL,
  WINTER_EDGE_STYLE,
  WINTER_GRASS_FRINGE,
  buildMaterialGrid,
  edgeGlyphs,
  type EdgeStyle,
  type MaterialGrid,
  type MaterialId,
} from './terrain-edge';
import { TERRAIN_COLORS as C, URBAN_GROUND as U, WINTER_COLORS as W } from './terrain-palette';
import {
  HERO_TREE_H,
  PROP_SHADOW,
  TREE_H,
  makeAsphaltTexture,
  makeDecalAtlas,
  makeDirtTexture,
  makeGrassTexture,
  makePlanterTexture,
  makePropShadowTexture,
  makeReedTexture,
  makeRockTexture,
  makeSnowTexture,
  makeStoneTexture,
  makeTreeTextureBank,
  makeWaterTexture,
  makeWildTexture,
  type DecalAtlas,
  type TreeTextureBank,
} from './terrain-textures';
import { GROVE_FLOOR_STYLE, speciesAt, type TreeSpeciesId } from './vegetation-species';

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
/** 必须与 makeWildTexture 的 size 一致 */
const WILD_TILE = 96;
/** 必须与 makeDirtTexture 的 size 一致 */
const DIRT_TILE = 128;
/** 必须与 makeAsphaltTexture 的 size 一致 */
const ASPHALT_TILE = 128;
/** 必须与 makeStoneTexture 的 size 一致 */
const STONE_TILE = 128;
/** 边界外林地平铺超出世界矩形的余量：贴边走到尽头也不会看到硬边（ADR-0064） */
const WILD_EXTENT = 2048;
/** 水面滚动的最小时间片：湖慢河快靠 `every` 区分 */
const WATER_TICK_MS = 140;
/** 花海花朵密度：普通草地 0.12，花海要密到看得出「一片」 */
const FLOWER_FIELD_CHANCE = 0.4;
/** 全岛零散野花：只做点缀，压到普通贴花的五分之一 */
const WILDFLOWER_CHANCE = 0.025;
/** 树丛下的落叶密度：只铺在树冠范围内，不混进基础草地层 */
const LEAF_CHANCE = 0.34;
/** 竹林里的竹笋密度（ADR-0061）：「零星」而不是「一层」 */
const SHOOT_CHANCE = 0.22;
/** 角色的包围盒（texel）：遮挡判定用它去和树冠盒求交 */
const PONY_HALF_W = 13;
const PONY_HEIGHT = 48;
/** 树冠遮挡判定尺寸（标准景观树 / 百岁地标古树） */
const TREE_CANOPY_HALF_W = 40;
const TREE_CANOPY_BOTTOM = 24;
const HERO_CANOPY_HALF_W = 58;
const HERO_CANOPY_BOTTOM = 28;
/** 树冠网格索引的单元边长 */
const OCCLUSION_CELL = 128;
/** 三排环岛密林着色：近岸鲜明 → 中排柔暗 → 远排与林地融合 */
const BORDER_NEAR_TINT = 0xd2e0c8;
const BORDER_MID_TINT = 0xa3ba99;
const BORDER_FAR_TINT = 0x769072;

/**
 * 主干道路缘的冷灰变体（去国风重塑）。
 *
 * 刻意不改 `MATERIAL` 枚举：材质网格里主干道仍记作 `dirt`，
 * 于是 `materialAt`、8 邻掩码、`terrain-edge.test.ts` 与寻路全部零影响，
 * 只有「贴图换成沥青 + 路缘暗边换成清水混凝土」这两件事发生变化。
 */
const ASPHALT_EDGE_STYLE: EdgeStyle = {
  ...EDGE_STYLE[MATERIAL.dirt],
  rim: U.concreteDark,
  toothDeep: C.grassDeep,
};

interface TerrainTextures {
  grass: Texture;
  dirt: Texture;
  /** 主干道沥青：支路仍用 `dirt`，靠路宽在 `addPaths` 里分流 */
  asphalt: Texture;
  stone: Texture;
  water: Texture;
  /** 边界外林地地面（ADR-0064）：四边密林脚下的深色底 */
  wild: Texture;
  treeBank: TreeTextureBank;
  rock: Texture;
  reed: Texture;
  planter: Texture;
  decals: DecalAtlas;
  /** 冬季才烘焙的覆雪平铺：夏季整张不存在，也不占显存 */
  snow?: Texture;
  /** 树 / 古树 / 花箱 / 石头的底座投影，全部按 0x1E2846 @0.2 烘焙 */
  shadows: { tree: Texture; heroTree: Texture; planter: Texture; rock: Texture };
}

/** 一段待绘制的边缘：底色全部画完之后再统一出图，草缘永远最后压上 */
interface EdgeJob {
  self: MaterialId;
  other: MaterialId;
  contour: ContourPoint[];
  /** 是否画内缘暗边；边界沙带这类两侧都要接住的带状材质没有内侧边 */
  rim: boolean;
  /** 强制齿的生长方向；缺省由「对面是不是草」推断 */
  grow?: 'in' | 'out';
  /**
   * 本段轮廓专用的边缘样式：主干道把暖棕土边换成冷灰清水混凝土路缘。
   * 缺省走 `EDGE_STYLE[job.self]`，材质 ID 本身不变。
   */
  style?: EdgeStyle;
  seed: number;
}

interface WaterSurface {
  sprite: TilingSprite;
  axis: 'x' | 'y';
  /** 每 N 个时间片滚动 1px */
  every: number;
  /** 平铺周期；湖面与其它平铺材质的尺寸不同，回绕必须各用各的 */
  tile: number;
}

export interface TerrainOptions {
  /**
   * `?flat=1`：退回「矩形 TilingSprite」的旧画法。
   * 圆角轮廓与草缘一旦在线上出现观感回归，这一个开关就能把地形切回原样，
   * 不用回滚整次发布（ADR-0013 的灰度开关）。ADR-0047 起它同时关掉
   * 石砖圆庭的铺面与带状路的圆角，只保留路缘与纯色路带。
   */
  flat?: boolean;
  /** `?edge=0`：只关边缘层（草尖/圆弧/内缘暗边），底色与轮廓照旧 */
  edge?: boolean;
  /**
   * 冬季（ADR-0046）：覆雪层、雪缘、冷调水面、积雪山冠与岸边薄冰都由它开关。
   * 由 `season.ts` 在读 URL 时判定一次，地形只消费布尔量，不自己读日期。
   */
  winter?: boolean;
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

/**
 * 地形视图：本项目的 MapRenderer。
 *
 * 三层结构（与 ADR-0013 的图层纪律一致）：
 * - `base`：材质底色与轮廓遮罩（林地 → 草 → 边界沙带 → 密林围边 → 林下 → 花海 → 石砖圆庭 → 土路 → 三湖）；
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
  private readonly culler = new SpatialCuller();
  private readonly canopies: CanopyEntry[] = [];
  private readonly canopyGrid = new Map<number, CanopyEntry[]>();
  private readonly litCanopies = new Set<CanopyEntry>();
  private readonly nextLit = new Set<CanopyEntry>();
  /** 边缘任务：底色阶段只登记，底色全部落盘后再统一出图 */
  private readonly edges: EdgeJob[] = [];
  private depth: DepthSink | null = null;
  private grid: MaterialGrid | null = null;
  private readonly edgeEnabled: boolean;
  /** 冬季开关：构造期算好，帧循环里没有再判一次日期的分支 */
  private readonly winter: boolean;
  private waterElapsed = 0;
  private waterFrame = 0;

  constructor(
    renderer: TextureFactory,
    private readonly options: TerrainOptions = {},
  ) {
    // 材质网格有 66k 格，只有真的要画边缘时才开始算
    this.edgeEnabled = !this.options.flat && this.options.edge !== false;
    this.winter = options.winter === true;
    this.textures = {
      grass: makeGrassTexture(renderer),
      dirt: makeDirtTexture(renderer),
      asphalt: makeAsphaltTexture(renderer),
      stone: makeStoneTexture(renderer),
      water: makeWaterTexture(renderer, this.winter),
      wild: makeWildTexture(renderer, this.winter),
      treeBank: makeTreeTextureBank(renderer, this.winter),
      rock: makeRockTexture(renderer),
      reed: makeReedTexture(renderer),
      planter: makePlanterTexture(renderer),
      decals: makeDecalAtlas(renderer),
      ...(this.winter ? { snow: makeSnowTexture(renderer) } : {}),
      shadows: {
        tree: makePropShadowTexture(renderer, PROP_SHADOW.tree.w, PROP_SHADOW.tree.h),
        heroTree: makePropShadowTexture(renderer, PROP_SHADOW.heroTree.w, PROP_SHADOW.heroTree.h),
        planter: makePropShadowTexture(renderer, PROP_SHADOW.planter.w, PROP_SHADOW.planter.h),
        rock: makePropShadowTexture(renderer, PROP_SHADOW.rock.w, PROP_SHADOW.rock.h),
      },
    };
  }

  /** `depth` 负责按脚底 y 把树与道具放进正确的深度层 */
  build(depth: DepthSink): void {
    this.depth = depth;
    this.addWild();
    // 先铺 29 顶点多边形沙滩外环，再在内缩草地上遮罩草皮，天然严丝合缝形成 26px 有机沙滩
    this.addSandBand();
    this.addGrass();
    this.addBorderForest();
    this.addGroveFloor();
    this.addFlowerMeadow();
    // 覆雪压在草地/林下/花海之上、路缘与土路之下
    if (this.winter) this.addSnowCover();
    this.addPlaza();
    this.addPaths();
    for (const lake of WORLD_LAYOUT.lakes) this.addLake(lake);
    // 底色全部就位后再画边缘：草缘压在土、石、水、沙的暗边之上
    this.flushEdges();
    this.addDecor();
    this.addDecals();
    this.addTrees(depth);
    this.addPlanters(depth);
  }

  /**
   * 边界外林地：铺在最底层并向外扩一圈，任何视口贴到地图边缘都不会露出黑边。
   * ADR-0064：原来的深海换成一片静止的深色林下地面，林墙（`addBorderForest`）压在上面。
   */
  private addWild(): void {
    const wild = new TilingSprite({
      texture: this.textures.wild,
      width: WORLD_WIDTH + WILD_EXTENT * 2,
      height: WORLD_HEIGHT + WILD_EXTENT * 2,
    });
    wild.position.set(-WILD_EXTENT, -WILD_EXTENT);
    this.base.addChild(wild);
  }

  /**
   * 沙滩装饰带：沿 29 顶点有机岛界向内铺出一条 26px 宽细沙环。
   * 沙环本身先铺满整座岛外缘轮廓，随后 `addGrass` 用内缩 `ISLAND_SAND` 轮廓遮罩盖在上面，
   * 天然无接缝、无孔洞、无凹角折断。
   */
  private addSandBand(): void {
    const outer = polygonContour(ISLAND.points, 22);
    const inner = offsetContour(outer, -ISLAND_SAND);
    const sand = new Graphics();
    traceContour(sand, outer);
    sand.fill(C.sand);
    this.base.addChild(sand);

    if (!this.edgeEnabled) return;
    // 内缘：草压着沙长，齿向外生长
    this.edges.push({
      self: MATERIAL.sand,
      other: MATERIAL.grass,
      contour: inner,
      rim: false,
      grow: 'out',
      seed: 0x5a4d31,
    });
    // 外缘：沙探进深林地面，补湿沙暗边
    this.edges.push({
      self: MATERIAL.sand,
      other: MATERIAL.outside,
      contour: outer,
      rim: true,
      seed: 0x6b5e42,
    });
  }

  /** 有机多边形草地：贴合内缩海岸线，覆盖沙滩内圈 */
  private addGrass(): void {
    const outer = polygonContour(ISLAND.points, 22);
    const inner = offsetContour(outer, -ISLAND_SAND);
    if (this.options.flat) {
      const g = new Graphics();
      traceContour(g, inner);
      g.fill(C.grassBase);
      this.base.addChild(g);
      return;
    }
    const { x, y, w, h } = ISLAND.bounds;
    const grass = new TilingSprite({ texture: this.textures.grass, width: w, height: h });
    grass.position.set(x, y);
    const mask = new Graphics();
    traceContour(mask, inner);
    mask.fill(0xffffff);
    this.base.addChild(mask, grass);
    grass.mask = mask;
  }

  /**
   * 环岛三层密林：绕 29 顶点多边形海岸外侧排布近 / 中 / 远三圈生态林带，只画不碰。
   */
  private addBorderForest(): void {
    const trees = buildBorderForest(ISLAND.points);
    const near = new Container();
    const mid = new Container();
    const far = new Container();
    for (const tree of trees) {
      const variants = this.textures.treeBank.bySpecies[tree.species];
      const tex = (variants?.[tree.variant % variants.length] ?? this.textures.treeBank.flat[0]!).canopy;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(tree.x, tree.y);
      sprite.tint =
        tree.depth === 0 ? BORDER_NEAR_TINT : tree.depth === 1 ? BORDER_MID_TINT : BORDER_FAR_TINT;
      (tree.depth === 0 ? near : tree.depth === 1 ? mid : far).addChild(sprite);
      this.culler.add(sprite, tree.x, tree.y, 44, TREE_H + 6);
    }
    // 远排在底 → 中排过渡 → 近排压在最前
    this.base.addChild(far, mid, near);
  }

  /**
   * 生态树丛林下地被：6 种群落主题自带对应叶色与花瓣斑点地面。
   */
  private addGroveFloor(): void {
    WORLD_LAYOUT.groves.forEach((grove, index) => {
      const style = GROVE_FLOOR_STYLE[grove.theme];
      const rect = {
        x: grove.x - grove.radius,
        y: grove.y - grove.radius,
        w: grove.radius * 2,
        h: grove.radius * 2,
      };
      const g = new Graphics();
      if (this.options.flat) {
        g.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: style.fill, alpha: style.alpha });
      } else {
        const contour = organicContour(rect, 0x1f3a + index * 7919, 10, 22);
        traceContour(g, contour);
        g.fill({ color: style.fill, alpha: style.alpha });
        g.poly(contourPolygon(contour)).stroke({ color: style.rim, width: 3, alignment: 1, alpha: 0.42 });
        // 林下光斑与落花碎影：按每棵树微偏撒 4 枚微粒地面块
        const rand = seeded(0x3a91 + index * 1009);
        for (const t of grove.trees) {
          for (let p = 0; p < 3; p += 1) {
            const px = Math.round(t.x + (rand() - 0.5) * 44);
            const py = Math.round(t.y + (rand() - 0.5) * 28);
            g.rect(px, py, 2 + Math.floor(rand() * 2), 2).fill({ color: style.petalFill, alpha: 0.28 });
          }
        }
      }
      this.base.addChild(g);
    });
  }

  /**
   * 花海底色：4 号熏衣草草甸带冷清鼠尾草蓝绿底，其余保留暖意草甸色。
   */
  private addFlowerMeadow(): void {
    WORLD_LAYOUT.flowerFields.forEach((field, index) => {
      const g = new Graphics();
      const contour = organicContour(field.rect, 0x6f1d + index * 3571, 10, 26);
      const isLavender = field.palette === 3;
      traceContour(g, contour);
      g.fill({ color: isLavender ? 0x7c8f78 : C.meadowTint, alpha: 0.42 });
      g.poly(contourPolygon(contour)).stroke({
        color: isLavender ? 0x627370 : C.meadowShade,
        width: 2,
        alignment: 1,
        alpha: 0.5,
      });
      this.base.addChild(g);
    });
  }

  /**
   * 冬季覆雪层：严格遮罩在 29 顶点多边形内缩 `ISLAND_SAND` 的陆地上，岸边仍是湿沙。
   */
  private addSnowCover(): void {
    const texture = this.textures.snow;
    if (!texture) return;
    const snow = new TilingSprite({
      texture,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    });
    snow.tilePosition.set(0, 0);

    if (this.options.flat) {
      this.base.addChild(snow);
      return;
    }

    const inner = offsetContour(polygonContour(ISLAND.points, 22), -ISLAND_SAND);
    const mask = new Graphics();
    traceContour(mask, inner);
    mask.fill(0xffffff);
    this.base.addChild(mask);
    snow.mask = mask;
    this.base.addChild(snow);
  }

  /**
   * 中央石砖圆庭（ADR-0047）：720px 的圆，外圈 12px 石缘 + 2px 深缝。
   * `roundedRectContour` 在半径 = 半边长时正好收成一个 1px 步进的圆。
   * `?flat=1` 退回 ADR-0017 的旧观感：不铺石面，只留路缘。
   */
  private addPlaza(): void {
    const plaza = WORLD_LAYOUT.plaza;
    const contour = roundedRectContour(plaza, WORLD_LAYOUT.plazaRadius);
    const flat = contourPolygon(contour);

    if (!this.options.flat) {
      const stone = new TilingSprite({ texture: this.textures.stone, width: plaza.w, height: plaza.h });
      stone.position.set(plaza.x, plaza.y);
      stone.tilePosition.set(plaza.x % STONE_TILE, plaza.y % STONE_TILE);
      const mask = new Graphics();
      traceContour(mask, contour);
      mask.fill(0xffffff);
      this.base.addChild(mask, stone);
      stone.mask = mask;
    }

    const curb = new Graphics();
    // alignment 0 = 描边落在轮廓外侧（Pixi 8 的 1 才是内侧）
    curb.poly(flat).stroke({ color: C.plazaSeam, width: 12, alignment: 0, join: 'round' });
    curb.poly(flat).stroke({ color: C.plazaCurb, width: 10, alignment: 0, join: 'round' });
    this.base.addChild(curb);

    if (this.edgeEnabled) {
      this.edges.push({ self: MATERIAL.stone, other: MATERIAL.grass, contour, rim: true, seed: 0x7a31c5 });
    }
  }

  /**
   * 带状道路：矩形包围盒平铺 + 多边形遮罩，转弯处不再是 90° 硬拼。
   *
   * 去国风重塑后按路宽分两档贴图：
   * - **主干道**（`PATH_MAIN_HALF_WIDTH`）铺现代沥青，路缘换冷灰混凝土；
   * - **支路**仍是踩实的土路，保留「从柏油路拐进泥径」的园区层次。
   * 两者材质 ID 都是 `dirt`，因此材质网格、8 邻掩码与寻路一行未改。
   */
  private addPaths(): void {
    for (const path of WORLD_LAYOUT.paths) {
      const main = path.halfWidth === PATH_MAIN_HALF_WIDTH;
      if (this.options.flat) {
        const g = new Graphics();
        g.poly(flattenPoints(path.polygon)).fill(main ? U.asphalt : C.dirtBase);
        this.base.addChild(g);
        continue;
      }
      this.paintRegion(
        MATERIAL.dirt,
        MATERIAL.grass,
        path.rect,
        main ? this.textures.asphalt : this.textures.dirt,
        main ? ASPHALT_TILE : DIRT_TILE,
        polygonContour(path.polygon, 10),
        main ? ASPHALT_EDGE_STYLE : undefined,
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
    style?: EdgeStyle,
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
        ...(style ? { style } : {}),
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
      const palette = this.winter ? WINTER_EDGE_STYLE : EDGE_STYLE;
      // 主干道自带冷灰路缘：只有贴图与路缘色换掉，材质 ID 仍是 dirt
      const style = job.style ?? palette[job.self];
      // 冬季的「地被」是雪：对面是草的那套齿色整体换成雪色，
      // 否则雪地上会长出一圈绿草尖，整层覆雪就白铺了
      const fringe = this.winter
        ? job.other === MATERIAL.grass
          ? WINTER_GRASS_FRINGE
          : palette[job.self]
        : undefined;

      if (job.rim) {
        g.poly(flat).stroke({ color: style.rim, width: style.rimWidth, alignment: 1, join: 'round' });
      }
      if (job.other === MATERIAL.grass) {
        g.poly(flat).stroke({
          color: this.winter ? W.snowLight : C.grassTuft,
          width: 2,
          alignment: 0.5,
          join: 'round',
        });
      }
      for (const glyph of edgeGlyphs(job.contour, {
        self: job.self,
        other: job.other,
        grow: job.grow,
        seed: job.seed,
        grid,
        fringe,
      })) {
        g.rect(glyph.x, glyph.y, glyph.w, glyph.h).fill(glyph.color);
      }
      this.edge.addChild(g);
      // 冬季：土路两侧压一条薄雪（ADR-0099）。雪被踩化的只有路心，
      // 路缘本来就是最先积雪的地方——2px 内缘 + 零星 1×1 雪粒，不做整条白边
      if (this.winter && job.self === MATERIAL.dirt) this.addPathSnow(job.contour, job.seed);
    }
    this.edges.length = 0;
  }

  /**
   * 路缘薄雪：沿土路轮廓向内压 2px 的雪色内缘，再按 7px 密度撒 1×1 雪粒。
   * 只在 `edgeEnabled && !flat` 的冬季分支里调用，夏季一格都不生成。
   */
  private addPathSnow(contour: ContourPoint[], seed: number): void {
    const snow = new Graphics();
    snow
      .poly(contourPolygon(contour))
      .stroke({ color: W.snowBase, width: 2, alignment: 1, join: 'round', alpha: 0.78 });
    const random = seeded(seed ^ 0x51f2);
    for (const point of resampleContour(contour, 7)) {
      // 大约六成留下雪粒：整圈都撒会变成描边，全不留又读不出积雪
      if (random() > 0.62) continue;
      const x = point.x + (random() > 0.5 ? 1 : -1);
      const y = point.y + (random() > 0.5 ? 1 : -1);
      snow.rect(x, y, 1 + Math.floor(random() * 2), 1).fill(random() > 0.4 ? W.snowLight : W.snowShade);
    }
    this.edge.addChild(snow);
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
    if (!this.options.flat) {
      const rand = seeded(0x63a9 + Math.round(lake.rect.x) * 13 + Math.round(lake.rect.y));
      const shoreRing = offsetContour(
        lake.points.map(([x, y]) => ({ x, y })),
        Math.round(LAKE_SHORE * 0.62),
      );
      for (const point of resampleContour(shoreRing, 32)) {
        if (rand() > 0.55) continue;
        const px = Math.round(point.x + (rand() - 0.5) * 6);
        const py = Math.round(point.y + (rand() - 0.5) * 6);
        const tint = this.winter ? (rand() > 0.5 ? W.snowLight : W.iceEdge) : rand() > 0.45 ? C.sandLight : C.sand;
        shore.rect(px, py, 2 + Math.floor(rand() * 2), 2).fill({ color: tint, alpha: 0.72 });
      }
    }
    this.base.addChild(shore);

    const water = this.addWaterSurface(lake.rect, 'x', 3);
    const mask = new Graphics();
    traceContour(mask, contour);
    mask.fill(0xffffff);
    this.base.addChild(mask);
    water.mask = mask;
    if (this.winter) this.addIceRim(contour, 0x4c1a2f);

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
   * 岸边薄冰：只沿水岸内侧画 3px 冰带 + 几粒碎冰，不整片盖住水面。
   *
   * 整片结冰会把「湖」读成「另一种地面」，而冬季真正读得出来的是
   * 「岸边先冻、水面还在动」——冰带贴边，水面照旧滚动，一眼就知道那是水。
   */
  private addIceRim(contour: ContourPoint[], seed: number): void {
    if (contour.length < 3) return;
    const flat = contourPolygon(contour);
    const ice = new Graphics();
    // alignment 1 = 向轮廓内侧生长，冰带永远落在水里
    ice.poly(flat).stroke({ color: W.iceEdge, width: 4, alignment: 1, join: 'round' });
    ice.poly(flat).stroke({ color: W.iceBase, width: 3, alignment: 1, join: 'round' });
    const random = seeded(seed);
    const chips = Math.min(48, Math.max(6, Math.round(contour.length / 6)));
    for (let i = 0; i < chips; i += 1) {
      // 采样点落在轮廓上，再随机往里探 1–3px：碎冰一定在冰带里，不会飘到岸上
      const point = contour[Math.floor(random() * contour.length)]!;
      const x = Math.round(point.x + (random() - 0.5) * 4);
      const y = Math.round(point.y + (random() - 0.5) * 4);
      ice.rect(x, y, 1 + Math.floor(random() * 3), 1).fill(random() > 0.5 ? W.snowLight : W.iceBase);
    }
    this.base.addChild(ice);
  }

  private addWaterSurface(rect: WorldRect, axis: 'x' | 'y', every: number): TilingSprite {
    const water = new TilingSprite({ texture: this.textures.water, width: rect.w, height: rect.h });
    water.position.set(rect.x, rect.y);
    // 平铺偏移按世界坐标对齐：三湖共用同一相位，岸线接水处波纹不会各算各的
    water.tilePosition.set(rect.x % WATER_TILE, rect.y % WATER_TILE);
    this.base.addChild(water);
    this.surfaces.push({ sprite: water, axis, every, tile: WATER_TILE });
    return water;
  }

  /** 岸边碎石与芦苇：纯点缀，不参与碰撞 */
  private addDecor(): void {
    const random = seeded(0x6c2f1a);
    for (const lake of WORLD_LAYOUT.lakes) {
      let placed = 0;
      for (let attempt = 0; attempt < 900 && placed < 72; attempt += 1) {
        const x = lake.rect.x + random() * lake.rect.w;
        const y = lake.rect.y + random() * lake.rect.h;
        if (pointInPolygon(x, y, lake.points)) continue;
        const distance = distanceSqToPolygon(x, y, lake.points);
        if (distance < 225 || distance > 58 * 58) continue;
        this.addDecalSprite(random() > 0.45 ? 'reed' : 'rock', x, y);
        placed += 1;
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
    this.culler.add(sprite, px, py, 12, 26);
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
    this.culler.add(shadow, x, y, 32, 14);
  }

  /**
   * 贴花层：草地基底（三叶草 / 雏菊 / 草尖 / 石粒）+ 全岛零散野花 + 三片花海。
   * 三层共用同一张图集与同一套视口裁剪，帧循环里只翻 renderable。
   */
  private addDecals(): void {
    // 冬季整层不生成：花与草叶本来就被雪埋了，留着只会浮在雪面上。
    // 顺带省掉 900–1200 个精灵——覆雪层的开销正好被这一条抵掉。
    if (this.winter) return;
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
    // 林间落叶与樱瓣：樱花 / 蓝花楹林混铺落花瓣，其余落叶
    for (const grove of WORLD_LAYOUT.groves) {
      const rect = {
        x: grove.x - grove.radius,
        y: grove.y - grove.radius,
        w: grove.radius * 2,
        h: grove.radius * 2,
      };
      this.addDecalSprites(
        scatterDecals(rect, (x, y) => this.decalAllowed(x, y), 0x7ea5 + grove.x * 31 + grove.y, LEAF_CHANCE, LEAF_KINDS),
      );
      if (grove.theme === 'sakura' || grove.theme === 'jacaranda') {
        this.addDecalSprites(
          scatterDecals(rect, (x, y) => this.decalAllowed(x, y), 0x91c3 + grove.x * 17 + grove.y, 0.42, PETAL_KINDS),
        );
      }
    }
    // 竹笋（ADR-0061）：只撒在竹林区，走近竹林才看得见零星青绿笋尖
    for (const zone of BAMBOO_SHOOT_ZONES) {
      this.addDecalSprites(
        scatterDecals(zone, (x, y) => this.decalAllowed(x, y), 0x2b7c + zone.x * 17 + zone.y, SHOOT_CHANCE, SHOOT_KINDS),
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
      this.culler.add(sprite, placement.x, placement.y, 10, 20);
    }
  }

  /**
   * 草地贴花只长在草地上：水面、土路、石砖圆庭、铺装与建筑内部都不生成。
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
      ...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees),
      ...WORLD_LAYOUT.looseTrees,
    ];
    for (const tree of trees) {
      const isHero = tree.scale === 1;
      const species: TreeSpeciesId = tree.species ?? speciesAt(tree.x, tree.y);
      const parts = isHero
        ? this.textures.treeBank.heroBySpecies[species]
        : this.textures.treeBank.bySpecies[species][tree.variant % 3]!;
      this.addPropShadow(
        tree.x,
        tree.y,
        isHero ? this.textures.shadows.heroTree : this.textures.shadows.tree,
      );
      const trunk = this.treeSprite(depth, parts.trunk, tree.x, tree.y);
      const canopy = this.treeSprite(depth, parts.canopy, tree.x, tree.y);
      const cullW = isHero ? 68 : 44;
      const cullH = isHero ? HERO_TREE_H + 6 : TREE_H + 6;
      this.culler.add(trunk, tree.x, tree.y, cullW, cullH);
      this.culler.add(canopy, tree.x, tree.y, cullW, cullH);
      this.trackCanopy(canopy, tree.x, tree.y, isHero);
    }
  }

  private treeSprite(depth: DepthSink, texture: Texture, x: number, y: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, y);
    depth.add(y, sprite);
    return sprite;
  }

  /** 只登记树冠（覆盖树冠矩形穿过的全部 128px 格）：古树高于 128px 也不会漏检 */
  private trackCanopy(sprite: Sprite, x: number, y: number, hero = false): void {
    const halfW = hero ? HERO_CANOPY_HALF_W : TREE_CANOPY_HALF_W;
    const topH = hero ? HERO_TREE_H : TREE_H;
    const botH = hero ? HERO_CANOPY_BOTTOM : TREE_CANOPY_BOTTOM;
    const entry: CanopyEntry = {
      sprite,
      left: x - halfW,
      right: x + halfW,
      top: y - topH,
      bottom: y - botH,
      baseY: y,
    };
    this.canopies.push(entry);
    const fromX = Math.floor(entry.left / OCCLUSION_CELL);
    const toX = Math.floor(entry.right / OCCLUSION_CELL);
    const fromY = Math.floor(entry.top / OCCLUSION_CELL);
    const toY = Math.floor(entry.baseY / OCCLUSION_CELL);
    for (let cy = fromY; cy <= toY; cy += 1) {
      for (let cx = fromX; cx <= toX; cx += 1) {
        const key = (cx << 16) ^ cy;
        const bucket = this.canopyGrid.get(key);
        if (bucket) bucket.push(entry);
        else this.canopyGrid.set(key, [entry]);
      }
    }
  }

  private addPlanters(depth: DepthSink): void {
    for (const planter of WORLD_LAYOUT.planters) {
      this.addPropShadow(planter.x, planter.y, this.textures.shadows.planter);
      const sprite = new Sprite(this.textures.planter);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(planter.x, planter.y);
      depth.add(planter.y, sprite);
      this.culler.add(sprite, planter.x, planter.y, 16, 36);
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

  /** 视口裁剪：委托 512px 分块空间裁剪器 */
  cull(minX: number, minY: number, maxX: number, maxY: number): void {
    this.culler.cull(minX, minY, maxX, maxY);
  }

  destroy(): void {
    this.culler.clear();
    this.base.destroy({ children: true });
    this.edge.destroy({ children: true });
    this.decals.destroy({ children: true });
    for (const variants of Object.values(this.textures.treeBank.bySpecies)) {
      for (const tree of variants) {
        tree.trunk.destroy(true);
        tree.canopy.destroy(true);
      }
    }
    for (const hero of Object.values(this.textures.treeBank.heroBySpecies)) {
      hero.trunk.destroy(true);
      hero.canopy.destroy(true);
    }
    this.textures.grass.destroy(true);
    this.textures.dirt.destroy(true);
    this.textures.asphalt.destroy(true);
    this.textures.stone.destroy(true);
    this.textures.water.destroy(true);
    this.textures.wild.destroy(true);
    this.textures.rock.destroy(true);
    this.textures.reed.destroy(true);
    this.textures.planter.destroy(true);
    this.textures.decals.texture.destroy(true);
    this.textures.snow?.destroy(true);
    this.textures.shadows.tree.destroy(true);
    this.textures.shadows.heroTree.destroy(true);
    this.textures.shadows.planter.destroy(true);
    this.textures.shadows.rock.destroy(true);
  }
}
