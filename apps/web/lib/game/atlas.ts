'use client';

import { Assets, Rectangle, Texture, type TextureSource } from 'pixi.js';

export interface SpriteManifest {
  frame: { w: number; h: number; columns: number; rows: number };
  directions: string[];
  clips: Record<string, { frames: number[]; fps: number }>;
  origin: { x: number; y: number };
  /** 配件图标边长；缺省按 16 处理，兼容旧图集 */
  cosmeticSize?: number;
  species: Record<
    string,
    {
      body: string[];
      pattern: string[];
      hoof: string[];
      eyes: string[];
      extra: string[];
      snout: string[];
    }
  >;
  cosmeticFiles: Record<string, Record<string, string | null>>;
  cosmeticAnchors: Record<string, Record<string, [number, number]>>;
  preview?: Record<string, string>;
}

export interface Atlas {
  manifest: SpriteManifest;
  /** 32 帧（4 方向 × 8 帧）切片，索引 = row * 8 + col */
  frames(path: string): Promise<Texture[]>;
  cosmetic(path: string): Promise<Texture>;
}

const FRAME_COUNT = 32;
const COLUMNS = 8;

async function buildAtlas(): Promise<Atlas> {
  const response = await fetch('/sprites/manifest.json');
  if (!response.ok) throw new Error(`manifest ${response.status}`);
  const manifest = (await response.json()) as SpriteManifest;

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

export function frameForPose(pose: string, elapsedMs: number): number {
  if (pose === 'sit') return 6;
  if (pose === 'lie') return 7;
  if (pose === 'walk') return 2 + (Math.floor(elapsedMs / 110) % 4);
  return Math.floor(elapsedMs / 400) % 2;
}
