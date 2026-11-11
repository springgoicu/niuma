'use client';

import { DIRECTION, POSE, type Direction, type Pose } from '@niuma/shared-types';
import { browserStorage, readJson, readRawObject, removeKey, writeJson, type StorageLike } from '../storage';

export const SNAPSHOT_KEY = 'niuma:session:v1';
export const SNAPSHOT_VERSION = 1;

/**
 * 上一次会话的落点。
 *
 * 服务端仍以内存里的 `World` 为唯一真相；这份快照只是「入场时的偏好」，
 * 由客户端上报、服务端重新校验后才生效。新增字段直接往里加：
 * `saveSnapshot` 是 merge 写入，旧快照缺字段时按默认值回落。
 */
export interface SessionSnapshot {
  v: number;
  savedAt: number;
  /** 世界像素坐标 */
  x: number;
  y: number;
  direction: Direction;
  pose: Pose;
  /** 上次所坐的座位 id；0 表示没坐 */
  seatId: number;
  /** 允许后续模块直接扩展，不需要再动存储层 */
  [key: string]: unknown;
}

export const DEFAULT_SNAPSHOT = {
  v: SNAPSHOT_VERSION,
  savedAt: 0,
  x: 0,
  y: 0,
  direction: DIRECTION.Down,
  pose: POSE.Idle,
  seatId: 0,
} as const;

/** 落盘前归一化：行走是瞬态，不能跨会话；Emote 只存在于客户端表现层 */
export function persistablePose(pose: Pose): Pose {
  return pose === POSE.Sit || pose === POSE.Lie ? pose : POSE.Idle;
}

/** 把帧循环里的本地状态收成一份落盘 patch，session 只负责调用时机 */
export function toSnapshotPatch(state: {
  x: number;
  y: number;
  direction: Direction;
  pose: Pose;
  seatId: number;
}): Pick<SessionSnapshot, 'x' | 'y' | 'direction' | 'pose' | 'seatId'> {
  return {
    x: state.x,
    y: state.y,
    direction: state.direction,
    pose: persistablePose(state.pose),
    seatId: state.seatId,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeDirection(raw: unknown): Direction {
  return raw === DIRECTION.Left || raw === DIRECTION.Right || raw === DIRECTION.Up
    ? raw
    : DIRECTION.Down;
}

function sanitizePose(raw: unknown): Pose {
  return raw === POSE.Sit || raw === POSE.Lie ? raw : POSE.Idle;
}

export function loadSnapshot(
  storage: StorageLike | null = browserStorage('local'),
): SessionSnapshot | null {
  return readJson(storage, SNAPSHOT_KEY, (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const draft = raw as Record<string, unknown>;
    if (draft.v !== SNAPSHOT_VERSION) return null;
    // 坐标缺失或非有限值时不恢复：宁可回随机出生点，也不要让角色落到世界外
    if (!isFiniteNumber(draft.x) || !isFiniteNumber(draft.y)) return null;
    if (draft.x < 0 || draft.y < 0) return null;
    const seatId =
      isFiniteNumber(draft.seatId) && Number.isInteger(draft.seatId) && draft.seatId > 0
        ? draft.seatId
        : 0;
    return {
      // 保留未知字段，后续模块新增的状态不会在读回来时被吞掉
      ...draft,
      v: SNAPSHOT_VERSION,
      savedAt: isFiniteNumber(draft.savedAt) ? draft.savedAt : 0,
      x: draft.x,
      y: draft.y,
      direction: sanitizeDirection(draft.direction),
      pose: sanitizePose(draft.pose),
      seatId,
    } satisfies SessionSnapshot;
  });
}

/**
 * 合并写入：只覆盖 patch 里出现的字段。
 *
 * 这样以后新增「聊天草稿」「小地图缩放」之类的东西，各管各的字段，
 * 不会因为某个模块只知道自己那一段就把别人的状态抹掉。
 */
export function saveSnapshot(
  patch: Partial<Pick<SessionSnapshot, 'x' | 'y' | 'direction' | 'pose' | 'seatId'>> &
    Record<string, unknown>,
  storage: StorageLike | null = browserStorage('local'),
): void {
  if (!storage) return;
  const previous = readRawObject(storage, SNAPSHOT_KEY);
  const base = previous && previous.v === SNAPSHOT_VERSION ? previous : {};
  writeJson(storage, SNAPSHOT_KEY, {
    ...base,
    ...patch,
    v: SNAPSHOT_VERSION,
    savedAt: Date.now(),
  });
}

export function clearSnapshot(storage: StorageLike | null = browserStorage('local')): void {
  removeKey(storage, SNAPSHOT_KEY);
}
