import { sfx } from '../sfx';
import type { AudioEvent } from './engine-env';

/**
 * 引擎发声请求的唯一落地点。
 *
 * 主线程回退模式直接在同一个调用栈里执行；Worker 模式下经一条
 * `audio` 消息送回来再执行。两条路径共用这一个函数，声音的声像、
 * 衰减与节流规则就只有一份实现。
 */
export function applyAudioEvent(event: AudioEvent, listenerX: number, listenerY: number): void {
  // 听者坐标随事件一起到达：Worker 每帧都在动，主线程没有别的同步来源
  sfx.setListener(listenerX, listenerY);
  switch (event.kind) {
    case 'vent':
      sfx.playVentImpactSound(event.x, event.y, event.hit, event.local);
      return;
    case 'interact':
      sfx.interact(event.target, event.x, event.y);
      return;
    case 'chew':
      if (event.local) sfx.chew(event.x, event.y);
      else sfx.chewRemote(event.x, event.y);
      return;
  }
}
