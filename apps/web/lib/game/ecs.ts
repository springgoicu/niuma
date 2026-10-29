'use client';

import { addComponent, addEntity, createWorld, query, removeEntity, type QueryResult } from 'bitecs';

const CAPACITY = 4096;

/**
 * SoA 组件：TypedArray 直接按 eid 索引，运行期不产生对象，避免 GC 抖动。
 * bitecs 只负责实体生命周期与查询，数据布局由这里掌控。
 */
export const Position = { x: new Float32Array(CAPACITY), y: new Float32Array(CAPACITY) };
export const Target = { x: new Float32Array(CAPACITY), y: new Float32Array(CAPACITY) };
export const Motion = {
  direction: new Uint8Array(CAPACITY),
  pose: new Uint8Array(CAPACITY),
  moving: new Uint8Array(CAPACITY),
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
