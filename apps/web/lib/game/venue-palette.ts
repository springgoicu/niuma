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
  | 'pavilion'
  | 'shrine'
  | 'tea'
  | 'diceHall'
  | 'ring'
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
  workroom: { main: 0xd9ab7c, alt: 0xcf9d70, seam: 0xb5835a, accent: 0x8fe3c7, glow: 0xffd08a },
  /** 发泄室（ADR-0097）：深灰橡胶地 + 警示黄边，和办公室的木地板拉开色相 */
  vent: { main: 0x4a4f5a, alt: 0x555b66, seam: 0x333844, accent: 0xe8c46a, glow: 0xffd08a },
  /** 五区街面：浅石青的公共铺装，五区门前共用一档，靠区色收边区分 */
  street: { main: 0xcdc7ba, alt: 0xc2bbad, seam: 0x9a9285, accent: 0xffe6a8, glow: 0xffd08a },
  meeting: { main: 0xc99a6d, alt: 0xbd8c60, seam: 0xa8774f, accent: 0xffe49a, glow: 0xffd08a },
  lounge: { main: 0xe8c9a6, alt: 0xdcbb96, seam: 0xcaa680, accent: 0x9fd3ff, glow: 0xffd08a },
  restroom: { main: 0xf3f8fb, alt: 0xe3edf3, seam: 0xbfd0dc, accent: 0x9fd3ff, glow: 0xe8f4ff },
  theater: { main: 0x232833, alt: 0x1b2029, seam: 0x4a2a2e, accent: 0x9ff5d2, glow: 0x9ff5d2 },
  /** 冷灰水泥：带蓝相，不用中性灰 */
  cell: { main: 0x6d7078, alt: 0x7a7d85, seam: 0x545861, accent: 0xc9b6ff, glow: 0xc9b6ff },
  plaza: { main: 0xbbb2a0, alt: 0xc6bdaa, seam: 0x8f8574, accent: 0xffe49a, glow: 0xffd08a },
  /** 迎宾拱门迎宾毯：奶油底 + 薄荷边，与 welcome.ts 的招牌同族（不与 plaza 的暖黄撞色） */
  arch: { main: 0xe4d8bd, alt: 0xd6c9ad, seam: 0x8f8574, accent: 0x8fe3c7, glow: 0xffd08a },
  /** 木构凉亭：原木地面 + 白漆栏杆（ADR-0096） */
  pavilion: { main: 0xc9a878, alt: 0xbb9a6c, seam: 0x96754e, accent: 0xf3ede1, glow: 0xffc98a },
  /** 石砌神龛：暖灰石地 + 铜件点缀（ADR-0096） */
  shrine: { main: 0xcfc7b6, alt: 0xc0b8a6, seam: 0x9a9284, accent: 0xc9a14a, glow: 0xffc98a },
  tea: { main: 0xd8b184, alt: 0xc79c6c, seam: 0xa87f52, accent: 0x8fbf7a, glow: 0xffc98a },
  diceHall: { main: 0x2f6b52, alt: 0x3b7a5e, seam: 0x214c3b, accent: 0xe8c47a, glow: 0xff6fb0 },
  ring: { main: 0xd9c096, alt: 0xe7d2ac, seam: 0x8f7a52, accent: 0x3b4a6b, glow: 0xfff0b8 },
  clinic: { main: 0xf3f8fb, alt: 0xe3edf3, seam: 0xbfd0dc, accent: 0xd64545, glow: 0xe8f4ff },
  apartment: { main: 0xd8cfc2, alt: 0xcfc5b6, seam: 0xa79a88, accent: 0x8fe3c7, glow: 0xffd08a },
  villas: { main: 0xe0b48a, alt: 0xd3a578, seam: 0xa87f52, accent: 0x6fcf8e, glow: 0xffd08a },
  park: { main: 0x9fe6cd, alt: 0x8fdcc2, seam: 0x7cc9ae, accent: 0xfff6e0, glow: 0xffd08a },
  lake: { main: 0x63b3c2, alt: 0x86ccd8, seam: 0x2f6f86, accent: 0xa9e0e8, glow: 0x9ff5d2 },
  bulletin: { main: 0xc9b998, alt: 0xbbb2a0, seam: 0x8f8574, accent: 0xf2e7cd, glow: 0xffd08a },
};

/** 全站统一描边与投影：深靛，不带中性黑 */
export const VENUE_OUTLINE = 0x2a3142;
export const VENUE_SHADOW = 0x1e2846;

/**
 * 欧美小镇材料色板（ADR-0096）。
 *
 * 门架、凉亭、神龛、饮品台、院门牌匾共用一份，理由与 `VENUE_COLORS` 相同：
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
