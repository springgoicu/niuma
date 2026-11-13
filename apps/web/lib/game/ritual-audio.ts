'use client';

import { sfx } from './sfx';

/**
 * 上香 / 续杯的一次性合成音（ADR-0061）。
 *
 * 与 `sfx.ts` 的取舍不同：那边的 6 路 `Voice` 池是给 20Hz 世界里会被频繁触发的
 * 发泄与机器音用的，每路只有三个振荡器；寺庙磬音需要 4–5 个非谐分音 + 2.5 秒衰减，
 * 装不进那个池，长衰减还会被 `acquire()` 优先抢占。
 *
 * 所以这里沿用 `woodfish-audio.ts` 的路子：一次性振荡器，响完即回收，
 * 再挂一条 150ms 反馈的短延迟当「空房间」的尾巴。
 */

const MASTER_GAIN = 0.42;
/** 连按节流：一次上香至少隔 260ms，避免把磬音叠成噪音 */
const MIN_GAP_MS = 260;

interface Chain {
  ctx: AudioContext;
  master: GainNode;
  delay: DelayNode;
}

let chain: Chain | null = null;
let lastAt = 0;

function ensureChain(): Chain | null {
  if (typeof window === 'undefined') return null;
  if (chain) return chain;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);

  // 150ms / 0.28 反馈：钟声落在「殿内」而不是「贴耳」的关键就是这条尾巴
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.15;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(master);

  chain = { ctx, master, delay };
  return chain;
}

function gate(): { audio: Chain; t: number } | null {
  if (sfx.isMuted) return null;
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  if (now - lastAt < MIN_GAP_MS) return null;
  const audio = ensureChain();
  if (!audio) return null;
  lastAt = now;
  // 首声一定发生在按键栈里，这里正好是「按 F」的调用链上
  if (audio.ctx.state === 'suspended') void audio.ctx.resume().catch(() => undefined);
  return { audio, t: audio.ctx.currentTime };
}

/** 一个非谐分音：正弦 + 指数衰减，`decay` 越长越「悠扬」 */
function partial(
  ctx: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  peak: number,
  decay: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

/**
 * 寺庙铜磬：基频 523Hz，叠 1.47× / 2.09× / 3.13× 三个非谐分音，
 * 3.13× 衰减最快（高次分音先散），基频留 2.6 秒——「清脆悠扬」全靠这个比例。
 */
export function playTempleBell(): void {
  const ready = gate();
  if (!ready) return;
  const { audio, t } = ready;
  const { ctx, master, delay } = audio;

  partial(ctx, master, t, 523, 0.28, 2.6);
  partial(ctx, master, t, 523 * 1.47, 0.12, 1.5);
  partial(ctx, master, t, 523 * 2.09, 0.07, 1.0);
  partial(ctx, master, t, 523 * 3.13, 0.035, 0.55);
  // 尾巴：只送基频与二次分音进延迟，避免高频把余响搅浑
  partial(ctx, delay, t, 523, 0.1, 2.2);
  partial(ctx, delay, t, 523 * 1.47, 0.05, 1.2);
}

/**
 * 喝茶：两下低沉的「咕嘟」+ 一段带通的气流声。
 * 气流用低通锯齿近似（本模块不建噪音缓冲，省一条常驻源）。
 */
export function playTeaGulp(): void {
  const ready = gate();
  if (!ready) return;
  const { audio, t } = ready;
  const { ctx, master, delay } = audio;

  for (let i = 0; i < 2; i += 1) {
    const at = t + i * 0.18;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, at);
    osc.frequency.exponentialRampToValueAtTime(96, at + 0.13);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + 0.2);
  }

  // 倒水的气流：锯齿过 1.2kHz 低通，短促一段
  const pour = ctx.createOscillator();
  pour.type = 'sawtooth';
  pour.frequency.setValueAtTime(320, t);
  pour.frequency.linearRampToValueAtTime(210, t + 0.26);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  const pourGain = ctx.createGain();
  pourGain.gain.setValueAtTime(0.0001, t);
  pourGain.gain.exponentialRampToValueAtTime(0.07, t + 0.03);
  pourGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  pour.connect(filter);
  filter.connect(pourGain);
  pourGain.connect(master);
  pourGain.connect(delay);
  pour.start(t);
  pour.stop(t + 0.34);
}
