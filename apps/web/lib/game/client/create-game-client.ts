import { pickRenderMode } from '../runtime/render-mode';
import type { GameClient, GameClientOptions } from './game-client';

/**
 * 按环境选择宿主。
 *
 * 两个实现分别动态加载：Worker 模式主线程完全不碰 pixi（首屏 JS 少一份），
 * 回退模式才把引擎拉进主线程 bundle。
 */
export async function createGameClient(options: GameClientOptions): Promise<GameClient> {
  const mode = pickRenderMode(options.search);
  if (mode === 'worker') {
    try {
      const { WorkerGameClient } = await import('./worker-client');
      return new WorkerGameClient(options);
    } catch (error) {
      // chunk 加载失败（离线缓存缺片、代理拦了 worker 脚本）时还能退回主线程
      console.warn('[game] 渲染线程不可用，回退主线程渲染', error);
    }
  }
  const { MainThreadGameClient } = await import('./main-thread-client');
  return new MainThreadGameClient(options);
}
