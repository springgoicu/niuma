import { BOSS_MAX_HP, isDeviceId } from '@niuma/shared-types';
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BossSaveState } from '../sim/boss';
import type { VillaSaveState } from '../sim/villas';
import type { WalletSaveState } from '../economy/wallet';
import { ProfileBook, type ProfileRecord } from './profiles';

/**
 * 园区共享运行态快照（ADR-0081 / ADR-0104）。
 *
 * 落盘范围：老板血量与回满点、园区 8 处房产冠名、匿名档案里的
 * 赞与名次，以及按匿名设备号的钱包账本。玩家会话、聊天、考勤仍不进这里。
 *
 * 写盘纪律：
 * - 变更只打 `markDirty()`，1s 级防抖合并，绝不在 50ms 帧循环里同步写盘；
 * - 临时文件 + rename 保证读者要么看到旧档、要么看到新档，不会看到「写了一半」；
 * - 每次覆盖前把上一份主档留成 `.bak`，主档读坏时先试备份；
 * - 坏档改名 `.bad-<时刻>` 后空档开服，园区宁可回满血也不许因为存档崩掉；
 * - 写失败只告警并把 dirty 立回来，下个窗口重试。
 */

/** 版本 3：追加服务端钱包账本（`wallets`，ADR-0104） */
export const WORLD_STATE_VERSION_V3 = 3;
/** 版本 4：曾经的赌桌战绩版本（读取时平滑迁移） */
export const WORLD_STATE_VERSION_V4 = 4;
/** 版本 5：移除擂台/赌桌，支持 8 处房产冠名与街头金币体系 */
export const WORLD_STATE_VERSION = 5;
/** 兼容读取的旧版本号：v1 无房产、v2 无钱包、v3/v4 含旧赌桌或擂台字段 */
export const WORLD_STATE_VERSION_V1 = 1;
export const WORLD_STATE_VERSION_V2 = 2;

export type { BossSaveState } from '../sim/boss';
export type { VillaSaveState } from '../sim/villas';
export type { WalletSaveState } from '../economy/wallet';

export interface WorldStateParts {
  boss: BossSaveState;
  villas: VillaSaveState;
  wallets: WalletSaveState[];
}

/** 对外仍叫 `WorldStateV1` 是为了少改调用点；结构已经是当前版本 v5 */
export interface WorldStateV1 extends WorldStateParts {
  version: typeof WORLD_STATE_VERSION;
  savedAt: number;
  tzOffsetMin: number;
  profiles: ProfileRecord[];
}

export interface WorldStateStoreOptions {
  /** 快照文件路径；空串由 `openWorldStateStore` 直接返回 null（关闭持久化） */
  path: string;
  /** 变更合并窗口（毫秒），默认 1000 */
  saveDelayMs?: number;
  /** 匿名档案容量上限，默认 512 */
  profileCapacity?: number;
  /** 落盘时抓取老板 / 擂台当前状态 */
  collect: () => WorldStateParts;
  /** 园区时区偏移（分钟）：写进档里，跨时区部署时能看出档是谁写的 */
  tzOffsetMin: number;
  /** 服务器毫秒，测试可注入 */
  now: () => number;
  /** 告警出口，默认 console.warn */
  warn?: (message: string) => void;
}

const DEFAULT_SAVE_DELAY_MS = 1000;
const DEFAULT_PROFILE_CAPACITY = 512;

/** 路径留空 = 关闭持久化：回到「重启即空场」的老行为，便于灰度与排查 */
export function openWorldStateStore(
  options: WorldStateStoreOptions,
): WorldStateStore | null {
  const path = options.path.trim();
  if (path === '') return null;
  return new WorldStateStore({ ...options, path });
}

export class WorldStateStore {
  readonly path: string;
  readonly profiles: ProfileBook;
  private readonly saveDelayMs: number;
  private readonly collect: () => WorldStateParts;
  private readonly tzOffsetMin: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: WorldStateStoreOptions) {
    this.path = options.path;
    this.saveDelayMs = Math.max(0, options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS);
    this.profiles = new ProfileBook(options.profileCapacity ?? DEFAULT_PROFILE_CAPACITY);
    this.collect = options.collect;
    this.tzOffsetMin = Math.floor(options.tzOffsetMin);
    this.now = options.now;
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  /**
   * 启动时同步读档。
   *
   * 返回 null 表示「没有可用的档」：文件不存在、版本不符、字段坏、解析失败都算，
   * 坏档会被改名成 `.bad-<时刻>` 留证，不会被静默覆盖。
   */
  load(): WorldStateV1 | null {
    const primary = this.tryRead(this.path);
    if (primary.state) return primary.state;
    if (primary.kind === 'bad') this.quarantine();
    // 主档坏了 / 丢了：先试上一份备份，再决定空档开服
    const backup = this.tryRead(this.backupPath());
    if (backup.state) {
      this.warn(`[state] 主档不可用，已从备份恢复 path=${this.path}.bak`);
      return backup.state;
    }
    return null;
  }

  private tryRead(path: string): { state: WorldStateV1 | null; kind: 'ok' | 'missing' | 'bad' } {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') this.warn(`[state] 读档失败 path=${path} code=${code ?? '?'}`);
      return { state: null, kind: 'missing' };
    }
    try {
      const state = normalizeWorldState(JSON.parse(text) as unknown);
      if (!state) throw new Error('unexpected shape');
      return { state, kind: 'ok' };
    } catch {
      return { state: null, kind: 'bad' };
    }
  }

  private backupPath(): string {
    return `${this.path}.bak`;
  }

  /** 用读到的档案预置匿名数据（老板 / 擂台由各自的 runtime 自己恢复） */
  hydrateProfiles(state: WorldStateV1 | null): void {
    if (!state) return;
    this.profiles.restore(state.profiles);
    // 停机久了再开服：先按 90 天口径淘汰一轮，别让过期档案占着容量
    this.profiles.prune(this.now());
  }

  /** 状态变了：打脏标记并排一次写盘（同类变更在窗口内只写一次） */
  markDirty(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.saveDelayMs);
    // 未落盘不该拖着进程不退出；真正退出前有 flushSync 兜底
    this.timer.unref?.();
  }

  /** 异步落盘：多次调用串行执行，避免两个 rename 互相覆盖 */
  flush(): Promise<void> {
    if (!this.dirty || this.disposed) return this.chain;
    this.dirty = false;
    this.chain = this.chain.then(() => this.writeOnce());
    return this.chain;
  }

  /** 退出路径用：同步写，保证 SIGINT/SIGTERM 之后磁盘上是最后一帧的状态 */
  flushSync(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const state = this.buildSnapshot();
      const tmp = `${this.path}.tmp`;
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(tmp, serialize(state), 'utf8');
      this.rotateBackupSync();
      renameSync(tmp, this.path);
    } catch (error) {
      this.dirty = true;
      this.warn(`[state] 同步落盘失败 path=${this.path} reason=${(error as Error).message}`);
    }
  }

  /** 覆盖主档前把上一份留成 `.bak`；主档还不存在时静默跳过 */
  private rotateBackupSync(): void {
    try {
      copyFileSync(this.path, this.backupPath());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.warn(`[state] 备份失败 path=${this.path}.bak reason=${(error as Error).message}`);
      }
    }
  }

  private async rotateBackup(): Promise<void> {
    try {
      await copyFile(this.path, this.backupPath());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.warn(`[state] 备份失败 path=${this.path}.bak reason=${(error as Error).message}`);
      }
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.disposed = true;
  }

  private async writeOnce(): Promise<void> {
    let state: WorldStateV1;
    try {
      state = this.buildSnapshot();
    } catch (error) {
      this.dirty = true;
      this.warn(`[state] 快照构建失败 reason=${(error as Error).message}`);
      return;
    }
    const tmp = `${this.path}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(tmp, serialize(state), 'utf8');
      await this.rotateBackup();
      await rename(tmp, this.path);
    } catch (error) {
      this.dirty = true;
      this.warn(`[state] 落盘失败 path=${this.path} reason=${(error as Error).message}`);
    }
  }

  private buildSnapshot(): WorldStateV1 {
    const now = this.now();
    this.profiles.prune(now);
    const parts = this.collect();
    return {
      version: WORLD_STATE_VERSION,
      savedAt: now,
      tzOffsetMin: this.tzOffsetMin,
      ...parts,
      profiles: this.profiles.toJSON(),
    };
  }

  private quarantine(): void {
    const bad = `${this.path}.bad-${this.now()}`;
    try {
      renameSync(this.path, bad);
      this.warn(`[state] 坏档已隔离 path=${this.path} backup=${bad}`);
    } catch (error) {
      this.warn(`[state] 坏档隔离失败 path=${this.path} reason=${(error as Error).message}`);
    }
  }
}

function serialize(state: WorldStateV1): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/**
 * 校验并规整读到的 JSON。
 *
 * 只做「能不能安全接管」的判断：版本对上、关键数字有限，其余字段一律夹到合法区间。
 * 宁可少恢复一点也不抛异常，园区开服比数据完美重要。
 */
function normalizeWorldState(raw: unknown): WorldStateV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<WorldStateV1> & { version?: unknown };
  if (
    source.version !== WORLD_STATE_VERSION &&
    source.version !== WORLD_STATE_VERSION_V4 &&
    source.version !== WORLD_STATE_VERSION_V3 &&
    source.version !== WORLD_STATE_VERSION_V2 &&
    source.version !== WORLD_STATE_VERSION_V1
  ) {
    return null;
  }
  const boss = source.boss;
  if (!boss || typeof boss !== 'object') return null;
  if (!Number.isFinite(boss.hp) || !Number.isFinite(boss.resetAt)) return null;

  return {
    version: WORLD_STATE_VERSION,
    savedAt: Number.isFinite(source.savedAt) ? Math.floor(source.savedAt!) : 0,
    tzOffsetMin: Number.isFinite(source.tzOffsetMin) ? Math.floor(source.tzOffsetMin!) : 0,
    boss: {
      hp: Math.max(0, Math.min(BOSS_MAX_HP, Math.floor(boss.hp))),
      resetAt: Math.floor(boss.resetAt),
    },
    // v1 无房产、v2 无钱包、v3/v4 废弃的擂台/赌桌字段：读入时自动平滑迁移
    villas: normalizeVillas(source.villas),
    wallets: Array.isArray(source.wallets)
      ? (source.wallets.filter((entry) => entry && typeof entry === 'object') as WalletSaveState[])
      : [],
    profiles: Array.isArray(source.profiles) ? source.profiles.filter(isProfileRecord) : [],
  };
}

function normalizeVillas(raw: unknown): { villas: VillaRecordShape[] } {
  const source = (raw && typeof raw === 'object' ? raw : {}) as { villas?: unknown };
  const villas: VillaRecordShape[] = [];
  if (!Array.isArray(source.villas)) return { villas };
  for (const entry of source.villas) {
    if (villas.length >= 16) break;
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Partial<VillaRecordShape>;
    if (!Number.isFinite(record.id)) continue;
    villas.push({
      id: Math.max(0, Math.floor(record.id!)),
      ownerDeviceId: typeof record.ownerDeviceId === 'string' ? record.ownerDeviceId.slice(0, 32) : '',
      ownerName: typeof record.ownerName === 'string' ? record.ownerName.slice(0, 24) : '',
      ownerId: 0,
      locked: record.locked === true,
      lastCollectAt: Number.isFinite(record.lastCollectAt) ? Math.floor(record.lastCollectAt!) : 0,
    });
  }
  return { villas };
}

type VillaRecordShape = {
  id: number;
  ownerDeviceId: string;
  ownerName: string;
  ownerId: number;
  locked: boolean;
  lastCollectAt: number;
};

function isProfileRecord(value: unknown): value is ProfileRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ProfileRecord>;
  return typeof record.id === 'string' && isDeviceId(record.id);
}
