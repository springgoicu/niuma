'use client';

import { Container, Graphics } from 'pixi.js';
import {
  AMBULANCE_FLAG_SIREN,
  AMBULANCE_STATE,
  CLINIC_ACCESS_PAVING,
  CLINIC_AMBULANCE_SPOTS,
  CLINIC_BEDS,
  CLINIC_COUNTER,
  CLINIC_DROP,
  CLINIC_FENCE_SOLIDS,
  CLINIC_RECT,
  CLINIC_REGION_RECT,
  CLINIC_SIGN,
  PATIENT_STATE,
  type AmbulancePacket,
  type PatientStatusPacket,
} from '@niuma/shared-types';
import { BEACON_BLUE, BEACON_OFF_ALPHA, BEACON_RED, beaconPhase } from './police-beacon';
import { WINTER_COLORS } from './terrain-palette';
import type { DepthSink } from './sort-layer';

const C = {
  floor: 0xdde6ea,
  floorAlt: 0xcfdce2,
  floorEdge: 0x9fb4bd,
  floorCross: 0xf2b4b8,
  red: 0xd93b45,
  redDark: 0x9f202c,
  white: 0xf7fbfd,
  ink: 0x2b3440,
  steel: 0xb9c6cc,
  steelDark: 0x6f8089,
  blanket: 0xcfe5f0,
  blanketDark: 0x9dc5d8,
  bay: 0xe8c74a,
  seat: 0x3a4a56,
  heart: 0xff5c8a,
  heartLight: 0xffb3c6,
  /** 积雪：与地面雪同一色阶 */
  snow: WINTER_COLORS.snowBase,
  snowShade: WINTER_COLORS.snowShade,
} as const;

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

interface CarView {
  root: Container;
  red: Graphics;
  blue: Graphics;
  state: number;
  flags: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

/** 一辆 64×48 的白色像素救护车：车身红十字 + 车顶红蓝警灯（400ms 交替） */
function paintAmbulance(): CarView {
  const root = new Container();
  const shadow = new Graphics();
  shadow.ellipse(0, 21, 30, 6).fill({ color: 0x000000, alpha: 0.22 });
  root.addChild(shadow);

  const body = new Graphics();
  // 车身主体：白色方舱 + 右前驾驶舱
  rect(body, -32, -20, 54, 40, C.steelDark);
  rect(body, -31, -20, 52, 38, C.white);
  rect(body, -31, 14, 64, 4, C.steelDark);
  rect(body, 22, -10, 10, 26, C.white);
  rect(body, 24, -8, 8, 12, 0x8fc6dd);
  rect(body, 24, 6, 8, 8, 0x8fc6dd);
  // 车顶
  rect(body, -32, -24, 58, 5, C.steel);
  rect(body, -30, -27, 46, 4, C.white);
  // 红色腰线 + 红十字
  rect(body, -31, 4, 52, 4, C.red);
  rect(body, -31, -1, 22, 2, C.red);
  rect(body, -18, -14, 12, 4, C.red);
  rect(body, -14, -18, 4, 12, C.red);
  // 车轮
  body.circle(-18, 19, 6).fill(C.ink);
  body.circle(-18, 19, 3).fill(C.steel);
  body.circle(16, 19, 6).fill(C.ink);
  body.circle(16, 19, 3).fill(C.steel);
  // 前灯与保险杠
  rect(body, 30, 8, 3, 4, 0xfff3b0);
  rect(body, 30, 15, 3, 3, C.red);
  root.addChild(body);

  // 警灯：灯座 + 红蓝两枚，alpha 由 update 按 400ms 相位切换
  const housing = new Graphics();
  rect(housing, -14, -32, 28, 6, C.ink);
  rect(housing, -12, -31, 24, 3, 0x11151b);
  const red = new Graphics();
  red.circle(-7, -30, 3).fill(BEACON_RED);
  const blue = new Graphics();
  blue.circle(7, -30, 3).fill(BEACON_BLUE);
  root.addChild(housing, red, blue);
  root.position.set(0, 0);
  return { root, red, blue, state: AMBULANCE_STATE.Idle, flags: 0, x: 0, y: 0, targetX: 0, targetY: 0 };
}

/**
 * 护士急救站（ADR-0084）的静态场景与两辆救护车。
 *
 * 地面层画站台与床位，深度层只放柜台和床尾护栏；救护车与护士帽红十字
 * 放在独立的 overlay 里，由 renderer 挂在 y 排序层之后。
 */
export class ClinicView {
  readonly overlay = new Container();
  private readonly cars = new Map<number, CarView>();
  /** 护士帽红十字：按实体 id 登记，每帧跟着护士本体走（ADR-0109） */
  private readonly crosses = new Map<number, Container>();
  private readonly hearts: Container[] = [];
  private readonly treating = new Set<number>();

  /** 冬季：栏板顶与站台边沿积雪。纯表现层，`?season=off` 时不画 */
  constructor(private readonly winter = false) {
    this.overlay.addChild(this.paintHearts());
  }

  /**
   * 护士巡游后不再站在固定站位（ADR-0109）：红十字必须挂在实体上，
   * 否则她走到床侧时帽顶还留在一百多像素外的柜台后面。
   */
  addNurse(id: number): void {
    if (this.crosses.has(id)) return;
    const cap = new Graphics();
    // 护士帽顶的红十字（白色帽体由图集画，红十字只能独立一层保持高饱和）
    cap.rect(-4, -3, 8, 2).fill(C.red);
    cap.rect(-1, -6, 2, 8).fill(C.red);
    cap.visible = false;
    this.overlay.addChild(cap);
    this.crosses.set(id, cap);
  }

  removeNurse(id: number): void {
    const cap = this.crosses.get(id);
    if (!cap) return;
    cap.destroy();
    this.crosses.delete(id);
  }

  build(depth: DepthSink, base: Container): void {
    this.paintFloor(base);
    this.paintFence(depth, base);
    this.paintBeds(base);
    this.paintCounter(depth);
    this.paintSign(base);
    this.paintBays(base);
    this.createCar(1);
    this.createCar(2);
  }

  private paintFloor(base: Container): void {
    const g = new Graphics();
    const { x, y, w, h } = CLINIC_RECT;
    rect(g, x, y, w, h, C.floorEdge);
    rect(g, x + 2, y + 2, w - 4, h - 4, C.floor);
    // 浅色瓷砖网格：24px 一格，和园区铺装同一颗粒度
    for (let ty = y + 4; ty < y + h - 4; ty += 24) {
      for (let tx = x + 4; tx < x + w - 4; tx += 24) {
        const col = Math.floor((tx - x - 4) / 24);
        const row = Math.floor((ty - y - 4) / 24);
        if ((col + row) % 2 === 0) rect(g, tx, ty, 22, 22, C.floorAlt);
      }
    }
    // 地面淡红十字，给站台一个一眼能认出的医疗符号
    g.rect(x + 108, y + 50, 24, 8).fill(C.floorCross);
    g.rect(x + 116, y + 42, 8, 24).fill(C.floorCross);
    // 冬季：站台南沿堆一条雪齿，草地的雪与室内瓷砖之间不再是直角硬切
    if (this.winter) {
      for (let sx = x + 2; sx < x + w - 2; sx += 9) {
        const tall = ((Math.imul(sx + 5, 2654435761) >>> 0) % 2) + 2;
        rect(g, sx, y + h - tall, Math.min(9, x + w - 2 - sx), tall, C.snow);
      }
      rect(g, x + 2, y + h - 1, w - 4, 1, C.snowShade);
    }
    base.addChild(g);
  }

  /**
   * 围挡（ADR-0092）：几何只读 `CLINIC_FENCE_SOLIDS`，碰撞与贴图不会各写一份。
   *
   * 横向段（北栏、东南段）按脚底 y 进深度层：站内的人画在栏杆前，站外的人被栏杆挡住脚。
   * 纵向段（东西两面）整段落在地面层，白栏板 + 钢灰扶手，与柜台、病床同一套配色。
   */
  private paintFence(depth: DepthSink, base: Container): void {
    for (const bar of CLINIC_FENCE_SOLIDS) {
      const root = new Container();
      root.position.set(bar.x, bar.y);
      const g = new Graphics();
      const horizontal = bar.w >= bar.h;
      if (horizontal) {
        // 地脚 + 白栏板，再压一道钢灰扶手与每 24px 一根的立杆
        rect(g, 0, 0, bar.w, bar.h, C.steelDark);
        rect(g, 0, 0, bar.w, bar.h - 2, C.white);
        rect(g, 0, -4, bar.w, 4, C.steel);
        rect(g, 0, -4, bar.w, 1, C.white);
        for (let px = 6; px < bar.w - 4; px += 24) {
          rect(g, px, -4, 3, bar.h + 2, C.white);
          rect(g, px + 2, -4, 1, bar.h + 2, C.steelDark);
        }
        // 冬季：扶手顶积雪，栏杆因此有厚度而不是一条白线
        if (this.winter) {
          for (let px = 0; px < bar.w; px += 8) {
            const tall = ((Math.imul(px + 3, 2246822519) >>> 0) % 2) + 1;
            rect(g, px, -5, Math.min(8, bar.w - px), tall, C.snow);
          }
        }
      } else {
        // 纵向段：看到的是护栏侧面，白栏板上按 24px 一道压出横撑
        rect(g, 0, 0, bar.w, bar.h, C.steelDark);
        rect(g, 0, 0, bar.w - 2, bar.h, C.white);
        rect(g, 0, 0, 1, bar.h, C.steel);
        for (let py = 6; py < bar.h - 4; py += 24) {
          rect(g, 0, py, bar.w, 3, C.steel);
          rect(g, 0, py, bar.w, 1, C.white);
        }
      }
      root.addChild(g);
      if (horizontal) depth.add(bar.y + bar.h, root);
      else base.addChild(root);
    }
    this.paintGatePosts(base);
  }

  /** 西门两侧的门柱：立柱顶一个小红十字，远远就能认出这是护士站的出入口 */
  private paintGatePosts(base: Container): void {
    const g = new Graphics();
    const x = CLINIC_REGION_RECT.x;
    const top = CLINIC_ACCESS_PAVING.y;
    const bottom = CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h;
    for (const y of [top - 12, bottom]) {
      rect(g, x - 1, y, 12, 12, C.steelDark);
      rect(g, x, y, 10, 10, C.white);
      rect(g, x + 3, y + 4, 4, 2, C.red);
      rect(g, x + 4, y + 3, 2, 4, C.red);
    }
    base.addChild(g);
  }

  private paintBeds(base: Container): void {
    const g = new Graphics();
    for (const bed of CLINIC_BEDS) {
      const { x, y, w, h } = bed;
      // 横向床架：左右短边是床头 / 床尾，枕头在右端（与座位朝向 Down/Right 的床品约定一致）
      rect(g, x + 4, y + 4, w - 8, h - 8, C.steelDark);
      rect(g, x + 6, y + 6, w - 12, h - 12, C.white);
      // 被子：左半边浅蓝，右端留白枕头
      rect(g, x + 8, y + 8, w - 28, h - 16, C.blanket);
      rect(g, x + w - 20, y + 8, 12, h - 16, C.blanketDark);
      // 枕头压在被子右端
      rect(g, x + w - 16, y + 7, 10, h - 14, C.white);
      rect(g, x + w - 16, y + h - 9, 10, 2, C.steel);
      rect(g, x + 6, y + h - 5, w - 12, 2, C.steelDark);
    }
    base.addChild(g);
  }

  private paintCounter(depth: DepthSink): void {
    const root = new Container();
    root.position.set(CLINIC_COUNTER.x, CLINIC_COUNTER.y + CLINIC_COUNTER.h);
    const g = new Graphics();
    const { w, h } = CLINIC_COUNTER;
    // 柜台正面：白漆 + 蓝灰压条 + 红色扶手
    rect(g, 0, -h, w, h, C.steelDark);
    rect(g, 2, -h + 2, w - 4, h - 4, C.white);
    rect(g, 2, -8, w - 4, 6, C.steel);
    rect(g, 8, -h + 5, 24, 4, C.red);
    // 台面
    rect(g, -4, -h - 4, w + 8, 6, C.steelDark);
    rect(g, -3, -h - 3, w + 6, 4, C.white);
    // 台面上的红十字符号
    g.rect(-20 + w / 2, -h - 2, 14, 4).fill(C.red);
    g.rect(-15 + w / 2, -h - 7, 4, 14).fill(C.red);
    root.addChild(g);
    depth.add(CLINIC_COUNTER.y + CLINIC_COUNTER.h, root);
  }

  private paintSign(base: Container): void {
    const g = new Graphics();
    const x = CLINIC_SIGN.x;
    const y = CLINIC_SIGN.y;
    // 立牌：白底红十字符号，支脚压在地面
    rect(g, x + 2, y + 14, 3, 20, C.steelDark);
    rect(g, x + 38, y + 14, 3, 20, C.steelDark);
    rect(g, x, y, 44, 18, C.redDark);
    rect(g, x + 1, y + 1, 42, 16, C.white);
    g.rect(x + 18, y + 4, 6, 10).fill(C.red);
    g.rect(x + 16, y + 6, 10, 6).fill(C.red);
    base.addChild(g);
  }

  private paintBays(base: Container): void {
    const g = new Graphics();
    for (const spot of CLINIC_AMBULANCE_SPOTS) {
      // 每格 72×58 的黄色车位线
      rect(g, spot.x - 36, spot.y - 29, 72, 58, 0x6b7a83);
      rect(g, spot.x - 34, spot.y - 27, 68, 54, C.floorAlt);
      rect(g, spot.x - 34, spot.y - 27, 68, 2, C.bay);
      rect(g, spot.x - 34, spot.y + 25, 68, 2, C.bay);
      rect(g, spot.x - 34, spot.y - 27, 2, 54, C.bay);
      rect(g, spot.x + 32, spot.y - 27, 2, 54, C.bay);
      rect(g, spot.x - 2, spot.y - 10, 4, 20, C.bay);
      rect(g, spot.x - 8, spot.y - 2, 16, 4, C.bay);
      // 车位南沿出入导向标识
      const cy = spot.y + 30;
      rect(g, spot.x - 8, cy, 16, 2, C.bay);
      rect(g, spot.x - 4, cy + 2, 8, 2, C.bay);
    }
    // 西门分诊门槛警示垫：标识人行急救通道
    const gateX = CLINIC_RECT.x;
    const gateY = CLINIC_ACCESS_PAVING.y + 6;
    for (let i = 0; i < 4; i += 1) {
      rect(g, gateX + 2, gateY + i * 12, 8, 6, i % 2 === 0 ? C.steel : C.floorAlt);
    }
    // 站内落点用一圈淡蓝标记，救护车到这里把人交给病床
    const drop = new Graphics();
    drop.circle(CLINIC_DROP.x, CLINIC_DROP.y + 8, 26).fill({ color: 0x7fc5e4, alpha: 0.12 });
    drop.circle(CLINIC_DROP.x, CLINIC_DROP.y + 8, 26).stroke({ color: 0x7fc5e4, width: 1, alpha: 0.45 });
    base.addChild(g, drop);
  }

  private createCar(id: number): void {
    if (this.cars.has(id) || id < 1 || id > CLINIC_AMBULANCE_SPOTS.length) return;
    const car = paintAmbulance();
    const spot = CLINIC_AMBULANCE_SPOTS[id - 1]!;
    car.x = spot.x;
    car.y = spot.y;
    car.targetX = spot.x;
    car.targetY = spot.y;
    car.root.position.set(spot.x, spot.y);
    this.overlay.addChild(car.root);
    this.cars.set(id, car);
  }

  /** 两枚爱心：治疗期间挂在伤员头顶，伤员在床上 / 正在被扶上床时都跟着他 */
  private paintHearts(): Container {
    const container = new Container();
    for (let index = 0; index < CLINIC_BEDS.length; index += 1) {
      const heart = new Graphics();
      heart.circle(-3, 0, 3).fill(C.heart);
      heart.circle(3, 0, 3).fill(C.heart);
      heart.poly([-6, 1, 6, 1, 0, 8]).fill(C.heart);
      heart.circle(-2, -1, 1).fill(C.heartLight);
      heart.visible = false;
      container.addChild(heart);
      this.hearts[index] = heart;
    }
    return container;
  }

  /** 救护车同步：记录目标坐标并在 update 里平滑插值，消除低频包卡顿；大跨度传送仍直接吸附 */
  setAmbulance(packet: AmbulancePacket): void {
    if (!this.cars.has(packet.id)) this.createCar(packet.id);
    const car = this.cars.get(packet.id);
    if (!car) return;
    car.state = packet.state;
    car.flags = packet.flags;
    // 车头朝行进方向：协议不单独下发朝向，用目标坐标的横向位移推断
    if (Math.abs(packet.x - car.targetX) > 0.5) car.root.scale.x = packet.x < car.targetX ? -1 : 1;
    const dx = packet.x - car.x;
    const dy = packet.y - car.y;
    car.targetX = packet.x;
    car.targetY = packet.y;
    if (dx * dx + dy * dy > 220 * 220) {
      car.x = packet.x;
      car.y = packet.y;
      car.root.position.set(Math.round(packet.x), Math.round(packet.y));
    }
  }

  /** 伤员状态：治疗中让护士头顶冒爱心，结束后收掉 */
  setPatient(packet: PatientStatusPacket): void {
    if (packet.state === PATIENT_STATE.Treating) this.treating.add(packet.entityId);
    else this.treating.delete(packet.entityId);
  }

  update(now: number, anchorAt: (id: number) => { x: number; y: number } | null, dtMs = 16.6): void {
    const phase = beaconPhase(now);
    const blend = 1 - Math.exp(-Math.max(1, dtMs) / 95);
    for (const car of this.cars.values()) {
      const active = car.state !== AMBULANCE_STATE.Idle;
      car.red.alpha = active && phase === 0 ? 1 : BEACON_OFF_ALPHA;
      car.blue.alpha = active && phase === 1 ? 1 : BEACON_OFF_ALPHA;
      // 警灯亮起的车顶给整车上一点高光，远看能分清「出警」与「停泊」
      car.root.alpha = active && (car.flags & AMBULANCE_FLAG_SIREN) !== 0 ? 1 : 0.94;
      const dx = car.targetX - car.x;
      const dy = car.targetY - car.y;
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
        car.x += dx * blend;
        car.y += dy * blend;
      } else {
        car.x = car.targetX;
        car.y = car.targetY;
      }
      // 行驶 / 出警时的整数纹素底盘微振（0 / -1），熄火停泊稳在地面
      const bounce = active && Math.sin(now / 70) > 0.3 ? -1 : 0;
      car.root.position.set(Math.round(car.x), Math.round(car.y) + bounce);
    }

    // 红十字挂在护士实体上（ADR-0109）：她巡游、接人、守床时帽顶都跟着人走。
    // 走 keys() 而不是 entries()：后者每条都拆一个 [id, cap] 数组，帧循环里白白分配。
    for (const id of this.crosses.keys()) {
      const cap = this.crosses.get(id);
      if (!cap) continue;
      const anchor = anchorAt(id);
      cap.visible = anchor !== null;
      if (anchor) cap.position.set(Math.round(anchor.x), Math.round(anchor.y - 60));
    }

    // 爱心挂到正在被治疗的伤员头顶：上床 / 下床 tween 期间也跟着他，整数纹素呼吸漂浮
    let slot = 0;
    for (const id of this.treating) {
      if (slot >= this.hearts.length) break;
      const heart = this.hearts[slot]!;
      const anchor = anchorAt(id);
      heart.visible = anchor !== null;
      if (anchor) {
        heart.position.set(Math.round(anchor.x), Math.round(anchor.y - 66 + Math.sin(now / 260) * 2));
      }
      slot += 1;
    }
    for (; slot < this.hearts.length; slot += 1) this.hearts[slot]!.visible = false;
  }

  destroy(): void {
    this.crosses.clear();
    this.overlay.destroy({ children: true });
  }
}
