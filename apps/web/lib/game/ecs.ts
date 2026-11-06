'use client';

import { addComponent, addEntity, createWorld, query, removeEntity, type QueryResult } from 'bitecs';

const CAPACITY = 4096;

/**
 * SoA 组件：TypedArray 直接按 eid 索引，运行期不产生对象，避免 GC 抖动。
 * bitecs 只负责实体生命周期与查询，数据布局由这里掌控。
 */
export const Position = { x: new Float32Array(CAPACITY), y: new Float32Array(CAPACITY) };
export const Target = { x: new Float32Array(CAPACITY), y: new Float32Array(CAPACITY) };
/** 远端角色位置快照：用于时间线插值 */
export const Snapshot = {
  /** 当前快照时间戳（客户端接收时间）*/
  currentTime: new Float64Array(CAPACITY),
  /** 上一次快照时间戳 */
  prevTime: new Float64Array(CAPACITY),
  /** 当前快照 X 坐标 */
  currentX: new Float32Array(CAPACITY),
  /** 当前快照 Y 坐标 */
  currentY: new Float32Array(CAPACITY),
  /** 上一次快照 X 坐标 */
  prevX: new Float32Array(CAPACITY),
  /** 上一次快照 Y 坐标 */
  prevY: new Float32Array(CAPACITY),
};
export const Motion = {
  direction: new Uint8Array(CAPACITY),
  pose: new Uint8Array(CAPACITY),
  moving: new Uint8Array(CAPACITY),
  /** 当前动作的起始时刻（ms）：换动作时重置，动画从第 0 帧起播 */
  since: new Float64Array(CAPACITY),
  /**
   * 叫唤 / 跳 / 打招呼：与姿态正交的一次性叠加动作。
   * 开关 + 各自起始时刻；姿态不因它们改变，所以播完天然回到原姿势（ADR-0018 / ADR-0019）。
   */
  emote: new Uint8Array(CAPACITY),
  emoteSince: new Float64Array(CAPACITY),
  jump: new Uint8Array(CAPACITY),
  jumpSince: new Float64Array(CAPACITY),
  wave: new Uint8Array(CAPACITY),
  waveSince: new Float64Array(CAPACITY),
};
export const Local = { flag: new Uint8Array(CAPACITY) };

export const POSE = { Idle: 0, Walk: 1, Sit: 2, Lie: 3, Emote: 4 } as const;

export class Ecs {
  readonly world = createWorld();
  private readonly byNetId = new Map<number, number>();

  spawn(netId: number, x: number, y: number): number {
    const eid = addEntity(this.world);
    addComponent(this.world, eid, Position);
    addComponent(this.world, eid, Target);
    addComponent(this.world, eid, Motion);
    Position.x[eid] = x;
    Position.y[eid] = y;
    Target.x[eid] = x;
    Target.y[eid] = y;
    Motion.direction[eid] = 0;
    Motion.pose[eid] = POSE.Idle;
    Motion.moving[eid] = 0;
    Motion.since[eid] = 0;
    Motion.emote[eid] = 0;
    Motion.emoteSince[eid] = 0;
    Motion.jump[eid] = 0;
    Motion.jumpSince[eid] = 0;
    Motion.wave[eid] = 0;
    Motion.waveSince[eid] = 0;
    // 初始化快照数据
    const now = performance.now();
    Snapshot.currentTime[eid] = now;
    Snapshot.prevTime[eid] = now;
    Snapshot.currentX[eid] = x;
    Snapshot.currentY[eid] = y;
    Snapshot.prevX[eid] = x;
    Snapshot.prevY[eid] = y;
    this.byNetId.set(netId, eid);
    return eid;
  }

  markLocal(netId: number): number {
    const eid = this.byNetId.get(netId);
    if (eid === undefined) return 0;
    addComponent(this.world, eid, Local);
    Local.flag[eid] = 1;
    return eid;
  }

  despawn(netId: number): void {
    const eid = this.byNetId.get(netId);
    if (eid === undefined) return;
    this.byNetId.delete(netId);
    removeEntity(this.world, eid);
  }

  get(netId: number): number {
    return this.byNetId.get(netId) ?? 0;
  }

  entities(): QueryResult {
    return query(this.world, [Position, Motion]);
  }
}
