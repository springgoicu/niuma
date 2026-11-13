import { describe, expect, it } from 'bun:test';
import {
  reloadForRenderFatal,
  renderFatalUrl,
  resolveGpuPreference,
} from '../game/runtime/render-mode';
import type { StorageLike } from '../storage';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('渲染后端解析', () => {
  it('缺省走 WebGL2：默认值不再是 WebGPU', () => {
    expect(resolveGpuPreference('')).toBe('webgl');
    expect(resolveGpuPreference('?park=main&zoom=2')).toBe('webgl');
  });

  it('?gpu=webgpu 显式开启灰度，?gpu=webgl 与缺省等价', () => {
    expect(resolveGpuPreference('?gpu=webgpu')).toBe('webgpu');
    expect(resolveGpuPreference('?park=main&gpu=webgpu')).toBe('webgpu');
    expect(resolveGpuPreference('?gpu=webgl')).toBe('webgl');
  });

  it('查询串优先于宿主注入，非法值回落到宿主或默认值', () => {
    expect(resolveGpuPreference('?gpu=webgpu', 'webgl')).toBe('webgpu');
    expect(resolveGpuPreference('?gpu=webgl', 'webgpu')).toBe('webgl');
    expect(resolveGpuPreference('', 'webgpu')).toBe('webgpu');
    expect(resolveGpuPreference('', 'webgl')).toBe('webgl');
    for (const bogus of ['?gpu=WEBGPU', '?gpu=', '?gpu=d3d11', '?gpu=%20']) {
      expect(resolveGpuPreference(bogus)).toBe('webgl');
      expect(resolveGpuPreference(bogus, 'webgpu')).toBe('webgpu');
    }
  });
});

describe('渲染线程崩溃的受控重载', () => {
  function fakeLocation(href = 'https://niuma.example/play?park=main&gpu=webgpu') {
    const replaced: string[] = [];
    return {
      href,
      replaced,
      replace: (url: string) => replaced.push(url),
    };
  }

  it('重载地址把后端钉到 webgl，其余查询参数原样保留', () => {
    const href = 'https://niuma.example/play?park=main&zoom=2&gpu=webgpu#seat';
    const url = new URL(renderFatalUrl(href));
    expect(url.pathname).toBe('/play');
    expect(url.searchParams.get('gpu')).toBe('webgl');
    expect(url.searchParams.get('park')).toBe('main');
    expect(url.searchParams.get('zoom')).toBe('2');
    expect(url.hash).toBe('#seat');
  });

  it('首次放行，冷却期内与被用尽后都拦截', () => {
    const storage = memoryStorage();
    const location = fakeLocation();
    expect(reloadForRenderFatal(1_000, { location, storage })).toBe(true);
    expect(location.replaced).toHaveLength(1);
    expect(reloadForRenderFatal(2_000, { location, storage })).toBe(false);
    expect(reloadForRenderFatal(60_000, { location, storage })).toBe(false);
    expect(location.replaced).toHaveLength(1);
  });

  it('地址上已经钉着 webgl 时不再重载：换后端只能试一次', () => {
    const location = fakeLocation('https://niuma.example/play?park=main&gpu=webgl');
    expect(reloadForRenderFatal(1_000, { location, storage: memoryStorage() })).toBe(false);
    expect(location.replaced).toHaveLength(0);
  });

  it('没有 location 时不消耗守卫次数，调用方可以直接退主线程', () => {
    const storage = memoryStorage();
    expect(reloadForRenderFatal(1_000, { location: null, storage })).toBe(false);
    const location = fakeLocation();
    expect(reloadForRenderFatal(1_000, { location, storage })).toBe(true);
  });
});
