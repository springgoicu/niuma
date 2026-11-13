import { PLAYER_RADIUS, POSE, WORLD_CENTER, findFreePoint } from '@niuma/shared-types';
import type { Transport } from '../sim/view';
import type { World } from '../sim/world';
import type { SpatialGrid } from '../spatial/grid';
import { createAgent, updateAgent, type NpcAgent } from './brain';
import type { NpcConfig } from './config';
import { createRng } from './rng';
import { GUARD_COUNT, NPC_ROLE_GUARD, buildNpcRoster } from './roster';
import { pickSpawnPoint, type NpcSpot } from './spots';
import { updateSocial, type NpcSocialContext } from './social';

/**
 * NPC 门面：服务器只认识 `spawn / update / count / guardCount / updateMs`。
 *
 * 行为、名册、落点、社交全部藏在这一层后面；`server.ts` 不接触任何 `NpcAgent`。
 * 实体写入 `World`（复用 AOI / 同步 / 碰撞），行为态只活在这里的 Map 里。
 */
export interface NpcDirector {
  spawn(): void;
  update(now: number): void;
  readonly count: number;
  /** 其中保安数量：供 /health 与启动日志区分 */
  readonly guardCount: number;
  /** 最近一帧 update 的耗时（毫秒）：只用于 /health 观测，不参与准入判定 */
  readonly updateMs: number;
}

export interface NpcDirectorOptions {
  world: World;
  grid: SpatialGrid;
  transport: Transport;
  config: NpcConfig;
}

export function createNpcDirector(options: NpcDirectorOptions): NpcDirector {
  const { world, grid, config } = options;
  const rng = createRng(config.seed);
  const agents = new Map<number, NpcAgent>();
  let guardCount = 0;
  let updateMs = 0;

  const social: NpcSocialContext = { world, config, rng };

  /**
   * 迎宾位：第 1 位同事与第 1 位保安从广场出发，玩家一进场就能看到人。
   * 两人左右错开 120px，落点仍由 `findFreePoint` 保证不在陈设里。
   */
  function plazaSpawn(offsetX: number): NpcSpot {
    const point = findFreePoint(WORLD_CENTER.x + offsetX, WORLD_CENTER.y + 200, PLAYER_RADIUS, true);
    return { x: point.x, y: point.y };
  }

  function spawn(): void {
    // count <= 0 是完整回滚开关：普通同事与保安一起关闭
    if (!config.enabled || config.count <= 0 || agents.size > 0) return;
    const now = Date.now();
    const workers = Math.max(0, config.count);
    const roster = buildNpcRoster(rng, { workers, guards: GUARD_COUNT }, { speed: config.speed, now });
    const placed: NpcSpot[] = [];

    for (let index = 0; index < roster.length; index += 1) {
      const profile = roster[index]!;
      const at =
        index === 0
          ? plazaSpawn(-60)
          : index === workers
            ? plazaSpawn(60)
            : pickSpawnPoint(rng, placed);
      const player = world.createNpc(
        profile.name,
        profile.appearance,
        at.x,
        at.y,
        profile.status,
        profile.joinedAt,
        profile.career,
        profile.role,
      );
      if (!player) break;
      placed.push({ x: player.x, y: player.y });
      grid.insert(player.id, player.x, player.y);
      agents.set(player.id, createAgent(rng, player, profile.speedFactor, config, now));
      if (profile.role === NPC_ROLE_GUARD) guardCount += 1;
    }
  }

  function update(now: number): void {
    if (agents.size === 0) {
      updateMs = 0;
      return;
    }
    const started = performance.now();
    for (const agent of agents.values()) {
      updateAgent(agent, rng, config, now);
      const player = agent.player;

      // 单个实体异常不能拖垮 Tick：坐标非有限时就近拉回可站立点
      if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
        const safe = findFreePoint(player.x, player.y, PLAYER_RADIUS, true);
        player.x = safe.x;
        player.y = safe.y;
        player.applyState(player.direction, POSE.Idle, false);
        player.markDirtyIfChanged();
      }

      // 跨格才重算视野：与真人的 AOI 维护同一条路径
      if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      updateSocial(agent, social, now);
    }
    updateMs = performance.now() - started;
  }

  return {
    spawn,
    update,
    get count() {
      return agents.size;
    },
    get guardCount() {
      return guardCount;
    },
    get updateMs() {
      return updateMs;
    },
  };
}
