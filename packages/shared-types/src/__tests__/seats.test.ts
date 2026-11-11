import { describe, expect, it } from 'vitest';
import {
  DIRECTION,
  PLAYER_RADIUS,
  POSE,
  SIT_RANGE,
  WORLD_LAYOUT,
  chairOffset,
  decodeSeatState,
  encodeSeatState,
  findNearestSeat,
  isBlocked,
  isOnLand,
  isSelfSolidProp,
  isWaterAt,
  resolveMotion,
  seatById,
  seatPose,
  type Direction,
  type SolidRect,
} from '../index';

const { seats, solids, props, desks } = WORLD_LAYOUT;

function rectsOverlap(a: SolidRect, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('座位布局', () => {
  it('座位 id 从 1 连续编号，seatById 可反查', () => {
    expect(seats.length).toBeGreaterThanOrEqual(40);
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

  it('马桶位于卫生间内，面朝北墙', () => {
    const toilets = seats.filter((seat) => seat.kind === 'toilet');
    expect(toilets.length).toBe(4);
    for (const seat of toilets) {
      expect(seat.facing).toBe(DIRECTION.Up);
      expect(seat.desk).toBe(-1);
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

  it('休息室与工作区的侧门都能穿过', () => {
    // 休息室东墙 x 3920–3930 开门（y 5150–5210），从门前铺装向西进屋
    expect(resolveMotion(3960, 5180, 3900, 5180).x).toBeLessThan(3920);
    // 工作区西墙 x 4240–4250 开门，从主路一侧向东进屋
    expect(resolveMotion(4220, 5180, 4280, 5180).x).toBeGreaterThan(4250);
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

  it('四排工位覆盖四个朝向：渲染端四张贴图都有真实座位在用', () => {
    const facings = new Set(chairs.map((seat) => seat.facing));
    for (const facing of [DIRECTION.Up, DIRECTION.Down, DIRECTION.Left, DIRECTION.Right]) {
      expect(facings.has(facing)).toBe(true);
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

  it('休息室的凳子面朝南侧茶几，而不是朝向随机', () => {
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

  it('南北门通道不被任何碰撞体挡住', () => {
    const lane = { x: 4032, y: 3404, w: 128, h: 1384 };
    for (const solid of solids) expect(rectsOverlap(solid, lane)).toBe(false);
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

  it('研发园与南向两栋新房间归入各自区域', () => {
    for (const name of ['会议室', '卫生间', '研发园', '工作区', '休息室']) {
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
