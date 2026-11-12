import type { CareerSummary, CharacterAppearance } from '@niuma/shared-types';
import type { DanmakuPrefs } from '../danmaku-prefs';
import type { InteractiveKind } from '../interactions';
import type { ControlBlock, SnapshotPatch, ViewportInfo } from './control-channel';

/** 入场身份：一次会话内不变，重连与换装广播都以它为准 */
export interface SessionProfile {
  name: string;
  appearance: CharacterAppearance;
  status?: string;
  /** 本人自报的考勤摘要：随 HELLO 上报，后续由 updateCareer 补报 */
  career?: CareerSummary;
}

/**
 * 引擎侧的发声请求。
 *
 * `AudioContext` 只能在主线程创建，所以引擎不再直接调用 `sfx`，而是把
 * 「谁在什么位置发出了什么声音」描述出来；主线程拿到事件时连同当时的
 * 听者坐标一起交给 `applyAudioEvent()`，声像与衰减仍由 `spatial-audio.ts` 算。
 */
export type AudioEvent =
  /**
   * 发泄：`hit = false` 是空放的破空音，`true` 是命中后的钝击音。
   * 出招者一按就播一次空放，服务端结算回来再补一声命中——两段合起来才是「挥空 + 砰」。
   */
  | { kind: 'vent'; x: number; y: number; hit: boolean; local: boolean }
  | { kind: 'interact'; target: InteractiveKind; x: number; y: number }
  | { kind: 'chew'; x: number; y: number; local: boolean };

/**
 * 引擎对"平台"的全部依赖，注入而不是直接摸全局。
 *
 * 这是把帧循环搬进 Worker 的唯一必要改造：`GameSession`、`GameRenderer`、
 * `Ecs`、`NetClient` 里剩下的所有代码都保持原样，只是不再自己去找
 * window / document / localStorage / AudioContext。
 */
export interface EngineEnv {
  /**
   * 页面查询串。`?zoom` / `?flat` / `?light` / `?bands` / `?season` / `?snow` /
   * `?gpu` 这些灰度开关都从它解析——Worker 里没有 `window.location`。
   */
  readonly search: string;
  /** 已经建好的渲染目标：主线程是 `<canvas>`，Worker 是移交进来的 `OffscreenCanvas` */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** 输入控制块：按键掩码、摇杆、动作环。两侧是同一块内存或同一条降级通路 */
  readonly control: ControlBlock;
  /** 每帧调用；尺寸或 DPR 真的变了才返回 true，渲染层据此重算倍率与文字位图 */
  readViewport(out: ViewportInfo): boolean;
  /** 字体就绪：主线程等 `document.fonts.ready`，Worker 等自己注册的 FontFace */
  fontsReady(): Promise<void>;
  /**
   * 弹幕偏好初值。localStorage 只能在主线程读：Worker 侧由 init 消息带进来，
   * 主线程回退实现直接读同一份存储。
   */
  readonly danmakuPrefs: DanmakuPrefs;
  /** 落点快照：主线程直接写 localStorage，Worker 写进控制块由主线程落盘 */
  writeSnapshot(patch: SnapshotPatch): void;
  /** 发声请求：主线程直接合成，Worker 转成一条消息 */
  emitAudio(event: AudioEvent, listenerX: number, listenerY: number): void;
  /**
   * 请求一次构建版本检查（断线重连时用）。
   *
   * 版本比对要读 URL、写 localStorage、必要时 reload，全是主线程才能做的事；
   * Worker 侧只发一条消息让宿主派发，绝不能在渲染线程里摸 window。
   */
  requestBuildCheck(): void;
}
