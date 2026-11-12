/**
 * 昵称的「形态」检查：与词库无关的一类明显越界。
 *
 * 游戏昵称里出现域名、邮箱、社交账号，没有正当用途——那就是一块广告位。
 * 这件事词库做不到：normalize 会剔掉 `.` `@` 这类标点，`.com` 规范化之后
 * 只剩 `com`，写进词表会把 `welcome` 一起打码。所以形态检查跑在原文上。
 *
 * 只在原文里出现完整的 URL / 域名 / 邮箱 / 「社交号 + 号码」时才判定，
 * 正常中文昵称、纯数字、常见英文名都不会命中。
 */

/** `https://` `www.` 开头：没人会在昵称里写协议头，除了做广告 */
const URL_SHAPE = /https?:\/\/|www\./i;

/** 完整域名：主体 + 常见 TLD，且两侧不能紧贴字母数字（避免 `a.comb` 这类误判） */
const DOMAIN_SHAPE =
  /(?:^|[^a-z0-9-])(?:[a-z0-9][a-z0-9-]{0,62})\.(?:com|cn|net|org|top|xyz|vip|cc|io|me|tv|shop|site|club|link|online|store|app)(?:[^a-z0-9-]|$)/i;

/** 邮箱 */
const EMAIL_SHAPE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** 「微信/QQ/扣扣 + 5 位以上号码」：直接留联系方式揽客 */
const CONTACT_SHAPE = /(?:微信|威信|薇信|vx|wx|qq|扣扣|企鹅)\s*[:：]?\s*[a-z0-9]{5,}/i;

/** true 表示这个昵称看起来是在做广告/留联系方式，调用方应直接拒绝 */
export function isAdLikeNickname(name: string): boolean {
  const text = name.trim();
  if (text.length === 0) return false;
  return (
    URL_SHAPE.test(text) ||
    DOMAIN_SHAPE.test(text) ||
    EMAIL_SHAPE.test(text) ||
    CONTACT_SHAPE.test(text)
  );
}
