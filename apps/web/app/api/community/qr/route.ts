import sharp from 'sharp';
import { COMMUNITY } from '@/lib/community';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 源图缓存：群二维码 7 天才换一次，没必要每个访客都回源 */
const TTL_MS = 6 * 60 * 60 * 1000;
/**
 * 压缩参数：原图是 249×254 的截图，实测调色板 16 色 PNG 从 70.2KB 降到 9.2KB，
 * 像素几何完全不变。不缩放、不做二值化与降噪——阈值化会把二维码模块啃坏，实测整张花掉。
 */
const PNG_OPTIONS = { palette: true, colors: 16, compressionLevel: 9 } as const;

interface CachedQr {
  at: number;
  body: Buffer;
  type: string;
}

let cache: CachedQr | null = null;

function reply(entry: CachedQr, maxAge: number): Response {
  return new Response(new Uint8Array(entry.body), {
    headers: {
      'content-type': entry.type,
      'content-length': String(entry.body.length),
      'cache-control': `public, max-age=${maxAge}, stale-while-revalidate=604800`,
    },
  });
}

/**
 * 二维码同源代理：只认配置里的那一个链接，不接受任何查询参数，
 * 因此不会被拿来当成任意 URL 的公开代理。
 */
export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return reply(cache, 86400);

  const upstream = await fetch(COMMUNITY.wechat.qrUrl, { cache: 'no-store' }).catch(() => null);
  const upstreamType = upstream?.headers.get('content-type') ?? '';
  if (!upstream?.ok || !upstreamType.startsWith('image/')) {
    console.error('[community] 二维码源图拉取失败', upstream?.status ?? 'network', upstreamType || 'no-content-type');
    // 图床抖动时继续发旧图：二维码消失比晚一点更新更糟
    return cache ? reply(cache, 60) : new Response('二维码暂时不可用', { status: 502 });
  }

  const raw = Buffer.from(await upstream.arrayBuffer());
  const body = await sharp(raw)
    .png(PNG_OPTIONS)
    .toBuffer()
    .catch((error: unknown) => {
      // 压缩链路挂了也要把人送进群：退回原图，只是多几 KB
      console.error('[community] 二维码压缩失败，回退原图', error);
      return raw;
    });

  cache = { at: now, body, type: body === raw ? upstreamType : 'image/png' };
  return reply(cache, 86400);
}
