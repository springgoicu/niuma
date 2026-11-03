'use client';

import {
  ACTION,
  MOVE_SPEED,
  QUEUE_REJECT_REASON,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  dequantizeCoord,
  directionFromVector,
  packState,
  quantizeCoord,
  regionAt,
  resolveMotion,
  unpackState,
  type CharacterAppearance,
  type Direction,
  type Pose,
  type QueueStatusPacket,
} from '@niuma/shared-types';
import { NetClient } from '../net/client';
import { buildClipTracks, clipDuration, frameAt, phaseOffset } from './clip';
import { Ecs, Local, Motion, POSE, Position, Snapshot, Target } from './ecs';
import { InputController, type ActionKey } from './input';
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
}

const POSE_NAMES = ['idle', 'walk', 'sit', 'lie', 'emote'];
const SEND_INTERVAL = 50;
const STATS_INTERVAL = 500;
/** 叫唤是一次性动作：播完由本地回落待机，并把新状态广播出去 */
const EMOTE_MS = 440;

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
  private readonly emoteMs = Math.max(EMOTE_MS, clipDuration(this.tracks.emote));
  private readonly input = new InputController();
  private readonly names = new Map<number, string>();
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
      onSpawn: (packet) => this.handleSpawn(packet.id, packet.name, packet.appearance, packet.x, packet.y),
      onDespawn: (id) => this.handleDespawn(id),
      onSync: (_tick, entities) => this.handleSync(entities),
      onChat: (packet) => this.handleChat(packet.entityId, packet.msgId, packet.text),
      onAppearance: (id, appearance) => this.renderer.setAppearance(id, appearance),
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

  private handleSpawn(id: number, name: string, appearance: CharacterAppearance, x: number, y: number): void {
    if (this.names.has(id)) return;
    this.names.set(id, name);
    this.ecs.spawn(id, dequantizeCoord(x), dequantizeCoord(y));
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
        const dx = sx - Position.x[eid]!;
        const dy = sy - Position.y[eid]!;
        if (Math.hypot(dx, dy) > 8) {
          Position.x[eid] = sx;
          Position.y[eid] = sy;
        } else {
          Position.x[eid] = Position.x[eid]! + dx * 0.35;
          Position.y[eid] = Position.y[eid]! + dy * 0.35;
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
    }
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

  perform(action: ActionKey): void {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;
    if (action === 'sit') {
      Motion.pose[eid] = POSE.Sit;
      Motion.since[eid] = this.elapsed;
      this.net?.sendAction(this.localId, ACTION.Sit);
    } else if (action === 'lie') {
      Motion.pose[eid] = POSE.Lie;
      Motion.since[eid] = this.elapsed;
      this.net?.sendAction(this.localId, ACTION.Lie);
    } else {
      // 连按也要能重新播：起始时刻强制归零
      Motion.pose[eid] = POSE.Emote;
      Motion.since[eid] = this.elapsed;
      this.net?.sendAction(this.localId, ACTION.Emote);
    }
    Motion.moving[eid] = 0;
  }

  /** 当前该画哪一列：动作 → 时间轴 → 每实体相位偏移 */
  private columnFor(netId: number, eid: number): number {
    const pose = this.resolvePose(eid);
    const track = this.tracks[POSE_NAMES[pose] ?? 'idle'] ?? this.tracks.idle!;
    return frameAt(track, this.elapsed - Motion.since[eid]! + phaseOffset(netId, track));
  }

  /**
   * 叫唤是一次性动作：本地播完自动回待机，下一个同步包就把 Idle 广播出去。
   * 远端不在这里回收——服务端会一直重发 Emote，本地回收会和重发打架，变成无限循环。
   */
  private resolvePose(eid: number): number {
    const pose = Motion.pose[eid]!;
    if (pose !== POSE.Emote) return pose;
    if (eid !== this.ecs.get(this.localId)) return pose;
    if (this.elapsed - Motion.since[eid]! < this.emoteMs) return pose;
    Motion.pose[eid] = POSE.Idle;
    Motion.since[eid] = this.elapsed;
    return POSE.Idle;
  }

  private tick = (ticker: { deltaMS: number }): void => {
    const dtMs = Math.min(ticker.deltaMS, 50);
    const dt = dtMs / 1000;
    const now = performance.now();
    this.elapsed += dtMs;
    this.frames += 1;

    const localEid = this.ecs.get(this.localId);
    if (localEid) {
      const vector = this.input.vector();
      const moving = vector.x !== 0 || vector.y !== 0;
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
      }
    }

    if (localEid) {
      this.renderer.updateCamera(Position.x[localEid]!, Position.y[localEid]!);
      
      // 独立的网络发送时钟：不依赖帧率
      this.movementSendTime += dtMs;
      if (this.movementSendTime >= this.MOVEMENT_SEND_INTERVAL) {
        this.movementSendTime -= this.MOVEMENT_SEND_INTERVAL; // 模运算避免累积错误
        const state = packState(Motion.direction[localEid]! as Direction, Motion.pose[localEid]! as Pose, Motion.moving[localEid] === 1);
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
