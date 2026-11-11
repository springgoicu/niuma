/**
 * 上行移动包的发包门槛。
 *
 * 服务端只在「量化坐标 + state」三元组变化时才广播，所以发得勤不等于别人看得见：
 * 坐在工位上 20Hz 空发 30 分钟，对别人一帧都没变，白烧的是上行带宽、服务端解析与 GC。
 *
 * 但这个门槛不能简单做成「变了才发」：叠加动作（叫唤 / 跳 / 挥手）的结束只体现在
 * state 的某一位从 1 掉到 0，而远端没有自己的过期计时器（`applyOverlayBit` 只认包里的位）。
 * 因此「变了」必须包含 state 的位变化，并且这类变化要尽快放行。
 */

/** 走动时的上行上限：20Hz，与服务端 Tick 同频 */
export const MOVE_SEND_INTERVAL_MS = 50;
/** 静止时的保活间隔：4Hz，足以维持 lastMoveAt 与服务端的心跳判断 */
export const MOVE_IDLE_INTERVAL_MS = 250;
/** 「还没发过」的哨兵：量化坐标与 state 都非负，-1 不会撞上真实值 */
export const NEVER_SENT = -1;

/** 上一次真正发出去的三元组；调用方复用同一个对象，避免每帧分配 */
export interface MoveSample {
  x: number;
  y: number;
  state: number;
}

/**
 * 这一帧该不该发移动包。
 *
 * - 首次发言必发；
 * - 三元组变了：变化本身要尽快让观察者看到，但不超过 20Hz；
 * - 三元组没变：降到 `MOVE_IDLE_INTERVAL_MS` 的保活。
 *
 * 判定用的是「上次真正发出去的值」而不是「上一帧算出来的值」：
 * 只有真正发出后才更新基准，所以攒着没发的变化不会被吞掉。
 */
export function shouldSendMove(
  last: MoveSample,
  x: number,
  y: number,
  state: number,
  sinceLastMs: number,
): boolean {
  if (last.x === NEVER_SENT) return true;
  if (last.x !== x || last.y !== y || last.state !== state) {
    return sinceLastMs >= MOVE_SEND_INTERVAL_MS;
  }
  return sinceLastMs >= MOVE_IDLE_INTERVAL_MS;
}
