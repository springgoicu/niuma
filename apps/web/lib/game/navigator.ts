import type { PathPoint } from './pathfinding';

/**
 * 自动寻路只依赖「名字 + 落点」，不认场所表。
 *
 * 这样「回中央广场」这种非场所目标也能复用同一台状态机；
 * `NavTarget` 结构上满足本接口，导览卡那边不需要任何转换。
 */
export interface NavGoal {
  readonly id?: string;
  readonly name: string;
  readonly arrive: { readonly x: number; readonly y: number };
}

/**
 * 自动寻路的路点推进状态机（ADR-0040）。
 *
 * 只持有路径与目标，不碰渲染、不碰网络；每个方向向量写进调用方的复用槽位，
 * 帧循环里不产生分配。卡死判定看「实际位移」而不是「到终点距离」——
 * A* 路径本来就可能先远离目标，用距离判断会把正常绕路误杀。
 */

/** 到这个距离内就切下一个路点 */
const WAYPOINT_RADIUS = 10;
/** 到这个距离内算到达最终落点 */
const ARRIVE_RADIUS = 12;
/** 连续这么久没有任何实际位移就判定卡死 */
const STUCK_MS = 700;

export type SteerResult = 'move' | 'arrived';
export type ObserveResult = 'ok' | 'stuck';

export class Navigator {
  private path: readonly PathPoint[] = [];
  private cursor = 0;
  private current: NavGoal | null = null;
  private arriveX = 0;
  private arriveY = 0;
  private lastX = 0;
  private lastY = 0;
  private hasLast = false;
  private stillMs = 0;

  get active(): boolean {
    return this.current !== null;
  }

  get target(): NavGoal | null {
    return this.current;
  }

  /** 开始一段新导航：替换旧目标，路点从头推进 */
  start(path: readonly PathPoint[], target: NavGoal): void {
    this.path = path;
    this.cursor = 0;
    this.current = target;
    this.arriveX = target.arrive.x;
    this.arriveY = target.arrive.y;
    this.hasLast = false;
    this.stillMs = 0;
  }

  /** 幂等取消：没有在导航时直接返回，避免摇杆每帧触发状态更新 */
  cancel(): void {
    this.path = [];
    this.cursor = 0;
    this.current = null;
    this.hasLast = false;
    this.stillMs = 0;
  }

  /**
   * 写入当前应走的方向（单位向量）；到达落点时清零并返回 `arrived`。
   * `out` 由调用方复用，这里不新建对象。
   */
  steer(x: number, y: number, out: { x: number; y: number }): SteerResult {
    if (!this.current) {
      out.x = 0;
      out.y = 0;
      return 'arrived';
    }

    const arriveDx = this.arriveX - x;
    const arriveDy = this.arriveY - y;
    if (arriveDx * arriveDx + arriveDy * arriveDy <= ARRIVE_RADIUS * ARRIVE_RADIUS) {
      out.x = 0;
      out.y = 0;
      return 'arrived';
    }

    while (this.cursor < this.path.length) {
      const point = this.path[this.cursor]!;
      const dx = point.x - x;
      const dy = point.y - y;
      if (dx * dx + dy * dy > WAYPOINT_RADIUS * WAYPOINT_RADIUS) {
        const length = Math.hypot(dx, dy);
        out.x = dx / length;
        out.y = dy / length;
        return 'move';
      }
      this.cursor += 1;
    }

    // 路点走完仍有偏差：最后一段直接朝落点，不再受网格限制
    const length = Math.hypot(arriveDx, arriveDy);
    if (length <= 0.001) {
      out.x = 0;
      out.y = 0;
      return 'arrived';
    }
    out.x = arriveDx / length;
    out.y = arriveDy / length;
    return 'move';
  }

  /** 每帧喂一次当前位置：连续 700ms 原地不动就返回 `stuck` */
  observe(dtMs: number, x: number, y: number): ObserveResult {
    if (!this.current) return 'ok';
    if (!this.hasLast) {
      this.lastX = x;
      this.lastY = y;
      this.hasLast = true;
      this.stillMs = 0;
      return 'ok';
    }
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    if (dx * dx + dy * dy > 0.01) {
      this.stillMs = 0;
      return 'ok';
    }
    this.stillMs += dtMs;
    return this.stillMs >= STUCK_MS ? 'stuck' : 'ok';
  }
}
