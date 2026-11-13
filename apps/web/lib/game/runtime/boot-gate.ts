import type { WorkerToMain } from './worker-protocol';

/**
 * 渲染线程启动闸门的判定结果：
 * - `progress`：Worker 活着，但渲染器还没就绪；
 * - `alive`：启动成功，可以开始接管输入与尺寸；
 * - `failed`：启动失败，应销毁 Worker 并回退主线程。
 */
export type BootVerdict = 'progress' | 'alive' | 'failed';

/**
 * 判断一条来自渲染线程的消息把启动推进到哪一步。
 *
 * 关键坑：`GameSession.start()` 在 `await renderer.init()` **之前**就同步发
 * `status: 'connecting'`。把它当成功会让初始化失败只能以红条收场，永远走不到
 * `fallbackToMain()`。所以 `connecting` 只算 progress；`ready` 与初始化之后才会
 * 产生的业务消息才算 alive。
 */
export function classifyBootMessage(message: WorkerToMain): BootVerdict {
  if (message.t === 'ready') return 'alive';
  if (message.t === 'status') {
    if (message.status === 'error') return 'failed';
    if (message.status === 'connecting') return 'progress';
  }
  // 其余业务消息（排队、聊天、统计……）都发生在会话启动成功之后
  return 'alive';
}
