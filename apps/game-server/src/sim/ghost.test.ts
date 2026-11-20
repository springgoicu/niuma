import { describe, expect, it } from 'vitest';
import {
  CLINIC_RESPAWN_POINT,
  DEFAULT_APPEARANCE,
  ECONOMY_REWARD,
  GHOST_MODE,
} from '@niuma/shared-types';
import { GhostRuntime } from './ghost';
import { World } from './world';

describe('GhostRuntime 街头倒地、CPR 救醒与灵魂出窍超时复活', () => {
  it('倒地 3 下 CPR 救活并发赏金；无人施救先变幽灵再回急救站门口', () => {
    const world = new World();
    let awarded = 0;
    const cancelledClinic: number[] = [];
    const ghost = new GhostRuntime({
      onGrantCoins: (_p, amt) => {
        awarded += amt;
      },
      onCancelClinic: (id) => cancelledClinic.push(id),
    });
    const transport = { send() {} };

    const down = world.create('伤员', DEFAULT_APPEARANCE.cow, 30, 4000, 4000)!;
    const medic = world.create('好同事', DEFAULT_APPEARANCE.horse, 31, 4030, 4000)!;

    ghost.enterFlatline(down, 1_000, world, transport);
    expect(down.ghostMode).toBe(GHOST_MODE.Flatline);

    expect(ghost.performCpr(medic, down.id, 1_200, world, transport)).toBe(true);
    expect(ghost.performCpr(medic, down.id, 1_400, world, transport)).toBe(true);
    expect(ghost.performCpr(medic, down.id, 1_600, world, transport)).toBe(true);
    expect(down.ghostMode).toBe(GHOST_MODE.Alive);
    expect(awarded).toBe(ECONOMY_REWARD.CprRescue);
    expect(cancelledClinic).toContain(down.id);

    // 无人救治走满倒计时 -> Ghost -> Respawn
    ghost.enterFlatline(down, 5_000, world, transport);
    ghost.tick(world, 25_001, transport);
    expect(down.ghostMode).toBe(GHOST_MODE.Ghost);
    ghost.tick(world, 40_002, transport);
    expect(down.ghostMode).toBe(GHOST_MODE.Alive);
    expect(down.x).toBe(CLINIC_RESPAWN_POINT.x);
    expect(down.y).toBe(CLINIC_RESPAWN_POINT.y);
  });
});
