import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, EMPTY_CAREER, MAX_ENTITIES, MAX_ENTITY_ID } from '@niuma/shared-types';
import { World } from './world';

function join(world: World, wsId: number) {
  return world.create('牛马', DEFAULT_APPEARANCE.cow, wsId, 4096, 4096);
}

describe('实体 id 分配', () => {
  it('id 落在紧凑条目的 10 bit 范围内', () => {
    const world = new World();
    for (let i = 0; i < 50; i += 1) {
      const player = join(world, i)!;
      expect(player.id).toBeGreaterThan(0);
      expect(player.id).toBeLessThanOrEqual(MAX_ENTITY_ID);
    }
  });

  it('满员后拒绝入场，不会覆盖已在线的人', () => {
    const world = new World();
    for (let i = 0; i < MAX_ENTITIES; i += 1) expect(join(world, i)).not.toBeNull();
    expect(world.size).toBe(MAX_ENTITIES);
    expect(join(world, 9999)).toBeNull();
    expect(world.size).toBe(MAX_ENTITIES);
  });

  /**
   * 10 位 id 空间比旧版（u16）小一个数量级，长时间运行后一定会绕回。
   * 绕回时若直接发号，就会把还在线的玩家从 Map 里顶掉——那条连接从此收不到自己的同步。
   */
  it('对象池复用不会把上一位玩家的考勤摘要带过来', () => {
    const world = new World();
    const first = join(world, 1)!;
    first.career = {
      ...EMPTY_CAREER,
      province: '浙江',
      weekMinutes: 600,
      reportedOnlineSec: 120,
    };
    first.lastCareerAt = 123_456;
    world.destroy(first.id);

    const second = join(world, 2)!;
    expect(second.career).toEqual(EMPTY_CAREER);
    expect(second.lastCareerAt).toBe(0);
  });

  it('回绕后跳过仍在使用的号段', () => {
    const world = new World();
    const players = [];
    for (let i = 0; i < MAX_ENTITIES; i += 1) players.push(join(world, i)!);

    for (let i = 0; i < 500; i += 1) world.destroy(players[i]!.id);
    const survivors = new Set(world.players.keys());

    for (let i = 0; i < 500; i += 1) {
      const created = join(world, 5000 + i)!;
      expect(created.id).toBeLessThanOrEqual(MAX_ENTITY_ID);
      expect(created.id).not.toBeNaN();
      // 新号不能落在幸存者头上，且 Map 里拿到的必须是自己
      expect(survivors.has(created.id)).toBe(false);
      expect(world.get(created.id)).toBe(created);
    }
    expect(world.size).toBe(MAX_ENTITIES);
  });
});
