/**
 * 园区列表的唯一真相在服务端配置里（`GAME_PARKS`，JSON 数组）。
 *
 * 只允许 Server Component 引用本文件：它读 `process.env`，一旦被客户端组件 import
 * 就会在打包时把整段配置（含内网地址）烘进浏览器 bundle。客户端拿到的是
 * 通过 props 下发的 `ParkEntry[]`，只认识 id 与名字。
 *
 * 为什么不用 `NEXT_PUBLIC_*`：那些变量是编译期内联的，加一座园区就要重新构建 Web。
 * 走服务端运行时读取，改完 `GAME_PARKS` 重启一次进程即可。
 */

import { DEFAULT_PARK, sanitizeParks, type ParkEntry } from './park';

/** 模块级 memo：SSR 每个请求都会走到这里，JSON 只该解析一次 */
let cached: ParkEntry[] | null = null;

export function loadParks(): ParkEntry[] {
  if (cached) return cached;

  const raw = process.env.GAME_PARKS?.trim();
  if (raw) {
    try {
      const parks = sanitizeParks(JSON.parse(raw) as unknown);
      if (parks.length > 0) {
        cached = parks;
        return cached;
      }
      console.error('[park] GAME_PARKS 解析后没有可用园区，回落到单园区');
    } catch {
      console.error('[park] GAME_PARKS 不是合法 JSON，回落到单园区');
    }
  }

  cached = [DEFAULT_PARK];
  return cached;
}

/** 仅供单测重置 memo：同进程里换配置时用，不参与运行时逻辑 */
export function resetParkCache(): void {
  cached = null;
}
