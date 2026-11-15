import {
  APARTMENT_WINDOW_COUNT,
  DIRECTION,
  POSE,
  apartmentBySlot,
  apartmentWindowAt,
  type ApartmentPeekEntry,
} from '@niuma/shared-types';
import type { Player } from './world';

/** 一个探头位置：哪栋楼、哪个窗口 */
export interface WindowSeat {
  slot: number;
  window: number;
}

/**
 * 牛马公寓的窗口占用（ADR-0098）。
 *
 * 进屋 = 人从园区挪到这栋楼的一个空闲窗口探头，出门 = 回到门口台阶。
 * 楼里没有可走的空间，所以这里只维护一张「谁占了哪个窗口」的表：
 * 每栋 4×5 = 20 个窗口，一窗一人，占满就拒客。
 *
 * 这是本运行周期的临时态，不落盘：断线即释放（与旧的房间频道一致）。
 */
export class ApartmentRuntime {
  /** slot → 20 个窗口的占用者 id，0 表示空窗 */
  private readonly windows = new Map<number, number[]>();
  /** 反向索引：playerId → { slot, window }，出门与断线 O(1) 释放 */
  private readonly seats = new Map<number, WindowSeat>();

  /**
   * 进屋探头：占这栋楼第一个空窗。
   *
   * 已经有人在里面、或该栋 20 个窗口全满时返回 null（调用方提示「窗口都住满了」）。
   */
  enter(player: Player, slot: number): WindowSeat | null {
    if (player.roomId !== 0) return null;
    const spec = apartmentBySlot(slot);
    const free = this.freeWindowOf(spec.slot);
    if (free < 0) return null;
    this.windows.get(spec.slot)![free] = player.id;
    const seat: WindowSeat = { slot: spec.slot, window: free };
    this.seats.set(player.id, seat);
    player.roomId = spec.slot + 1;
    // 停在门口台阶：位置确定、相机不跳，头由客户端画到这栋楼的窗口上
    this.teleport(player, spec.outside);
    return seat;
  }

  /** 出门：释放窗口并回到自己那栋楼的门口台阶 */
  exit(player: Player): boolean {
    const seat = this.seats.get(player.id);
    if (!seat) return false;
    const spec = apartmentBySlot(seat.slot);
    this.releaseWindow(seat, player.id);
    this.seats.delete(player.id);
    player.roomId = 0;
    this.teleport(player, spec.outside);
    return true;
  }

  /** 断线：窗口立刻释放，别让后来的人对着空窗按 F 被拒 */
  leave(playerId: number): boolean {
    const seat = this.seats.get(playerId);
    if (!seat) return false;
    this.releaseWindow(seat, playerId);
    this.seats.delete(playerId);
    return true;
  }

  /** 全量快照：谁在哪栋哪个窗口 */
  snapshot(): ApartmentPeekEntry[] {
    const out: ApartmentPeekEntry[] = [];
    for (const [id, seat] of this.seats) {
      out.push({ id, slot: seat.slot, window: seat.window });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /** 某人的窗口位置；没进屋返回 undefined（UI 与测试用） */
  seatOf(playerId: number): WindowSeat | undefined {
    return this.seats.get(playerId);
  }

  private freeWindowOf(slot: number): number {
    let row = this.windows.get(slot);
    if (!row) {
      row = new Array<number>(APARTMENT_WINDOW_COUNT).fill(0);
      this.windows.set(slot, row);
    }
    return row.indexOf(0);
  }

  private releaseWindow(seat: WindowSeat, playerId: number): void {
    const row = this.windows.get(seat.slot);
    if (!row) return;
    if (apartmentWindowAt(seat.slot, seat.window) === undefined) return;
    if (row[seat.window] === playerId) row[seat.window] = 0;
  }

  private teleport(player: Player, target: { x: number; y: number }): void {
    player.x = target.x;
    player.y = target.y;
    player.seat = 0;
    player.stunUntil = 0;
    player.vent = false;
    player.ventPending = false;
    player.applyState(DIRECTION.Down, POSE.Idle, false);
    player.dirty = true;
    player.needsViewRefresh = true;
  }
}
