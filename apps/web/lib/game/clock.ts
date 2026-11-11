/**
 * 聊天行左侧的时间戳：本地时钟的 HH:MM（24 小时制）。
 *
 * 手写补零而不是 `Intl.DateTimeFormat`：每渲染一屏消息就建一个格式化器太贵，
 * 而且服务端与浏览器的 locale 不一致时，SSR 与水合会给出两种结果。
 * 时间只用于展示，不参与排序或对齐，所以直接用客户端时钟即可。
 */
export function formatClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '--:--';
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 悬停时看的完整时刻：本地时区，不依赖 locale，避免 SSR 与水合的差异 */
export function formatFullClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}
