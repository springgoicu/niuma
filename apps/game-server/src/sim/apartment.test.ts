import { describe, expect, it } from 'bun:test';
import {
  APARTMENT_WINDOW_COUNT,
  DEFAULT_APPEARANCE,
  apartmentBySlot,
} from '@niuma/shared-types';
import { World } from './world';
import { ApartmentRuntime } from './apartment';

function join(world: World, wsId: number) {
  return world.create('牛马', DEFAULT_APPEARANCE.cow, wsId, 4096, 4096)!;
}

describe('公寓窗口占用（ADR-0098）', () => {
  it('进屋按顺序占空窗，同栋可以多人各占一个', () => {
    const world = new World();
    const apartment = new ApartmentRuntime();
    const first = join(world, 1);
    const second = join(world, 2);

    expect(apartment.enter(first, 0)).toEqual({ slot: 0, window: 0 });
    expect(apartment.enter(second, 0)).toEqual({ slot: 0, window: 1 });
    expect(apartment.snapshot()).toEqual([
      { id: first.id, slot: 0, window: 0 },
      { id: second.id, slot: 0, window: 1 },
    ]);
  });

  it('进屋后人停在门口台阶，并且被标记为在窗口里', () => {
    const world = new World();
    const apartment = new ApartmentRuntime();
    const player = join(world, 1);
    const spec = apartmentBySlot(3);

    apartment.enter(player, 3);
    expect(player.roomId).toBe(4);
    expect(player.x).toBe(spec.outside.x);
    expect(player.y).toBe(spec.outside.y);
  });

  it('窗口占满后拒客，别栋不受影响', () => {
    const world = new World();
    const apartment = new ApartmentRuntime();
    for (let i = 0; i < APARTMENT_WINDOW_COUNT; i += 1) {
      expect(apartment.enter(join(world, i + 1), 0)).not.toBeNull();
    }
    expect(apartment.enter(join(world, 99), 0)).toBeNull();
    expect(apartment.enter(join(world, 100), 5)).toEqual({ slot: 5, window: 0 });
  });

  it('出门释放窗口并回到自己那栋的门口，窗口可被下一个人复用', () => {
    const world = new World();
    const apartment = new ApartmentRuntime();
    const first = join(world, 1);
    const second = join(world, 2);

    apartment.enter(first, 2);
    expect(apartment.exit(first)).toBe(true);
    expect(first.roomId).toBe(0);
    expect(apartment.snapshot()).toEqual([]);

    expect(apartment.enter(second, 2)).toEqual({ slot: 2, window: 0 });
  });

  it('没进屋的人出门与断线都是无操作', () => {
    const world = new World();
    const apartment = new ApartmentRuntime();
    const player = join(world, 1);
    expect(apartment.exit(player)).toBe(false);
    expect(apartment.leave(player.id)).toBe(false);
    expect(apartment.snapshot()).toEqual([]);
  });

  it('断线立刻释放窗口，不会留下空窗占位', () => {
    const world = new World();
    const apartment = new ApartmentRuntime();
    const left = join(world, 1);
    const staying = join(world, 2);

    apartment.enter(left, 1);
    apartment.enter(staying, 1);
    expect(apartment.leave(left.id)).toBe(true);
    expect(apartment.snapshot()).toEqual([{ id: staying.id, slot: 1, window: 1 }]);
    expect(apartment.leave(left.id)).toBe(false);
  });
});
