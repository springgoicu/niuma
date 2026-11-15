'use client';

import { Graphics, Rectangle, type Application, type Container, type Texture } from 'pixi.js';
import { WINTER_COLORS as W } from './terrain-palette';
import { bake } from './terrain-textures';
import { VENUE_COLORS, VENUE_SHADOW, darken, lighten } from './venue-palette';
import {
  STREET_DECOR_SIZE,
  STREET_GRATE_SIZE,
  STREET_STEP_SIZE,
  streetDecorPlan,
  type StreetDecorKind,
  type StreetDecorPlan,
} from './street-decor';

/**
 * 过渡带装饰的画法：1:1 整数纹素，构造期一次烘焙。
 *
 * 与 `props.ts` 的关系：道具管线只认 `PropKind`（`packages/shared-types` 的契约），
 * 而这里有意的**不动 `PropKind`**——灌木、邮筒、消防栓都是纯装饰，
 * 一旦进了契约就得双端同步发版，还得给服务端解释「为什么凭空多了一个 kind」。
 * 因此纹理与缓存都留在客户端，宿主（`PropsView`）只负责「按脚底 y 进层 + 登记裁剪」。
 */

type TextureFactory = Application['renderer'];

/** 灌木：三团草球的剪影，暗边取本体色相同色相压暗，不用纯黑 */
function drawShrub(g: Graphics, variant: 0 | 1, tall: boolean, winter: boolean): void {
  const w = tall ? STREET_DECOR_SIZE.shrubTall.w : STREET_DECOR_SIZE.shrub.w;
  const h = tall ? STREET_DECOR_SIZE.shrubTall.h : STREET_DECOR_SIZE.shrub.h;
  const body = winter ? 0x4f7a63 : variant === 0 ? VENUE_COLORS.villas.accent : 0x7fbf6a;
  const shade = winter ? 0x35543f : darken(body, 0.62);
  const light = winter ? 0x82a894 : lighten(body, 0.3);
  const cx = Math.round(w / 2);
  const base = h - 2;
  // 落地影：一眼看出是「长在地上」而不是浮着
  g.ellipse(cx, base, Math.round(w * 0.42), 2).fill({ color: VENUE_SHADOW, alpha: 0.28 });
  // 主体：三团高低错落的草球，中间最高，左右各矮一档
  const lobes = tall ? [-5, 0, 5] : [-6, 0, 6];
  for (let i = 0; i < lobes.length; i += 1) {
    const dx = lobes[i]!;
    const rise = i === 1 ? 0 : 3;
    const r = tall ? (i === 1 ? 6 : 5) : i === 1 ? 5 : 4;
    g.circle(cx + dx, base - r - rise, r + 1).fill(shade);
    g.circle(cx + dx, base - r - rise, r).fill(body);
    g.circle(cx + dx - 1, base - r - rise - 1, Math.max(1, r - 3)).fill(light);
  }
  // 冬季：草球顶压一层薄雪，与地面雪同一色阶（WINTER_COLORS，不再各写一份 0xf2f7ff）
  if (winter) {
    g.ellipse(cx, base - h + 6, Math.round(w * 0.34), 2).fill(W.snowBase);
    g.ellipse(cx - 4, base - h + 8, 4, 2).fill(W.snowLight);
  }
}

/** 邮筒：铸铁柱箱 + 投信口 + 黄铜铭牌，桶身比角色矮一头 */
function drawPostbox(g: Graphics, variant: 0 | 1, winter: boolean): void {
  const { w, h } = STREET_DECOR_SIZE.postbox;
  const cx = Math.round(w / 2);
  const body = variant === 0 ? 0x3f7a63 : 0x4a6f8f;
  const bodyLight = variant === 0 ? 0x5c9d82 : 0x6d90ad;
  const bodyDark = variant === 0 ? 0x2b5747 : 0x334d63;
  g.ellipse(cx, h - 1, 6, 2).fill({ color: VENUE_SHADOW, alpha: 0.3 });
  // 柱脚
  g.rect(cx - 3, h - 5, 6, 4).fill(bodyDark);
  // 桶身：一圈描边 + 左侧受光
  g.rect(cx - 6, 8, 12, h - 12).fill(bodyDark);
  g.rect(cx - 5, 9, 10, h - 14).fill(body);
  g.rect(cx - 5, 9, 2, h - 14).fill(bodyLight);
  // 投信口 + 黄铜铭牌
  g.rect(cx - 4, 12, 8, 2).fill(bodyDark);
  g.rect(cx - 4, 18, 8, 4).fill(0xd8a33f);
  g.rect(cx - 4, 18, 8, 1).fill(0xf2c879);
  // 圆顶：一格一格收上去，读起来是铸铁盖而不是方盒
  g.rect(cx - 7, 6, 14, 3).fill(bodyDark);
  g.rect(cx - 6, 4, 12, 2).fill(body);
  g.rect(cx - 4, 2, 8, 2).fill(bodyLight);
  // 冬季：盖子与顶帽积一层雪
  if (winter) {
    g.rect(cx - 6, 2, 12, 2).fill(W.snowBase);
    g.rect(cx - 7, 6, 14, 1).fill(W.snowLight);
  }
}

/** 消防栓：朱红栓体 + 两侧出水口 + 奶白顶帽，是园区里唯一的红点 */
function drawHydrant(g: Graphics, variant: 0 | 1, winter: boolean): void {
  const { w, h } = STREET_DECOR_SIZE.hydrant;
  const cx = Math.round(w / 2);
  const body = variant === 0 ? 0xc9503f : 0xb8463a;
  const bodyLight = variant === 0 ? 0xe8775f : 0xd4604f;
  const bodyDark = variant === 0 ? 0x8f3327 : 0x7e2c22;
  g.ellipse(cx, h - 1, 5, 2).fill({ color: VENUE_SHADOW, alpha: 0.28 });
  // 底座 + 栓体
  g.rect(cx - 4, h - 4, 8, 3).fill(bodyDark);
  g.rect(cx - 3, 8, 6, h - 11).fill(body);
  g.rect(cx - 3, 8, 2, h - 11).fill(bodyLight);
  // 两侧出水口
  g.rect(cx - 6, 12, 3, 2).fill(bodyDark);
  g.rect(cx + 3, 12, 3, 2).fill(bodyDark);
  // 顶帽
  g.rect(cx - 4, 6, 8, 2).fill(bodyDark);
  g.rect(cx - 3, 4, 6, 2).fill(0xf4efe2);
  if (winter) g.rect(cx - 3, 4, 6, 1).fill(W.snowBase);
}

/** 备用垃圾桶：与广场那款同一套薄荷配色，只在腰部多一道箍 */
function drawBin(g: Graphics, variant: 0 | 1, winter: boolean): void {
  const { w, h } = STREET_DECOR_SIZE.bin;
  const cx = Math.round(w / 2);
  g.ellipse(cx, h - 1, 5, 2).fill({ color: VENUE_SHADOW, alpha: 0.26 });
  // 桶身：外圈压暗、内圈本体、左侧受光
  g.rect(cx - 5, 5, 10, h - 7).fill(0x4fb591);
  g.rect(cx - 4, 6, 8, h - 9).fill(0x7dd6b0);
  g.rect(cx - 4, 6, 2, h - 9).fill(0xa9e8cd);
  // 盖沿 + 箍
  g.rect(cx - 6, 3, 12, 3).fill(0x3f9e7c);
  g.rect(cx - 5, 12, 10, 1).fill(0x4fb591);
  // 分类贴纸：variant 换成一张奶油色小标签
  if (variant === 1) g.rect(cx - 3, 15, 6, 3).fill(0xfff6e0);
  if (winter) g.rect(cx - 6, 3, 12, 1).fill(W.snowBase);
}

function drawDecorSprite(
  renderer: TextureFactory,
  kind: StreetDecorKind,
  variant: 0 | 1,
  winter: boolean,
): Texture {
  const size = STREET_DECOR_SIZE[kind];
  return bake(
    renderer,
    (g) => {
      if (kind === 'shrub' || kind === 'shrubTall') drawShrub(g, variant, kind === 'shrubTall', winter);
      else if (kind === 'postbox') drawPostbox(g, variant, winter);
      else if (kind === 'hydrant') drawHydrant(g, variant, winter);
      else drawBin(g, variant, winter);
    },
    { frame: new Rectangle(0, 0, size.w, size.h) },
  );
}

/** 地面件画进 `props.base`：永远在角色脚下，一次绘制、无逐帧成本 */
function paintGround(g: Graphics, plan: StreetDecorPlan, winter: boolean): void {
  // 夏季是暖石，冬季换成带蓝相的雪石：同一块石头在雪地里不能还是暖砖色
  const stone = winter ? 0xd8e2ec : 0xb5ad9c;
  const stoneLight = winter ? 0xeef4fa : 0xd8d1c0;
  const stoneDark = winter ? 0xb9c6d4 : 0x8f8877;
  const iron = 0x4a4f58;
  const ironLight = 0x6f7680;

  for (const bit of plan.ground) {
    if (bit.kind === 'grate') {
      // 排水篦子：一块铸铁方框 + 四道格栅，压在路缘上
      g.rect(bit.x - STREET_GRATE_SIZE.w / 2, bit.y - STREET_GRATE_SIZE.h + 2, STREET_GRATE_SIZE.w, STREET_GRATE_SIZE.h).fill(iron);
      for (let i = 0; i < 4; i += 1) {
        g.rect(bit.x - STREET_GRATE_SIZE.w / 2 + 2 + i * 4, bit.y - STREET_GRATE_SIZE.h + 3, 2, STREET_GRATE_SIZE.h - 2).fill(
          ironLight,
        );
      }
      continue;
    }
    if (bit.kind === 'stone') {
      // 花园石板小径：比路肩碎石更平整的石板，同色阶两档明度，缝里偶见苔绿
      g.roundRect(bit.x - STREET_STEP_SIZE.w / 2, bit.y - STREET_STEP_SIZE.h, STREET_STEP_SIZE.w, STREET_STEP_SIZE.h, 2).fill(
        stoneDark,
      );
      g.roundRect(
        bit.x - STREET_STEP_SIZE.w / 2 + 1,
        bit.y - STREET_STEP_SIZE.h + 1,
        STREET_STEP_SIZE.w - 2,
        STREET_STEP_SIZE.h - 2,
        1,
      ).fill(stone);
      g.rect(bit.x - 3, bit.y - STREET_STEP_SIZE.h + 1, 4, 1).fill(stoneLight);
      if (bit.variant === 1) g.rect(bit.x + 2, bit.y - 3, 2, 2).fill(0x7fbf8f);
      continue;
    }
    // 路肩碎石：一块圆角石板 + 顶边受光，variant 1 多带一块小石子
    const cx = bit.x;
    const cy = bit.y;
    g.roundRect(cx - STREET_STEP_SIZE.w / 2, cy - STREET_STEP_SIZE.h, STREET_STEP_SIZE.w, STREET_STEP_SIZE.h, 2).fill(
      stoneDark,
    );
    g.roundRect(
      cx - STREET_STEP_SIZE.w / 2 + 1,
      cy - STREET_STEP_SIZE.h + 1,
      STREET_STEP_SIZE.w - 2,
      STREET_STEP_SIZE.h - 2,
      1,
    ).fill(stone);
    g.rect(cx - 3, cy - STREET_STEP_SIZE.h + 1, 3, 1).fill(stoneLight);
    if (bit.variant === 1) {
      g.roundRect(cx + 4, cy - 4, 5, 4, 1).fill(stone);
      g.rect(cx + 4, cy - 1, 5, 1).fill(stoneDark);
    }
  }
}

export interface StreetDecorHooks {
  /** 地面层容器（`PropsView.base`） */
  readonly base: Container;
  /** 立式小物：由宿主负责 `depth.add(脚底 y)` 与裁剪登记 */
  addSprite(texture: Texture, x: number, y: number, padX: number, padY: number): void;
  /** 纹理交给宿主统一销毁 */
  keepTexture(texture: Texture): void;
}

/**
 * 把装饰计划落成图形。构造期调用一次；
 * `?decor=0` 时宿主直接跳过本函数（与 `?venue=0` 同一套灰度惯例）。
 */
export function buildStreetDecor(hooks: StreetDecorHooks, renderer: TextureFactory, winter: boolean): void {
  const plan = streetDecorPlan();

  const ground = new Graphics();
  paintGround(ground, plan, winter);
  hooks.base.addChild(ground);

  // 纹理按 kind:variant 复用：同一种灌木全图只烘一张。纹理种类固定为 5 种 × 2 档
  const cache = new Map<string, Texture>();
  for (const prop of plan.props) {
    const key = `${prop.kind}:${prop.variant}`;
    let texture = cache.get(key);
    if (!texture) {
      texture = drawDecorSprite(renderer, prop.kind, prop.variant, winter);
      cache.set(key, texture);
      hooks.keepTexture(texture);
    }
    const size = STREET_DECOR_SIZE[prop.kind];
    hooks.addSprite(texture, prop.x, prop.y, size.w / 2 + 2, size.h + 2);
  }
}
