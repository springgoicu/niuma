'use client';

import { Container, Graphics, Text } from 'pixi.js';
import {
  VILLA_SPECS,
  VILLA_THEME,
  VILLA_WALL_SOLIDS,
  villaBuyPrice,
  type VillaSpec,
  type VillaStatePacket,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { WINTER_COLORS } from './terrain-palette';
import { VENUE_OUTLINE } from './venue-palette';

/**
 * 园区 8 处分阶房产美术与实时冠名牌匾层（ADR-0087 扩展版）：
 *
 * - 五类建筑立面（夜店 / 改车铺 / 拉面摊 / 木屋茶院 / 砖瓦小院），全用深靛描边 `VENUE_OUTLINE`；
 * - 门前牌匾三态渲染：待售标价 / 他人冠名（王冠 + 在线状态灯 + 1.5×收购价） / 我的产业（金框 + 收益气泡）；
 * - 零 GC 增量重绘：仅当某栋房产的状态字段发生变化时才重画 `plaqueBg` / `led` / `gate` 与文本。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: VENUE_OUTLINE,
  /** 清水混凝土院墙（原砖红）：courtyard 的现代 Loft 围合 */
  brick: 0x8c939e,
  brickLight: 0xb4b8bf,
  brickDark: 0x5a606e,
  /** 防腐木甲板：偏冷的中性木，不是胡桃木 */
  timber: 0x7d6a52,
  timberLight: 0xa08a6c,
  timberDark: 0x54473a,
  /** 夜店：哑光钢板外壳 + 粉紫霓虹 */
  clubWall: 0x2f3540,
  clubTrim: 0xf06595,
  garageWall: 0x3b4459,
  garageTrim: 0x00f5d4,
  /** 美式金属快餐拖车（原日式红白条纹） */
  stallRoof: 0x6b7480,
  stallStripe: 0xd9e6ef,
  plaster: 0xb4b8bf,
  roof: 0x3a4150,
  roofLight: 0x4e5768,
  gateIron: 0x2f3439,
  gateIronLight: 0x5b636b,
  /** 玻璃幕墙与结构钢 */
  glass: 0x3f5a78,
  glassLight: 0x6f96bd,
  steel: 0x6b7480,
  plaqueFree: 0xfff6e0,
  plaqueOwned: 0x23293b,
  plaqueMine: 0x2e271d,
  plaqueEdgeFree: 0x8a6446,
  plaqueEdgeOwned: 0x38bdf8,
  plaqueEdgeMine: 0xf2c879,
  inkDark: 0x2f5d4a,
  inkLight: 0xf3f5f8,
  gold: 0xf2c879,
  goldDark: 0xa8802f,
  coin: 0xffd166,
  leaf: 0x2f8f63,
  leafLight: 0x4fbf85,
  ledOnline: 0x38ef7d,
  ledOffline: 0x64748b,
  snow: WINTER_COLORS.snowBase,
} as const;

interface PropertySlot {
  spec: VillaSpec;
  houseAccent: Graphics;
  plaqueBg: Graphics;
  led: Graphics;
  lock: Graphics;
  gate: Graphics;
  nameText: Text;
  subText: Text;
  badgeText: Text;
  lastOwned: boolean;
  lastMine: boolean;
  lastLocked: boolean;
  lastOnline: boolean;
  lastOwnerName: string;
  lastPending: number;
  lastTheme: number;
  lastTagline: string;
}

export class VillasView {
  private readonly roots: Container[] = [];
  private readonly slots: Array<PropertySlot | undefined> = [];
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
      this.paintPropertyGround(ground, spec);

      // 主建筑立面
      const house = new Container();
      house.position.set(spec.house.x, spec.house.y + spec.house.h);
      const hg = new Graphics();
      this.paintPropertyHouse(hg, spec);
      const houseAccent = new Graphics();
      house.addChild(hg, houseAccent);
      depth.add(spec.house.y + spec.house.h, house);
      this.roots.push(house);

      // 摇钱树 / 街边收银柜台
      const tree = new Container();
      tree.position.set(spec.tree.x, spec.tree.y);
      const tg = new Graphics();
      this.paintIncomeProp(tg, spec);
      tree.addChild(tg);
      depth.add(spec.tree.y, tree);
      this.roots.push(tree);

      // 门栅与三态房产牌匾
      const gateCont = new Container();
      gateCont.position.set(spec.gate.x, spec.gate.y);

      const gate = new Graphics();
      this.drawGate(gate, false, spec.kind);
      gateCont.addChild(gate);

      const plaqueBg = new Graphics();
      gateCont.addChild(plaqueBg);

      const nameText = new Text({
        text: spec.name,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 7, fontWeight: '700', fill: C.inkDark, letterSpacing: 1 },
      });
      nameText.anchor.set(0.5, 0.5);
      nameText.position.set(0, -49);
      gateCont.addChild(nameText);

      const subText = new Text({
        text: `FOR SALE · ¥${spec.price}`,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 8.5, fontWeight: '700', fill: C.inkDark },
      });
      subText.anchor.set(0.5, 0.5);
      subText.position.set(0, -37);
      gateCont.addChild(subText);

      const badgeText = new Text({
        text: `T${spec.tier} +${spec.income}/分`,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 6.5, fontWeight: '700', fill: C.goldDark },
      });
      badgeText.anchor.set(0.5, 0.5);
      badgeText.position.set(0, -27);
      gateCont.addChild(badgeText);

      const led = new Graphics();
      led.position.set(-48, -37);
      gateCont.addChild(led);

      const lock = new Graphics();
      lock.position.set(48, -37);
      gateCont.addChild(lock);

      this.texts.push(nameText, subText, badgeText);
      const slot: PropertySlot = {
        spec,
        houseAccent,
        plaqueBg,
        led,
        lock,
        gate,
        nameText,
        subText,
        badgeText,
        lastOwned: false,
        lastMine: false,
        lastLocked: false,
        lastOnline: false,
        lastOwnerName: '',
        lastPending: -1,
        lastTheme: 0,
        lastTagline: '',
      };
      this.redrawPlaque(slot, false, false, false, false, '', 0, 0, '');
      this.slots[spec.id] = slot;

      depth.add(spec.gate.y, gateCont);
      this.roots.push(gateCont);
    }

    // 院墙静态立面轮廓（全走深靛描边，无纯黑）
    for (const wall of VILLA_WALL_SOLIDS) {
      ground
        .rect(wall.x, wall.y, wall.w, wall.h)
        .fill(C.brick)
        .rect(wall.x, wall.y, wall.w, Math.max(1, wall.h - 3))
        .fill(C.brickLight);
    }
    if (this.winter) {
      for (const wall of VILLA_WALL_SOLIDS) {
        ground.rect(wall.x, wall.y, wall.w, 1).fill(C.snow);
      }
    }
    base.addChild(ground);
  }

  /** 按原始字段比对：仅在状态真的变动时才重绘，帧路径零分配 */
  setState(packet: VillaStatePacket): void {
    for (let i = 0; i < packet.villas.length; i += 1) {
      const info = packet.villas[i]!;
      const slot = this.slots[info.id];
      if (!slot) continue;

      const owned = info.owned;
      const mine = info.mine;
      const locked = info.locked;
      const online = info.ownerId !== 0;
      const ownerName = info.ownerName;
      const pending = info.pending;
      const theme = info.theme ?? 0;
      const tagline = info.tagline ?? '';

      if (
        slot.lastOwned === owned &&
        slot.lastMine === mine &&
        slot.lastLocked === locked &&
        slot.lastOnline === online &&
        slot.lastOwnerName === ownerName &&
        slot.lastPending === pending &&
        slot.lastTheme === theme &&
        slot.lastTagline === tagline
      ) {
        continue;
      }

      if (slot.lastLocked !== locked) {
        this.drawGate(slot.gate, locked, slot.spec.kind);
      }
      if (slot.lastTheme !== theme || slot.lastOwned !== owned) {
        this.drawHouseAccent(slot, owned ? theme : -1);
      }
      this.redrawPlaque(slot, owned, mine, locked, online, ownerName, pending, theme, tagline);
    }
  }

  private drawHouseAccent(slot: PropertySlot, theme: number): void {
    const g = slot.houseAccent;
    g.clear();
    if (theme < 0) return;
    const { w, h } = slot.spec.house;
    const accent =
      theme === VILLA_THEME.CyberNeon
        ? 0xf06595
        : theme === VILLA_THEME.EmeraldOasis
          ? 0x4fbf85
          : C.gold;
    g.rect(4, -h + 4, w - 8, 3).fill(accent);
    g.rect(4, -h + 4, 3, 14).fill(accent);
    g.rect(w - 7, -h + 4, 3, 14).fill(accent);
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const text of this.texts) text.resolution = devicePxPerTexel;
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    this.roots.length = 0;
    this.slots.length = 0;
    this.texts.length = 0;
  }

  private redrawPlaque(
    slot: PropertySlot,
    owned: boolean,
    mine: boolean,
    locked: boolean,
    online: boolean,
    ownerName: string,
    pending: number,
    theme: number,
    tagline: string,
  ): void {
    slot.lastOwned = owned;
    slot.lastMine = mine;
    slot.lastLocked = locked;
    slot.lastOnline = online;
    slot.lastOwnerName = ownerName;
    slot.lastPending = pending;
    slot.lastTheme = theme;
    slot.lastTagline = tagline;

    const { plaqueBg, led, lock, spec, nameText, subText, badgeText } = slot;
    const bg = mine ? C.plaqueMine : owned ? C.plaqueOwned : C.plaqueFree;
    const themeEdge =
      theme === VILLA_THEME.CyberNeon
        ? 0xf06595
        : theme === VILLA_THEME.EmeraldOasis
          ? 0x4fbf85
          : mine
            ? C.plaqueEdgeMine
            : C.plaqueEdgeOwned;
    const edge = owned ? themeEdge : C.plaqueEdgeFree;

    plaqueBg.clear();
    plaqueBg.rect(-60, -58, 120, 38).fill(C.outline);
    plaqueBg.rect(-58, -56, 116, 34).fill(bg);
    plaqueBg.rect(-58, -56, 116, 2).fill(edge);

    if (!owned) {
      nameText.style.fill = C.inkDark;
      subText.style.fill = C.inkDark;
      subText.text = `待售 ¥${spec.price}`;
      badgeText.style.fill = C.goldDark;
      badgeText.text = `T${spec.tier} · +${spec.income}/分`;
    } else if (mine) {
      nameText.style.fill = C.gold;
      subText.style.fill = C.inkLight;
      subText.text = tagline ? tagline.slice(0, 11) : `我的 · ${ownerName ? ownerName.slice(0, 6) : '本人'}`;
      badgeText.style.fill = C.coin;
      badgeText.text = pending > 0 ? `+¥${pending} 可收` : `+${spec.income}/分 · ${locked ? '已锁门' : '开放'}`;
    } else {
      nameText.style.fill = edge;
      subText.style.fill = C.inkLight;
      subText.text = tagline ? tagline.slice(0, 11) : ownerName ? ownerName.slice(0, 9) : '神秘房主';
      badgeText.style.fill = C.gold;
      badgeText.text = `收购 ¥${villaBuyPrice(spec, true)}`;
    }

    led.clear();
    if (owned) {
      led.rect(-4, -4, 8, 8).fill(C.outline);
      led.rect(-3, -3, 6, 6).fill(mine ? C.gold : online ? C.ledOnline : C.ledOffline);
      if (mine) {
        // 房主金皇冠像素点缀
        led.rect(-2, -6, 1, 2).fill(C.gold);
        led.rect(1, -6, 1, 2).fill(C.gold);
      }
    }

    lock.clear();
    if (locked) {
      lock.rect(-3, -2, 6, 6).fill(C.gold);
      lock.rect(-1, -2, 2, 3).fill(C.outline);
      lock.rect(-4, -6, 8, 3).stroke({ color: C.gold, width: 1.4 });
    }
  }

  private paintPropertyGround(ground: Graphics, spec: VillaSpec): void {
    const { x, y, w, h } = spec.rect;
    if (spec.kind === 'club') {
      ground.rect(x + 6, y + 6, w - 12, h - 12).fill({ color: 0x28324c, alpha: 0.55 });
      for (let ty = y + 20; ty < y + h - 24; ty += 36) {
        for (let tx = x + 20; tx < x + w - 24; tx += 36) {
          if (((tx + ty) / 36) % 2 === 0) {
            ground.rect(tx, ty, 32, 32).fill({ color: C.clubTrim, alpha: 0.14 });
          }
        }
      }
      return;
    }
    if (spec.kind === 'garage') {
      ground.rect(x + 6, y + 6, w - 12, h - 12).fill({ color: 0x3b4459, alpha: 0.48 });
      // 街头胎印
      ground.rect(x + w / 2 - 14, y + h - 42, 4, 24).fill({ color: C.outline, alpha: 0.25 });
      ground.rect(x + w / 2 + 10, y + h - 42, 4, 24).fill({ color: C.outline, alpha: 0.25 });
      return;
    }
    if (spec.kind === 'stall') {
      ground.rect(x + 6, y + 6, w - 12, h - 12).fill({ color: C.plaster, alpha: 0.36 });
      return;
    }
    ground.rect(x + 8, y + 8, w - 16, h - 16).fill({
      color: spec.kind === 'lodge' ? C.timberLight : C.plaster,
      alpha: 0.28,
    });
  }

  private paintPropertyHouse(hg: Graphics, spec: VillaSpec): void {
    const { w, h } = spec.house;
    if (spec.kind === 'club') {
      hg.rect(0, -h, w, h).fill(C.outline);
      hg.rect(2, -h + 2, w - 4, h - 4).fill(C.clubWall);
      hg.rect(4, -h - 8, w - 8, 10).fill(C.roof);
      hg.rect(6, -h - 5, w - 12, 3).fill(C.clubTrim);
      for (let i = 0; i < 5 && 14 + i * 52 + 28 < w; i += 1) {
        hg.rect(14 + i * 52, -h + 10, 28, 18).fill(i % 2 === 0 ? C.garageTrim : C.clubTrim);
      }
      if (this.winter) hg.rect(0, -h - 9, w, 3).fill(C.snow);
      return;
    }
    if (spec.kind === 'garage') {
      hg.rect(0, -h, w, h).fill(C.outline);
      hg.rect(2, -h + 2, w - 4, h - 4).fill(C.garageWall);
      hg.rect(0, -h - 6, w, 8).fill(C.roof);
      hg.rect(0, -h - 6, w, 2).fill(C.garageTrim);
      // 卷帘车库门与霓虹条纹
      hg.rect(Math.round(w / 2 - 40), -h + 14, 80, h - 16).fill(C.roofLight);
      for (let ry = -h + 20; ry < -6; ry += 6) {
        hg.rect(Math.round(w / 2 - 36), ry, 72, 2).fill(C.outline);
      }
      if (this.winter) hg.rect(0, -h - 7, w, 3).fill(C.snow);
      return;
    }
    if (spec.kind === 'stall') {
      // 美式金属快餐拖车：金属车身 + 折叠遮雨棚 + 暖黄灯泡串
      hg.rect(0, -h, w, h).fill(C.timberDark);
      hg.rect(2, -h + 2, w - 4, h - 4).fill(C.stallRoof);
      // 车身腰线：冷白铝条，把金属车身压出一道工业分割
      hg.rect(2, -h + Math.round(h * 0.55), w - 4, 2).fill(C.stallStripe);
      // 折叠遮雨棚：金属灰与冷白交替，棚沿留一道折痕影
      for (let sx = 0; sx < w; sx += 16) {
        const stripeW = Math.min(16, w - sx);
        hg.rect(sx, -h - 8, stripeW, 11).fill((sx / 16) % 2 === 0 ? C.stallRoof : C.stallStripe);
        hg.rect(sx, -h - 1, stripeW, 1).fill(C.steel);
      }
      // 暖黄灯泡串：裸灯泡，不带纸罩
      for (const lx of [18, w / 2, w - 18]) {
        hg.rect(lx - 1, -h + 1, 2, 3).fill(C.goldDark);
        hg.rect(lx - 3, -h + 4, 6, 4).fill(C.gold);
        hg.rect(lx - 1, -h + 5, 2, 2).fill(C.coin);
      }
      if (this.winter) hg.rect(0, -h - 9, w, 3).fill(C.snow);
      return;
    }
    const wallDark = spec.kind === 'lodge' ? C.timberDark : C.brickDark;
    const wallMain = spec.kind === 'lodge' ? C.timber : C.brick;
    hg.rect(0, -h, w, h).fill(wallDark);
    hg.rect(2, -h + 2, w - 4, h - 4).fill(wallMain);
    // 整面落地玻璃幕墙：lodge 是临水全景窗，courtyard 是钢构玻璃花房
    const paneTop = -h + 10;
    const paneH = Math.max(12, h - 20);
    hg.rect(6, paneTop, w - 12, paneH).fill(C.glass);
    for (let px = 6; px < w - 12; px += 26) hg.rect(px, paneTop, 1, paneH).fill(C.steel);
    // 玻璃高光：2:1 斜向反光，两段阶梯而不是一条直线
    hg.rect(10, paneTop + 2, 14, 1).fill(C.glassLight);
    hg.rect(13, paneTop + 3, 10, 1).fill(C.glassLight);
    // 平屋顶 + 女儿墙压顶：现代 Loft 的收口，不做斜檐瓦顶
    hg.rect(0, -h - 8, w, 10).fill(C.roof);
    hg.rect(0, -h - 8, w, 3).fill(C.roofLight);
    if (this.winter) hg.rect(0, -h - 9, w, 3).fill(C.snow);
  }

  private paintIncomeProp(tg: Graphics, spec: VillaSpec): void {
    if (spec.kind === 'club' || spec.kind === 'garage' || spec.kind === 'stall') {
      // 街边招财收银台 + 招财猫金罐
      tg.rect(-14, -22, 28, 22).fill(C.outline);
      tg.rect(-12, -20, 24, 18).fill(spec.kind === 'club' ? C.clubWall : C.timber);
      tg.rect(-14, -22, 28, 4).fill(spec.kind === 'garage' ? C.garageTrim : C.gold);
      tg.circle(0, -28, 6).fill(C.coin);
      return;
    }
    // 摇钱树：金色树冠 + 地面落币
    tg.rect(-3, -34, 6, 34).fill(C.timberDark);
    tg.circle(0, -44, 22).fill(C.leaf);
    tg.circle(-12, -38, 14).fill(C.leafLight);
    tg.circle(12, -40, 13).fill(C.leaf);
    for (let i = 0; i < 9; i += 1) {
      tg.circle(-18 + (i % 5) * 9, -50 + Math.floor(i / 5) * 10, 2.6).fill(C.coin);
    }
    if (this.winter) tg.circle(0, -58, 10).fill(C.snow);
  }

  private drawGate(g: Graphics, locked: boolean, kind: VillaSpec['kind']): void {
    g.clear();
    g.rect(-30, -6, 60, 6).fill(C.outline);
    g.rect(-28, -4, 56, 3).fill(C.gateIronLight);
    if (kind === 'stall' && !locked) return;
    for (let i = 0; i < 5; i += 1) {
      g.rect(-24 + i * 12, -34, 3, 30).fill(C.gateIron);
    }
    g.rect(-26, -34, 52, 3).fill(C.gateIronLight);
    g.rect(-26, -12, 52, 3).fill(C.gateIronLight);
    if (locked) g.rect(-26, -24, 52, 4).fill(C.gold);
  }
}
