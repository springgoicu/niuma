import { describe, expect, it } from 'bun:test';
import {
  BULLETIN_BOARD,
  DICE_HALL_SEAT_IDS,
  DICE_TABLES,
  DIRECTION,
  RING_BENCH_SEAT_IDS,
  TEA_STATION,
  WELCOME_LANDMARKS,
  WORLD_HOTSPOTS,
  WORLD_LAYOUT,
  isWorkDeskSeat,
  seatById,
  type PropKind,
  type SeatInstance,
  type SeatKind,
} from '@niuma/shared-types';
import { HINT, hintButton } from '../hint-copy';
import { nearestInteractiveProp, selectContextHint } from '../interactions';

function propOf(kind: PropKind) {
  const prop = WORLD_LAYOUT.props.find((item) => item.kind === kind);
  if (!prop) throw new Error(`布局里没有 ${kind}`);
  return prop;
}

/** 座位表不直接导出，按 id 顺序扫出一条指定种类（且满足 `accept`）的座位 */
function firstSeatOfKind(
  kind: SeatKind,
  accept?: (seat: SeatInstance) => boolean,
): SeatInstance {
  for (let id = 1; ; id += 1) {
    const seat = seatById(id);
    if (!seat) throw new Error(`布局里没有 ${kind}`);
    if (seat.kind === kind && (!accept || accept(seat))) return seat;
  }
}

const noSeats = () => false;
const allSeatsFree = () => true;

describe('环境提示选择', () => {
  it('F 类互动优先于座位：即使座位在感应圈内，售货机旁也提示按 F', () => {
    const vending = propOf('vending');
    const hint = selectContextHint(vending.x, vending.y + 20, DIRECTION.Up, {
      isFreeSeat: allSeatsFree,
      // 放大座位圈，强制与设施重叠：旧顺序下这里会被「按 Z 坐下」顶掉
      sitRange: 220,
    });
    expect(hint).toBe(HINT.interact);
  });

  it('附近只有空闲座位时提示坐下，没有座位时什么也不提示', () => {
    // 工位椅旁边是「先坐下再搬砖」的入座提示（ADR-0093），这里取一把普通椅子
    const chair = firstSeatOfKind('chair', (seat) => !isWorkDeskSeat(seat.id));
    expect(
      selectContextHint(chair.x, chair.y, DIRECTION.Up, {
        isFreeSeat: (id) => seatById(id)?.kind !== 'bed',
      }),
    ).toBe(HINT.seat);

    expect(
      selectContextHint(chair.x, chair.y, DIRECTION.Up, {
        isFreeSeat: noSeats,
      }),
    ).toBeNull();
  });

  it('床位可入座时提示躺平，床被占且附近没有空坐位时不提示', () => {
    const bed = firstSeatOfKind('bed');
    expect(
      selectContextHint(bed.x, bed.y, DIRECTION.Up, {
        isFreeSeat: (id) => seatById(id)?.kind === 'bed',
      }),
    ).toBe(HINT.bed);

    expect(
      selectContextHint(bed.x, bed.y, DIRECTION.Up, {
        isFreeSeat: (id) => seatById(id)?.kind !== 'bed',
      }),
    ).toBeNull();
  });

  it('告示板要求面朝板面，背对时不提示', () => {
    const foot = { x: BULLETIN_BOARD.x, y: BULLETIN_BOARD.y };
    const options = { isFreeSeat: noSeats };
    expect(selectContextHint(foot.x, foot.y + 40, DIRECTION.Up, options)).toBe(HINT.bulletin);
    expect(selectContextHint(foot.x, foot.y + 40, DIRECTION.Down, options)).toBeNull();
  });

  it('牛马榜按距离判定，不要求朝向', () => {
    const board = WELCOME_LANDMARKS.rankBoard;
    expect(
      selectContextHint(board.x, board.y + 60, DIRECTION.Up, { isFreeSeat: noSeats }),
    ).toBe(HINT.board);
  });

  it('茶台排在饮水机之前，与按键触发顺序一致', () => {
    // 茶台离 cooler 只有 34px：站在这里两个判定都会命中，提示必须先说续杯
    expect(nearestInteractiveProp(TEA_STATION.x, TEA_STATION.y)?.kind).toBe('cooler');
    expect(
      selectContextHint(TEA_STATION.x, TEA_STATION.y, DIRECTION.Up, { isFreeSeat: noSeats }),
    ).toBe(HINT.tea);
  });

  it('远离一切与非有限坐标都不提示', () => {
    expect(selectContextHint(-100, -100, DIRECTION.Up, { isFreeSeat: noSeats })).toBeNull();
    expect(selectContextHint(Number.NaN, 0, DIRECTION.Up, { isFreeSeat: noSeats })).toBeNull();
    expect(
      selectContextHint(0, Number.POSITIVE_INFINITY, DIRECTION.Up, { isFreeSeat: noSeats }),
    ).toBeNull();
  });
});

describe('入座类玩法的提示（ADR-0093）', () => {
  /** 某张赌桌的凳子：按座位组筛，不手写座位 id */
  function stoolOf(group: string): number {
    const stool = DICE_HALL_SEAT_IDS.find((id) => seatById(id)?.group === group);
    if (stool === undefined) throw new Error(`没有 ${group} 的凳子`);
    return stool;
  }

  it('站在赌桌旁没坐下：只提示先入座，且不给可点的按钮', () => {
    const table = DICE_TABLES[0]!;
    const hint = selectContextHint(table.x, table.y, DIRECTION.Down, {
      isFreeSeat: noSeats,
      seatId: 0,
    });
    expect(hint).toBe(HINT.diceNeedSeat);
    expect(hintButton(hint!)).toBeNull();
  });

  it('坐在本桌凳子上才给「押一把」，坐在另一桌仍是先入座', () => {
    const [a, b] = DICE_TABLES;
    expect(
      selectContextHint(a!.x, a!.y, DIRECTION.Down, {
        isFreeSeat: noSeats,
        seatId: stoolOf(a!.group),
      }),
    ).toBe(HINT.dice);
    expect(
      selectContextHint(a!.x, a!.y, DIRECTION.Down, {
        isFreeSeat: noSeats,
        seatId: stoolOf(b!.group),
      }),
    ).toBe(HINT.diceNeedSeat);
  });

  it('观战长椅同理：坐上才提示押注', () => {
    const bench = WORLD_HOTSPOTS.find((def) => def.kind === 'arenaSeat')!;
    const benchSeat = RING_BENCH_SEAT_IDS[0]!;
    expect(selectContextHint(bench.x, bench.y, DIRECTION.Down, { isFreeSeat: noSeats })).toBe(
      HINT.arenaNeedSeat,
    );
    expect(
      selectContextHint(bench.x, bench.y, DIRECTION.Down, { isFreeSeat: noSeats, seatId: benchSeat }),
    ).toBe(HINT.arenaBet);
  });

  it('工位同理：坐在本工位才提示搬砖', () => {
    const desk = WORLD_HOTSPOTS.find((def) => def.kind === 'workDesk')!;
    const seatId = desk.deskIndex! + 1;
    expect(selectContextHint(desk.x, desk.y, DIRECTION.Down, { isFreeSeat: noSeats })).toBe(
      HINT.workNeedSeat,
    );
    expect(
      selectContextHint(desk.x, desk.y, DIRECTION.Down, { isFreeSeat: noSeats, seatId }),
    ).toBe(HINT.work);
  });
});
