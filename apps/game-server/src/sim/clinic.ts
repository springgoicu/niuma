import {
  ACTIVITY_KIND,
  AMBULANCE_FLAG_CARRYING,
  AMBULANCE_FLAG_SIREN,
  AMBULANCE_STATE,
  CLINIC_AMBULANCE_SPOTS,
  CLINIC_ACCESS_PAVING,
  CLINIC_BED_SEAT_IDS,
  CLINIC_BEDS,
  CLINIC_DROP,
  CLINIC_NURSE_LANE_X,
  CLINIC_NURSE_LANE_Y,
  CLINIC_NURSE_SPOTS,
  CLINIC_RECT,
  CLINIC_REGION_RECT,
  CLINIC_VEHICLE_ENTRY,
  DIRECTION,
  ENTITY_ROLE_NURSE,
  MOVE_SPEED,
  PATIENT_STATE,
  PLAYER_RADIUS,
  PLAZA_CENTER,
  POSE,
  SERVICE_SQUARE,
  TICK_MS,
  clampWorldX,
  clampWorldY,
  clinicBedSide,
  encodeAmbulance,
  encodePatientStatus,
  findFreePoint,
  isBlocked,
  isInClinicInterior,
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
import { findPath, nearestFreePoint, type NavPoint } from '../nav/path';
import type { SpatialGrid } from '../spatial/grid';
import type { ActivityHub } from './activity';
import type { SeatRegistry } from './seats';
import type { Player, World } from './world';
import type { Transport } from './view';

/** 出警速度：玩家常速的 1.6 倍 */
const AMBULANCE_SPEED = MOVE_SPEED * 1.6;
/** 抵达判定：目标 48px 内即可挂人；救护车不必压到玩家脚底 */
const PICKUP_RADIUS = 48;
/** 送回落点判定：车位 / 站内落点 64px 内开始交床 */
const DROP_RADIUS = 64;
/**
 * 出警 / 送回 / 返航的防卡死上限：整段路超过这个时长仍未完成就安全落点兜底。
 * ADR-0115 后正常路段由寻路驱动，不会顶墙；这里只是最后一道保险。
 */
const UNSTUCK_MS = 8000;
/** 寻路中途完全不动多久算卡死：比整段上限更早触发，避免原地磨满 8 秒 */
const NAV_STALL_MS = 2200;
/** 停滞判定的最小位移：低于它视作原地打转 */
const NAV_STALL_EPS = 2;
/**
 * 出警 / 送回的固定绕行航点（不做寻路，ADR-0097）：
 * 先穿服务广场南沿，再走东主路进中央广场，避开急救站围挡与公寓楼群。
 */
const AMBULANCE_EAST_GATE = { x: CLINIC_RECT.x + CLINIC_RECT.w / 2, y: SERVICE_SQUARE.y + SERVICE_SQUARE.h - 40 } as const;
const AMBULANCE_ROAD_GATE = { x: PLAZA_CENTER.x + 320, y: PLAZA_CENTER.y } as const;
/** 两辆都在任务时，真人伤员最多在内存队列里等 6 秒就地包扎 */
const HUMAN_QUEUE_TIMEOUT_MS = 6000;
/**
 * NPC 排队上限（ADR-0114）。
 *
 * 救护车往返要走两段固定绕行（ADR-0097），一轮出警 + 治疗通常 20~28 秒；
 * 6 秒兜底会让排队的 NPC 在倒地原地站起来并发 15 秒免疫，玩家看到的就是
 * 「打倒了却没有任何车出发」。给足两轮往返，只有真卡死时才就地包扎。
 */
const NPC_QUEUE_TIMEOUT_MS = 45000;
/** 病床治疗时长 */
const TREATMENT_MS = 3000;
/** 治愈后的工伤保护 */
const IMMUNITY_MS = 15000;
const IMMUNITY_TICKS = 300;
/** 连续受击判定窗口：15 秒（300 Tick） */
const HIT_WINDOW_TICKS = 300;
/** 3 次命中触发昏迷 */
const HITS_TO_DOWN = 3;
/** 护士站内步速：比真人常速慢一截，看着像值班而不是在赶路 */
const NURSE_SPEED = MOVE_SPEED * 0.62;
/** 单个航段卡死上限：柜台、床沿对撞不动的护士不该原地抽搐 */
const NURSE_STUCK_MS = 2400;
/** 救护车停在落点等护士接手的最长时间；超时退回旧路径直接入床 */
const HANDOVER_TIMEOUT_MS = 6000;
/** 从接手到放上病床的整段上限（含卡死兜底） */
const ESCORT_TIMEOUT_MS = 9000;
/** 上床 / 下床的逐 Tick 过渡时长：一次式吸附在客户端就是一记瞬移（ADR-0109） */
const LIFT_MS = 360;
/** 站位驻足时长 */
const POST_MS = 2400;
const POST_JITTER_MS = 2800;
/**
 * 开服清场的落点（ADR-0114）：西门外 60px，区域矩形以西、仍在服务广场铺装上。
 *
 * 站点几何只认识 `CLINIC_ACCESS_PAVING`，所以落点也由它派生，挪站只改一个矩形；
 * 取 60px 是为了让落点同时落在 `CLINIC_REGION_RECT` 之外——只清出站体、
 * 还堵在门口铺装上的话，护士接人的走廊照样会被占。
 */
const CLINIC_SPILL_POINT = {
  x: CLINIC_REGION_RECT.x - 60,
  y: CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h / 2,
} as const;

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
  /**
   * 由 nav/findPath 算出的逐点路线（ADR-0115）。空数组表示尚未规划；
   * 追人段的目标（昏迷位置）固定，只在派单时算一次，中途失效才重算。
   */
  route: NavPoint[];
  /** route 当前推进到的点下标 */
  routeIndex: number;
  /** 这份 route 对应的目标坐标；目标变动超过阈值就重算 */
  routeGoalX: number;
  routeGoalY: number;
  /** 上次产生有效位移的时刻，用于中途停滞提前脱困 */
  lastProgressAt: number;
  /** 最后一次有意义的移动方向，用于把伤员挂在车尾 */
  dirX: number;
  dirY: number;
  lastSentState: number;
  lastSentQx: number;
  lastSentQy: number;
  /** 落点交接：正在接手这辆车的护士 id；0 表示没有交接 */
  handover: number;
  /** 交接开始时刻，用于超时兜底 */
  handoverAt: number;
}

type NursePhase = 'post' | 'patrol' | 'pickup' | 'escort' | 'treat' | 'back';

interface DutyPoint {
  x: number;
  y: number;
}

/**
 * 护士值守状态机（ADR-0109）。
 *
 * 护士不是 `NpcAgent`：搬进 npc 层会让她变成可接押送单的巡逻 NPC，也会让
 * clinic 反过来依赖 npc 层（ADR-0106 的边界）。因此这里只保留一条极窄的
 * 「站位 → 接人 → 送床 → 回岗」状态机，位移全部沿站内两条轴对齐走廊推进。
 */
interface NurseDuty {
  phase: NursePhase;
  path: DutyPoint[];
  index: number;
  /** 正在接送的伤员；0 表示空闲 */
  patientId: number;
  /** 目标床位；0 表示落点地面治疗 */
  seatId: number;
  phaseAt: number;
  pauseUntil: number;
  lastProgressAt: number;
}

/** 逐 Tick 的坐标过渡：把「吸到床上」「站到床尾」摊成几帧，客户端看不到跳变 */
interface MoveTween {
  playerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startAt: number;
  endAt: number;
  onDone: ((player: Player, now: number) => void) | null;
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
  /**
   * 全园区播报端口（ADR-0112）：可选注入，测试与无播报部署零改动。
   * clinic 只报「倒下 / 装车 / 上床 / 康复」四个跃迁，不重复已有状态包。
   */
  activity?: ActivityHub;
}

/**
 * 园区急救调度器（ADR-0084）。
 *
 * 只活在进程内存：四态救护车、等待队列、病床治疗与工伤保护都不落盘。
 * 移动复用 `resolveMotionInto`，因此墙体、柜台和床沿对救护车同样有效；
 * 8 秒脱困是最后一道保险，任何几何卡死都不会把伤员永久锁在地上。
 */
/**
 * 康复后把 NPC 交还给 npc 层（ADR-0109，取代 ADR-0106 的坐标回写口径）。
 *
 * clinic 只负责调度与康复，不碰巡逻 / 押送状态机，因此用这个窄端口把
 * 「就地续接任务」交还 `npc/director`；端口未注入时就地站起兜底。
 */
export interface NpcRestorePort {
  /**
   * 坐标由 clinic 先写好在床尾 / 落点，npc 层只负责就地清硬直并续接巡逻。
   *
   * 传入坐标的老写法会让康复的 NPC 从病床瞬移回半个园区外的倒地位置（ADR-0109）。
   * 返回 false 表示这个实体不由 npc 层管理。
   */
  restore(playerId: number, now: number): boolean;
}

export class AmbulanceManager {
  private readonly world: World;
  private readonly grid: SpatialGrid;
  private readonly transport: Transport;
  private readonly seats: SeatRegistry;
  private readonly broadcastSeats: ClinicOptions['broadcastSeats'];
  private readonly activity: ActivityHub | undefined;
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
  /** 每名护士一组值守进度；护士被创飞 / 昏迷时整条清掉 */
  private readonly nurseDuty = new Map<number, NurseDuty>();
  /** 正在挪床 / 下床的实体：把坐标变化摊到多个 Tick */
  private readonly tweens = new Map<number, MoveTween>();
  /** 康复续接端口；`server` 在 npc 层创建之后注入（clinic 构造更早） */
  private recovery: NpcRestorePort | null = null;
  private seq = 0;

  constructor(options: ClinicOptions) {
    this.world = options.world;
    this.grid = options.grid;
    this.transport = options.transport;
    this.seats = options.seats;
    this.broadcastSeats = options.broadcastSeats;
    this.activity = options.activity;
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
      route: [],
      routeIndex: 0,
      routeGoalX: 0,
      routeGoalY: 0,
      lastProgressAt: 0,
      dirX: 0,
      dirY: 1,
      lastSentState: -1,
      lastSentQx: -1,
      lastSentQy: -1,
      handover: 0,
      handoverAt: 0,
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
      // 两人错开起步：先站一会儿再巡东侧通道，不会排成一条线一起走
      this.nurseDuty.set(nurse.id, {
        phase: 'post',
        path: this.patrolPath(spot),
        index: 0,
        patientId: 0,
        seatId: 0,
        phaseAt: now,
        pauseUntil: now + 1200 + index * 2600,
        lastProgressAt: now,
      });
    });
  }

  /**
   * 巡检环：站位 → 柜台东侧通道 → 床底南侧 → 落点 → 原路回站位。
   *
   * 每段都是轴对齐的：柜台后的窄带只有 18px（正好 2 个半径），斜着走会被
   * 实心条挤出去，所以航点只给走廊中心线与转角，转向交给状态机。
   */
  private patrolPath(spot: { x: number; y: number }): DutyPoint[] {
    return [
      { x: CLINIC_NURSE_LANE_X, y: spot.y },
      { x: CLINIC_NURSE_LANE_X, y: CLINIC_NURSE_LANE_Y },
      { x: CLINIC_DROP.x, y: CLINIC_NURSE_LANE_Y },
      { x: CLINIC_NURSE_LANE_X, y: CLINIC_NURSE_LANE_Y },
      { x: CLINIC_NURSE_LANE_X, y: spot.y },
      { x: spot.x, y: spot.y },
    ];
  }

  // ---------------------------------------------------------------------------
  // 受击计数与触发
  // ---------------------------------------------------------------------------

  /** 注入 NPC 康复续接端口：`server` 在 npc 层创建之后调用一次 */
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
    // 倒下的是护士：手上的伤员必须立刻脱手，否则会被一个趴着的护士拖着走
    if (player.role === ENTITY_ROLE_NURSE) this.releaseNurse(player, now);
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
    this.activity?.emit(ACTIVITY_KIND.VentKnockdown, player.id, now);

    const waiting: Waiting = { playerId: player.id, since: now };
    if (!this.tryDispatch(player, now)) this.waiting.push(waiting);
  }

  /**
   * 护士被打倒时的脱手处理（ADR-0109）。
   *
   * 车还在落点等她就直接放行交接：下一 Tick 会重新挑护士，挑不到就走旧路径，
   * 因此这时不能把伤员再塞回队列，否则同一名伤员会被治两遍。
   * 车已经返航、人还在半路时才重新排队，等下一辆车来接力。
   */
  private releaseNurse(nurse: Player, now: number): void {
    const duty = this.nurseDuty.get(nurse.id);
    this.nurseDuty.delete(nurse.id);
    let waitingCar = false;
    for (const car of this.cars) {
      if (car.handover !== nurse.id) continue;
      car.handover = 0;
      car.handoverAt = now;
      waitingCar = true;
    }
    if (!duty || duty.patientId === 0) return;
    const patient = this.world.get(duty.patientId);
    if (!patient) return;
    patient.carriedBy = 0;
    this.grid.update(patient.id, patient.x, patient.y);
    if (waitingCar) return;
    if (patient.incapacitated && !this.beds.has(patient.id)) {
      this.waiting.push({ playerId: patient.id, since: now });
    }
  }

  // ---------------------------------------------------------------------------
  // 调度
  // ---------------------------------------------------------------------------

  private tryDispatch(player: Player, now: number): boolean {
    // 同一名伤员只能被一辆车接管：重复派车会让两台车一起追同一个人、
    // 一起在落点等交接，两辆车被一个伤员占死，后来的人只能排队到就地包扎。
    if (this.cars.some((car) => car.targetId === player.id)) return true;
    const car = this.cars.find((candidate) => candidate.state === AMBULANCE_STATE.Idle);
    if (!car) return false;
    car.state = AMBULANCE_STATE.Dispatched;
    car.targetId = player.id;
    car.leg = 0;
    car.phaseAt = now;
    car.lastProgressAt = now;
    this.clearRoute(car);
    this.activity?.emit(ACTIVITY_KIND.AmbulanceDispatched, player.id, now);
    return true;
  }

  /**
   * 开服清场（ADR-0114）：站内只留护士与正在治疗的伤员。
   *
   * 只在 `server` 启动时调一次，不做持续规则：治疗中的床位伤员、挂车途中的伤员
   * 与护士都在站内，天然属于「站内有人」，持续清扫会和急救链抢人。
   * 被清出去的实体落到西门外 60px（`CLINIC_REGION_RECT` 之外、仍在服务广场铺装），
   * 不会一开门就把人踢到看不见的地方。
   * 只改内存坐标（ADR-0084），不落盘。
   */
  evictIntruders(now: number): number {
    let moved = 0;
    for (const player of this.world.players.values()) {
      if (player.role === ENTITY_ROLE_NURSE) continue;
      if (!isInClinicInterior(player.x, player.y)) continue;
      // 急救链正在管的人不抢：躺床、挂车尾、挪床过渡、排队昏迷都继续走原流程
      if (player.incapacitated || player.carriedBy !== 0) continue;
      if (this.beds.has(player.id) || this.tweens.has(player.id)) continue;

      const point = findFreePoint(CLINIC_SPILL_POINT.x, CLINIC_SPILL_POINT.y, PLAYER_RADIUS, true);
      if (player.seat !== 0) {
        const changes: SeatStateEntry[] = [];
        this.seats.release(player, changes);
        this.broadcastSeats(changes);
      }
      player.x = point.x;
      player.y = point.y;
      player.stunUntil = 0;
      player.applyState(DIRECTION.Down, POSE.Idle, false);
      player.dirty = true;
      if (this.grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      // NPC 还要把行为态重新锚到新位置，否则下一拍会拿着旧路径往回走
      if (player.isNpc) this.recovery?.restore(player.id, now);
      moved += 1;
    }
    return moved;
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
    this.advanceTweens(now);
    this.advanceNurses(now);
    this.advanceQueue(now, tick);
    for (const car of this.cars) this.advanceCar(car, now);
    this.advanceBeds(now, tick);
    this.advanceShields(now);
    this.broadcastCars();
  }

  /**
   * 推进逐帧坐标过渡（「扶上床」「站到床尾」这两处挪动）。
   *
   * 一次式吸附在客户端就是一记瞬移（ADR-0109）：上床摊成 360ms、下床同样 360ms，
   * 每拍只改坐标并更新网格，客户端不需要为「位置被服务端接管」再写特殊分支。
   */
  private advanceTweens(now: number): void {
    if (this.tweens.size === 0) return;
    for (const [playerId, tween] of this.tweens) {
      const player = this.world.get(playerId);
      if (!player) {
        this.tweens.delete(playerId);
        continue;
      }
      if (now >= tween.endAt) {
        player.x = tween.toX;
        player.y = tween.toY;
        this.tweens.delete(playerId);
        player.dirty = true;
        this.grid.update(player.id, player.x, player.y);
        tween.onDone?.(player, now);
        continue;
      }
      const span = tween.endAt - tween.startAt;
      const progress = span > 0 ? Math.min(1, Math.max(0, (now - tween.startAt) / span)) : 1;
      player.x = tween.fromX + (tween.toX - tween.fromX) * progress;
      player.y = tween.fromY + (tween.toY - tween.fromY) * progress;
      player.dirty = true;
      this.grid.update(player.id, player.x, player.y);
    }
  }

  private advanceQueue(now: number, tick: number): void {
    // 从队首推进：先昏迷的伤员先上车，不能因为倒序遍历让后来者插队
    for (let i = 0; i < this.waiting.length; ) {
      const       entry = this.waiting[i]!;
      const player = this.world.get(entry.playerId);
      // 已经挂上车 / 已经躺上床的人不需要再排队：留着只会派第二辆车扑空
      if (!player || !player.incapacitated || player.carriedBy !== 0 || this.beds.has(player.id)) {
        this.waiting.splice(i, 1);
        continue;
      }
      if (this.tryDispatch(player, now)) {
        this.waiting.splice(i, 1);
        continue;
      }
      // 两辆车都忙满兜底时长：就地包扎。
      // 真人 6 秒（绝不让玩家卡在无限等待里）；NPC 45 秒（ADR-0114），
      // 否则「排队等车」会变成「原地站起来」，玩家看到的就是没车出警。
      if (now - entry.since >= (player.isNpc ? NPC_QUEUE_TIMEOUT_MS : HUMAN_QUEUE_TIMEOUT_MS)) {
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
        const safe = nearestFreePoint(this.spotX(car), this.spotY(car));
        car.x = safe?.x ?? this.spotX(car);
        car.y = safe?.y ?? this.spotY(car);
        car.state = AMBULANCE_STATE.Idle;
        car.targetId = 0;
        car.leg = 0;
        this.clearRoute(car);
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

      // 伤员昏迷后位置不动：按寻路路线逐点推进，穿过门洞而不是直线顶墙（ADR-0115）
      const arrived = this.advanceRoute(car, patient.x, patient.y, now);
      const dist = Math.hypot(patient.x - car.x, patient.y - car.y);
      if (arrived || dist <= PICKUP_RADIUS) {
        car.state = AMBULANCE_STATE.Transporting;
        car.phaseAt = now;
        car.leg = 0;
        car.targetId = patient.id;
        patient.carriedBy = car.id;
        this.clearRoute(car);
        this.broadcastPatient(patient, PATIENT_STATE.Incapacitated, 0);
        this.activity?.emit(ACTIVITY_KIND.AmbulanceLoaded, patient.id, now);
        return;
      }

      // 路线规划失败（目标被围死）或中途卡死：落到伤员附近最近的合法点，绝不写进墙里
      const stalled = now - car.lastProgressAt >= NAV_STALL_MS;
      const timedOut = now - car.phaseAt >= UNSTUCK_MS;
      if (car.route.length === 0 || stalled || timedOut) {
        const safe = this.safePickupPoint(patient.x, patient.y);
        car.x = safe.x;
        car.y = safe.y;
        car.dirX = -1;
        car.dirY = 0;
        car.state = AMBULANCE_STATE.Transporting;
        car.phaseAt = now;
        car.leg = 0;
        car.targetId = patient.id;
        patient.carriedBy = car.id;
        this.clearRoute(car);
        this.broadcastPatient(patient, PATIENT_STATE.Incapacitated, 0);
        this.activity?.emit(ACTIVITY_KIND.AmbulanceLoaded, patient.id, now);
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
    // 送回第一段：从伤员所在场所出来到主路口。场所内有门洞时走路线，避免出场所就顶墙。
    if (car.leg === 0) {
      const arrived = this.advanceRoute(car, AMBULANCE_ROAD_GATE.x, AMBULANCE_ROAD_GATE.y, now);
      const stalled = now - car.lastProgressAt >= NAV_STALL_MS;
      if (arrived || stalled || now - car.phaseAt >= UNSTUCK_MS) {
        car.leg = 1;
        car.phaseAt = now;
        car.lastProgressAt = now;
        this.clearRoute(car);
      }
      return;
    }
    if (car.leg === 1) {
      this.advanceLeg(car, AMBULANCE_EAST_GATE.x, AMBULANCE_EAST_GATE.y, 2, now);
      return;
    }
    const arrived = this.advanceRoute(car, CLINIC_DROP.x, CLINIC_DROP.y, now);
    if (arrived || now - car.phaseAt >= UNSTUCK_MS) {
      const safe = nearestFreePoint(CLINIC_DROP.x, CLINIC_DROP.y);
      car.x = safe?.x ?? CLINIC_DROP.x;
      car.y = safe?.y ?? CLINIC_DROP.y;
      this.clearRoute(car);
      // 交接期内车停在落点等护士：伤员继续挂车尾，CARRYING 照常亮
      this.beginHandover(car, patient, now);
    }
  }

  /** 推进一个固定航段；8 秒还没到就直接贴到航点，避免绕行把出警拖死 */
  private advanceLeg(car: Ambulance, tx: number, ty: number, next: number, now: number): void {
    if (this.moveCar(car, tx, ty, now)) {
      car.leg = next;
      car.phaseAt = now;
      car.lastProgressAt = now;
      return;
    }
    if (now - car.phaseAt >= UNSTUCK_MS) {
      const safe = nearestFreePoint(tx, ty);
      car.x = safe?.x ?? tx;
      car.y = safe?.y ?? ty;
      car.leg = next;
      car.phaseAt = now;
      car.lastProgressAt = now;
    }
  }

  private clearRoute(car: Ambulance): void {
    car.route = [];
    car.routeIndex = 0;
    car.routeGoalX = 0;
    car.routeGoalY = 0;
  }

  /**
   * 沿路线逐点推进（ADR-0115）。路线只在目标变化或被清空时重算；每 Tick 消费一个
   * 航点，走到末点返回 true。昏迷伤员坐标固定，一次出警通常只规划一次。
   */
  private advanceRoute(car: Ambulance, tx: number, ty: number, now: number): boolean {
    const goalChanged = Math.hypot(tx - car.routeGoalX, ty - car.routeGoalY) > 24;
    if (car.route.length === 0 || goalChanged) {
      const path = findPath({ x: car.x, y: car.y }, { x: tx, y: ty });
      car.route = path ?? [];
      car.routeIndex = 0;
      car.routeGoalX = tx;
      car.routeGoalY = ty;
      car.lastProgressAt = now;
    }
    while (car.routeIndex < car.route.length) {
      const point = car.route[car.routeIndex]!;
      if (!this.moveCar(car, point.x, point.y, now)) break;
      car.routeIndex += 1;
      car.lastProgressAt = now;
    }
    if (car.routeIndex >= car.route.length) {
      car.routeIndex = car.route.length;
      return true;
    }
    // 位移有效就刷新停滞计时：贴着路径点滑行时每点位移可能很小，不能误判卡死
    return false;
  }

  /** 装人兜底落点：伤员身旁最近的空地，绝不落进墙里 */
  private safePickupPoint(px: number, py: number): { x: number; y: number } {
    const free = nearestFreePoint(px, py);
    if (free) return free;
    return { x: clampWorldX(px), y: clampWorldY(py) };
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
    // 车尾 = 车头反方向 26px；车头方向取最近一次有效位移方向。
    // 车贴着门洞或墙时这个点可能落在障碍里，就近挪到空地，避免把伤员塞进墙（ADR-0115）。
    const tailX = car.x - car.dirX * 26;
    const tailY = car.y - car.dirY * 26;
    const safe = isBlocked(tailX, tailY) ? nearestFreePoint(tailX, tailY) : undefined;
    patient.x = clampWorldX(safe?.x ?? tailX);
    patient.y = clampWorldY(safe?.y ?? tailY);
    // 必须走 applyState：只改 pose 不动 state，远端会继续按站立姿态画被拖着的人
    if (patient.pose !== POSE.Lie) patient.applyState(patient.direction, POSE.Lie, false);
    patient.dirty = true;
    this.grid.update(patient.id, patient.x, patient.y);
  }

  /**
   * 落点交接（ADR-0109）：车停在落点，等护士走过来把人接走。
   *
   * 每 Tick 从 `advanceCar` 调过来，因此必须幂等：`handover` 非 0 时只做
   * 「护士接走了没有 / 等太久」两件事。没有空闲护士、或护士迟迟到不了，
   * 就退回旧路径直接入床——救护链绝不因为「护士在忙」卡住。
   */
  private beginHandover(car: Ambulance, patient: Player, now: number): void {
    if (car.handover !== 0) {
      if (now - car.handoverAt >= HANDOVER_TIMEOUT_MS) {
        this.fallbackAdmit(car, patient, car.handover, now);
      }
      return;
    }
    const nurse = this.pickNurse();
    if (!nurse) {
      this.admitDirect(car, patient, now);
      return;
    }
    const duty = this.nurseDuty.get(nurse.id)!;
    duty.phase = 'pickup';
    duty.patientId = patient.id;
    // 现在就挑床：护送途中床被抢就在落点地面治疗（`liftPatient` 会重验一次）
    duty.seatId = this.freeBedId();
    duty.path = [{ x: patient.x + 22, y: patient.y }];
    duty.index = 0;
    duty.phaseAt = now;
    duty.pauseUntil = 0;
    duty.lastProgressAt = now;
    car.handover = nurse.id;
    car.handoverAt = now;
  }

  /** 有空接车的护士：巡游 / 驻足 / 回岗都算空闲，治疗中的不抢 */
  private pickNurse(): Player | undefined {
    let best: Player | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const nurse of this.nurses) {
      if (nurse.incapacitated) continue;
      const duty = this.nurseDuty.get(nurse.id);
      if (!duty || duty.patientId !== 0 || duty.phase === 'treat') continue;
      const dist = Math.hypot(nurse.x - CLINIC_DROP.x, nurse.y - CLINIC_DROP.y);
      if (dist >= bestDist) continue;
      best = nurse;
      bestDist = dist;
    }
    return best;
  }

  private freeBedId(): number {
    return CLINIC_BED_SEAT_IDS.find((seatId) => this.seats.isFree(seatId)) ?? 0;
  }

  /** 交接失败：护士回岗走人，车走旧路径把人直接吸上床 */
  private fallbackAdmit(car: Ambulance, patient: Player, nurseId: number, now: number): void {
    car.handover = 0;
    car.handoverAt = 0;
    this.cancelDuty(nurseId, now);
    this.admitDirect(car, patient, now);
  }

  /**
   * 旧路径（ADR-0084）：把伤员一次式吸到床上并开始治疗。
   *
   * 只作兜底：护士都在昏迷 / 都在忙、交接或护送超时、床位被抢时走这里。
   * 这条路仍然会瞬移，但保证任何异常下伤员都不会永远躺在地上。
   */
  private admitDirect(car: Ambulance, patient: Player, now: number): void {
    const freeSeat = this.freeBedId();
    const seat = freeSeat !== 0 ? seatById(freeSeat) : undefined;

    if (seat) {
      const changes: SeatStateEntry[] = [];
      this.seats.occupy(patient, seat, now, changes);
      this.broadcastSeats(changes);
    }
    this.beginTreatment(patient, seat?.id ?? 0, now);

    car.targetId = 0;
    car.handover = 0;
    car.handoverAt = 0;
    car.state = AMBULANCE_STATE.Returning;
    car.phaseAt = now;
    car.leg = 0;
  }

  /**
   * 开始治疗计时。`delay` 让计时从上床过渡结束后才开始，
   * 否则 360ms 的 tween 会被算进 3 秒疗程，伤员在床上还没躺稳就痊愈了。
   */
  private beginTreatment(player: Player, seatId: number, now: number, delay = 0): void {
    const endsAt = now + delay + TREATMENT_MS;
    // seatId=0 表示只在落点地面走计时，不占任何座位
    this.beds.set(player.id, { playerId: player.id, seatId, endsAt });
    player.incapacitated = true;
    player.carriedBy = 0;
    player.patientState = PATIENT_STATE.Treating;
    player.patientUntil = endsAt;
    player.dirty = true;
    this.grid.update(player.id, player.x, player.y);
    this.broadcastPatient(player, PATIENT_STATE.Treating, Math.ceil((delay + TREATMENT_MS) / 1000));
    this.activity?.emit(ACTIVITY_KIND.ClinicTreating, player.id, now);
  }

  /**
   * 护士走到伤员身边：交接完成，车立刻返航，伤员改由护士拖行。
   *
   * 协议没有「交接中」这个状态（维持四态），`handover` 只是内部字段，
   * 所以这里必须自己清 `targetId`，否则下一拍车会把伤员重新挂回车尾。
   */
  private startEscort(car: Ambulance, nurse: Player, duty: NurseDuty, patient: Player, now: number): void {
    car.handover = 0;
    car.handoverAt = 0;
    car.targetId = 0;
    car.state = AMBULANCE_STATE.Returning;
    car.phaseAt = now;
    car.leg = 0;
    patient.carriedBy = 0;

    duty.phaseAt = now;
    duty.index = 0;
    duty.lastProgressAt = now;
    if (duty.seatId === 0) {
      // 两张床都满：就在落点地面完成治疗，不再白跑一趟床侧
      duty.phase = 'treat';
      duty.path = [];
      this.beginTreatment(patient, 0, now);
      return;
    }
    const side = clinicBedSide(CLINIC_BED_SEAT_IDS.indexOf(duty.seatId));
    duty.phase = 'escort';
    duty.path = [{ x: side.x, y: side.y }];
  }

  /**
   * 护送：伤员以躺姿跟在护士身后 22px。
   *
   * 写法与 `attachPatient` 一致——每 Tick 直接写坐标并更新网格，客户端拿到的
   * 就是连续位移；朝向即行进方向，所以「身后」不会左右乱跳。
   */
  private dragPatient(nurse: Player, patient: Player): void {
    const gap = 22;
    const direction = nurse.direction;
    const x =
      direction === DIRECTION.Left ? nurse.x + gap : direction === DIRECTION.Right ? nurse.x - gap : nurse.x;
    const y = direction === DIRECTION.Up ? nurse.y + gap : direction === DIRECTION.Down ? nurse.y - gap : nurse.y;
    patient.x = clampWorldX(x);
    patient.y = clampWorldY(y);
    if (patient.pose !== POSE.Lie || patient.direction !== direction) {
      patient.applyState(direction, POSE.Lie, false);
    }
    patient.dirty = true;
    this.grid.update(patient.id, patient.x, patient.y);
  }

  /**
   * 到床侧：把伤员平滑挪上床。
   *
   * `occupy(..., snap=false)` 只占座与落躺姿，坐标交给 tween 逐 Tick 挪过去；
   * 占了座才发现床被抢，就落在原地做地面治疗，绝不再瞬移一次。
   */
  private liftPatient(nurse: Player, duty: NurseDuty, patient: Player, now: number): void {
    const seat = duty.seatId !== 0 ? seatById(duty.seatId) : undefined;
    const target = seat && this.seats.isFree(seat.id) ? seat : undefined;
    if (target) {
      const changes: SeatStateEntry[] = [];
      this.seats.occupy(patient, target, now, changes, false);
      this.broadcastSeats(changes);
      this.startTween(patient, target.x, target.y, LIFT_MS, now, null);
      this.beginTreatment(patient, target.id, now, LIFT_MS);
      duty.seatId = target.id;
    } else {
      this.beginTreatment(patient, 0, now);
      duty.seatId = 0;
    }
    duty.phase = 'treat';
    duty.index = 0;
    duty.path = [];
    nurse.applyState(target ? DIRECTION.Up : nurse.direction, POSE.Idle, false);
    nurse.dirty = true;
  }

  /** 起一段逐 Tick 的坐标过渡；`duration <= 0` 时直接落位 */
  private startTween(
    player: Player,
    toX: number,
    toY: number,
    duration: number,
    now: number,
    onDone: ((player: Player, now: number) => void) | null,
  ): void {
    if (duration <= 0) {
      player.x = toX;
      player.y = toY;
      player.dirty = true;
      this.grid.update(player.id, player.x, player.y);
      onDone?.(player, now);
      return;
    }
    this.tweens.set(player.id, {
      playerId: player.id,
      fromX: player.x,
      fromY: player.y,
      toX,
      toY,
      startAt: now,
      endAt: now + duration,
      onDone,
    });
  }

  /**
   * 沿航点走一步：返回 true 表示整条路径走完。
   *
   * 只用直线推进 + `resolveMotionInto` 吃墙体，不做寻路（ADR-0097）；
   * 某段卡住超过 `NURSE_STUCK_MS` 由调用方兜底，护士不会在柜台角上抽搐。
   */
  private walkPath(nurse: Player, duty: NurseDuty, now: number): boolean {
    const target = duty.path[duty.index];
    if (!target) return true;
    const dx = target.x - nurse.x;
    const dy = target.y - nurse.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 2) {
      nurse.x = target.x;
      nurse.y = target.y;
      duty.index += 1;
      duty.lastProgressAt = now;
      return !duty.path[duty.index];
    }
    const step = Math.min(dist, (NURSE_SPEED * TICK_MS) / 1000);
    resolveMotionInto(MOTION, nurse.x, nurse.y, nurse.x + (dx / dist) * step, nurse.y + (dy / dist) * step);
    const moved = Math.hypot(MOTION.x - nurse.x, MOTION.y - nurse.y);
    if (moved <= 0.5) return false;
    nurse.x = MOTION.x;
    nurse.y = MOTION.y;
    const direction =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? DIRECTION.Right
          : DIRECTION.Left
        : dy > 0
          ? DIRECTION.Down
          : DIRECTION.Up;
    nurse.applyState(direction, POSE.Walk, false);
    nurse.markDirtyIfChanged();
    this.grid.update(nurse.id, nurse.x, nurse.y);
    duty.lastProgressAt = now;
    return false;
  }

  /** 护士放弃当前任务：就地走回站位（被打倒时由 `releaseNurse` 接管） */
  private cancelDuty(nurseId: number, now: number): void {
    const nurse = this.world.get(nurseId);
    if (nurse && !nurse.incapacitated) {
      this.beginBack(nurse, now);
      return;
    }
    this.nurseDuty.delete(nurseId);
  }

  /**
   * 回岗（ADR-0109）：不再瞬移回出生点，沿站内走廊走回去。
   *
   * 站外的护士只给一条直线航点：跨区穿墙必然卡住，靠 `NURSE_STUCK_MS`
   * 超时兜底直接贴回站位，这是唯一保留的一次瞬移。
   */
  private beginBack(nurse: Player, now: number): void {
    const index = this.nurses.indexOf(nurse);
    const spot = CLINIC_NURSE_SPOTS[this.nurseSpots[index] ?? 0] ?? CLINIC_NURSE_SPOTS[0];
    const path = !rectContains(CLINIC_REGION_RECT, nurse.x, nurse.y)
      ? [{ x: spot.x, y: spot.y }]
      : nurse.y <= CLINIC_RECT.y + 18
        ? // 站在柜台后的窄带里：贴墙横着走回去，别绕南边一整圈
          [{ x: nurse.x, y: spot.y }, { x: spot.x, y: spot.y }]
        : // 床区 / 落点：先回 22px 走廊，沿走廊北上，最后折向站位
          [
            { x: CLINIC_NURSE_LANE_X, y: CLINIC_NURSE_LANE_Y },
            { x: CLINIC_NURSE_LANE_X, y: spot.y },
            { x: spot.x, y: spot.y },
          ];
    this.nurseDuty.set(nurse.id, {
      phase: 'back',
      path,
      index: 0,
      patientId: 0,
      seatId: 0,
      phaseAt: now,
      pauseUntil: 0,
      lastProgressAt: now,
    });
  }

  /** 落回站位：驻足一段时间后再开始下一轮巡检 */
  private settlePost(nurse: Player, nurseIndex: number, duty: NurseDuty, now: number): void {
    this.resetNurse(nurse, this.nurseSpots[nurseIndex] ?? 0, now);
    duty.phase = 'post';
    duty.index = 0;
    duty.patientId = 0;
    duty.seatId = 0;
    duty.phaseAt = now;
    duty.pauseUntil = now + POST_MS + Math.random() * POST_JITTER_MS;
  }

  /**
   * 值守状态机（ADR-0109）：驻足 → 巡检 → 接人 → 护送 → 守床 → 回岗。
   *
   * 只有 `post` / `treat` 两态不写坐标：其余状态的位移全部交给 `walkPath`，
   * 这样「护士站着不动」和「护士被瞬移」在代码里是可区分的两件事。
   */
  private advanceDuty(nurse: Player, duty: NurseDuty, nurseIndex: number, now: number): void {
    switch (duty.phase) {
      case 'post': {
        if (now < duty.pauseUntil) return;
        duty.phase = 'patrol';
        duty.index = 0;
        duty.phaseAt = now;
        duty.lastProgressAt = now;
        return;
      }
      case 'patrol': {
        if (this.walkPath(nurse, duty, now) || now - duty.lastProgressAt >= NURSE_STUCK_MS) {
          this.settlePost(nurse, nurseIndex, duty, now);
        }
        return;
      }
      case 'pickup': {
        const patient = this.world.get(duty.patientId);
        const car = this.cars.find((candidate) => candidate.handover === nurse.id);
        if (!patient || !car || !patient.incapacitated || this.beds.has(patient.id)) {
          this.cancelDuty(nurse.id, now);
          return;
        }
        // 伤员挂在车尾、这一拍刚被 attachPatient 摆好，目标点跟着他走
        const point = duty.path[0]!;
        point.x = patient.x + 22;
        point.y = patient.y;
        const reached = this.walkPath(nurse, duty, now);
        const gap = Math.hypot(patient.x - nurse.x, patient.y - nurse.y);
        if (reached || gap <= 24) {
          this.startEscort(car, nurse, duty, patient, now);
          return;
        }
        // 走到半路卡死：直接回到旧路径，别让车在落点干等到交接超时
        if (now - duty.lastProgressAt >= NURSE_STUCK_MS) this.fallbackAdmit(car, patient, nurse.id, now);
        return;
      }
      case 'escort': {
        const patient = this.world.get(duty.patientId);
        if (!patient || !patient.incapacitated || this.beds.has(patient.id)) {
          this.cancelDuty(nurse.id, now);
          return;
        }
        const arrived = this.walkPath(nurse, duty, now);
        this.dragPatient(nurse, patient);
        if (arrived) {
          this.liftPatient(nurse, duty, patient, now);
          return;
        }
        if (now - duty.phaseAt >= ESCORT_TIMEOUT_MS || now - duty.lastProgressAt >= NURSE_STUCK_MS) {
          // 护送失败：就地地面治疗，绝不让伤员一直躺在地上被拖着走
          this.beginTreatment(patient, 0, now);
          this.cancelDuty(nurse.id, now);
        }
        return;
      }
      case 'treat': {
        const patient = this.world.get(duty.patientId);
        if (patient && this.beds.has(patient.id)) {
          // 守床：面向床上的伤员，保持站姿不动（爱心仍由客户端按状态叠加）
          if (nurse.pose !== POSE.Idle) nurse.applyState(nurse.direction, POSE.Idle, false);
          return;
        }
        this.beginBack(nurse, now);
        return;
      }
      case 'back': {
        if (this.walkPath(nurse, duty, now) || now - duty.lastProgressAt >= NURSE_STUCK_MS) {
          this.settlePost(nurse, nurseIndex, duty, now);
        }
        return;
      }
    }
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

      const bedIndex = CLINIC_BED_SEAT_IDS.indexOf(stay.seatId);
      const bed = bedIndex >= 0 ? CLINIC_BEDS[bedIndex] : undefined;
      if (!bed) {
        // 地面治疗：原地起身，没有床可下
        this.finishStay(player, now, tick);
        continue;
      }
      // 下床（ADR-0109）：床心 → 床尾外侧，逐 Tick 平移 360ms；
      // 康复 / 免疫等收尾都放到过渡结束之后，否则 NPC 会先在床上站起来再弹走
      const tailX = bed.x + bed.w / 2;
      const tailY = bed.y + bed.h + 18;
      this.startTween(player, tailX, tailY, LIFT_MS, now, (done, at) => {
        this.finishStay(done, at, Math.max(tick, Math.floor(at / TICK_MS)));
      });
    }
  }

  /**
   * 疗程式结束的收尾：真人就地站好领免疫，NPC 交还 npc 层就地续巡逻。
   *
   * 坐标此时已经落在床尾 / 地面（tween 走完或本来就在地面），这里不再写位置。
   */
  private finishStay(player: Player, now: number, tick: number): void {
    if (player.isNpc) {
      this.restoreNpc(player, now, tick);
      return;
    }
    player.applyState(player.direction, POSE.Idle, false);
    player.dirty = true;
    this.grid.update(player.id, player.x, player.y);
    this.grantImmunity(player, now, tick);
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
   * NPC 康复续接（ADR-0109）：护士自己走回站位，其余 NPC 交还 npc 层。
   *
   * 坐标已写好在床尾，这里只清状态；端口缺失或实体已不在名册里时退化为原地站起：
   * 续接失败也不能把实体永久锁在躺姿或病床上。免疫照常发放，否则刚站起就会被再次打飞。
   */
  private restoreNpc(player: Player, now: number, tick: number): void {
    player.carriedBy = 0;
    player.incapacitated = false;
    player.stunUntil = 0;

    // 坐标已由 clinic 写好在床尾或地面（ADR-0109）：
    // npc 层只接手状态机，护士则自己走回站位，两边都不再瞬移。
    player.applyState(player.direction, POSE.Idle, false);
    let restored = false;
    if (player.role === ENTITY_ROLE_NURSE) {
      restored = this.nurses.includes(player);
      if (restored) this.beginBack(player, now);
    } else {
      restored = this.recovery?.restore(player.id, now) ?? false;
    }

    if (restored) {
      player.dirty = true;
      if (this.grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
    } else {
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
    // 康复只有这两条收尾路径（床尾 tween 结束 / 地面就地包扎），都在这里汇合
    this.activity?.emit(ACTIVITY_KIND.ClinicRecovered, player.id, now);
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
    // 正在被挪床的实体直接放弃过渡：人已经走了，没必要再挪
    this.tweens.delete(playerId);
    // 正被这名伤员占着交接位的护士也要放单，否则她会对着空气守床 3 秒
    for (const [nurseId, duty] of this.nurseDuty) {
      if (duty.patientId !== playerId) continue;
      for (const car of this.cars) {
        if (car.handover !== nurseId) continue;
        car.handover = 0;
        car.handoverAt = 0;
      }
      this.cancelDuty(nurseId, now);
    }

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
    // 硬直解除排在挥手之前：护士是站桩 NPC，没有大脑驱动「自己爬起来」，
    // 不在这里补一手，被创飞一次就会一直躺在急救站（ADR-0090）
    for (let i = 0; i < this.nurses.length; i += 1) {
      const nurse = this.nurses[i]!;
      // 昏迷中的护士由救护车接管（ADR-0106）：这里再回位等于从车尾瞬移走
      if (nurse.incapacitated) continue;
      if (nurse.pose === POSE.Lie && now >= nurse.stunUntil) {
        nurse.stunUntil = 0;
        // 必须先把躺姿改成站姿：否则「pose 还是 Lie 且 stunUntil 已过」每拍都成立，
        // 下面会每拍重建一次回岗任务，护士永远迈不出第一步
        nurse.applyState(nurse.direction, POSE.Idle, false);
        nurse.dirty = true;
        // 就地站起走回站位（ADR-0109）：被创飞到哪就从哪走回来，
        // 只有走不回（卡死超时）才由 `settlePost` 贴回站位
        this.releaseNurse(nurse, now);
        this.beginBack(nurse, now);
      }
      const duty = this.nurseDuty.get(nurse.id);
      if (duty) this.advanceDuty(nurse, duty, i, now);
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
      // 只在驻足时挥手：走着挥手会让人以为她在打摩斯密码
      if (this.nurseDuty.get(nurse.id)?.phase !== 'post') continue;
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
