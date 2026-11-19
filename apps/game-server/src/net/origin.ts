/**
 * WebSocket 握手的 Origin 白名单（防 CSWSH）。
 *
 * 为什么 nginx 已经挡了还要在进程里再挡一次：
 *   1. nginx 那层是 `map $http_origin` 的配置，某天有人改站点、加新入口、
 *      或者直接把游戏端口暴露出去（GAME_SERVER_HOST 从 127.0.0.1 改成 0.0.0.0），
 *      这一层就无声失效了。校验必须落在「谁真正接连接」的那一端。
 *   2. 移动端/内嵌 WebView 可能不经过我们的 nginx（调试包直连域名:端口）。
 *
 * 空 Origin 放行：浏览器在 WebSocket 握手时必然带 Origin，不带的一定是非浏览器
 * 客户端（探活、压测、运维脚本）。它们没有受害者的 cookie，构不成 CSWSH；
 * 真正的连接洪水由 nginx 的 limit_conn 与进程内的频率窗口兜住。
 */
const DEFAULT_ALLOWED = 'https://bangying.top,https://www.bangying.top';

/** 本地开发：任意端口、任意协议都算自己人（只有本机才能造出这种 Origin） */
const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

/** AI Studio 预览域名（ais-dev / ais-pre） */
const AI_STUDIO_ORIGIN = /^https:\/\/ais-(?:dev|pre)-[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/;

export type OriginGuard = (origin: string | null | undefined) => boolean;

export function createOriginGuard(raw: string | undefined): OriginGuard {
  const custom = (raw ?? '').trim();
  const source = custom || DEFAULT_ALLOWED;
  const allowed = new Set<string>();
  for (const item of source.split(',')) {
    const value = item.trim().toLowerCase().replace(/\/+$/, '');
    if (value.length > 0) allowed.add(value);
  }
  if (!custom && process.env.APP_URL) {
    try {
      allowed.add(new URL(process.env.APP_URL).origin.toLowerCase());
    } catch {
      // ignore invalid APP_URL
    }
  }

  return (origin) => {
    // 头缺失：非浏览器客户端，放行
    if (!origin) return true;
    const value = origin.toLowerCase().replace(/\/+$/, '');
    if (allowed.has(value)) return true;
    if (!custom && AI_STUDIO_ORIGIN.test(value)) return true;
    return LOCAL_ORIGIN.test(value);
  };
}
