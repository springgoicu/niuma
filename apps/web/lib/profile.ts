'use client';

import {
  DEFAULT_APPEARANCE,
  sanitizeAppearance,
  truncateName,
  type CharacterAppearance,
  type Species,
} from '@niuma/shared-types';

const STORAGE_KEY = 'niuma:profile:v1';

export interface Profile {
  name: string;
  appearance: CharacterAppearance;
}

/**
 * 只写 sessionStorage：关闭标签页即清空，服务端不落任何数据。
 */
export function saveProfile(profile: Profile): void {
  if (typeof window === 'undefined') return;
  const payload: Profile = {
    // 与协议同一把尺子：16 字符 / 48 字节，别再写死 slice(0, 16)
    name: truncateName(profile.name),
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
      name: typeof parsed.name === 'string' && parsed.name.length > 0 ? truncateName(parsed.name) : '无名牛马',
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
