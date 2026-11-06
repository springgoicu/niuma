/**
 * 昵称的显示宽度：唯一真相。
 *
 * 字符数不够用：16 个汉字横跨三个身位，16 个 ASCII 却只占一半。
 * 这里按「半角 1、全角 2」折算成显示单位，输入、存储、协议、头顶渲染读同一把尺子，
 * 不在各端各写一份 `slice(0, 16)`。
 */

import { MAX_NAME_CHARS } from './constants';

/** 截断后缀：单字符，占 1 个显示单位 */
export const NAME_ELLIPSIS = '…';

/**
 * 零宽码点：组合符、变体选择符、肤色修饰、零宽连接符都不占位。
 * 漏掉这一段，"👨‍👩‍👧" 会被算成 6 宽，名字提前被砍。
 */
function isZeroWidth(code: number): boolean {
  return (
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    code === 0xfeff ||
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x2000 && code <= 0x200f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0x1f3fb && code <= 0x1f3ff) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  );
}

/** 全角 / 宽字符：CJK、假名、谚文、全角标点、emoji */
function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function charWidth(ch: string): number {
  const code = ch.codePointAt(0);
  if (code === undefined) return 0;
  // 控制字符不占位，也不该出现在昵称里
  if (code < 0x20 || code === 0x7f) return 0;
  if (isZeroWidth(code)) return 0;
  return isFullWidth(code) ? 2 : 1;
}

/**
 * 只做字符数钳制：不 trim、不去控制符。
 * 输入框的 onChange 用这个而不是 `truncateName`——边打边剪会把用户正在输入的尾随空格吃掉。
 */
export function clampNameLength(text: string, maxChars: number = MAX_NAME_CHARS): string {
  const limit = Math.max(0, Math.floor(maxChars));
  let out = '';
  let count = 0;
  for (const ch of text) {
    if (count >= limit) break;
    out += ch;
    count += 1;
  }
  return out;
}

/** 显示宽度：半角 1、全角 2、零宽 0。按码点遍历，不会切坏代理对 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/**
 * 按显示宽度截断，超宽时补省略号。
 * 省略号也计入预算：结果宽度永远 `<= maxUnits`，不会因为补了「…」反而更宽。
 */
export function truncateToDisplayWidth(text: string, maxUnits: number, ellipsis: string = NAME_ELLIPSIS): string {
  const limit = Math.max(0, Math.floor(maxUnits));
  if (displayWidth(text) <= limit) return text;

  const tail = displayWidth(ellipsis) <= limit ? ellipsis : '';
  const budget = limit - displayWidth(tail);

  let out = '';
  let used = 0;
  for (const ch of text) {
    const width = charWidth(ch);
    // 零宽码点（组合符 / ZWJ）紧跟在前一个字符上，不该被宽度预算挡下
    if (width === 0) {
      if (out.length > 0) out += ch;
      continue;
    }
    if (used + width > budget) break;
    out += ch;
    used += width;
  }

  // 截断点可能落在组合符 / ZWJ 之后，留着会渲染成孤立符号
  out = out.replace(/[\u200b-\u200f\ufe00-\ufe0f\ufe0e]+$/u, '');
  return (out.length > 0 ? out : '') + tail;
}
