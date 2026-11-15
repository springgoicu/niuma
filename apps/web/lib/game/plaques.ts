'use client';

import { Container, Graphics, Text } from 'pixi.js';
import { DOOR_PLAQUES, type DoorPlaque } from '@niuma/shared-types';
import { TOWN_MATERIALS, VENUE_OUTLINE } from './venue-palette';
import type { DepthSink } from './sort-layer';

/**
 * 场所门牌（ADR-0091 / ADR-0096）。
 *
 * 一个绕不开的既有事实：仓库的墙体是**平铺 10px 色带**（`props.ts` 的 `fillSolidFlat`），
 * 完全没有立面，所以门牌得自带骨架：`gate` 是两根方木柱 + 白漆横梁 + 奶油匾额的大门架（四角房），
 * `board` 是奶油横板 + 木柱 + 石座的小门牌（其余 7 处入口）。两者都以「底边中心锚在门线上」
 * 的方式参与 y 排序，和树、桌椅、角色共用一套遮挡。
 *
 * 中文只能用 Pixi `Text`：仓库没有位图 CJK 字库（`interior-art.ts` 的 `glyph()`
 * 只够画 3×5 拉丁与符号）。所以这里沿用 `bulletin.ts` 的纪律：
 * 构造期把 Text 建好，帧循环只写坐标；DPR 变化走 `setTextResolution`。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = TOWN_MATERIALS;

/** 门架几何（相对门线中心，向上为负） */
const POST_HALF = 59;
const POST_W = 14;
const POST_TOP = -60;
const BEAM_HALF = 74;
const BEAM_TOP = -78;
const BOARD_W = 64;
const BOARD_H = 20;

const PLAQUE_FONT = 7;

/** 小门牌几何（相对脚底中心，向上为负）：横板 + 左右短柱 + 石座，总高 32 */
const SIGN_BOARD_W = 56;
const SIGN_BOARD_H = 18;
const SIGN_BOARD_TOP = -32;
const SIGN_POST_W = 4;
const SIGN_POST_TOP = -13;
const SIGN_POST_HALF = 26;
const SIGN_FONT = 8;

/** 一块匾额：奶油底板 + 木边框 + 两颗铜钉，字由 `Text` 写上去 */
function drawPlaqueBoard(g: Graphics): void {
  const top = BEAM_TOP - BOARD_H;
  g.rect(-BOARD_W / 2 - 2, top - 2, BOARD_W + 4, BOARD_H + 4).fill(VENUE_OUTLINE);
  g.rect(-BOARD_W / 2, top, BOARD_W, BOARD_H).fill(C.boardEdge);
  g.rect(-BOARD_W / 2 + 2, top + 2, BOARD_W - 4, BOARD_H - 4).fill(C.board);
  for (const x of [-BOARD_W / 2 + 4, BOARD_W / 2 - 6]) g.rect(x, top + 4, 2, 2).fill(C.brass);
}

/** 门架本体：方木柱 + 白漆柱箍 + 石柱础 + 白漆横梁 */
function drawGate(g: Graphics): void {
  for (const cx of [-POST_HALF, POST_HALF]) {
    g.rect(cx - POST_W / 2, POST_TOP, POST_W, -POST_TOP).fill(C.timberDark);
    g.rect(cx - POST_W / 2 + 1, POST_TOP, POST_W - 2, -POST_TOP - 1).fill(C.timber);
    g.rect(cx - POST_W / 2 + 2, POST_TOP, 2, -POST_TOP - 2).fill(C.timberLight);
    // 石柱础
    g.rect(cx - POST_W / 2 - 2, -6, POST_W + 4, 6).fill(C.stoneDark);
    g.rect(cx - POST_W / 2 - 1, -6, POST_W + 2, 5).fill(C.stone);
    g.rect(cx - POST_W / 2 - 1, -6, POST_W + 2, 1).fill(C.stoneLight);
  }
  // 白漆横梁：压在两根柱子的顶端
  g.rect(-BEAM_HALF, BEAM_TOP, BEAM_HALF * 2, -BEAM_TOP + POST_TOP).fill(VENUE_OUTLINE);
  g.rect(-BEAM_HALF + 1, BEAM_TOP + 1, BEAM_HALF * 2 - 2, -BEAM_TOP + POST_TOP - 2).fill(C.paint);
  g.rect(-BEAM_HALF + 1, BEAM_TOP + 1, BEAM_HALF * 2 - 2, 1).fill(C.paintShade);
  // 梁上两枚铜钉
  for (const x of [-BEAM_HALF + 6, BEAM_HALF - 8]) g.rect(x, BEAM_TOP + 5, 2, 2).fill(C.brass);
  // 柱箍：横梁下沿一圈白漆，读出「柱子插进梁里」
  for (const cx of [-POST_HALF, POST_HALF]) {
    g.rect(cx - POST_W / 2, POST_TOP, POST_W, 4).fill(C.paint);
    g.rect(cx - POST_W / 2, POST_TOP + 3, POST_W, 1).fill(C.paintShade);
  }
}

/**
 * 小门牌：左右短柱 + 奶油横板 + 石座，总高 32。
 *
 * 7 处地面设施没有门框，牌子必须矮到不挡视线、不抢建筑，
 * 但木柱与奶油牌面仍与大门架同源。
 */
function drawBoardSign(g: Graphics): void {
  // 短柱：从地面长到匾额下沿，柱脚由石座压住
  for (const cx of [-SIGN_POST_HALF, SIGN_POST_HALF]) {
    g.rect(cx - SIGN_POST_W / 2, SIGN_POST_TOP, SIGN_POST_W, -SIGN_POST_TOP).fill(C.timberDark);
    g.rect(cx - SIGN_POST_W / 2 + 1, SIGN_POST_TOP, SIGN_POST_W - 2, -SIGN_POST_TOP - 2).fill(C.timber);
    g.rect(cx - SIGN_POST_W / 2 + 1, SIGN_POST_TOP, 1, -SIGN_POST_TOP - 2).fill(C.timberLight);
  }
  // 横板：外描边 + 木边 + 奶油牌面
  g.rect(-SIGN_BOARD_W / 2 - 2, SIGN_BOARD_TOP - 2, SIGN_BOARD_W + 4, SIGN_BOARD_H + 4).fill(VENUE_OUTLINE);
  g.rect(-SIGN_BOARD_W / 2 - 1, SIGN_BOARD_TOP - 1, SIGN_BOARD_W + 2, SIGN_BOARD_H + 2).fill(C.boardEdge);
  g.rect(-SIGN_BOARD_W / 2, SIGN_BOARD_TOP, SIGN_BOARD_W, SIGN_BOARD_H).fill(C.board);
  g.rect(-SIGN_BOARD_W / 2, SIGN_BOARD_TOP, SIGN_BOARD_W, 1).fill(C.paint);
  // 石座压住柱脚
  g.rect(-SIGN_BOARD_W / 2 - 2, -3, SIGN_BOARD_W + 4, 3).fill(VENUE_OUTLINE);
  g.rect(-SIGN_BOARD_W / 2, -3, SIGN_BOARD_W, 2).fill(C.stone);
}

/** 大门架沿用竖匾的松字距排版：三字名拆成「工 作 区」 */
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
        drawPlaqueBoard(g);
        root.addChild(g);

        this.addText(root, {
          text: spacedLabel(spec.text),
          fontSize: PLAQUE_FONT,
          fill: C.boardInk,
          letterSpacing: 1,
          x: 0,
          y: BEAM_TOP - BOARD_H / 2,
        });
      } else {
        drawBoardSign(g);
        root.addChild(g);

        // 小门牌统一墨绿字：5 字名按 8px + 0.5 字距排，56 宽的板面刚好留出呼吸
        this.addText(root, {
          text: spec.text,
          fontSize: SIGN_FONT,
          fill: C.boardInk,
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
}
