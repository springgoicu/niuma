'use client';

import { Container, Graphics, Text } from 'pixi.js';
import { DOOR_PLAQUES, type DoorPlaque } from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';

/**
 * 场所门牌（ADR-0061 / ADR-0091）。
 *
 * 一个绕不开的既有事实：仓库的墙体是**平铺 10px 色带**（`props.ts` 的 `fillSolidFlat`），
 * 完全没有立面，所以牌匾得自带骨架：`gate` 是两柱 + 横枋 + 匾额的大牌坊（四角房），
 * `board` 是横匾 + 短柱 + 石座的小门牌（其余 7 处入口）。两者都以「底边中心锚在门线上」
 * 的方式参与 y 排序，和树、桌椅、角色共用一套遮挡。
 *
 * 中文只能用 Pixi `Text`：仓库没有位图 CJK 字库（`interior-art.ts` 的 `glyph()`
 * 只够画 3×5 拉丁与符号）。所以这里沿用 `bulletin.ts` 的纪律：
 * 构造期把 Text 建好，帧循环只写坐标；DPR 变化走 `setTextResolution`。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: 0x2a3142,
  // 牌坊：深胡桃木柱与横枋
  post: 0x6b4a33,
  postLight: 0x8a6446,
  postDark: 0x442d1e,
  beam: 0x7a5236,
  beamLight: 0xa07a54,
  // 匾额
  lacquer: 0x1b1a17,
  lacquerEdge: 0xc9a14a,
  gold: 0xffd166,
  wood: 0xc08a55,
  woodLight: 0xd9a76f,
  woodDark: 0x8a6038,
  ink: 0x2b2118,
  // 对联
  paper: 0xc23a2a,
  paperLight: 0xe0603f,
} as const;

/** 牌坊几何（相对门线中心，向上为负） */
const POST_HALF = 59;
const POST_W = 14;
const POST_TOP = -60;
const BEAM_HALF = 74;
const BEAM_TOP = -78;
const BOARD_W = 64;
const BOARD_H = 20;
const COUPLET_H = 42;

const PLAQUE_FONT = 7;
const COUPLET_FONT = 6;

/** 小门牌几何（相对脚底中心，向上为负）：横匾 + 左右短柱 + 石座，总高 32 */
const SIGN_BOARD_W = 56;
const SIGN_BOARD_H = 18;
const SIGN_BOARD_TOP = -32;
const SIGN_POST_W = 4;
const SIGN_POST_TOP = -13;
const SIGN_POST_HALF = 26;
const SIGN_FONT = 8;

/** 一块匾额：底板 + 边框 + 一行中文 */
function drawPlaqueBoard(g: Graphics, inkGold: boolean): void {
  const top = BEAM_TOP - BOARD_H;
  if (inkGold) {
    // 黑漆底 + 金边（工作区）
    g.rect(-BOARD_W / 2 - 2, top - 2, BOARD_W + 4, BOARD_H + 4).fill(C.outline);
    g.rect(-BOARD_W / 2, top, BOARD_W, BOARD_H).fill(C.lacquer);
    g.rect(-BOARD_W / 2, top, BOARD_W, 1).fill(C.lacquerEdge);
    g.rect(-BOARD_W / 2, top + BOARD_H - 1, BOARD_W, 1).fill(C.lacquerEdge);
    return;
  }
  // 木牌底（会议室 / 宿舍区）
  g.rect(-BOARD_W / 2 - 2, top - 2, BOARD_W + 4, BOARD_H + 4).fill(C.woodDark);
  g.rect(-BOARD_W / 2, top, BOARD_W, BOARD_H).fill(C.wood);
  g.rect(-BOARD_W / 2, top + 1, BOARD_W, 2).fill(C.woodLight);
  g.rect(-BOARD_W / 2, top + BOARD_H - 2, BOARD_W, 1).fill(C.woodDark);
}

/** 牌坊本体：两柱 + 柱础 + 横枋 + 匾托 */
function drawGate(g: Graphics): void {
  for (const cx of [-POST_HALF, POST_HALF]) {
    g.rect(cx - POST_W / 2, POST_TOP, POST_W, -POST_TOP).fill(C.postDark);
    g.rect(cx - POST_W / 2 + 1, POST_TOP, POST_W - 4, -POST_TOP).fill(C.post);
    g.rect(cx - POST_W / 2 + 2, POST_TOP, 2, -POST_TOP).fill(C.postLight);
    // 柱础
    g.rect(cx - POST_W / 2 - 2, -6, POST_W + 4, 6).fill(C.postDark);
    g.rect(cx - POST_W / 2 - 2, -6, POST_W + 4, 1).fill(C.postLight);
  }
  // 横枋：压在两根柱子的顶端
  g.rect(-BEAM_HALF, BEAM_TOP, BEAM_HALF * 2, -BEAM_TOP + POST_TOP).fill(C.postDark);
  g.rect(-BEAM_HALF + 1, BEAM_TOP + 1, BEAM_HALF * 2 - 2, -BEAM_TOP + POST_TOP - 3).fill(C.beam);
  g.rect(-BEAM_HALF + 1, BEAM_TOP + 1, BEAM_HALF * 2 - 2, 1).fill(C.beamLight);
  // 枋上两枚铜钉
  for (const x of [-BEAM_HALF + 6, BEAM_HALF - 8]) {
    g.rect(x, BEAM_TOP + 5, 2, 2).fill(C.lacquerEdge);
  }
}

/** 一对竖排对联：红纸 + 金边，字由 `Text` 竖排写上去 */
function drawCoupletPaper(g: Graphics, cx: number): void {
  g.rect(cx - 7, POST_TOP + 8, 14, COUPLET_H).fill(C.outline);
  g.rect(cx - 6, POST_TOP + 9, 12, COUPLET_H - 2).fill(C.paper);
  g.rect(cx - 6, POST_TOP + 9, 12, 1).fill(C.paperLight);
  g.rect(cx - 6, POST_TOP + COUPLET_H + 6, 12, 1).fill(C.paperLight);
}

/**
 * 小门牌：左右短柱 + 深漆横匾 + 石座，总高 32。
 *
 * 7 处地面设施没有门框，牌子必须矮到不挡视线、不抢建筑，
 * 但金边与朱漆柱式仍与牌坊同源。
 */
function drawBoardSign(g: Graphics): void {
  // 短柱：从地面长到匾额下沿，柱脚由石座压住
  for (const cx of [-SIGN_POST_HALF, SIGN_POST_HALF]) {
    g.rect(cx - SIGN_POST_W / 2, SIGN_POST_TOP, SIGN_POST_W, -SIGN_POST_TOP).fill(C.postDark);
    g.rect(cx - SIGN_POST_W / 2 + 1, SIGN_POST_TOP, SIGN_POST_W - 2, -SIGN_POST_TOP - 2).fill(C.post);
    g.rect(cx - SIGN_POST_W / 2 + 1, SIGN_POST_TOP, 1, -SIGN_POST_TOP - 2).fill(C.postLight);
  }
  // 匾额：外描边 + 深漆底 + 上下金边
  g.rect(-SIGN_BOARD_W / 2 - 2, SIGN_BOARD_TOP - 2, SIGN_BOARD_W + 4, SIGN_BOARD_H + 4).fill(C.outline);
  g.rect(-SIGN_BOARD_W / 2, SIGN_BOARD_TOP, SIGN_BOARD_W, SIGN_BOARD_H).fill(C.lacquer);
  g.rect(-SIGN_BOARD_W / 2, SIGN_BOARD_TOP, SIGN_BOARD_W, 1).fill(C.lacquerEdge);
  g.rect(-SIGN_BOARD_W / 2, SIGN_BOARD_TOP + SIGN_BOARD_H - 1, SIGN_BOARD_W, 1).fill(C.lacquerEdge);
  // 石座压住柱脚
  g.rect(-SIGN_BOARD_W / 2 - 2, -3, SIGN_BOARD_W + 4, 3).fill(C.outline);
  g.rect(-SIGN_BOARD_W / 2, -3, SIGN_BOARD_W, 2).fill(C.woodDark);
}

/** 大牌坊沿用竖匾的松字距排版：三字名拆成「工 作 区」 */
function spacedLabel(text: string): string {
  return text.split('').join(' ');
}

export class PlaqueView {
  private readonly roots: Container[] = [];
  private readonly texts: Text[] = [];
  private readonly specs: ReadonlyArray<DoorPlaque> = DOOR_PLAQUES;
  private devicePxPerTexel: number;

  constructor(devicePxPerTexel: number) {
    this.devicePxPerTexel = devicePxPerTexel;
    for (const spec of this.specs) {
      const root = new Container();
      root.position.set(spec.x, spec.depthY);

      const g = new Graphics();
      if (spec.frame === 'gate') {
        drawGate(g);
        drawPlaqueBoard(g, spec.inkGold);
        if (spec.couplets) {
          drawCoupletPaper(g, -POST_HALF);
          drawCoupletPaper(g, POST_HALF);
        }
        root.addChild(g);

        this.addText(root, {
          text: spacedLabel(spec.text),
          fontSize: PLAQUE_FONT,
          fill: spec.inkGold ? C.gold : C.ink,
          letterSpacing: 1,
          x: 0,
          y: BEAM_TOP - BOARD_H / 2,
        });

        if (spec.couplets) {
          this.addVerticalText(root, spec.couplets[0], -POST_HALF, spec.inkGold);
          this.addVerticalText(root, spec.couplets[1], POST_HALF, spec.inkGold);
        }
      } else {
        drawBoardSign(g);
        root.addChild(g);

        // 小门牌统一深漆金字：5 字名按 8px + 0.5 字距排，56 宽的匾面刚好留出呼吸
        this.addText(root, {
          text: spec.text,
          fontSize: SIGN_FONT,
          fill: C.gold,
          letterSpacing: 0.5,
          x: 0,
          y: SIGN_BOARD_TOP + SIGN_BOARD_H / 2,
        });
      }

      this.roots.push(root);
    }
  }

  build(depth: DepthSink): void {
    this.specs.forEach((spec, index) => {
      const root = this.roots[index];
      if (root) depth.add(spec.depthY, root);
    });
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const text of this.texts) {
      if (text.resolution !== devicePxPerTexel) text.resolution = devicePxPerTexel;
    }
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    this.roots.length = 0;
    this.texts.length = 0;
  }

  private addText(
    root: Container,
    options: { text: string; fontSize: number; fill: number; letterSpacing: number; x: number; y: number },
  ): Text {
    const text = new Text({
      text: options.text,
      resolution: this.devicePxPerTexel,
      style: {
        fontFamily: CJK_FONT,
        fontSize: options.fontSize,
        fontWeight: '600',
        fill: options.fill,
        letterSpacing: options.letterSpacing,
        align: 'center',
      },
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(options.x, options.y);
    root.addChild(text);
    this.texts.push(text);
    return text;
  }

  /** 竖排：把「有 事 烧 香」拆成一字一行，靠 `lineHeight` 压成竖联 */
  private addVerticalText(root: Container, label: string, cx: number, inkGold: boolean): void {
    const chars = label.replace(/\s+/g, '').split('');
    const text = new Text({
      text: chars.join('\n'),
      resolution: this.devicePxPerTexel,
      style: {
        fontFamily: CJK_FONT,
        fontSize: COUPLET_FONT,
        fontWeight: '600',
        fill: inkGold ? C.gold : C.paperLight,
        align: 'center',
        lineHeight: Math.round(COUPLET_H / Math.max(1, chars.length)),
      },
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(cx, POST_TOP + 8 + COUPLET_H / 2);
    root.addChild(text);
    this.texts.push(text);
  }
}
