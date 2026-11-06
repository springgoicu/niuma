import {
  POSE,
  WORLD_LAYOUT,
  findNearestSeat,
  seatById,
  type SeatStateEntry,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * 座位占用的唯一权威：一个座位同一时间只能有一个玩家。
 *
 * 所有变更都在这里完成并返回「变化条目」，由调用方广播；
 * 客户端的本地预测只用于即时反馈，最终以服务端广播为准。
 */
export class SeatRegistry {
  /** seatId → 占用者的玩家 id，0 表示空闲；下标 0 不用 */
  private readonly occupant: Uint16Array;

  constructor(seatCount: number = WORLD_LAYOUT.seats.length) {
    this.occupant = new Uint16Array(seatCount + 1);
  }

  isFree(seatId: number): boolean {
    return this.occupant[seatId] === 0;
  }

  /** 当前所有已占用座位的快照：新玩家入场时一次性下发 */
  snapshot(): SeatStateEntry[] {
    const entries: SeatStateEntry[] = [];
    for (let seatId = 1; seatId < this.occupant.length; seatId += 1) {
      const occupant = this.occupant[seatId]!;
      if (occupant !== 0) entries.push({ seatId, occupant });
    }
    return entries;
  }

  /**
   * 入座：附近有空闲座位则吸附到座位锚点并面朝座位；否则就地坐下（保持原有行为）。
   * 返回本次占用变化（无座位可坐时为空数组）。
   */
  sit(player: Player, now: number): SeatStateEntry[] {
    if (player.seat !== 0) return [];
    const seat = findNearestSeat(player.x, player.y, (id) => this.isFree(id));
    if (!seat) {
      player.applyState(player.direction, POSE.Sit, false);
      player.dirty = true;
      return [];
    }
    this.occupant[seat.id] = player.id;
    player.seat = seat.id;
    player.x = seat.x;
    player.y = seat.y;
    player.lastMoveAt = now;
    player.direction = seat.facing;
    player.applyState(seat.facing, POSE.Sit, false);
    player.dirty = true;
    player.needsViewRefresh = true;
    return [{ seatId: seat.id, occupant: player.id }];
  }

  /** 释放座位但不改姿态：用于断线与移动时的起身前置步骤 */
  release(player: Player): SeatStateEntry[] {
    const seatId = player.seat;
    if (seatId === 0) return [];
    player.seat = 0;
    if (seatById(seatId)) this.occupant[seatId] = 0;
    return [{ seatId, occupant: 0 }];
  }

  /** 起身：释放座位并回到站立，位置保持在椅子旁 */
  stand(player: Player): SeatStateEntry[] {
    const changes = this.release(player);
    if (changes.length === 0) return changes;
    player.applyState(player.direction, POSE.Idle, false);
    player.dirty = true;
    return changes;
  }
}
