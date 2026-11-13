'use client';

import { Assets, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { withRetry } from './async-retry';
import { AtlasLoadError } from './atlas-errors';
import { SPRITE_LAYOUT } from './sprite-layout.generated';

export interface SpriteClip {
  frames: number[];
  frameMs: number[];
  loopFrom: number;
  loop: boolean;
}

export interface SpeciesLayers {
  body: string[];
  pattern: string[];
  /** 背线高光：旧图集没有这一层，按可选处理 */
  bodyLight?: string[];
  hoof: string[];
  eyes: string[];
  eyeLight?: string[];
  extra: string[];
  snout: string[];
  /** v5：尾巴从 body 层拆出来独立染色，按 tailId 索引 */
  tail?: string[];
}

export interface SpriteManifest {
  version: number;
  frame: { w: number; h: number; columns: number; rows: number };
  directions: string[];
  clips: Record<string, SpriteClip>;
  origin: { x: number; y: number };
  /** 配件图标边长；缺省按 16 处理，兼容旧图集 */
  cosmeticSize?: number;
  species: Record<string, SpeciesLayers>;
  /** v3：配件图标按朝向分文件，none 为 null */
  cosmeticFiles: Record<string, Record<string, Record<string, string | null> | null>>;
  /** v3：物种 → 朝向 → 帧列 → 类别，null 表示该朝向不显示（如背面的眼镜） */
  cosmeticAnchors: Record<string, Record<string, Record<string, Record<string, [number, number] | null>>>>;
  preview?: Record<string, string>;
}

export interface Atlas {
  manifest: SpriteManifest;
  /** 每行帧数，等于 manifest.frame.columns */
  columns: number;
  /** 32/64 帧切片，索引 = row * columns + col */
  frames(path: string): Promise<Texture[]>;
  cosmetic(path: string): Promise<Texture>;
}

/** 切片数量以生成期写入的布局为准：改了列数却忘了重跑 `pnpm assets` 会在这里报错 */
const COLUMNS = SPRITE_LAYOUT.frame.columns;
const ROWS = SPRITE_LAYOUT.frame.rows;
const FRAME_COUNT = COLUMNS * ROWS;

const MANIFEST_URL = '/sprites/manifest.json';
/** 冷启动只多试一次：弱网下 250ms 足够躲过最常见的瞬时断流，再久就该让用户看到真实失败 */
const LOAD_ATTEMPTS = 2;
const LOAD_RETRY_BASE_MS = 250;
const LOAD_RETRY_JITTER = 0.4;

/**
 * Pixi 的 Assets 会按 URL 记住加载中的 Promise；失败后不清掉的话，
 * 下一次 `Assets.load` 会立刻拿到同一个 rejection，重试就成了空转。
 * best-effort：资产还没进缓存时 unload 会失败，不影响后续尝试。
 */
async function evictAsset(url: string): Promise<void> {
  try {
    await Assets.unload(url);
  } catch {
    // 清不掉就让下一次加载自己再试；这里不改变原始错误
  }
}

async function fetchManifest(): Promise<SpriteManifest> {
  try {
    return await withRetry(
      async () => {
        const response = await fetch(MANIFEST_URL);
        if (!response.ok) {
          throw new AtlasLoadError('manifest', `图集清单请求失败（${response.status}）`, true);
        }
        return (await response.json()) as SpriteManifest;
      },
      { attempts: LOAD_ATTEMPTS, baseDelayMs: LOAD_RETRY_BASE_MS, jitterRatio: LOAD_RETRY_JITTER },
    );
  } catch (error) {
    // 已经是分类错误（含版本错配）就原样抛，避免把可判别的 code 包掉
    if (error instanceof AtlasLoadError) throw error;
    throw new AtlasLoadError('manifest', '图集清单加载失败', true, { cause: error });
  }
}

async function buildAtlas(): Promise<Atlas> {
  const manifest = await fetchManifest();

  if (manifest.version !== SPRITE_LAYOUT.version) {
    throw new AtlasLoadError(
      'version-mismatch',
      `图集版本 ${manifest.version} 与客户端布局 v${SPRITE_LAYOUT.version} 不一致`,
      false,
    );
  }
  if (manifest.frame.columns !== COLUMNS || manifest.frame.rows !== ROWS) {
    throw new AtlasLoadError(
      'version-mismatch',
      `图集为 ${manifest.frame.columns}x${manifest.frame.rows}，客户端期望 ${COLUMNS}x${ROWS}`,
      false,
    );
  }

  /** 所有纹理走同一个加载口：统一 nearest，避免任何一处漏配后被插值抹平 */
  const textureCache = new Map<string, Texture>();
  const frameCache = new Map<string, Texture[]>();
  const { w, h } = manifest.frame;

  async function texture(path: string): Promise<Texture> {
    const cached = textureCache.get(path);
    if (cached) return cached;
    const url = `/sprites/${path}`;
    let loaded: Texture;
    try {
      loaded = await withRetry(
        async () => {
          try {
            return await Assets.load<Texture>(url);
          } catch (error) {
            // 先把失败的 Promise 从 Assets 里摘掉，下一次才能真的重新发请求
            await evictAsset(url);
            throw error;
          }
        },
        { attempts: LOAD_ATTEMPTS, baseDelayMs: LOAD_RETRY_BASE_MS, jitterRatio: LOAD_RETRY_JITTER },
      );
    } catch (error) {
      throw new AtlasLoadError('texture', `贴图加载失败：${path}`, true, { cause: error });
    }
    loaded.source.scaleMode = 'nearest';
    textureCache.set(path, loaded);
    return loaded;
  }

  return {
    manifest,
    columns: COLUMNS,
    async frames(path) {
      const cached = frameCache.get(path);
      if (cached) return cached;
      const source: TextureSource = (await texture(path)).source;
      const list: Texture[] = new Array(FRAME_COUNT);
      for (let index = 0; index < FRAME_COUNT; index += 1) {
        const col = index % COLUMNS;
        const row = Math.floor(index / COLUMNS);
        list[index] = new Texture({
          source,
          frame: new Rectangle(col * w, row * h, w, h),
        });
      }
      frameCache.set(path, list);
      return list;
    },
    cosmetic(path) {
      return texture(path);
    },
  };
}

let pending: Promise<Atlas> | null = null;

export function loadAtlas(): Promise<Atlas> {
  if (!pending) {
    // 失败不把 promise 钉死：角色视图重试、主线程回退都还会再调一次，
    // 缓存一个 rejected promise 等于让一次瞬时故障污染整个页面生命周期。
    pending = buildAtlas().catch((error: unknown) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

export function directionOf(frameIndex: number): number {
  return Math.floor(frameIndex / COLUMNS);
}
