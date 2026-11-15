'use client';

import type { CharacterAppearance, Species } from '@niuma/shared-types';
import { mixHex, toHexString } from '../color';
import type { SpeciesLayers, SpriteManifest } from './atlas';

/**
 * 工卡拍立得：纯原生 Canvas 离屏绘制，零第三方图形依赖。
 *
 * 三条不许破坏的像素纪律：
 * 1) 逻辑尺寸固定 480×720，按 2x 采样；所有绘制都在逻辑坐标里做。
 * 2) 立绘只取图集第 0 帧（down idle），按整数 4 倍最近邻放大。
 * 3) 图层染色走 multiply + destination-in：保留原图 alpha，不把灰度阴影涂平。
 */
export const SHARE_CARD_WIDTH = 480;
export const SHARE_CARD_HEIGHT = 720;
export const SHARE_CARD_SCALE = 2;

const SPRITE_FRAME = 64;
const CHARACTER_SCALE = 4;
const BODY_LIGHT_MIX = 0.22;
const EYE_LIGHT_MIX = 0.7;

const FONT_SANS = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';

/** 分享工牌底部宣传条文案：品牌 + 域名，与 docs/promo.md 的对外口径一致 */
export const SHARE_CARD_SITE_BRAND = '牛马 NIOMA';
export const SHARE_CARD_SITE_DOMAIN = 'bangying.top';

export interface ShareCardData {
  name: string;
  jobTitle: string;
  species: Species;
  appearance: CharacterAppearance;
  /** 形如「中国 · 浙江 · 杭州」；他人工卡只到省 */
  location: string;
  /** 今日工时，HH:MM */
  todayDuration: string;
  /** 今日如厕分钟：工时的一部分，小票单独占一格 */
  todayToiletMinutes?: number;
  /** 今日称号，如「终身免下班」；由工时 / 步数 / 摸鱼次数真实派生 */
  stamp: string;
  /** 今日行为统计 */
  activity?: {
    steps: number;
    distanceM: number;
    ventedCount: number;
    knockdownCount: number;
    overtimeCount: number;
  };
  /** 视野内今日工时名次 */
  rank?: number | null;
  /** false 表示「为 TA 打印」，卡面要标代打语义 */
  isSelf?: boolean;
  /** false 表示对方未上报考勤：卡面显示「未上报」，不用 0 冒充 */
  hasCareer?: boolean;
}

// ---------------------------------------------------------------------------
// 图集：manifest / 图片 / 染色结果全部按 URL 缓存，重复点击不再发请求
// ---------------------------------------------------------------------------

let manifestPromise: Promise<SpriteManifest | null> | null = null;

function loadManifest(): Promise<SpriteManifest | null> {
  if (!manifestPromise) {
    manifestPromise = fetch('/sprites/manifest.json', { cache: 'force-cache' })
      .then((response) => (response.ok ? (response.json() as Promise<SpriteManifest>) : null))
      .catch(() => {
        manifestPromise = null;
        return null;
      });
  }
  return manifestPromise;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const tintCache = new Map<string, HTMLCanvasElement>();

function loadSprite(path: string): Promise<HTMLImageElement> {
  let promise = imageCache.get(path);
  if (!promise) {
    promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`sprite load failed: ${path}`));
      image.src = `/sprites/${path}`;
    });
    promise.catch(() => imageCache.delete(path));
    imageCache.set(path, promise);
  }
  return promise;
}

/** 灰度图层 × 颜色，保留原始 alpha；每层结果按（图源, 颜色, 裁剪框）缓存 */
function tintedFrame(
  image: HTMLImageElement,
  color: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): HTMLCanvasElement {
  const key = `${image.src}|${color}|${sx},${sy},${sw},${sh}`;
  const cached = tintCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = toHexString(color);
  ctx.fillRect(0, 0, sw, sh);
  // multiply 会把透明区域也乘上颜色：再用原图 alpha 裁一次
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.globalCompositeOperation = 'source-over';
  tintCache.set(key, canvas);
  return canvas;
}

type CosmeticKind = 'hair' | 'head' | 'eyes' | 'neck';

interface TintLayerSpec {
  kind: 'tint';
  path: string;
  color: number;
}

interface CosmeticLayerSpec {
  kind: 'cosmetic';
  path: string;
  color: number;
  /** 相对脚底原点的中心偏移，与 pony.ts 的 layoutCosmetics 同口径 */
  anchor: readonly [number, number];
}

type LayerSpec = TintLayerSpec | CosmeticLayerSpec;

/** 渲染顺序与 ADR-0013 的 PONY_LAYER_ORDER 保持一致（这里不引 Pixi 运行时） */
const LAYER_ORDER = [
  'tail',
  'body',
  'pattern',
  'bodyLight',
  'hairstyle',
  'headwear',
  'hoof',
  'extra',
  'eyes',
  'eyeLight',
  'eyewear',
  'snout',
  'neckwear',
] as const;

function buildLayerSpecs(
  manifest: SpriteManifest,
  appearance: CharacterAppearance,
): LayerSpec[] {
  const species: SpeciesLayers | undefined =
    manifest.species[appearance.species] ?? manifest.species.cow;
  if (!species) return [];

  const colors = appearance.colors;
  const extraId =
    appearance.species === 'cow' ? appearance.parts.hornId ?? 0 : appearance.parts.maneId ?? 0;
  const anchors = manifest.cosmeticAnchors[appearance.species]?.down?.['0'];

  const pending = new Map<(typeof LAYER_ORDER)[number], LayerSpec>();

  const tail = species.tail?.[appearance.parts.tailId];
  if (tail) pending.set('tail', { kind: 'tint', path: tail, color: colors.tail });

  const body = species.body[0];
  if (body) pending.set('body', { kind: 'tint', path: body, color: colors.body });

  const pattern = appearance.parts.patternId > 0
    ? species.pattern[appearance.parts.patternId]
    : undefined;
  if (pattern) pending.set('pattern', { kind: 'tint', path: pattern, color: colors.pattern });

  const bodyLight = species.bodyLight?.[0];
  if (bodyLight) {
    pending.set('bodyLight', {
      kind: 'tint',
      path: bodyLight,
      color: mixHex(colors.body, 0xffffff, BODY_LIGHT_MIX),
    });
  }

  const hoof = species.hoof[0];
  if (hoof) pending.set('hoof', { kind: 'tint', path: hoof, color: colors.hoof });

  const extra = species.extra[extraId];
  if (extra) pending.set('extra', { kind: 'tint', path: extra, color: colors.extra });

  const eyes = species.eyes[0];
  if (eyes) pending.set('eyes', { kind: 'tint', path: eyes, color: colors.eyes });

  const eyeLight = species.eyeLight?.[0];
  if (eyeLight) {
    pending.set('eyeLight', {
      kind: 'tint',
      path: eyeLight,
      color: mixHex(colors.eyes, 0xffffff, EYE_LIGHT_MIX),
    });
  }

  const snout = species.snout[appearance.parts.snoutId] ?? species.snout[0];
  if (snout) pending.set('snout', { kind: 'tint', path: snout, color: colors.snout });

  const addCosmetic = (slot: CosmeticKind, value: string | undefined, color: number): void => {
    if (!value || value === 'none') return;
    const path = manifest.cosmeticFiles[slot]?.[value]?.down;
    const anchor = anchors?.[slot];
    if (!path || !anchor) return;
    pending.set(slot === 'hair' ? 'hairstyle' : slot === 'head' ? 'headwear' : slot === 'eyes' ? 'eyewear' : 'neckwear', {
      kind: 'cosmetic',
      path,
      color,
      anchor,
    });
  };

  addCosmetic('hair', appearance.cosmetics.hairstyle, colors.hairstyle);
  addCosmetic('head', appearance.cosmetics.headwear, colors.headwear);
  addCosmetic('eyes', appearance.cosmetics.eyewear, colors.eyewear);
  addCosmetic('neck', appearance.cosmetics.neckwear, colors.neckwear);

  return LAYER_ORDER.flatMap((slot) => {
    const spec = pending.get(slot);
    return spec ? [spec] : [];
  });
}

async function drawCharacter(
  ctx: CanvasRenderingContext2D,
  appearance: CharacterAppearance,
  centerX: number,
  footY: number,
): Promise<boolean> {
  const manifest = await loadManifest();
  if (!manifest) return false;
  const specs = buildLayerSpecs(manifest, appearance);
  if (specs.length === 0) return false;

  const origin = manifest.origin;
  const frameW = manifest.frame?.w ?? SPRITE_FRAME;
  const frameH = manifest.frame?.h ?? SPRITE_FRAME;
  const left = centerX - origin.x * CHARACTER_SCALE;
  const top = footY - origin.y * CHARACTER_SCALE;
  const cosmeticSize = manifest.cosmeticSize ?? 16;

  // 脚底接触阴影：与游戏里一样压在地面上，不抢立绘的像素边
  ctx.save();
  ctx.fillStyle = 'rgba(58, 47, 32, 0.22)';
  ctx.beginPath();
  ctx.ellipse(centerX, footY + 3, 104, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  let drawn = 0;
  for (const spec of specs) {
    try {
      const image = await loadSprite(spec.path);
      if (spec.kind === 'tint') {
        const layer = tintedFrame(image, spec.color, 0, 0, frameW, frameH);
        ctx.drawImage(
          layer,
          left,
          top,
          frameW * CHARACTER_SCALE,
          frameH * CHARACTER_SCALE,
        );
      } else {
        const layer = tintedFrame(image, spec.color, 0, 0, image.naturalWidth, image.naturalHeight);
        const x = centerX + (spec.anchor[0] - cosmeticSize / 2) * CHARACTER_SCALE;
        const y = footY + (spec.anchor[1] - cosmeticSize / 2) * CHARACTER_SCALE;
        ctx.drawImage(
          layer,
          x,
          y,
          cosmeticSize * CHARACTER_SCALE,
          cosmeticSize * CHARACTER_SCALE,
        );
      }
      drawn += 1;
    } catch {
      // 单层素材缺失就跳过：宁可少一顶帽子，也不让整张卡失败
    }
  }
  return drawn > 0;
}

// ---------------------------------------------------------------------------
// 纸张与版式
// ---------------------------------------------------------------------------

function hashString(input: string): number {
  let hash = 5381;
  for (const char of input) {
    hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawPaper(ctx: CanvasRenderingContext2D, seedText: string): void {
  const random = mulberry32(hashString(seedText));
  ctx.fillStyle = '#e9e1cf';
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // 复印纸的横向走纸纹
  ctx.fillStyle = 'rgba(120, 104, 78, 0.045)';
  for (let y = 3; y < SHARE_CARD_HEIGHT; y += 4) {
    ctx.fillRect(0, y, SHARE_CARD_WIDTH, 1);
  }

  // 噪点：900 个 1px 墨点，密度够旧但不脏
  for (let i = 0; i < 900; i += 1) {
    const x = Math.floor(random() * SHARE_CARD_WIDTH);
    const y = Math.floor(random() * SHARE_CARD_HEIGHT);
    const alpha = 0.025 + random() * 0.05;
    ctx.fillStyle = `rgba(92, 78, 56, ${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // 塑料卡套的双色硬边
  ctx.strokeStyle = '#2b241d';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, SHARE_CARD_WIDTH - 4, SHARE_CARD_HEIGHT - 4);
  ctx.strokeStyle = '#f6f1e4';
  ctx.lineWidth = 2;
  ctx.strokeRect(7, 7, SHARE_CARD_WIDTH - 14, SHARE_CARD_HEIGHT - 14);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${chars.join('')}…`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
  }
  return '…';
}

function drawLanyard(ctx: CanvasRenderingContext2D): void {
  // 金属夹
  ctx.fillStyle = '#8f887a';
  ctx.fillRect(212, 10, 56, 12);
  ctx.fillStyle = '#e6e1d6';
  ctx.fillRect(212, 10, 56, 3);
  ctx.fillStyle = '#5c564c';
  ctx.fillRect(212, 19, 56, 3);

  // 挂绳孔
  ctx.fillStyle = '#cbbfa6';
  ctx.fillRect(196, 20, 88, 18);
  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.strokeRect(196, 20, 88, 18);
  ctx.fillStyle = '#1b1611';
  ctx.fillRect(204, 26, 72, 6);
}

function drawHeader(ctx: CanvasRenderingContext2D, isSelf: boolean): void {
  drawLanyard(ctx);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2b241d';
  ctx.font = `600 17px ${FONT_MONO}`;
  ctx.fillText('NIOMA WORKER ID CARD', 240, 60);

  ctx.fillStyle = '#6b5c44';
  ctx.font = `11px ${FONT_SANS}`;
  ctx.fillText(
    isSelf
      ? '牛马园区考勤凭证 · EMPLOYEE ATTENDANCE RECORD'
      : '代打存档 · DATA SELF-REPORTED BY EMPLOYEE',
    240,
    78,
  );

  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 90);
  ctx.lineTo(452, 90);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(246, 241, 228, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, 93);
  ctx.lineTo(452, 93);
  ctx.stroke();
}

function drawPortraitPanel(ctx: CanvasRenderingContext2D, seedText: string): void {
  const random = mulberry32(hashString(`${seedText}:portrait`));
  ctx.fillStyle = '#d8cfb8';
  ctx.fillRect(28, 102, 424, 292);
  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 102, 424, 292);

  // 人像框内的纸纹
  for (let i = 0; i < 220; i += 1) {
    const x = 30 + Math.floor(random() * 420);
    const y = 104 + Math.floor(random() * 288);
    ctx.fillStyle = `rgba(92, 78, 56, ${(0.02 + random() * 0.05).toFixed(3)})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // 四角定位刻度：像冲印机对位用的裁切标记
  ctx.strokeStyle = '#5a4e38';
  ctx.lineWidth = 2;
  const marks: Array<[number, number, number, number]> = [
    [36, 110, 14, 0],
    [36, 110, 0, 14],
    [444, 110, -14, 0],
    [444, 110, 0, 14],
    [36, 386, 14, 0],
    [36, 386, 0, -14],
    [444, 386, -14, 0],
    [444, 386, 0, -14],
  ];
  for (const [x, y, dx, dy] of marks) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }

  ctx.fillStyle = '#6b5c44';
  ctx.font = `9px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('SPECIMEN / 正面免冠', 38, 122);
  ctx.textAlign = 'right';
  ctx.fillText('STAY CALM & KEEP WORKING', 442, 122);
}

function drawIdentity(ctx: CanvasRenderingContext2D, data: ShareCardData): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2b241d';
  ctx.font = `600 23px ${FONT_SANS}`;
  ctx.fillText(fitText(ctx, data.name, 292), 28, 428);

  // 职级做成黑色小标签，压在姓名右侧
  ctx.font = `600 12px ${FONT_SANS}`;
  const titleWidth = Math.ceil(ctx.measureText(data.jobTitle).width) + 18;
  const chipX = 452 - titleWidth;
  ctx.fillStyle = '#2b241d';
  ctx.fillRect(chipX, 409, titleWidth, 25);
  ctx.fillStyle = '#e9e1cf';
  ctx.textAlign = 'center';
  ctx.fillText(data.jobTitle, chipX + titleWidth / 2, 426);

  // 今日名次是姓名下唯一有真实来源的补充信息
  const extras =
    data.hasCareer === false || data.rank === null || data.rank === undefined
      ? ''
      : `同屏劳模榜 · 今日工时第 ${data.rank} 名`;
  if (extras) {
    ctx.fillStyle = '#8c7a5c';
    ctx.font = `10px ${FONT_SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText(fitText(ctx, extras, 424), 28, 448);
  }
}

interface DetailRow {
  label: string;
  value: string;
}

function drawDetails(ctx: CanvasRenderingContext2D, rows: DetailRow[]): void {
  const labelX = 28;
  const valueX = 452;
  let baseline = 486;
  ctx.textBaseline = 'alphabetic';

  for (const row of rows) {
    ctx.font = `11px ${FONT_SANS}`;
    ctx.fillStyle = '#6b5c44';
    ctx.textAlign = 'left';
    ctx.fillText(row.label, labelX, baseline);
    const labelWidth = ctx.measureText(row.label).width;

    ctx.font = `600 13px ${FONT_MONO}`;
    ctx.fillStyle = '#2b241d';
    ctx.textAlign = 'right';
    const value = fitText(ctx, row.value, 288);
    ctx.fillText(value, valueX, baseline);
    const valueWidth = ctx.measureText(value).width;

    // 点线引导：从标签末尾到数值开头，留 8px 呼吸
    const from = labelX + labelWidth + 8;
    const to = valueX - valueWidth - 8;
    if (to > from) {
      ctx.save();
      ctx.strokeStyle = 'rgba(107, 92, 68, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(from, baseline - 3);
      ctx.lineTo(to, baseline - 3);
      ctx.stroke();
      ctx.restore();
    }
    baseline += 21;
  }
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((15 * Math.PI) / 180);

  const width = 120;
  const height = 48;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.lineWidth = 1;
  ctx.strokeRect(-width / 2 + 5, -height / 2 + 5, width - 10, height - 10);

  // 镂空字：只描边不填色，像真的盖章
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 14px ${FONT_MONO}`;
  ctx.strokeText(text, 0, -3);
  ctx.restore();
}

/** 底部宣传条：墨色条带上印品牌与域名，分享到站外时自带网站导流信息 */
function drawPromoBand(ctx: CanvasRenderingContext2D, isSelf: boolean): void {
  ctx.fillStyle = '#2b241d';
  ctx.fillRect(10, 688, 460, 24);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f6f1e4';
  ctx.font = `700 13px ${FONT_MONO}`;
  ctx.fillText(`${SHARE_CARD_SITE_BRAND} · ${SHARE_CARD_SITE_DOMAIN}`, 240, 700);

  ctx.fillStyle = 'rgba(246, 241, 228, 0.62)';
  ctx.font = `7px ${FONT_SANS}`;
  ctx.fillText(
    isSelf
      ? '零服务器持久化 · 数据仅存于本机浏览器 · 仅供自嘲'
      : '代打存档 · 数据由本人客户端自报 · 园区仅做即时转发',
    240,
    708,
  );
}

function drawFallbackCharacter(
  ctx: CanvasRenderingContext2D,
  species: Species,
  centerX: number,
  baseline: number,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `120px "Apple Color Emoji", "Segoe UI Emoji", ${FONT_SANS}`;
  ctx.fillText(species === 'horse' ? '🐴' : '🐄', centerX, baseline);
  ctx.restore();
}

async function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 300);
    }),
  ]);
}

/** 考勤小票：不发立绘，只把今日结算与行为统计排成一张可贴工位的小票。 */
function drawTimesheet(ctx: CanvasRenderingContext2D, data: ShareCardData): void {
  drawPaper(ctx, data.name);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#2b241d';
  ctx.font = `600 18px ${FONT_MONO}`;
  ctx.fillText('NIOMA · 考勤小票', 240, 48);
  ctx.fillStyle = '#6b5c44';
  ctx.font = `10px ${FONT_SANS}`;
  ctx.fillText(
    data.isSelf ? '今日考勤结算 · DAILY TIMESHEET' : '代打存档 · DATA SELF-REPORTED',
    240,
    68,
  );

  ctx.save();
  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(28, 84);
  ctx.lineTo(452, 84);
  ctx.stroke();
  ctx.restore();

  // 身份区
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2b241d';
  ctx.font = `600 24px ${FONT_SANS}`;
  ctx.fillText(fitText(ctx, data.name, 280), 28, 126);

  ctx.font = `600 12px ${FONT_SANS}`;
  const titleWidth = Math.ceil(ctx.measureText(data.jobTitle).width) + 18;
  const chipX = 452 - titleWidth;
  ctx.fillStyle = '#2b241d';
  ctx.fillRect(chipX, 108, titleWidth, 25);
  ctx.fillStyle = '#e9e1cf';
  ctx.textAlign = 'center';
  ctx.fillText(data.jobTitle, chipX + titleWidth / 2, 125);

  if (!data.isSelf) {
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(28, 178, 74, 18);
    ctx.fillStyle = '#f6f1e4';
    ctx.font = `600 9px ${FONT_MONO}`;
    ctx.fillText('代打存档', 65, 191);
  }

  // 2×2 大数字：全部为今日口径
  const reported = data.hasCareer !== false;
  const toiletMinutes = Math.max(0, Math.floor(data.todayToiletMinutes ?? 0));
  const stats: Array<[string, string, string]> = [
    ['今日工时', data.todayDuration, ''],
    ['今日如厕', reported ? String(toiletMinutes) : '未上报', reported ? '分钟' : ''],
    [
      '今日排名',
      reported ? (data.rank ? `第 ${data.rank} 名` : '未上榜') : '未上报',
      '',
    ],
    ['今日步数', reported ? (data.activity?.steps ?? 0).toLocaleString('zh-CN') : '未上报', reported ? '步' : ''],
  ];
  stats.forEach(([label, value, unit], index) => {
    const x = 28 + (index % 2) * 220;
    const y = 210 + Math.floor(index / 2) * 74;
    ctx.fillStyle = '#f2ead8';
    ctx.fillRect(x, y, 204, 62);
    ctx.strokeStyle = '#3a3128';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 204, 62);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b5c44';
    ctx.font = `9px ${FONT_MONO}`;
    ctx.fillText(label, x + 12, y + 18);
    ctx.fillStyle = '#2b241d';
    ctx.font = `600 22px ${FONT_MONO}`;
    const shown = fitText(ctx, value, 120);
    ctx.fillText(shown, x + 12, y + 47);
    if (unit) {
      const valueWidth = ctx.measureText(shown).width;
      ctx.fillStyle = '#8c7a5c';
      ctx.font = `9px ${FONT_SANS}`;
      ctx.fillText(unit, x + 16 + valueWidth, y + 47);
    }
  });

  // 行为统计
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b5c44';
  ctx.font = `9px ${FONT_MONO}`;
  ctx.fillText('ACTIVITY / 今日行为', 28, 380);
  const activity = data.activity;
  const rows: Array<[string, string]> = !reported
    ? [['行为统计', '未上报']]
    : activity
      ? [
          ['今日步数', `${activity.steps.toLocaleString('zh-CN')} 步`],
          ['搬砖里程', `${activity.distanceM.toLocaleString('zh-CN')} 米`],
          ['击倒次数', `${activity.knockdownCount} 次`],
          ['被创次数', `${activity.ventedCount} 次`],
          ['加班次数', `${activity.overtimeCount} 次`],
        ]
      : [['行为统计', '未上报']];
  let baseline = 404;
  for (const [label, value] of rows) {
    ctx.font = `11px ${FONT_SANS}`;
    ctx.fillStyle = '#6b5c44';
    ctx.textAlign = 'left';
    ctx.fillText(label, 28, baseline);
    const labelWidth = ctx.measureText(label).width;
    ctx.font = `600 12px ${FONT_MONO}`;
    ctx.fillStyle = '#2b241d';
    ctx.textAlign = 'right';
    ctx.fillText(value, 452, baseline);
    const valueWidth = ctx.measureText(value).width;
    const from = 28 + labelWidth + 8;
    const to = 452 - valueWidth - 8;
    if (to > from) {
      ctx.save();
      ctx.strokeStyle = 'rgba(107, 92, 68, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(from, baseline - 3);
      ctx.lineTo(to, baseline - 3);
      ctx.stroke();
      ctx.restore();
    }
    baseline += 22;
  }

  // 名次：小票上唯一的排名口径，来自视野内今日工时榜
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7a684c';
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillText(
    data.rank ? `同屏劳模榜 · 今日第 ${data.rank} 名（视野内）` : '同屏劳模榜 · 未上榜',
    28,
    536,
  );

  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 624);
  ctx.lineTo(452, 624);
  ctx.stroke();

  drawStamp(ctx, data.stamp, 382, 662, '#c0392b');
  drawPromoBand(ctx, data.isSelf ?? true);
}

export type ShareCardVariant = 'badge' | 'timesheet';

/**
 * 渲染整张工卡。返回离屏 canvas，调用方负责 toBlob / toDataURL。
 * 失败只可能是「连 2d context 都拿不到」，素材问题都会逐层降级。
 */
export async function renderShareCard(
  data: ShareCardData,
  variant: ShareCardVariant = 'badge',
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_CARD_WIDTH * SHARE_CARD_SCALE;
  canvas.height = SHARE_CARD_HEIGHT * SHARE_CARD_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');

  ctx.scale(SHARE_CARD_SCALE, SHARE_CARD_SCALE);
  ctx.imageSmoothingEnabled = false;
  await waitForFonts();

  if (variant === 'timesheet') {
    drawTimesheet(ctx, data);
    return canvas;
  }

  drawPaper(ctx, data.name);
  drawHeader(ctx, data.isSelf ?? true);
  drawPortraitPanel(ctx, data.name);

  let characterDrawn = false;
  try {
    characterDrawn = await drawCharacter(ctx, data.appearance, 240, 370);
  } catch {
    characterDrawn = false;
  }
  if (!characterDrawn) drawFallbackCharacter(ctx, data.species, 240, 366);

  drawIdentity(ctx, data);

  drawDetails(ctx, [
    { label: '出勤地点', value: data.location },
    { label: '今日工时', value: data.todayDuration },
    {
      label: '今日如厕',
      value:
        data.hasCareer === false
          ? '未上报'
          : `${Math.max(0, Math.floor(data.todayToiletMinutes ?? 0))} 分钟`,
    },
    {
      label: '今日排名',
      value:
        data.hasCareer === false
          ? '未上报'
          : data.rank
            ? `第 ${data.rank} 名`
            : '未上榜',
    },
  ]);

  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 624);
  ctx.lineTo(452, 624);
  ctx.stroke();

  drawStamp(ctx, data.stamp, 382, 662, '#c0392b');
  drawPromoBand(ctx, data.isSelf ?? true);

  return canvas;
}

// ---------------------------------------------------------------------------
// 分享通路：优先剪贴板，任何一步失败都退回下载
// ---------------------------------------------------------------------------

export function shareCardFileName(name: string): string {
  const safe = Array.from(name)
    .filter((char) => !/[\\/:*?"<>|\s]/.test(char))
    .join('')
    .slice(0, 20);
  return `牛马工牌-${safe || '匿名'}.png`;
}

export function canCopyImageToClipboard(): boolean {
  return (
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas toBlob failed'));
    }, 'image/png');
  });
}

export function downloadShareCard(canvas: HTMLCanvasElement, name: string): void {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = shareCardFileName(name);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export type ShareResult = 'clipboard' | 'download';

/**
 * 一键分享：在点击调用栈里同步创建 ClipboardItem 的 blob Promise，
 * Safari 才不会把「用户手势」判丢；剪贴板不可用或被拒时自动落盘。
 */
export async function shareOrDownload(
  canvasPromise: Promise<HTMLCanvasElement>,
  name: string,
): Promise<ShareResult> {
  if (canCopyImageToClipboard()) {
    try {
      const blobPromise = canvasPromise.then(canvasToBlob);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blobPromise }),
      ]);
      return 'clipboard';
    } catch {
      // 权限被拒 / 非安全上下文 / 浏览器不认 Promise<Blob>：走下载
    }
  }

  const canvas = await canvasPromise;
  downloadShareCard(canvas, name);
  return 'download';
}
