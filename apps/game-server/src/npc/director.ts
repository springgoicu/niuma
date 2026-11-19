import { PLAYER_RADIUS, POSE, WORLD_CENTER, findFreePoint } from '@niuma/shared-types';
import type { Transport } from '../sim/view';
import type { World } from '../sim/world';
import type { SpatialGrid } from '../spatial/grid';
import { createAgent, directionOf, updateAgent, type NpcAgent } from './brain';
import type { NpcConfig } from './config';
import { ESCORT, stepEscort } from './escort';
import { finishFollow, stepFollow } from './follow';
import { createRng } from './rng';
import { GUARD_COUNT, NPC_ROLE_GUARD, buildNpcRoster } from './roster';
import { pickSpawnPoint, type NpcSpot } from './spots';
import { updateSocial, type NpcSocialContext } from './social';
import type { EscortEvent } from '../sim/detention';

/** 康复续接后的停顿：与押送收尾一致，让玩家先看到「人站起来了」再继续走 */
const RESTORE_PAUSE_MS = 600;

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
  /**
   * 小黑屋派单：返回接单保安的实体 id，0 表示所有保安都在忙。
   * 只挑最近的空闲保安，每人同时最多一个任务。
   */
  dispatchEscort(targetId: number, now: number): number;
  /** 目标已释放 / 断线：清掉对应任务，保安原地停半秒后继续巡逻 */
  cancelEscort(targetId: number): void;
  /**
   * 盯梢派单（ADR-0085，雇佣保安卡）：返回接单保安的实体 id，0 表示没有可用保安。
   *
   * 允许打断正在巡逻（walk/pause）的保安；押送中的保安不接单，
   * 免得「被抓去小黑屋的人身边突然少了一个押送员」。
   */
  dispatchFollow(targetId: number, until: number, now: number): number;
  /** 目标断线 / 离开：取消盯梢 */
  cancelFollow(targetId: number): void;
  /**
   * 康复续接（ADR-0109）：NPC 在急救站就地站起来，从当前位置继续巡逻 / 盯梢。
   *
   * 坐标由 `sim/clinic` 先写好在床尾或地面，本层不再写位置：
   * 写回倒地位置会让康复的 NPC 从病床瞬移回半个园区外（ADR-0106 的老口径）。
   * 押送任务不再续接：保安倒下的当帧案子就撤了（ADR-0113）。
   * 返回 false 表示这个实体不由本层管理。
   */
  restore(playerId: number, now: number): boolean;
  /** 押送事件出口：server 用它转给 sim/detention，不让 NPC 层认识 Detention */
  setEscortListener(listener: ((event: EscortEvent) => void) | null): void;
}

export interface NpcDirectorOptions {
  world: World;
  grid: SpatialGrid;
  transport: Transport;
  config: NpcConfig;
  now?: () => number;
}

export function createNpcDirector(options: NpcDirectorOptions): NpcDirector {
  const { world, grid, config } = options;
  const getNow = options.now ?? Date.now;
  const rng = createRng(config.seed);
  const agents = new Map<number, NpcAgent>();
  let guardCount = 0;
  let updateMs = 0;
  let escortListener: ((event: EscortEvent) => void) | null = null;

  const social: NpcSocialContext = { world, config, rng };

  /** 任务结束：清空任务、站定，给下一次巡逻一个自然的过渡 */
  function finishEscort(agent: NpcAgent, now: number, pauseMs: number): void {
    agent.escort = null;
    agent.phase = 'pause';
    agent.pauseMs = pauseMs;
    agent.pauseUntil = now + pauseMs;
    agent.lookAt = now + 600;
    // 押送员已被创倒：躺姿归急救链，这里写 Idle 会把人「扶起来站着」
    if (!agent.player.incapacitated) {
      agent.player.applyState(agent.player.direction, POSE.Idle, false);
      agent.player.markDirtyIfChanged();
    }
  }

  function dispatchEscort(targetId: number, now: number): number {
    const target = world.get(targetId);
    if (!target || target.isNpc || target.wsId === 0) return 0;

    let best: NpcAgent | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const agent of agents.values()) {
      if (agent.escort) continue;
      if (agent.follow) continue;
      if (agent.player.role !== NPC_ROLE_GUARD) continue;
      // 昏迷（送医中）与硬直中的保安都不接单；站起来再说
      if (agent.player.incapacitated) continue;
      if (now < agent.player.stunUntil) continue;
      const dx = agent.player.x - target.x;
      const dy = agent.player.y - target.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = agent;
      }
    }
    if (!best) return 0;

    const guard = best.player;
    best.escort = {
      targetId,
      stage: 'chase',
      stageUntil: 0,
      path: [],
      index: 0,
      replanAt: now,
      lastTargetX: target.x,
      lastTargetY: target.y,
      startedAt: now,
      dragDeadlineAt: 0,
      towX: 0,
      towY: 0,
    };
    guard.applyState(
      directionOf(target.x - guard.x, target.y - guard.y, guard.direction),
      POSE.Walk,
      true,
    );
    guard.markDirtyIfChanged();
    return guard.id;
  }

  function cancelEscort(targetId: number): void {
    const now = getNow();
    for (const agent of agents.values()) {
      if (agent.escort?.targetId !== targetId) continue;
      finishEscort(agent, now, 600);
    }
  }

  /**
   * 盯梢派单：最近的一名「既没押送、也没在盯人」的保安接单。
   *
   * 与押送同样按距离挑人，但允许打断巡逻——雇佣保安卡的价值就在于「立刻有人来」，
   * 若只等空闲保安，三班里总有两班在路上，玩家花了 150 币却看不到人。
   */
  function dispatchFollow(targetId: number, until: number, now: number): number {
    const target = world.get(targetId);
    if (!target || target.isNpc || target.wsId === 0) return 0;

    let best: NpcAgent | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const agent of agents.values()) {
      if (agent.escort || agent.follow) continue;
      if (agent.player.role !== NPC_ROLE_GUARD) continue;
      if (agent.player.incapacitated) continue;
      if (now < agent.player.stunUntil) continue;
      const dx = agent.player.x - target.x;
      const dy = agent.player.y - target.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = agent;
      }
    }
    if (!best) return 0;

    const guard = best.player;
    best.follow = {
      targetId,
      until,
      path: [],
      index: 0,
      replanAt: now,
      lastTargetX: target.x,
      lastTargetY: target.y,
    };
    // 打断巡逻：立刻起步，不等当前停顿结束
    best.phase = 'walk';
    best.stuckCount = 0;
    best.lastProgressAt = now;
    best.lastProgressX = guard.x;
    best.lastProgressY = guard.y;
    guard.applyState(
      directionOf(target.x - guard.x, target.y - guard.y, guard.direction),
      POSE.Walk,
      true,
    );
    guard.markDirtyIfChanged();
    return guard.id;
  }

  function cancelFollow(targetId: number): void {
    const now = getNow();
    for (const agent of agents.values()) {
      if (agent.follow?.targetId !== targetId) continue;
      finishFollow(agent, now);
    }
  }

  /**
   * 康复续接（ADR-0109）：复位行为态、续接盯梢，坐标沿用 clinic 写好的床尾。
   *
   * 押送不再续接（ADR-0113）：保安倒下的当帧 `stepEscort` 就回报 `guard_down`，
   * 案子当场撤销，`agent.escort` 已被 `finishEscort` 清空，康复后直接回巡逻。
   */
  function restore(playerId: number, now: number): boolean {
    const agent = agents.get(playerId);
    if (!agent) return false;

    const player = agent.player;
    // 「康复」由本方法定义：昏迷与硬直都在这一处清干净，调用方不必记得
    player.incapacitated = false;
    player.stunUntil = 0;
    player.carriedBy = 0;
    player.applyState(player.direction, POSE.Idle, false);
    player.markDirtyIfChanged();
    if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;

    agent.phase = 'pause';
    agent.pauseMs = RESTORE_PAUSE_MS;
    agent.pauseUntil = now + RESTORE_PAUSE_MS;
    agent.lookAt = now + RESTORE_PAUSE_MS;
    agent.stuckCount = 0;
    agent.lastProgressAt = now;
    agent.lastProgressX = player.x;
    agent.lastProgressY = player.y;

    if (agent.follow) {
      agent.follow.path = [];
      agent.follow.index = 0;
      agent.follow.replanAt = now;
      agent.follow.lastTargetX = player.x;
      agent.follow.lastTargetY = player.y;
    }
    return true;
  }

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
    const now = getNow();
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
      const escortTargetId = agent.escort?.targetId;
      if (agent.escort) {
        const event = stepEscort(agent, agent.escort, world, now);
        if (event) {
          escortListener?.(event);
          // 抓取后还有按肩 / 拖行，任务继续；到达与中止才收尾
          if (event.kind !== 'grab') finishEscort(agent, now, ESCORT.PAUSE_AFTER_MS);
        }

        // 被拖者由 escort 直接写坐标：跟着保安一起重算格子与视野
        if (agent.escort && escortTargetId !== undefined) {
          const target = world.get(escortTargetId);
          if (target && grid.update(target.id, target.x, target.y)) target.needsViewRefresh = true;
        }
      } else if (agent.follow) {
        // 盯梢只动保安自己：目标的位置与姿态完全不受影响
        if (stepFollow(agent, agent.follow, world, now) === 'done') finishFollow(agent, now);
      } else {
        updateAgent(agent, rng, config, now);
      }

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
      // 押送 / 盯梢中不做招手 / 让路，避免把保安拉回停顿态
      if (!agent.escort && !agent.follow) updateSocial(agent, social, now);
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
    dispatchEscort,
    cancelEscort,
    dispatchFollow,
    cancelFollow,
    restore,
    setEscortListener(listener) {
      escortListener = listener;
    },
  };
}
