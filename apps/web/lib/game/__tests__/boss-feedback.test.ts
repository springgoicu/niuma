import { describe, expect, it } from 'bun:test';
import { bossHitFeedback } from '../boss-feedback';

const LOCAL = 7;
const BOSS_HP = 10_000;

function packet(hp: number, attackerId: number, extra: Partial<{ died: boolean; reset: boolean }> = {}) {
  return { hp, attackerId, died: false, reset: false, ...extra };
}

describe('boss hit feedback', () => {
  it('入场补发只同步血条，不触发任何反馈', () => {
    expect(bossHitFeedback(packet(9000, 0), LOCAL, -1)).toEqual({
      hit: false,
      byLocal: false,
      damage: 0,
    });
  });

  it('跨日回满即使带着出招者也不当作命中', () => {
    expect(bossHitFeedback(packet(BOSS_HP, 3, { reset: true }), LOCAL, 0)).toEqual({
      hit: false,
      byLocal: false,
      damage: 0,
    });
  });

  it('旁观他人命中：要抖动发声，但不是本人出招', () => {
    expect(bossHitFeedback(packet(BOSS_HP - 1, 3), LOCAL, BOSS_HP)).toEqual({
      hit: true,
      byLocal: false,
      damage: 1,
    });
  });

  it('本人命中时标出 byLocal，供音效走本地节流档', () => {
    expect(bossHitFeedback(packet(BOSS_HP - 1, LOCAL), LOCAL, BOSS_HP)).toEqual({
      hit: true,
      byLocal: true,
      damage: 1,
    });
  });

  it('还没收到过快照时按 1 点兜底，不把整条血算成伤害', () => {
    expect(bossHitFeedback(packet(120, 3), LOCAL, -1).damage).toBe(1);
  });

  it('一次跨多点时按前后血量差显示', () => {
    expect(bossHitFeedback(packet(BOSS_HP - 3, 3), LOCAL, BOSS_HP).damage).toBe(3);
  });

  it('血量没降也至少显示 1 点，不出现 -0', () => {
    expect(bossHitFeedback(packet(BOSS_HP, 3), LOCAL, BOSS_HP)).toEqual({
      hit: true,
      byLocal: false,
      damage: 1,
    });
  });
});
