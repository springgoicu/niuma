'use client';

import { sfx } from './sfx';

/**
 * 赛博木鱼的 Web Audio 合成（ADR-0059）。
 *
 * 三条约束：
 * 1. 不引入音频资源：木身用三角波 + 低通，铜环用正弦泛音，空灵感来自一条短延迟。
 * 2. 首声一定发生在点击 / 空格栈里，绕开浏览器自动播放限制。
 * 3. 世界音效被静音时这里也静默——玩家按下静音，不是只想关掉脚步声。
 *
 * 与 `sfx.ts` 的取舍不同：那边是 20Hz 世界里会被频繁触发的音源，所以建了常驻 Voice 池；
 * 木鱼是 UI 里的手动作，一下两个短命振荡器，敲完即回收，比养池更简单。
 */

const MASTER_GAIN = 0.5;
/** 连点节流：60ms 内的重复敲击直接合并，避免叠成噪音 */
const MIN_GAP_MS = 60;

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

  // 一条 110ms 的短延迟 + 0.18 反馈：木鱼尾巴听起来像在空房间里，而不是贴耳敲
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.11;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.18;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(master);

  chain = { ctx, master, delay };
  return chain;
}

/** 敲一下：木身 + 铜环泛音 + 延迟尾巴；静音 / 节流 / 无 AudioContext 时静默返回 */
export function playWoodfish(): void {
  if (sfx.isMuted) return;
  const now = typeof performance === 'undefined' ? Date.now() : performance.now();
  if (now - lastAt < MIN_GAP_MS) return;
  const audio = ensureChain();
  if (!audio) return;
  lastAt = now;
  if (audio.ctx.state === 'suspended') void audio.ctx.resume();

  const t = audio.ctx.currentTime;

  // 木身：196Hz 三角波，音高在 160ms 内轻微下沉，听着像木头的「咚」
  const body = audio.ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(196, t);
  body.frequency.exponentialRampToValueAtTime(146, t + 0.16);
  const bodyGain = audio.ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  const bodyFilter = audio.ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.value = 1500;
  body.connect(bodyGain);
  bodyGain.connect(bodyFilter);
  bodyFilter.connect(audio.master);
  const send = audio.ctx.createGain();
  send.gain.value = 0.22;
  bodyFilter.connect(send);
  send.connect(audio.delay);
  body.start(t);
  body.stop(t + 0.4);

  // 铜环：932Hz 正弦，衰减快、音量小，只负责那一点「叮」的通透
  const ping = audio.ctx.createOscillator();
  ping.type = 'sine';
  ping.frequency.value = 932;
  const pingGain = audio.ctx.createGain();
  pingGain.gain.setValueAtTime(0.0001, t);
  pingGain.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
  pingGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  ping.connect(pingGain);
  pingGain.connect(audio.master);
  ping.start(t);
  ping.stop(t + 0.16);
}
