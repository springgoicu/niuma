import { Px } from './canvas';

/**
 * 品牌标记：一枚 16×16 的像素「工牌」。
 *
 * 暗色圆角底板是员工证件，奶油色牛头是主角，右耳挂着的薄荷耳标是「编号员工」，
 * 也是全图唯一的冷色。16px 是这块画布的下限——再小的图标只能读出一个点，
 * 所以细节只保留剪影、口鼻与耳标三样。
 *
 * 画法沿用角色的纪律：1px 硬边、无抗锯齿、无半透明、每种材质只给本体与一档阴影。
 * 唯一的例外是**不描外轮廓**：深底上 1px 深色描边会被底板吃掉，剪影对比优先。
 *
 * 16×16 太小，逐格手写比调用形体函数更好审查，所以这里用字符位图当唯一真相；
 * 改一个像素就是改一个字符，仍然由 `pnpm assets` 生成、不进仓库。
 */

export const LOGO_SIZE = 16;

/** slot 0 是透明；其余索引对应 BRAND_COLORS 的同位 */
const SLOT = {
  none: 0,
  tile: 1,
  body: 2,
  shade: 3,
  muzzle: 4,
  ink: 5,
  mint: 6,
} as const;

/** 索引即 slot；颜色全部取自 globals.css 的 @theme，不引入新色 */
const BRAND_COLORS: ReadonlyArray<number | null> = [
  null,
  0x14100c, // ink-900：与 viewport.themeColor 同色，标签页图标和浏览器主题不打架
  0xf4ede1, // mist-100：牛头本体
  0xc7bcab, // 本体色压暗一档（≈0.81），只压右下
  0xd9cdb9, // 口鼻：比本体再暗一点，撑住牛脸的下半张
  0x221b16, // ink-700：眼睛与鼻孔，全图仅有的两处深色细节
  0x4fe3c1, // mint-400：全图唯一冷色，只给耳标
];

const LEGEND: Record<string, number> = {
  '.': SLOT.none,
  '#': SLOT.tile,
  B: SLOT.body,
  D: SLOT.shade,
  M: SLOT.muzzle,
  N: SLOT.ink,
  T: SLOT.mint,
};

/**
 * 睁眼帧。四角各切 1px 成像素圆角；牛角从额头两角向外斜出一格，
 * 左耳在眼睛同高的位置探出，右耳位置直接挂着薄荷耳标。
 */
const OPEN_GRID: readonly string[] = [
  '.##############.',
  '################',
  '##BB########BB##',
  '###BB######BB###',
  '####BBBBBBBB####',
  '####BBBBBBBD####',
  '####BBBBBBBD####',
  '##BBBNBBBNBDTT##',
  '##BBBNBBBNBDTT##',
  '####BBBBBBBDTT##',
  '####BMMMMMMD####',
  '####BMMMMMMD####',
  '####BMNMMNMD####',
  '#####DDDDDD#####',
  '################',
  '.##############.',
];

/**
 * 眨眼帧与睁眼帧只差 4 个像素：眼睛从 1×2 竖点改成向外延伸的 2×1 横线，
 * 其余逐格一致（hover 时两帧叠图只切 opacity，差一个像素就会看见位移）。
 */
const BLINK_DIFF: ReadonlyArray<readonly [number, number, string]> = [
  [5, 7, 'B'],
  [9, 7, 'B'],
  [4, 8, 'N'],
  [10, 8, 'N'],
];

export type LogoFrame = 'open' | 'blink';

/** 画一帧标记；返回的 Px 里每个像素是 slot，导出时由 logoRgba 换成颜色 */
export function drawLogo(frame: LogoFrame = 'open'): Px {
  const px = new Px(LOGO_SIZE, LOGO_SIZE);
  for (let y = 0; y < LOGO_SIZE; y += 1) {
    const row = OPEN_GRID[y]!;
    for (let x = 0; x < LOGO_SIZE; x += 1) {
      px.set(x, y, LEGEND[row[x]!] ?? SLOT.none);
    }
  }
  if (frame === 'blink') {
    for (const [x, y, ch] of BLINK_DIFF) px.set(x, y, LEGEND[ch]!);
  }
  return px;
}

/**
 * 整数倍最近邻放大。**不做非整数缩放**：16 → 180 不是整数倍，
 * 硬缩会得到忽宽忽窄的像素块，那种糊是「被浏览器拉过」的糊（ADR-0005 同一原则）。
 */
export function logoRgba(px: Px, scale: number): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`logo scale must be a positive integer, got ${scale}`);
  }
  const size = px.w * scale;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < px.h; y += 1) {
    for (let x = 0; x < px.w; x += 1) {
      const color = BRAND_COLORS[px.get(x, y)];
      if (color == null) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const index = ((y * scale + dy) * size + x * scale + dx) * 4;
          out[index] = (color >> 16) & 0xff;
          out[index + 1] = (color >> 8) & 0xff;
          out[index + 2] = color & 0xff;
          out[index + 3] = 255;
        }
      }
    }
  }
  return out;
}

/** 底板色：iOS 图标补齐四周时用它，避免透明被系统填成纯黑 */
export const LOGO_TILE_HEX = BRAND_COLORS[SLOT.tile]!;
