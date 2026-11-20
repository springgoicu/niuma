/**
 * 全园区街头共享载具配置与初始刷车点（16 辆）。
 *
 * 双端共用数值：服务端权威物理与客户端预测/插值共用同一张速度与碰撞参数表。
 */

import { VEHICLE_KIND } from '../types';

export interface VehicleSpec {
  readonly kind: number;
  readonly key: string;
  readonly name: string;
  readonly maxSpeed: number;
  readonly boostSpeed: number;
  readonly accel: number;
  readonly friction: number;
  readonly radius: number;
  readonly bumpImpulse: number;
  readonly hasSiren: boolean;
}

export const VEHICLE_SPECS: Readonly<Record<number, VehicleSpec>> = {
  [VEHICLE_KIND.Scooter]: {
    kind: VEHICLE_KIND.Scooter,
    key: 'scooter',
    name: '共享小电驴',
    maxSpeed: 315,
    boostSpeed: 405,
    accel: 920,
    friction: 4.5,
    radius: 16,
    bumpImpulse: 220,
    hasSiren: false,
  },
  [VEHICLE_KIND.Forklift]: {
    kind: VEHICLE_KIND.Forklift,
    key: 'forklift',
    name: '黄漆叉车',
    maxSpeed: 245,
    boostSpeed: 315,
    accel: 680,
    friction: 5.5,
    radius: 20,
    bumpImpulse: 340,
    hasSiren: false,
  },
  [VEHICLE_KIND.PatrolCart]: {
    kind: VEHICLE_KIND.PatrolCart,
    key: 'patrol_cart',
    name: '保安电动巡逻车',
    maxSpeed: 330,
    boostSpeed: 425,
    accel: 960,
    friction: 4.2,
    radius: 18,
    bumpImpulse: 280,
    hasSiren: true,
  },
  [VEHICLE_KIND.BossConvertible]: {
    kind: VEHICLE_KIND.BossConvertible,
    key: 'boss_convertible',
    name: '老板黄金敞篷跑车',
    maxSpeed: 375,
    boostSpeed: 475,
    accel: 1080,
    friction: 3.6,
    radius: 19,
    bumpImpulse: 310,
    hasSiren: false,
  },
};

export interface VehicleSpawnDef {
  readonly vehicleId: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
}

/**
 * 16 辆初始停放点：严格避开水体、建筑墙体与道路灯柱/长椅，按路网顺手分布。
 */
export const VEHICLE_SPAWNS: ReadonlyArray<VehicleSpawnDef> = [
  { vehicleId: 1, kind: VEHICLE_KIND.Scooter, x: 4340, y: 3920, dir: 2 },
  { vehicleId: 2, kind: VEHICLE_KIND.Scooter, x: 3840, y: 4310, dir: 0 },
  { vehicleId: 3, kind: VEHICLE_KIND.Scooter, x: 3720, y: 3860, dir: 3 },
  { vehicleId: 4, kind: VEHICLE_KIND.Forklift, x: 3680, y: 3680, dir: 0 },
  { vehicleId: 5, kind: VEHICLE_KIND.Forklift, x: 3620, y: 3810, dir: 1 },
  { vehicleId: 6, kind: VEHICLE_KIND.BossConvertible, x: 2890, y: 2980, dir: 3 },
  { vehicleId: 7, kind: VEHICLE_KIND.Scooter, x: 3200, y: 2980, dir: 3 },
  { vehicleId: 8, kind: VEHICLE_KIND.BossConvertible, x: 4096, y: 3220, dir: 0 },
  { vehicleId: 9, kind: VEHICLE_KIND.Scooter, x: 4690, y: 2920, dir: 0 },
  { vehicleId: 10, kind: VEHICLE_KIND.PatrolCart, x: 4680, y: 4096, dir: 2 },
  { vehicleId: 11, kind: VEHICLE_KIND.PatrolCart, x: 5300, y: 4170, dir: 2 },
  { vehicleId: 12, kind: VEHICLE_KIND.PatrolCart, x: 5140, y: 3940, dir: 0 },
  { vehicleId: 13, kind: VEHICLE_KIND.Scooter, x: 3480, y: 5290, dir: 3 },
  { vehicleId: 14, kind: VEHICLE_KIND.Forklift, x: 4680, y: 5290, dir: 2 },
  { vehicleId: 15, kind: VEHICLE_KIND.Scooter, x: 4820, y: 5080, dir: 1 },
  { vehicleId: 16, kind: VEHICLE_KIND.BossConvertible, x: 2760, y: 4050, dir: 3 },
];

export const VEHICLE_ENTER_RANGE = 68;
export const VEHICLE_BOOST_DURATION_MS = 1800;
export const VEHICLE_BOOST_COOLDOWN_MS = 4500;
export const VEHICLE_HORN_COOLDOWN_MS = 1200;
