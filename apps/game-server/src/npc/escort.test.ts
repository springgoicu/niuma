import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, JAIL, POSE, TICK_MS } from '@niuma/shared-types';
import type { EscortEvent } from '../sim/detention';
import { World, type Player } from '../sim/world';
import { createAgent, type EscortTask } from './brain';
import { DEFAULT_NPC_CONFIG } from './config';
import { ESCORT, stepEscort } from './escort';
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

function setup(): Fixture {
  const world = new World();
  // 保安站在门外铺装、目标就在抓取半径（26px）内，第一帧必定 grab
  const guard = world.createNpc('保安', DEFAULT_APPEARANCE.cow, 4270, 4950, '', NOW)!;
  const target = world.create('目标', DEFAULT_APPEARANCE.cow, 1, 4290, 4950, '', NOW)!;
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
    expect(guard.x).toBe(4270);
    expect(guard.y).toBe(4950);
  });
});
