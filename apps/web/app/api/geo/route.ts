export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * IP 归属地：无状态代理，不写任何存储，也绝不因为上游挂了返回 500。
 *
 * 读取顺序按部署形态固定：`x-forwarded-for` 第一段（最靠近用户的代理写的那一段）
 * 优先，其次 `x-real-ip`。内网、缺头、非法值都直接返回空值，不发出公网请求，
 * 也不拿编造地名冒充归属地。
 */
interface GeoInfo {
  region: string;
  city: string;
  isp: string;
}

/** 内网、缺头、上游失败：统一返回空值，由界面显示「未上报」，不编造地名 */
const UNKNOWN_GEO: GeoInfo = { region: '', city: '', isp: '' };

const PRIMARY_TIMEOUT_MS = 2_000;
const SECONDARY_TIMEOUT_MS = 1_500;

const PRIVATE_V4 =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const LOOPBACK_V6 = /^(?:::1|::|f[cd][0-9a-f]{2}:|fe80:)/i;

function json(info: GeoInfo): Response {
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 归属地因人而异：不允许任何共享缓存把它发给别人
      'cache-control': 'private, no-store',
    },
  });
}

/** 去端口、去方括号、还原 IPv4-mapped IPv6；不是 IP 的字面量原样交回，由调用方判非法 */
function normalizeIp(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || value.toLowerCase() === 'unknown') return null;

  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) value = value.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.replace(/:\d+$/, '');
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) value = mapped[1]!;
  return value;
}

function isIpLike(value: string): boolean {
  return /^[0-9a-fA-F:.]+$/.test(value) && (value.includes('.') || value.includes(':'));
}

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (PRIVATE_V4.test(ip)) return true;
  if (LOOPBACK_V6.test(ip)) return true;
  return false;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** ip-api.com：免费接口只支持 http，服务端调用不受页面混合内容限制 */
function parseIpApi(raw: unknown): GeoInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.status !== 'success') return null;
  const region = asString(value.regionName) || asString(value.country);
  const city = asString(value.city);
  if (!region && !city) return null;
  return { region, city, isp: asString(value.isp) };
}

/** ipapi.co：HTTPS 备选，字段名与 ip-api 不同 */
function parseIpapiCo(raw: unknown): GeoInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.error === true) return null;
  const region = asString(value.region) || asString(value.country_name);
  const city = asString(value.city);
  if (!region && !city) return null;
  return { region, city, isp: asString(value.org) };
}

async function resolvePublic(ip: string): Promise<GeoInfo> {
  const encoded = encodeURIComponent(ip);
  const primary = await fetchJson(
    `http://ip-api.com/json/${encoded}?lang=zh-CN&fields=status,message,country,regionName,city,isp`,
    PRIMARY_TIMEOUT_MS,
  );
  const fromPrimary = parseIpApi(primary);
  if (fromPrimary) return fromPrimary;

  const secondary = await fetchJson(`https://ipapi.co/${encoded}/json/`, SECONDARY_TIMEOUT_MS);
  return parseIpapiCo(secondary) ?? UNKNOWN_GEO;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const forwarded = request.headers.get('x-forwarded-for');
    // 第一个头为空 / 为 unknown 时仍要回退到 x-real-ip，而不是直接判内网
    const ip =
      normalizeIp(forwarded?.split(',')[0] ?? null) ??
      normalizeIp(request.headers.get('x-real-ip'));

    // 没有转发头 / 非法 IP / 内网：一律返回空值，不去打扰公网服务
    if (!ip || !isIpLike(ip) || isPrivateIp(ip)) return json(UNKNOWN_GEO);

    return json(await resolvePublic(ip));
  } catch {
    // 任何未预期错误都降级，绝不把 500 抛给前端
    return json(UNKNOWN_GEO);
  }
}
