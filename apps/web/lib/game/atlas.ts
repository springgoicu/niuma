'use client';

import { Assets, Rectangle, Texture, type TextureSource } from 'pixi.js';
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
  cosmeticFiles: Record<string, Record<string, string | null>>;
  cosmeticAnchors: Record<string, Record<string, [number, number]>>;
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

async function buildAtlas(): Promise<Atlas> {
  const response = await fetch('/sprites/manifest.json');
  if (!response.ok) throw new Error(`manifest ${response.status}`);
  const manifest = (await response.json()) as SpriteManifest;

  if (manifest.version !== SPRITE_LAYOUT.version) {
    throw new Error(
      `图集版本 ${manifest.version} 与客户端布局 v${SPRITE_LAYOUT.version} 不一致，请重跑 pnpm assets`,
    );
  }
  if (manifest.frame.columns !== COLUMNS || manifest.frame.rows !== ROWS) {
    throw new Error(
      `图集为 ${manifest.frame.columns}x${manifest.frame.rows}，客户端期望 ${COLUMNS}x${ROWS}，请重跑 pnpm assets`,
    );
  }

  /** 所有纹理走同一个加载口：统一 nearest，避免任何一处漏配后被插值抹平 */
  const textureCache = new Map<string, Texture>();
  const frameCache = new Map<string, Texture[]>();
  const { w, h } = manifest.frame;

  async function texture(path: string): Promise<Texture> {
    const cached = textureCache.get(path);
    if (cached) return cached;
    const loaded = await Assets.load<Texture>(`/sprites/${path}`);
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
  if (!pending) pending = buildAtlas();
  return pending;
}

export function directionOf(frameIndex: number): number {
  return Math.floor(frameIndex / COLUMNS);
}
