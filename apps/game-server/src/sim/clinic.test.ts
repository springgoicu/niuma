import { describe, expect, it } from 'bun:test';
import {
  AMBULANCE_PACKET_BYTES,
  CLINIC_ACCESS_PAVING,
  CLINIC_BED_SEAT_IDS,
  CLINIC_BEDS,
  CLINIC_DROP,
  CLINIC_NURSE_SPOTS,
  CLINIC_RECT,
  CLINIC_REGION_RECT,
  CLINIC_VEHICLE_ENTRY,
  DEFAULT_APPEARANCE,
  DIRECTION,
  ENTITY_ROLE_NURSE,
  JAIL_ANCHOR,
  NAV_ARRIVALS,
  OpCode,
  PATIENT_STATE,
  POSE,
  TICK_MS,
  VENT_STUN_MS,
  decodeAmbulance,
  isBlocked,
  isInClinicInterior,
  resolveWalkInto,
  seatById,
  type AmbulancePacket,
  type MotionTarget,
  type SeatStateEntry,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { AmbulanceManager } from './clinic';
import { SeatRegistry } from './seats';
import { World, type Player } from './world';

interface Harness {
  world: World;
  grid: SpatialGrid;
  seats: SeatRegistry;
  manager: AmbulanceManager;
  nurses: Player[];
}

function setup(now = 0): Harness {
  const world = new World();
  const grid = new SpatialGrid();
  const seats = new SeatRegistry();
  const manager = new AmbulanceManager({
    world,
    grid,
    transport: {
      send() {},
    },
    seats,
    broadcastSeats: () => {},
    now,
  });
  const nurses = [...world.players.values()].filter((player) => player.role === ENTITY_ROLE_NURSE);
  return { world, grid, seats, manager, nurses };
}

/** 复现一次创飞的结算结果：位移 + 倒地 + 硬直（写入方是 `sim/vent`） */
function knockDown(h: Harness, nurse: Player, now: number): void {
  nurse.x += 32;
  nurse.applyState(DIRECTION.Down, POSE.Lie, false);
  nurse.stunUntil = now + VENT_STUN_MS;
  h.grid.update(nurse.id, nurse.x, nurse.y);
}

function tick(now: number): number {
  return Math.floor(now / TICK_MS);
}

describe('护士站桩 NPC 的硬直回位（ADR-0090）', () => {
  it('按站位生成两名护士，站立朝下', () => {
    const h = setup();
    expect(h.nurses).toHaveLength(CLINIC_NURSE_SPOTS.length);
    h.nurses.forEach((nurse, index) => {
      const spot = CLINIC_NURSE_SPOTS[index]!;
      expect(nurse.x).toBe(spot.x);
      expect(nurse.y).toBe(spot.y);
      expect(nurse.pose).toBe(POSE.Idle);
      expect(nurse.direction).toBe(DIRECTION.Down);
    });
  });

  it('硬直未结束时保持倒地，不被提前扶起来', () => {
    const h = setup();
    const nurse = h.nurses[0]!;
    const knockedAt = 5_000;
    knockDown(h, nurse, knockedAt);
    const restX = nurse.x;

    h.manager.update(knockedAt + VENT_STUN_MS - 100, tick(knockedAt + VENT_STUN_MS - 100));

    expect(nurse.pose).toBe(POSE.Lie);
    expect(nurse.x).toBe(restX);
    expect(nurse.stunUntil).toBe(knockedAt + VENT_STUN_MS);
  });

  it('硬直结束就地站起来，走回站位而不是瞬移（ADR-0109）', () => {
    const h = setup();
    const nurse = h.nurses[0]!;
    const spot = CLINIC_NURSE_SPOTS[0]!;
    const knockedAt = 5_000;
    knockDown(h, nurse, knockedAt);
    expect(nurse.x).not.toBe(spot.x);

    const endedAt = knockedAt + VENT_STUN_MS;
    h.manager.update(endedAt, tick(endedAt));

    // 站起来了：不再躺姿、硬直清零，但这一拍还没回到站位
    expect(nurse.pose).not.toBe(POSE.Lie);
    expect(nurse.stunUntil).toBe(0);
    expect(nurse.dirty).toBe(true);

    // 一步一步挪回去：任何一拍都不超过步速上限（5.1px 步长 + 2px 航点吸附）
    let prevX = nurse.x;
    let prevY = nurse.y;
    let reachedAt = -1;
    for (let elapsed = TICK_MS; elapsed <= 6_000; elapsed += TICK_MS) {
      h.manager.update(endedAt + elapsed, tick(endedAt + elapsed));
      expect(Math.hypot(nurse.x - prevX, nurse.y - prevY)).toBeLessThan(8);
      prevX = nurse.x;
      prevY = nurse.y;
      // 到站就停：驻足结束后她会重新巡检，再往后断言站姿会撞上随机驻足时长
      if (nurse.x === spot.x && nurse.y === spot.y) {
        reachedAt = elapsed;
        break;
      }
    }
    expect(reachedAt).toBeGreaterThan(0);
    expect(nurse.pose).toBe(POSE.Idle);
  });

  it('两名护士各自走回自己的位置', () => {
    const h = setup();
    const [first, second] = h.nurses;
    knockDown(h, first!, 5_000);
    knockDown(h, second!, 5_000);

    const endedAt = 5_000 + VENT_STUN_MS;
    for (let elapsed = 0; elapsed <= 1_000; elapsed += TICK_MS) {
      h.manager.update(endedAt + elapsed, tick(endedAt + elapsed));
    }

    expect([first!.x, first!.y]).toEqual([CLINIC_NURSE_SPOTS[0]!.x, CLINIC_NURSE_SPOTS[0]!.y]);
    expect([second!.x, second!.y]).toEqual([CLINIC_NURSE_SPOTS[1]!.x, CLINIC_NURSE_SPOTS[1]!.y]);
  });
});

describe('护士站围挡后的救护车进站（ADR-0092）', () => {
  it('柜台背后的伤员由救护车从南侧通道口进站接起', () => {
    const world = new World();
    const grid = new SpatialGrid();
    const cars: AmbulancePacket[] = [];
    const manager = new AmbulanceManager({
      world,
      grid,
      transport: {
        send(_wsId, packet) {
          if (packet.byteLength !== AMBULANCE_PACKET_BYTES) return;
          if (packet[0] !== OpCode.S2C_AMBULANCE) return;
          cars.push(decodeAmbulance(packet));
        },
      },
      seats: new SeatRegistry(),
      broadcastSeats: () => {},
      now: 0,
    });

    const attacker = world.create('甲', DEFAULT_APPEARANCE.cow, 11, CLINIC_RECT.x + 40, CLINIC_RECT.y + 150)!;
    // 柜台背后（护士站位一侧）：正是打护士后被打倒的高频点
    const victim = world.create('乙', DEFAULT_APPEARANCE.cow, 12, CLINIC_RECT.x + 40, CLINIC_RECT.y + 80)!;
    grid.insert(attacker.id, attacker.x, attacker.y);
    grid.insert(victim.id, victim.x, victim.y);

    const downAt = 1_000;
    for (let i = 0; i < 3; i += 1) manager.observeHit(attacker, victim, downAt);
    expect(victim.incapacitated).toBe(true);

    let nearestToEntry = Infinity;
    for (let elapsed = 0; elapsed <= 20_000 && victim.carriedBy === 0; elapsed += TICK_MS) {
      manager.update(downAt + elapsed, tick(downAt + elapsed));
      for (const car of cars) {
        if (car.id !== 1) continue;
        nearestToEntry = Math.min(
          nearestToEntry,
          Math.hypot(car.x - CLINIC_VEHICLE_ENTRY.x, car.y - CLINIC_VEHICLE_ENTRY.y),
        );
      }
      cars.length = 0;
    }

    // 先到通道口再进站：没走到通道口就摸到人，说明靠的是 8 秒脱困瞬移
    expect(nearestToEntry).toBeLessThan(24);
    expect(victim.carriedBy).not.toBe(0);
  });
});

describe('NPC 进入救护链（ADR-0106）', () => {
  /** 急救站柜台背后的开阔点：与 ADR-0092 用例同址，救护车会走南侧通道口进站 */
  const SPOT = { x: CLINIC_RECT.x + 40, y: CLINIC_RECT.y + 150 };

  it('普通 NPC 被真实命中一次就昏迷，不再自己躺一下爬起来', () => {
    const h = setup();
    const npc = h.world.createNpc('同事', DEFAULT_APPEARANCE.cow, SPOT.x, SPOT.y, '', 0)!;
    h.grid.insert(npc.id, npc.x, npc.y);
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, SPOT.x + 24, SPOT.y)!;

    h.manager.observeHit(attacker, npc, 1_000);

    expect(npc.incapacitated).toBe(true);
    expect(npc.pose).toBe(POSE.Lie);
    expect(npc.patientState).toBe(PATIENT_STATE.Incapacitated);
  });

  it('倒地 NPC 走完整救护链，康复后逐帧出院到站外再续接', () => {
    const h = setup();
    const npc = h.world.createNpc('同事', DEFAULT_APPEARANCE.cow, SPOT.x, SPOT.y, '', 0)!;
    h.grid.insert(npc.id, npc.x, npc.y);
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, SPOT.x + 24, SPOT.y)!;

    // 端口只收 id 与时钟：康复坐标由 clinic 先写好在床尾（ADR-0109）
    const restored: Array<{ id: number; x: number; y: number }> = [];
    h.manager.setNpcRecovery({
      restore(playerId) {
        restored.push({ id: playerId, x: npc.x, y: npc.y });
        return true;
      },
    });

    const downAt = 1_000;
    h.manager.observeHit(attacker, npc, downAt);
    expect(npc.incapacitated).toBe(true);

    // 出警要绕行东主路，往返 + 治疗约 25 秒；给足 45 秒避免随机驻足导致偶发失败
    for (let elapsed = 0; elapsed <= 45_000 && restored.length === 0; elapsed += TICK_MS) {
      h.manager.update(downAt + elapsed, tick(downAt + elapsed));
    }

    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(npc.id);
    // ADR-0117：康复点在站外铺装，交还巡逻时人已走出站体（不再停在床尾）
    const at = restored[0]!;
    expect(Math.hypot(at.x - SPOT.x, at.y - SPOT.y)).toBeGreaterThan(60);
    expect(isInClinicInterior(at.x, at.y)).toBe(false);
    expect(at.x).toBeLessThan(CLINIC_RECT.x);
    expect(npc.incapacitated).toBe(false);
    expect(npc.patientState).toBe(PATIENT_STATE.Shielded);
  });

  it('护士被打倒后先送医，硬直结束不会被自动回位偷走', () => {
    const h = setup();
    const nurse = h.nurses[0]!;
    const spot = CLINIC_NURSE_SPOTS[0]!;
    // 模拟 vent 的击退：先离开站位 32px 再倒地
    nurse.x += 32;
    h.grid.update(nurse.id, nurse.x, nurse.y);
    const restX = nurse.x;
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, restX + 24, nurse.y)!;

    h.manager.observeHit(attacker, nurse, 1_000);
    expect(nurse.incapacitated).toBe(true);

    const afterStun = 1_000 + VENT_STUN_MS + 100;
    h.manager.update(afterStun, tick(afterStun));

    expect(nurse.incapacitated).toBe(true);
    expect(nurse.pose).toBe(POSE.Lie);
    expect(nurse.x).toBe(restX);
    expect(nurse.x).not.toBe(spot.x);
  });

  it('真人仍是 15 秒内 3 次才昏迷：一击即倒只对 NPC 生效', () => {
    const h = setup();
    const victim = h.world.create('乙', DEFAULT_APPEARANCE.cow, 12, SPOT.x, SPOT.y)!;
    h.grid.insert(victim.id, victim.x, victim.y);
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 13, SPOT.x + 24, SPOT.y)!;

    h.manager.observeHit(attacker, victim, 1_000);
    h.manager.observeHit(attacker, victim, 1_500);
    expect(victim.incapacitated).toBe(false);

    h.manager.observeHit(attacker, victim, 2_000);
    expect(victim.incapacitated).toBe(true);
  });
});

describe('两张床都满时的站内地面治疗（ADR-0107）', () => {
  it('第三名伤员在落点治好后被护送出站，出去的瞬间才恢复门禁', () => {
    const h = setup();
    // 两张床先被别的伤员占住：床位是唯一权威，`admit` 只能看见「没有空床」
    const seatChanges: SeatStateEntry[] = [];
    for (const seatId of CLINIC_BED_SEAT_IDS) {
      const occupant = h.world.create('床位伤员', DEFAULT_APPEARANCE.cow, 12, CLINIC_DROP.x, CLINIC_DROP.y)!;
      h.grid.insert(occupant.id, occupant.x, occupant.y);
      h.seats.occupy(occupant, seatById(seatId)!, 0, seatChanges);
    }
    expect(seatChanges).toHaveLength(CLINIC_BED_SEAT_IDS.length);

    const victim = h.world.create('丙', DEFAULT_APPEARANCE.cow, 12, CLINIC_RECT.x + 40, CLINIC_RECT.y + 150)!;
    h.grid.insert(victim.id, victim.x, victim.y);
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 13, victim.x + 24, victim.y)!;

    const downAt = 1_000;
    for (let i = 0; i < 3; i += 1) h.manager.observeHit(attacker, victim, downAt);
    expect(victim.incapacitated).toBe(true);

    // 记录「落点地面开始治疗」的那一刻：没有床位就该停在车尾附近
    let treatPos: { x: number; y: number } | null = null;
    // 现在要等护士从站内走过来接手，出警 + 交接比旧的直接入床多几秒
    for (let elapsed = 0; elapsed <= 50_000 && victim.patientState !== PATIENT_STATE.Shielded; elapsed += TICK_MS) {
      h.manager.update(downAt + elapsed, tick(downAt + elapsed));
      if (!treatPos && victim.patientState === PATIENT_STATE.Treating && victim.carriedBy === 0) {
        treatPos = { x: victim.x, y: victim.y };
      }
    }

    expect(treatPos).not.toBeNull();
    // 满员时也占不到座位：seat 保持 0，治疗只走计时
    expect(victim.seat).toBe(0);
    expect(Math.hypot(treatPos!.x - CLINIC_DROP.x, treatPos!.y - CLINIC_DROP.y)).toBeLessThan(48);
    expect(isInClinicInterior(treatPos!.x, treatPos!.y)).toBe(true);

    // ADR-0117：治好不再停在落点，而是由系统逐帧护送出站；发护盾时人已在站外
    expect(victim.patientState).toBe(PATIENT_STATE.Shielded);
    expect(victim.incapacitated).toBe(false);
    expect(victim.seat).toBe(0);
    expect(isInClinicInterior(victim.x, victim.y)).toBe(false);
    expect(victim.x).toBeLessThan(CLINIC_RECT.x);

    // 出去以后门禁重新生效：同一把尺只挡向内
    const motion: MotionTarget = { x: 0, y: 0 };
    resolveWalkInto(motion, victim.x, victim.y, victim.x + 12, victim.y);
    expect(isInClinicInterior(motion.x, motion.y)).toBe(false);
    expect(motion.x).toBeLessThanOrEqual(CLINIC_RECT.x);
  });
});

describe('护士值守与护送交接（ADR-0109）', () => {
  /** 与 ADR-0092 同址：柜台背面，救护车走南侧通道口进站 */
  const SPOT = { x: CLINIC_RECT.x + 40, y: CLINIC_RECT.y + 150 };

  /** 打三下把真人打倒，返回打手与伤员 */
  function knockOut(h: Harness, at: number): { attacker: Player; victim: Player } {
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 11, SPOT.x + 24, SPOT.y)!;
    const victim = h.world.create('乙', DEFAULT_APPEARANCE.cow, 12, SPOT.x, SPOT.y)!;
    h.grid.insert(attacker.id, attacker.x, attacker.y);
    h.grid.insert(victim.id, victim.x, victim.y);
    for (let i = 0; i < 3; i += 1) h.manager.observeHit(attacker, victim, at);
    return { attacker, victim };
  }

  it('从倒地到康复，护士接手的每一帧位移都不超过一记瞬移', () => {
    const h = setup();
    const { victim } = knockOut(h, 1_000);

    let prevX = victim.x;
    let prevY = victim.y;
    let worst = 0;
    let pickedAtDrop = false;
    let draggedToBed = false;
    let closestNurse = Infinity;

    for (let elapsed = 0; elapsed <= 40_000; elapsed += TICK_MS) {
      const wasCarried = victim.carriedBy !== 0;
      h.manager.update(1_000 + elapsed, tick(1_000 + elapsed));
      // 车尾挂人与 8 秒脱困是 ADR-0097 的既有兜底，不归 ADR-0109 管：
      // 只有「伤员已经交到护士手上」的每一帧才要求连续位移。
      if (!wasCarried && victim.carriedBy === 0) {
        worst = Math.max(worst, Math.hypot(victim.x - prevX, victim.y - prevY));
      }
      prevX = victim.x;
      prevY = victim.y;
      if (victim.patientState === PATIENT_STATE.Shielded && elapsed > 4_000) break;

      // 从接人开始统计：护士拖行、扶上床、下床都是逐 Tick 位移
      if (victim.carriedBy !== 0 || victim.seat !== 0) continue;
      if (victim.patientState !== PATIENT_STATE.Incapacitated) continue;
      // 车尾停在落点正下方 26px，再加上 6px 到达容差
      if (Math.hypot(victim.x - CLINIC_DROP.x, victim.y - CLINIC_DROP.y) < 40) pickedAtDrop = true;
      if (victim.x > CLINIC_DROP.x + 45) draggedToBed = true;
      for (const nurse of h.nurses) {
        closestNurse = Math.min(closestNurse, Math.hypot(nurse.x - victim.x, nurse.y - victim.y));
      }
    }

    // 旧路径把人从落点吸到床心（约 74px）会直接超过这条线
    expect(worst).toBeLessThan(60);
    // 护士确实在落点接人、随后把人拖到床侧，而不是直接入床
    expect(pickedAtDrop).toBe(true);
    expect(draggedToBed).toBe(true);
    expect(closestNurse).toBeLessThan(28);
    expect(victim.patientState).toBe(PATIENT_STATE.Shielded);
    // ADR-0117：逐帧出院在发护盾前已完成，此刻人在站外；且出院本身也已计入 worst < 60
    expect(isInClinicInterior(victim.x, victim.y)).toBe(false);
  });

  it('两名护士都在昏迷时退回直接入床，救护链不卡死', () => {
    const h = setup();
    for (const nurse of h.nurses) {
      nurse.incapacitated = true;
      nurse.applyState(DIRECTION.Down, POSE.Lie, false);
    }
    const { victim } = knockOut(h, 1_000);

    let seated = false;
    // 旧路径也要等出警 + 绕行 + 治疗，给足 40 秒；25 秒在随机驻足里不够
    for (let elapsed = 0; elapsed <= 40_000; elapsed += TICK_MS) {
      h.manager.update(1_000 + elapsed, tick(1_000 + elapsed));
      if (victim.seat !== 0) seated = true;
      if (victim.patientState === PATIENT_STATE.Shielded && elapsed > 2_000) break;
    }

    expect(seated).toBe(true);
    expect(victim.patientState).toBe(PATIENT_STATE.Shielded);
  });

  it('护士护送途中被打倒，伤员重新入队并最终治好', () => {
    const h = setup();
    const { attacker, victim } = knockOut(h, 1_000);

    let carried = false;
    let handedOver = false;
    let knocked = false;
    let knockedAt = 0;
    let healedAt = 0;
    let prevCarried = victim.carriedBy;

    for (let elapsed = 0; elapsed <= 70_000; elapsed += TICK_MS) {
      const now = 1_000 + elapsed;
      h.manager.update(now, tick(now));
      if (victim.carriedBy !== 0) carried = true;
      if (victim.patientState === PATIENT_STATE.Shielded) {
        healedAt = now;
        break;
      }
      // 交接那一拍：car' 把 carriedBy 清 0，伤员刚开始由护士拖行
      if (prevCarried !== 0 && victim.carriedBy === 0 && victim.incapacitated && victim.seat === 0) {
        handedOver = true;
      }
      prevCarried = victim.carriedBy;
      if (knocked || !handedOver) continue;
      // 护送中的护士恒定在伤员东侧 22px（拖行方向朝床）：按这个相对位置认人；
      // 只挑「最近的护士」会误伤恰好路过落点的巡游护士。
      const nurse = h.nurses.find(
        (candidate) =>
          !candidate.incapacitated && candidate.x - victim.x >= 18 && Math.abs(candidate.y - victim.y) <= 2,
      );
      if (!nurse) continue;
      h.manager.observeHit(attacker, nurse, now);
      knocked = true;
      knockedAt = now;
    }

    expect(knocked).toBe(true);
    // 被打倒的护士先把伤员扔回地面：不是立刻入床，而是重新排队 / 再派车
    expect(healedAt - knockedAt).toBeGreaterThan(1_000);
    // 伤员不会被一个趴下的护士拖到天涯海角：要么重新派车，要么排队超时就地包扎
    expect(healedAt).toBeGreaterThan(0);
    expect(victim.patientState).toBe(PATIENT_STATE.Shielded);
  });
});

describe('康复者逐帧出院（ADR-0117）', () => {
  const SPOT = { x: CLINIC_RECT.x + 40, y: CLINIC_RECT.y + 150 };

  function knockOut(h: Harness, at: number): { attacker: Player; victim: Player } {
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 11, SPOT.x + 24, SPOT.y)!;
    const victim = h.world.create('乙', DEFAULT_APPEARANCE.cow, 12, SPOT.x, SPOT.y)!;
    h.grid.insert(attacker.id, attacker.x, attacker.y);
    h.grid.insert(victim.id, victim.x, victim.y);
    for (let i = 0; i < 3; i += 1) h.manager.observeHit(attacker, victim, at);
    return { attacker, victim };
  }

  it('真人治好后逐帧走出急救站，站外才发护盾', () => {
    const h = setup();
    const { victim } = knockOut(h, 1_000);
    let prevX = victim.x;
    let prevY = victim.y;
    let worst = 0;
    let shieldedAt: { x: number; y: number } | null = null;

    for (let elapsed = 0; elapsed <= 45_000; elapsed += TICK_MS) {
      const now = 1_000 + elapsed;
      h.manager.update(now, tick(now));
      // 车载段的脱困瞬移是 ADR-0097 既有兜底，不归出院管；其余每帧都要连续
      if (victim.carriedBy === 0) {
        worst = Math.max(worst, Math.hypot(victim.x - prevX, victim.y - prevY));
      }
      prevX = victim.x;
      prevY = victim.y;
      if (victim.patientState === PATIENT_STATE.Shielded) {
        shieldedAt = { x: victim.x, y: victim.y };
        break;
      }
    }

    expect(shieldedAt).not.toBeNull();
    expect(worst).toBeLessThan(60);
    // 护盾是在人走到站外之后才发的：发护盾那一刻人已不在站内
    expect(isInClinicInterior(shieldedAt!.x, shieldedAt!.y)).toBe(false);
    expect(shieldedAt!.x).toBeLessThan(CLINIC_RECT.x);
    expect(victim.incapacitated).toBe(false);
  });

  it('NPC 治好后逐帧走出急救站，交还巡逻时人已在站外', () => {
    const h = setup();
    const npc = h.world.createNpc('同事', DEFAULT_APPEARANCE.cow, SPOT.x, SPOT.y, '', 0)!;
    h.grid.insert(npc.id, npc.x, npc.y);
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, SPOT.x + 24, SPOT.y)!;
    const restored: Array<{ x: number; y: number }> = [];
    h.manager.setNpcRecovery({
      restore(playerId) {
        const p = h.world.get(playerId)!;
        restored.push({ x: p.x, y: p.y });
        return true;
      },
    });
    const downAt = 1_000;
    h.manager.observeHit(attacker, npc, downAt);

    let worst = 0;
    let prevX = npc.x;
    let prevY = npc.y;
    for (let elapsed = 0; elapsed <= 45_000 && restored.length === 0; elapsed += TICK_MS) {
      const now = downAt + elapsed;
      h.manager.update(now, tick(now));
      if (npc.carriedBy === 0) {
        worst = Math.max(worst, Math.hypot(npc.x - prevX, npc.y - prevY));
      }
      prevX = npc.x;
      prevY = npc.y;
    }

    expect(restored).toHaveLength(1);
    expect(worst).toBeLessThan(60);
    expect(isInClinicInterior(restored[0]!.x, restored[0]!.y)).toBe(false);
    expect(restored[0]!.x).toBeLessThan(CLINIC_RECT.x);
    expect(npc.patientState).toBe(PATIENT_STATE.Shielded);
  });
});

describe('排队出警与开服清场（ADR-0114）', () => {
  /** 急救站柜台背后的开阔点：与 ADR-0092 用例同址，救护车会走南侧通道口进站 */
  const SPOT = { x: CLINIC_RECT.x + 40, y: CLINIC_RECT.y + 150 };

  /** 站内一起打倒三名 NPC：前两名各占一辆车，第三名只能排队 */
  function downThree(h: Harness, attacker: Player, at: number): Player[] {
    const victims = [0, 1, 2].map((index) => {
      const npc = h.world.createNpc(`同事${index}`, DEFAULT_APPEARANCE.cow, SPOT.x + index * 6, SPOT.y, '', 0)!;
      h.grid.insert(npc.id, npc.x, npc.y);
      return npc;
    });
    for (const victim of victims) h.manager.observeHit(attacker, victim, at);
    return victims;
  }

  it('两辆车都忙时，排队的 NPC 不会在 6 秒兜底里自己站起来', () => {
    const h = setup();
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, SPOT.x + 24, SPOT.y)!;
    const restored: number[] = [];
    h.manager.setNpcRecovery({
      restore(playerId) {
        restored.push(playerId);
        return true;
      },
    });

    const downAt = 1_000;
    const victims = downThree(h, attacker, downAt);
    expect(victims[2]!.incapacitated).toBe(true);

    // 6.5 秒：真人兜底的 6 秒口径已经过了，NPC 必须还在队列里等车
    for (let now = downAt; now <= downAt + 6_500; now += TICK_MS) {
      h.manager.update(now, tick(now));
    }
    expect(victims[2]!.incapacitated).toBe(true);
    expect(victims[2]!.pose).toBe(POSE.Lie);
    expect(restored).toHaveLength(0);

    // 空车一回来就接走：第三名照样走完救护链，不会烂在地上
    for (let elapsed = 6_500; elapsed <= 70_000 && restored.length < 3; elapsed += TICK_MS) {
      const now = downAt + elapsed;
      h.manager.update(now, tick(now));
    }
    expect(restored).toHaveLength(3);
    expect(restored).toContain(victims[2]!.id);
  });

  it('真人两辆车都忙时仍然 6 秒就地包扎，不卡在无限等待里', () => {
    const h = setup();
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, SPOT.x + 24, SPOT.y)!;
    downThree(h, attacker, 1_000);

    const human = h.world.create('路人', DEFAULT_APPEARANCE.cow, 13, SPOT.x + 6, SPOT.y + 40)!;
    h.grid.insert(human.id, human.x, human.y);
    const downAt = 3_000;
    for (let index = 0; index < 3; index += 1) h.manager.observeHit(attacker, human, downAt + index * 400);
    expect(human.incapacitated).toBe(true);

    for (let now = downAt + 800; now <= downAt + 8_000; now += TICK_MS) {
      h.manager.update(now, tick(now));
    }
    expect(human.incapacitated).toBe(false);
    expect(human.patientState).toBe(PATIENT_STATE.Shielded);
  });

  it('开服清场把站内除护士外的实体移到西门外的站外', () => {
    const h = setup();
    const inside = { x: CLINIC_RECT.x + 40, y: CLINIC_RECT.y + 150 };
    const npc = h.world.createNpc('同事', DEFAULT_APPEARANCE.cow, inside.x, inside.y, '', 0)!;
    h.grid.insert(npc.id, npc.x, npc.y);
    const human = h.world.create('路人', DEFAULT_APPEARANCE.cow, 12, inside.x + 60, inside.y)!;
    h.grid.insert(human.id, human.x, human.y);
    const nurse = h.nurses[0]!;
    const nurseX = nurse.x;
    const nurseY = nurse.y;
    const restored: number[] = [];
    h.manager.setNpcRecovery({
      restore(playerId) {
        restored.push(playerId);
        return true;
      },
    });

    expect(h.manager.evictIntruders(1_000)).toBe(2);

    expect(isInClinicInterior(npc.x, npc.y)).toBe(false);
    expect(isInClinicInterior(human.x, human.y)).toBe(false);
    // 落点在西门外铺装再往西 60px：出站了，但还在服务广场视野里
    expect(npc.x).toBeLessThan(CLINIC_ACCESS_PAVING.x - 20);
    expect(human.x).toBeLessThan(CLINIC_ACCESS_PAVING.x - 20);
    expect(npc.pose).toBe(POSE.Idle);
    expect(human.pose).toBe(POSE.Idle);
    // NPC 的行为态跟着新坐标重新锚定
    expect(restored).toEqual([npc.id]);
    // 站内唯一的常驻者护士原地不动
    expect(nurse.x).toBe(nurseX);
    expect(nurse.y).toBe(nurseY);
  });

  it('正在治疗的床位伤员留在站内，清场不跟急救链抢人', () => {
    const h = setup();
    // 打人的站在站外，站内只剩护士、医生与急救链正在管的人
    const attacker = h.world.create('甲', DEFAULT_APPEARANCE.cow, 12, CLINIC_REGION_RECT.x - 80, SPOT.y)!;
    const npc = h.world.createNpc('同事', DEFAULT_APPEARANCE.cow, SPOT.x, SPOT.y, '', 0)!;
    h.grid.insert(npc.id, npc.x, npc.y);
    h.manager.setNpcRecovery({ restore: () => true });
    h.manager.observeHit(attacker, npc, 1_000);

    let treatingAt = 0;
    for (let elapsed = 0; elapsed <= 45_000; elapsed += TICK_MS) {
      const now = 1_000 + elapsed;
      h.manager.update(now, tick(now));
      if (npc.patientState === PATIENT_STATE.Treating) {
        treatingAt = now;
        break;
      }
    }
    expect(treatingAt).toBeGreaterThan(0);
    const bedX = npc.x;
    const bedY = npc.y;

    expect(h.manager.evictIntruders(treatingAt)).toBe(0);
    expect(npc.x).toBe(bedX);
    expect(npc.y).toBe(bedY);
    expect(npc.incapacitated).toBe(true);
  });
});

/**
 * 跨场所出警回归（ADR-0115）：伤员倒在围合场所内时，救护车必须寻路穿过门洞开进去接人，
 * 而不是直线顶墙、8 秒后盲瞬移落进墙里反复弹。旧实现会在这里卡死或永远接不到人。
 */
describe('救护车跨场所出警（ADR-0115）', () => {
  const CASES = [
    { name: '小黑屋', spot: { x: JAIL_ANCHOR.x, y: JAIL_ANCHOR.y } },
    { name: '卫生间', spot: { x: NAV_ARRIVALS.restroom.x, y: NAV_ARRIVALS.restroom.y } },
  ] as const;

  for (const scene of CASES) {
    it(`倒在${scene.name}内的伤员被车开进去接起，全程无瞬移并最终治愈`, () => {
      expect(isBlocked(scene.spot.x, scene.spot.y), `${scene.name}倒地点本身应在空地`).toBe(false);
      const world = new World();
      const grid = new SpatialGrid();
      const cars: AmbulancePacket[] = [];
      const manager = new AmbulanceManager({
        world,
        grid,
        transport: {
          send(_wsId, packet) {
            if (packet.byteLength !== AMBULANCE_PACKET_BYTES) return;
            if (packet[0] !== OpCode.S2C_AMBULANCE) return;
            cars.push(decodeAmbulance(packet));
          },
        },
        seats: new SeatRegistry(),
        broadcastSeats: () => {},
        now: 0,
      });

      const attacker = world.create('甲', DEFAULT_APPEARANCE.cow, 11, scene.spot.x + 24, scene.spot.y)!;
      const victim = world.create('乙', DEFAULT_APPEARANCE.cow, 12, scene.spot.x, scene.spot.y)!;
      grid.insert(attacker.id, attacker.x, attacker.y);
      grid.insert(victim.id, victim.x, victim.y);

      const downAt = 1_000;
      for (let i = 0; i < 3; i += 1) manager.observeHit(attacker, victim, downAt);
      expect(victim.incapacitated).toBe(true);

      let prevCar: { x: number; y: number } | null = null;
      /** 接人前车的最大单帧位移：寻路逐点推进很小，旧实现的 8 秒盲瞬移是几百 px */
      let maxJumpBeforePickup = 0;
      let pickedUp = false;
      let healed = false;
      let prevCarried = victim.carriedBy;
      for (let elapsed = 0; elapsed <= 90_000 && !healed; elapsed += TICK_MS) {
        const now = downAt + elapsed;
        manager.update(now, tick(now));
        const car = cars.filter((packet) => packet.id === 1).at(-1);
        if (car) {
          if (!pickedUp && prevCar) {
            maxJumpBeforePickup = Math.max(
              maxJumpBeforePickup,
              Math.hypot(car.x - prevCar.x, car.y - prevCar.y),
            );
          }
          prevCar = { x: car.x, y: car.y };
        }
        if (prevCarried === 0 && victim.carriedBy !== 0) pickedUp = true;
        prevCarried = victim.carriedBy;
        if (victim.patientState === PATIENT_STATE.Shielded) healed = true;
      }

      // 不卡墙的可观测行为：人被接起、最终治愈，且接人全程车没有瞬移跳变
      expect(pickedUp, `${scene.name}的伤员应被救护车接起`).toBe(true);
      expect(maxJumpBeforePickup, `${scene.name}接人时车出现瞬移跳变（卡墙后盲瞬移）`).toBeLessThan(120);
      expect(healed, `${scene.name}的伤员应最终治愈`).toBe(true);
      expect(victim.patientState).toBe(PATIENT_STATE.Shielded);
    });
  }
});
