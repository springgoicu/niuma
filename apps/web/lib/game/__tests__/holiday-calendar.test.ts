import { describe, expect, it } from 'bun:test';
import {
  ALMANAC_BAD,
  ALMANAC_GOOD,
  HOLIDAY_TABLE_YEARS,
  dailyAlmanac,
  djb2,
  formatCountdown,
  holidayCalendar,
  tickerMessages,
  upcomingHolidays,
  weekProgress,
  weekendCountdown,
} from '../holiday-calendar';
import { localDateKey, startOfLocalDay } from '../local-date';

/** 2026-03-30 是周一；本项目所有边界用例都以这一周为基准 */
const MON = new Date(2026, 2, 30, 9, 0, 0).getTime();
const FRI = new Date(2026, 3, 3, 18, 0, 0).getTime();
const NEXT_MON = new Date(2026, 3, 6, 9, 0, 0).getTime();

function at(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

describe('本地日期键', () => {
  it('按本地时区切日，不落进 UTC 的前一天', () => {
    expect(localDateKey(at(2026, 3, 30, 0, 0, 1))).toBe('2026-03-30');
    expect(localDateKey(at(2026, 3, 30, 23, 59, 59))).toBe('2026-03-30');
    expect(localDateKey(at(2026, 1, 1, 8, 0, 0))).toBe('2026-01-01');
  });

  it('零点钉在当天 00:00，跨月与跨年都成立', () => {
    expect(localDateKey(startOfLocalDay(at(2026, 12, 31, 23, 0, 0)))).toBe('2026-12-31');
    expect(startOfLocalDay(at(2026, 3, 1, 15, 0, 0))).toBe(at(2026, 3, 1, 0, 0, 0));
  });
});

describe('本周解脱倒计时', () => {
  it('周一 09:00 到周五 18:00 正好 105 小时', () => {
    const countdown = weekendCountdown(MON);
    expect(countdown.state).toBe('WEEKDAY');
    expect(countdown.targetMs).toBe(FRI);
    expect(countdown.remainingMs).toBe(105 * 3600 * 1000);
    expect(countdown.days).toBe(4);
    expect(countdown.hours).toBe(9);
    expect(countdown.minutes).toBe(0);
    expect(countdown.seconds).toBe(0);
    expect(countdown.weekendEndsAt).toBe(NEXT_MON);
  });

  it('周五 18:00 前一秒仍在倒数', () => {
    const countdown = weekendCountdown(FRI - 1000);
    expect(countdown.state).toBe('WEEKDAY');
    expect(countdown.remainingMs).toBe(1000);
    expect(countdown.seconds).toBe(1);
  });

  it('周五 18:00 整点进入周末态，周末还剩 63 小时', () => {
    const countdown = weekendCountdown(FRI);
    expect(countdown.state).toBe('IS_WEEKEND');
    expect(countdown.remainingMs).toBe(0);
    expect(countdown.weekendEndsAt).toBe(NEXT_MON);
    expect(countdown.weekendRemainingMs).toBe(63 * 3600 * 1000);
  });

  it('周日中午仍在周末态，周一 09:00 开始新的一周', () => {
    expect(weekendCountdown(at(2026, 4, 5, 12, 0, 0)).state).toBe('IS_WEEKEND');
    expect(weekendCountdown(NEXT_MON - 1).state).toBe('IS_WEEKEND');
    const monday = weekendCountdown(NEXT_MON);
    expect(monday.state).toBe('WEEKDAY');
    expect(monday.targetMs).toBe(at(2026, 4, 10, 18, 0, 0));
    expect(monday.remainingMs).toBe(105 * 3600 * 1000);
  });

  it('周末态下个周五会顺延一整周，不会倒着算', () => {
    const sunday = weekendCountdown(at(2026, 4, 5, 23, 0, 0));
    expect(sunday.state).toBe('IS_WEEKEND');
    expect(sunday.weekendEndsAt).toBe(NEXT_MON);
  });
});

describe('本周工时进度', () => {
  it('周一 09:00 是 0%，周五 18:00 是 100%', () => {
    expect(weekProgress(MON).percent).toBe(0);
    expect(weekProgress(FRI).percent).toBe(100);
    expect(weekProgress(MON).totalMs).toBe(105 * 3600 * 1000);
  });

  it('周三中午落在中间，周末与深夜钳在两端', () => {
    const middle = weekProgress(at(2026, 4, 1, 12, 0, 0)).percent;
    expect(middle).toBeGreaterThan(30);
    expect(middle).toBeLessThan(60);
    expect(weekProgress(MON - 3600 * 1000).percent).toBe(0);
    expect(weekProgress(at(2026, 4, 5, 12, 0, 0)).percent).toBe(100);
  });
});

describe('法定节假日池', () => {
  it('2026-03-30 往后排：清明、劳动、端午', () => {
    const list = upcomingHolidays(MON);
    expect(list.map((item) => item.name)).toEqual(['清明节', '劳动节', '端午节']);
    expect(list[0]!.daysLeft).toBe(6);
    expect(list[0]!.restDays).toBe(3);
    expect(list[1]!.daysLeft).toBe(32);
    expect(list[1]!.restDays).toBe(5);
    expect(list[2]!.daysLeft).toBe(81);
  });

  it('当天节日不过期，排在第一位且天数 0', () => {
    const list = upcomingHolidays(at(2026, 4, 5, 20, 0, 0));
    expect(list[0]!.name).toBe('清明节');
    expect(list[0]!.daysLeft).toBe(0);
  });

  it('跨年：2026-12-31 之后是元旦、春节、清明', () => {
    const list = upcomingHolidays(at(2026, 12, 31, 12, 0, 0));
    expect(list.map((item) => item.name)).toEqual(['元旦', '春节', '清明节']);
    expect(list[0]!.daysLeft).toBe(1);
    expect(list[1]!.daysLeft).toBe(37);
    expect(list[2]!.daysLeft).toBe(95);
  });

  it('农历三年对照表原样锁定', () => {
    expect(HOLIDAY_TABLE_YEARS).toEqual([2026, 2027, 2028]);
    const spring = [2026, 2027, 2028].map((year) => {
      const item = holidayCalendar(year).find((entry) => entry.id === 'spring-festival')!;
      return localDateKey(item.at);
    });
    expect(spring).toEqual(['2026-02-17', '2027-02-06', '2028-01-26']);
    const dragon = [2026, 2027, 2028].map((year) => {
      const item = holidayCalendar(year).find((entry) => entry.id === 'dragon-boat')!;
      return localDateKey(item.at);
    });
    expect(dragon).toEqual(['2026-06-19', '2027-06-09', '2028-05-28']);
  });

  it('表外年份不猜农历日期，只在年历里标成待更新', () => {
    const spring = holidayCalendar(2030).find((entry) => entry.id === 'spring-festival')!;
    expect(spring.scheduled).toBe(false);
    expect(Number.isFinite(spring.at)).toBe(false);
    // 不能混进最近的未来节日里
    expect(upcomingHolidays(at(2030, 3, 1, 12, 0, 0)).every((item) => item.scheduled)).toBe(true);
  });

  it('固定日期节日每年都在，按时间升序且不含过期项', () => {
    const list = upcomingHolidays(at(2026, 10, 2, 12, 0, 0), 7);
    expect(list[0]!.name).toBe('元旦');
    expect(list[0]!.daysLeft).toBe(91);
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i]!.at).toBeGreaterThanOrEqual(list[i - 1]!.at);
    }
    expect(upcomingHolidays(at(2026, 10, 1, 12, 0, 0))[0]!.name).toBe('国庆节');
  });
});

describe('每日牛马黄历', () => {
  it('同一天永远同一份，换一天才会换', () => {
    const a = dailyAlmanac('2026-03-30');
    const b = dailyAlmanac('2026-03-30');
    expect(a).toEqual(b);
    expect(a.good).toEqual(b.good);
    expect(a.bad).toEqual(b.bad);
    const c = dailyAlmanac('2026-03-31');
    expect(c.hash).not.toBe(a.hash);
  });

  it('宜忌各 2 项、互不重复，且全部来自预设池', () => {
    for (let day = 1; day <= 28; day += 1) {
      const key = `2026-02-${String(day).padStart(2, '0')}`;
      const almanac = dailyAlmanac(key);
      expect(almanac.good).toHaveLength(2);
      expect(almanac.bad).toHaveLength(2);
      expect(new Set(almanac.good).size).toBe(2);
      expect(new Set(almanac.bad).size).toBe(2);
      for (const item of almanac.good) expect(ALMANAC_GOOD).toContain(item);
      for (const item of almanac.bad) expect(ALMANAC_BAD).toContain(item);
      expect(almanac.motto.length).toBeGreaterThan(4);
    }
  });

  it('djb2 按码点推进，负数与非 ASCII 也稳定', () => {
    expect(djb2('')).toBe(5381);
    expect(djb2('2026-03-30')).toBe(djb2('2026-03-30'));
    expect(djb2('牛马')).toBeGreaterThan(0);
    expect(djb2('a')).toBe((5381 * 33 + 97) >>> 0);
  });
});

describe('格式化与跑马灯文案', () => {
  it('倒计时按 02天 06小时 41分 28秒 补齐两位', () => {
    const ms = ((2 * 24 + 6) * 3600 + 41 * 60 + 28) * 1000;
    expect(formatCountdown(ms)).toBe('02天 06小时 41分 28秒');
    expect(formatCountdown(-1)).toBe('00天 00小时 00分 00秒');
  });

  it('工作日三句轮播：周五倒计时、春节、元旦', () => {
    const [first, second, third] = tickerMessages(MON);
    expect(first).toContain('距离周五下班还剩');
    expect(first).toContain('4天');
    expect(first).toContain('09:00:00');
    expect(second).toBe('🧧 距离春节还有 313 天');
    expect(third).toBe('🧨 距离元旦还有 277 天');
  });

  it('周末改说合法摸鱼，春节 / 元旦仍留在后两槽', () => {
    const [first, second, third] = tickerMessages(FRI);
    expect(first).toBe('🏖️ 合法摸鱼周末进行中！');
    expect(second).toContain('距离春节');
    expect(third).toContain('距离元旦');
  });
});
