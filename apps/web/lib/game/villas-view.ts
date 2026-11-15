'use client';

import { Container, Graphics, Text } from 'pixi.js';
import {
  VILLA_PRICE,
  VILLA_SPECS,
  VILLA_WALL_SOLIDS,
  type VillaStatePacket,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';

/**
 * 豪宅小院的美术层（ADR-0087）。
 *
 * 院墙是静态碰撞、门栅是动态碰撞（视觉上门栅由 `locked` 决定要不要画），
 * 牌匾上的字随 `S2C_VILLA_STATE` 实时更新：无主时写标价，有主时写房主名与锁形图标。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: 0x1a1512,
  brick: 0x8f4a3c,
  brickLight: 0xb3604c,
  brickDark: 0x5f2f26,
  plaster: 0xd9c9b0,
  roof: 0x2b2f36,
  roofLight: 0x49505a,
  gateIron: 0x2f3439,
  gateIronLight: 0x5b636b,
  plaque: 0x141416,
  gold: 0xf2c879,
  goldDark: 0xa8802f,
  coin: 0xffd166,
  leaf: 0x2f8f63,
  leafLight: 0x4fbf85,
  snow: 0xf2f7ff,
} as const;

interface LabelSlot {
  text: Text;
  lock: Graphics;
}

export class VillasView {
  private readonly roots: Container[] = [];
  private readonly labels: LabelSlot[] = [];
  private readonly gates: Graphics[] = [];
  private readonly texts: Text[] = [];
  private devicePxPerTexel: number;

  constructor(
    private readonly winter: boolean,
    devicePxPerTexel: number,
  ) {
    this.devicePxPerTexel = devicePxPerTexel;
  }

  build(depth: DepthSink, base: Container): void {
    const ground = new Graphics();
    for (const spec of VILLA_SPECS) {
      // 院内铺装与草皮
      ground
        .rect(spec.rect.x + 8, spec.rect.y + 8, spec.rect.w - 16, spec.rect.h - 16)
        .fill({ color: C.plaster, alpha: 0.28 });
      // 小楼本体（走深度层，会被角色挡住）
      const house = new Container();
      house.position.set(spec.house.x, spec.house.y + spec.house.h);
      const hg = new Graphics();
      hg.rect(0, -spec.house.h, spec.house.w, spec.house.h).fill(C.brickDark);
      hg.rect(2, -spec.house.h + 2, spec.house.w - 4, spec.house.h - 4).fill(C.brick);
      for (let i = 0; i < 4; i += 1) {
        hg.rect(6 + i * 52, -spec.house.h + 8, 34, 22).fill(C.roofLight);
        hg.rect(6 + i * 52, -spec.house.h + 8, 34, 3).fill(C.goldDark);
      }
      hg.rect(0, -spec.house.h - 8, spec.house.w, 10).fill(C.roof);
      hg.rect(0, -spec.house.h - 8, spec.house.w, 3).fill(C.roofLight);
      if (this.winter) hg.rect(0, -spec.house.h - 9, spec.house.w, 3).fill(C.snow);
      house.addChild(hg);
      depth.add(spec.house.y + spec.house.h, house);
      this.roots.push(house);

      // 摇钱树：金色树冠 + 地面落币
      const tree = new Container();
      tree.position.set(spec.tree.x, spec.tree.y);
      const tg = new Graphics();
      tg.rect(-3, -34, 6, 34).fill(C.brickDark);
      tg.circle(0, -44, 22).fill(C.leaf);
      tg.circle(-12, -38, 14).fill(C.leafLight);
      tg.circle(12, -40, 13).fill(C.leaf);
      for (let i = 0; i < 9; i += 1) {
        tg.circle(-18 + (i % 5) * 9, -50 + Math.floor(i / 5) * 10, 2.6).fill(C.coin);
      }
      if (this.winter) tg.circle(0, -58, 10).fill(C.snow);
      tree.addChild(tg);
      depth.add(spec.tree.y, tree);
      this.roots.push(tree);

      // 院门 + 牌匾
      const gate = new Container();
      gate.position.set(spec.gate.x, spec.gate.y);
      const gg = new Graphics();
      gg.rect(-30, -6, 60, 6).fill(C.outline);
      gg.rect(-28, -4, 56, 3).fill(C.gateIronLight);
      this.drawGate(gg, false);
      gate.addChild(gg);
      this.gates[spec.id] = gg;

      // 院门牌匾：26 高，上行静态院名、下行归属（待售 / 房主名）
      const plaque = new Graphics();
      plaque.rect(-52, -50, 104, 26).fill(C.outline);
      plaque.rect(-50, -48, 100, 22).fill(C.plaque);
      plaque.rect(-50, -48, 100, 2).fill(C.goldDark);
      gate.addChild(plaque);

      const name = new Text({
        text: spec.name,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 7, fontWeight: '600', fill: C.gold, letterSpacing: 1 },
      });
      name.anchor.set(0.5, 0.5);
      name.position.set(0, -43);
      gate.addChild(name);
      this.texts.push(name);

      const text = new Text({
        text: `待售 ${VILLA_PRICE}`,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 9, fontWeight: '600', fill: C.gold },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(0, -33);
      gate.addChild(text);
      const lock = new Graphics();
      lock.position.set(44, -33);
      gate.addChild(lock);
      this.texts.push(text);
      this.labels[spec.id] = { text, lock };
      depth.add(spec.gate.y, gate);
      this.roots.push(gate);
    }

    // 院墙：静态碰撞的视觉对照，贴地画一条砖带
    for (const wall of VILLA_WALL_SOLIDS) {
      ground
        .rect(wall.x, wall.y, wall.w, wall.h)
        .fill(C.brick)
        .rect(wall.x, wall.y, wall.w, Math.max(1, wall.h - 4))
        .fill(C.brickLight);
    }
    if (this.winter) {
      for (const wall of VILLA_WALL_SOLIDS) {
        ground.rect(wall.x, wall.y, wall.w, 1).fill(C.snow);
      }
    }
    base.addChild(ground);
  }

  /** 牌匾与锁状态：房主名过长时由 Pixi 自己缩放，不做二次截断 */
  setState(packet: VillaStatePacket): void {
    for (const info of packet.villas) {
      const slot = this.labels[info.id];
      if (!slot) continue;
      slot.text.text = info.ownerName ? info.ownerName.slice(0, 10) : `待售 ${VILLA_PRICE}`;
      slot.lock.clear();
      if (info.locked) {
        slot.lock.rect(-3, -2, 6, 6).fill(C.gold);
        slot.lock.rect(-1, -2, 2, 3).fill(C.outline);
        slot.lock.rect(-4, -6, 8, 3).stroke({ color: C.gold, width: 1.4 });
      }
      const gate = this.gates[info.id];
      if (gate) {
        gate.clear();
        gate.rect(-30, -6, 60, 6).fill(C.outline);
        gate.rect(-28, -4, 56, 3).fill(C.gateIronLight);
        this.drawGate(gate, info.locked);
      }
    }
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const text of this.texts) text.resolution = devicePxPerTexel;
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    this.roots.length = 0;
    this.labels.length = 0;
    this.texts.length = 0;
  }

  /** 铁艺门扇：锁上时加一道横闩 */
  private drawGate(g: Graphics, locked: boolean): void {
    for (let i = 0; i < 5; i += 1) {
      g.rect(-24 + i * 12, -34, 3, 30).fill(C.gateIron);
    }
    g.rect(-26, -34, 52, 3).fill(C.gateIronLight);
    g.rect(-26, -12, 52, 3).fill(C.gateIronLight);
    if (locked) g.rect(-26, -24, 52, 4).fill(C.gold);
  }
}
