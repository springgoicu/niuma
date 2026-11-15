import { describe, expect, it } from 'bun:test';
import { RING_MAX_HP, RING_PHASE, type RingPacket } from '@niuma/shared-types';
import {
  ringClock,
  ringHpTone,
  ringIsUrgent,
  ringPhaseLabel,
  ringRankLabel,
  ringRemainingMs,
  ringSeats,
} from '../ring-status';

function packet(overrides: Partial<RingPacket> = {}): RingPacket {
  return {
    phase: RING_PHASE.Running,
    matchId: 7,
    remainingMs: 120_000,
    members: [],
    ...overrides,
  };
}

const A = { id: 11, slot: 0, name: '甲', hp: RING_MAX_HP, eliminated: false, rank: 0 };
const B = { id: 12, slot: 1, name: '乙', hp: 6, eliminated: false, rank: 0 };

describe('ringSeats', function () {
  it('固定返回红蓝两个席位，空位也占一行', function () {
    const seats = ringSeats(packet({ members: [A] }));
    expect(seats).toHaveLength(2);
    expect(seats[0]!.member?.name).toBe('甲');
    expect(seats[1]!.member).toBeNull();
  });

  it('按 slot 落座，不按到达顺序', function () {
    const seats = ringSeats(packet({ members: [B, A] }));
    expect(seats.map((seat) => seat.member?.name ?? null)).toEqual(['甲', '乙']);
  });
});

describe('ringRemainingMs', function () {
  it('以收到包的本机时刻起算，随时间递减', function () {
    const base = 1_000_000;
    expect(ringRemainingMs(packet(), base, base)).toBe(120_000);
    expect(ringRemainingMs(packet(), base, base + 30_000)).toBe(90_000);
  });

  it('归零后不再变负', function () {
    expect(ringRemainingMs(packet(), 0, 200_000)).toBe(0);
  });

  it('时钟回拨（drift 为负）时按满时长显示', function () {
    expect(ringRemainingMs(packet(), 50, 40)).toBe(120_000);
  });

  it('非 running 阶段不提供倒计时', function () {
    expect(ringRemainingMs(packet({ phase: RING_PHASE.Waiting }), 0, 10)).toBe(0);
    expect(ringRemainingMs(packet({ phase: RING_PHASE.Award }), 0, 10)).toBe(0);
  });
});

describe('ringClock', function () {
  it('按分:秒显示并向上取整', function () {
    expect(ringClock(120_000)).toBe('2:00');
    // 59.1s 向上取整成整 60s，进位到 1:00
    expect(ringClock(59_100)).toBe('1:00');
    expect(ringClock(59_000)).toBe('0:59');
  });

  it('最后不足 1 秒仍显示 0:01', function () {
    expect(ringClock(500)).toBe('0:01');
    expect(ringClock(0)).toBe('0:00');
  });
});

describe('ringIsUrgent', function () {
  it('最后 10 秒才警示', function () {
    expect(ringIsUrgent(packet(), 10_000)).toBe(true);
    expect(ringIsUrgent(packet(), 10_500)).toBe(false);
  });

  it('已归零就不再脉动，交给结算表现', function () {
    expect(ringIsUrgent(packet(), 0)).toBe(false);
  });
});

describe('ringPhaseLabel', function () {
  it('参赛者与围观者看到不同的等待文案', function () {
    expect(ringPhaseLabel(packet({ phase: RING_PHASE.Waiting }), true)).toBe('等待挑战者');
    expect(ringPhaseLabel(packet({ phase: RING_PHASE.Waiting }), false)).toBe('等待第 2 人');
  });

  it('进行中与颁奖中不带身份差别', function () {
    expect(ringPhaseLabel(packet({ phase: RING_PHASE.Running }), false)).toBe('计分中');
    expect(ringPhaseLabel(packet({ phase: RING_PHASE.Award }), true)).toBe('颁奖中');
    expect(ringPhaseLabel(packet({ phase: RING_PHASE.Idle }), true)).toBe('空闲');
  });
});

describe('ringRankLabel', function () {
  it('只认前三名', function () {
    expect(ringRankLabel(1)).toBe('冠军');
    expect(ringRankLabel(2)).toBe('亚军');
    expect(ringRankLabel(3)).toBe('季军');
    expect(ringRankLabel(0)).toBe('');
    expect(ringRankLabel(4)).toBe('');
  });
});

describe('ringHpTone', function () {
  it('按血量分三档', function () {
    expect(ringHpTone(10)).toBe('safe');
    expect(ringHpTone(7)).toBe('safe');
    expect(ringHpTone(6)).toBe('warn');
    expect(ringHpTone(4)).toBe('warn');
    expect(ringHpTone(3)).toBe('danger');
    expect(ringHpTone(0)).toBe('danger');
  });
});

describe('RingPacket 的阶段与成员组合', function () {
  it('淘汰者的血量恒为 0，颁奖时仍占一个席位', function () {
    const award = packet({
      phase: RING_PHASE.Award,
      remainingMs: 0,
      members: [
        { ...A, rank: 1 },
        { ...B, rank: 2, hp: 0, eliminated: true },
      ],
    });
    const seats = ringSeats(award);
    expect(seats[0]!.member?.rank).toBe(1);
    expect(seats[1]!.member?.eliminated).toBe(true);
  });
});
