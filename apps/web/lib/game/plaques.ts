'use client';

import { Container, Graphics, Text } from 'pixi.js';
import { DOOR_PLAQUES, type DoorPlaque } from '@niuma/shared-types';
import { TOWN_MATERIALS, VENUE_OUTLINE } from './venue-palette';
import type { DepthSink } from './sort-layer';

/**
 * 场所门牌（ADR-0091 / ADR-0096）。
 *
 * 一个绕不开的既有事实：仓库的墙体是**平铺 10px 色带**（`props.ts` 的 `fillSolidFlat`），
 * 完全没有立面，所以门牌得自带骨架：奶油横板 + 木柱 + 石座的小门牌，
 * 以「底边中心锚在门线上」的方式参与 y 排序，和树、桌椅、角色共用一套遮挡。
 *
 * 中文只能用 Pixi `Text`：仓库没有位图 CJK 字库（`interior-art.ts` 的 `glyph()`
 * 只够画 3×5 拉丁与符号）。所以这里沿用 `bulletin.ts` 的纪律：
 * 构造期把 Text 建好，帧循环只写坐标；DPR 变化走 `setTextResolution`。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = TOWN_MATERIALS;

/** 小门牌几何（相对脚底中心，向上为负）：横板 + 左右短柱 + 石座，总高 32 */
const SIGN_BOARD_W = 56;
const SIGN_BOARD_H = 18;
const SIGN_BOARD_TOP = -32;
const SIGN_POST_W = 4;
const SIGN_POST_TOP = -13;
const SIGN_POST_HALF = 26;
const SIGN_FONT = 8;

/**
 * 小门牌：左右短柱 + 奶油横板 + 石座，总高 32。
 *
 * 各处入口都没有门框，牌子必须矮到不挡视线、不抢建筑，
 * 木柱与奶油牌面是场所入口唯一的标识骨架。
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
