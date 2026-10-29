'use client';

import {
  ACTION,
  MOVE_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  dequantizeCoord,
  directionFromVector,
  packState,
  quantizeCoord,
  unpackState,
  type CharacterAppearance,
  type Direction,
  type Pose,
} from '@niuma/shared-types';
import { NetClient } from '../net/client';
import { frameForPose } from './atlas';
import { Ecs, Local, Motion, POSE, Position, Target } from './ecs';
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

export interface SessionCallbacks {
  onStatus(status: 'connecting' | 'online' | 'offline' | 'error', detail?: string): void;
  onStats(stats: SessionStats): void;
  onChat(entry: ChatEntry): void;
  onRequestChat(): void;
}

const POSE_NAMES = ['idle', 'walk', 'sit', 'lie', 'emote'];
const SEND_INTERVAL = 50;
const STATS_INTERVAL = 500;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class GameSession {
  private readonly renderer = new GameRenderer();
  private readonly ecs = new Ecs();
  private readonly input = new InputController();
  private readonly names = new Map<number, string>();
  private net: NetClient | null = null;
  private localId = 0;
  private elapsed = 0;
  private lastSend = 0;
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
      onOpen: () => this.callbacks.onStatus('online', this.renderer.backend),
      onClose: () => this.callbacks.onStatus('offline', '连接中断，正在重连'),
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
      if (Math.hypot(sx - Position.x[eid]!, sy - Position.y[eid]!) > 320) {
        Position.x[eid] = sx;
        Position.y[eid] = sy;
      }
      Motion.direction[eid] = state.direction;
      Motion.pose[eid] = state.pose === POSE.Emote ? POSE.Idle : (state.pose as Pose);
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
      this.net?.sendAction(this.localId, ACTION.Sit);
    } else if (action === 'lie') {
      Motion.pose[eid] = POSE.Lie;
      this.net?.sendAction(this.localId, ACTION.Lie);
    } else {
      Motion.pose[eid] = POSE.Emote;
      this.net?.sendAction(this.localId, ACTION.Emote);
    }
    Motion.moving[eid] = 0;
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
        Position.x[localEid] = clamp(Position.x[localEid]! + vector.x * MOVE_SPEED * dt, 0, WORLD_WIDTH - 1);
        Position.y[localEid] = clamp(Position.y[localEid]! + vector.y * MOVE_SPEED * dt, 0, WORLD_HEIGHT - 1);
        Motion.direction[localEid] = directionFromVector(vector.x, vector.y, Motion.direction[localEid] as Direction);
        Motion.pose[localEid] = POSE.Walk;
        Motion.moving[localEid] = 1;
      } else {
        if (Motion.pose[localEid] === POSE.Walk) Motion.pose[localEid] = POSE.Idle;
        Motion.moving[localEid] = 0;
      }
    }

    for (const eid of this.ecs.entities()) {
      if (Local.flag[eid] === 1) continue;
      const k = 1 - Math.exp(-dt * 14);
      Position.x[eid] = Position.x[eid]! + (Target.x[eid]! - Position.x[eid]!) * k;
      Position.y[eid] = Position.y[eid]! + (Target.y[eid]! - Position.y[eid]!) * k;
    }

    for (const netId of this.names.keys()) {
      const eid = this.ecs.get(netId);
      if (!eid) continue;
      this.renderer.updateEntity(netId, Position.x[eid]!, Position.y[eid]!);
      const poseName = POSE_NAMES[Motion.pose[eid]!] ?? 'idle';
      const clip = frameForPose(poseName, this.elapsed);
      this.renderer.setFrame(netId, Motion.direction[eid]! * 8 + clip);
    }

    if (localEid) {
      this.renderer.updateCamera(Position.x[localEid]!, Position.y[localEid]!);
      if (now - this.lastSend >= SEND_INTERVAL) {
        this.lastSend = now;
        const state = packState(Motion.direction[localEid]! as Direction, Motion.pose[localEid]! as Pose, Motion.moving[localEid] === 1);
        this.net?.sendMove(quantizeCoord(Position.x[localEid]!), quantizeCoord(Position.y[localEid]!), state);
      }
    }

    this.renderer.tickBubbles();

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

  /** 小地图采样：以本地玩家为原点的相对坐标，4Hz 调用，不进入渲染循环 */
  sampleNearby(limit = 128): Array<{ x: number; y: number; self: boolean }> {
    const localEid = this.ecs.get(this.localId);
    if (!localEid) return [];
    const lx = Position.x[localEid]!;
    const ly = Position.y[localEid]!;
    const points: Array<{ x: number; y: number; self: boolean }> = [];
    for (const netId of this.names.keys()) {
      const eid = this.ecs.get(netId);
      if (!eid) continue;
      if (netId === this.localId) {
        points.push({ x: 0, y: 0, self: true });
      } else {
        points.push({ x: Position.x[eid]! - lx, y: Position.y[eid]! - ly, self: false });
      }
      if (points.length >= limit) break;
    }
    return points;
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
