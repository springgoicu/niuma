/**
 * 场所色板：每个场所的地面三档（主 / 次 / 缝）与一处点缀色收在一张表里。
 *
 * 为什么单独成表：地板由 `props.ts` 画、陈设由 `venue-art.ts` 画、灯由
 * `venue-art.ts` 的 `lights` 交出去，三处都要同一个色。以前每处各写一份
 * 十六进制，改一次要翻三个文件，还容易把「相邻场所色相至少错开 90°」这条纪律踩掉。
 *
 * 色温纪律（ADR-0013，详见 `.codebuddy/skills/pixel-venue-polish/references/palette.md`）：
 * 1. 暖色低饱和 pastel 打底；
 * 2. 描边 / 暗边一律取本体色相压暗，禁止纯黑与中性灰；
 * 3. 明度阶梯只留两三档，地面越花角色越出不来。
 */

export type VenueId =
  | 'workroom'
  | 'vent'
  | 'street'
  | 'meeting'
  | 'lounge'
  | 'restroom'
  | 'theater'
  | 'cell'
  | 'plaza'
  /** 迎宾拱门门前的迎宾毯（ADR-0097 的地标，配色沿用拱门奶油 + 薄荷） */
  | 'arch'
  | 'shrine'
  | 'tea'
  | 'neonStrip'
  | 'clinic'
  | 'apartment'
  | 'villas'
  | 'park'
  | 'lake'
  | 'bulletin';

export interface VenueColors {
  /** 地面主色 */
  readonly main: number;
  /** 地面次色：错缝、条带、收边 */
  readonly alt: number;
  /** 缝隙与细线 */
  readonly seam: number;
  /** 点缀色：陈设、灯罩、旗幡 */
  readonly accent: number;
  /** 该场所的焦点光色 */
  readonly glow: number;
}

export const VENUE_COLORS: Record<VenueId, VenueColors> = {
  /** 办公区：冷灰水泥地 + 冷白荧光点缀，压出加班楼的冰冷秩序感 */
  workroom: { main: 0x8c939e, alt: 0x7f8691, seam: 0x6a717c, accent: 0xd8eef8, glow: 0xd8eef8 },
  /** 发泄室（ADR-0097）：深灰橡胶地 + 警示黄边，重工业感的唯一暖色出口 */
  vent: { main: 0x4a4f5a, alt: 0x555b66, seam: 0x333844, accent: 0xe8c46a, glow: 0xffc078 },
  /** 五区街面：现代冷米灰混凝土铺装，五区门前共用一档，靠区色收边区分 */
  street: { main: 0xc3c2bd, alt: 0xb8b7b1, seam: 0x94938d, accent: 0xffe6a8, glow: 0xffc078 },
  /** 会议室：深灰蓝集装箱会议舱，靠冷白灯带提亮 */
  meeting: { main: 0x5c6675, alt: 0x525c6a, seam: 0x434b57, accent: 0xd8eef8, glow: 0xd8eef8 },
  /** 宿舍：生活区保留暖灰地毯，与办公区的冷灰拉开色温 */
  lounge: { main: 0xe8c9a6, alt: 0xdcbb96, seam: 0xcaa680, accent: 0xffc078, glow: 0xffc078 },
  restroom: { main: 0xf3f8fb, alt: 0xe3edf3, seam: 0xbfd0dc, accent: 0x9fd3ff, glow: 0xe8f4ff },
  theater: { main: 0x232833, alt: 0x1b2029, seam: 0x4a2a2e, accent: 0x9ff5d2, glow: 0x9ff5d2 },
  /** 冷灰水泥：带蓝相，不用中性灰 */
  cell: { main: 0x6d7078, alt: 0x7a7d85, seam: 0x545861, accent: 0xc9b6ff, glow: 0xc9b6ff },
  /** 中央广场：水磨石浅灰 + 拼色石板，环形导视铜条压边；中心仍留暖光 */
  plaza: { main: 0xb4b8bf, alt: 0xc0c4ca, seam: 0x8f949c, accent: 0xd8eef8, glow: 0xffd08a },
  /** 迎宾雨棚前场：折叠钢构雨棚下的深灰沥青前庭，配柔白灯带 */
  arch: { main: 0x5d6673, alt: 0x525a66, seam: 0x434a55, accent: 0xd8eef8, glow: 0xd8eef8 },
  /** 机房/数据节点：防静电地板冷灰蓝 + 冷白指示灯（原石龛地坪） */
  shrine: { main: 0x707b8c, alt: 0x67717f, seam: 0x566070, accent: 0xd8eef8, glow: 0x7ca8b8 },
  /** 咖啡吧台：水磨石台面 + 琥珀暖灯，现代极简铝吧台 */
  tea: { main: 0x9aa0a8, alt: 0x8e949c, seam: 0x71767e, accent: 0xffc078, glow: 0xffc078 },
  /** 霓虹商业街：湿沥青靛青主路面 + 粉紫/青碧霓虹点缀 */
  neonStrip: { main: 0x2b3248, alt: 0x353f59, seam: 0x23293b, accent: 0xf06595, glow: 0x00f5d4 },
  clinic: { main: 0xf3f8fb, alt: 0xe3edf3, seam: 0xbfd0dc, accent: 0xd64545, glow: 0xe8f4ff },
  /** 公寓：包豪斯暖灰抹面 + 外凸阳台的暖灯 */
  apartment: { main: 0xd8cfc2, alt: 0xcfc5b6, seam: 0xa79a88, accent: 0xffc078, glow: 0xffc078 },
  /** 8 处房产：浅灰混凝土铺装 + 防腐木甲板，万家灯火靠门头灯带 */
  villas: { main: 0xc9c3b8, alt: 0xbdb7ac, seam: 0x99938a, accent: 0xffc078, glow: 0xffc078 },
  park: { main: 0x9fe6cd, alt: 0x8fdcc2, seam: 0x7cc9ae, accent: 0xfff6e0, glow: 0xffd08a },
  lake: { main: 0x63b3c2, alt: 0x86ccd8, seam: 0x2f6f86, accent: 0xa9e0e8, glow: 0x9ff5d2 },
  /** 公告栏区域：冷灰亚克力告示架前场 */
  bulletin: { main: 0xb8bcc2, alt: 0xaab0b7, seam: 0x868c94, accent: 0xd8eef8, glow: 0xd8eef8 },
};

/**
 * 现代都市材质色板（ADRs：去国风重塑）。
 *
 * 与 `TOWN_MATERIALS` 的分工：那份是园区早期「欧美小镇」的木石料，
 * 仍被门牌、挂灯、咖啡吧台共用；这份是本次新增的现代工业与赛博材质，
 * 只给立面、街道家具与地面细节取色，两者都遵守「描边取本体压暗」的同一套纪律。
 */
export const URBAN_MATERIALS = {
  /** 清水混凝土：主面 / 暗面 / 受光面 */
  concrete: 0x8c939e,
  concreteDark: 0x5a606e,
  concreteLight: 0xb4b8bf,
  /** 现代沥青：干路面与微雨湿路面，湿面更蓝更亮 */
  asphalt: 0x323a4b,
  asphaltWet: 0x3d4658,
  asphaltSheen: 0x55617a,
  /** 水磨石：广场与商业街铺装 */
  terrazzo: 0xb9bcc2,
  terrazzoSpeck: 0x9aa1ac,
  /** 结构钢与哑光钢板 */
  steel: 0x6b7480,
  steelDark: 0x424a57,
  steelLight: 0x9aa4b1,
  matteSteel: 0x2f3540,
  /** 玻璃幕墙：夜间反光偏冷蓝 */
  glass: 0x3f5a78,
  glassLight: 0x6f96bd,
  /** 亚克力告示架与铝吧台 */
  acrylic: 0xd9e6ef,
  aluminum: 0xb8c0c8,
  /** 冷暖两个光锚点：企业冷白荧光 / 街头琥珀暖灯 */
  fluoroCold: 0xd8eef8,
  fluoroCyan: 0x7ca8b8,
  amber: 0xffc078,
  amberDeep: 0xd98a4a,
  /** 赛博霓虹三原色 */
  neonPink: 0xf06595,
  neonViolet: 0x9b5de5,
  neonTeal: 0x00f5d4,
  /** 施工与警戒 */
  hazardYellow: 0xd8b34a,
  cautionWhite: 0xe6e3d8,
  /** 工业锈迹、橡胶、纸箱、集装箱 */
  rust: 0x8a5a3c,
  rubber: 0x3a3f47,
  cardboard: 0xa88055,
  container: 0x4c6b74,
  /** 干枯草坪与落叶微尘：秋冬衔接时压住人行道边缘 */
  turfDry: 0xd0b878,
} as const;

/** 全站统一描边与投影：深靛，不带中性黑 */
export const VENUE_OUTLINE = 0x2a3142;
export const VENUE_SHADOW = 0x1e2846;

/**
 * 欧美小镇材料色板（ADR-0096）。
 *
 * 门牌、凉亭、神龛、饮品台、院门牌匾共用一份，理由与 `VENUE_COLORS` 相同：
 * 同一根木柱会被三处绘制代码取色，各写一份十六进制必然漂。取色纪律照旧：
 * 描边取同色相压暗（`outlineOf`），不写纯黑；铁件用带蓝相的深灰，保持冷调。
 */
export const TOWN_MATERIALS = {
  /** 深胡桃木柱与横梁 */
  timber: 0x6b4a32,
  timberLight: 0x96714f,
  timberDark: 0x4b3324,
  /** 白漆栏杆、柱帽与封檐板 */
  paint: 0xf3ede1,
  paintShade: 0xcfc6b6,
  /** 奶油色牌面 + 木边 + 墨绿字 */
  board: 0xfff6e0,
  boardEdge: 0x8a6446,
  boardInk: 0x2f5d4a,
  /** 铁艺灯架、链条与螺栓 */
  iron: 0x3a3f47,
  ironLight: 0x5b636e,
  /** 铜钉、门牌小件 */
  brass: 0xc9a14a,
  /** 灯罩玻璃与夜间光色 */
  lampGlass: 0xffe7b8,
  lampGlow: 0xffc98a,
  /** 台基、石龛与叠石 */
  stone: 0xcfc7b6,
  stoneDark: 0xa79f8e,
  stoneLight: 0xf0eadb,
} as const;

/** 同色相压暗：只动明度，不动色相（比例 0.4 ≈ 描边，0.85 ≈ 砖缝） */
export function darken(color: number, ratio: number): number {
  const r = Math.round(((color >> 16) & 0xff) * ratio);
  const g = Math.round(((color >> 8) & 0xff) * ratio);
  const b = Math.round((color & 0xff) * ratio);
  return (r << 16) | (g << 8) | b;
}

/** 线性混色：`t = 0` 取 `a`，`t = 1` 取 `b` */
export function mixColor(a: number, b: number, t: number): number {
  const clamp = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * clamp);
  const g = Math.round(ag + (bg - ag) * clamp);
  const bl = Math.round(ab + (bb - ab) * clamp);
  return (r << 16) | (g << 8) | bl;
}

/** 描边色：本体压到四成明度，再向深靛混一小口，避免纯压暗发脏 */
export function outlineOf(color: number): number {
  return mixColor(darken(color, 0.4), VENUE_OUTLINE, 0.25);
}

/** 砖缝色：压到八成半，仍读得出母色 */
export function seamOf(color: number): number {
  return darken(color, 0.85);
}

/** 提亮色：向暖白混，用于受光面与灯下高光 */
export function lighten(color: number, t = 0.22): number {
  return mixColor(color, 0xfff3d0, t);
}
