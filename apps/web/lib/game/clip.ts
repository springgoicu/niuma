'use client';

import { POSE, type Pose } from '@niuma/shared-types';
import { SPRITE_LAYOUT, type GeneratedClip } from './sprite-layout.generated';

/**
 * 动画求值：把 manifest 里的「帧序列 + 逐帧时长」预编译成累计时间轴，
 * 之后每帧只做一次顺序查表，不查 manifest、不建对象。
 */
export interface ClipTrack {
  /** 图集列索引，与 ends 等长 */
  columns: readonly number[];
  /** 每帧的结束时间（累计毫秒） */
  ends: readonly number[];
  loop: boolean;
  loopFrom: number;
  durationMs: number;
  /** 循环体的起点时间与长度，进循环后只在这段里取模 */
  loopStartMs: number;
  loopDurationMs: number;
}

export type ClipTracks = Readonly<Record<string, ClipTrack>>;

function compileClip(clip: GeneratedClip): ClipTrack {
  const ends: number[] = [];
  let total = 0;
  for (const ms of clip.frameMs) {
    total += Math.max(1, ms);
    ends.push(total);
  }
  const loopFrom = Math.min(Math.max(0, clip.loopFrom), ends.length - 1);
  const loopStartMs = loopFrom > 0 ? ends[loopFrom - 1]! : 0;
  return {
    columns: clip.frames,
    ends,
    loop: clip.loop,
    loopFrom,
    durationMs: total,
    loopStartMs,
    loopDurationMs: Math.max(1, total - loopStartMs),
  };
}

/** 眨眼列：由生成物给出，客户端不再手写「第 2 列」这种魔法数 */
export const BLINK_COLUMN = SPRITE_LAYOUT.blinkColumn;

/**
 * 待机：把眨眼列从循环里剔除。
 *
 * 生成器仍然按列号画闭眼帧、`CLIPS.idle` 也仍然拥有这一列
 * （layout.test 要求每列恰好属于一个动作），但播放层不再每 1.9s 眨一次——
 * 那个频率看起来像在抽搐。眨眼改由 `ponyMotion` 每 35s 注入一帧。
 */
function compileIdle(clip: GeneratedClip, blinkColumn: number): ClipTrack {
  const frames: number[] = [];
  const frameMs: number[] = [];
  clip.frames.forEach((frame, index) => {
    if (frame === blinkColumn) return;
    frames.push(frame);
    frameMs.push(clip.frameMs[index] ?? 200);
  });
  return compileClip({ ...clip, frames, frameMs, loopFrom: 0 });
}

export function buildClipTracks(
  clips: Record<string, GeneratedClip> = SPRITE_LAYOUT.clips,
  blinkColumn: number = BLINK_COLUMN,
): ClipTracks {
  const tracks: Record<string, ClipTrack> = {};
  for (const [name, clip] of Object.entries(clips)) {
    tracks[name] = name === 'idle' ? compileIdle(clip, blinkColumn) : compileClip(clip);
  }
  return tracks;
}

/** 一次性动作（叫唤 / 跳 / 打招呼）播完要停下的时长，调用方用它决定何时回落到原姿态 */
export function clipDuration(track: ClipTrack | undefined): number {
  return track ? track.durationMs : 0;
}

/** 叠加动作的播放窗口：与图集里一次性动作的逐帧时长合计对齐（440ms） */
export const OVERLAY_MS = 440;

export interface OverlayTracks {
  /** 按 wire 姿态索引（Idle/Walk/Sit/Lie）：行走没有叫唤帧，恒为 null */
  readonly emoteByPose: ReadonlyArray<ClipTrack | null>;
  /** 打招呼同样按姿态分三条；行走没有挥手帧，Idle 位之外的 Walk 恒为 null */
  readonly waveByPose: ReadonlyArray<ClipTrack | null>;
  readonly jump: ClipTrack | null;
  /** 播放窗口：取窗口常量与图集实际长度的较大值，避免末帧停顿或硬切 */
  readonly emoteMs: number;
  readonly waveMs: number;
  readonly jumpMs: number;
}

/**
 * 叠加动作的轨表：一次编译、帧循环里只做数组下标。
 * 叫唤与打招呼各按姿态分三条（站/坐/躺），跳只有一条（坐/躺时客户端先起身）。
 */
export function buildOverlayTracks(tracks: ClipTracks): OverlayTracks {
  const emoteByPose: Array<ClipTrack | null> = [
    tracks.emote ?? null,
    null,
    tracks.sitEmote ?? null,
    tracks.lieEmote ?? null,
  ];
  const waveByPose: Array<ClipTrack | null> = [
    tracks.wave ?? null,
    null,
    tracks.sitWave ?? null,
    tracks.lieWave ?? null,
  ];
  const jump = tracks.jump ?? null;
  return {
    emoteByPose,
    waveByPose,
    jump,
    emoteMs: Math.max(OVERLAY_MS, ...emoteByPose.map((track) => clipDuration(track ?? undefined))),
    // 挥手是三拍 660ms：窗口必须跟着图集走，否则末拍「收回」会被硬切
    waveMs: Math.max(OVERLAY_MS, ...waveByPose.map((track) => clipDuration(track ?? undefined))),
    jumpMs: Math.max(OVERLAY_MS, clipDuration(jump ?? undefined)),
  };
}

/**
 * 当前该用哪条叠加轨：跳 > 打招呼 > 叫唤。
 *
 * 跳是位移动作，行走中也播（位移不中断）；打招呼与叫唤在行走中仍回落基础轨——
 * 图集没有行走挥手 / 张嘴帧，套上去就是滑步。
 * 三者互斥由客户端置位时保证，这里只按优先级兜底。
 * 返回 null 表示「不覆盖姿态」，调用方回落到基础姿态轨。
 */
export function overlayTrackFor(
  overlays: OverlayTracks,
  pose: Pose,
  emoting: boolean,
  jumping: boolean,
  waving: boolean,
): ClipTrack | null {
  if (jumping) return overlays.jump;
  if (pose === POSE.Walk) return null;
  if (waving) return overlays.waveByPose[pose] ?? null;
  if (!emoting) return null;
  return overlays.emoteByPose[pose] ?? null;
}

/**
 * 取某一时刻的列号。
 * 循环动画取模；一次性动画播完钳在最后一帧，不会跳回第一帧。
 */
export function frameAt(track: ClipTrack, elapsedMs: number): number {
  let t = elapsedMs > 0 ? elapsedMs : 0;
  if (track.loop && t >= track.durationMs) {
    t = track.loopStartMs + ((t - track.loopStartMs) % track.loopDurationMs);
  }
  if (t >= track.durationMs) return track.columns[track.columns.length - 1]!;
  for (let i = 0; i < track.ends.length; i += 1) {
    if (t < track.ends[i]!) return track.columns[i]!;
  }
  return track.columns[track.columns.length - 1]!;
}

/**
 * 相位错开：同一个动作，不同实体从不同的时间点开始播。
 * 不做这一步，视野里所有人会像广播体操一样同时抬腿。
 * 用定值乘 hash 而不是 Math.random，保证同一实体每次进视野的相位一致。
 */
export function phaseOffset(netId: number, track: ClipTrack): number {
  if (!track.loop || track.loopDurationMs <= 0) return 0;
  const hashed = Math.imul(netId + 1, 2654435761) >>> 0;
  return hashed % track.loopDurationMs;
}
