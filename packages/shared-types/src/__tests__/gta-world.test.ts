import { describe, expect, it } from 'vitest';
import {
  PLAYER_RADIUS,
  VEHICLE_SPAWNS,
  GIG_DROP_POINTS,
  CHANGING_BOOTHS,
  ESTATE_BOARD,
  BOSS_VAULT,
  LOADING_DOCK,
  SECURITY_GARAGE,
  PAYPHONES,
  FISHING_PIERS,
  GRAFFITI_WALLS,
  CLINIC_RESPAWN_POINT,
  CLINIC_COFFEE_SPOT,
  WORLD_HOTSPOTS,
  hotspotById,
  isBlocked,
  isOnLand,
  isWaterAt,
} from '../index';

describe('Phase 2-4 GTA 全岛地标与载具点位', () => {
  it('16 辆初始载具点位全部落在陆地上、不落水、不压碰撞体', () => {
    expect(VEHICLE_SPAWNS).toHaveLength(16);
    for (const spawn of VEHICLE_SPAWNS) {
      expect(isOnLand(spawn.x, spawn.y, PLAYER_RADIUS), `vehicle ${spawn.vehicleId} out of land`).toBe(true);
      expect(isWaterAt(spawn.x, spawn.y), `vehicle ${spawn.vehicleId} in water`).toBe(false);
      expect(isBlocked(spawn.x, spawn.y, PLAYER_RADIUS), `vehicle ${spawn.vehicleId} blocked`).toBe(false);
    }
  });

  it('8 处零工交付点全部可达且无阻挡', () => {
    expect(GIG_DROP_POINTS).toHaveLength(8);
    for (const pt of GIG_DROP_POINTS) {
      expect(isOnLand(pt.x, pt.y, PLAYER_RADIUS), `gig drop ${pt.name}`).toBe(true);
      expect(isWaterAt(pt.x, pt.y), `gig drop water ${pt.name}`).toBe(false);
      expect(isBlocked(pt.x, pt.y, PLAYER_RADIUS), `gig drop blocked ${pt.name}`).toBe(false);
    }
  });

  it('12 面涂鸦墙与 3 处钓鱼台、2 处电话亭/换装亭、保安车库、急救站站位均合法', () => {
    expect(GRAFFITI_WALLS).toHaveLength(12);
    expect(FISHING_PIERS).toHaveLength(3);
    expect(PAYPHONES).toHaveLength(2);
    expect(CHANGING_BOOTHS).toHaveLength(2);

    const checkWalkable = [
      ...CHANGING_BOOTHS.map((b) => ({ name: b.name, ...b.hotspot })),
      { name: ESTATE_BOARD.name, ...ESTATE_BOARD.hotspot },
      { name: BOSS_VAULT.name, ...BOSS_VAULT.hotspot },
      { name: LOADING_DOCK.name, ...LOADING_DOCK.hotspot },
      { name: SECURITY_GARAGE.name, ...SECURITY_GARAGE.hotspot },
      ...PAYPHONES.map((p) => ({ name: p.name, x: p.x, y: p.y + 18 })),
      ...FISHING_PIERS.map((p) => ({ name: p.name, x: p.castSpot.x, y: p.castSpot.y })),
      ...GRAFFITI_WALLS.map((w) => ({ name: w.name, x: w.x, y: w.y + 16 })),
      { name: 'clinic-respawn', ...CLINIC_RESPAWN_POINT },
      { name: 'clinic-coffee', ...CLINIC_COFFEE_SPOT },
    ];

    for (const spot of checkWalkable) {
      expect(isOnLand(spot.x, spot.y, PLAYER_RADIUS), `${spot.name} off land`).toBe(true);
      expect(isWaterAt(spot.x, spot.y), `${spot.name} in water`).toBe(false);
      expect(isBlocked(spot.x, spot.y, PLAYER_RADIUS), `${spot.name} blocked`).toBe(false);
    }
  });

  it('所有 GTA 热区均可按唯一 id 查表', () => {
    const ids = WORLD_HOTSPOTS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(hotspotById('clinic-coffee')?.kind).toBe('clinicCoffee');
    expect(hotspotById('estate-board')?.kind).toBe('estateBoard');
    expect(hotspotById('fishing-pier-0')?.kind).toBe('fishingPier');
    expect(hotspotById('graffiti-wall-11')?.kind).toBe('graffitiWall');
  });
});
