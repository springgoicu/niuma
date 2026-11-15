/**
 * 场所微动效：全部是 `(seed, nowMs) => 数值` 的纯函数。
 *
 * 纪律（与 `police-beacon.ts` 同源）：
 * 1. 只看绝对时间，不看帧间隔——掉帧、切标签页回来都不会错位；
 * 2. 相位由种子派生，同屏的灯不会一起闪、落叶不会一起跳；
 * 3. 没有状态、不分配对象，帧循环里直接算，测试可以直接断言区间。
 *
 * 这里只放「算」，怎么用（哪个精灵移动多少像素、透明度多少）在 `venue-art.ts` 的 `VenueFx` 里。
 */

const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 种子散列到 0..1：整数运算，浏览器与 bun 结果一致 */
export function seedUnit(seed: number): number {
  let h = (seed | 0) * 0x27d4eb2d;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 4096) / 4096;
}

/** 烛火 / 灯泡：0.82–1.00，190ms 一拍，两个不同频率叠加避免机械感 */
export function torchFlicker(seed: number, nowMs: number): number {
  const phase = nowMs / 190 + seedUnit(seed) * TAU;
  const wave = Math.sin(phase) * 0.5 + Math.sin(phase * 2.31 + 1.7) * 0.5;
  return 0.82 + 0.18 * (wave * 0.5 + 0.5);
}

/** 霓虹呼吸：0–1，2.6s 一周期，偶发一次短暂断闪 */
export function neonPulse(seed: number, nowMs: number): number {
  const unit = seedUnit(seed);
  const period = 2600;
  const t = (nowMs / period + unit) % 1;
  const breath = 0.55 + 0.45 * Math.sin(t * TAU);
  // 每个周期最后 6% 断一下，霓虹才有「老」的味道
  if (t > 0.94) return breath * 0.35;
  return breath;
}

/** 水面反光：0–1，2.4s 一周期，相位按位置错开 */
export function waterGlint(seed: number, nowMs: number): number {
  const t = (nowMs / 2400 + seedUnit(seed)) % 1;
  const wave = Math.sin(t * TAU) * 0.5 + Math.sin(t * TAU * 2.7 + 0.8) * 0.5;
  return clamp01(0.25 + 0.75 * (wave * 0.5 + 0.5));
}

/** 旗帜 / 灯串轻摆：-1–1，3.2s 一周期 */
export function bannerSway(seed: number, nowMs: number): number {
  const t = nowMs / 3200 + seedUnit(seed);
  return Math.sin(t * TAU) * 0.6 + Math.sin(t * TAU * 2.3 + 0.4) * 0.4;
}

/** 屏幕闪烁：0–1，用于影音室银幕与赌场霓虹牌，周期 1.4s 且有一段静止 */
export function screenFlicker(seed: number, nowMs: number): number {
  const unit = seedUnit(seed);
  const t = (nowMs / 1400 + unit) % 1;
  if (t < 0.72) return 0.9 + 0.1 * Math.sin(t * TAU * 3);
  return 0.55 + 0.45 * Math.sin((t - 0.72) * TAU * 6.4);
}

/**
 * 落叶横向漂移：`span` 是左右各漂多少像素。
 * 用 9s 一个完整循环，回到起点时透明度正好归零，看不出跳跃。
 */
export function leafX(seed: number, nowMs: number, span: number): number {
  const t = (nowMs / 9000 + seedUnit(seed)) % 1;
  return (t * 2 - 1) * span;
}

/** 落叶纵向起伏：与 `leafX` 共用同一个 9s 周期的两个次谐波 */
export function leafY(seed: number, nowMs: number, amp: number): number {
  const t = (nowMs / 9000 + seedUnit(seed)) % 1;
  return Math.sin(t * TAU * 3.1) * amp + Math.sin(t * TAU * 1.3 + 1.1) * amp * 0.6;
}

/** 落叶透明度：首尾淡入淡出，中间满亮 */
export function leafAlpha(seed: number, nowMs: number): number {
  const t = (nowMs / 9000 + seedUnit(seed)) % 1;
  const fade = Math.min(t / 0.12, (1 - t) / 0.12, 1);
  return clamp01(fade) * 0.85;
}

/* ------------------------------------------------------------------ *
 * 弱交互场所演出（会议室投屏 / 影厅大屏 / 摩天轮 / 打卡闪光）
 *
 * 与上面同一条纪律：只看绝对时间、相位由种子派生、不分配对象。
 * 帧循环里只拿返回值去换帧 / 写坐标，不做任何浮点缩放或旋转插值。
 * ------------------------------------------------------------------ */

/** 幻灯片轮播：每 holdMs 换一张，按序号回环；非法输入落回第一张 */
export function slideIndex(nowMs: number, count: number, holdMs: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(holdMs) || holdMs <= 0) return 0;
  const t = Number.isFinite(nowMs) ? nowMs : 0;
  return Math.floor(t / holdMs) % Math.trunc(count);
}

/**
 * 摩天轮步进：一个整圈切 `steps` 份，返回当前落在第几份。
 * 调用方按 `(step + i * steps / 6) % steps` 取六个吊舱的圆心偏移。
 */
export function ferrisStep(nowMs: number, periodMs: number, steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  if (!Number.isFinite(periodMs) || periodMs <= 0) return 0;
  const t = Number.isFinite(nowMs) ? nowMs : 0;
  const phase = (t / periodMs) % 1;
  return Math.floor(phase * Math.trunc(steps)) % Math.trunc(steps);
}

/** 彩灯逐颗亮灭：0.15–1，每颗相位由种子错开，约 1.1s 一拍（夜里才乘上夜间增益） */
export function bulbPulse(seed: number, nowMs: number): number {
  const unit = seedUnit(seed);
  const t = (nowMs / 1100 + unit) % 1;
  const wave = Math.sin(t * TAU) * 0.5 + Math.sin(t * TAU * 2.7 + 1.1) * 0.5;
  return clamp01(0.15 + 0.85 * (wave * 0.5 + 0.5));
}

/** 音符上浮进度：0 在音箱边缘、1 在最高点，取整前由调用方乘高度 */
export function noteRise(seed: number, nowMs: number): number {
  const t = (nowMs / 2600 + seedUnit(seed)) % 1;
  return t;
}

/** 音符左右轻摆：相对锚点的横向像素偏移（-amp..amp），与上浮共用 2.6s 周期 */
export function noteSway(seed: number, nowMs: number, amp: number): number {
  const t = (nowMs / 2600 + seedUnit(seed)) % 1;
  return Math.sin(t * TAU * 1.6 + seedUnit(seed + 7) * TAU) * amp;
}

/** 音符透明度：上浮前段淡入、后段淡出，避免出现「凭空出现又凭空消失」 */
export function noteAlpha(seed: number, nowMs: number): number {
  const t = noteRise(seed, nowMs);
  const fade = Math.min(t / 0.18, (1 - t) / 0.22, 1);
  return clamp01(fade) * 0.9;
}

/**
 * 平滑逼近目标值（影厅压暗 / 复原）：`tauMs` 是时间常数，约 3τ 到位。
 * 用指数衰减而不是固定步长：掉帧时不会走成匀速，也不会过冲。
 */
export function approachValue(current: number, target: number, dtMs: number, tauMs: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return target;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return current;
  if (!Number.isFinite(tauMs) || tauMs <= 0) return target;
  const k = 1 - Math.exp(-dtMs / tauMs);
  const next = current + (target - current) * k;
  // 收尾时直接吸附，避免永远差 0.001 的抖动
  return Math.abs(target - next) < 0.002 ? target : next;
}

/** 相机闪光包络：前 18% 冲最亮，之后线性收尾，到期返回 0 */
export function photoFlashAlpha(ageMs: number, lifeMs: number): number {
  if (!Number.isFinite(ageMs) || !Number.isFinite(lifeMs) || lifeMs <= 0) return 0;
  if (ageMs < 0 || ageMs >= lifeMs) return 0;
  const t = ageMs / lifeMs;
  if (t < 0.18) return t / 0.18;
  return 1 - (t - 0.18) / 0.82;
}

/**
 * 工位专注光：0.84–1.00，1.8s 一周期。
 *
 * 只做「亮度呼吸」，不做缩放——像素画里浮点缩放会立刻糊掉 1px 描边（ADR-0005）。
 * 下限留在 0.84：光晕要一直读得出「有人在干活」，不能闪成霓虹。
 */
export function focusPulse(seed: number, nowMs: number): number {
  const t = (nowMs / 1800 + seedUnit(seed)) % 1;
  const wave = Math.sin(t * TAU) * 0.5 + Math.sin(t * TAU * 2.7 + 0.9) * 0.5;
  return 0.84 + 0.16 * (wave * 0.5 + 0.5);
}

/**
 * 接触不良的顶灯：0–1 亮度。
 *
 * 5.4s 一周期，落在周期末尾的 4% 里连断两下（每下 90ms 左右），
 * 其余时间保持常亮——真实的坏灯是「偶尔抽一下」，不是持续频闪。
 */
export function badContactFlicker(seed: number, nowMs: number): number {
  const period = 5400;
  const t = (nowMs / period + seedUnit(seed)) % 1;
  if (t < 0.94) return 1;
  // 末尾 6%：90ms 亮 / 90ms 灭，两轮
  const slice = Math.floor(((t - 0.94) / 0.06) * 4);
  return slice % 2 === 0 ? 0.28 : 1;
}

/** 暖黄壁灯光晕：0.55–1.00，4.2s 一周期；比烛火慢，读起来是「屋里有人」而不是「着火」 */
export function warmGlowBreath(seed: number, nowMs: number): number {
  const t = (nowMs / 4200 + seedUnit(seed)) % 1;
  const wave = Math.sin(t * TAU) * 0.5 + Math.sin(t * TAU * 1.6 + 2.1) * 0.5;
  return 0.55 + 0.45 * (wave * 0.5 + 0.5);
}

/**
 * 亮屏代码行的两帧相位：0 / 1。
 *
 * 560ms 一切，切到第 4 拍时多停一拍再跳，读起来像「有人在敲键盘」而不是定时器动画。
 * 返回整数，调用方只做纹理引用切换。
 */
export function codeLinePhase(seed: number, nowMs: number): 0 | 1 {
  const beat = 560;
  const tick = Math.floor(nowMs / beat + seedUnit(seed) * 4);
  // 每 5 拍里有一拍不换：相位原地停一拍
  const held = tick - Math.floor(tick / 5);
  return (Math.abs(held) % 2) as 0 | 1;
}
