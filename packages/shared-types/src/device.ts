/**
 * 匿名设备号（ADR-0081）。
 *
 * 服务端不保存账号，而点赞/擂台战绩要跨会话累计，所以需要一个**跨会话稳定**的键。
 * 客户端在 localStorage 里生成 8 字节随机数，协议里按二进制段带上；服务端只把它
 * 当聚合键，不做身份认证、不进准入判定，也永远不回显给其他玩家。
 *
 * 统一成小写 hex（16 字符）当字符串键：日志只打前 4 位也够定位，且能直接当
 * `Map` 的键。非法输入一律 `undefined`，调用方按「匿名新设备」处理。
 */

export const DEVICE_ID_BYTES = 8;
export const DEVICE_ID_HEX = DEVICE_ID_BYTES * 2;

const DEVICE_ID_PATTERN = /^[0-9a-f]{16}$/;

export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

/** hex → 8 字节；长度或字符不合法时返回 undefined（调用方跳过整段） */
export function deviceIdToBytes(id: string | undefined): Uint8Array | undefined {
  if (!id || !isDeviceId(id)) return undefined;
  const bytes = new Uint8Array(DEVICE_ID_BYTES);
  for (let i = 0; i < DEVICE_ID_BYTES; i += 1) {
    bytes[i] = Number.parseInt(id.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 8 字节 → 小写 hex；长度不对返回 undefined */
export function bytesToDeviceId(bytes: Uint8Array): string | undefined {
  if (bytes.length !== DEVICE_ID_BYTES) return undefined;
  let out = '';
  for (let i = 0; i < DEVICE_ID_BYTES; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

/** 日志用：只露前 4 位，够对照又不至于把整串设备号写进日志 */
export function deviceIdForLog(id: string): string {
  return isDeviceId(id) ? `${id.slice(0, 4)}…` : 'anon';
}
