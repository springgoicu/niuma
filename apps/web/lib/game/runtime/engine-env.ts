import type { CareerSummary, CharacterAppearance, EconomyProfile } from '@niuma/shared-types';
import type { DanmakuPrefs } from '../danmaku-prefs';
import type { InteractiveKind } from '../interactions';
import type { ControlBlock, SnapshotPatch, ViewportInfo } from './control-channel';
import type { RenderMode } from './render-mode';

/** 入场身份：一次会话内不变，重连与换装广播都以它为准 */
export interface SessionProfile {
  name: string;
  appearance: CharacterAppearance;
  status?: string;
  /** 本人自报的考勤摘要：随 HELLO 上报，后续由 updateCareer 补报 */
  career?: CareerSummary;
  /** 本地资产摘要（ADR-0082）：只作为 HELLO 上报值，服务端会清洗并回权威快照 */
  economy?: EconomyProfile;
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
  /** 上香：寺庙磬音（ADR-0061） */
  | { kind: 'incense'; x: number; y: number }
  /** 续杯：喝茶的咕嘟声（ADR-0061） */
  | { kind: 'tea'; x: number; y: number }
  /** 整蛊：踩到香蕉皮的滑倒短音（ADR-0085） */
  | { kind: 'slip'; x: number; y: number };

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
   * `?gpu=webgpu` 这些灰度开关都从它解析——Worker 里没有 `window.location`。
   * 后端默认 WebGL2，WebGPU 只作为显式开关保留（ADR-0071）。
   */
  readonly search: string;
  /** 已经建好的渲染目标：主线程是 `<canvas>`，Worker 是移交进来的 `OffscreenCanvas` */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * 这份 env 建在哪个宿主里：`worker` 是渲染线程，`main` 是回退实现。
   *
   * 只用于上报（HUD 让玩家知道自己掉到了主线程），引擎内部不得据此分支——
   * 两条路径必须跑同一套逻辑，否则回退模式会变成一条没人日常走的腐烂分支。
   */
  readonly renderMode: RenderMode;
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
  /**
   * 当日「首次上香」的本地日期键（`YYYY-MM-DD`，空串表示从未上过）。
   *
   * 零服务端持久化下这是唯一能跨刷新记住的载体：localStorage 只能在主线程读，
   * Worker 侧由 init 消息带进来（与 `danmakuPrefs` 同一条通路）。
   */
  readonly incenseDay: string;
  /**
   * 匿名设备号（ADR-0081，16 位小写 hex，空串表示取不到存储）。
   *
   * 服务端只用它聚合同一台浏览器的点赞与擂台战绩，不做身份认证。
   * 与 `incenseDay` 同一条通路：localStorage 只能在主线程读，Worker 靠 init 带进来。
   */
  readonly deviceId: string;
  /**
   * 上香后写回主线程落盘。只记日期不记次数——「功德 +1」是当次提示，不做累计。
   */
  writeIncenseDay(day: string): void;
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
