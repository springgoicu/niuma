'use client';

import type { InteractiveKind } from './interactions';
import { attenuationFor, panFor } from './spatial-audio';

/**
 * 2D 空间音效：纯振荡器 + 白噪音合成，固定 Voice 池（ADR-0048）。
 *
 * 三条硬约束决定了这里的形状：
 * 1. 不引入任何音频资源，所有声音都由振荡器 / 环形缓冲噪音 + 滤波器实时合成；
 * 2. 播放路径严格零分配——节点、Gain、Panner 全部在首次手势时一次建好，
 *    振荡器只 `start()` 一次、之后靠包络门控，触发时只写 AudioParam 与标量字段；
 * 3. AudioContext 懒初始化：首次发声一定发生在按键 / 点击栈里，绕开自动播放限制。
 *
 * 代价是 6 路振荡器常驻（空闲时被包络压到 0）。用这点 CPU 换掉「每声一次
 * createOscillator + disconnect」的节点churn，是本模块的核心取舍。
 */

/** 主音量：只做一次性动作的点缀，压到不会盖过聊天与页面本身的音量 */
const MASTER_GAIN = 0.22;
/** 连点节流：发泄动画一个窗口 440ms，90ms 内的重复触发直接丢弃，避免叠音 */
const MIN_GAP_MS = 90;
/** 固定声道数：一次挥空 / 机器音最多三路振荡器，6 路足够覆盖附近的并发声源 */
const POOL_SIZE = 6;
/** 声像过渡：触发瞬间硬切会爆音，20ms 线性滑过去听不出来 */
const PAN_RAMP_S = 0.02;
/** 噪音源长度：1s 的白色噪声循环播放，够长到听不出周期，又只占 44kB */
const NOISE_SECONDS = 1;

const KIND = {
  vending: 0,
  cooler: 1,
  coffee: 2,
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

/**
 * 独立的白噪音链：破空与钝击的「沙」声全靠它。
 *
 * 为什么不塞进 Voice：Voice 的三路都是振荡器，而噪音需要 AudioBufferSource。
 * 单独一条常驻循环源 + 低通 / 带通 + 包络，比每次发声都新建一个 BufferSource 更省，
 * 也与「节点一次建好、之后只写 AudioParam」这条纪律一致。
 */
interface NoiseChain {
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  /** 这一声的结束时刻，用于避免连打时两段噪音叠在一起 */
  endAt: number;
}

class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 空数组表示还没有建池；建池只发生在首次手势 */
  private voices: Voice[] = [];
  private muted = false;
  private lastAt = 0;
  /** 破空与钝击各自计时：命中音不能被 90ms 的挥空窗口吞掉（同一次出招里只隔一个 RTT） */
  private lastWhiffAt = 0;
  private lastImpactAt = 0;
  /** 滑倒音自己的节流窗口：与挥空共用窗口会让人以为「踩了不响」 */
  private lastSlipAt = 0;
  private noise: NoiseChain | null = null;
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

  /** 设施互动（F）：售货机 / 饮水机 / 咖啡机各一套合成音色 */
  interact(kind: InteractiveKind, sourceX: number, sourceY: number): void {
    const sound = kind === 'vending' ? KIND.vending : kind === 'cooler' ? KIND.cooler : KIND.coffee;
    this.play(sound, sourceX, sourceY, true);
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

  /**
   * 发泄的打击音（ADR-0051）。
   *
   * 两种形态共用一条噪音链，靠滤波与包络区分：
   * - 空放：低通白噪从 1.6kHz 扫到 420Hz，短促的「呼哧」破空；
   * - 命中：带通噪音冲击（1000 → 300Hz）叠一路正弦下潜（190 → 52Hz）的钝器「砰」。
   *
   * `local` 的两次触发（按键时的挥空、服务端回执的命中）用各自的节流时间戳：
   * 命中的回执通常只比出招晚半个 RTT，共用一个窗口会被吞掉。
   */
  playVentImpactSound(sourceX: number, sourceY: number, hit: boolean, local = false): void {
    if (this.muted || typeof window === 'undefined') return;
    const dx = sourceX - this.listenerX;
    const dy = sourceY - this.listenerY;
    const distanceGain = attenuationFor(dx, dy);
    if (distanceGain <= 0) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    if (local) {
      const wall = performance.now();
      if (hit) {
        if (wall - this.lastImpactAt < MIN_GAP_MS) return;
        this.lastImpactAt = wall;
      } else {
        if (wall - this.lastWhiffAt < MIN_GAP_MS) return;
        this.lastWhiffAt = wall;
      }
    }

    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const now = ctx.currentTime;
    const pan = panFor(dx);
    // 命中 = 噪音冲击 + 低频下潜；空放只有噪音，所以不占振荡器声道
    if (hit) {
      const voice = this.acquire(now);
      if (voice) {
        this.prepare(voice, now, pan);
        this.thump(voice, now, distanceGain);
      }
    }
    this.noiseBurst(now, distanceGain, pan, hit);
  }

  /**
   * 香蕉皮滑倒（ADR-0085）：一声下滑的短哨音 + 一半音量的沙沙。
   *
   * 只用一个 Voice：滑倒是一瞬间的事，给它垫低频「砰」反而像被打了。
   */
  playSlipSound(sourceX: number, sourceY: number): void {
    if (this.muted || typeof window === 'undefined') return;
    const dx = sourceX - this.listenerX;
    const dy = sourceY - this.listenerY;
    const distanceGain = attenuationFor(dx, dy);
    if (distanceGain <= 0) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const wall = performance.now();
    if (wall - this.lastSlipAt < MIN_GAP_MS) return;
    this.lastSlipAt = wall;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const now = ctx.currentTime;
    const pan = panFor(dx);
    const voice = this.acquire(now);
    if (voice) {
      this.prepare(voice, now, pan);
      voice.filter.type = 'lowpass';
      voice.filter.frequency.setValueAtTime(2400, now);
      voice.filter.frequency.exponentialRampToValueAtTime(700, now + 0.28);
      voice.filter.Q.setValueAtTime(3.5, now);
      voice.body.type = 'sawtooth';
      voice.body.frequency.setValueAtTime(880, now);
      voice.body.frequency.exponentialRampToValueAtTime(220, now + 0.3);
      voice.bodyGain.gain.setValueAtTime(0.8, now);
      voice.sub.type = 'sine';
      voice.sub.frequency.setValueAtTime(160, now);
      voice.sub.frequency.exponentialRampToValueAtTime(60, now + 0.25);
      voice.subGain.gain.setValueAtTime(0.3, now);
      voice.lfo.type = 'sine';
      voice.lfo.frequency.setValueAtTime(18, now);
      voice.lfoDepth.gain.setValueAtTime(40, now);
      const amp = voice.amp.gain;
      amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * distanceGain), now + 0.02);
      amp.exponentialRampToValueAtTime(0.0001, now + 0.32);
      const end = now + 0.34;
      amp.linearRampToValueAtTime(0, end);
      voice.endAt = end;
    }
    this.noiseBurst(now, distanceGain * 0.5, pan, false);
  }

  /** 噪音链：一次建好常驻，之后每次只重排滤波与包络 */
  private noiseBurst(now: number, gain: number, pan: number, hit: boolean): void {
    const chain = this.noise;
    if (!chain) return;
    const { filter, panner } = chain;
    const amp = chain.gain.gain;

    amp.cancelScheduledValues(now);
    filter.frequency.cancelScheduledValues(now);
    filter.Q.cancelScheduledValues(now);

    if (hit) {
      // 钝器：带通收窄，才有「打在肉上」的闷响而不是一片沙沙
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1000, now);
      filter.frequency.exponentialRampToValueAtTime(300, now + 0.12);
      filter.Q.setValueAtTime(1.2, now);
      amp.setValueAtTime(0.0001, now);
      amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.85 * gain), now + 0.012);
      amp.exponentialRampToValueAtTime(0.0001, now + 0.15);
      chain.endAt = now + 0.16;
    } else {
      // 破空：低通从亮扫到闷，0.18s 收干净，不拖尾
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1600, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.16);
      filter.Q.setValueAtTime(0.9, now);
      amp.setValueAtTime(0.0001, now);
      amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * gain), now + 0.02);
      amp.exponentialRampToValueAtTime(0.0001, now + 0.18);
      chain.endAt = now + 0.19;
    }
    amp.linearRampToValueAtTime(0, chain.endAt);

    if (panner) {
      const from = panner.pan.value;
      panner.pan.cancelScheduledValues(now);
      panner.pan.setValueAtTime(from, now);
      panner.pan.linearRampToValueAtTime(pan, now + PAN_RAMP_S);
    }
  }

  /** 命中那一声的低频：正弦快速下潜 + 一点三角波垫底，做出「重量」 */
  private thump(voice: Voice, now: number, gain: number): void {
    voice.filter.type = 'lowpass';
    voice.filter.frequency.setValueAtTime(900, now);
    voice.filter.Q.setValueAtTime(1.6, now);

    voice.body.type = 'sine';
    voice.body.frequency.setValueAtTime(190, now);
    voice.body.frequency.exponentialRampToValueAtTime(52, now + 0.16);
    voice.bodyGain.gain.setValueAtTime(1, now);

    voice.sub.type = 'triangle';
    voice.sub.frequency.setValueAtTime(96, now);
    voice.sub.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    voice.subGain.gain.setValueAtTime(0.35, now);

    // 颤音关掉：钝击要的是直上直下的瞬态，加颤音听起来像打嗝
    voice.lfoDepth.gain.setValueAtTime(0, now);

    const amp = voice.amp.gain;
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.9 * gain), now + 0.01);
    amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.28 * gain), now + 0.1);
    amp.exponentialRampToValueAtTime(0.0001, now + 0.2);
    const end = now + 0.21;
    amp.linearRampToValueAtTime(0, end);
    voice.endAt = end;
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
      this.noise = this.buildNoise(ctx, master);
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

  /**
   * 白噪音源：一段 1s 的环形缓冲，常驻循环。
   *
   * `AudioBufferSourceNode` 是一次性节点，但它可以 `loop = true` 一直跑，
   * 于是「破空」与「钝击」都可以用同一条源，只换滤波器与包络——与振荡器池同一个思路。
   */
  private buildNoise(ctx: AudioContext, master: GainNode): NoiseChain {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

    src.connect(filter);
    filter.connect(gain);
    if (panner) {
      panner.pan.value = 0;
      gain.connect(panner);
      panner.connect(master);
    } else {
      gain.connect(master);
    }
    src.start();

    return { filter, gain, panner, endAt: 0 };
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

  /** GTA 8-bit 合成音效（载具 / 警笛 / 钓鱼 / 涂鸦 / CPR / 通缉 / 咖啡），严格复用 Voice 池 */
  playGtaTone(
    kind: 'vehicle' | 'horn' | 'siren' | 'fish_cast' | 'fish_bite' | 'spray' | 'cpr' | 'wanted' | 'coffee',
    sourceX: number,
    sourceY: number,
  ): void {
    if (this.muted || typeof window === 'undefined') return;
    const dx = sourceX - this.listenerX;
    const dy = sourceY - this.listenerY;
    const distanceGain = attenuationFor(dx, dy);
    if (distanceGain <= 0) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const now = ctx.currentTime;
    const voice = this.acquire(now);
    if (!voice) return;

    this.prepare(voice, now, panFor(dx));
    voice.filter.type = 'lowpass';
    voice.filter.frequency.setValueAtTime(1800, now);
    voice.filter.Q.setValueAtTime(1, now);
    voice.lfoDepth.gain.setValueAtTime(0, now);
    const amp = voice.amp.gain;

    switch (kind) {
      case 'vehicle':
        voice.body.type = 'sawtooth';
        voice.body.frequency.setValueAtTime(110, now);
        voice.body.frequency.linearRampToValueAtTime(185, now + 0.18);
        voice.bodyGain.gain.setValueAtTime(0.8, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.45 * distanceGain), now + 0.03);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.24);
        voice.endAt = now + 0.26;
        break;
      case 'horn':
        voice.body.type = 'square';
        voice.sub.type = 'square';
        voice.body.frequency.setValueAtTime(440, now);
        voice.sub.frequency.setValueAtTime(554, now);
        voice.bodyGain.gain.setValueAtTime(0.65, now);
        voice.subGain.gain.setValueAtTime(0.5, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.48 * distanceGain), now + 0.02);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.18);
        voice.endAt = now + 0.2;
        break;
      case 'siren':
        voice.body.type = 'square';
        voice.body.frequency.setValueAtTime(620, now);
        voice.body.frequency.linearRampToValueAtTime(880, now + 0.14);
        voice.body.frequency.linearRampToValueAtTime(620, now + 0.28);
        voice.bodyGain.gain.setValueAtTime(0.7, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.42 * distanceGain), now + 0.03);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.3);
        voice.endAt = now + 0.32;
        break;
      case 'fish_cast':
        voice.body.type = 'sine';
        voice.body.frequency.setValueAtTime(520, now);
        voice.body.frequency.linearRampToValueAtTime(240, now + 0.16);
        voice.bodyGain.gain.setValueAtTime(0.7, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.4 * distanceGain), now + 0.02);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.2);
        voice.endAt = now + 0.22;
        break;
      case 'fish_bite':
        voice.body.type = 'triangle';
        voice.body.frequency.setValueAtTime(780, now);
        voice.body.frequency.setValueAtTime(1040, now + 0.08);
        voice.bodyGain.gain.setValueAtTime(0.85, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.55 * distanceGain), now + 0.015);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.22);
        voice.endAt = now + 0.24;
        break;
      case 'spray':
        voice.filter.type = 'highpass';
        voice.filter.frequency.setValueAtTime(1700, now);
        voice.body.type = 'sawtooth';
        voice.body.frequency.setValueAtTime(2200, now);
        voice.bodyGain.gain.setValueAtTime(0.55, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * distanceGain), now + 0.02);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.28);
        voice.endAt = now + 0.3;
        break;
      case 'cpr':
        voice.body.type = 'sine';
        voice.body.frequency.setValueAtTime(880, now);
        voice.body.frequency.exponentialRampToValueAtTime(340, now + 0.16);
        voice.bodyGain.gain.setValueAtTime(0.8, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * distanceGain), now + 0.02);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.19);
        voice.endAt = now + 0.21;
        break;
      case 'wanted':
        voice.body.type = 'square';
        voice.body.frequency.setValueAtTime(480, now);
        voice.body.frequency.setValueAtTime(720, now + 0.09);
        voice.bodyGain.gain.setValueAtTime(0.7, now);
        voice.subGain.gain.setValueAtTime(0, now);
        amp.exponentialRampToValueAtTime(Math.max(0.0002, 0.46 * distanceGain), now + 0.02);
        amp.exponentialRampToValueAtTime(0.0001, now + 0.24);
        voice.endAt = now + 0.26;
        break;
      case 'coffee':
        this.cooler(voice, now, distanceGain);
        return;
    }
    amp.linearRampToValueAtTime(0, voice.endAt);
  }
}

export const sfx = new SfxPlayer();
