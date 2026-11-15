'use client';

import { Container, Graphics, Text } from 'pixi.js';
import {
  APARTMENT_SPECS,
  ROOM_CELL,
  ROOM_CELL_COUNT,
  apartmentByDoorNo,
  cellCenter,
  furnitureById,
  houseTierSpec,
  type ApartmentSpec,
  type RoomStatePacket,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';

/**
 * 牛马公寓的美术层（ADR-0087 / ADR-0095）。
 *
 * 六栋单户公寓楼绕中央广场铺开：外立面全部走 y 排序层（各自一个深度键），
 * 室内仍是一块独立覆盖容器（`interiorLayer`），只在收到 `S2C_ROOM_STATE` 时显示，
 * 并且只画「自己那间房所在那栋楼」的那一块矩形——那时服务端已经把玩家放进房间频道，
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

/** 立面窗户网格：4 层 × 5 列，按 300×240 的楼体等比排布 */
const FACADE_FLOORS = 4;
const FACADE_COLUMNS = 5;

export class ApartmentView {
  readonly interiorLayer = new Container();
  private readonly roots: Container[] = [];
  private readonly texts: Text[] = [];
  private readonly plaques = new Map<number, Text>();
  private readonly floor = new Graphics();
  private readonly furniture = new Graphics();
  private devicePxPerTexel: number;
  /** 当前所在楼栋：回到园区时用它把牌匾还原成纯门牌号 */
  private currentSlot = -1;

  constructor(
    private readonly winter: boolean,
    devicePxPerTexel: number,
  ) {
    this.devicePxPerTexel = devicePxPerTexel;
    this.interiorLayer.visible = false;
    this.interiorLayer.addChild(this.floor);
    this.interiorLayer.addChild(this.furniture);
  }

  build(depth: DepthSink, base: Container): void {
    for (const spec of APARTMENT_SPECS) {
      const ground = new Graphics();
      ground
        .rect(spec.rect.x, spec.rect.y, spec.rect.w, spec.rect.h)
        .fill({ color: C.concreteDark, alpha: 0.4 });
      base.addChild(ground);

      const root = new Container();
      root.position.set(spec.rect.x, spec.rect.y + spec.rect.h);
      root.addChild(this.drawFacade(spec));

      const plaque = new Text({
        text: `${spec.doorNo}`,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 9, fontWeight: '700', fill: C.gold },
      });
      plaque.anchor.set(0.5, 1);
      plaque.position.set(spec.rect.w / 2 + 60, -44);
      root.addChild(plaque);
      this.plaques.set(spec.slot, plaque);
      this.texts.push(plaque);

      depth.add(spec.rect.y + spec.rect.h, root);
      this.roots.push(root);
    }
  }

  /** 房间状态：null 表示回到园区，室内层整体隐藏 */
  setRoomState(state: RoomStatePacket | null): void {
    if (!state) {
      this.interiorLayer.visible = false;
      this.resetPlaque(this.currentSlot);
      this.currentSlot = -1;
      return;
    }
    const spec = apartmentByDoorNo(state.doorNo);
    if (!spec) {
      this.interiorLayer.visible = false;
      return;
    }
    if (this.currentSlot !== spec.slot) this.resetPlaque(this.currentSlot);
    this.currentSlot = spec.slot;
    this.interiorLayer.visible = true;
    this.drawFloor(state.tier, spec);
    this.furniture.clear();
    for (const entry of state.placements.slice(0, ROOM_CELL_COUNT)) {
      const sku = furnitureById(entry.id);
      if (!sku) continue;
      const center = cellCenter(spec, entry.cell);
      const color = FURNITURE_COLOR[sku.id] ?? C.concreteLight;
      const wide = sku.cells * ROOM_CELL - 8;
      this.furniture
        .rect(center.x - wide / 2, center.y - ROOM_CELL / 2 + 6, wide, ROOM_CELL - 12)
        .fill({ color, alpha: 0.9 })
        .rect(center.x - wide / 2, center.y - ROOM_CELL / 2 + 6, wide, 4)
        .fill({ color: C.outline, alpha: 0.35 });
    }
    const plaque = this.plaques.get(spec.slot);
    if (plaque) plaque.text = state.ownerName ? `${spec.doorNo} ${state.ownerName}` : `${spec.doorNo}`;
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
    this.plaques.clear();
  }

  /** 离开房间：牌匾退回纯门牌号 */
  private resetPlaque(slot: number): void {
    if (slot < 0) return;
    const spec = APARTMENT_SPECS[slot];
    const plaque = this.plaques.get(slot);
    if (spec && plaque) plaque.text = `${spec.doorNo}`;
  }

  /** 水泥楼外立面：按楼体尺寸等比排布楼层带、窗与门厅霓虹 */
  private drawFacade(spec: ApartmentSpec): Graphics {
    const g = new Graphics();
    const w = spec.rect.w;
    const h = spec.rect.h;
    const bandStep = Math.round((h - 56) / FACADE_FLOORS);
    const windowStep = Math.round((w - 34) / FACADE_COLUMNS);
    const windowW = Math.max(16, windowStep - 30);
    g.rect(0, -h, w, h).fill(C.outline);
    g.rect(2, -h + 2, w - 4, h - 4).fill(C.concrete);
    for (let floor = 0; floor < FACADE_FLOORS; floor += 1) {
      const y = -h + 8 + floor * bandStep;
      g.rect(4, y, w - 8, 4).fill(C.concreteLight);
      for (let col = 0; col < FACADE_COLUMNS; col += 1) {
        const lit = (floor + col) % 3 === 0;
        const x = 16 + col * windowStep + 2;
        g.rect(x, y + 10, windowW, 22).fill(lit ? C.window : C.windowDark);
        g.rect(x, y + 10, windowW, 2).fill(C.concreteLight);
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
    return g;
  }

  /** 四档地板：纸箱堆 → 隔断 → 一居室 → 冷白大平层 */
  private drawFloor(tier: number, spec: ApartmentSpec): void {
    const houseTier = houseTierSpec(tier);
    const interior = spec.interior;
    const color = [C.floor0, C.floor1, C.floor2, C.floor3][Math.min(3, houseTier.tier)] ?? C.floor0;
    const g = this.floor;
    g.clear();
    g.rect(interior.x, interior.y, interior.w, interior.h)
      .fill(color)
      .stroke({ color: C.outline, width: 4 });
    if (houseTier.tier >= 2) {
      // 一居室起铺地板缝；大平层加一排落地窗
      for (let x = interior.x + ROOM_CELL / 2; x < interior.x + interior.w - 12; x += ROOM_CELL) {
        g.rect(x, interior.y + 6, 1, interior.h - 12).fill({
          color: C.outline,
          alpha: 0.18,
        });
      }
    }
    if (houseTier.tier >= 3) {
      g.rect(interior.x + 8, interior.y + 6, interior.w - 16, 18).fill({
        color: C.window,
        alpha: 0.55,
      });
    }
  }
}
