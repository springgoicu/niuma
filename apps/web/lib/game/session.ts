'use client';

import {
  ACTION,
  MOVE_SPEED,
  QUEUE_REJECT_REASON,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  dequantizeCoord,
  directionFromVector,
  findNearestSeat,
  packState,
  quantizeCoord,
  regionAt,
  resolveMotion,
  seatById,
  unpackState,
  type CharacterAppearance,
  type Direction,
  type Pose,
  type QueueStatusPacket,
  type SeatInstance,
  type SeatStateEntry,
  type SpawnPacket,
} from '@niuma/shared-types';
import { NetClient } from '../net/client';
import { buildClipTracks, buildOverlayTracks, frameAt, overlayTrackFor, phaseOffset, type ClipTrack } from './clip';
import { Ecs, Local, Motion, POSE, Position, Snapshot, Target } from './ecs';
import { InputController, type ActionKey } from './input';
import { jumpLiftTexels, jumpShadowFor } from './pony-motion';
import { GameRenderer } from './renderer';

export interface ChatEntry {
  id: number;
  name: string;
  text: string;
  at: number;
  self: boolean;
}

export interface SessionStats {
  fps: number;
  ping: number;
  x: number;
  y: number;
  nearby: number;
  backend: string;
}

export interface WorldSnapshot {
  x: number;
  y: number;
  region: string;
  points: Array<{ x: number; y: number; self: boolean }>;
}

export interface SessionCallbacks {
  onStatus(status: 'connecting' | 'queued' | 'online' | 'offline' | 'error', detail?: string): void;
  /** 排队位次快照；null 表示离开队列（入场、被拒或断线） */
  onQueue(status: QueueStatusPacket | null): void;
  /** 被准入拒绝，0 表示解除拒绝态 */
  onRejected(reason: number): void;
  onStats(stats: SessionStats): void;
  onChat(entry: ChatEntry): void;
  onRequestChat(): void;
  /** 附近可用座位或当前入座提示；null 表示不显示 */
  onSeatHint(hint: string | null): void;
}

const SEND_INTERVAL = 50;
const STATS_INTERVAL = 500;
/** 座位提示刷新间隔：足够跟手，又不必每帧扫描座位表 */
const SEAT_HINT_INTERVAL = 150;

/** P1：网络同步改进 - 时间线插值配置 */
const MOVEMENT_CONFIG = {
  /** 小于该距离时使用平滑插值 */
  LARGE_DISPLACEMENT_THRESHOLD: 320,
  /** 极端位移时瞬移的阈值（如 1000+） */
  TELEPORT_THRESHOLD: 1000,
  /** 指数插值系数 */
  INTERPOLATION_FACTOR: 14,
  /** 平滑纠正的保守因子 */
  SMOOTH_CORRECTION_FACTOR: 0.3,
  /**
   * 本地玩家与服务端坐标的最大合法偏差（像素）。
   *
   * 服务端不自行推进位置，sync 里的坐标天然是「客户端上包位置」，
   * 落后 RTT/2 + 一个 Tick + 发送间隔。按 165px/s 与 250ms 单向延迟算约 58px，
   * 取 128px 给抖动与高延迟链路留余量；只有超过它才说明真的失步
   * （限速截断、地形求解分叉、传送），此时一次性对齐。
   */
  LOCAL_DRIFT_LIMIT: 128,
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 线性插值辅助函数 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class GameSession {
  private readonly renderer = new GameRenderer();
  private readonly ecs = new Ecs();
  private readonly tracks = buildClipTracks();
  /** 叠加动作轨表：叫唤按姿态分三条，跳一条；帧循环里只做下标访问 */
  private readonly overlays = buildOverlayTracks(this.tracks);
  /** wire 姿态（Idle/Walk/Sit/Lie）→ 基础轨，顺序与 shared-types 的 POSE 一致 */
  private readonly baseTracks: ReadonlyArray<ClipTrack> = [
    this.tracks.idle!,
    this.tracks.walk!,
    this.tracks.sit!,
    this.tracks.lie!,
  ];
  private readonly input = new InputController();
  private readonly names = new Map<number, string>();
  /** 座位占用镜像：seatId → 占用者的 netId，以服务端广播为准 */
  private readonly seatOwner = new Map<number, number>();
  /** 本地所坐的座位（0 表示未入座）：预测后由服务端广播校正 */
  private localSeat = 0;
  /** 已发出入座请求且尚未起身：只有此时服务端的入座结果才会吸附本地角色 */
  private sitIntent = false;
  private seatHint: string | null = null;
  private seatHintAt = 0;
  private net: NetClient | null = null;
  private localId = 0;
  private elapsed = 0;
  private movementSendTime = 0; // 独立的移动发送计时器（ms）
  private clientMoveSequence = 0; // 移动包序号计数器
  private readonly MOVEMENT_SEND_INTERVAL = 50; // ms，目标 20Hz
  private statsAt = 0;
  private frames = 0;
  private fps = 60;
  private ping = 0;
  private disposed = false;

  constructor(private readonly callbacks: SessionCallbacks) {}

  get backend(): string {
    return this.renderer.backend;
  }

  async start(host: HTMLElement, profile: { name: string; appearance: CharacterAppearance }): Promise<void> {
    this.callbacks.onStatus('connecting');
    await this.renderer.init(host);
    if (this.disposed) return;
    this.renderer.app.ticker.add(this.tick);
    this.statsAt = performance.now();

    this.net = new NetClient({
      // socket 打开不代表入场：真正的在线由 WELCOME 决定，中间可能隔着一条排队
      onOpen: () => this.callbacks.onStatus('connecting', '等待准入'),
      // 断线时保留最后一份排队快照：面板转为「重连中」，而不是把人踢回空白页
      onClose: () => this.callbacks.onStatus('offline', '连接中断，正在重连'),
      onQueue: (status) => {
        this.callbacks.onQueue(status);
        this.callbacks.onStatus('queued', '排队中');
      },
      onRejected: (reason) => {
        this.callbacks.onQueue(null);
        this.callbacks.onRejected(reason);
        this.callbacks.onStatus(
          'error',
          reason === QUEUE_REJECT_REASON.WaitTimeout ? '排队超时，请重新排队' : '园区已满，请稍后再来',
        );
      },
      onWelcome: (packet) => this.handleWelcome(packet.entityId, packet.x, packet.y, profile),
      onSpawn: (packet) => this.handleSpawn(packet),
      onDespawn: (id) => this.handleDespawn(id),
      onSync: (_tick, entities) => this.handleSync(entities),
      onChat: (packet) => this.handleChat(packet.entityId, packet.msgId, packet.text),
      onAppearance: (id, appearance) => this.renderer.setAppearance(id, appearance),
      onSeatState: (entries) => this.handleSeatState(entries),
      onPing: (rtt) => {
        this.ping = rtt;
      },
    });

    this.input.attach(
      (action) => this.perform(action),
      () => this.callbacks.onRequestChat(),
    );
    this.net.connect(profile.name, profile.appearance);
    this.callbacks.onStatus('connecting', '握手');
  }

  private handleWelcome(entityId: number, x: number, y: number, profile: { name: string; appearance: CharacterAppearance }): void {
    this.callbacks.onQueue(null);
    this.callbacks.onRejected(0);
    this.clearWorld();
    this.localId = entityId;
    this.names.set(entityId, profile.name);
    const eid = this.ecs.spawn(entityId, dequantizeCoord(x), dequantizeCoord(y));
    this.ecs.markLocal(entityId);
    Motion.direction[eid] = 2;
    this.net?.setEntityId(entityId);
    void this.renderer.addEntity(entityId, profile.name, profile.appearance);
    this.renderer.updateCamera(dequantizeCoord(x), dequantizeCoord(y));
    this.callbacks.onStatus('online', this.renderer.backend);
  }

  private handleSpawn(packet: SpawnPacket): void {
    const { id, name, appearance } = packet;
    if (this.names.has(id)) return;
    this.names.set(id, name);
    const eid = this.ecs.spawn(id, dequantizeCoord(packet.x), dequantizeCoord(packet.y));
    // 迟到入场也要画对：spawn 包里带着当前姿态与叠加位，否则会先看到「站着的他」再等他动
    const state = unpackState(packet.state);
    Motion.direction[eid] = state.direction;
    Motion.pose[eid] = state.pose;
    Motion.since[eid] = this.elapsed;
    Motion.emote[eid] = state.emote ? 1 : 0;
    Motion.emoteSince[eid] = this.elapsed;
    Motion.jump[eid] = state.jump ? 1 : 0;
    Motion.jumpSince[eid] = this.elapsed;
    Motion.wave[eid] = state.wave ? 1 : 0;
    Motion.waveSince[eid] = this.elapsed;
    void this.renderer.addEntity(id, name, appearance);
  }

  private handleDespawn(id: number): void {
    this.names.delete(id);
    this.ecs.despawn(id);
    this.renderer.removeEntity(id);
  }

  private handleSync(entities: ReadonlyArray<{ id: number; x: number; y: number; state: number }>): void {
    for (const entry of entities) {
      const eid = this.ecs.get(entry.id);
      if (eid === 0) continue;
      const sx = dequantizeCoord(entry.x);
      const sy = dequantizeCoord(entry.y);
      const state = unpackState(entry.state);

      if (entry.id === this.localId) {
        // 本地预测是确定性的（与服务端共用 MOVE_SPEED + resolveMotion），
        // 而 sync 坐标只是「客户端上包位置」的回声，必然落后一段网络与 Tick 时间。
        // 逐包按比例拉回会把这层延迟变成 20Hz 位置锯齿，直接传到相机上；
        // 因此移动中以本地预测为准，只在偏差超过合法延迟上限时一次性对齐（ADR-0021）。
        const dx = sx - Position.x[eid]!;
        const dy = sy - Position.y[eid]!;
        if (Math.hypot(dx, dy) > MOVEMENT_CONFIG.LOCAL_DRIFT_LIMIT) {
          Position.x[eid] = sx;
          Position.y[eid] = sy;
        }
        Target.x[eid] = Position.x[eid]!;
        Target.y[eid] = Position.y[eid]!;
        continue;
      }

      Target.x[eid] = sx;
      Target.y[eid] = sy;
      
      // P1：三层位移处理策略
      const curX = Position.x[eid]!;
      const curY = Position.y[eid]!;
      const distance = Math.hypot(sx - curX, sy - curY);
      const now = performance.now();
      
      if (distance > MOVEMENT_CONFIG.TELEPORT_THRESHOLD) {
        // 极端位移（>1000px）：瞬移（如重生、传送）
        Position.x[eid] = sx;
        Position.y[eid] = sy;
        // 重置快照
        Snapshot.currentTime[eid] = now;
        Snapshot.prevTime[eid] = now;
        Snapshot.currentX[eid] = sx;
        Snapshot.currentY[eid] = sy;
        Snapshot.prevX[eid] = sx;
        Snapshot.prevY[eid] = sy;
      } else if (distance > MOVEMENT_CONFIG.LARGE_DISPLACEMENT_THRESHOLD) {
        // 大位移（320-1000px）：平滑纠正而非瞬间跳变
        const factor = Math.min(distance / MOVEMENT_CONFIG.LARGE_DISPLACEMENT_THRESHOLD, 1.0);
        Position.x[eid] = lerp(curX, sx, factor * MOVEMENT_CONFIG.SMOOTH_CORRECTION_FACTOR);
        Position.y[eid] = lerp(curY, sy, factor * MOVEMENT_CONFIG.SMOOTH_CORRECTION_FACTOR);
        
        // 保存快照用于后续时间线插值
        Snapshot.prevTime[eid] = Snapshot.currentTime[eid];
        Snapshot.prevX[eid] = Snapshot.currentX[eid];
        Snapshot.prevY[eid] = Snapshot.currentY[eid];
        Snapshot.currentTime[eid] = now;
        Snapshot.currentX[eid] = sx;
        Snapshot.currentY[eid] = sy;
      } else {
        // 小位移（<320px）：保存快照用于时间线插值
        Snapshot.prevTime[eid] = Snapshot.currentTime[eid];
        Snapshot.prevX[eid] = Snapshot.currentX[eid];
        Snapshot.prevY[eid] = Snapshot.currentY[eid];
        Snapshot.currentTime[eid] = now;
        Snapshot.currentX[eid] = sx;
        Snapshot.currentY[eid] = sy;
      }
      
      Motion.direction[eid] = state.direction;
      // 动作变了才重置起始时刻：同一姿态的重复同步不能把动画打回第 0 帧
      if (Motion.pose[eid] !== state.pose) {
        Motion.pose[eid] = state.pose as Pose;
        Motion.since[eid] = this.elapsed;
      }
      Motion.moving[eid] = state.moving ? 1 : 0;
      // 叠加动作按位同步：上升沿起播、位清零立即停。丢包最多漏掉一次，不会永久张嘴 / 抬手
      this.applyOverlayBit(eid, Motion.emote, Motion.emoteSince, state.emote);
      this.applyOverlayBit(eid, Motion.jump, Motion.jumpSince, state.jump);
      this.applyOverlayBit(eid, Motion.wave, Motion.waveSince, state.wave);
    }
  }

  /** 远端叠加位：只在 0 → 1 的那一刻记起始时刻，1 → 0 立刻停 */
  private applyOverlayBit(eid: number, flag: Uint8Array, since: Float64Array, active: boolean): void {
    if (!active) {
      flag[eid] = 0;
      return;
    }
    if (flag[eid] === 1) return;
    flag[eid] = 1;
    since[eid] = this.elapsed;
  }

  /**
   * 座位广播：镜像占用表并同步工位显示器。
   * 本人的座位以服务端为准：被占走（抢座失败）则退回地面坐，服务端分到别的座位则吸附过去。
   */
  private handleSeatState(entries: ReadonlyArray<SeatStateEntry>): void {
    for (const entry of entries) {
      const seat = seatById(entry.seatId);
      if (!seat) continue;
      if (entry.occupant === 0) this.seatOwner.delete(entry.seatId);
      else this.seatOwner.set(entry.seatId, entry.occupant);
      this.renderer.setSeatOccupied(entry.seatId, entry.occupant !== 0);

      if (entry.occupant === this.localId) {
        if (this.sitIntent && this.localSeat !== entry.seatId) this.sitAt(seat);
      } else if (entry.seatId === this.localSeat) {
        // 预测的座位被别人先占走：本地退回地面坐，随后服务端若分到新座位会再吸附过去
        this.localSeat = 0;
      }
    }
  }

  /** 吸附到座位：位置与朝向都按座位锚点，姿态为坐。叠加动作一并清掉 */
  private sitAt(seat: SeatInstance): void {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;
    this.localSeat = seat.id;
    Position.x[eid] = seat.x;
    Position.y[eid] = seat.y;
    Target.x[eid] = seat.x;
    Target.y[eid] = seat.y;
    Motion.direction[eid] = seat.facing;
    this.setLocalPose(eid, POSE.Sit);
    this.clearOverlays(eid);
    Motion.moving[eid] = 0;
  }

  /** 起身：本地立即回到站立，并通知服务端释放座位 */
  private standUp(): void {
    if (this.localSeat === 0) return;
    this.localSeat = 0;
    this.sitIntent = false;
    const eid = this.ecs.get(this.localId);
    if (eid) this.setLocalPose(eid, POSE.Idle);
    this.net?.sendAction(this.localId, ACTION.Stand);
  }

  private setLocalPose(eid: number, pose: Pose): void {
    if (Motion.pose[eid] !== pose) {
      Motion.pose[eid] = pose;
      Motion.since[eid] = this.elapsed;
    }
  }

  private clearOverlays(eid: number): void {
    Motion.emote[eid] = 0;
    Motion.jump[eid] = 0;
    Motion.wave[eid] = 0;
  }

  /** 附近有可坐的空闲座位，或正坐在座位上时，给出提示文案 */
  private updateSeatHint(eid: number): void {
    let hint: string | null = null;
    if (this.localSeat !== 0) {
      hint = '移动即可起身';
    } else {
      const seat = findNearestSeat(Position.x[eid]!, Position.y[eid]!, (id) => !this.seatOwner.has(id));
      if (seat) hint = seat.kind === 'toilet' ? '按 Z 使用马桶' : '按 Z 坐到工位';
    }
    if (hint === this.seatHint) return;
    this.seatHint = hint;
    this.callbacks.onSeatHint(hint);
  }

  private handleChat(entityId: number, msgId: number, text: string): void {
    this.renderer.showBubble(entityId, text);
    this.callbacks.onChat({
      id: msgId,
      name: entityId === this.localId ? '我' : this.names.get(entityId) ?? '匿名牛马',
      text,
      at: Date.now(),
      self: entityId === this.localId,
    });
  }

  private clearWorld(): void {
    for (const id of this.names.keys()) {
      this.ecs.despawn(id);
      this.renderer.removeEntity(id);
    }
    this.names.clear();
    for (const seatId of this.seatOwner.keys()) this.renderer.setSeatOccupied(seatId, false);
    this.seatOwner.clear();
    this.localSeat = 0;
    this.sitIntent = false;
    this.localId = 0;
  }

  /** 被拒后由用户显式重试：重置拒绝态并立刻重连，不等指数退避 */
  retry(): void {
    this.callbacks.onRejected(0);
    this.callbacks.onQueue(null);
    this.callbacks.onStatus('connecting', '重新排队');
    this.net?.retry();
  }

  sendChat(text: string): void {
    if (text.trim().length === 0) return;
    this.net?.sendChat(text);
  }

  setAppearance(appearance: CharacterAppearance): void {
    this.net?.sendAppearance(appearance);
    if (this.localId) this.renderer.setAppearance(this.localId, appearance);
  }

  /** 触屏摇杆：把屏幕摇杆方向交给输入层，与键盘共用同一条移动通路 */
  setMoveVector(x: number, y: number): void {
    this.input.setTouchVector(x, y);
  }

  perform(action: ActionKey): void {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;

    if (action === 'sit' || action === 'lie') {
      // 已经坐在座位上：Z 与 X 都不再生效，移动才会起身
      if (this.localSeat !== 0) return;
      if (action === 'sit') {
        this.sitIntent = true;
        const seat = findNearestSeat(Position.x[eid]!, Position.y[eid]!, (id) => !this.seatOwner.has(id));
        if (seat) {
          this.sitAt(seat);
          this.net?.sendAction(this.localId, ACTION.Sit);
          return;
        }
      }
      const pose = action === 'sit' ? POSE.Sit : POSE.Lie;
      this.setLocalPose(eid, pose);
      // 切姿势会打断叠加动作
      this.clearOverlays(eid);
      Motion.moving[eid] = 0;
      this.net?.sendAction(this.localId, action === 'sit' ? ACTION.Sit : ACTION.Lie);
      return;
    }

    if (action === 'jump') {
      // 坐 / 躺先起身再跳：跳跃是位移动作，躺着原地起跳读不懂。
      // 行走中直接起跳：pose 与 moving 都不动，跳跃帧播完自然接回走路循环。
      this.standUp();
      if (Motion.pose[eid] !== POSE.Walk && Motion.pose[eid] !== POSE.Idle) {
        this.setLocalPose(eid, POSE.Idle);
      }
      this.startOverlay(eid, 'jump');
      return;
    }

    // 叫唤与打招呼只在站定时触发：图集没有行走叫唤 / 挥手帧，套到脚步上就是滑步
    if (Motion.pose[eid] === POSE.Walk || Motion.moving[eid] === 1) return;
    this.startOverlay(eid, action === 'wave' ? 'wave' : 'emote');
    Motion.moving[eid] = 0;
  }

  /** 三个叠加动作互斥：后按的打断先按的，连按从第 0 帧重播 */
  private startOverlay(eid: number, kind: 'emote' | 'jump' | 'wave'): void {
    Motion.emote[eid] = kind === 'emote' ? 1 : 0;
    Motion.jump[eid] = kind === 'jump' ? 1 : 0;
    Motion.wave[eid] = kind === 'wave' ? 1 : 0;
    if (kind === 'jump') Motion.jumpSince[eid] = this.elapsed;
    else if (kind === 'wave') Motion.waveSince[eid] = this.elapsed;
    else Motion.emoteSince[eid] = this.elapsed;
  }

  /**
   * 当前该画哪一列：叠加动作（跳 > 叫唤）→ 基础姿态 → 时间轴 → 每实体相位偏移。
   * 姿态从不因叠加动作改写，所以「坐着叫唤完还是坐着」不需要任何回滚逻辑。
   */
  private columnFor(netId: number, eid: number): number {
    const pose = Motion.pose[eid]! as Pose;
    const jumping = Motion.jump[eid] === 1;
    const emoting = Motion.emote[eid] === 1;
    const waving = Motion.wave[eid] === 1;
    const overlay = overlayTrackFor(this.overlays, pose, emoting, jumping, waving);
    const track = overlay ?? this.baseTracks[pose] ?? this.tracks.idle!;
    // 起始时刻与 overlayTrackFor 的优先级同序：跳 > 打招呼 > 叫唤（三者互斥，正常只命中一个）
    const since =
      overlay === null
        ? Motion.since[eid]!
        : jumping
          ? Motion.jumpSince[eid]!
          : waving
            ? Motion.waveSince[eid]!
            : Motion.emoteSince[eid]!;
    return frameAt(track, this.elapsed - since + phaseOffset(netId, track));
  }

  /** 叠加动作到期自动清位：下一包 sync 就把位降下去，远端不会残留张嘴 / 抬手帧 */
  private expireOverlays(): void {
    for (const eid of this.ecs.entities()) {
      if (Motion.emote[eid] === 1 && this.elapsed - Motion.emoteSince[eid]! >= this.overlays.emoteMs) {
        Motion.emote[eid] = 0;
      }
      if (Motion.jump[eid] === 1 && this.elapsed - Motion.jumpSince[eid]! >= this.overlays.jumpMs) {
        Motion.jump[eid] = 0;
      }
      if (Motion.wave[eid] === 1 && this.elapsed - Motion.waveSince[eid]! >= this.overlays.waveMs) {
        Motion.wave[eid] = 0;
      }
    }
  }

  private tick = (ticker: { deltaMS: number }): void => {
    const dtMs = Math.min(ticker.deltaMS, 50);
    const dt = dtMs / 1000;
    const now = performance.now();
    this.elapsed += dtMs;
    this.frames += 1;
    this.expireOverlays();

    const localEid = this.ecs.get(this.localId);
    if (localEid) {
      const vector = this.input.vector();
      const moving = vector.x !== 0 || vector.y !== 0;
      // 座位上一按方向键就起身：位置留在椅子旁，之后按正常移动走
      if (moving && this.localSeat !== 0) this.standUp();
      if (moving) {
        const prevX = Position.x[localEid]!;
        const prevY = Position.y[localEid]!;
        const nextX = clamp(prevX + vector.x * MOVE_SPEED * dt, 0, WORLD_WIDTH - 1);
        const nextY = clamp(prevY + vector.y * MOVE_SPEED * dt, 0, WORLD_HEIGHT - 1);
        // 与服务端同一个求解函数：本地预测不会出现「先穿墙再被拉回」
        const resolved = resolveMotion(prevX, prevY, nextX, nextY);
        const advanced = Math.abs(resolved.x - prevX) + Math.abs(resolved.y - prevY) > 0.01;
        Position.x[localEid] = resolved.x;
        Position.y[localEid] = resolved.y;
        Motion.direction[localEid] = directionFromVector(vector.x, vector.y, Motion.direction[localEid] as Direction);
        // 顶在围栏上时原地踏步会露馅：没有实际位移就当站定
        if (advanced) {
          // 走动打断叫唤与打招呼（都没有行走帧）；跳跃是位移动作，不能在这里清位，
          // 否则「边走边跳」按下即被自己掐掉
          Motion.emote[localEid] = 0;
          Motion.wave[localEid] = 0;
          if (Motion.pose[localEid] !== POSE.Walk) {
            Motion.pose[localEid] = POSE.Walk;
            Motion.since[localEid] = this.elapsed;
          }
          Motion.moving[localEid] = 1;
        } else {
          if (Motion.pose[localEid] === POSE.Walk) {
            Motion.pose[localEid] = POSE.Idle;
            Motion.since[localEid] = this.elapsed;
          }
          Motion.moving[localEid] = 0;
        }
      } else {
        if (Motion.pose[localEid] === POSE.Walk) {
          Motion.pose[localEid] = POSE.Idle;
          Motion.since[localEid] = this.elapsed;
        }
        Motion.moving[localEid] = 0;
      }
    }

    for (const eid of this.ecs.entities()) {
      if (Local.flag[eid] === 1) continue;
      
      // P1：时间线插值
      const now = performance.now();
      const currentTime = Snapshot.currentTime[eid]!;
      const prevTime = Snapshot.prevTime[eid]!;
      const timeDiff = currentTime - prevTime;
      
      // 检查是否有有效的快照对（时间差 > 0 且 < 1000ms）
      if (timeDiff > 0 && timeDiff < 1000) {
        const elapsedSinceSnapshot = now - currentTime;
        const progress = elapsedSinceSnapshot / timeDiff;
        
        // 如果还在快照区间内，使用时间线插值
        if (progress < 1) {
          const clampedProgress = clamp(progress, 0, 1);
          const snapshotX = Snapshot.prevX[eid]!;
          const snapshotY = Snapshot.prevY[eid]!;
          const targetX = Snapshot.currentX[eid]!;
          const targetY = Snapshot.currentY[eid]!;
          Position.x[eid] = lerp(snapshotX, targetX, clampedProgress);
          Position.y[eid] = lerp(snapshotY, targetY, clampedProgress);
        } else {
          // 进度超过1，切换到指数插值向目标逼近
          const k = 1 - Math.exp(-dt * MOVEMENT_CONFIG.INTERPOLATION_FACTOR);
          Position.x[eid] = Position.x[eid]! + (Target.x[eid]! - Position.x[eid]!) * k;
          Position.y[eid] = Position.y[eid]! + (Target.y[eid]! - Position.y[eid]!) * k;
        }
      } else {
        // 没有有效快照，使用指数插值作为回退
        const k = 1 - Math.exp(-dt * MOVEMENT_CONFIG.INTERPOLATION_FACTOR);
        Position.x[eid] = Position.x[eid]! + (Target.x[eid]! - Position.x[eid]!) * k;
        Position.y[eid] = Position.y[eid]! + (Target.y[eid]! - Position.y[eid]!) * k;
      }
    }

    for (const netId of this.names.keys()) {
      const eid = this.ecs.get(netId);
      if (!eid) continue;
      const x = Position.x[eid]!;
      const y = Position.y[eid]!;
      
      // 始终更新位置（同步网络状态）
      this.renderer.updateEntity(netId, x, y);
      
      // 只对可见实体更新动画状态（setPose）以减少 CPU 开销
      // 使用相机边界判定可见性，范围扩大至 256 纹素以确保边界附近的实体也能及时更新
      const cameraBounds = this.renderer.getCameraBounds();
      const isVisible = !cameraBounds || (
        x >= cameraBounds.minX - 256 &&
        x <= cameraBounds.maxX + 256 &&
        y >= cameraBounds.minY - 256 &&
        y <= cameraBounds.maxY + 256
      );
      
      if (isVisible) {
        this.renderer.setPose(netId, Motion.direction[eid]!, this.columnFor(netId, eid));
        // 跳跃弧线：图集只负责姿势与 5 纹素腾空，剩下的落差与阴影由客户端叠
        const jumping = Motion.jump[eid] === 1;
        const lift = jumping ? jumpLiftTexels(this.elapsed - Motion.jumpSince[eid]!, this.overlays.jumpMs) : 0;
        this.renderer.setJump(netId, lift, jumpShadowFor(lift));
      }
    }

    if (localEid) {
      this.renderer.updateCamera(Position.x[localEid]!, Position.y[localEid]!);
      
      // 独立的网络发送时钟：不依赖帧率
      this.movementSendTime += dtMs;
      if (this.movementSendTime >= this.MOVEMENT_SEND_INTERVAL) {
        this.movementSendTime -= this.MOVEMENT_SEND_INTERVAL; // 模运算避免累积错误
        const state = packState(
          Motion.direction[localEid]! as Direction,
          Motion.pose[localEid]! as Pose,
          Motion.moving[localEid] === 1,
          Motion.emote[localEid] === 1,
          Motion.jump[localEid] === 1,
          Motion.wave[localEid] === 1,
        );
        const clientSequence = ++this.clientMoveSequence;
        // 使用 performance.now() 的低 32 位，适用于 RTT 估计
        const clientTimestampMs = Math.floor(performance.now()) >>> 0;
        this.net?.sendMove(
          quantizeCoord(Position.x[localEid]!), 
          quantizeCoord(Position.y[localEid]!), 
          state,
          clientSequence,
          clientTimestampMs,
        );
      }
    }

    this.renderer.tickBubbles(dtMs);

    if (localEid) {
      this.seatHintAt += dtMs;
      if (this.seatHintAt >= SEAT_HINT_INTERVAL) {
        this.seatHintAt = 0;
        this.updateSeatHint(localEid);
      }
    }

    if (now - this.statsAt >= STATS_INTERVAL) {
      const windowMs = now - this.statsAt;
      this.fps = Math.round((this.frames * 1000) / windowMs);
      this.frames = 0;
      this.statsAt = now;
      this.callbacks.onStats({
        fps: this.fps,
        ping: this.ping,
        x: localEid ? Math.round(Position.x[localEid]!) : 0,
        y: localEid ? Math.round(Position.y[localEid]!) : 0,
        nearby: this.names.size,
        backend: this.renderer.backend,
      });
    }
  };

  /**
   * 小地图快照：世界绝对坐标，4Hz 调用，不进入渲染循环。
   * 返回绝对坐标而不是相对坐标，是因为小地图要同时画地形与玩家，得共用一套世界变换。
   */
  worldSnapshot(limit = 128): WorldSnapshot {
    const localEid = this.ecs.get(this.localId);
    if (!localEid) return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, region: '', points: [] };
    const x = Position.x[localEid]!;
    const y = Position.y[localEid]!;
    const points: WorldSnapshot['points'] = [];
    for (const netId of this.names.keys()) {
      const eid = this.ecs.get(netId);
      if (!eid) continue;
      points.push({
        x: netId === this.localId ? x : Position.x[eid]!,
        y: netId === this.localId ? y : Position.y[eid]!,
        self: netId === this.localId,
      });
      if (points.length >= limit) break;
    }
    return { x, y, region: regionAt(x, y), points };
  }

  stop(): void {
    this.disposed = true;
    this.input.detach();
    this.net?.dispose();
    this.net = null;
    this.renderer.app.ticker.remove(this.tick);
    this.renderer.destroy();
  }
}
