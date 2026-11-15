/**
 * 入座类玩法的共享判定（ADR-0093）。
 *
 * 赌桌公共局、八角笼观战押注、工位搬砖都是「坐在对应座位上才能参与」的玩法，
 * 三处服务端校验与三处客户端提示必须用同一把尺，否则会出现
 * 「提示说能押、发过去被拒」或「界面不给按、服务端其实放行」。
 *
 * 判定数据全部来自既有结构，不新增座位字段：
 * - 热区声明 `seatGroupId`（赌桌 `dice-a` / `dice-b`、观战长椅 `arena-bench`）
 *   与 `SeatInstance.group` 比对；
 * - 工位热区声明 `deskIndex`，与 `workDeskIndexOfSeat` 比对（工位椅 id 区间钉死在
 *   `layout.ts`，不另加字段以免弄乱 `niuma:session:v1` 的旧档语义）。
 *
 * 服务端传 `player.seat`、客户端传本地座位镜像，`0` 一律表示未入座。
 */

import type { HotspotDef } from './hotspots';
import { seatById, workDeskIndexOfSeat } from './layout';

/** 座位是否属于某个座位组；seatId 为 0 或越界时返回 false */
export function seatInGroup(seatId: number, group: string): boolean {
  if (!Number.isInteger(seatId) || seatId <= 0) return false;
  return seatById(seatId)?.group === group;
}

/** 热区是否带座位门槛（赌桌 / 观战长椅 / 工位）；不带门槛的热区随处可按 */
export function hotspotRequiresSeat(def: HotspotDef): boolean {
  return def.seatGroupId !== undefined || def.deskIndex !== undefined;
}

/**
 * 当前座位是否满足热区声明的座位门槛。
 *
 * 无门槛的热区恒为 `true`（不参与入座玩法）；有门槛但没坐下 / 坐错座位一律 `false`。
 */
export function seatMatchesHotspot(def: HotspotDef, seatId: number): boolean {
  if (def.deskIndex !== undefined) return workDeskIndexOfSeat(seatId) === def.deskIndex;
  if (def.seatGroupId === undefined) return true;
  return seatInGroup(seatId, def.seatGroupId);
}
