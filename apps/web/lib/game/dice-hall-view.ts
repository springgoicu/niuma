'use client';

import { Container, Graphics, Text } from 'pixi.js';
import {
  DICE_HALL,
  DICE_HALL_BAR,
  DICE_HALL_CENTER,
  DICE_HALL_COLUMNS,
  DICE_PHASE,
  DICE_TABLES,
  type DiceStatePacket,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';

/**
 * 摸鱼大赌场的美术层（ADR-0087）。
 *
 * 亭台地面走 `WORLD_LAYOUT.paved`（地形层已经铺好），这里只画「站在地上能看见」
 * 的部分：吧台、六根红柱、两张绿绒赌桌、檐下灯串与冬季积雪。
 * 每件都以**底边中心**为锚点进 y 排序层，人走到桌后会被桌子挡住，和树、长椅同一套规则。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: 0x1a1512,
  wood: 0x7a4a2c,
  woodLight: 0xa4703f,
  woodDark: 0x4e2d1a,
  pillar: 0xa8322a,
  pillarLight: 0xd4534a,
  roof: 0x1f5e48,
  roofLight: 0x2f8763,
  gold: 0xf2c879,
  goldDark: 0xb08a3c,
  felt: 0x1f6b4a,
  feltLight: 0x2f8f63,
  feltDark: 0x14462f,
  chipRed: 0xd64545,
  chipBlue: 0x3b7bd4,
  chipWhite: 0xe8f1f2,
  neon: 0x5eead4,
  snow: 0xf2f7ff,
} as const;

export class DiceHallView {
  private readonly roots: Container[] = [];
  private readonly tables: Container[] = [];
  private readonly tableLights: Graphics[] = [];
  private readonly texts: Text[] = [];
  private devicePxPerTexel: number;

  constructor(
    private readonly winter: boolean,
    devicePxPerTexel: number,
  ) {
    this.devicePxPerTexel = devicePxPerTexel;
    this.buildBar();
    this.buildColumns();
    this.buildTables();
    this.buildSign();
  }

  build(depth: DepthSink, base: Container): void {
    // 亭台描边与灯串走地面层：不进排序层，角色永远压在它们上面
    const ground = new Graphics();
    ground
      .rect(DICE_HALL.x, DICE_HALL.y, DICE_HALL.w, DICE_HALL.h)
      .fill({ color: C.woodDark, alpha: 0.12 })
      .rect(DICE_HALL.x + 6, DICE_HALL.y + 6, DICE_HALL.w - 12, DICE_HALL.h - 12)
      .stroke({ color: C.woodLight, width: 2, alpha: 0.35 });
    base.addChild(ground);
    for (const root of this.roots) depth.add(root.y, root);
    for (const table of this.tables) depth.add(table.y, table);
  }

  /** 赌桌公共局状态：亮牌期桌心的三颗骰子按点数点亮 */
  setState(packet: DiceStatePacket): void {
    for (const info of packet.tables) {
      const light = this.tableLights[info.id];
      if (!light) continue;
      light.clear();
      const reveal = info.phase === DICE_PHASE.Reveal || info.phase === DICE_PHASE.Rolling;
      const visible = reveal && info.dice.every((value) => value > 0);
      if (!visible) continue;
      // 三颗骰子横排在桌心：亮牌期用白点表点数，摇骰期只留一颗滚动点
      for (let i = 0; i < 3; i += 1) {
        const pip = info.dice[i] ?? 0;
        const x = -26 + i * 26;
        light.rect(x - 7, -7, 14, 14).fill(C.chipWhite);
        light.rect(x - 7, -7, 14, 14).stroke({ color: C.outline, width: 1 });
        for (let p = 0; p < Math.min(6, pip); p += 1) {
          light.rect(x - 5 + (p % 3) * 4, -5 + Math.floor(p / 3) * 5, 2, 2).fill(C.outline);
        }
      }
      if (info.raid) light.rect(-30, 12, 60, 4).fill(C.chipRed);
    }
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const text of this.texts) text.resolution = devicePxPerTexel;
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    for (const table of this.tables) table.destroy({ children: true });
    this.roots.length = 0;
    this.tables.length = 0;
    this.texts.length = 0;
  }

  private buildBar(): void {
    const root = new Container();
    root.position.set(DICE_HALL_BAR.x + DICE_HALL_BAR.w / 2, DICE_HALL_BAR.y + DICE_HALL_BAR.h);
    const g = new Graphics();
    const w = DICE_HALL_BAR.w;
    const h = DICE_HALL_BAR.h;
    g.rect(-w / 2, -h, w, h).fill(C.woodDark);
    g.rect(-w / 2 + 2, -h + 2, w - 4, h - 6).fill(C.wood);
    g.rect(-w / 2 + 2, -h + 2, w - 4, 3).fill(C.woodLight);
    g.rect(-w / 2, -h, w, 2).fill(C.roof);
    // 台面上排一排筹码
    for (let i = 0; i < 7; i += 1) {
      g.rect(-w / 2 + 14 + i * 34, -h - 4, 10, 4).fill(i % 2 === 0 ? C.chipRed : C.chipBlue);
    }
    if (this.winter) g.rect(-w / 2 + 2, -h + 1, w - 4, 3).fill(C.snow);
    root.addChild(g);
    this.roots.push(root);
  }

  private buildColumns(): void {
    for (const column of DICE_HALL_COLUMNS) {
      const root = new Container();
      root.position.set(column.x, column.y + 8);
      const g = new Graphics();
      g.rect(-7, -58, 14, 58).fill(C.woodDark);
      g.rect(-5, -58, 10, 58).fill(C.pillar);
      g.rect(-5, -58, 3, 58).fill(C.pillarLight);
      g.rect(-9, -62, 18, 6).fill(C.roof);
      g.rect(-9, -62, 18, 2).fill(C.roofLight);
      g.rect(-9, -2, 18, 4).fill(C.woodDark);
      if (this.winter) g.rect(-9, -63, 18, 3).fill(C.snow);
      root.addChild(g);
      this.roots.push(root);
    }
  }

  private buildTables(): void {
    for (const table of DICE_TABLES) {
      const root = new Container();
      root.position.set(table.x, table.y + table.h / 2);
      const g = new Graphics();
      const halfW = table.w / 2;
      const h = table.h;
      // 桌腿与黄铜包边
      g.rect(-halfW, -h, table.w, h).fill(C.woodDark);
      g.rect(-halfW + 2, -h + 2, table.w - 4, h - 4).fill(C.feltDark);
      g.rect(-halfW + 6, -h + 6, table.w - 12, h - 12).fill(C.felt);
      g.rect(-halfW + 8, -h + 8, table.w - 16, 3).fill(C.feltLight);
      g.rect(-halfW + 2, -h + 2, table.w - 4, 2).fill(C.goldDark);
      g.rect(-halfW + 2, -4, table.w - 4, 2).fill(C.goldDark);
      for (let i = 0; i < 4; i += 1) {
        g.rect(-halfW + 10 + i * 22, -h - 3, 12, 3).fill(i % 2 === 0 ? C.chipRed : C.chipWhite);
      }
      if (this.winter) g.rect(-halfW + 2, -h + 2, table.w - 4, 2).fill(C.snow);
      root.addChild(g);
      const light = new Graphics();
      light.position.set(0, -h / 2);
      root.addChild(light);
      this.tableLights[table.id] = light;
      this.tables.push(root);

      // 桌名牌（翡翠桌 / 鎏金桌）：挂在桌面北沿上方，跟着桌子一起进排序层
      const label = new Text({
        text: table.name,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 7, fontWeight: '600', fill: C.gold },
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, -h - 6);
      root.addChild(label);
      this.texts.push(label);
    }
  }

  private buildSign(): void {
    const root = new Container();
    root.position.set(DICE_HALL_CENTER.x, DICE_HALL.y + 6);
    const g = new Graphics();
    // 檐下灯串 + 霓虹招牌
    for (let i = 0; i < 12; i += 1) {
      g.circle(DICE_HALL.x + 24 + i * 32, -96 - (i % 3) * 4, 2.4).fill(C.gold);
    }
    g.rect(-58, -150, 116, 26).fill(C.outline);
    g.rect(-56, -148, 112, 22).fill(C.roof);
    g.rect(-56, -148, 112, 2).fill(C.neon);
    root.addChild(g);
    const label = new Text({
      text: '摸鱼大赌场',
      resolution: this.devicePxPerTexel,
      style: { fontFamily: CJK_FONT, fontSize: 11, fontWeight: '700', fill: C.gold, letterSpacing: 2 },
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(0, -137);
    root.addChild(label);
    this.texts.push(label);
    this.roots.push(root);
  }
}
