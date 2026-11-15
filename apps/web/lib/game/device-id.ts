'use client';

/**
 * 匿名设备号（ADR-0081）。
 *
 * 服务端的点赞与擂台战绩需要跨会话累计，而园区没有账号：这里在 localStorage 里
 * 生成一次 8 字节随机数，之后每次 HELLO 都带上它。
 *
 * 三条边界：
 * - 它不是身份认证：清了存储、换浏览器、隐私模式都是「新设备」，服务端不会报错；
 * - 它不上屏、不广播、也不写日志原文（服务端只打前 4 位）；
 * - 取不到 localStorage 时返回空串，整条链路退化成会话级计数，不影响进园。
 */

import { browserStorage } from '../storage';

const STORAGE_KEY = 'niuma-device-id';
const HEX_PATTERN = /^[0-9a-f]{16}$/;

let cached: string | null = null;

function generateHex(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i]!.toString(16).padStart(2, '0');
  return out;
}

/**
 * 取本机设备号；第一次访问时生成并落盘。
 *
 * 服务端拿到的是 hex 字符串，非法值会被 `decodeHello` 直接忽略，
 * 所以这里只要保证自己写进去的永远是 16 位小写 hex 就够了。
 */
export function ensureDeviceId(): string {
  if (cached !== null) return cached;
  const storage = browserStorage('local');
  const existing = storage?.getItem(STORAGE_KEY) ?? null;
  if (existing && HEX_PATTERN.test(existing)) {
    cached = existing;
    return cached;
  }
  const fresh = generateHex();
  try {
    storage?.setItem(STORAGE_KEY, fresh);
  } catch {
    // 隐私模式写不进去：本次会话仍可用，下次会话换新号即可
  }
  cached = fresh;
  return cached;
}

/** 只读：不想在渲染阶段触发写入时用 */
export function peekDeviceId(): string {
  if (cached !== null) return cached;
  const storage = browserStorage('local');
  const existing = storage?.getItem(STORAGE_KEY) ?? null;
  return existing && HEX_PATTERN.test(existing) ? existing : '';
}
