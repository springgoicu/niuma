/**
 * 主线程 ↔ 渲染线程的控制块。
 *
 * 高频且"每帧都要读最新值"的东西只有四类：按键掩码、触屏摇杆、视口尺寸、落点快照。
 * 它们全部塞进一块定长 Int32 内存，Worker 每帧只做几次整数读，不经过消息队列、
 * 不产生结构化克隆，也不在帧循环里造对象。
 *
 * - 有跨源隔离时用 `SharedArrayBuffer`，两侧读写同一块内存，零消息；
 * - 没有时退化成"每次变更发一条定长消息"，Worker 侧写进自己的私有块，
 *   引擎读到的接口完全一致——降级只换传输，不换读写代码。
 *
 * 浮点一律转定点：坐标 1/16 像素、摇杆 1/1000、DPR 1/100。定点既能让整块只有
 * 一种视图（Int32Array），也让 Atomics 的原子读写覆盖到每一个字段。
 */

import type { Direction, Pose } from '@niuma/shared-types';

/** 'NMC1'：块头魔数，用来挡住未初始化或版本错位的内存 */
export const CONTROL_MAGIC = 0x4e4d4331;

/** 动作环容量：两帧之间最多积压 4 个按键动作，再多就丢最旧的 */
export const ACTION_RING = 4;

const ACTION_BASE = 4;
const FIXED_COORD = 16;
const FIXED_TOUCH = 1000;
const FIXED_DPR = 100;

/**
 * 槽位表。数值即 Int32 下标，改动等于改协议：
 * 主线程与 Worker 必须同一版本，否则读到的字段会整体错位。
 */
export const CONTROL_SLOT = {
  magic: 0,
  /** 按键掩码，见 `KEY_BIT` */
  keys: 1,
  /** 写端单调递增的序号 */
  actionWrite: 2,
  /** 读端已经消费到的序号 */
  actionRead: 3,
  /** 动作环：actionWrite % ACTION_RING 决定写哪一格 */
  actionRing: ACTION_BASE,
  /** 摇杆方向，屏幕坐标，y 向下为正 */
  touchX: ACTION_BASE + ACTION_RING,
  touchY: ACTION_BASE + ACTION_RING + 1,
  /** 视口 CSS 尺寸与设备像素比 */
  viewportW: ACTION_BASE + ACTION_RING + 2,
  viewportH: ACTION_BASE + ACTION_RING + 3,
  dpr: ACTION_BASE + ACTION_RING + 4,
  /** 落点快照：写一次序号加一，读端据此判断是否有新值 */
  snapshotSeq: ACTION_BASE + ACTION_RING + 5,
  snapX: ACTION_BASE + ACTION_RING + 6,
  snapY: ACTION_BASE + ACTION_RING + 7,
  /** dir(8b) | pose(8b) | seatId(16b) */
  snapState: ACTION_BASE + ACTION_RING + 8,
} as const;

export const CONTROL_SLOTS = CONTROL_SLOT.snapState + 1;
export const CONTROL_BYTES = CONTROL_SLOTS * 4;

/** 按键位：与 `lib/game/input.ts` 的语义一一对应，方向位可叠加 */
export const KEY_BIT = {
  up: 1 << 0,
  down: 1 << 1,
  left: 1 << 2,
  right: 1 << 3,
  sprint: 1 << 4,
} as const;

export interface ViewportInfo {
  width: number;
  height: number;
  dpr: number;
}

/** 落点快照：只留重连需要的五个标量，`park` 由主线程按会话绑定补齐 */
export interface SnapshotPatch {
  x: number;
  y: number;
  direction: Direction;
  pose: Pose;
  seatId: number;
}

export interface TouchVector {
  x: number;
  y: number;
}

/** 无共享内存时的传输单元：全部定长标量，不携带对象引用 */
export type ControlMessage =
  | { t: 'keys'; mask: number }
  | { t: 'touch'; x: number; y: number }
  | { t: 'action'; code: number }
  | { t: 'viewport'; width: number; height: number; dpr: number };

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 一块控制内存的读写封装。
 *
 * 同一个类同时用于两端：主线程写、Worker 读。唯一的差别是有没有共享内存，
 * 那决定了读写要不要走 `Atomics`（对非共享缓冲区调用 Atomics 会直接抛错）。
 */
export class ControlBlock {
  readonly buffer: ArrayBufferLike;
  private readonly cells: Int32Array;
  private readonly shared: boolean;
  /** 0 是「还没写过」的初值：首帧不能把一块全零内存当成有效落点写进存档 */
  private lastSnapshotSeq = 0;
  private lastViewportW = Number.NaN;
  private lastViewportH = Number.NaN;
  private lastViewportDpr = Number.NaN;

  constructor(buffer?: ArrayBufferLike) {
    this.buffer = buffer ?? allocate(CONTROL_BYTES);
    this.cells = new Int32Array(this.buffer, 0, CONTROL_SLOTS);
    this.shared = typeof SharedArrayBuffer !== 'undefined' && this.buffer instanceof SharedArrayBuffer;
    if (this.load(CONTROL_SLOT.magic) !== CONTROL_MAGIC) {
      this.store(CONTROL_SLOT.magic, CONTROL_MAGIC);
    }
  }

  get isShared(): boolean {
    return this.shared;
  }

  // ---- 按键掩码 ----

  writeKeys(mask: number): void {
    this.store(CONTROL_SLOT.keys, mask | 0);
  }

  readKeys(): number {
    return this.load(CONTROL_SLOT.keys);
  }

  // ---- 摇杆 ----

  writeTouch(x: number, y: number): void {
    this.store(CONTROL_SLOT.touchX, clampInt(x * FIXED_TOUCH, -FIXED_TOUCH, FIXED_TOUCH));
    this.store(CONTROL_SLOT.touchY, clampInt(y * FIXED_TOUCH, -FIXED_TOUCH, FIXED_TOUCH));
  }

  /** 复用输出槽：帧循环里不分配 */
  readTouch(out: TouchVector): TouchVector {
    out.x = this.load(CONTROL_SLOT.touchX) / FIXED_TOUCH;
    out.y = this.load(CONTROL_SLOT.touchY) / FIXED_TOUCH;
    return out;
  }

  // ---- 动作环 ----

  pushAction(code: number): void {
    const write = this.load(CONTROL_SLOT.actionWrite);
    this.store(CONTROL_SLOT.actionRing + (write % ACTION_RING), code);
    // 先写内容再推序号：读端看到序号变化时，对应的格子一定是完整的
    this.store(CONTROL_SLOT.actionWrite, write + 1);
  }

  /** 取走一个动作码；0 表示本帧没有待处理动作 */
  takeAction(): number {
    const write = this.load(CONTROL_SLOT.actionWrite);
    const read = this.load(CONTROL_SLOT.actionRead);
    if (read === write) return 0;
    // 积压超过环容量说明读端落后太久，直接跳到最新一格，不重放过期按键
    const next = write - read > ACTION_RING ? write - 1 : read;
    const code = this.load(CONTROL_SLOT.actionRing + (next % ACTION_RING));
    this.store(CONTROL_SLOT.actionRead, next + 1);
    return code;
  }

  // ---- 视口 ----

  writeViewport(width: number, height: number, dpr: number): void {
    this.store(CONTROL_SLOT.viewportW, clampInt(width, 0, 16384));
    this.store(CONTROL_SLOT.viewportH, clampInt(height, 0, 16384));
    this.store(CONTROL_SLOT.dpr, clampInt(dpr * FIXED_DPR, FIXED_DPR, 800));
  }

  /** 只在真的变化时返回 true：渲染层据此重算倍率与文字位图 */
  readViewport(out: ViewportInfo): boolean {
    const width = this.load(CONTROL_SLOT.viewportW);
    const height = this.load(CONTROL_SLOT.viewportH);
    const dpr = this.load(CONTROL_SLOT.dpr) / FIXED_DPR;
    if (width === this.lastViewportW && height === this.lastViewportH && dpr === this.lastViewportDpr) {
      return false;
    }
    this.lastViewportW = width;
    this.lastViewportH = height;
    this.lastViewportDpr = dpr;
    out.width = width;
    out.height = height;
    out.dpr = dpr > 0 ? dpr : 1;
    return true;
  }

  // ---- 落点快照 ----

  writeSnapshot(patch: SnapshotPatch): void {
    this.store(CONTROL_SLOT.snapX, clampInt(patch.x * FIXED_COORD, 0, 0x7fffffff));
    this.store(CONTROL_SLOT.snapY, clampInt(patch.y * FIXED_COORD, 0, 0x7fffffff));
    this.store(
      CONTROL_SLOT.snapState,
      (patch.direction & 0xff) | ((patch.pose & 0xff) << 8) | ((patch.seatId & 0xffff) << 16),
    );
    this.store(CONTROL_SLOT.snapshotSeq, this.load(CONTROL_SLOT.snapshotSeq) + 1);
  }

  /** 主线程 2s 一次与 pagehide 时读；没有新值时返回 false，不重复落盘 */
  readSnapshot(out: SnapshotPatch): boolean {
    const seq = this.load(CONTROL_SLOT.snapshotSeq);
    if (seq === this.lastSnapshotSeq) return false;
    this.lastSnapshotSeq = seq;
    const packed = this.load(CONTROL_SLOT.snapState);
    out.x = this.load(CONTROL_SLOT.snapX) / FIXED_COORD;
    out.y = this.load(CONTROL_SLOT.snapY) / FIXED_COORD;
    // 写入端只可能是本仓库的引擎，位宽与取值域都在协议内，直接按枚举还原
    out.direction = (packed & 0xff) as Direction;
    out.pose = ((packed >> 8) & 0xff) as Pose;
    out.seatId = (packed >>> 16) & 0xffff;
    return true;
  }

  // ---- 无共享内存时的入口：把一条定长消息落进本地块 ----

  apply(message: ControlMessage): void {
    switch (message.t) {
      case 'keys':
        this.writeKeys(message.mask);
        return;
      case 'touch':
        this.writeTouch(message.x, message.y);
        return;
      case 'action':
        this.pushAction(message.code);
        return;
      case 'viewport':
        this.writeViewport(message.width, message.height, message.dpr);
        return;
    }
  }

  private load(slot: number): number {
    return this.shared ? Atomics.load(this.cells, slot) : this.cells[slot]!;
  }

  private store(slot: number, value: number): void {
    if (this.shared) Atomics.store(this.cells, slot, value);
    else this.cells[slot] = value;
  }
}

/** 共享内存可用性：`crossOriginIsolated` 为假时构造 SAB 会直接抛错 */
export function supportsSharedMemory(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  return typeof crossOriginIsolated === 'undefined' || crossOriginIsolated !== false;
}

function allocate(bytes: number): ArrayBufferLike {
  return supportsSharedMemory() ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
}

/**
 * 主线程侧的写端。
 *
 * 共享内存可用时 `buffer` 非空，Worker 拿到同一块内存后不再需要任何输入消息；
 * 否则每次变更都通过 `post` 发一条定长消息，由 Worker 写进自己的私有块。
 */
export interface ControlWriter {
  /** 非空表示零拷贝：init 时把它交给 Worker */
  readonly buffer: SharedArrayBuffer | null;
  writeKeys(mask: number): void;
  writeTouch(x: number, y: number): void;
  pushAction(code: number): void;
  writeViewport(width: number, height: number, dpr: number): void;
  /** 落点快照回读：只有共享内存时才有值，消息模式由 Worker 单独回传 */
  readSnapshot(out: SnapshotPatch): boolean;
}

/** 主线程侧：共享内存可用时直接写；否则每次变更补一条定长消息 */
export function createControlWriter(post: (message: ControlMessage) => void): ControlWriter {
  const block = new ControlBlock();
  if (block.isShared) {
    return {
      buffer: block.buffer as SharedArrayBuffer,
      writeKeys: (mask) => block.writeKeys(mask),
      writeTouch: (x, y) => block.writeTouch(x, y),
      pushAction: (code) => block.pushAction(code),
      writeViewport: (width, height, dpr) => block.writeViewport(width, height, dpr),
      readSnapshot: (out) => block.readSnapshot(out),
    };
  }
  return {
    buffer: null,
    writeKeys: (mask) => {
      block.writeKeys(mask);
      post({ t: 'keys', mask });
    },
    writeTouch: (x, y) => {
      block.writeTouch(x, y);
      post({ t: 'touch', x, y });
    },
    pushAction: (code) => {
      block.pushAction(code);
      post({ t: 'action', code });
    },
    writeViewport: (width, height, dpr) => {
      block.writeViewport(width, height, dpr);
      post({ t: 'viewport', width, height, dpr });
    },
    readSnapshot: () => false,
  };
}

/** 同线程直连（主线程回退模式）：写端与引擎共用一块私有内存，不发消息 */
export function createLocalControlWriter(block: ControlBlock): ControlWriter {
  return {
    buffer: null,
    writeKeys: (mask) => block.writeKeys(mask),
    writeTouch: (x, y) => block.writeTouch(x, y),
    pushAction: (code) => block.pushAction(code),
    writeViewport: (width, height, dpr) => block.writeViewport(width, height, dpr),
    readSnapshot: (out) => block.readSnapshot(out),
  };
}

/** 主线程新建一块私有控制内存（回退模式用） */
export function createLocalControlBlock(): ControlBlock {
  return new ControlBlock(new ArrayBuffer(CONTROL_BYTES));
}
