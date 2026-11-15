'use client';

import { Container, Graphics, Text } from 'pixi.js';
import {
  APARTMENT,
  APARTMENT_INTERIOR,
  ROOM_CELL_COUNT,
  cellCenter,
  furnitureById,
  houseTierSpec,
  type RoomStatePacket,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';

/**
 * 牛马公寓的美术层（ADR-0087）。
 *
 * 外立面走 y 排序层；室内是一块独立覆盖容器（`interiorLayer`），只在收到
 * `S2C_ROOM_STATE` 时显示——那时服务端已经把玩家放进房间频道，
 * 屋外的人既看不见他、也看不见这层地板。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: 0x14181c,
  concrete: 0x5a6169,
  concreteLight: 0x767f88,
  concreteDark: 0x3a4046,
  window: 0x8fd8e8,
  windowDark: 0x2f4850,
  neon: 0x5eead4,
  neonPink: 0x8b5cf6,
  gold: 0xf2c879,
  snow: 0xf2f7ff,
  // 室内四档地板
  floor0: 0x4a4038,
  floor1: 0x565e66,
  floor2: 0x8a6647,
  floor3: 0xdfe6ea,
  grid: 0xffffff,
} as const;

/** 家具配色：目录 id → 主色 */
const FURNITURE_COLOR: Record<number, number> = {
  0: 0xb08968,
  1: 0x8f9aa6,
  2: 0x7a5236,
  3: 0x3f6f8f,
  4: 0xf2c879,
  5: 0x2f8f63,
  6: 0xc76b5a,
  7: 0x2b2f36,
};

export class ApartmentView {
  readonly interiorLayer = new Container();
  private readonly roots: Container[] = [];
  private readonly texts: Text[] = [];
  private readonly floor = new Graphics();
  private readonly furniture = new Graphics();
  private readonly plaqueText: Text;
  private devicePxPerTexel: number;

  constructor(
    private readonly winter: boolean,
    devicePxPerTexel: number,
  ) {
    this.devicePxPerTexel = devicePxPerTexel;
    this.interiorLayer.visible = false;
    this.interiorLayer.addChild(this.floor);
    this.interiorLayer.addChild(this.furniture);
    this.plaqueText = new Text({
      text: '牛马公寓',
      resolution: devicePxPerTexel,
      style: { fontFamily: CJK_FONT, fontSize: 9, fontWeight: '700', fill: C.gold },
    });
    this.plaqueText.anchor.set(0.5, 1);
    this.texts.push(this.plaqueText);
  }

  build(depth: DepthSink, base: Container): void {
    const ground = new Graphics();
    ground
      .rect(APARTMENT.x, APARTMENT.y, APARTMENT.w, APARTMENT.h)
      .fill({ color: C.concreteDark, alpha: 0.4 });
    base.addChild(ground);

    const root = new Container();
    root.position.set(APARTMENT.x, APARTMENT.y + APARTMENT.h);
    const g = new Graphics();
    const w = APARTMENT.w;
    const h = APARTMENT.h;
    g.rect(0, -h, w, h).fill(C.outline);
    g.rect(2, -h + 2, w - 4, h - 4).fill(C.concrete);
    // 五层楼带与窗口
    for (let floor = 0; floor < 5; floor += 1) {
      const y = -h + 8 + floor * 54;
      g.rect(4, y, w - 8, 4).fill(C.concreteLight);
      for (let col = 0; col < 5; col += 1) {
        const lit = (floor + col) % 3 === 0;
        g.rect(16 + col * 68, y + 12, 34, 26).fill(lit ? C.window : C.windowDark);
        g.rect(16 + col * 68, y + 12, 34, 2).fill(C.concreteLight);
      }
    }
    // 一层门厅 + 霓虹门牌
    g.rect(w / 2 - 30, -46, 60, 46).fill(C.concreteDark);
    g.rect(w / 2 - 26, -42, 52, 42).fill(C.outline);
    g.rect(w / 2 - 24, -40, 48, 38).fill(C.neonPink);
    g.rect(w / 2 - 20, -36, 40, 30).fill(C.outline);
    g.rect(10, -56, 60, 16).fill(C.outline);
    g.rect(12, -54, 56, 12).fill(C.neon);
    if (this.winter) g.rect(2, -h + 1, w - 4, 4).fill(C.snow);
    root.addChild(g);
    this.plaqueText.position.set(w / 2 + 60, -44);
    root.addChild(this.plaqueText);
    depth.add(APARTMENT.y + APARTMENT.h, root);
    this.roots.push(root);
  }

  /** 房间状态：null 表示回到园区，室内层整体隐藏 */
  setRoomState(state: RoomStatePacket | null): void {
    if (!state) {
      this.interiorLayer.visible = false;
      return;
    }
    this.interiorLayer.visible = true;
    this.drawFloor(state.tier);
    this.furniture.clear();
    for (const entry of state.placements.slice(0, ROOM_CELL_COUNT)) {
      const sku = furnitureById(entry.id);
      if (!sku) continue;
      const center = cellCenter(entry.cell);
      const color = FURNITURE_COLOR[sku.id] ?? C.concreteLight;
      const wide = sku.cells * 44 - 8;
      this.furniture
        .rect(center.x - wide / 2, center.y - 16, wide, 32)
        .fill({ color, alpha: 0.9 })
        .rect(center.x - wide / 2, center.y - 16, wide, 4)
        .fill({ color: C.outline, alpha: 0.35 });
    }
    this.plaqueText.text = state.ownerName ? `${state.doorNo} ${state.ownerName}` : `${state.doorNo}`;
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const text of this.texts) text.resolution = devicePxPerTexel;
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    this.interiorLayer.destroy({ children: true });
    this.roots.length = 0;
    this.texts.length = 0;
  }

  /** 四档地板：纸箱堆 → 隔断 → 一居室 → 冷白大平层 */
  private drawFloor(tier: number): void {
    const spec = houseTierSpec(tier);
    const color = [C.floor0, C.floor1, C.floor2, C.floor3][Math.min(3, spec.tier)] ?? C.floor0;
    const g = this.floor;
    g.clear();
    g.rect(APARTMENT_INTERIOR.x, APARTMENT_INTERIOR.y, APARTMENT_INTERIOR.w, APARTMENT_INTERIOR.h)
      .fill(color)
      .stroke({ color: C.outline, width: 4 });
    if (spec.tier >= 2) {
      // 一居室起铺地板缝；大平层加一排落地窗
      for (let x = APARTMENT_INTERIOR.x + 22; x < APARTMENT_INTERIOR.x + APARTMENT_INTERIOR.w - 12; x += 44) {
        g.rect(x, APARTMENT_INTERIOR.y + 6, 1, APARTMENT_INTERIOR.h - 12).fill({
          color: C.outline,
          alpha: 0.18,
        });
      }
    }
    if (spec.tier >= 3) {
      g.rect(APARTMENT_INTERIOR.x + 8, APARTMENT_INTERIOR.y + 6, APARTMENT_INTERIOR.w - 16, 18).fill({
        color: C.window,
        alpha: 0.55,
      });
    }
  }
}
