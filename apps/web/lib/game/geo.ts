'use client';

import { browserStorage, readJson, writeJson } from '../storage';

/**
 * IP 归属地的客户端缓存。
 *
 * 归属地在一个标签页里不会变：第一次拿到（含降级结果）就写进 sessionStorage，
 * 之后所有组件都读同一份，绝不在同一会话里第二次打扰 /api/geo。
 */
export const GEO_STORAGE_KEY = 'niuma:geo:v1';
/** 请求超时：Route Handler 自己还有 3.5s 的供应商超时，这里只做兜底 */
const GEO_TIMEOUT_MS = 4_000;

export interface GeoInfo {
  region: string;
  city: string;
  isp: string;
}

/** 公网查询失败时的统一降级：与 /api/geo 的返回值保持同一份字面量 */
export const GEO_FALLBACK: GeoInfo = {
  region: '赛博空间',
  city: '边缘节点',
  isp: '未知网络',
};

function sanitizeGeo(raw: unknown): GeoInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const region = typeof value.region === 'string' ? value.region.trim() : '';
  const city = typeof value.city === 'string' ? value.city.trim() : '';
  const isp = typeof value.isp === 'string' ? value.isp.trim() : '';
  if (!region || !city) return null;
  return { region, city, isp: isp || '未知网络' };
}

/** 隐私模式下 sessionStorage 可能不可用：内存再兜一层，保证本文档内仍只请求一次 */
let memoryGeo: GeoInfo | null = null;

export function readCachedGeo(): GeoInfo | null {
  if (memoryGeo) return memoryGeo;
  const stored = readJson(browserStorage('session'), GEO_STORAGE_KEY, sanitizeGeo);
  if (stored) memoryGeo = stored;
  return stored;
}

let inflight: Promise<GeoInfo> | null = null;

/**
 * 同一会话只请求一次：内存里先挡住并发组件，sessionStorage 再挡住后续挂载与刷新。
 * 超时/网络错误也写回降级值，下一次调用直接命中缓存。
 */
export function loadGeo(): Promise<GeoInfo> {
  const cached = readCachedGeo();
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = requestGeo().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function requestGeo(): Promise<GeoInfo> {
  let result: GeoInfo = GEO_FALLBACK;
  try {
    const response = await fetch('/api/geo', {
      cache: 'no-store',
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (response.ok) {
      result = sanitizeGeo((await response.json()) as unknown) ?? GEO_FALLBACK;
    }
  } catch {
    // 离线 / 超时 / 非 JSON：降级，不把错误抛给游戏
    result = GEO_FALLBACK;
  }
  memoryGeo = result;
  writeJson(browserStorage('session'), GEO_STORAGE_KEY, result);
  return result;
}
