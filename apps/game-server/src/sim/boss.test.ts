import { describe, expect, it } from 'bun:test';
import { BOSS_MAX_HP } from '@niuma/shared-types';
import { BossRuntime } from './boss';

/**
 * 每日血量语义（ADR-0070）：
 * - 全园区一条血，初始 10000，命中一次 -1；
 * - 归零后继续出招返回 null，justDied 只在 1→0 那一次为真；
 * - 跨本地零点自动回到 10000，跨多天也一次补齐。
 */

const NOON = new Date(2026, 10, 13, 12, 0, 0, 0).getTime();
const MIDNIGHT = new Date(2026, 10, 14, 0, 0, 0, 0).getTime();
const NEXT_MIDNIGHT = new Date(2026, 10, 15, 0, 0, 0, 0).getTime();

function runtimeAt(now = NOON): BossRuntime {
  return new BossRuntime(now);
}

describe('老板每日血量', () => {
  it('入场即满血，下一个本地零点就是重置时刻', () => {
    const boss = runtimeAt();
    expect(boss.hp).toBe(BOSS_MAX_HP);
    expect(boss.nextResetAt).toBe(MIDNIGHT);
  });

  it('每次命中扣 1 点，不影响别人下一次命中的出招者归属', () => {
    const boss = runtimeAt();
    expect(boss.hit(1, NOON)).toEqual({ hp: BOSS_MAX_HP - 1, attackerId: 1, justDied: false });
    expect(boss.hit(2, NOON + 50)).toEqual({ hp: BOSS_MAX_HP - 2, attackerId: 2, justDied: false });
    expect(boss.hp).toBe(BOSS_MAX_HP - 2);
  });

  it('1 → 0 只报一次 justDied，归零后继续踢返回 null 且不再扣点', () => {
    const boss = runtimeAt();
    for (let i = 0; i < BOSS_MAX_HP - 1; i += 1) boss.hit(1, NOON);
    const last = boss.hit(2, NOON);
    expect(last).toEqual({ hp: 0, attackerId: 2, justDied: true });

    // 同一 Tick 里后面的人继续出招：不再产生事件
    for (let i = 0; i < 8; i += 1) expect(boss.hit(3, NOON)).toBeNull();
    expect(boss.hp).toBe(0);
  });

  it('零点前不重置，零点整重置，并推进到下一天', () => {
    const boss = runtimeAt();
    for (let i = 0; i < 100; i += 1) boss.hit(1, NOON);
    expect(boss.hp).toBe(BOSS_MAX_HP - 100);

    expect(boss.syncDay(MIDNIGHT - 1)).toBe(false);
    expect(boss.hp).toBe(BOSS_MAX_HP - 100);
    expect(boss.syncDay(MIDNIGHT)).toBe(true);
    expect(boss.hp).toBe(BOSS_MAX_HP);
    expect(boss.nextResetAt).toBe(NEXT_MIDNIGHT);
  });

  it('忘记显式 syncDay 时，跨日后的第一脚也会先重置再扣 1', () => {
    const boss = runtimeAt();
    for (let i = 0; i < BOSS_MAX_HP; i += 1) boss.hit(1, NOON);
    expect(boss.hp).toBe(0);

    const afterReset = boss.hit(9, MIDNIGHT);
    expect(afterReset).toEqual({ hp: BOSS_MAX_HP - 1, attackerId: 9, justDied: false });
  });

  it('服务端休眠或时钟跳跃跨过多天时，一次 syncDay 回到满血', () => {
    const boss = runtimeAt();
    boss.hit(1, NOON);
    const jump = new Date(2026, 10, 20, 8, 0, 0, 0).getTime();
    expect(boss.syncDay(jump)).toBe(true);
    expect(boss.hp).toBe(BOSS_MAX_HP);
    expect(boss.nextResetAt).toBe(new Date(2026, 10, 21, 0, 0, 0, 0).getTime());
  });
});

/**
 * 快照恢复（ADR-0081）：重启不该白送一条新血，也不该把昨天的尸体留在场上。
 * 两个分支的判据只有一个——回满点有没有过期。
 */
describe('老板快照恢复', () => {
  it('回满点还在未来：血量与重置点原样接上', () => {
    const boss = runtimeAt();
    for (let i = 0; i < 100; i += 1) boss.hit(1, NOON);
    const saved = boss.snapshot();
    const revived = new BossRuntime(NOON + 60_000);
    revived.restore(saved, NOON + 60_000);
    expect(revived.hp).toBe(BOSS_MAX_HP - 100);
    expect(revived.nextResetAt).toBe(MIDNIGHT);
  });

  it('停机跨过零点：满血并推进到当前服务器日的下一个零点', () => {
    const boss = runtimeAt();
    for (let i = 0; i < 100; i += 1) boss.hit(1, NOON);
    const revived = new BossRuntime(NEXT_MIDNIGHT);
    revived.restore(boss.snapshot(), NEXT_MIDNIGHT);
    expect(revived.hp).toBe(BOSS_MAX_HP);
    expect(revived.nextResetAt).toBe(new Date(2026, 10, 16, 0, 0, 0, 0).getTime());
  });

  it('坏档里的越界血量被夹回合法区间', () => {
    const boss = runtimeAt();
    boss.restore({ hp: 99_999, resetAt: MIDNIGHT }, NOON);
    expect(boss.hp).toBe(BOSS_MAX_HP);
    boss.restore({ hp: -20, resetAt: MIDNIGHT }, NOON);
    expect(boss.hp).toBe(0);
  });
});
