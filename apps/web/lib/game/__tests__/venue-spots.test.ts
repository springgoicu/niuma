import { describe, expect, it } from 'bun:test';
import { AMUSEMENT_PARK, THEATER_SCREEN, seatById, rectContains, WORLD_LAYOUT } from '@niuma/shared-types';
import {
  MEETING_LINES,
  MEETING_ROOM_RECT,
  MEETING_SCREEN_RECT,
  MEETING_SPOT,
  PARK_PHOTO_SPOTS,
  PHOTO_LINES,
  RETRO_LINES,
  THEATER_CHANNELS,
  THEATER_ROOM_RECT,
  THEATER_SCREEN_RECT,
  THEATER_SPOT,
  VENUE_IDLE_TIMING,
  VENUE_SEAT_GROUPS,
  isMeetingSeat,
  isParkBenchSeat,
  isTheaterScreenHit,
  isTheaterSeat,
  idleKindOfSeat,
  linesOfIdleKind,
  pickVenueLine,
  theaterChannelAt,
  venueBubbleDue,
  venueRoomOfSeat,
  venueSpotAt,
} from '../venue-spots';

/**
 * 本地点契约：坐姿类只看座位归属，站位类只看距离；
 * 屏幕矩形与打卡点全部由共享布局派生，不允许出现第二份手写坐标。
 */

describe('屏幕矩形', () => {
  it('会议投屏 200×56 落在会议室北墙内', () => {
    expect(MEETING_SCREEN_RECT).toEqual({
      x: MEETING_ROOM_RECT.x + (MEETING_ROOM_RECT.w - 200) / 2,
      y: MEETING_ROOM_RECT.y + 2,
      w: 200,
      h: 56,
    });
    expect(rectContains(MEETING_ROOM_RECT, MEETING_SCREEN_RECT.x, MEETING_SCREEN_RECT.y)).toBe(true);
    expect(
      rectContains(
        MEETING_ROOM_RECT,
        MEETING_SCREEN_RECT.x + MEETING_SCREEN_RECT.w,
        MEETING_SCREEN_RECT.y + MEETING_SCREEN_RECT.h,
      ),
    ).toBe(true);
  });

  it('影厅画面是共享大屏内缩 2px，点击命中整块大屏', () => {
    expect(THEATER_SCREEN_RECT).toEqual({
      x: THEATER_SCREEN.x + 2,
      y: THEATER_SCREEN.y + 2,
      w: THEATER_SCREEN.w - 4,
      h: THEATER_SCREEN.h - 4,
    });
    expect(isTheaterScreenHit(THEATER_SCREEN.x + 1, THEATER_SCREEN.y + 1)).toBe(true);
    expect(isTheaterScreenHit(THEATER_SCREEN.x - 1, THEATER_SCREEN.y + 1)).toBe(false);
    expect(isTheaterScreenHit(Number.NaN, 0)).toBe(false);
  });
});

describe('座位归属', () => {
  it('会议室 8 把、影厅 15 张、园内长椅 3 张', () => {
    expect(VENUE_SEAT_GROUPS.meeting.size).toBe(8);
    expect(VENUE_SEAT_GROUPS.theater.size).toBe(15);
    // 园内三张：游乐园自己的两张 + 游乐大街东口那张（y 3130 仍在园区围栏内）
    expect(VENUE_SEAT_GROUPS.parkBench.size).toBe(3);
  });

  it('会议椅全在会议室、影厅座椅全在影音室里', () => {
    for (const id of VENUE_SEAT_GROUPS.meeting) {
      const seat = seatById(id)!;
      expect(rectContains(MEETING_ROOM_RECT, seat.x, seat.y)).toBe(true);
      expect(seat.kind).toBe('chair');
    }
    for (const id of VENUE_SEAT_GROUPS.theater) {
      const seat = seatById(id)!;
      expect(rectContains(THEATER_ROOM_RECT, seat.x, seat.y)).toBe(true);
      expect(seat.kind).toBe('cinema');
    }
    for (const id of VENUE_SEAT_GROUPS.parkBench) {
      const seat = seatById(id)!;
      expect(rectContains(AMUSEMENT_PARK, seat.x, seat.y)).toBe(true);
      expect(seat.kind).toBe('bench');
    }
  });

  it('工位椅不会被误认成会议椅：id 0 / 越界 / 非整数一律为假', () => {
    expect(isMeetingSeat(0)).toBe(false);
    expect(isMeetingSeat(-1)).toBe(false);
    expect(isMeetingSeat(1.5)).toBe(false);
    expect(isMeetingSeat(9999)).toBe(false);
    // 第一把工位椅是 id 1，不在会议室里
    expect(isMeetingSeat(1)).toBe(false);
    expect(isTheaterSeat(1)).toBe(false);
    expect(isParkBenchSeat(1)).toBe(false);
  });

  it('房间归属只认会议室与影厅，长椅不参与屏幕演出', () => {
    expect(venueRoomOfSeat([...VENUE_SEAT_GROUPS.meeting][0]!)).toBe('meeting');
    expect(venueRoomOfSeat([...VENUE_SEAT_GROUPS.theater][0]!)).toBe('theater');
    expect(venueRoomOfSeat([...VENUE_SEAT_GROUPS.parkBench][0]!)).toBeNull();
    expect(venueRoomOfSeat(0)).toBeNull();
  });
});

describe('本地点判定', () => {
  const meetingSeat = [...VENUE_SEAT_GROUPS.meeting][0]!;
  const theaterSeat = [...VENUE_SEAT_GROUPS.theater][0]!;

  it('坐着才成立：会议椅 / 影厅椅', () => {
    const seat = seatById(meetingSeat)!;
    expect(venueSpotAt(seat.x, seat.y, meetingSeat)?.kind).toBe('meeting');
    expect(venueSpotAt(seat.x, seat.y, 0)).toBeNull();

    const cinema = seatById(theaterSeat)!;
    expect(venueSpotAt(cinema.x, cinema.y, theaterSeat)?.kind).toBe('theater');
  });

  it('游乐园打卡点按距离命中，走出半径就没有了', () => {
    for (const spot of PARK_PHOTO_SPOTS) {
      expect(venueSpotAt(spot.x, spot.y, 0)?.kind).toBe('parkPhoto');
      expect(venueSpotAt(spot.x + spot.radius + 24, spot.y, 0)).toBeNull();
    }
  });

  it('打卡点全在游乐园内，且与园内长椅坐点拉开距离', () => {
    for (const spot of PARK_PHOTO_SPOTS) {
      expect(rectContains(AMUSEMENT_PARK, spot.x, spot.y)).toBe(true);
      for (const id of VENUE_SEAT_GROUPS.parkBench) {
        const seat = seatById(id)!;
        const distance = Math.hypot(seat.x - spot.x, seat.y - spot.y);
        // 长椅坐点 90px 内会提示「按 Z 坐下」：打卡点必须比这更远，避免抢提示
        expect(distance).toBeGreaterThan(spot.radius + 60);
      }
    }
  });

  it('会议桌 / 影厅的坐标由房间矩形派生', () => {
    expect(MEETING_SPOT.x).toBe(MEETING_ROOM_RECT.x + MEETING_ROOM_RECT.w / 2);
    expect(rectContains(MEETING_ROOM_RECT, MEETING_SPOT.x, MEETING_SPOT.y)).toBe(true);
    expect(THEATER_SPOT.seatGated).toBe(true);
    expect(THEATER_SPOT.radius).toBe(0);
  });

  it('非有限坐标不命中', () => {
    expect(venueSpotAt(Number.NaN, 0, 0)).toBeNull();
    expect(venueSpotAt(0, Number.POSITIVE_INFINITY, 0)).toBeNull();
  });
});

describe('台词与频道', () => {
  it('三组台词都非空、无重复', () => {
    for (const lines of [MEETING_LINES, PHOTO_LINES, RETRO_LINES]) {
      expect(lines.length).toBeGreaterThan(0);
      expect(new Set(lines).size).toBe(lines.length);
    }
  });

  it('按次数轮转可复现，负数与非有限值不越界', () => {
    expect(pickVenueLine(MEETING_LINES, 0)).toBe(MEETING_LINES[0]);
    expect(pickVenueLine(MEETING_LINES, MEETING_LINES.length)).toBe(MEETING_LINES[0]);
    // 负数取绝对值：与设施台词 `pickLine` 同一口径
    expect(pickVenueLine(MEETING_LINES, -1)).toBe(MEETING_LINES[1]);
    expect(pickVenueLine(MEETING_LINES, Number.NaN)).toBe(MEETING_LINES[0]);
  });

  it('四个影厅频道按序号回环，名称与主色都不为空', () => {
    expect(THEATER_CHANNELS).toHaveLength(4);
    expect(theaterChannelAt(0).id).toBe('train');
    expect(theaterChannelAt(4).id).toBe('train');
    expect(theaterChannelAt(1).id).toBe(THEATER_CHANNELS[1]!.id);
    for (const channel of THEATER_CHANNELS) {
      expect(channel.name.length).toBeGreaterThan(0);
      expect(channel.color).toBeGreaterThan(0);
    }
  });
});

describe('静置气泡节流', () => {
  it('首条要等静置阈值，之后按间隔重复', () => {
    const { firstMs, intervalMs } = VENUE_IDLE_TIMING.meeting;
    expect(venueBubbleDue('meeting', firstMs - 1, intervalMs)).toBe(false);
    expect(venueBubbleDue('meeting', firstMs, intervalMs)).toBe(true);
    expect(venueBubbleDue('meeting', firstMs, intervalMs - 1)).toBe(false);
    expect(venueBubbleDue('meeting', Number.NaN, intervalMs)).toBe(false);
  });

  it('两处场所的阈值互不相同（长椅最耐坐）', () => {
    expect(VENUE_IDLE_TIMING.parkBench.firstMs).toBeGreaterThan(VENUE_IDLE_TIMING.meeting.firstMs);
  });

  it('座位 → 静置气泡种类 → 台词表三处对齐', () => {
    expect(idleKindOfSeat([...VENUE_SEAT_GROUPS.meeting][0]!)).toBe('meeting');
    expect(idleKindOfSeat([...VENUE_SEAT_GROUPS.parkBench][0]!)).toBe('parkBench');
    expect(idleKindOfSeat([...VENUE_SEAT_GROUPS.theater][0]!)).toBeNull();
    expect(linesOfIdleKind('meeting')).toBe(MEETING_LINES);
    expect(linesOfIdleKind('parkBench')).toBe(RETRO_LINES);
  });
});
