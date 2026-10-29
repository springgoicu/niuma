'use client';

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

export function buildClipTracks(clips: Record<string, GeneratedClip> = SPRITE_LAYOUT.clips): ClipTracks {
  const tracks: Record<string, ClipTrack> = {};
  for (const [name, clip] of Object.entries(clips)) tracks[name] = compileClip(clip);
  return tracks;
}

/** 一次性动作（叫唤）播完要停下的时长，调用方用它决定何时回落到待机 */
export function clipDuration(track: ClipTrack | undefined): number {
  return track ? track.durationMs : 0;
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
