'use client';

import {
  DEFAULT_APPEARANCE,
  FALLBACK_NICKNAME,
  inspectText,
  sanitizeAppearance,
  truncateName,
  type CharacterAppearance,
  type ModerationResult,
  type Species,
} from '@niuma/shared-types';

const STORAGE_KEY = 'niuma:profile:v1';

export interface Profile {
  name: string;
  appearance: CharacterAppearance;
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
  return inspectText(truncateName(raw));
}

/**
 * 只写 sessionStorage：关闭标签页即清空，服务端不落任何数据。
 */
export function saveProfile(profile: Profile): void {
  if (typeof window === 'undefined') return;
  const payload: Profile = {
    // 与协议同一把尺子：16 字符 / 48 字节，别再写死 slice(0, 16)
    name: resolveProfileName(profile.name),
    appearance: sanitizeAppearance(profile.appearance),
  };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      name:
        typeof parsed.name === 'string' && parsed.name.length > 0
          ? resolveProfileName(parsed.name)
          : FALLBACK_NICKNAME,
      appearance: sanitizeAppearance(parsed.appearance),
    };
  } catch (error) {
    console.error('[profile] corrupted draft dropped', error);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(STORAGE_KEY);
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
