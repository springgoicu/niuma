/** 本周工时仪表的基线：超过它就把轨道切成琥珀色，提醒「卷过头了」 */
export const WEEK_METER_BASELINE_HOURS = 40;

export type WeekMeterTone = 'empty' | 'normal' | 'over';

export interface WeekMeterState {
  /** 0–100，保留一位小数；只用于 CSS 宽度 */
  percent: number;
  tone: WeekMeterTone;
  /** 超过基线的时长，未超过为 0 */
  overHours: number;
  /** 钳制后的本周小时数，便于组件直接展示 */
  hours: number;
}

/**
 * 本周工时仪表状态。
 *
 * `hasCareer=false` 时返回空轨，而不是把 0 画成「本周还没上班」：
 * 未上报与真实 0 小时在工牌上必须是两件事。
 */
export function weekMeterState(weekHours: number, hasCareer: boolean): WeekMeterState {
  if (!hasCareer) return { percent: 0, tone: 'empty', overHours: 0, hours: 0 };
  const hours = Number.isFinite(weekHours) ? Math.max(0, weekHours) : 0;
  const percent = Math.min(100, Math.round((hours / WEEK_METER_BASELINE_HOURS) * 1_000) / 10);
  const overHours = Math.max(0, Math.round((hours - WEEK_METER_BASELINE_HOURS) * 10) / 10);
  return {
    percent,
    tone: hours > WEEK_METER_BASELINE_HOURS ? 'over' : 'normal',
    overHours,
    hours: Math.round(hours * 10) / 10,
  };
}
