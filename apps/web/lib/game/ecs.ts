'use client';

import { addComponent, addEntity, createWorld, query, removeEntity, type QueryResult } from 'bitecs';
import { RemoteTrack } from './interp';

const CAPACITY = 4096;

/**
 * SoA 组件：TypedArray 直接按 eid 索引，运行期不产生对象，避免 GC 抖动。
 * bitecs 只负责实体生命周期与查询，数据布局由这里掌控。
 */
export const Position = { x: new Float32Array(CAPACITY), y: new Float32Array(CAPACITY) };
export const Motion = {
  direction: new Uint8Array(CAPACITY),
  pose: new Uint8Array(CAPACITY),
  moving: new Uint8Array(CAPACITY),
  /** 当前动作的起始时刻（ms）：换动作时重置，动画从第 0 帧起播 */
  since: new Float64Array(CAPACITY),
  /**
   * 发泄 / 跳 / 打招呼：与姿态正交的一次性叠加动作。
   * 开关 + 各自起始时刻；姿态不因它们改变，所以播完天然回到原姿势（ADR-0051 / ADR-0019）。
   */
  vent: new Uint8Array(CAPACITY),
  ventSince: new Float64Array(CAPACITY),
  jump: new Uint8Array(CAPACITY),
  jumpSince: new Float64Array(CAPACITY),
  wave: new Uint8Array(CAPACITY),
  waveSince: new Float64Array(CAPACITY),
};
export const Local = { flag: new Uint8Array(CAPACITY) };

/** GTA 扩展状态组件：全部定长 TypedArray，帧循环零分配 */
export const GtaState = {
  role: new Uint8Array(CAPACITY),
  wantedStars: new Uint8Array(CAPACITY),
  wantedBounty: new Uint16Array(CAPACITY),
  ghostMode: new Uint8Array(CAPACITY),
  ghostUntil: new Float64Array(CAPACITY),
  fishingState: new Uint8Array(CAPACITY),
  vehicleId: new Uint16Array(CAPACITY),
  /** 0=无；1=滑倒(Slip)；2=翻滚(Tumble)；3=龙卷飞(Tornado) */
  fallKind: new Uint8Array(CAPACITY),
  fallUntil: new Float64Array(CAPACITY),
};

export const POSE = { Idle: 0, Walk: 1, Sit: 2, Lie: 3 } as const;

export class Ecs {
  readonly world = createWorld();
  private readonly byNetId = new Map<number, number>();
  /**
   * eid → netId 反查。帧循环原本用 `byNetId.get()` 为每个实体查三次 Map，
   * 摊平成数组后一次遍历就能同时拿到两侧身份。
   */
  readonly netOf = new Int32Array(CAPACITY);
  /** 远端位置回放缓冲：收到同步先入环形，帧循环再按固定延迟采样 */
  readonly remote = new RemoteTrack(CAPACITY);

  spawn(netId: number, x: number, y: number): number {
    const eid = addEntity(this.world);
    addComponent(this.world, eid, Position);
    addComponent(this.world, eid, Motion);
    addComponent(this.world, eid, GtaState);
    Position.x[eid] = x;
    Position.y[eid] = y;
    Motion.direction[eid] = 0;
    Motion.pose[eid] = POSE.Idle;
    Motion.moving[eid] = 0;
    Motion.since[eid] = 0;
    Motion.vent[eid] = 0;
    Motion.ventSince[eid] = 0;
    Motion.jump[eid] = 0;
    Motion.jumpSince[eid] = 0;
    Motion.wave[eid] = 0;
    Motion.waveSince[eid] = 0;
    GtaState.role[eid] = 0;
    GtaState.wantedStars[eid] = 0;
    GtaState.wantedBounty[eid] = 0;
    GtaState.ghostMode[eid] = 0;
    GtaState.ghostUntil[eid] = 0;
    GtaState.fishingState[eid] = 0;
    GtaState.vehicleId[eid] = 0;
    GtaState.fallKind[eid] = 0;
    GtaState.fallUntil[eid] = 0;
    Local.flag[eid] = 0;
    this.netOf[eid] = netId;
    this.remote.reset(eid);
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
    this.remote.reset(eid);
    this.netOf[eid] = 0;
    Local.flag[eid] = 0;
    GtaState.role[eid] = 0;
    GtaState.wantedStars[eid] = 0;
    GtaState.wantedBounty[eid] = 0;
    GtaState.ghostMode[eid] = 0;
    GtaState.ghostUntil[eid] = 0;
    GtaState.fishingState[eid] = 0;
    GtaState.vehicleId[eid] = 0;
    GtaState.fallKind[eid] = 0;
    GtaState.fallUntil[eid] = 0;
    removeEntity(this.world, eid);
  }

  get(netId: number): number {
    return this.byNetId.get(netId) ?? 0;
  }

  entities(): QueryResult {
    return query(this.world, [Position, Motion]);
  }
}
