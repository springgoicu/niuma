import {
  WALLET_REASON,
  VILLA_SPECS,
  VILLA_TREE_RANGE,
  isNearVillaGate,
  isNearVillaTree,
  villaBuyPrice,
  villaBuyoutRefund,
  villaDoorSolid,
  villaPendingIncome,
  type VillaPacket,
  type VillaSpec,
  type VillaStatePacket,
  type WorldRect,
} from '@niuma/shared-types';
import type { Player } from './world';

/** 经济端口：扣款、发币与溢价收购退赔前房主 */
export interface VillaPorts {
  spend: (player: Player, amount: number, reason: number) => boolean;
  grant: (player: Player, amount: number, reason: number) => void;
  /** 将补偿打入前任房主（在线或离线档案均可） */
  creditOwner?: (deviceId: string, amount: number, reason: number) => void;
}

export interface VillaRecord {
  id: number;
  ownerDeviceId: string;
  ownerName: string;
  /** 房主当前在线实体 id；离线为 0，用于「牌匾是不是我」与广播定位 */
  ownerId: number;
  locked: boolean;
  /** 上次结算时刻：pending 按完整分钟从这里往后算 */
  lastCollectAt: number;
}

export interface VillaSaveState {
  villas: VillaRecord[];
}

export type VillaBuyOutcome =
  | {
      ok: true;
      spec: VillaSpec;
      price: number;
      buyout: boolean;
      refund: number;
      prevOwnerName: string;
      prevOwnerDeviceId: string;
    }
  | { ok: false; reason: 'invalid' | 'far' | 'alreadyMine' | 'coins' };

/**
 * 园区房产（8 栋分阶产业，ADR-0087 扩展版）：
 *
 * - 支持无主原价冠名与 **1.5× 溢价收购**他人已冠名房产；
 * - 被收购的原房主自动拿到 1.2× 溢价赔偿 + 未收完的摇钱树零钱；
 * - 所有权按 `deviceId` 记（重连换新 Player 实体，设备号不变）。
 */
export class VillaRuntime {
  private readonly records = new Map<number, VillaRecord>();

  constructor(private readonly ports: VillaPorts) {}

  record(id: number): VillaRecord | undefined {
    return this.records.get(id);
  }

  /** 房主是否在线 */
  ownerOnline(id: number): boolean {
    return (this.records.get(id)?.ownerId ?? 0) !== 0;
  }

  /**
   * 买下无主房产或 1.5× 溢价收购他人房产。
   * 自己已拥有的房产不可重复购买；接管时自动解锁并清空累积计息起点。
   */
  buyResult(player: Player, id: number, now: number): VillaBuyOutcome {
    const spec = VILLA_SPECS.find((entry) => entry.id === id);
    if (!spec) return { ok: false, reason: 'invalid' };
    const existing = this.records.get(id);
    if (existing && existing.ownerDeviceId === player.deviceId) {
      return { ok: false, reason: 'alreadyMine' };
    }
    if (!isNearVillaGate(spec, player.x, player.y)) return { ok: false, reason: 'far' };

    const buyout = Boolean(existing);
    const price = villaBuyPrice(spec, buyout);
    if (!this.ports.spend(player, price, WALLET_REASON.VillaBuy)) {
      return { ok: false, reason: 'coins' };
    }

    let refund = 0;
    let prevOwnerName = '';
    let prevOwnerDeviceId = '';
    if (existing) {
      const pending = villaPendingIncome(existing.lastCollectAt, now, spec.income);
      refund = villaBuyoutRefund(spec) + pending;
      prevOwnerName = existing.ownerName;
      prevOwnerDeviceId = existing.ownerDeviceId;
      if (prevOwnerDeviceId && refund > 0) {
        this.ports.creditOwner?.(prevOwnerDeviceId, refund, WALLET_REASON.VillaBuyout);
      }
    }

    this.records.set(id, {
      id,
      ownerDeviceId: player.deviceId,
      ownerName: player.name,
      ownerId: player.id,
      locked: false,
      lastCollectAt: now,
    });
    return { ok: true, spec, price, buyout, refund, prevOwnerName, prevOwnerDeviceId };
  }

  /** 布尔便捷入口：供只关心成败的测试使用 */
  buy(player: Player, id: number, now: number): boolean {
    return this.buyResult(player, id, now).ok;
  }

  /** 锁门开关：只有房主本人（同设备号）能切 */
  toggleLock(player: Player, id: number): boolean {
    const record = this.records.get(id);
    if (!record || record.ownerDeviceId !== player.deviceId) return false;
    record.locked = !record.locked;
    return true;
  }

  /** 收走摇钱树产出：房主 + 站在院内 + 有完整分钟的产出 */
  collect(player: Player, id: number, now: number): number {
    const spec = VILLA_SPECS.find((entry) => entry.id === id);
    const record = this.records.get(id);
    if (!spec || !record || record.ownerDeviceId !== player.deviceId) return 0;
    if (!isNearVillaTree(spec, player.x, player.y, VILLA_TREE_RANGE + 24)) return 0;
    const pending = villaPendingIncome(record.lastCollectAt, now, spec.income);
    if (pending <= 0) return 0;
    record.lastCollectAt = now;
    this.ports.grant(player, pending, WALLET_REASON.VillaIncome);
    return pending;
  }

  /** 锁门时的动态门栅：交给碰撞层与客户端预测共用 */
  lockedSolids(): WorldRect[] {
    const out: WorldRect[] = [];
    for (const spec of VILLA_SPECS) {
      const record = this.records.get(spec.id);
      if (!record) continue;
      const solid = villaDoorSolid(spec, record.locked);
      if (solid) out.push({ x: solid.x, y: solid.y, w: solid.w, h: solid.h });
    }
    return out;
  }

  /** 下行快照：房主自己看得到可收币数，其他人读到 0 */
  snapshotFor(viewer: Player, now: number): VillaStatePacket {
    const villas: VillaPacket[] = VILLA_SPECS.map((spec) => {
      const record = this.records.get(spec.id);
      if (!record) {
        return {
          id: spec.id,
          ownerId: 0,
          ownerName: '',
          locked: false,
          owned: false,
          mine: false,
          pending: 0,
        };
      }
      const mine = record.ownerDeviceId === viewer.deviceId;
      return {
        id: spec.id,
        ownerId: record.ownerId,
        ownerName: record.ownerName,
        locked: record.locked,
        // 离线房主也算已拥有：ownerId 归零只表示他不在线，不表示房产重新挂牌
        owned: true,
        mine,
        pending: mine ? Math.min(0xffff, villaPendingIncome(record.lastCollectAt, now, spec.income)) : 0,
      };
    });
    return { villas };
  }

  /** 落盘：只存冠名权与锁状态，产出用时间戳推导 */
  snapshotForSave(): VillaSaveState {
    return { villas: [...this.records.values()].map((record) => ({ ...record })) };
  }

  restore(state: VillaSaveState | undefined, now = 0): void {
    this.records.clear();
    if (!state) return;
    for (const record of state.villas) {
      if (!record || !Number.isFinite(record.id)) continue;
      if (!VILLA_SPECS.some((spec) => spec.id === record.id)) continue;
      this.records.set(record.id, {
        id: record.id,
        ownerDeviceId: typeof record.ownerDeviceId === 'string' ? record.ownerDeviceId : '',
        ownerName: typeof record.ownerName === 'string' ? record.ownerName.slice(0, 24) : '',
        ownerId: 0,
        locked: record.locked === true,
        lastCollectAt: Number.isFinite(record.lastCollectAt) ? Math.floor(record.lastCollectAt) : now,
      });
    }
  }

  /**
   * 在线房主的名字与实体 id 跟着人走：
   * 改名后牌匾换字，重连 / 离线后 ownerId 归零（牌匾仍显示旧名字）。
   */
  refreshOwners(players: Iterable<Player>): boolean {
    const online = new Map<string, Player>();
    for (const player of players) {
      if (player.deviceId) online.set(player.deviceId, player);
    }
    let changed = false;
    for (const record of this.records.values()) {
      const player = online.get(record.ownerDeviceId);
      const nextId = player ? player.id : 0;
      const nextName = player ? player.name : record.ownerName;
      if (record.ownerId !== nextId || record.ownerName !== nextName) {
        record.ownerId = nextId;
        record.ownerName = nextName;
        changed = true;
      }
    }
    return changed;
  }
}
