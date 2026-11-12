import {
  isAdLikeNickname,
  truncateName,
  type ModerationFilter,
} from '@niuma/shared-types';

export interface RenameResult {
  /** 裁决后应写入 `Player.name` 的值：空输入、域名形态与政治敏感都回落到原名 */
  name: string;
  /** 与服务端当前名字相比是否真的变了：没变就不重建入场缓存、不二次广播 */
  changed: boolean;
  /** 审核结论；`empty` 表示空输入，服务端据此保留原名 */
  verdict: 'allow' | 'mask' | 'reject' | 'empty';
  hits: number;
}

/**
 * 改名的唯一裁决入口：与 `C2S_HELLO` 共用同一把尺子。
 *
 * 与入场不同的只有失败策略：入场拿到违规名字会回退 `FALLBACK_NICKNAME`，
 * 改名则必须保留原名——否则玩家发一次空包或敏感词就把自己的工牌洗成了默认名。
 * 脏话仍按打码结果照常生效，与状态、聊天一致。
 */
export function resolveRename(
  current: string,
  raw: string,
  moderation: ModerationFilter,
): RenameResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { name: current, changed: false, verdict: 'empty', hits: 0 };
  }
  const text = truncateName(trimmed);
  // 域名/邮箱形态没有任何正当昵称用途：词库会剔掉标点看不到 `.com`，只能按原文判
  if (isAdLikeNickname(text)) {
    return { name: current, changed: false, verdict: 'reject', hits: 1 };
  }
  const verdict = moderation.inspect(text);
  if (verdict.verdict === 'reject') {
    return { name: current, changed: false, verdict: 'reject', hits: verdict.hits };
  }
  return {
    name: verdict.text,
    changed: verdict.text !== current,
    verdict: verdict.verdict,
    hits: verdict.hits,
  };
}
