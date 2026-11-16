import {
  POSE,
  WORLD_LAYOUT,
  findNearestSeat,
  seatById,
  seatPose,
  type SeatInstance,
  type SeatStateEntry,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * 座位占用的唯一权威：一个座位同一时间只能有一个玩家。
 *
 * 所有变更都在这里完成并返回「变化条目」，由调用方广播；
 * 客户端的本地预测只用于即时反馈，最终以服务端广播为准。
 *
 * 床位与凳子的区别只在 `seatPose`：床位落躺姿、其余落坐姿。
 * 判断「该坐还是该躺」由调用方决定（ACTION.Sit / ACTION.Lie），
 * 本类只负责「找对应种类里最近的空位并占住」。
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
   * 占住一个座位：吸附到锚点、按种类落姿态，并把变化追加到 `out`。
   * 床位与凳子共用这一条路径，姿态只由 `seatPose` 决定。
   *
   * `snap = false` 只占住座位与落姿态，**不动坐标**（ADR-0109）：急救站把伤员
   * 扶上床时，位置由调用方按 Tick 逐帧挪过去，一次式吸附在客户端就是一记瞬移。
   * 占了座不等于占着锚点，调用方必须自己保证最终停在锚点上。
   */
  occupy(
    player: Player,
    seat: SeatInstance,
    now: number,
    out: SeatStateEntry[],
    snap = true,
  ): SeatStateEntry[] {
    this.occupant[seat.id] = player.id;
    player.seat = seat.id;
    if (snap) {
      player.x = seat.x;
      player.y = seat.y;
    }
    player.lastMoveAt = now;
    player.applyState(seat.facing, seatPose(seat.kind), false);
    player.dirty = true;
    player.needsViewRefresh = true;
    out.push({ seatId: seat.id, occupant: player.id });
    return out;
  }

  /**
   * 入座：附近有空闲的**非床**座位则吸附过去，否则就地坐下（保持原有行为）。
   * 返回值是本次占用变化追加到 `out` 之后的同一个数组（无座位可坐时原样返回）。
   *
   * `out` 由调用方提供，是为了让 20Hz 的移动包路径能复用一块 scratch：
   * 移动解算里「起身」绝大多数时候不会发生，但空数组照样是每包一次分配。
   */
  sit(player: Player, now: number, out: SeatStateEntry[] = []): SeatStateEntry[] {
    if (player.seat !== 0) return out;
    const seat = findNearestSeat(player.x, player.y, (id) => this.isFree(id), undefined, (seat) => seat.kind !== 'bed');
    if (!seat) {
      player.applyState(player.direction, POSE.Sit, false);
      player.dirty = true;
      return out;
    }
    return this.occupy(player, seat, now, out);
  }

  /**
   * 躺下：附近有空闲床位则吸附上去并落躺姿，否则就地躺平。
   * 床位是唯一允许「座位上躺姿」的座位种类（ADR-0024 修订 ADR-0020）。
   */
  lie(player: Player, now: number, out: SeatStateEntry[] = []): SeatStateEntry[] {
    if (player.seat !== 0) return out;
    const bed = findNearestSeat(player.x, player.y, (id) => this.isFree(id), undefined, (seat) => seat.kind === 'bed');
    if (!bed) {
      player.applyState(player.direction, POSE.Lie, false);
      player.dirty = true;
      return out;
    }
    return this.occupy(player, bed, now, out);
  }

  /**
   * 释放座位但不改姿态：用于断线与移动时的起身前置步骤。
   *
   * 只清自己名下的占用：刷新时新旧两条连接短暂并存，旧连接迟到的 `onClose`
   * 不能把新连接刚占住的同一张椅子重新标成空位——那样别人会坐进来，
   * 而新玩家本地仍以为自己坐着。
   */
  release(player: Player, out: SeatStateEntry[] = []): SeatStateEntry[] {
    const seatId = player.seat;
    if (seatId === 0) return out;
    player.seat = 0;
    if (seatById(seatId) && this.occupant[seatId] === player.id) {
      this.occupant[seatId] = 0;
      out.push({ seatId, occupant: 0 });
    }
    return out;
  }

  /**
   * 起身：释放座位并回到站立，位置保持在椅子 / 床边。
   *
   * 地面坐 / 躺没有座位可释放，但姿态同样要归零：
   * 否则 ACTION.Stand 只能等下一包 20Hz move 才被远端看到（ADR-0023）。
   */
  stand(player: Player, out: SeatStateEntry[] = []): SeatStateEntry[] {
    this.release(player, out);
    // 已经是站姿就什么都不用做，也避免每包无谓地重打包 state
    if (player.pose === POSE.Idle) return out;
    player.applyState(player.direction, POSE.Idle, false);
    player.dirty = true;
    return out;
  }
}
