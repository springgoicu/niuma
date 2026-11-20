import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  VEHICLE_ACTION,
  VEHICLE_FLAG_BOOST,
  VEHICLE_FLAG_HORN,
  VEHICLE_SPAWNS,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { VehicleRuntime } from './vehicles';
import { World } from './world';

describe('VehicleRuntime 全岛 16 辆载具驾驶、涡轮与撞击', () => {
  it('支持上下车、按喇叭、涡轮加速、移动积分与下车落地', () => {
    const world = new World();
    const grid = new SpatialGrid();
    const spawn = VEHICLE_SPAWNS[0]!;
    const driver = world.create('车手', DEFAULT_APPEARANCE.horse, 20, spawn.x + 12, spawn.y + 8)!;
    grid.insert(driver.id, driver.x, driver.y);
    const bumped: number[] = [];
    const pedestrian = world.create('路人', DEFAULT_APPEARANCE.cow, 21, spawn.x + 80, spawn.y)!;
    grid.insert(pedestrian.id, pedestrian.x, pedestrian.y);

    const vehicles = new VehicleRuntime({
      onBumpPedestrian: (_d, victim) => bumped.push(victim.id),
    });
    const transport = { send() {} };

    expect(vehicles.handleAction(driver, VEHICLE_ACTION.Enter, spawn.vehicleId, 1_000, world, transport)).toBe(true);
    expect(driver.vehicleId).toBe(spawn.vehicleId);
    expect(vehicles.handleAction(driver, VEHICLE_ACTION.Horn, spawn.vehicleId, 1_050, world, transport)).toBe(true);
    expect((vehicles.getVehicle(spawn.vehicleId)!.flags & VEHICLE_FLAG_HORN) !== 0).toBe(true);
    expect(vehicles.handleAction(driver, VEHICLE_ACTION.Boost, spawn.vehicleId, 1_100, world, transport)).toBe(true);
    expect((vehicles.getVehicle(spawn.vehicleId)!.flags & VEHICLE_FLAG_BOOST) !== 0).toBe(true);

    // 连续加速向东冲过路人位置
    for (let i = 0; i < 14; i += 1) {
      const t = 1_150 + i * 50;
      driver.driveTargetX = spawn.x + 240;
      driver.driveTargetY = spawn.y;
      driver.driveTargetAt = t;
      vehicles.tick(50, t, world, grid, transport);
    }
    expect(driver.x).toBeGreaterThan(spawn.x + 40);
    expect(bumped).toContain(pedestrian.id);

    expect(vehicles.handleAction(driver, VEHICLE_ACTION.Exit, spawn.vehicleId, 2_000, world, transport)).toBe(true);
    expect(driver.vehicleId).toBe(0);
    expect(vehicles.getVehicle(spawn.vehicleId)!.driverId).toBe(0);
  });
});
