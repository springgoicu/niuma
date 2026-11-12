'use client';

import {
  DEFAULT_APPEARANCE,
  FALLBACK_NICKNAME,
  MAX_NAME_DISPLAY_UNITS,
  displayWidth,
  inspectText,
  isAdLikeNickname,
  sanitizeAppearance,
  truncateName,
  truncateStatus,
  type CharacterAppearance,
  type ModerationResult,
  type Species,
} from '@niuma/shared-types';
import { browserStorage, readJson, removeKey, writeJson, type StorageLike } from './storage';

/** 当前草稿：localStorage，关标签页 / 关浏览器后仍可恢复 */
export const PROFILE_KEY = 'niuma:profile:v2';
/** 旧版按标签页存的草稿：首次读取时提升到 localStorage 并删除 */
export const LEGACY_PROFILE_KEY = 'niuma:profile:v1';
/**
 * 上次在捏人页显式选过的物种。
 *
 * 只记物种，不替用户自动保存整份草稿（「草稿未保存 / 已同步到本地」的语义不变），
 * 但没存档的人再次进入时不该被无条件重置成牛。
 */
export const CREATOR_SPECIES_KEY = 'niuma:creator-species:v1';

export interface Profile {
  name: string;
  appearance: CharacterAppearance;
  /** 常驻状态：空串表示没设置。旧存档没有这个字段时按空串恢复，不清空其它资料 */
  status: string;
}

/**
 * 工牌名的唯一入口：协议钳制 → 内容审核。
 *
 * 政治类命中回退默认名；脏话保留打码结果。表单层会先拦一道，
 * 这里负责的是 sessionStorage 恢复与深链这类「用户没经过表单」的路径。
 */
export function resolveProfileName(raw: string): string {
  const verdict = inspectText(truncateName(raw));
  return verdict.verdict === 'reject' ? FALLBACK_NICKNAME : verdict.text;
}

/**
 * 表单预检：与协议同一把尺子，先钳制再判。
 * 直接对原始输入判会漏掉「第 17 个字之后才出现敏感词」这种边界。
 */
export function checkProfileName(raw: string): ModerationResult {
  const text = truncateName(raw);
  // 域名/邮箱/社交号形态没有任何正当昵称用途，直接拒绝。
  // 这条必须跑在原文上：normalize 会剔掉 `.` `@`，`.com` 会变成 `com`，
  // 塞进词表就会把 `welcome` 一起打码。
  if (isAdLikeNickname(text)) {
    return { verdict: 'reject', category: null, text, hits: 1 };
  }
  return inspectText(text);
}

/** 工牌名在界面上的完整呈现状态 */
export interface NameStatus {
  /** 去掉首尾空白后的文本：输入框里用户看到什么，这里就是什么（不做协议钳制） */
  trimmed: string;
  empty: boolean;
  blocked: boolean;
  masked: boolean;
  displayUnits: number;
  tooWide: boolean;
}

/**
 * 顶部工牌条与底部回显共用这一份判定，两条路径不会给出不同的结论。
 *
 * 空名必须在这里短路：`truncateName('')` 会换成兜底工牌名并判成干净文本，
 * 若交给审核就会永远判「可上岗」，空名引导也就永远不会触发。
 */
export function describeProfileName(raw: string): NameStatus {
  const trimmed = raw.trim();
  const displayUnits = displayWidth(trimmed);
  const verdict = trimmed.length > 0 ? checkProfileName(trimmed) : null;
  return {
    trimmed,
    empty: trimmed.length === 0,
    blocked: verdict?.verdict === 'reject',
    masked: verdict?.verdict === 'mask',
    displayUnits,
    tooWide: displayUnits > MAX_NAME_DISPLAY_UNITS,
  };
}

/**
 * 状态的唯一入口：协议钳制 → 内容审核。
 * 政治类命中直接清空（与昵称回退默认名同一策略），脏话保留打码结果。
 */
export function resolveProfileStatus(raw: string | undefined): string {
  const text = truncateStatus(raw);
  if (text.length === 0) return '';
  const verdict = inspectText(text);
  return verdict.verdict === 'reject' ? '' : verdict.text;
}

/** 表单预检：与协议同一把尺子，先钳制再判，避免「超出长度的敏感词」漏判 */
export function checkProfileStatus(raw: string): ModerationResult {
  return inspectText(truncateStatus(raw));
}

/** 恢复草稿时的唯一入口：名字、状态过审核，外观过共享钳制，坏数据一律当没有 */
function sanitizeProfile(raw: unknown): Profile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const parsed = raw as Partial<Profile>;
  return {
    name:
      typeof parsed.name === 'string' && parsed.name.length > 0
        ? resolveProfileName(parsed.name)
        : FALLBACK_NICKNAME,
    appearance: sanitizeAppearance(parsed.appearance),
    status: typeof parsed.status === 'string' ? resolveProfileStatus(parsed.status) : '',
  };
}

/**
 * 写 localStorage：服务端仍不落任何数据，但同一个浏览器关掉再开会回到自己的工牌。
 */
export function saveProfile(
  profile: Profile,
  storage: StorageLike | null = browserStorage('local'),
): void {
  const payload: Profile = {
    // 与协议同一把尺子：16 字符 / 48 字节，别再写死 slice(0, 16)
    name: resolveProfileName(profile.name),
    appearance: sanitizeAppearance(profile.appearance),
    status: resolveProfileStatus(profile.status),
  };
  writeJson(storage, PROFILE_KEY, payload);
}

export function loadProfile(
  storage: StorageLike | null = browserStorage('local'),
  legacy: StorageLike | null = browserStorage('session'),
): Profile | null {
  const stored = readJson(storage, PROFILE_KEY, sanitizeProfile);
  if (stored) return stored;
  // 旧版草稿只活到标签页关闭：读到就提升到 localStorage 并删掉，避免下次又回落
  const old = readJson(legacy, LEGACY_PROFILE_KEY, sanitizeProfile);
  if (!old) return null;
  writeJson(storage, PROFILE_KEY, old);
  removeKey(legacy, LEGACY_PROFILE_KEY);
  return old;
}

export function clearProfile(): void {
  removeKey(browserStorage('local'), PROFILE_KEY);
  removeKey(browserStorage('session'), LEGACY_PROFILE_KEY);
}

/** 记忆键的唯一一把尺子：只认 cow / horse，其它值当没有 */
const parseSpecies = (raw: unknown): Species | null =>
  raw === 'cow' || raw === 'horse' ? raw : null;

/** 上次显式选过的物种：坏数据 / 隐私模式一律当没有，交给牛兜底 */
export function loadCreatorSpecies(
  storage: StorageLike | null = browserStorage('local'),
): Species | null {
  return readJson(storage, CREATOR_SPECIES_KEY, parseSpecies);
}

/** 写物种：存储写失败不影响捏人流程，顶多下次回到存档或牛 */
export function saveCreatorSpecies(
  species: Species,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, CREATOR_SPECIES_KEY, species);
}

export function defaultAppearance(species: Species = 'cow'): CharacterAppearance {
  return sanitizeAppearance(DEFAULT_APPEARANCE[species]);
}

const NICK_PREFIX = ['加班', '摸鱼', '打卡', '工位', '夜班', '绩效'];
const NICK_SUFFIX = ['实习生', '老黄牛', '千里马', '临时工', '钉子户', '熟练工'];

export function randomNickname(): string {
  const a = NICK_PREFIX[Math.floor(Math.random() * NICK_PREFIX.length)]!;
  const b = NICK_SUFFIX[Math.floor(Math.random() * NICK_SUFFIX.length)]!;
  return `${a}${b}${Math.floor(Math.random() * 90 + 10)}`;
}
