import { describe, expect, it } from 'vitest';
import {
  CHAIR_GAP,
  DESK_H,
  DESK_W,
  DIRECTION,
  PLAYER_RADIUS,
  POSE,
  SIT_RANGE,
  WORLD_LAYOUT,
  chairOffset,
  decodeSeatState,
  deskDepthOffset,
  deskFootprint,
  encodeSeatState,
  findNearestSeat,
  isBlocked,
  isOnLand,
  isSelfSolidProp,
  isWaterAt,
  propSolid,
  resolveMotion,
  seatById,
  seatPose,
  type Direction,
  type PropKind,
  type SolidRect,
} from '../index';

const { seats, solids, props, desks } = WORLD_LAYOUT;

function rectsOverlap(a: SolidRect, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('座位布局', () => {
  it('座位 id 从 1 连续编号，seatById 可反查', () => {
    // ADR-0044：四边散布的工位删除后，座位只剩工作区 8 + 会议 8 + 马桶 6（ADR-0053）+ 宿舍 7
    expect(seats.length).toBeGreaterThanOrEqual(20);
    seats.forEach((seat, index) => {
      expect(seat.id).toBe(index + 1);
      expect(seatById(seat.id)).toBe(seat);
    });
    expect(seatById(0)).toBeUndefined();
    expect(seatById(seats.length + 1)).toBeUndefined();
  });

  it('每个座位都在陆地上、不压墙与桌，且能容下角色', () => {
    for (const seat of seats) {
      expect(isOnLand(seat.x, seat.y, 20)).toBe(true);
      expect(isWaterAt(seat.x, seat.y)).toBe(false);
      expect(isBlocked(seat.x, seat.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it('座位两两不重叠', () => {
    for (let i = 0; i < seats.length; i += 1) {
      for (let j = i + 1; j < seats.length; j += 1) {
        const a = seats[i]!;
        const b = seats[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
      }
    }
  });

  it('工位椅引用的桌子存在且与椅子一一对应', () => {
    const chairs = seats.filter((seat) => seat.kind === 'chair' && seat.desk >= 0);
    expect(chairs.length).toBe(desks.length);
    for (const seat of chairs) {
      const desk = desks[seat.desk];
      expect(desk).toBeDefined();
      expect(Math.hypot(seat.x - desk!.x, seat.y - desk!.y)).toBeLessThan(120);
    }
  });

  it('马桶位于卫生间内，背靠水箱、面朝房间', () => {
    const toilets = seats.filter((seat) => seat.kind === 'toilet');
    // 每侧三格（ADR-0053）：房间尺寸不变，北墙从 2 个坑加到 3 个
    expect(toilets.length).toBe(6);
    for (const seat of toilets) {
      // 水箱画在精灵北端（drawToilet），人必须背对它：面向南 = 背靠水箱
      expect(seat.facing).toBe(DIRECTION.Down);
      expect(seat.desk).toBe(-1);
    }
  });

  it('每个坑位都能从南侧走进：隔断不挡在格子中间', () => {
    for (const seat of seats.filter((item) => item.kind === 'toilet')) {
      const from = { x: seat.x, y: seat.y + 100 };
      expect(isBlocked(from.x, from.y, PLAYER_RADIUS)).toBe(false);
      const moved = resolveMotion(from.x, from.y, seat.x, seat.y);
      expect(Math.hypot(moved.x - seat.x, moved.y - seat.y)).toBeLessThan(1);
    }
  });

  it('床位只能躺、凳子与沙发只能坐', () => {
    const beds = seats.filter((seat) => seat.kind === 'bed');
    expect(beds.length).toBeGreaterThanOrEqual(3);
    expect(seats.filter((seat) => seat.kind === 'stool').length).toBeGreaterThanOrEqual(2);
    expect(seats.filter((seat) => seat.kind === 'sofa').length).toBeGreaterThanOrEqual(1);

    for (const seat of beds) expect(seatPose(seat.kind)).toBe(POSE.Lie);
    for (const seat of seats.filter((item) => item.kind !== 'bed')) {
      expect(seatPose(seat.kind)).toBe(POSE.Sit);
    }
  });

  it('宿舍区与卫生间的北门都能穿过', () => {
    // 宿舍区北墙 y 4356–4366、门洞 x 3536–3596：从室内向北走
    expect(resolveMotion(3566, 4400, 3566, 4330).y).toBeLessThan(4356);
    // 卫生间北墙同一条 y、门洞 x 4596–4656
    expect(resolveMotion(4626, 4400, 4626, 4330).y).toBeLessThan(4356);
  });

  it('会议室南门能穿过，工作区没有墙', () => {
    // 会议室南墙 y 3826–3836、门洞 x 4726–4786：从室内向南出门
    expect(resolveMotion(4756, 3790, 4756, 3900).y).toBeGreaterThan(3836);
    // 工作区是开放区：从南侧草地直接走进木地板，不存在门洞
    expect(resolveMotion(3566, 3900, 3566, 3770).y).toBeLessThan(3836);
  });
});

/**
 * 座位朝向是「人正对家具」的唯一真相：
 * 工位椅对着显示器、床位头朝枕头、凳子对着茶几，渲染端只按这份数据选帧。
 */
describe('座位朝向与家具一致', () => {
  const chairs = seats.filter((seat) => seat.kind === 'chair' && seat.desk >= 0);
  const FACING_VECTOR: Record<Direction, { x: number; y: number }> = {
    [DIRECTION.Down]: { x: 0, y: 1 },
    [DIRECTION.Left]: { x: -1, y: 0 },
    [DIRECTION.Right]: { x: 1, y: 0 },
    [DIRECTION.Up]: { x: 0, y: -1 },
  };

  it('工位桌带屏幕朝向，且与椅子的入座朝向一致', () => {
    for (const seat of chairs) {
      const desk = desks[seat.desk]!;
      expect(desk.facing).toBe(seat.facing);
    }
  });

  it('椅子永远在屏幕背面一侧，偏移量由桌尺寸与 CHAIR_GAP 决定', () => {
    for (const seat of chairs) {
      const desk = desks[seat.desk]!;
      const dir = FACING_VECTOR[seat.facing];
      const gap = chairOffset(seat.facing);
      expect(seat.x).toBe(desk.x - dir.x * gap);
      expect(seat.y).toBe(desk.y - dir.y * gap);
    }
  });

  it('桌子随朝向转置：长边垂直于朝向，椅子坐在长边外侧', () => {
    for (const seat of chairs) {
      const { w, h } = deskFootprint(seat.facing);
      const horizontal = seat.facing === DIRECTION.Left || seat.facing === DIRECTION.Right;
      // 南北朝向是 88×40 的横桌，东西朝向整张桌子转 90° 变 40×88
      expect(w).toBe(horizontal ? DESK_H : DESK_W);
      expect(h).toBe(horizontal ? DESK_W : DESK_H);
      // 椅子让开的永远是短边的一半 + 椅距，不是端头
      expect(chairOffset(seat.facing)).toBe(Math.min(w, h) / 2 + CHAIR_GAP);
    }
  });

  it('工作区两排背靠背：只有上与下两个朝向，椅子在中间相对', () => {
    const facings = new Set(chairs.map((seat) => seat.facing));
    expect(facings).toEqual(new Set([DIRECTION.Up, DIRECTION.Down]));
    // 每条纵向列都有一对上下朝向的椅子，且两排桌面朝相反方向（ADR-0044）
    const xs = [...new Set(chairs.map((seat) => seat.x))];
    expect(xs).toHaveLength(4);
    for (const x of xs) {
      const column = chairs.filter((seat) => seat.x === x);
      expect(column).toHaveLength(2);
      expect(new Set(column.map((seat) => seat.facing))).toEqual(new Set([DIRECTION.Up, DIRECTION.Down]));
    }
  });

  it('东西向桌子让到椅子与人之后；南北向保持占地南边（ADR-0032）', () => {
    for (const seat of chairs) {
      const desk = desks[seat.desk]!;
      const depth = desk.y + deskDepthOffset(desk.facing);
      const side = desk.facing === DIRECTION.Left || desk.facing === DIRECTION.Right;
      if (side) {
        // 东西向的椅子与桌子同 y：人坐在 seat.y、椅子排在 seat.y - 1，桌子必须更靠后
        expect({ seat: seat.id, belowChair: depth < seat.y - 1 }).toEqual({ seat: seat.id, belowChair: true });
      } else {
        // 南北向保持现状：深度键仍是占地南边，人朝南时桌子在近侧（物理正确）
        expect(depth).toBe(desk.y + DESK_H / 2);
      }
    }
  });

  it('床位朝向统一为水平方向：头始终落在枕头那一侧', () => {
    const beds = seats.filter((seat) => seat.kind === 'bed');
    expect(beds.length).toBeGreaterThan(0);
    // 床品画法是横向的（drawBed 的枕头在右端），所有床必须同一朝向，
    // 否则会出现「头在被子中间」的躺姿
    expect(new Set(beds.map((bed) => bed.facing)).size).toBe(1);
    expect([DIRECTION.Left, DIRECTION.Right]).toContain(beds[0]!.facing as Direction);
  });

  it('宿舍区的凳子面朝南侧茶几，而不是朝向随机', () => {
    const stools = seats.filter((seat) => seat.kind === 'stool');
    expect(stools.length).toBeGreaterThanOrEqual(2);
    const tables = props.filter((prop) => prop.kind === 'sideTable');
    for (const stool of stools) {
      expect(stool.facing).toBe(DIRECTION.Down);
      expect(tables.some((table) => table.y > stool.y && Math.abs(table.x - stool.x) <= SIT_RANGE)).toBe(true);
    }
  });
});

describe('地图碰撞与装饰', () => {
  it('所有碰撞矩形四角都在陆地上', () => {
    for (const solid of solids) {
      for (const [x, y] of [
        [solid.x, solid.y],
        [solid.x + solid.w, solid.y],
        [solid.x, solid.y + solid.h],
        [solid.x + solid.w, solid.y + solid.h],
      ] as const) {
        expect(isOnLand(x, y)).toBe(true);
      }
    }
  });

  it('南北通道与东西通道不被任何碰撞体挡住', () => {
    const lanes = [
      { x: 4032, y: 3404, w: 128, h: 1312 },
      { x: 3336, y: 4032, w: 1520, h: 128 },
    ];
    for (const lane of lanes) {
      for (const solid of solids) expect(rectsOverlap(solid, lane)).toBe(false);
    }
  });

  it('每张工位桌的碰撞盒就是它的朝向占地', () => {
    const deskSolids = solids.filter((solid) => solid.kind === 'desk');
    expect(deskSolids.length).toBe(desks.length);
    for (const desk of desks) {
      const { w, h } = deskFootprint(desk.facing);
      const expected = { kind: 'desk' as const, x: desk.x - w / 2, y: desk.y - h / 2, w, h };
      expect(deskSolids).toContainEqual(expected);
    }
  });

  it('有占地的道具：碰撞盒底边贴精灵底座，正面不留隐形墙', () => {
    for (const prop of props) {
      const solid = propSolid(prop);
      if (!solid) continue;
      expect(solid.y + solid.h).toBe(prop.y);
      expect(solid.x + solid.w / 2).toBe(prop.x);
      expect(solids).toContainEqual(solid);
    }
  });

  it('大件装饰有碰撞，小件保持可穿过', () => {
    const solidKinds = new Set<PropKind>(['vending', 'cooler', 'coffee', 'bench', 'table', 'bike']);
    const passableKinds = new Set<PropKind>(['lamp', 'plant', 'bin', 'sign', 'board', 'sink', 'sideTable']);
    for (const prop of props) {
      const solid = propSolid(prop);
      if (solidKinds.has(prop.kind)) expect(solid).toBeDefined();
      if (passableKinds.has(prop.kind)) expect(solid).toBeUndefined();
    }
  });

  it('装饰物落在陆地上，且不陷进碰撞体（售货机本体即碰撞体，除外）', () => {
    for (const prop of props) {
      expect(isOnLand(prop.x, prop.y, 20)).toBe(true);
      expect(isWaterAt(prop.x, prop.y)).toBe(false);
      if (isSelfSolidProp(prop.kind)) continue;
      for (const solid of solids) {
        const inside = prop.x > solid.x && prop.x < solid.x + solid.w && prop.y > solid.y && prop.y < solid.y + solid.h;
        expect(inside).toBe(false);
      }
    }
  });

  it('四角房间与南侧庭院归入各自区域', () => {
    for (const name of ['会议室', '卫生间', '研发园', '工作区', '宿舍区']) {
      expect(WORLD_LAYOUT.regions.find((region) => region.name === name)).toBeDefined();
    }
  });
});

describe('findNearestSeat', () => {
  const first = seats[0]!;

  it('返回距离最近的空闲座位', () => {
    const picked = findNearestSeat(first.x + 5, first.y + 5, () => true);
    expect(picked?.id).toBe(first.id);
  });

  it('跳过已占用座位', () => {
    const picked = findNearestSeat(first.x, first.y, (id) => id !== first.id);
    expect(picked).toBeDefined();
    expect(picked!.id).not.toBe(first.id);
  });

  it('超出入座半径时返回 undefined', () => {
    const farX = 0;
    const farY = 0;
    expect(findNearestSeat(farX, farY, () => true)).toBeUndefined();
    expect(SIT_RANGE).toBeGreaterThan(0);
  });

  it('按种类过滤：Z 不找床、X 只找床', () => {
    const bed = seats.find((seat) => seat.kind === 'bed')!;
    const notBed = (seat: { kind: string }) => seat.kind !== 'bed';

    const bedOnly = findNearestSeat(bed.x, bed.y, () => true, SIT_RANGE, (seat) => seat.kind === 'bed');
    expect(bedOnly?.id).toBe(bed.id);
    // 床没有轮子可坐：同一位置做「坐位」查询不该命中床
    expect(findNearestSeat(bed.x, bed.y, () => true, SIT_RANGE, notBed)).toBeUndefined();
  });
});

describe('座位状态包', () => {
  it('编解码往返一致', () => {
    const entries = [
      { seatId: 1, occupant: 7 },
      { seatId: 40, occupant: 0 },
    ];
    expect(decodeSeatState(encodeSeatState(entries))).toEqual(entries);
  });

  it('空列表也能编码', () => {
    expect(decodeSeatState(encodeSeatState([]))).toEqual([]);
  });
});
