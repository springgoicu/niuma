import { BUILD_ID } from '@/lib/build-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 线上版本探针：客户端靠它判断自己手里的地图是否已过期。
 *
 * 不读 Cookie、不查数据库，响应只有一个 id；必须禁止任何层缓存，
 * 否则旧 HTML 里的客户端会一直看到旧版本号，永远不会触发重载。
 */
export function GET(): Response {
  return Response.json(
    { id: BUILD_ID },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
      },
    },
  );
}
