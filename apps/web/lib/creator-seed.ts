/**
 * 捏人页的入场种子。
 *
 * 物种有三个来源：入口参数（`/create?species=horse`）、本地存档、上次显式选择。
 * 优先级只在这里实现一次，Server Component（`app/create/page.tsx`）与客户端
 * （`CreatorShell`、`JoinGate`）拿到的是同一套结论。
 *
 * 与 `lib/park.ts` 同一约定：不带 `'use client'`、不碰 window，
 * 服务端与客户端共用一份尺子。存储读写仍留在 `profile.ts` 的收口里。
 */

import {
  DEFAULT_APPEARANCE,
  sanitizeAppearance,
  type CharacterAppearance,
  type Species,
} from '@niuma/shared-types';
import type { Profile } from './profile';

/** 捏人页一次性落库的初始状态；`status` 不参与编辑，只负责原样带回存档 */
export interface CreatorSeed {
  name: string;
  appearance: CharacterAppearance;
  status: string;
  dirty: boolean;
}

/**
 * `?species=` 的唯一一把尺子：只认 cow / horse。
 *
 * 重复参数与 `/play` 的取法一致，看第一条；非法值一律当没传，
 * 交给存档或记忆键兜底，不会把地址栏里的脏字符串带进外观。
 */
export function parseSpeciesParam(raw: string | string[] | null | undefined): Species | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'cow' || value === 'horse' ? value : null;
}

/**
 * 切物种：11 个色槽整体保留，其余回到新物种的默认值。
 *
 * 页内点「工种」与入口直接带 `?species=` 必须是同一种切法，否则同一件事
 * 会有两套观感。同物种直接返回原对象，调用方可据此判定「外观没变」。
 */
export function switchSpeciesAppearance(
  appearance: CharacterAppearance,
  species: Species,
): CharacterAppearance {
  if (appearance.species === species) return appearance;
  return sanitizeAppearance({ ...DEFAULT_APPEARANCE[species], colors: appearance.colors });
}

/**
 * 合成捏人页初始状态，优先级写死在这里：
 *
 *   URL 参数 > 本地存档物种 > 上次显式选择 > 牛
 *
 * 只有「入口物种与存档物种不一致」才算草稿未保存：用户点了
 * 「以马的身份入职」，页面上就该显示未保存，而不是假装已同步。
 */
export function resolveCreatorSeed(
  profile: Profile | null,
  requested: Species | null,
  remembered: Species | null,
): CreatorSeed {
  if (profile) {
    const saved = profile.appearance.species;
    return {
      name: profile.name,
      appearance:
        requested === null ? profile.appearance : switchSpeciesAppearance(profile.appearance, requested),
      status: profile.status,
      dirty: requested !== null && requested !== saved,
    };
  }

  return {
    name: '',
    appearance: sanitizeAppearance(DEFAULT_APPEARANCE[requested ?? remembered ?? 'cow']),
    status: '',
    dirty: false,
  };
}
