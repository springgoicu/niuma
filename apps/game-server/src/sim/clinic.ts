import {
  AMBULANCE_FLAG_CARRYING,
  AMBULANCE_FLAG_SIREN,
  AMBULANCE_STATE,
  CLINIC_AMBULANCE_SPOTS,
  CLINIC_BED_SEAT_IDS,
  CLINIC_BEDS,
  CLINIC_DROP,
  CLINIC_NURSE_SPOTS,
  CLINIC_RECT,
  CLINIC_REGION_RECT,
  CLINIC_VEHICLE_ENTRY,
  DIRECTION,
  ENTITY_ROLE_NURSE,
  MOVE_SPEED,
  PATIENT_STATE,
  PLAZA_CENTER,
  POSE,
  SERVICE_SQUARE,
  TICK_MS,
  clampWorldX,
  clampWorldY,
  encodeAmbulance,
  encodePatientStatus,
  quantizeCoord,
  rectContains,
  resolveMotionInto,
  seatById,
  type AmbulancePacket,
  type AmbulanceState,
  type CharacterAppearance,
  type MotionTarget,
  type PatientState,
  type SeatStateEntry,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { SeatRegistry } from './seats';
import type { Player, World } from './world';
import type { Transport } from './view';

/** 出警速度：玩家常速的 1.6 倍 */
const AMBULANCE_SPEED = MOVE_SPEED * 1.6;
/** 抵达判定：目标 48px 内即可挂人；救护车不必压到玩家脚底 */
const PICKUP_RADIUS = 48;
/** 送回落点判定：车位 / 站内落点 64px 内开始交床 */
const DROP_RADIUS = 64;
/** 出警 / 返航的防卡死上限：超过就瞬时脱困 */
const UNSTUCK_MS = 8000;
/**
 * 出警 / 送回的固定绕行航点（不做寻路，ADR-0097）：
 * 先穿服务广场南沿，再走东主路进中央广场，避开急救站围挡与公寓楼群。
 */
const AMBULANCE_EAST_GATE = { x: CLINIC_RECT.x + CLINIC_RECT.w / 2, y: SERVICE_SQUARE.y + SERVICE_SQUARE.h - 40 } as const;
const AMBULANCE_ROAD_GATE = { x: PLAZA_CENTER.x + 320, y: PLAZA_CENTER.y } as const;
/** 两辆都在任务时，新伤员最多在内存队列里等 6 秒 */
const QUEUE_TIMEOUT_MS = 6000;
/** 病床治疗时长 */
const TREATMENT_MS = 3000;
/** 治愈后的工伤保护 */
const IMMUNITY_MS = 15000;
const IMMUNITY_TICKS = 300;
/** 连续受击判定窗口：15 秒（300 Tick） */
const HIT_WINDOW_TICKS = 300;
/** 3 次命中触发昏迷 */
const HITS_TO_DOWN = 3;

const MOTION: MotionTarget = { x: 0, y: 0 };

/**
 * 护士外观：白马 + 白护士帽 + 烈焰红唇。
 *
 * 红唇走 `snout` 色槽而不是新图层：马吻本身是整块像素色块，刷成高饱和红
 * 就是图集里能稳定读出的「红唇」；帽体走 headwear 纯白，红十字由客户端
 * 急救站渲染层按固定护士坐标叠上去。
 */
const NURSE_APPEARANCE: CharacterAppearance = {
  species: 'horse',
  colors: {
    body: 0xf6efe8,
    pattern: 0xe8d9d0,
    hoof: 0x8a7a72,
    eyes: 0x241a20,
    extra: 0x6b4a3a,
    snout: 0xe11d48,
    tail: 0xf1dfd4,
    headwear: 0xffffff,
    eyewear: 0x2b2126,
    neckwear: 0xffffff,
    hairstyle: 0x6b4a3a,
  },
  parts: { patternId: 0, snoutId: 1, maneId: 1, tailId: 0 },
  cosmetics: { headwear: 'nurse_cap', eyewear: 'round' },
};

interface Ambulance {
  id: number;
  state: AmbulanceState;
  x: number;
  y: number;
  /** 被拖拽的玩家 id；0 表示空车 */
  targetId: number;
  /** 出警起始时刻，用于 8 秒脱困 */
  phaseAt: number;
  /** 绕行航段：0 东侧空地 → 1 南向主路 → 2 追人 / 回站（站内伤员改走 3：南侧通道口再追人） */
  leg: number;
  /** 最后一次有意义的移动方向，用于把伤员挂在车尾 */
  dirX: number;
  dirY: number;
  lastSentState: number;
  lastSentQx: number;
  lastSentQy: number;
}

interface BedStay {
  playerId: number;
  seatId: number;
  endsAt: number;
}

interface Waiting {
  playerId: number;
  since: number;
}

export interface ClinicOptions {
  world: World;
  grid: SpatialGrid;
  transport: Transport;
  seats: SeatRegistry;
  broadcastSeats: (changes: readonly SeatStateEntry[]) => void;
  /** 构造时刻（服务端时钟）：护士 NPC 的创建时间与挥手排期都以它为准 */
  now: number;
}

/**
 * 园区急救调度器（ADR-0084）。
 *
 * 只活在进程内存：四态救护车、等待队列、病床治疗与工伤保护都不落盘。
 * 移动复用 `resolveMotionInto`，因此墙体、柜台和床沿对救护车同样有效；
 * 8 秒脱困是最后一道保险，任何几何卡死都不会把伤员永久锁在地上。
 */
/**
 * 康复后把 NPC 交还给 npc 层（ADR-0106）。
 *
 * clinic 只负责调度与康复，不碰巡逻 / 押送状态机，因此用这个窄端口把
 * 「写回倒地位置 + 续接任务」交还 `npc/director`；端口未注入时就地站起兜底。
 */
export interface NpcRestorePort {
  /** spot 是倒地瞬间记录的坐标；返回 false 表示这个实体不由 npc 层管理 */
  restore(playerId: number, spot: { x: number; y: number }, now: number): boolean;
}

export class AmbulanceManager {
  private readonly world: World;
  private readonly grid: SpatialGrid;
  private readonly transport: Transport;
  private readonly seats: SeatRegistry;
  private readonly broadcastSeats: ClinicOptions['broadcastSeats'];
  private readonly cars: Ambulance[] = [
    this.makeCar(1, 0),
    this.makeCar(2, 1),
  ];
  private readonly waiting: Waiting[] = [];
  private readonly beds = new Map<number, BedStay>();
  /** 护盾到期广播的截止时刻 */
  private readonly shieldUntil = new Map<number, number>();
  private readonly nurses: Player[] = [];
  /** 与 `nurses` 同步下标的站位号：某个护士没生成出来也不会把别人放错位 */
  private readonly nurseSpots: number[] = [];
  private readonly nurseNextWave = [0, 0];
  private nurseWaveUntil = 0;
  /**
   * NPC 伤员倒地瞬间的坐标：治疗结束后从这里继续原来的巡逻 / 押送。
   *
   * 护士不进来：她们有固定站位，直接走 `resetNurse`。
   */
  private readonly npcReturn = new Map<number, { x: number; y: number }>();
  /** 康复归位端口；`server` 在 npc 层创建之后注入（clinic 构造更早） */
  private recovery: NpcRestorePort | null = null;
  private seq = 0;

  constructor(options: ClinicOptions) {
    this.world = options.world;
    this.grid = options.grid;
    this.transport = options.transport;
    this.seats = options.seats;
    this.broadcastSeats = options.broadcastSeats;
    this.spawnNurses(options.now);
  }

  private makeCar(id: number, spot: number): Ambulance {
    const point = CLINIC_AMBULANCE_SPOTS[spot]!;
    return {
      id,
      state: AMBULANCE_STATE.Idle,
      x: point.x,
      y: point.y,
      targetId: 0,
      phaseAt: 0,
      leg: 0,
      dirX: 0,
      dirY: 1,
      lastSentState: -1,
      lastSentQx: -1,
      lastSentQy: -1,
    };
  }

  // ---------------------------------------------------------------------------
  // 护士站固定 NPC
  // ---------------------------------------------------------------------------

  private spawnNurses(now: number): void {
    CLINIC_NURSE_SPOTS.forEach((spot, index) => {
      const nurse = this.world.createNpc(
        '值班护士',
        NURSE_APPEARANCE,
        spot.x,
        spot.y,
        index === 0 ? '护士站·分诊台' : '护士站·急救备勤',
        now,
        undefined,
        ENTITY_ROLE_NURSE,
      );
      if (!nurse) return;
      nurse.applyState(DIRECTION.Down, POSE.Idle, false);
      this.grid.insert(nurse.id, nurse.x, nurse.y);
      this.nurseNextWave[index] = now + 2000 + index * 1800;
      this.nurses.push(nurse);
      this.nurseSpots.push(index);
    });
  }

  // ---------------------------------------------------------------------------
  // 受击计数与触发
  // ---------------------------------------------------------------------------

  /** 注入 NPC 康复归位端口：`server` 在 npc 层创建之后调用一次 */
  setNpcRecovery(port: NpcRestorePort | null): void {
    this.recovery = port;
  }

  /**
   * 由 `resolveVents` 的命中观察者调用：只处理擂台外的真实命中。
   *
   * 免疫期内不计数（`resolveVents` 会先把这一下判成空放）；
   * 15 秒没有新命中则从 1 重新起算，避免「三次小磕碰跨半小时还算工伤」。
   *
   * NPC 一击即倒（ADR-0106）：园区里任何角色被打倒都要走救护链，
   * 否则打同事、保安、护士只会看到「躺一下又站起来」。真人仍保留
   * 15 秒 3 次的累计手感，避免混战时被一拳放倒。
   */
  observeHit(attacker: Player, target: Player, now: number): void {
    if (target.incapacitated) return;
    if (now < target.immunityUntilMs) return;

    if (target.isNpc) {
      this.downPlayer(target, now);
      return;
    }

    const tick = Math.floor(now / TICK_MS);
    if (tick - target.lastHitTick > HIT_WINDOW_TICKS) target.recentHits = 1;
    else target.recentHits += 1;
    target.lastHitTick = tick;

    if (target.recentHits >= HITS_TO_DOWN) this.downPlayer(target, now);
  }

  private downPlayer(player: Player, now: number): void {
    player.recentHits = 0;
    // NPC 记下倒地瞬间的位置：治疗结束从这里续接巡逻 / 押送（护士走固定站位）
    if (player.isNpc && player.role !== ENTITY_ROLE_NURSE) {
      this.npcReturn.set(player.id, { x: player.x, y: player.y });
    }
    player.incapacitated = true;
    player.carriedBy = 0;
    player.patientState = PATIENT_STATE.Incapacitated;
    player.patientUntil = 0;
    player.vent = false;
    player.ventPending = false;
    player.applyState(player.direction, POSE.Lie, false);
    player.dirty = true;

    if (player.seat !== 0) {
      const changes: SeatStateEntry[] = [];
      this.seats.release(player, changes);
      this.broadcastSeats(changes);
    }
    this.grid.update(player.id, player.x, player.y);
    this.broadcastPatient(player, PATIENT_STATE.Incapacitated, 0);

    const waiting: Waiting = { playerId: player.id, since: now };
    if (!this.tryDispatch(player, now)) this.waiting.push(waiting);
  }

  // ---------------------------------------------------------------------------
  // 调度
  // ---------------------------------------------------------------------------

  private tryDispatch(player: Player, now: number): boolean {
    const car = this.cars.find((candidate) => candidate.state === AMBULANCE_STATE.Idle);
    if (!car) return false;
    car.state = AMBULANCE_STATE.Dispatched;
    car.targetId = player.id;
    car.leg = 0;
    car.phaseAt = now;
    return true;
  }

  /** 新连接入场时补发两辆车的当前位置与所有在途伤员状态 */
  sendSnapshot(wsId: number, now: number): void {
    for (const car of this.cars) {
      this.transport.send(wsId, this.ambulancePacket(car));
    }
    for (const player of this.world.players.values()) {
      if (player.patientState === PATIENT_STATE.None) continue;
      const seconds =
        player.patientState === PATIENT_STATE.Treating
          ? Math.max(0, Math.ceil((player.patientUntil - now) / 1000))
          : player.patientState === PATIENT_STATE.Shielded
            ? Math.max(0, Math.ceil((player.immunityUntilMs - now) / 1000))
            : 0;
      this.transport.send(
        wsId,
        encodePatientStatus({ entityId: player.id, state: player.patientState, seconds }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 每 Tick 推进
  // ---------------------------------------------------------------------------

  update(now: number, tick: number): void {
    this.advanceNurses(now);
    this.advanceQueue(now, tick);
    for (const car of this.cars) this.advanceCar(car, now);
    this.advanceBeds(now, tick);
    this.advanceShields(now);
    this.broadcastCars();
  }

  private advanceQueue(now: number, tick: number): void {
    // 从队首推进：先昏迷的伤员先上车，不能因为倒序遍历让后来者插队
    for (let i = 0; i < this.waiting.length; ) {
      const entry = this.waiting[i]!;
      const player = this.world.get(entry.playerId);
      if (!player || !player.incapacitated) {
        this.waiting.splice(i, 1);
        continue;
      }
      if (this.tryDispatch(player, now)) {
        this.waiting.splice(i, 1);
        continue;
      }
      // 两辆车都忙满 6 秒：就地包扎，绝不让玩家卡在无限等待里
      if (now - entry.since >= QUEUE_TIMEOUT_MS) {
        this.waiting.splice(i, 1);
        this.healInPlace(player, now, tick);
        continue;
      }
      i += 1;
    }
  }

  private advanceCar(car: Ambulance, now: number): void {
    if (car.state === AMBULANCE_STATE.Idle) return;

    const patient = car.targetId !== 0 ? this.world.get(car.targetId) : undefined;

    // 目标掉线：立刻放空返航（断线清理还会再调一次 onDisconnect，幂等）
    if (car.targetId !== 0 && !patient) {
      car.targetId = 0;
      car.state = AMBULANCE_STATE.Returning;
      car.phaseAt = now;
      car.leg = 0;
      return;
    }

    if (car.state === AMBULANCE_STATE.Returning) {
      const arrived = this.moveCar(car, this.spotX(car), this.spotY(car), now);
      if (arrived || now - car.phaseAt >= UNSTUCK_MS) {
        car.x = this.spotX(car);
        car.y = this.spotY(car);
        car.state = AMBULANCE_STATE.Idle;
        car.targetId = 0;
        car.leg = 0;
      }
      return;
    }

    if (car.state === AMBULANCE_STATE.Dispatched) {
      if (!patient) {
        car.state = AMBULANCE_STATE.Returning;
        car.phaseAt = now;
        car.leg = 0;
        return;
      }

      // 固定两段绕行：研发园东侧空地 → 南向主路，再从路口追伤员
      if (car.leg === 0) {
        this.advanceLeg(car, AMBULANCE_EAST_GATE.x, AMBULANCE_EAST_GATE.y, 1, now);
        return;
      }
      if (car.leg === 1) {
        this.advanceLeg(car, AMBULANCE_ROAD_GATE.x, AMBULANCE_ROAD_GATE.y, 2, now);
        return;
      }

      // 站内伤员（ADR-0092）：从主路直奔站心会撞上护士站围挡，先停到南侧通道口再进站
      if (car.leg === 2 && rectContains(CLINIC_REGION_RECT, patient.x, patient.y)) {
        this.advanceLeg(car, CLINIC_VEHICLE_ENTRY.x, CLINIC_VEHICLE_ENTRY.y, 3, now);
        return;
      }

      // 伤员昏迷后位置不动，航点只需刷新一次
      const dist = Math.hypot(patient.x - car.x, patient.y - car.y);
      this.moveCar(car, patient.x, patient.y, now);
      if (dist <= PICKUP_RADIUS) {
        car.state = AMBULANCE_STATE.Transporting;
        car.phaseAt = now;
        car.leg = 0;
        car.targetId = patient.id;
        patient.carriedBy = car.id;
        this.broadcastPatient(patient, PATIENT_STATE.Incapacitated, 0);
        return;
      }

      // 8 秒还没摸到人：瞬移吸附到目标 36px 内，不让墙体把出警卡死
      if (now - car.phaseAt >= UNSTUCK_MS) {
        car.x = clampWorldX(patient.x + 36);
        car.y = clampWorldY(patient.y);
        car.dirX = -1;
        car.dirY = 0;
        car.state = AMBULANCE_STATE.Transporting;
        car.phaseAt = now;
        car.leg = 0;
        patient.carriedBy = car.id;
        this.broadcastPatient(patient, PATIENT_STATE.Incapacitated, 0);
      }
      return;
    }

    // Transporting：把伤员挂在车尾，沿主路 → 东侧空地 → 站内落点送回
    if (!patient) {
      car.state = AMBULANCE_STATE.Returning;
      car.phaseAt = now;
      car.leg = 0;
      return;
    }
    this.attachPatient(car, patient);
    if (car.leg === 0) {
      this.advanceLeg(car, AMBULANCE_ROAD_GATE.x, AMBULANCE_ROAD_GATE.y, 1, now);
      return;
    }
    if (car.leg === 1) {
      this.advanceLeg(car, AMBULANCE_EAST_GATE.x, AMBULANCE_EAST_GATE.y, 2, now);
      return;
    }
    const arrived = this.moveCar(car, CLINIC_DROP.x, CLINIC_DROP.y, now);
    if (arrived || now - car.phaseAt >= UNSTUCK_MS) {
      car.x = CLINIC_DROP.x;
      car.y = CLINIC_DROP.y;
      this.admit(car, patient, now);
    }
  }

  /** 推进一个固定航段；8 秒还没到就直接贴到航点，避免绕行把出警拖死 */
  private advanceLeg(car: Ambulance, tx: number, ty: number, next: number, now: number): void {
    if (this.moveCar(car, tx, ty, now)) {
      car.leg = next;
      car.phaseAt = now;
      return;
    }
    if (now - car.phaseAt >= UNSTUCK_MS) {
      car.x = tx;
      car.y = ty;
      car.leg = next;
      car.phaseAt = now;
    }
  }

  private moveCar(car: Ambulance, tx: number, ty: number, now: number): boolean {
    const dx = tx - car.x;
    const dy = ty - car.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 2) return true;
    const step = Math.min(dist, (AMBULANCE_SPEED * TICK_MS) / 1000);
    const ux = dx / dist;
    const uy = dy / dist;
    resolveMotionInto(MOTION, car.x, car.y, car.x + ux * step, car.y + uy * step);
    const moved = Math.hypot(MOTION.x - car.x, MOTION.y - car.y);
    if (moved > 0.5) {
      car.dirX = (MOTION.x - car.x) / moved;
      car.dirY = (MOTION.y - car.y) / moved;
      car.x = MOTION.x;
      car.y = MOTION.y;
    }
    return Math.hypot(tx - car.x, ty - car.y) <= 4;
  }

  private attachPatient(car: Ambulance, patient: Player): void {
    // 车尾 = 车头反方向 26px；车头方向取最近一次有效位移方向
    patient.x = clampWorldX(car.x - car.dirX * 26);
    patient.y = clampWorldY(car.y - car.dirY * 26);
    // 必须走 applyState：只改 pose 不动 state，远端会继续按站立姿态画被拖着的人
    if (patient.pose !== POSE.Lie) patient.applyState(patient.direction, POSE.Lie, false);
    patient.dirty = true;
    this.grid.update(patient.id, patient.x, patient.y);
  }

  private admit(car: Ambulance, patient: Player, now: number): void {
    const freeSeat = CLINIC_BED_SEAT_IDS.find((seatId) => this.seats.isFree(seatId));
    const seat = freeSeat !== undefined ? seatById(freeSeat) : undefined;

    if (seat) {
      const changes: SeatStateEntry[] = [];
      this.seats.occupy(patient, seat, now, changes);
      this.broadcastSeats(changes);
    }
    // 两张床都满时让伤员在落点地面完成治疗；seatId=0 表示只走计时，不释放座位
    this.beds.set(patient.id, {
      playerId: patient.id,
      seatId: seat?.id ?? 0,
      endsAt: now + TREATMENT_MS,
    });

    patient.carriedBy = 0;
    patient.incapacitated = true;
    patient.patientState = PATIENT_STATE.Treating;
    patient.patientUntil = now + TREATMENT_MS;
    patient.dirty = true;
    this.grid.update(patient.id, patient.x, patient.y);
    this.broadcastPatient(patient, PATIENT_STATE.Treating, Math.ceil(TREATMENT_MS / 1000));

    car.targetId = 0;
    car.state = AMBULANCE_STATE.Returning;
    car.phaseAt = now;
    car.leg = 0;
  }

  private advanceBeds(now: number, tick: number): void {
    for (const [playerId, stay] of this.beds) {
      if (now < stay.endsAt) continue;
      this.beds.delete(playerId);
      const player = this.world.get(playerId);
      if (!player) continue;
      const changes: SeatStateEntry[] = [];
      this.seats.stand(player, changes);
      this.broadcastSeats(changes);
      // NPC 不走「站到床尾」：归位点由倒地瞬间记录，护士回固定站位（ADR-0106）
      if (player.isNpc) {
        this.restoreNpc(player, now, tick);
        continue;
      }
      // 从床心站到床尾外侧：床面与床尾护栏都不挡脚，治疗结束不会站在枕头里
      const bedIndex = CLINIC_BED_SEAT_IDS.indexOf(stay.seatId);
      const bed = bedIndex >= 0 ? CLINIC_BEDS[bedIndex] : undefined;
      if (bed) {
        player.x = bed.x + bed.w / 2;
        player.y = bed.y + bed.h + 18;
        player.dirty = true;
        this.grid.update(player.id, player.x, player.y);
      }
      this.grantImmunity(player, now, tick);
    }
  }

  private healInPlace(player: Player, now: number, tick: number): void {
    if (player.seat !== 0) {
      const changes: SeatStateEntry[] = [];
      this.seats.release(player, changes);
      this.broadcastSeats(changes);
    }
    player.incapacitated = false;
    player.carriedBy = 0;
    if (player.isNpc) {
      this.restoreNpc(player, now, tick);
      return;
    }
    player.applyState(player.direction, POSE.Idle, false);
    player.dirty = true;
    this.grid.update(player.id, player.x, player.y);
    this.grantImmunity(player, now, tick);
  }

  /**
   * NPC 康复归位（ADR-0106）：护士回固定站位，其余 NPC 交还 npc 层。
   *
   * 端口缺失或实体已不在名册里时退化为原地站起：回位失败也不能把实体
   * 永久锁在躺姿或病床上。免疫照常发放，否则刚归位就会被再次打飞。
   */
  private restoreNpc(player: Player, now: number, tick: number): void {
    player.carriedBy = 0;
    player.incapacitated = false;
    player.stunUntil = 0;

    let restored = false;
    if (player.role === ENTITY_ROLE_NURSE) {
      const index = this.nurses.indexOf(player);
      if (index >= 0) {
        this.resetNurse(player, this.nurseSpots[index] ?? 0, now);
        restored = true;
      }
    } else {
      const spot = this.npcReturn.get(player.id);
      if (spot && this.recovery?.restore(player.id, spot, now)) restored = true;
    }
    this.npcReturn.delete(player.id);

    if (!restored) {
      player.applyState(player.direction, POSE.Idle, false);
      player.markDirtyIfChanged();
      if (this.grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
    }
    this.grantImmunity(player, now, tick);
  }

  private grantImmunity(player: Player, now: number, tick: number): void {
    player.incapacitated = false;
    player.carriedBy = 0;
    player.immunityUntilMs = now + IMMUNITY_MS;
    player.immunityUntilTick = tick + IMMUNITY_TICKS;
    player.patientState = PATIENT_STATE.Shielded;
    player.patientUntil = player.immunityUntilMs;
    player.dirty = true;
    this.shieldUntil.set(player.id, player.immunityUntilMs);
    this.broadcastPatient(player, PATIENT_STATE.Shielded, IMMUNITY_MS / 1000);
  }

  private advanceShields(now: number): void {
    for (const [playerId, until] of this.shieldUntil) {
      if (now < until) continue;
      this.shieldUntil.delete(playerId);
      const player = this.world.get(playerId);
      if (!player || player.immunityUntilMs !== until) continue;
      player.patientState = PATIENT_STATE.None;
      player.patientUntil = 0;
      player.immunityUntilMs = 0;
      this.broadcastPatient(player, PATIENT_STATE.None, 0);
    }
  }

  // ---------------------------------------------------------------------------
  // 断线清理
  // ---------------------------------------------------------------------------

  onDisconnect(playerId: number, now: number): void {
    for (let i = this.waiting.length - 1; i >= 0; i -= 1) {
      if (this.waiting[i]!.playerId === playerId) this.waiting.splice(i, 1);
    }
    this.beds.delete(playerId);
    this.shieldUntil.delete(playerId);

    for (const car of this.cars) {
      if (car.targetId !== playerId) continue;
      car.targetId = 0;
      car.state = AMBULANCE_STATE.Returning;
      car.phaseAt = now;
      car.leg = 0;
    }

    // 实体离场不会再走状态切换包：补一条 None，客户端才能清掉星星 / 盾牌与护士爱心
    const packet = encodePatientStatus({ entityId: playerId, state: PATIENT_STATE.None, seconds: 0 });
    for (const viewer of this.world.players.values()) this.transport.send(viewer.wsId, packet);
  }

  // ---------------------------------------------------------------------------
  // 广播与视觉微动效
  // ---------------------------------------------------------------------------

  private advanceNurses(now: number): void {
    // 回位排在挥手之前：护士是站桩 NPC，没有大脑驱动「硬直结束自己爬起来」，
    // 不在这里补一手，被创飞一次就会一直躺在急救站（ADR-0090）
    for (let i = 0; i < this.nurses.length; i += 1) {
      const nurse = this.nurses[i]!;
      // 昏迷中的护士由救护车接管（ADR-0106）：这里再回位等于从车尾瞬移走
      if (nurse.incapacitated) continue;
      if (nurse.pose !== POSE.Lie || now < nurse.stunUntil) continue;
      this.resetNurse(nurse, this.nurseSpots[i] ?? 0, now);
    }
    if (now >= this.nurseWaveUntil) {
      for (const nurse of this.nurses) {
        if (nurse.incapacitated) continue;
        if (!nurse.wave) continue;
        // state 只在 applyState 里重打包：只改字段不发包，远端永远看不到挥手
        nurse.applyState(nurse.direction, nurse.pose, false);
        nurse.dirty = true;
      }
    }
    for (let i = 0; i < this.nurses.length; i += 1) {
      if (now < this.nurseNextWave[i]!) continue;
      const nurse = this.nurses[i]!;
      if (nurse.incapacitated) continue;
      nurse.applyState(nurse.direction, nurse.pose, false, false, false, true);
      nurse.dirty = true;
      // 6~10 秒随机再来一次妖艳挥手
      this.nurseNextWave[i] = now + 6000 + Math.random() * 4000;
      this.nurseWaveUntil = now + 900;
    }
  }

  /**
   * 护士硬直结束回位（ADR-0090）：清硬直、站回出生站位、落站姿。
   *
   * 坐标直接取出生时的合法站位，不经碰撞求解也不会进墙；网格更新返回 true 时
   * 才置 `needsViewRefresh`，让 AOI 里所有人重新拿到这条实体，客户端才看得到「起身」。
   */
  private resetNurse(nurse: Player, index: number, now: number): void {
    const spot = CLINIC_NURSE_SPOTS[index];
    nurse.stunUntil = 0;
    nurse.lastMoveAt = now;
    if (spot) {
      nurse.x = spot.x;
      nurse.y = spot.y;
    }
    nurse.applyState(DIRECTION.Down, POSE.Idle, false);
    nurse.markDirtyIfChanged();
    if (this.grid.update(nurse.id, nurse.x, nurse.y)) nurse.needsViewRefresh = true;
  }

  private broadcastCars(): void {
    for (const car of this.cars) {
      const qx = quantizeCoord(car.x);
      const qy = quantizeCoord(car.y);
      if (car.state === car.lastSentState && qx === car.lastSentQx && qy === car.lastSentQy) continue;
      car.lastSentState = car.state;
      car.lastSentQx = qx;
      car.lastSentQy = qy;
      const packet = this.ambulancePacket(car);
      for (const viewer of this.world.players.values()) this.transport.send(viewer.wsId, packet);
    }
  }

  private ambulancePacket(car: Ambulance): Uint8Array {
    const packet: AmbulancePacket = {
      id: car.id,
      state: car.state,
      x: car.x,
      y: car.y,
      flags:
        (car.state === AMBULANCE_STATE.Idle ? 0 : AMBULANCE_FLAG_SIREN) |
        (car.state === AMBULANCE_STATE.Transporting ? AMBULANCE_FLAG_CARRYING : 0),
    };
    return encodeAmbulance(packet);
  }

  private broadcastPatient(player: Player, state: PatientState, seconds: number): void {
    const packet = encodePatientStatus({ entityId: player.id, state, seconds });
    for (const viewer of this.world.players.values()) this.transport.send(viewer.wsId, packet);
  }

  private spotX(car: Ambulance): number {
    return CLINIC_AMBULANCE_SPOTS[car.id - 1]!.x;
  }

  private spotY(car: Ambulance): number {
    return CLINIC_AMBULANCE_SPOTS[car.id - 1]!.y;
  }
}
