import {
  WALLET_REASON,
  VILLA_SPECS,
  VILLA_TREE_RANGE,
  isNearVillaGate,
  isNearVillaTree,
  truncateVillaTagline,
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
  /** 主题色：0 暖阳金 / 1 霓虹粉 / 2 翡翠森 */
  theme?: number;
  /** 房产自定义灯牌宣言（最多 12 字） */
  tagline?: string;
  /** 最近在线时刻（供超 7 天无人打理自动收回挂牌） */
  lastOnlineAt?: number;
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
  private readonly onlineScratch = new Map<string, Player>();
  private readonly ownerDevices = new Set<string>();
  private readonly lastPendingByDevice = new Map<string, number>();

  constructor(private readonly ports: VillaPorts) {}

  private rebuildOwnerDevices(): void {
    this.ownerDevices.clear();
    for (const record of this.records.values()) {
      if (record.ownerDeviceId) this.ownerDevices.add(record.ownerDeviceId);
    }
  }

  /** 是否名下拥有至少一处房产（O(1) Set lookup） */
  ownsAny(deviceId: string): boolean {
    return deviceId !== '' && this.ownerDevices.has(deviceId);
  }

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
      lastOnlineAt: now,
    });
    if (prevOwnerDeviceId) this.lastPendingByDevice.delete(prevOwnerDeviceId);
    this.lastPendingByDevice.delete(player.deviceId);
    this.rebuildOwnerDevices();
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

  /** 房主自定义灯牌主题色与公告宣言（Stage 2） */
  customize(player: Player, id: number, theme: number, tagline: string): boolean {
    const record = this.records.get(id);
    if (!record || record.ownerDeviceId !== player.deviceId) return false;
    const safeTheme = Number.isFinite(theme) ? Math.max(0, Math.min(2, Math.floor(theme))) : 0;
    const safeTagline = truncateVillaTagline(tagline ?? '');
    if (safeTheme === 0) delete record.theme;
    else record.theme = safeTheme;
    if (safeTagline === '') delete record.tagline;
    else record.tagline = safeTagline;
    return true;
  }

  /** 超过 maxOfflineMs（默认 7 天）无人打理的空置房产自动收回重挂 */
  reclaimStale(now: number, maxOfflineMs = 7 * 24 * 3600 * 1000): number {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.ownerId !== 0) continue;
      const last = record.lastOnlineAt ?? record.lastCollectAt;
      if (last > 0 && now - last >= maxOfflineMs) {
        this.records.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.rebuildOwnerDevices();
    return removed;
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
    this.lastPendingByDevice.delete(player.deviceId);
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

  /** 公共观光快照：所有旁观者共享同一份 `mine=false / pending=0` 结果，一次编码广播多人 */
  publicSnapshot(): VillaStatePacket {
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
      return {
        id: spec.id,
        ownerId: record.ownerId,
        ownerName: record.ownerName,
        locked: record.locked,
        owned: true,
        mine: false,
        pending: 0,
        ...(record.theme !== undefined ? { theme: record.theme } : {}),
        ...(record.tagline !== undefined ? { tagline: record.tagline } : {}),
      };
    });
    return { villas };
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
        ...(record.theme !== undefined ? { theme: record.theme } : {}),
        ...(record.tagline !== undefined ? { tagline: record.tagline } : {}),
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
    this.lastPendingByDevice.clear();
    if (state) {
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
          ...(typeof record.theme === 'number' && record.theme > 0 ? { theme: Math.min(2, Math.floor(record.theme)) } : {}),
          ...(typeof record.tagline === 'string' && record.tagline.length > 0 ? { tagline: truncateVillaTagline(record.tagline) } : {}),
          ...(typeof record.lastOnlineAt === 'number' && Number.isFinite(record.lastOnlineAt) ? { lastOnlineAt: Math.floor(record.lastOnlineAt) } : {}),
        });
      }
    }
    this.rebuildOwnerDevices();
  }

  /** 事件驱动：房主上线只扫至多 8 条记录，O(1) 返回是否改变了在线指示灯或房主名 */
  onOwnerJoin(player: Player, now = Date.now()): boolean {
    if (!this.ownsAny(player.deviceId)) return false;
    this.lastPendingByDevice.delete(player.deviceId);
    let changed = false;
    for (const record of this.records.values()) {
      if (record.ownerDeviceId !== player.deviceId) continue;
      record.lastOnlineAt = now;
      if (record.ownerId !== player.id || record.ownerName !== player.name) {
        record.ownerId = player.id;
        record.ownerName = player.name;
        changed = true;
      }
    }
    return changed;
  }

  /** 事件驱动：房主改名同步牌匾昵称 */
  onOwnerRename(player: Player): boolean {
    if (!this.ownsAny(player.deviceId)) return false;
    let changed = false;
    for (const record of this.records.values()) {
      if (record.ownerDeviceId !== player.deviceId) continue;
      if (record.ownerName !== player.name) {
        record.ownerName = player.name;
        changed = true;
      }
    }
    return changed;
  }

  /** 事件驱动：房主离园置零在线标志并清掉个人 pending 缓存 */
  onOwnerLeave(player: Player, now = Date.now()): boolean {
    if (!this.ownsAny(player.deviceId)) return false;
    this.lastPendingByDevice.delete(player.deviceId);
    let changed = false;
    for (const record of this.records.values()) {
      if (record.ownerId !== player.id) continue;
      record.ownerId = 0;
      record.lastOnlineAt = now;
      changed = true;
    }
    return changed;
  }

  /**
   * 仅当在线房主名下的摇钱树待领总额跨越整分钟变化时定向推送给该房主本人；
   * 非房主零遍历、稳态零广播、零临时对象。
   */
  collectPendingUpdates(
    players: Iterable<Player>,
    now: number,
    notify: (owner: Player, packet: VillaStatePacket) => void,
  ): void {
    if (this.records.size === 0 || this.ownerDevices.size === 0) return;
    for (const player of players) {
      if (player.wsId === 0 || !this.ownerDevices.has(player.deviceId)) continue;
      let total = 0;
      for (const spec of VILLA_SPECS) {
        const record = this.records.get(spec.id);
        if (record && record.ownerDeviceId === player.deviceId) {
          total += Math.min(0xffff, villaPendingIncome(record.lastCollectAt, now, spec.income));
        }
      }
      if (this.lastPendingByDevice.get(player.deviceId) === total) continue;
      this.lastPendingByDevice.set(player.deviceId, total);
      notify(player, this.snapshotFor(player, now));
    }
  }

  /**
   * 兼容批量对齐入口：复用 onlineScratch，零记录时直接 O(1) 早退。
   */
  refreshOwners(players: Iterable<Player>): boolean {
    if (this.records.size === 0) return false;
    this.onlineScratch.clear();
    for (const player of players) {
      if (player.deviceId) this.onlineScratch.set(player.deviceId, player);
    }
    let changed = false;
    for (const record of this.records.values()) {
      const player = this.onlineScratch.get(record.ownerDeviceId);
      const nextId = player ? player.id : 0;
      const nextName = player ? player.name : record.ownerName;
      if (record.ownerId !== nextId || record.ownerName !== nextName) {
        record.ownerId = nextId;
        record.ownerName = nextName;
        changed = true;
      }
    }
    this.onlineScratch.clear();
    return changed;
  }
}
