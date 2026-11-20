'use client';

import { Container, Graphics, Text } from 'pixi.js';
import {
  BOSS_VAULT,
  CHANGING_BOOTHS,
  DIRECTION,
  ESTATE_BOARD,
  FISHING_PIERS,
  FISHING_STATE,
  GIG_STATE,
  GRAFFITI_WALLS,
  LOADING_DOCK,
  PAYPHONES,
  SECURITY_GARAGE,
  VEHICLE_FLAG_BOOST,
  VEHICLE_FLAG_HORN,
  VEHICLE_FLAG_SIREN,
  VEHICLE_KIND,
  VEHICLE_SPAWNS,
  type FishingStatePacket,
  type GigStatePacket,
  type TurfStatePacket,
  type VehicleSnapshot,
  type VehicleStatePacket,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { WINTER_COLORS } from './terrain-palette';
import { VENUE_OUTLINE, darken } from './venue-palette';

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: VENUE_OUTLINE,
  boothMint: 0x4fe3c1,
  boothCream: 0xf4ede1,
  boothAmber: 0xf2c879,
  boardWood: 0x8a6446,
  boardSlate: 0x364258,
  vaultSteel: 0x4b5870,
  vaultGold: 0xf2c879,
  vaultDoor: 0x64748b,
  dockStripe: 0xe8b948,
  garageWall: 0x364258,
  garageDoor: 0x56647d,
  payRed: 0xc85c5c,
  payCream: 0xe8dfcf,
  pierWood: 0x9c7451,
  pierDark: 0x6b4e34,
  wallConcrete: 0xc2c6cf,
  wallCap: 0x7c8698,
  scooterBody: 0x4fe3c1,
  scooterSeat: 0x364258,
  forkliftBody: 0xe8b948,
  forkliftSteel: 0x7c8698,
  patrolWhite: 0xeff4f8,
  patrolNavy: 0x364258,
  patrolRed: 0xe05252,
  patrolBlue: 0x38bdf8,
  goldBody: 0xf2c879,
  goldHood: 0xd99b26,
  windshield: 0x8fc6dd,
  snow: WINTER_COLORS.snowBase,
} as const;

/** Crew color swatches deterministically derived from ownerId without allocating objects per frame. */
const CREW_PALETTE: readonly number[] = [
  0x4fe3c1,
  0xf2c879,
  0xf06595,
  0x38bdf8,
  0xfb923c,
  0xa78bfa,
];

interface WallSlot {
  wallId: number;
  swatch: Graphics;
  label: Text;
  lastOwnerId: number;
  lastOwnerName: string;
}

interface VehicleSlot {
  vehicleId: number;
  kind: number;
  root: Container;
  chassis: Container;
  sirenRed: Graphics | null;
  sirenBlue: Graphics | null;
  boostFlame: Graphics;
  hornRing: Graphics;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  dir: number;
  flags: number;
  driverId: number;
}

interface BobberSlot {
  playerId: number;
  spotId: number;
  state: number;
  gfx: Graphics;
}

function paintVehicleChassis(kind: number): {
  root: Container;
  chassis: Container;
  sirenRed: Graphics | null;
  sirenBlue: Graphics | null;
  boostFlame: Graphics;
  hornRing: Graphics;
} {
  const root = new Container();
  const shadow = new Graphics();
  shadow.ellipse(0, 11, 20, 6).fill({ color: C.outline, alpha: 0.28 });
  root.addChild(shadow);

  const hornRing = new Graphics();
  hornRing.circle(0, -4, 24).stroke({ color: C.boothAmber, width: 2, alpha: 0.8 });
  hornRing.visible = false;
  root.addChild(hornRing);

  const chassis = new Container();
  const body = new Graphics();
  const boostFlame = new Graphics();
  boostFlame.rect(-24, 1, 7, 5).fill(0xff7b54);
  boostFlame.rect(-27, 2, 4, 3).fill(0xffe08a);
  boostFlame.visible = false;
  chassis.addChild(boostFlame);

  let sirenRed: Graphics | null = null;
  let sirenBlue: Graphics | null = null;

  if (kind === VEHICLE_KIND.Scooter) {
    // 共享小电驴：轻巧青荷车身 + 前篮 + 圆灯
    body.rect(-14, -8, 28, 16).fill(C.outline);
    body.rect(-12, -6, 24, 12).fill(C.scooterBody);
    body.rect(-9, -4, 10, 8).fill(C.scooterSeat);
    body.rect(7, -5, 5, 10).fill(C.boothCream);
    body.rect(12, -2, 3, 4).fill(0xfff3b0);
    body.circle(-9, 9, 4).fill(C.outline);
    body.circle(9, 9, 4).fill(C.outline);
  } else if (kind === VEHICLE_KIND.Forklift) {
    // 黄漆叉车：厚重工程黄 + 钢叉臂
    body.rect(-18, -12, 34, 22).fill(C.outline);
    body.rect(-16, -10, 30, 18).fill(C.forkliftBody);
    body.rect(-12, -16, 16, 8).fill(C.outline);
    body.rect(-10, -14, 12, 6).fill(C.windshield);
    // 前叉臂
    body.rect(14, -4, 10, 3).fill(C.forkliftSteel);
    body.rect(14, 3, 10, 3).fill(C.forkliftSteel);
    body.circle(-10, 11, 5).fill(C.outline);
    body.circle(10, 11, 5).fill(C.outline);
  } else if (kind === VEHICLE_KIND.PatrolCart) {
    // 保安电动巡逻车：白蓝警用涂装 + 红蓝警示灯
    body.rect(-20, -12, 40, 22).fill(C.outline);
    body.rect(-18, -10, 36, 18).fill(C.patrolWhite);
    body.rect(-18, 0, 36, 6).fill(C.patrolNavy);
    body.rect(-8, -16, 18, 8).fill(C.patrolWhite);
    body.rect(2, -14, 7, 5).fill(C.windshield);
    body.circle(-11, 11, 5).fill(C.outline);
    body.circle(11, 11, 5).fill(C.outline);

    const lightBar = new Graphics();
    lightBar.rect(-5, -19, 10, 3).fill(C.outline);
    sirenRed = new Graphics();
    sirenRed.rect(-4, -19, 4, 3).fill(C.patrolRed);
    sirenBlue = new Graphics();
    sirenBlue.rect(0, -19, 4, 3).fill(C.patrolBlue);
    chassis.addChild(body, lightBar, sirenRed, sirenBlue);
    root.addChild(chassis);
    return { root, chassis, sirenRed, sirenBlue, boostFlame, hornRing };
  } else {
    // 老板黄金敞篷跑车：流线长车头 + 鎏金漆面 + 挡风玻璃
    body.rect(-22, -11, 44, 20).fill(C.outline);
    body.rect(-20, -9, 40, 16).fill(C.goldBody);
    body.rect(-20, 0, 40, 5).fill(C.goldHood);
    body.rect(-6, -13, 14, 6).fill(C.windshield);
    body.rect(-16, -9, 9, 4).fill(C.scooterSeat);
    body.rect(19, -4, 3, 3).fill(0xfff3b0);
    body.rect(19, 3, 3, 3).fill(0xfff3b0);
    body.circle(-12, 10, 5).fill(C.outline);
    body.circle(12, 10, 5).fill(C.outline);
  }

  chassis.addChild(body);
  root.addChild(chassis);
  return { root, chassis, sirenRed, sirenBlue, boostFlame, hornRing };
}

/**
 * Phase 2-4 像素职场 GTA 地标、载具、涂鸦墙、钓鱼浮标与零工信标渲染层。
 *
 * 硬约束：
 * - 描边与阴影统一用 `VENUE_OUTLINE` (`0x2a3142`)，严禁 `0x000000`；
 * - 零常驻 `LightSpec`（全用像素自发光色块表达氛围），守住 `venueLights` 18..22 预算；
 * - 所有动态更新（车辆 / 涂鸦 / 浮标 / 信标）按原始字段脏检查 + 对象池更新，帧循环零 GC。
 */
export class GtaWorldView {
  readonly overlay = new Container();
  private readonly roots: Container[] = [];
  private readonly wallSlots: WallSlot[] = [];
  private readonly vehicles = new Map<number, VehicleSlot>();
  private readonly bobbers: BobberSlot[] = [];
  private readonly gigBeacon = new Graphics();
  private gigActive = false;
  private gigX = 0;
  private gigY = 0;
  private readonly texts: Text[] = [];
  private devicePxPerTexel: number;

  constructor(
    private readonly winter: boolean,
    devicePxPerTexel: number,
  ) {
    this.devicePxPerTexel = devicePxPerTexel;
    this.gigBeacon.visible = false;
    this.overlay.addChild(this.gigBeacon);
  }

  build(depth: DepthSink, base: Container): void {
    this.paintFlatPads(base);
    this.paintChangingBooths(depth);
    this.paintEstateBoard(depth);
    this.paintBossVault(depth);
    this.paintSecurityGarage(depth);
    this.paintPayphones(depth);
    this.paintFishingPiers(base);
    this.paintGraffitiWalls(depth);
    this.initVehicles();
  }

  private paintFlatPads(base: Container): void {
    const g = new Graphics();

    // 快递零工装卸台（可踩平地：明黄工业边缘 + 分拣胶带标记）
    const dock = LOADING_DOCK.rect;
    g.rect(dock.x, dock.y, dock.w, dock.h).fill(C.outline);
    g.rect(dock.x + 2, dock.y + 2, dock.w - 4, dock.h - 4).fill(0x4b5870);
    for (let sx = dock.x + 6; sx < dock.x + dock.w - 10; sx += 14) {
      g.rect(sx, dock.y + 4, 8, 4).fill(C.dockStripe);
      g.rect(sx, dock.y + dock.h - 8, 8, 4).fill(C.dockStripe);
    }
    // 两只角落货箱装饰
    g.rect(dock.x + 6, dock.y + 14, 14, 14).fill(C.outline);
    g.rect(dock.x + 8, dock.y + 16, 10, 10).fill(0xd6a66a);
    g.rect(dock.x + dock.w - 22, dock.y + 16, 14, 12).fill(C.outline);
    g.rect(dock.x + dock.w - 20, dock.y + 18, 10, 8).fill(0xc48b52);

    // 保安车库地面停泊坪
    const gar = SECURITY_GARAGE.rect;
    g.rect(gar.x, gar.y + 44, gar.w, gar.h - 44).fill(0x2f384c);
    g.rect(gar.x + 12, gar.y + 58, 68, 48).stroke({ color: C.patrolBlue, width: 2, alpha: 0.7 });
    g.rect(gar.x + 96, gar.y + 58, 68, 48).stroke({ color: C.boothAmber, width: 2, alpha: 0.7 });

    base.addChild(g);
  }

  private paintChangingBooths(depth: DepthSink): void {
    for (const booth of CHANGING_BOOTHS) {
      const root = new Container();
      const { x, y, w, h } = booth.rect;
      root.position.set(x, y + h);
      const g = new Graphics();
      g.rect(0, -h, w, h).fill(C.outline);
      g.rect(2, -h + 2, w - 4, h - 4).fill(C.patrolNavy);
      // 红白/青奶条纹雨棚
      for (let i = 0; i < 4; i += 1) {
        g.rect(2 + i * 10, -h - 4, 10, 7).fill(i % 2 === 0 ? C.boothMint : C.boothCream);
      }
      g.rect(10, -h + 10, w - 20, h - 14).fill(C.windshield);
      g.rect(Math.round(w / 2 - 4), -h + 15, 8, 2).fill(C.boothAmber);
      if (this.winter) g.rect(0, -h - 6, w, 2).fill(C.snow);
      root.addChild(g);
      depth.add(y + h, root);
      this.roots.push(root);
    }
  }

  private paintEstateBoard(depth: DepthSink): void {
    const { x, y, w, h } = ESTATE_BOARD.rect;
    const root = new Container();
    root.position.set(x, y + h);
    const g = new Graphics();
    g.rect(8, -10, 6, 10).fill(C.outline);
    g.rect(w - 14, -10, 6, 10).fill(C.outline);
    g.rect(0, -h - 10, w, h).fill(C.outline);
    g.rect(2, -h - 8, w - 4, h - 4).fill(C.boardSlate);
    g.rect(6, -h - 4, w - 12, 4).fill(C.vaultGold);
    g.rect(10, -h + 5, 16, 14).fill(C.boothMint);
    g.rect(30, -h + 5, 16, 14).fill(C.boothAmber);
    g.rect(50, -h + 5, 12, 14).fill(C.payRed);
    if (this.winter) g.rect(0, -h - 12, w, 2).fill(C.snow);
    root.addChild(g);

    const title = new Text({
      text: '全园地产',
      resolution: this.devicePxPerTexel,
      style: { fontFamily: CJK_FONT, fontSize: 7, fontWeight: '700', fill: C.boothCream },
    });
    title.anchor.set(0.5, 0.5);
    title.position.set(w / 2, -h - 16);
    root.addChild(title);
    this.texts.push(title);

    depth.add(y + h, root);
    this.roots.push(root);
  }

  private paintBossVault(depth: DepthSink): void {
    const { x, y, w, h } = BOSS_VAULT.rect;
    const root = new Container();
    root.position.set(x, y + h);
    const g = new Graphics();
    g.rect(0, -h, w, h).fill(C.outline);
    g.rect(2, -h + 2, w - 4, h - 4).fill(C.vaultSteel);
    g.rect(6, -h + 6, w - 12, h - 10).fill(C.vaultDoor);
    g.circle(Math.round(w / 2), -Math.round(h / 2) + 2, 9).fill(C.outline);
    g.circle(Math.round(w / 2), -Math.round(h / 2) + 2, 6).fill(C.vaultGold);
    g.rect(Math.round(w / 2) - 4, -h + 3, 8, 3).fill(C.payRed);
    if (this.winter) g.rect(0, -h - 2, w, 2).fill(C.snow);
    root.addChild(g);
    depth.add(y + h, root);
    this.roots.push(root);
  }

  private paintSecurityGarage(depth: DepthSink): void {
    const { x, y, w, h } = SECURITY_GARAGE.solidWall;
    const root = new Container();
    root.position.set(x, y + h);
    const g = new Graphics();
    g.rect(0, -h - 8, w, h + 8).fill(C.outline);
    g.rect(2, -h - 6, w - 4, h + 4).fill(C.garageWall);
    // 卷帘门与警卫蓝/金灯带
    g.rect(14, -h + 6, 62, h - 8).fill(C.garageDoor);
    g.rect(w - 76, -h + 6, 62, h - 8).fill(C.garageDoor);
    g.rect(8, -h - 8, w - 16, 4).fill(C.patrolBlue);
    g.rect(Math.round(w / 2) - 18, -h + 10, 36, 12).fill(C.patrolRed);
    if (this.winter) g.rect(0, -h - 10, w, 2).fill(C.snow);
    root.addChild(g);

    const sign = new Text({
      text: '保安警备亭',
      resolution: this.devicePxPerTexel,
      style: { fontFamily: CJK_FONT, fontSize: 7.5, fontWeight: '700', fill: C.vaultGold },
    });
    sign.anchor.set(0.5, 0.5);
    sign.position.set(w / 2, -h - 14);
    root.addChild(sign);
    this.texts.push(sign);

    depth.add(y + h, root);
    this.roots.push(root);
  }

  private paintPayphones(depth: DepthSink): void {
    for (const phone of PAYPHONES) {
      const root = new Container();
      root.position.set(phone.x, phone.y + 8);
      const g = new Graphics();
      g.rect(-12, -34, 24, 34).fill(C.outline);
      g.rect(-10, -32, 20, 30).fill(C.payRed);
      g.rect(-7, -26, 14, 14).fill(C.windshield);
      g.rect(-4, -22, 8, 6).fill(C.payCream);
      g.rect(-10, -35, 20, 4).fill(C.vaultGold);
      if (this.winter) g.rect(-10, -37, 20, 2).fill(C.snow);
      root.addChild(g);
      depth.add(phone.y + 8, root);
      this.roots.push(root);
    }
  }

  private paintFishingPiers(base: Container): void {
    const g = new Graphics();
    for (const pier of FISHING_PIERS) {
      const { x, y, w, h } = pier.rect;
      g.rect(x, y, w, h).fill(C.outline);
      g.rect(x + 2, y + 2, w - 4, h - 4).fill(C.pierDark);
      for (let py = y + 4; py < y + h - 4; py += 6) {
        g.rect(x + 3, py, w - 6, 4).fill(C.pierWood);
      }
      // 木桩护栏 + 鱼桶
      g.rect(x + 2, y + 2, 5, 5).fill(C.vaultGold);
      g.rect(x + w - 7, y + 2, 5, 5).fill(C.vaultGold);
      g.circle(x + w - 10, y + h - 10, 5).fill(C.boothMint);
      g.circle(x + w - 10, y + h - 10, 3).fill(C.windshield);
    }
    base.addChild(g);
  }

  private paintGraffitiWalls(depth: DepthSink): void {
    for (const wall of GRAFFITI_WALLS) {
      const root = new Container();
      root.position.set(wall.x, wall.y);
      const g = new Graphics();
      g.rect(-18, -28, 36, 28).fill(C.outline);
      g.rect(-16, -26, 32, 24).fill(C.wallConcrete);
      g.rect(-18, -30, 36, 4).fill(C.wallCap);
      if (this.winter) g.rect(-16, -32, 32, 2).fill(C.snow);
      root.addChild(g);

      const swatch = new Graphics();
      swatch.rect(-12, -22, 24, 16).fill(0x9ca3af);
      swatch.rect(-8, -18, 16, 4).fill(C.boothCream);
      root.addChild(swatch);

      const label = new Text({
        text: '无主墙',
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 6.5, fontWeight: '700', fill: C.outline },
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(0, -36);
      root.addChild(label);
      this.texts.push(label);

      depth.add(wall.y, root);
      this.roots.push(root);
      this.wallSlots[wall.wallId] = {
        wallId: wall.wallId,
        swatch,
        label,
        lastOwnerId: -1,
        lastOwnerName: '',
      };
    }
  }

  private initVehicles(): void {
    for (const spawn of VEHICLE_SPAWNS) {
      this.createVehicle(spawn.vehicleId, spawn.kind, spawn.x, spawn.y, spawn.dir, 0, 0);
    }
  }

  private createVehicle(
    vehicleId: number,
    kind: number,
    x: number,
    y: number,
    dir: number,
    flags: number,
    driverId: number,
  ): VehicleSlot {
    const view = paintVehicleChassis(kind);
    view.root.position.set(Math.round(x), Math.round(y));
    view.chassis.scale.x = dir === DIRECTION.Left ? -1 : 1;
    this.overlay.addChild(view.root);
    const slot: VehicleSlot = {
      vehicleId,
      kind,
      root: view.root,
      chassis: view.chassis,
      sirenRed: view.sirenRed,
      sirenBlue: view.sirenBlue,
      boostFlame: view.boostFlame,
      hornRing: view.hornRing,
      x,
      y,
      targetX: x,
      targetY: y,
      dir,
      flags,
      driverId,
    };
    this.vehicles.set(vehicleId, slot);
    return slot;
  }

  setVehicles(packet: VehicleStatePacket): void {
    const list = packet.vehicles;
    for (let i = 0; i < list.length; i += 1) {
      const v: VehicleSnapshot = list[i]!;
      let slot = this.vehicles.get(v.vehicleId);
      if (!slot) {
        slot = this.createVehicle(v.vehicleId, v.kind, v.x, v.y, v.dir, v.flags, v.driverId);
        continue;
      }
      slot.dir = v.dir;
      slot.flags = v.flags;
      slot.driverId = v.driverId;
      slot.chassis.scale.x = v.dir === DIRECTION.Left ? -1 : 1;
      slot.targetX = v.x;
      slot.targetY = v.y;
      const dx = v.x - slot.x;
      const dy = v.y - slot.y;
      if (dx * dx + dy * dy > 220 * 220) {
        slot.x = v.x;
        slot.y = v.y;
        slot.root.position.set(Math.round(v.x), Math.round(v.y));
      }
    }
  }

  setTurf(packet: TurfStatePacket): void {
    const walls = packet.walls;
    for (let i = 0; i < walls.length; i += 1) {
      const entry = walls[i]!;
      const slot = this.wallSlots[entry.wallId];
      if (!slot) continue;
      if (slot.lastOwnerId === entry.ownerId && slot.lastOwnerName === entry.ownerName) continue;
      slot.lastOwnerId = entry.ownerId;
      slot.lastOwnerName = entry.ownerName;

      slot.swatch.clear();
      if (entry.ownerId === 0) {
        slot.swatch.rect(-12, -22, 24, 16).fill(0x9ca3af);
        slot.swatch.rect(-8, -18, 16, 4).fill(C.boothCream);
        slot.label.text = '无主墙';
        slot.label.style.fill = C.outline;
      } else {
        const crewColor = CREW_PALETTE[Math.abs(entry.ownerId) % CREW_PALETTE.length]!;
        slot.swatch.rect(-13, -23, 26, 18).fill(darken(crewColor, 0.55));
        slot.swatch.rect(-11, -21, 22, 14).fill(crewColor);
        slot.swatch.circle(0, -14, 4).fill(C.boothCream);
        slot.label.text = entry.ownerName.slice(0, 6) || '占领中';
        slot.label.style.fill = crewColor;
      }
    }
  }

  setFishing(packet: FishingStatePacket): void {
    let found: BobberSlot | null = null;
    for (let i = 0; i < this.bobbers.length; i += 1) {
      if (this.bobbers[i]!.playerId === packet.id) {
        found = this.bobbers[i]!;
        break;
      }
    }
    if (packet.state === FISHING_STATE.Idle || packet.state === FISHING_STATE.Caught || packet.state === FISHING_STATE.Missed) {
      if (found) {
        found.state = FISHING_STATE.Idle;
        found.gfx.visible = false;
      }
      return;
    }
    if (!found) {
      const gfx = new Graphics();
      this.overlay.addChild(gfx);
      found = { playerId: packet.id, spotId: packet.spotId, state: packet.state, gfx };
      this.bobbers.push(found);
    }
    found.spotId = packet.spotId;
    found.state = packet.state;
    const pier = FISHING_PIERS[packet.spotId] ?? FISHING_PIERS[0]!;
    const px = Math.round(pier.castSpot.x);
    const py = Math.round(pier.castSpot.y + 34);
    found.gfx.clear();
    found.gfx.circle(0, 0, 8).stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
    found.gfx.circle(0, -2, 3.5).fill(found.state === FISHING_STATE.Biting ? C.patrolRed : C.boothAmber);
    if (found.state === FISHING_STATE.Biting) {
      found.gfx.rect(-2, -16, 4, 8).fill(C.boothAmber);
      found.gfx.rect(-2, -6, 4, 3).fill(C.patrolRed);
    }
    found.gfx.position.set(px, py);
    found.gfx.visible = true;
  }

  setGig(packet: GigStatePacket): void {
    this.gigActive = packet.state === GIG_STATE.Active;
    this.gigX = packet.targetX;
    this.gigY = packet.targetY;
    this.gigBeacon.visible = this.gigActive;
    if (this.gigActive) {
      this.gigBeacon.clear();
      this.gigBeacon.circle(0, 0, 22).stroke({ color: C.boothAmber, width: 2.5, alpha: 0.9 });
      this.gigBeacon.poly([0, -34, -6, -44, 6, -44]).fill(C.boothAmber);
      this.gigBeacon.position.set(Math.round(this.gigX), Math.round(this.gigY));
    }
  }

  update(now: number, dtMs = 16.6): void {
    const blend = 1 - Math.exp(-Math.max(1, dtMs) / 90);
    const sirenPhase = Math.floor(now / 360) % 2;

    for (const v of this.vehicles.values()) {
      const dx = v.targetX - v.x;
      const dy = v.targetY - v.y;
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        v.x += dx * blend;
        v.y += dy * blend;
      } else {
        v.x = v.targetX;
        v.y = v.targetY;
      }
      const driving = v.driverId !== 0;
      const bounce = driving && Math.sin(now / 65) > 0.2 ? -1 : 0;
      v.root.position.set(Math.round(v.x), Math.round(v.y) + bounce);
      v.boostFlame.visible = driving && (v.flags & VEHICLE_FLAG_BOOST) !== 0;
      v.hornRing.visible = (v.flags & VEHICLE_FLAG_HORN) !== 0;
      if (v.hornRing.visible) v.hornRing.alpha = 0.45 + 0.35 * Math.sin(now / 60);
      if (v.sirenRed && v.sirenBlue) {
        const sirenOn = (v.flags & VEHICLE_FLAG_SIREN) !== 0 || driving;
        v.sirenRed.alpha = sirenOn ? (sirenPhase === 0 ? 1 : 0.2) : 0.25;
        v.sirenBlue.alpha = sirenOn ? (sirenPhase === 1 ? 1 : 0.2) : 0.25;
      }
    }

    for (let i = 0; i < this.bobbers.length; i += 1) {
      const b = this.bobbers[i]!;
      if (!b.gfx.visible) continue;
      const bob = Math.round(Math.sin(now / (b.state === FISHING_STATE.Biting ? 90 : 320)) * 2);
      const pier = FISHING_PIERS[b.spotId] ?? FISHING_PIERS[0]!;
      b.gfx.position.set(Math.round(pier.castSpot.x), Math.round(pier.castSpot.y + 34 + bob));
    }

    if (this.gigActive) {
      const lift = Math.round(Math.sin(now / 220) * 3);
      this.gigBeacon.position.set(Math.round(this.gigX), Math.round(this.gigY + lift));
    }
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (let i = 0; i < this.texts.length; i += 1) {
      this.texts[i]!.resolution = devicePxPerTexel;
    }
  }

  destroy(): void {
    for (let i = 0; i < this.roots.length; i += 1) {
      this.roots[i]!.destroy({ children: true });
    }
    this.roots.length = 0;
    this.wallSlots.length = 0;
    this.vehicles.clear();
    this.bobbers.length = 0;
    this.texts.length = 0;
    this.overlay.destroy({ children: true });
  }
}
