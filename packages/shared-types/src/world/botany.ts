/**
 * 园区植物与花海生态引擎（独立于 layout.ts 总装，双端唯一真相）：
 *
 * - 9 大景观树种：银杏 ginkgo / 冬青 holly / 羽毛枫 maple / 罗汉松 pine / 垂柳 willow /
 *   染井吉野樱 sakura / 蓝花楹 jacaranda / 地中海丝柏 cypress / 金桂 osmanthus；
 * - 6 大林下生态主题与 5 套非对称树丛阵型（新月弯弧 / 三角错落 / 阶梯层瀑 / 疏林空地 / 双生树）；
 * - 6 棵地标级百年古树（`scale: 1`），镇守岛屿六个岬角与景区入口；
 * - 10 片四色调花海（白雏菊 / 金盏 / 暖粉玫瑰 / 熏衣草与鸢尾）；
 * - 严格禁止 Math.random / Math.sin / Math.cos，全部由 `Math.imul` 的 mulberry32 与整型偏移表生成。
 */

import { distanceSqToPolygon, polygonBounds, rectContains, type Point, type WorldRect } from './geometry';
import type { IslandShape } from './island';
import type { PathShape } from './layout';

/** 9 大植物图鉴树种（前 5 位顺序与旧版保持兼容，后 4 位为重塑新增） */
export type TreeSpecies =
  | 'ginkgo'
  | 'holly'
  | 'maple'
  | 'pine'
  | 'willow'
  | 'sakura'
  | 'jacaranda'
  | 'cypress'
  | 'osmanthus';

export const TREE_SPECIES_LIST: readonly TreeSpecies[] = [
  'ginkgo',
  'holly',
  'maple',
  'pine',
  'willow',
  'sakura',
  'jacaranda',
  'cypress',
  'osmanthus',
] as const;

export const TREE_SPECIES_COUNT = TREE_SPECIES_LIST.length;

/** 6 大林下生态地面主题 */
export type GroveTheme = 'sakura' | 'ginkgo' | 'maple' | 'pine' | 'willow' | 'jacaranda';

export interface TreeInstance {
  x: number;
  y: number;
  /** 0..2，每个树种三套形态变体 */
  variant: number;
  /** 显式树种：双端布局、渲染图集与小地图树冠点位共用 */
  species: TreeSpecies;
  /** 0 = 标准景观树，1 = 地标古树（更粗树干与双层大冠） */
  scale?: 0 | 1;
}

/**
 * 树丛：2–5 棵树的不规则生态群落。
 * `radius` 与 `theme` 决定林下光斑、落花落叶地被与小地图柔边。
 */
export interface TreeCluster {
  x: number;
  y: number;
  radius: number;
  theme: GroveTheme;
  trees: TreeInstance[];
}

/**
 * 一片花海：矩形为包围盒，渲染层切出有机波形草甸与四色花丛。
 * 0 白雏菊 / 1 金盏 / 2 暖粉玫瑰 / 3 熏衣草鸢尾
 */
export interface FlowerPatch {
  rect: WorldRect;
  palette: 0 | 1 | 2 | 3;
}

/** 标准树干碰撞半径 & 地标古树树干碰撞半径 */
export const TREE_TRUNK_RADIUS = 12;
export const HERO_TREE_TRUNK_RADIUS = 18;

/** 任意两棵树的最小间距（测试断言下限），生成时再留 6px 缓冲 */
export const TREE_MIN_GAP = 80;
export const TREE_GAP = 86;
export const GROVE_MIN_GAP = 220;
const GROVE_RADIUS = 126;

/**
 * 翠竹林区（西主路南侧与翠竹隐士居东邻）。
 * `isPlantable` 会自动排除这两片带区，把空位让给竹竿与春笋。
 */
export const BAMBOO_ZONES: ReadonlyArray<WorldRect> = [
  { x: 2660, y: 4220, w: 220, h: 120 },
  { x: 3340, y: 4220, w: 120, h: 200 },
];

export const BAMBOO_SHOOT_ZONES: ReadonlyArray<WorldRect> = BAMBOO_ZONES;

/**
 * 全岛 10 片多色系花海：包含熏衣草（palette 3）、暖粉玫瑰（2）、金盏（1）与白雏菊（0）。
 * 均严格避开建筑、水域、路面、铺装、竹林与公寓花园小径。
 */
export const FLOWER_FIELDS: ReadonlyArray<FlowerPatch> = [
  // 西岸竹林南侧暖粉草甸
  { rect: { x: 2660, y: 4390, w: 180, h: 140 }, palette: 2 },
  // 沉思塘与服务区之间的紫韵熏衣草田
  { rect: { x: 4680, y: 3260, w: 220, h: 150 }, palette: 3 },
  // 东岸钓屋北侧雏菊坡地
  { rect: { x: 5380, y: 4460, w: 160, h: 140 }, palette: 0 },
  // 涟漪湖南岸向阳金盏花谷
  { rect: { x: 2660, y: 5260, w: 220, h: 150 }, palette: 1 },
  // 服务广场南—摸鱼湖北紫薇熏衣草带
  { rect: { x: 4920, y: 4580, w: 200, h: 150 }, palette: 3 },
  // 涟漪湖东南岸白瓣花坪
  { rect: { x: 2880, y: 5140, w: 170, h: 110 }, palette: 0 },
  // 301 公寓门前口袋花园内的一畦熏衣草花圃（严格避开石板小径）
  { rect: { x: 3540, y: 4960, w: 200, h: 150 }, palette: 3 },
  // 西北不夜城北草坡樱粉花坪
  { rect: { x: 3220, y: 2480, w: 220, h: 140 }, palette: 2 },
  // 沉思塘南东侧暖阳金盏坡
  { rect: { x: 5380, y: 3220, w: 180, h: 140 }, palette: 1 },
  // 企业楼前庭北侧早樱玫瑰坪
  { rect: { x: 3760, y: 3360, w: 200, h: 150 }, palette: 2 },
];

/** 6 棵地标百年古树：分布全岛六个极具辨识度的岬角与枢纽视角 */
interface HeroSpec {
  readonly x: number;
  readonly y: number;
  readonly species: TreeSpecies;
  readonly variant: number;
}

export const HERO_TREE_SPECS: ReadonlyArray<HeroSpec> = [
  // 北游乐—沉思浅塘垭口樱王
  { x: 4740, y: 2460, species: 'sakura', variant: 0 },
  // 东北沉思茶半岛悬崖百年迎客松
  { x: 5490, y: 2760, species: 'pine', variant: 1 },
  // 东岸急救半岛紫云蓝花楹古木
  { x: 5570, y: 3860, species: 'jacaranda', variant: 2 },
  // 东南摸鱼岬半岛临湖古垂柳
  { x: 5580, y: 4880, species: 'willow', variant: 0 },
  // 南生活半岛金秋银杏王
  { x: 4460, y: 5740, species: 'ginkgo', variant: 1 },
  // 西岸景观岬顶绯红百年枫王
  { x: 2480, y: 3920, species: 'maple', variant: 2 },
];

type FormationKind = 'crescent' | 'triad' | 'cascade' | 'glade' | 'duet';

/** 5 套有机偏移阵型（两两间距均 >= 90px，彻底打破规则五边形网格味） */
const FORMATION_OFFSETS: Record<FormationKind, ReadonlyArray<Point>> = {
  crescent: [
    [-92, 18],
    [-42, -74],
    [54, -76],
    [98, 12],
    [10, 74],
  ],
  triad: [
    [0, -90],
    [-82, 46],
    [82, 48],
    [-16, 8],
    [96, -54],
  ],
  cascade: [
    [-86, -68],
    [-6, -34],
    [82, -8],
    [-64, 52],
    [40, 82],
  ],
  glade: [
    [-88, -32],
    [12, -92],
    [92, -18],
    [68, 72],
    [-48, 78],
  ],
  duet: [
    [-58, -38],
    [56, 36],
    [-70, 56],
    [76, -56],
    [-6, -96],
  ],
};

interface GroveSeed {
  readonly x: number;
  readonly y: number;
  readonly formation: FormationKind;
  readonly theme: GroveTheme;
  readonly companions: readonly TreeSpecies[];
}

/** 22 处手工精选生态群落：覆盖全岛五区与外缘岬角 */
const GROVE_SEEDS: ReadonlyArray<GroveSeed> = [
  // 北翼：游乐区北岬樱海与红枫坡
  { x: 2800, y: 2540, formation: 'crescent', theme: 'sakura', companions: ['sakura', 'sakura', 'maple'] },
  { x: 3360, y: 2450, formation: 'glade', theme: 'sakura', companions: ['sakura', 'osmanthus', 'sakura'] },
  { x: 3820, y: 2390, formation: 'cascade', theme: 'maple', companions: ['maple', 'sakura', 'cypress'] },
  { x: 4380, y: 2390, formation: 'triad', theme: 'sakura', companions: ['sakura', 'ginkgo', 'maple'] },
  // 东北：沉思半岛松竹茶谷
  { x: 5440, y: 3040, formation: 'glade', theme: 'pine', companions: ['pine', 'pine', 'osmanthus'] },
  { x: 4920, y: 3420, formation: 'cascade', theme: 'jacaranda', companions: ['jacaranda', 'ginkgo', 'osmanthus'] },
  { x: 5440, y: 3420, formation: 'triad', theme: 'pine', companions: ['pine', 'cypress', 'pine'] },
  // 东翼：急救与服务南坡
  { x: 5540, y: 4160, formation: 'crescent', theme: 'jacaranda', companions: ['jacaranda', 'osmanthus', 'holly'] },
  { x: 5240, y: 4480, formation: 'triad', theme: 'ginkgo', companions: ['osmanthus', 'jacaranda', 'ginkgo'] },
  // 东南：摸鱼湖畔柳岸桂林
  { x: 4700, y: 4760, formation: 'cascade', theme: 'willow', companions: ['willow', 'osmanthus', 'holly'] },
  { x: 4720, y: 5200, formation: 'glade', theme: 'willow', companions: ['willow', 'ginkgo', 'willow'] },
  { x: 5500, y: 5620, formation: 'crescent', theme: 'willow', companions: ['willow', 'pine', 'osmanthus'] },
  // 南岸：生活南岬银杏与冬青
  { x: 4980, y: 5760, formation: 'triad', theme: 'ginkgo', companions: ['ginkgo', 'osmanthus', 'holly'] },
  { x: 4040, y: 5830, formation: 'duet', theme: 'ginkgo', companions: ['holly', 'ginkgo', 'cypress'] },
  { x: 3340, y: 5790, formation: 'crescent', theme: 'ginkgo', companions: ['ginkgo', 'holly', 'jacaranda'] },
  { x: 2880, y: 5540, formation: 'glade', theme: 'maple', companions: ['maple', 'ginkgo', 'holly'] },
  // 西南：涟漪湾水畔与竹园外林
  { x: 2580, y: 4520, formation: 'cascade', theme: 'willow', companions: ['willow', 'maple', 'cypress'] },
  { x: 3560, y: 4440, formation: 'triad', theme: 'pine', companions: ['pine', 'cypress', 'holly'] },
  // 西翼：企业楼与景观峡谷
  { x: 2480, y: 3440, formation: 'crescent', theme: 'maple', companions: ['maple', 'cypress', 'ginkgo'] },
  { x: 3740, y: 3180, formation: 'triad', theme: 'sakura', companions: ['sakura', 'ginkgo', 'jacaranda'] },
  { x: 4380, y: 3220, formation: 'glade', theme: 'jacaranda', companions: ['jacaranda', 'sakura', 'osmanthus'] },
  { x: 3820, y: 4620, formation: 'duet', theme: 'ginkgo', companions: ['ginkgo', 'osmanthus', 'holly'] },
];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tooClose(x: number, y: number, trees: ReadonlyArray<TreeInstance>, gap: number): boolean {
  const gapSq = gap * gap;
  for (const tree of trees) {
    const dx = tree.x - x;
    const dy = tree.y - y;
    if (dx * dx + dy * dy < gapSq) return true;
  }
  return false;
}

/** 区域生态树种选择器：保证每种树在地理分区上可读又有自然混交 */
function regionalSpecies(x: number, y: number, random: () => number): TreeSpecies {
  const r = random();
  // 北缘与西北：染井吉野樱 + 羽毛枫 + 金桂
  if (y < 3250) {
    if (x > 4750) return r < 0.55 ? 'pine' : r < 0.85 ? 'osmanthus' : 'sakura';
    if (r < 0.48) return 'sakura';
    if (r < 0.78) return 'maple';
    return r < 0.9 ? 'jacaranda' : 'ginkgo';
  }
  // 东翼服务区：蓝花楹 + 金桂 + 地中海丝柏
  if (x > 4600 && y < 4600) {
    if (r < 0.42) return 'jacaranda';
    if (r < 0.74) return 'osmanthus';
    return r < 0.9 ? 'cypress' : 'pine';
  }
  // 东南水乡：垂柳 + 金桂 + 罗汉松
  if (x > 4700) {
    if (r < 0.45) return 'willow';
    if (r < 0.78) return 'osmanthus';
    return 'pine';
  }
  // 西岸企业—竹谷带：丝柏 + 银杏 + 红枫
  if (x < 3500 && y < 4600) {
    if (r < 0.4) return 'cypress';
    if (r < 0.72) return 'ginkgo';
    return r < 0.88 ? 'maple' : 'holly';
  }
  // 南生活半岛：冬青 + 银杏 + 蓝花楹
  if (y > 5150) {
    if (r < 0.44) return 'holly';
    if (r < 0.76) return 'ginkgo';
    return r < 0.9 ? 'jacaranda' : 'osmanthus';
  }
  // 中央及过渡草甸混交
  if (r < 0.25) return 'ginkgo';
  if (r < 0.45) return 'osmanthus';
  if (r < 0.65) return 'jacaranda';
  if (r < 0.82) return 'cypress';
  return 'holly';
}

export interface BotanicalBuildInput {
  island: IslandShape;
  paths: ReadonlyArray<PathShape>;
  lakes: ReadonlyArray<{ points: Point[] }>;
  isPlantable: (x: number, y: number) => boolean;
  isHeroPlantable: (x: number, y: number) => boolean;
}

export interface BotanicalBuildResult {
  groves: TreeCluster[];
  looseTrees: TreeInstance[];
  avenueTreeCount: number;
  heroTreeCount: number;
}

const LOOSE_TREE_STEP = 68;
const VARIANTS_PER_SPECIES = 3;

/** 四条主路对应的行道树双物种搭配（奇偶交替） */
const BOULEVARD_PAIR: ReadonlyArray<readonly [TreeSpecies, TreeSpecies]> = [
  ['sakura', 'maple'], // 北主路：游乐花道
  ['ginkgo', 'osmanthus'], // 南主路：生活金街
  ['ginkgo', 'cypress'], // 西主路：企业松柏道
  ['jacaranda', 'osmanthus'], // 东主路：服务蓝楹大道
];

/**
 * 植物总编排管线：
 * 1. 先种 6 棵地标百年古树（防挤占）；
 * 2. 再种 22 处多阵型主题树丛（保证间距 >= 86px、每丛 2–5 棵）；
 * 3. 再沿四条主干道种行道树（保持 `path.halfWidth + 94` 兼容灯笼挂点）；
 * 4. 再绕三湖种垂柳带；
 * 5. 最后全岛草甸疏林补齐密度。
 */
export function buildBotanicalLayout(input: BotanicalBuildInput): BotanicalBuildResult {
  const { island, paths, lakes, isPlantable, isHeroPlantable } = input;
  const planted: TreeInstance[] = [];
  const groves: TreeCluster[] = [];
  const looseTrees: TreeInstance[] = [];

  // 1) 6 棵地标古树
  let heroTreeCount = 0;
  for (const spec of HERO_TREE_SPECS) {
    if (!isHeroPlantable(spec.x, spec.y)) continue;
    if (tooClose(spec.x, spec.y, planted, TREE_GAP + 14)) continue;
    const hero: TreeInstance = {
      x: spec.x,
      y: spec.y,
      variant: spec.variant % VARIANTS_PER_SPECIES,
      species: spec.species,
      scale: 1,
    };
    planted.push(hero);
    looseTrees.push(hero);
    heroTreeCount += 1;
  }

  // 2) 22 处非对称生态树丛
  const acceptedCenters: Point[] = [];
  GROVE_SEEDS.forEach((seed, index) => {
    for (const [cx, cy] of acceptedCenters) {
      const dx = cx - seed.x;
      const dy = cy - seed.y;
      if (dx * dx + dy * dy < GROVE_MIN_GAP * GROVE_MIN_GAP) return;
    }
    const random = mulberry32(0x51ed270b + index * 0x9e3779b1);
    const pattern = FORMATION_OFFSETS[seed.formation];
    const targetCount = 3 + Math.floor(random() * 3); // 3..5 棵，失败降级最少 2 棵
    const trees: TreeInstance[] = [];

    for (let i = 0; i < pattern.length && trees.length < targetCount; i += 1) {
      const [ox, oy] = pattern[i]!;
      const x = seed.x + ox + Math.round((random() - 0.5) * 6);
      const y = seed.y + oy + Math.round((random() - 0.5) * 6);
      if (!isPlantable(x, y)) continue;
      if (tooClose(x, y, planted, TREE_GAP)) continue;
      const species = seed.companions[i % seed.companions.length]!;
      const tree: TreeInstance = {
        x,
        y,
        variant: Math.floor(random() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
        species,
      };
      trees.push(tree);
      planted.push(tree);
    }

    if (trees.length >= 2) {
      groves.push({ x: seed.x, y: seed.y, radius: GROVE_RADIUS, theme: seed.theme, trees });
      acceptedCenters.push([seed.x, seed.y]);
    }
  });

  // 3) 四条主干道林荫道：保持离路心 `path.halfWidth + 94`（落在节庆树灯挂点带 `20..104` 内）
  let avenueTreeCount = 0;
  for (let index = 0; index < 4; index += 1) {
    const path = paths[index];
    if (!path) continue;
    const pair = BOULEVARD_PAIR[index] ?? (['ginkgo', 'osmanthus'] as const);
    const random = mulberry32(0x2f6d1b7 + index * 0x85ebca6b);
    let stepIndex = 0;
    for (let i = 0; i < path.centerline.length - 1; i += 1) {
      const [x0, y0] = path.centerline[i]!;
      const [x1, y1] = path.centerline[i + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const ux = dx / length;
      const uy = dy / length;
      const steps = Math.max(1, Math.floor(length / 195));
      for (let s = 0; s <= steps; s += 1) {
        const t = (s + 0.5) / (steps + 1);
        const bx = x0 + dx * t;
        const by = y0 + dy * t;
        for (const side of [-1, 1] as const) {
          const jitterAlong = Math.round((random() - 0.5) * 20);
          const jitterOut = Math.round((random() - 0.5) * 10);
          const offset = path.halfWidth + 94 + jitterOut;
          const x = Math.round(bx + uy * offset * side + ux * jitterAlong);
          const y = Math.round(by - ux * offset * side + uy * jitterAlong);
          if (!isPlantable(x, y)) continue;
          if (tooClose(x, y, planted, TREE_GAP)) continue;
          const species = pair[(stepIndex + (side > 0 ? 1 : 0)) % pair.length]!;
          const tree: TreeInstance = {
            x,
            y,
            variant: Math.floor(random() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
            species,
          };
          planted.push(tree);
          looseTrees.push(tree);
          avenueTreeCount += 1;
        }
        stepIndex += 1;
      }
    }
  }

  // 4) 三湖水岸垂柳弧带（沿湖多边形四周散生，避开 95px 沙滩线）
  lakes.forEach((lake, lakeIdx) => {
    const random = mulberry32(0x41c64e6d + lakeIdx * 0x9e3779b1);
    const box = polygonBounds(lake.points);
    for (let py = box.y - 140; py <= box.y + box.h + 140; py += 92) {
      for (let px = box.x - 140; px <= box.x + box.w + 140; px += 92) {
        if (random() > 0.52) continue;
        const x = px + Math.round((random() - 0.5) * 44);
        const y = py + Math.round((random() - 0.5) * 44);
        const dSq = distanceSqToPolygon(x, y, lake.points);
        if (dSq < 100 * 100 || dSq > 160 * 160) continue;
        if (!isPlantable(x, y)) continue;
        if (tooClose(x, y, planted, TREE_GAP)) continue;
        const tree: TreeInstance = {
          x,
          y,
          variant: Math.floor(random() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
          species: random() > 0.25 ? 'willow' : 'osmanthus',
        };
        planted.push(tree);
        looseTrees.push(tree);
      }
    }
  });

  // 5) 全岛开阔草甸生态混交散树
  const looseRandom = mulberry32(0x1f3a5c7d);
  const { x: bx, y: by, w: bw, h: bh } = island.bounds;
  for (let py = by + 120; py < by + bh - 120; py += LOOSE_TREE_STEP) {
    for (let px = bx + 120; px < bx + bw - 120; px += LOOSE_TREE_STEP) {
      if (looseRandom() > 0.34) continue;
      const tx = px + Math.round((looseRandom() - 0.5) * LOOSE_TREE_STEP);
      const ty = py + Math.round((looseRandom() - 0.5) * LOOSE_TREE_STEP);
      if (!isPlantable(tx, ty)) continue;
      if (tooClose(tx, ty, planted, TREE_GAP)) continue;
      const species = regionalSpecies(tx, ty, looseRandom);
      const tree: TreeInstance = {
        x: tx,
        y: ty,
        variant: Math.floor(looseRandom() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
        species,
      };
      planted.push(tree);
      looseTrees.push(tree);
    }
  }

  return { groves, looseTrees, avenueTreeCount, heroTreeCount };
}
