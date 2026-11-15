import {
  APARTMENT_OUTSIDE,
  APARTMENT_ROOM_COUNT,
  APARTMENT_SPAWN,
  DIRECTION,
  POSE,
  doorNoOf,
  furnitureById,
  houseTierSpec,
  sanitizePlacements,
  type FurniturePlacement,
  type RoomStatePacket,
} from '@niuma/shared-types';
import type { Player } from './world';

/** 一个房间频道：门牌号 + 房主 + 家具布局 */
export interface RoomRecord {
  slot: number;
  ownerId: number;
  ownerDeviceId: string;
  ownerName: string;
  tier: number;
  placements: FurniturePlacement[];
}

export interface RoomInvite {
  slot: number;
  fromName: string;
  until: number;
}

/** 邀请有效期：两分钟内走到公寓门口就能直接进朋友的屋 */
export const ROOM_INVITE_MS = 120_000;

/**
 * 牛马公寓的房间管理（局部同步的房号来源）。
 *
 * 频道就是 `Player.roomId`（1..6，0 表示在园区）：同频道的玩家互相可见，
 * 跨频道与屋外玩家互不可见。房间坐标全部复用楼内同一个矩形，
 * 移动、AOI、深度排序与相机跟随因此不需要第二套实现。
 */
export class ApartmentRuntime {
  private readonly rooms = new Map<number, RoomRecord>();
  private readonly invites = new Map<number, RoomInvite>();

  /** 进屋：优先接受朋友邀请，否则回自己的房间；6 个频道占满时返回 null */
  enter(player: Player, now: number): RoomRecord | null {
    if (player.roomId !== 0) return null;
    const invite = this.invites.get(player.id);
    const invited = invite && invite.until > now ? this.rooms.get(invite.slot) : undefined;
    const own = this.findOwnRoom(player);
    const room = invited ?? own ?? this.allocate(player);
    if (!room) return null;
    this.invites.delete(player.id);
    player.roomId = room.slot + 1;
    this.teleport(player, APARTMENT_SPAWN);
    return room;
  }

  /** 出屋：回到门口台阶 */
  exit(player: Player): boolean {
    if (player.roomId === 0) return false;
    player.roomId = 0;
    this.teleport(player, APARTMENT_OUTSIDE);
    return true;
  }

  /** 房间里的家具布局：越界与未拥有的家具会被过滤掉 */
  saveLayout(player: Player, raw: ReadonlyArray<FurniturePlacement>): boolean {
    const room = this.roomOf(player);
    if (!room) return false;
    const owned = new Set(player.unlockedCosmetics);
    const allowed = raw.filter((entry) => {
      const sku = furnitureById(entry.id);
      if (!sku) return false;
      if (sku.price <= 0) return true;
      return owned.has(`furn:${sku.id}`);
    });
    room.placements = sanitizePlacements(allowed, room.tier);
    return true;
  }

  /** 邀请朋友：记一条带 TTL 的票据，对方在门口按 F 就会进这间屋 */
  invite(from: Player, targetId: number, now: number): RoomRecord | null {
    const room = this.roomOf(from);
    if (!room) return null;
    if (targetId === from.id) return null;
    this.invites.set(targetId, { slot: room.slot, fromName: from.name, until: now + ROOM_INVITE_MS });
    return room;
  }

  roomOf(player: Player): RoomRecord | undefined {
    if (player.roomId === 0) return undefined;
    return this.rooms.get(player.roomId - 1);
  }

  /** 房间状态包：同频道共用一份，访客也能看到房主的家具 */
  stateFor(player: Player): RoomStatePacket | null {
    const room = this.roomOf(player);
    if (!room) return null;
    return {
      doorNo: doorNoOf(room.slot),
      ownerId: room.ownerId,
      ownerName: room.ownerName,
      tier: room.tier,
      placements: room.placements,
    };
  }

  /** 房主升级后把房号对应的档位同步过去（家具超额的由前端重新摆） */
  syncTier(player: Player): boolean {
    const room = this.findOwnRoom(player);
    if (!room) return false;
    room.tier = player.houseTier;
    room.placements = sanitizePlacements(room.placements, room.tier);
    return true;
  }

  /** 断线：释放频道，让后来的人能用到这间屋 */
  leave(playerId: number, deviceId: string): void {
    this.invites.delete(playerId);
    for (const [slot, room] of this.rooms) {
      if (room.ownerDeviceId !== deviceId) continue;
      room.ownerId = 0;
      // 屋主离开就把频道腾出来：房间是「本运行周期」的临时空间，不是永久房产
      this.rooms.delete(slot);
    }
  }

  /** 房主改名：门牌上的名字跟着换 */
  rename(player: Player): boolean {
    const room = this.findOwnRoom(player);
    if (!room || room.ownerName === player.name) return false;
    room.ownerName = player.name;
    return true;
  }

  private findOwnRoom(player: Player): RoomRecord | undefined {
    if (!player.deviceId) return undefined;
    for (const room of this.rooms.values()) {
      if (room.ownerDeviceId === player.deviceId) return room;
    }
    return undefined;
  }

  private allocate(player: Player): RoomRecord | null {
    for (let slot = 0; slot < APARTMENT_ROOM_COUNT; slot += 1) {
      if (this.rooms.has(slot)) continue;
      const room: RoomRecord = {
        slot,
        ownerId: player.id,
        ownerDeviceId: player.deviceId,
        ownerName: player.name,
        tier: player.houseTier,
        placements: [],
      };
      this.rooms.set(slot, room);
      return room;
    }
    return null;
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

/** 家具槽位上限：给 UI 的提示与「还能摆几件」共用 */
export function roomSlotLimit(tier: number): number {
  return houseTierSpec(tier).slots;
}
