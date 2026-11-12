'use client';

import type { Species } from '@niuma/shared-types';
import type { InteractiveKind } from './interactions';
import { attenuationFor, panFor } from './spatial-audio';

/**
 * 2D 空间音效：纯振荡器合成 + 固定 Voice 池（ADR-0048）。
 *
 * 三条硬约束决定了这里的形状：
 * 1. 不引入任何音频资源，所有声音都由振荡器 + 滤波器实时合成；
 * 2. 播放路径严格零分配——节点、Gain、Panner 全部在首次手势时一次建好，
 *    振荡器只 `start()` 一次、之后靠包络门控，触发时只写 AudioParam 与标量字段；
 * 3. AudioContext 懒初始化：首次发声一定发生在按键 / 点击栈里，绕开自动播放限制。
 *
 * 代价是 6 路振荡器常驻（空闲时被包络压到 0）。用这点 CPU 换掉「每声一次
 * createOscillator + disconnect」的节点churn，是本模块的核心取舍。
 */

/** 主音量：只做一次性动作的点缀，压到不会盖过聊天与页面本身的音量 */
const MASTER_GAIN = 0.22;
/** 连点节流：叫唤动画一个窗口 440ms，90ms 内的重复触发直接丢弃，避免叠音 */
const MIN_GAP_MS = 90;
/** 固定声道数：一次咀嚼 / 牛哞最多三路振荡器，6 路足够覆盖附近的并发声源 */
const POOL_SIZE = 6;
/** 声像过渡：触发瞬间硬切会爆音，20ms 线性滑过去听不出来 */
const PAN_RAMP_S = 0.02;

const KIND = {
  moo: 0,
  neigh: 1,
  chew: 2,
  vending: 3,
  cooler: 4,
  coffee: 5,
} as const;

type SoundKind = (typeof KIND)[keyof typeof KIND];

/**
 * 一个预建的声道。字段全部在 `ensureContext` 里一次创建，播放时只改值。
 *
 * `body` / `sub` 是两路音源，`lfo` 只做颤音与抖动；三者都常驻运行，
 * 用 `bodyGain` / `subGain` / `lfoDepth` / `amp` 四个 Gain 决定「这一声长什么样」。
 */
interface Voice {
  body: OscillatorNode;
  sub: OscillatorNode;
  lfo: OscillatorNode;
  bodyGain: GainNode;
  subGain: GainNode;
  lfoDepth: GainNode;
  filter: BiquadFilterNode;
  amp: GainNode;
  /** Safari 14.1 之前没有 StereoPanner：降级为纯距离衰减，不阻塞发声 */
  panner: StereoPannerNode | null;
  /** 这一声的结束时刻（AudioContext 时间），用于抢占最早的声道 */
  endAt: number;
}

class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 空数组表示还没有建池；建池只发生在首次手势 */
  private voices: Voice[] = [];
  private muted = false;
  private lastAt = 0;
  private warned = false;
  /** 听者坐标：本地玩家世界坐标，由 session 每帧写入（标量赋值，零分配） */
  private listenerX = 0;
  private listenerY = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_GAIN;
  }

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** 本地玩家位置：只影响之后触发的声源，不需要每帧重算节点 */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  /** 本地叫唤（E）：带 90ms 节流，连点不叠音 */
  emit(species: Species, sourceX: number, sourceY: number): void {
    this.play(species === 'horse' ? KIND.neigh : KIND.moo, sourceX, sourceY, true);
  }

  /**
   * 远端叫唤：不节流。
   *
   * 全局 90ms 节流是为「同一个人连点」准备的；远端事件来自不同玩家，
   * 用同一个窗口会把附近两个人的哞声吞掉一个。
   */
  emitRemote(species: Species, sourceX: number, sourceY: number): void {
    this.play(species === 'horse' ? KIND.neigh : KIND.moo, sourceX, sourceY, false);
  }

  /** 设施互动（F）：售货机 / 饮水机 / 咖啡机各一套合成音色 */
  interact(kind: InteractiveKind, sourceX: number, sourceY: number): void {
    const sound = kind === 'vending' ? KIND.vending : kind === 'cooler' ? KIND.cooler : KIND.coffee;
    this.play(sound, sourceX, sourceY, true);
  }

  /** 本地咀嚼（G）：节流由 session 的按键冷却负责，这里只保留极短保护 */
  chew(sourceX: number, sourceY: number): void {
    this.play(KIND.chew, sourceX, sourceY, true);
  }

  /** 远端咀嚼：服务端已按 500ms 限频，客户端不再二次节流 */
  chewRemote(sourceX: number, sourceY: number): void {
    this.play(KIND.chew, sourceX, sourceY, false);
  }

  private play(kind: SoundKind, sourceX: number, sourceY: number, throttled: boolean): void {
    if (this.muted || typeof window === 'undefined') return;
    const dx = sourceX - this.listenerX;
    const dy = sourceY - this.listenerY;
    // 视野外直接不建声音：800px 是硬边界，也让远处的玩家动作不白占声道
    const distanceGain = attenuationFor(dx, dy);
    if (distanceGain <= 0) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    if (throttled) {
      const wall = performance.now();
      if (wall - this.lastAt < MIN_GAP_MS) return;
      this.lastAt = wall;
    }

    // 标签页被挂起后恢复：resume 必须在手势里发起，这里正好是按键 / 点击栈
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const now = ctx.currentTime;
    const voice = this.acquire(now);
    if (!voice) return;

    this.prepare(voice, now, panFor(dx));
    switch (kind) {
      case KIND.moo:
        this.moo(voice, now, distanceGain);
        return;
      case KIND.neigh:
        this.neigh(voice, now, distanceGain);
        return;
      case KIND.chew:
        this.chewInto(voice, now, distanceGain);
        return;
      case KIND.vending:
        this.vending(voice, now, distanceGain);
        return;
      case KIND.cooler:
        this.cooler(voice, now, distanceGain);
        return;
      case KIND.coffee:
        this.coffee(voice, now, distanceGain);
        return;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.warn('Web Audio 不可用，音效将静音');
      return null;
    }
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);

      const voices: Voice[] = [];
      for (let i = 0; i < POOL_SIZE; i += 1) voices.push(this.buildVoice(ctx, master));

      this.ctx = ctx;
      this.master = master;
      this.voices = voices;
      return ctx;
    } catch (error) {
      this.warn('音频上下文创建失败，音效将静音', error);
      return null;
    }
  }

  /**
   * 预建一个声道并让它常驻。
   *
   * OscillatorNode 是一次性的：`stop()` 之后不能再 `start()`，所以池化只能反过来——
   * 建好就一直跑，用包络 Gain 决定此刻是否可听。`start()` 不传时间，等于立即开始，
   * 之后的每一声都只是重新安排同一个振荡器的频率与包络。
   */
  private buildVoice(ctx: AudioContext, master: GainNode): Voice {
    const body = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const subGain = ctx.createGain();
    const lfoDepth = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

    bodyGain.gain.value = 1;
    subGain.gain.value = 0;
    lfoDepth.gain.value = 0;
    amp.gain.value = 0;

    body.connect(bodyGain);
    sub.connect(subGain);
    bodyGain.connect(filter);
    subGain.connect(filter);
    filter.connect(amp);
    if (panner) {
      panner.pan.value = 0;
      amp.connect(panner);
      panner.connect(master);
    } else {
      amp.connect(master);
    }
    lfo.connect(lfoDepth);
    lfoDepth.connect(body.frequency);
    lfoDepth.connect(sub.frequency);

    body.start();
    sub.start();
    lfo.start();

    return { body, sub, lfo, bodyGain, subGain, lfoDepth, filter, amp, panner, endAt: 0 };
  }

  /** 取空闲声道；全忙时抢占最早结束的那一路（短音效比长尾更该被牺牲） */
  private acquire(now: number): Voice | null {
    const voices = this.voices;
    if (voices.length === 0) return null;
    let candidate = voices[0]!;
    for (let i = 0; i < voices.length; i += 1) {
      const voice = voices[i]!;
      if (voice.endAt <= now) return voice;
      if (voice.endAt < candidate.endAt) candidate = voice;
    }
    return candidate;
  }

  /** 触发前的统一复位：先静音，再清掉上一声留下的所有自动化 */
  private prepare(voice: Voice, now: number, pan: number): void {
    const amp = voice.amp.gain;
    amp.cancelScheduledValues(now);
    amp.setValueAtTime(0.0001, now);

    voice.body.frequency.cancelScheduledValues(now);
    voice.sub.frequency.cancelScheduledValues(now);
    voice.bodyGain.gain.cancelScheduledValues(now);
    voice.subGain.gain.cancelScheduledValues(now);
    voice.lfo.frequency.cancelScheduledValues(now);
    voice.lfoDepth.gain.cancelScheduledValues(now);
    voice.filter.frequency.cancelScheduledValues(now);
    voice.filter.Q.cancelScheduledValues(now);

    if (voice.panner) {
      // 从当前声像滑到新声像：连续两声在左右两侧时不会「啪」一下
      const from = voice.panner.pan.value;
      voice.panner.pan.cancelScheduledValues(now);
      voice.panner.pan.setValueAtTime(from, now);
      voice.panner.pan.linearRampToValueAtTime(pan, now + PAN_RAMP_S);
    }
  }

  /** 牛：两个低频振荡器过低通，慢速 vibrato 做出「哞——」的尾音 */
  private moo(voice: Voice, now: number, gain: number): void {
    const end = now + 0.46;
    voice.filter.type = 'lowpass';
    voice.filter.frequency.setValueAtTime(760, now);
    voice.filter.Q.setValueAtTime(5, now);

    voice.body.type = 'sawtooth';
    voice.body.frequency.setValueAtTime(128, now);
    voice.body.frequency.linearRampToValueAtTime(104, now + 0.18);
    voice.body.frequency.linearRampToValueAtTime(118, now + 0.34);
    voice.bodyGain.gain.setValueAtTime(1, now);

    voice.sub.type = 'triangle';
    voice.sub.frequency.setValueAtTime(64, now);
    voice.subGain.gain.setValueAtTime(0.55, now);

    voice.lfo.type = 'sine';
    voice.lfo.frequency.setValueAtTime(5.2, now);
    voice.lfoDepth.gain.setValueAtTime(3.4, now);

    const amp = voice.amp.gain;
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.9 * gain), now + 0.05);
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * gain), now + 0.2);
    amp.exponentialRampToValueAtTime(0.0001, end);
    amp.linearRampToValueAtTime(0, end + 0.02);
    voice.endAt = end + 0.02;
  }

  /** 马：锯齿波下滑 + 13Hz 颤音，带通滤出「嘶」的鼻音 */
  private neigh(voice: Voice, now: number, gain: number): void {
    const end = now + 0.46;
    voice.filter.type = 'bandpass';
    voice.filter.frequency.setValueAtTime(1050, now);
    voice.filter.Q.setValueAtTime(1.4, now);

    voice.body.type = 'sawtooth';
    voice.body.frequency.setValueAtTime(540, now);
    voice.body.frequency.linearRampToValueAtTime(300, now + 0.12);
    voice.body.frequency.linearRampToValueAtTime(240, now + 0.42);
    voice.bodyGain.gain.setValueAtTime(1, now);

    voice.sub.type = 'sawtooth';
    voice.sub.frequency.setValueAtTime(760, now);
    voice.sub.frequency.linearRampToValueAtTime(430, now + 0.42);
    voice.subGain.gain.setValueAtTime(0.22, now);

    voice.lfo.type = 'sine';
    voice.lfo.frequency.setValueAtTime(13.5, now);
    voice.lfoDepth.gain.setValueAtTime(55, now);

    const amp = voice.amp.gain;
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.7 * gain), now + 0.03);
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.4 * gain), now + 0.16);
    amp.exponentialRampToValueAtTime(0.0001, end);
    amp.linearRampToValueAtTime(0, end + 0.02);
    voice.endAt = end + 0.02;
  }

  /** 咀嚼：三次短脉冲的低频「咔嚓」，带一点 7Hz 的嚼动感 */
  private chewInto(voice: Voice, now: number, gain: number): void {
    voice.filter.type = 'lowpass';
    voice.filter.frequency.setValueAtTime(620, now);
    voice.filter.Q.setValueAtTime(3, now);

    voice.body.type = 'triangle';
    voice.sub.type = 'sine';
    voice.sub.frequency.setValueAtTime(58, now);
    voice.bodyGain.gain.setValueAtTime(1, now);
    voice.subGain.gain.setValueAtTime(0.3, now);

    voice.lfo.type = 'sine';
    voice.lfo.frequency.setValueAtTime(7, now);
    voice.lfoDepth.gain.setValueAtTime(8, now);

    const amp = voice.amp.gain;
    for (let i = 0; i < 3; i += 1) {
      const at = now + i * 0.16;
      voice.body.frequency.setValueAtTime(126 - i * 6, at);
      voice.body.frequency.linearRampToValueAtTime(96 - i * 4, at + 0.1);
      amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.55 * gain), at + 0.02);
      amp.exponentialRampToValueAtTime(0.0001, at + 0.12);
    }
    const end = now + 0.46;
    amp.linearRampToValueAtTime(0, end);
    voice.endAt = end;
  }

  /** 售货机：低频 thunk + 稍后一声高频「咔哒」 */
  private vending(voice: Voice, now: number, gain: number): void {
    voice.filter.type = 'lowpass';
    voice.filter.frequency.setValueAtTime(1200, now);
    voice.filter.Q.setValueAtTime(1.2, now);

    voice.body.type = 'square';
    voice.body.frequency.setValueAtTime(210, now);
    voice.body.frequency.linearRampToValueAtTime(70, now + 0.14);
    voice.bodyGain.gain.setValueAtTime(1, now);

    voice.sub.type = 'square';
    voice.sub.frequency.setValueAtTime(980, now);
    voice.subGain.gain.setValueAtTime(0, now);
    voice.subGain.gain.setValueAtTime(0, now + 0.19);
    voice.subGain.gain.linearRampToValueAtTime(0.5, now + 0.21);
    voice.subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    voice.lfo.type = 'sine';
    voice.lfo.frequency.setValueAtTime(3, now);
    voice.lfoDepth.gain.setValueAtTime(1.5, now);

    const amp = voice.amp.gain;
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.6 * gain), now + 0.02);
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.15 * gain), now + 0.18);
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.2 * gain), now + 0.21);
    amp.exponentialRampToValueAtTime(0.0001, now + 0.4);
    const end = now + 0.42;
    amp.linearRampToValueAtTime(0, end);
    voice.endAt = end;
  }

  /** 饮水机：三颗上升的气泡，带通滤出「咕嘟」的水声 */
  private cooler(voice: Voice, now: number, gain: number): void {
    voice.filter.type = 'bandpass';
    voice.filter.frequency.setValueAtTime(900, now);
    voice.filter.Q.setValueAtTime(2.5, now);

    voice.body.type = 'sine';
    voice.sub.type = 'sine';
    voice.sub.frequency.setValueAtTime(240, now);
    voice.bodyGain.gain.setValueAtTime(1, now);
    voice.subGain.gain.setValueAtTime(0.15, now);

    voice.lfo.type = 'sine';
    voice.lfo.frequency.setValueAtTime(11, now);
    voice.lfoDepth.gain.setValueAtTime(15, now);

    const amp = voice.amp.gain;
    for (let i = 0; i < 3; i += 1) {
      const at = now + i * 0.14;
      voice.body.frequency.setValueAtTime(480 + i * 160, at);
      voice.body.frequency.linearRampToValueAtTime(700 + i * 180, at + 0.1);
      amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * gain), at + 0.02);
      amp.exponentialRampToValueAtTime(0.0001, at + 0.11);
    }
    const end = now + 0.44;
    amp.linearRampToValueAtTime(0, end);
    voice.endAt = end;
  }

  /** 咖啡机：高通锯齿的「嘶——」加上压力下降，比真实蒸汽更省节点 */
  private coffee(voice: Voice, now: number, gain: number): void {
    voice.filter.type = 'highpass';
    voice.filter.frequency.setValueAtTime(1500, now);
    voice.filter.Q.setValueAtTime(0.8, now);

    voice.body.type = 'sawtooth';
    voice.body.frequency.setValueAtTime(2400, now);
    voice.body.frequency.linearRampToValueAtTime(1900, now + 0.7);
    voice.bodyGain.gain.setValueAtTime(1, now);

    // 低频泵被高通滤掉，直接关掉 sub，避免白占一个振荡器的混音
    voice.subGain.gain.setValueAtTime(0, now);

    voice.lfo.type = 'sine';
    voice.lfo.frequency.setValueAtTime(9.5, now);
    voice.lfoDepth.gain.setValueAtTime(260, now);

    const amp = voice.amp.gain;
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.32 * gain), now + 0.06);
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.3 * gain), now + 0.45);
    amp.exponentialRampToValueAtTime(0.0001, now + 0.8);
    const end = now + 0.82;
    amp.linearRampToValueAtTime(0, end);
    voice.endAt = end;
  }

  private warn(message: string, error?: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[sfx] ${message}`, error ?? '');
  }
}

export const sfx = new SfxPlayer();
