'use client';

import type { Species } from '@niuma/shared-types';

/** 主音量：只做一次性动作的点缀，压到不会盖过聊天与页面本身的音量 */
const MASTER_GAIN = 0.22;
/** 连点节流：叫唤动画一个窗口 440ms，90ms 内的重复触发直接丢弃，避免叠音 */
const MIN_GAP_MS = 90;

/**
 * 叫唤音效：Web Audio 实时合成，不引入任何音频资源。
 *
 * - 模块顶层不碰 window / AudioContext，SSR 与水合安全；
 * - 首次 emit 时创建上下文（一定发生在点击 / 按键手势里，绕开自动播放限制）；
 * - 每次发声按物种合成约 0.46s 的短音，播完主动断开所有节点，不留在帧循环里。
 */
class SfxPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private lastAt = 0;
  private warned = false;

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

  /** 叫唤：牛是低频「哞」，马是带颤音的下滑「嘶鸣」 */
  emit(species: Species): void {
    if (this.muted || typeof window === 'undefined') return;
    const now = performance.now();
    if (now - this.lastAt < MIN_GAP_MS) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.lastAt = now;
    // 标签页被挂起后恢复：resume 必须在手势里发起，这里正好是按键 / 点击栈
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    if (species === 'horse') this.playNeigh(ctx);
    else this.playMoo(ctx);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.warn('Web Audio 不可用，叫唤将静音');
      return null;
    }
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch (error) {
      this.warn('音频上下文创建失败，叫唤将静音', error);
      return null;
    }
  }

  private warn(message: string, error?: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[sfx] ${message}`, error ?? '');
  }

  /** 牛：两个低频振荡器过低通，慢速 vibrato 做出「哞——」的尾音 */
  private playMoo(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const out = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 760;
    filter.Q.value = 5;

    const body = ctx.createOscillator();
    body.type = 'sawtooth';
    body.frequency.setValueAtTime(128, t);
    body.frequency.linearRampToValueAtTime(104, t + 0.18);
    body.frequency.linearRampToValueAtTime(118, t + 0.34);

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(64, t);

    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 5.2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 3.4;

    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.9, t + 0.05);
    out.gain.exponentialRampToValueAtTime(0.35, t + 0.2);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);

    body.connect(filter);
    sub.connect(filter);
    filter.connect(out);
    out.connect(this.master!);
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(body.frequency);

    this.run(ctx, t + 0.48, [body, sub, vibrato], [body, sub, vibrato, vibratoDepth, filter, out]);
  }

  /** 马：锯齿波下滑 + 13Hz 颤音，带通滤出「嘶」的鼻音 */
  private playNeigh(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const out = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1050;
    filter.Q.value = 1.4;

    const body = ctx.createOscillator();
    body.type = 'sawtooth';
    body.frequency.setValueAtTime(540, t);
    body.frequency.linearRampToValueAtTime(300, t + 0.12);
    body.frequency.linearRampToValueAtTime(240, t + 0.42);

    const grit = ctx.createOscillator();
    grit.type = 'sawtooth';
    grit.frequency.setValueAtTime(760, t);
    grit.frequency.linearRampToValueAtTime(430, t + 0.42);
    const gritGain = ctx.createGain();
    gritGain.gain.value = 0.22;

    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 13.5;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 55;

    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    out.gain.exponentialRampToValueAtTime(0.4, t + 0.16);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);

    body.connect(filter);
    grit.connect(gritGain);
    gritGain.connect(filter);
    filter.connect(out);
    out.connect(this.master!);
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(body.frequency);
    vibratoDepth.connect(grit.frequency);

    this.run(ctx, t + 0.48, [body, grit, vibrato], [body, grit, vibrato, gritGain, vibratoDepth, filter, out]);
  }

  /** 统一起停：播完断开全部节点，避免残留连接把上下文撑大 */
  private run(ctx: AudioContext, endAt: number, sources: OscillatorNode[], nodes: AudioNode[]): void {
    const release = () => {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // 已经断开的节点再断一次会抛，忽略即可
        }
      }
    };
    for (const source of sources) {
      source.start(ctx.currentTime);
      source.stop(endAt);
    }
    sources[0]!.onended = release;
  }
}

export const sfx = new SfxPlayer();
