import { describe, expect, it } from 'bun:test';
import { advanceOnDuty } from '../duty';

describe('在岗提醒档位', () => {
  it('不到 30 分钟不播报，游标原地不动', () => {
    expect(advanceOnDuty(29 * 60, 0)).toEqual({ minutes: 0, cursor: 0 });
    expect(advanceOnDuty(0, 1)).toEqual({ minutes: 0, cursor: 1 });
  });

  it('跨过 30 分钟播一次，再把游标推到下一档', () => {
    expect(advanceOnDuty(30 * 60, 0)).toEqual({ minutes: 30, cursor: 1 });
  });

  it('同一个档位只播一次：游标已推进时不重复', () => {
    expect(advanceOnDuty(31 * 60, 1)).toEqual({ minutes: 0, cursor: 1 });
  });

  it('后台恢复一次跨过好几档时只播最高的那档', () => {
    expect(advanceOnDuty(130 * 60, 0)).toEqual({ minutes: 120, cursor: 3 });
    expect(advanceOnDuty(61 * 60, 1)).toEqual({ minutes: 60, cursor: 2 });
  });

  it('跑完全部档位后不再播报', () => {
    expect(advanceOnDuty(999 * 60, 3)).toEqual({ minutes: 0, cursor: 3 });
  });
});
