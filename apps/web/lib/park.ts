/**
 * 园区（park）= 一座独立运行的 game-server 实例。
 *
 * 与 `region` 严格区分：`region` 是同一座园区里的区域名（工作区 / 休息室 / 研发园），
 * 由 `regionAt()` 按坐标算出来；`park` 换一个就是另一个进程、另一批玩家。
 *
 * 本文件必须保持「服务端也能 import」：不带 `'use client'`，不碰 window 与 process.env。
 * 这样 Server Component（/play、/enter、首页内联脚本）与客户端组件共用同一份白名单
 * 与同一套 URL 归一化逻辑，不会出现「服务端认、客户端不认」的两套尺子。
 */

export interface ParkEntry {
  /** 白名单 id：小写字母、数字与连字符，最长 32 */
  id: string;
  name: string;
  /** 可写 `/ws` 相对路径，也可写 `wss://b.example.com/ws` 绝对地址 */
  ws: string;
  /** 可写 `/health` 相对路径，也可写 `https://b.example.com/health` */
  health: string;
}

/**
 * id 的唯一一把尺子：服务端配置、客户端存档、nginx 的 Origin 白名单都对齐它。
 * 限定成这个字符集是为了让 `?park=` 永远不会被拼出斜杠或引号。
 */
export const PARK_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/** 玩家上次选的园区：只存 id，绝不存 URL */
export const PARK_PREF_KEY = 'niuma:park:v1';

/** 端点串的长度上限：防一段畸形配置把内存和日志刷满 */
const MAX_ENDPOINT_LENGTH = 2048;

/**
 * 没有配置 `GAME_PARKS` 时合成的单园区。
 *
 * 它的存在等于「回滚开关」：线上把 GAME_PARKS 清空并重启 Web，行为立刻回到
 * 改造之前的单机语义——选园页退化成一张卡片，直接进，不需要回滚代码。
 */
export const DEFAULT_PARK: ParkEntry = {
  id: 'main',
  name: '主园区',
  ws: '/ws',
  health: '/health',
};

export function isParkId(value: unknown): value is string {
  return typeof value === 'string' && PARK_ID_PATTERN.test(value);
}

function readEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ENDPOINT_LENGTH) return null;
  return trimmed;
}

/**
 * 配置归一化：非法项直接丢，重复 id 只留第一条，name 缺省时退回 id。
 *
 * 服务端读环境变量与测试构造都用它，所以「配置写错」只会少一个园区，
 * 不会让选园页崩掉或渲染出一张点不动的卡片。
 */
export function sanitizeParks(raw: unknown): ParkEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const parks: ParkEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const draft = item as Record<string, unknown>;
    const id = draft.id;
    if (!isParkId(id) || seen.has(id)) continue;
    const ws = readEndpoint(draft.ws);
    const health = readEndpoint(draft.health);
    if (!ws || !health) continue;
    const name = typeof draft.name === 'string' ? draft.name.trim() : '';
    seen.add(id);
    parks.push({ id, name: name.length > 0 ? name : id, ws, health });
  }
  return parks;
}

export interface ResolvedPark {
  park: ParkEntry;
  /** true 表示请求的 id 不在白名单里，已经回落到第一个园区 */
  fallback: boolean;
}

/**
 * 把「客户端给的 id」变成「服务端认可的端点」。
 *
 * 这是唯一允许把 parkId 翻译成 URL 的地方：`?park=` 与 localStorage 都是用户可改的，
 * 走完这一步之后拿到的 `park.ws` 一定来自服务端配置。
 */
export function resolvePark(parks: readonly ParkEntry[], id: string | null | undefined): ResolvedPark {
  const list = parks.length > 0 ? parks : [DEFAULT_PARK];
  const wanted = isParkId(id) ? id : null;
  const hit = wanted === null ? undefined : list.find((park) => park.id === wanted);
  if (hit) return { park: hit, fallback: false };
  return { park: list[0]!, fallback: wanted !== null };
}

function absoluteUrl(endpoint: string, origin: string): URL | null {
  try {
    return new URL(endpoint, origin);
  } catch {
    console.error('[park] 端点不是合法 URL：', endpoint);
    return null;
  }
}

/**
 * 端点归一化：相对路径按当前站点补全，http(s) 与 ws(s) 互相换协议。
 *
 * 这样单机部署只要写 `/ws` 就能跑（本地 next dev 也能自动直连游戏服），
 * 两园区部署写 `wss://b.example.com/ws` 也不会被硬编码的协议卡住
 * ——线上是 HTTPS，浏览器不允许连 `ws://`。
 */
export function toWsUrl(endpoint: string, origin: string): string {
  const url = absoluteUrl(endpoint, origin);
  if (!url) return endpoint;
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  return url.toString();
}

export function toHealthUrl(endpoint: string, origin: string): string {
  const url = absoluteUrl(endpoint, origin);
  if (!url) return endpoint;
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  return url.toString();
}

/**
 * 选园页要展示的实时状态。
 *
 * `parkId` 来自服务端自述（而不是配置里的 id），所以「配置指到 B、实际连到 A」
 * 这种部署错位能在页面上直接看出来。
 */
export interface ParkHealth {
  parkId: string;
  parkName: string;
  online: number;
  capacity: number;
  queued: number;
  /** 闸门关着意味着新来的人要先排队 */
  gateOpen: boolean;
  /** 三维水位取最大后的千分比 */
  utilizationPermille: number;
  /** 浏览器到该园区的往返毫秒数 */
  rttMs: number;
}

function toCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/** `/health` 的响应是外部输入：只认自己认识的字段，缺一个就当这次探活失败 */
export function parseParkHealth(raw: unknown, rttMs: number): ParkHealth | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const draft = raw as Record<string, unknown>;
  const online = toCount(draft.online);
  if (online === null) return null;
  const admission =
    typeof draft.admission === 'object' && draft.admission !== null
      ? (draft.admission as Record<string, unknown>)
      : {};
  return {
    parkId: typeof draft.parkId === 'string' ? draft.parkId : '',
    parkName: typeof draft.parkName === 'string' ? draft.parkName : '',
    online,
    // 容量缺省时退回在线数：卡片显示「2 / 2」总好过「2 / 0」
    capacity: toCount(admission.capacity) ?? online,
    queued: toCount(admission.queueLength) ?? 0,
    gateOpen: admission.gateOpen !== false,
    utilizationPermille: toCount(admission.utilizationPermille) ?? 0,
    rttMs,
  };
}
