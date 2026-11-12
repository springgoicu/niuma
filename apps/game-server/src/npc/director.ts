import { PLAYER_RADIUS, POSE, findFreePoint } from '@niuma/shared-types';
import type { ChatHistory } from '../sim/history';
import type { Transport } from '../sim/view';
import type { World } from '../sim/world';
import type { SpatialGrid } from '../spatial/grid';
import { createAgent, updateAgent, type NpcAgent } from './brain';
import type { NpcConfig } from './config';
import { createRng } from './rng';
import { buildNpcRoster } from './roster';
import { resolveRegions, pickRegion, pickSpawnPoint, type NpcRegion } from './spots';
import { updateSocial, type NpcSocialContext } from './social';

/**
 * NPC 门面：服务器只认识 `spawn / update / count / updateMs` 四件事。
 *
 * 行为、名册、落点、社交全部藏在这一层后面；`server.ts` 不接触任何 `NpcAgent`。
 * 实体写入 `World`（复用 AOI / 同步 / 碰撞），行为态只活在这里的 Map 里。
 */
export interface NpcDirector {
  spawn(): void;
  update(now: number): void;
  readonly count: number;
  /** 最近一帧 update 的耗时（毫秒）：只用于 /health 观测，不参与准入判定 */
  readonly updateMs: number;
}

export interface NpcDirectorOptions {
  world: World;
  grid: SpatialGrid;
  transport: Transport;
  config: NpcConfig;
  /** 频道历史：缺省时 NPC 只做肢体互动，不发言 */
  chatHistory?: ChatHistory;
  /** 外置台词的审核：返回 null 表示整条丢弃（fail-closed） */
  inspect?: (text: string) => string | null;
}

/** 前几位固定分到广场：玩家一进场就能看到同事，而不是撞见一座空园 */
const PLAZA_SEATS = 4;

export function createNpcDirector(options: NpcDirectorOptions): NpcDirector {
  const { world, grid, transport, config } = options;
  const rng = createRng(config.seed);
  const regions = resolveRegions(config.regions);
  const agents = new Map<number, NpcAgent>();
  let updateMs = 0;

  // 外置台词只在启动时过一遍审核：运行期不再逐条走词表
  const chatLines: string[] = [];
  for (const line of config.chatLines) {
    const safe = options.inspect ? options.inspect(line) : line;
    if (safe && safe.length > 0) chatLines.push(safe);
  }

  const social: NpcSocialContext = {
    world,
    transport,
    history: options.chatHistory,
    config,
    rng,
    chatLines,
  };

  const plaza = regions.find((region) => region.id === 'plaza');

  function chooseRegion(index: number): NpcRegion {
    if (index < PLAZA_SEATS && plaza) return plaza;
    return pickRegion(rng, regions);
  }

  function spawn(): void {
    if (!config.enabled || config.count <= 0 || agents.size > 0) return;
    const now = Date.now();
    const roster = buildNpcRoster(rng, config.count, { speed: config.speed, now });

    for (let index = 0; index < roster.length; index += 1) {
      const profile = roster[index]!;
      const region = chooseRegion(index);
      const spot = pickSpawnPoint(rng, region);
      const player = world.createNpc(
        profile.name,
        profile.appearance,
        spot.x,
        spot.y,
        profile.status,
        profile.joinedAt,
        profile.career,
      );
      if (!player) break;
      grid.insert(player.id, player.x, player.y);
      agents.set(
        player.id,
        createAgent(rng, player, region, profile.speedFactor, profile.chatColor, config, now),
      );
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

      // 单个实体异常不能拖垮 Tick：坐标非有限时拉回区域中心的安全点
      if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
        const safe = findFreePoint(agent.region.x, agent.region.y, PLAYER_RADIUS, true);
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
    get updateMs() {
      return updateMs;
    },
  };
}
