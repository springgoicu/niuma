import { describe, expect, it } from 'bun:test';
import { JAIL_ANCHOR, WORLD_LAYOUT, type BuildingSpec } from '@niuma/shared-types';
import {
  INTERIOR_SPOTS,
  INTERIOR_SPOT_RANGE,
  interiorSpotAction,
  nearestInteriorSpotInto,
  pickInteriorLine,
  type InteriorSpotTarget,
} from '../interior-spots';

function roomRect(name: string): { x: number; y: number; w: number; h: number } {
  const building = WORLD_LAYOUT.buildings.find((item: BuildingSpec) => item.name === name);
  if (!building) throw new Error(`布局里缺少房间 ${name}`);
  return building.rect;
}

function inside(rect: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

describe('室内本地交互点', () => {
  it('每个感应点都落在对应房间内，不会漂到墙外', () => {
    const rooms = {
      work: roomRect('工作区'),
      lounge: roomRect('宿舍区'),
      restroom: roomRect('卫生间'),
      cell: roomRect('小黑屋'),
    };
    const roomOf = (id: string) => {
      if (id.startsWith('work-')) return rooms.work;
      if (id.startsWith('lounge-')) return rooms.lounge;
      if (id.startsWith('restroom-')) return rooms.restroom;
      return rooms.cell;
    };
    expect(INTERIOR_SPOTS.length).toBeGreaterThanOrEqual(10);
    for (const spot of INTERIOR_SPOTS) {
      const room = roomOf(spot.id);
      expect(inside(room, spot.x, spot.y)).toBe(true);
      // 半径必须能被默认判定范围覆盖，否则永远按不出来
      expect(spot.radius).toBeGreaterThan(0);
      expect(spot.radius).toBeLessThanOrEqual(INTERIOR_SPOT_RANGE + 8);
    }
  });

  it('工作区陈设点的坐标就是房间矩形 + 共享偏移，不写第二份', () => {
    const work = roomRect('工作区');
    const printer = INTERIOR_SPOTS.find((spot) => spot.kind === 'printer')!;
    const cart = INTERIOR_SPOTS.find((spot) => spot.kind === 'snackCart')!;
    const board = INTERIOR_SPOTS.find((spot) => spot.kind === 'whiteboard')!;
    expect(printer.x).toBe(work.x + 272);
    expect(cart.x).toBe(work.x + 318);
    expect(board.x).toBe(work.x + 120);
  });

  it('小黑屋反省点压在共享锚点上，三个反省位都够得着', () => {
    const cell = INTERIOR_SPOTS.find((spot) => spot.kind === 'cellBench')!;
    expect(cell.x).toBe(JAIL_ANCHOR.x);
    const out: InteriorSpotTarget = { id: '', kind: 'printer', index: -1, x: 0, y: 0 };
    // 左右两张凳子的坐点离锚点各 48，仍在 60 的感应圈里
    expect(nearestInteriorSpotInto(out, JAIL_ANCHOR.x - 48, JAIL_ANCHOR.y)).toBe(true);
    expect(out.kind).toBe('cellBench');
    expect(nearestInteriorSpotInto(out, JAIL_ANCHOR.x + 48, JAIL_ANCHOR.y)).toBe(true);
    expect(out.kind).toBe('cellBench');
  });

  it('查询写进复用槽位，范围外返回 false 且不改槽位语义', () => {
    const out: InteriorSpotTarget = { id: '', kind: 'printer', index: -1, x: 0, y: 0 };
    const printer = INTERIOR_SPOTS.find((spot) => spot.kind === 'printer')!;
    expect(nearestInteriorSpotInto(out, printer.x + 4, printer.y)).toBe(true);
    expect(out.kind).toBe('printer');
    expect(out.x).toBe(printer.x);
    // 场外（岛心广场）不该命中任何室内陈设
    expect(nearestInteriorSpotInto(out, 4096, 4096)).toBe(false);
    expect(nearestInteriorSpotInto(out, Number.NaN, 0)).toBe(false);
  });

  it('洗手台在洗手与照镜子之间轮换，镜子台词按物种分支', () => {
    expect(interiorSpotAction('vanity', 0)).toBe('wash');
    expect(interiorSpotAction('vanity', 1)).toBe('mirror');
    expect(interiorSpotAction('vanity', 2)).toBe('wash');
    expect(interiorSpotAction('printer', 1)).toBe('plain');

    const cowMirror = pickInteriorLine('vanity', 1, 'cow');
    const horseMirror = pickInteriorLine('vanity', 1, 'horse');
    expect(cowMirror).not.toBe(horseMirror);
    // 同一计数永远同一句：连按同一处不会随机跳词
    expect(pickInteriorLine('vanity', 1, 'cow')).toBe(cowMirror);
    expect(pickInteriorLine('vanity', 0, 'cow')).not.toBe(cowMirror);
  });

  it('台词按次数轮转且可复现，负数与小数也安全', () => {
    for (const kind of ['printer', 'snackCart', 'whiteboard', 'dryer', 'wardrobe', 'bookshelf', 'clock', 'snowWindow', 'cellBench'] as const) {
      const first = pickInteriorLine(kind, 0);
      expect(pickInteriorLine(kind, 0)).toBe(first);
      expect(pickInteriorLine(kind, -3)).toBe(pickInteriorLine(kind, 3));
      expect(pickInteriorLine(kind, 1.9).length).toBeGreaterThan(0);
    }
  });
});
