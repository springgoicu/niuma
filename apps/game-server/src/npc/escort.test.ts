import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  JAIL,
  JAIL_DOOR,
  JAIL_DOOR_PAVING,
  MOVE_SPEED,
  POSE,
  TICK_MS,
  isBlocked,
} from '@niuma/shared-types';
import type { EscortEvent } from '../sim/detention';
import { World, type Player } from '../sim/world';
import { createAgent, type EscortTask } from './brain';
import { DEFAULT_NPC_CONFIG } from './config';
import { ESCORT, chaseSpeed, dragDeadline, stepEscort } from './escort';
import { warmEscortGrid } from './escort-path';
import { createRng } from './rng';

const NOW = 1_700_000_000_000;
/** 单次押送的 Tick 上限：正常约 60 Tick 到达，跑满说明流程卡在某一阶段 */
const MAX_TICKS = 300;

interface Fixture {
  world: World;
  guard: Player;
  target: Player;
  agent: ReturnType<typeof createAgent>;
  task: EscortTask;
}

/** 保安站在服务广场的门前铺装、目标就在抓取半径（26px）内，第一帧必定 grab */
const GUARD_START = { x: JAIL_DOOR_PAVING.x - 30, y: JAIL_DOOR_PAVING.y + 30 };

function setup(): Fixture {
  const world = new World();
  const guard = world.createNpc('保安', DEFAULT_APPEARANCE.cow, GUARD_START.x, GUARD_START.y, '', NOW)!;
  const target = world.create('目标', DEFAULT_APPEARANCE.cow, 1, GUARD_START.x + 20, GUARD_START.y, '', NOW)!;
  const agent = createAgent(createRng(7), guard, 1.3, DEFAULT_NPC_CONFIG, NOW);
  const task: EscortTask = {
    targetId: target.id,
    stage: 'chase',
    stageUntil: 0,
    path: [],
    index: 0,
    replanAt: 0,
    lastTargetX: target.x,
    lastTargetY: target.y,
    startedAt: NOW,
    dragDeadlineAt: 0,
    towX: 0,
    towY: 0,
  };
  return { world, guard, target, agent, task };
}

function inJail(player: Player): boolean {
  return (
    player.x > JAIL.x && player.x < JAIL.x + JAIL.w && player.y > JAIL.y && player.y < JAIL.y + JAIL.h
  );
}

describe('押送状态机（ADR-0072）', () => {
  it('抓取 → 按肩 → 拖行：保安与被押者一路移动到小黑屋', () => {
    warmEscortGrid();
    const { world, guard, target, agent, task } = setup();
    const events: EscortEvent[] = [];
    const startX = target.x;
    let now = NOW;
    /** 抓到时刻与首次进入拖行的时刻：两者之间必须隔着按肩停顿 */
    let grabbedAt = 0;
    let dragAt = 0;
    let towDistance = Number.POSITIVE_INFINITY;

    for (let tick = 0; tick < MAX_TICKS; tick += 1) {
      now += TICK_MS;
      const event = stepEscort(agent, task, world, now);
      if (event) {
        events.push(event);
        if (event.kind === 'grab') {
          grabbedAt = now;
          expect(target.pose).toBe(POSE.Lie);
        }
      }
      // 阶段必须真的切到 drag：漏掉这一步会永远停在按肩阶段，双方原地不动
      if (dragAt === 0 && task.stage === 'drag') dragAt = now;
      if (dragAt !== 0) {
        towDistance = Math.min(towDistance, Math.hypot(guard.x - target.x, guard.y - target.y));
      }
      if (events.some((entry) => entry.kind === 'arrive')) break;
    }

    expect(events[0]?.kind).toBe('grab');
    expect(dragAt).toBeGreaterThan(0);
    expect(dragAt - grabbedAt).toBeGreaterThanOrEqual(ESCORT.GRAB_HOLD_MS);
    // 被押者被带着走了至少一个身位，并且进了屋（ADR-0077：房间收小，位移从 200 降到 180）
    expect(target.x - startX).toBeGreaterThan(150);
    expect(target.x).toBeGreaterThan(JAIL.x);
    // 拖行时目标始终挂在保安身后 22px
    expect(towDistance).toBeLessThanOrEqual(ESCORT.TOW_OFFSET_PX + 1);
    // 保安自己也要进屋：不能站在墙外判定到达
    expect(inJail(guard)).toBe(true);
    expect(inJail(target)).toBe(true);
    expect(events[events.length - 1]?.kind).toBe('arrive');
  });

  it('目标失联时原地中止，不把保安挪走', () => {
    warmEscortGrid();
    const { world, guard, target, agent, task } = setup();
    world.destroy(target.id);

    const event = stepEscort(agent, task, world, NOW + TICK_MS);

    expect(event?.kind).toBe('abort');
    expect(guard.x).toBe(GUARD_START.x);
    expect(guard.y).toBe(GUARD_START.y);
  });
});

describe('执法链兜底（ADR-0080）', () => {
  it('最慢的保安追击时也快过玩家常速', () => {
    const slowest = MOVE_SPEED * DEFAULT_NPC_CONFIG.speed.min;
    // 裸乘 1.3 时慢保安只有 133px/s，追不上持续移动的玩家
    expect(slowest * ESCORT.CHASE_SPEED_FACTOR).toBeLessThan(MOVE_SPEED);
    expect(chaseSpeed(slowest)).toBeGreaterThan(MOVE_SPEED);
    // 快保安保持原有倍率，不被下限抹平
    expect(chaseSpeed(MOVE_SPEED)).toBeCloseTo(MOVE_SPEED * ESCORT.CHASE_SPEED_FACTOR);
  });

  it('拖行截止按路线长度派生：短途保底，长途给足余量', () => {
    expect(dragDeadline(NOW, 400, 100)).toBe(NOW + ESCORT.DRAG_TIMEOUT_MS);

    // 3000px 的路要 30 秒，固定 15 秒会在半路放人
    const long = dragDeadline(NOW, 3_000, 100);
    expect(long).toBeGreaterThan(NOW + 30_000);
    expect(long).toBeLessThanOrEqual(NOW + ESCORT.DRAG_TIMEOUT_MAX_MS);
  });

  it('保安被创飞不冻结计时：超时后仍然中止并放人', () => {
    warmEscortGrid();
    const { world, guard, agent, task } = setup();
    guard.stunUntil = NOW + 60_000;
    task.startedAt = NOW - ESCORT.CHASE_TIMEOUT_MS - 1;

    const event = stepEscort(agent, task, world, NOW + TICK_MS);

    expect(event).toEqual({
      kind: 'abort',
      guardId: guard.id,
      targetId: task.targetId,
      now: NOW + TICK_MS,
      reason: 'timeout',
    });
  });

  it('昏迷送医期间押送计时挂起，不会在病床上被判超时（ADR-0106）', () => {
    warmEscortGrid();
    const { world, guard, agent, task } = setup();
    guard.incapacitated = true;
    task.startedAt = NOW - ESCORT.CHASE_TIMEOUT_MS - 1;

    const event = stepEscort(agent, task, world, NOW);

    expect(event).toBeNull();
    expect(task.stage).toBe('chase');
  });

  it('拖行落点走碰撞求解，不把被押者写进墙里', () => {
    warmEscortGrid();
    const world = new World();
    // 保安站在小黑屋里贴着西门上方的实墙段（门洞在 y+130..y+190），拖行方向朝西，
    // 被押者默认落在保安西侧 22px，正好穿进墙里
    const guard = world.createNpc('保安', DEFAULT_APPEARANCE.cow, JAIL.x + 25, JAIL_DOOR.from - 40)!;
    const target = world.create('目标', DEFAULT_APPEARANCE.cow, 2, JAIL.x + 35, JAIL_DOOR.from - 40, '', NOW)!;
    const agent = createAgent(createRng(7), guard, 1, DEFAULT_NPC_CONFIG, NOW);
    const task: EscortTask = {
      targetId: target.id,
      stage: 'drag',
      stageUntil: 0,
      path: [],
      index: 0,
      replanAt: 0,
      lastTargetX: target.x,
      lastTargetY: target.y,
      startedAt: NOW,
      dragDeadlineAt: NOW + 60_000,
      towX: -1,
      towY: 0,
    };

    expect(isBlocked(guard.x + task.towX * ESCORT.TOW_OFFSET_PX, guard.y)).toBe(true);

    stepEscort(agent, task, world, NOW + TICK_MS);

    expect(isBlocked(target.x, target.y)).toBe(false);
  });
});
