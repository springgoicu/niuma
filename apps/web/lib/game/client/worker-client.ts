import type { CharacterAppearance, NavTargetId, ResumeState } from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import { ACTION_CODE, type ActionKey } from '../input';
import { KeyboardInput } from '../input-keyboard';
import { MINIMAP_SIZE } from '../minimap-draw';
import { applyAudioEvent } from '../runtime/audio-sink';
import { createControlWriter, type ControlWriter, type SnapshotPatch } from '../runtime/control-channel';
import type { SessionProfile } from '../runtime/engine-env';
import type { MainToWorker, WorkerToMain } from '../runtime/worker-protocol';
import { saveSnapshot } from '../snapshot';
import type { GameClient, GameClientOptions } from './game-client';

/** 主线程落盘的节拍：与引擎写快照的节拍一致，2s 足够精确（ADR-0034） */
const PERSIST_INTERVAL_MS = 2000;

interface HostSize {
  width: number;
  height: number;
  dpr: number;
}

function readHostSize(host: HTMLElement): HostSize {
  const rect = host.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
    dpr: window.devicePixelRatio || 1,
  };
}

/**
 * 渲染线程宿主（主线程侧）。
 *
 * 这一层只做五件事：建画布并移交、把输入写成定长控制块、把尺寸变化写进
 * 同一块、把 Worker 的有向消息翻成 UI 回调、把落点快照写进 localStorage。
 * 它不持有任何游戏状态——所有状态都在 Worker 里。
 */
export class WorkerGameClient implements GameClient {
  private worker: Worker | null = null;
  private writer: ControlWriter | null = null;
  private keyboard: KeyboardInput | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private cleanup: Array<() => void> = [];
  private persistTimer: number | null = null;
  private stopped = false;

  private badgeId: number | null = null;
  private badgeCb: ((badge: PlayerBadge | null) => void) | null = null;
  private pendingMinimap: HTMLElement | null = null;

  /** 消息模式下由 Worker 回传的最近一次落点；共享内存模式直接读控制块 */
  private lastSnapshot: SnapshotPatch | null = null;
  private snapshotDirty = false;
  private readonly snapshotOut: SnapshotPatch = { x: 0, y: 0, direction: 0, pose: 0, seatId: 0 };

  constructor(private readonly options: GameClientOptions) {}

  async start(host: HTMLElement, profile: SessionProfile, resume?: ResumeState): Promise<void> {
    // 每次会话新建画布：`transferControlToOffscreen()` 是一次性的，
    // StrictMode 双挂载时必须换一块，不能复用已经移交过的画布。
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'block h-full w-full';
    host.appendChild(canvas);
    this.canvas = canvas;

    const size = readHostSize(host);
    this.writer = createControlWriter((message) => {
      this.worker?.postMessage({ t: 'control', message } satisfies MainToWorker);
    });
    this.writer.writeViewport(size.width, size.height, size.dpr);

    const worker = new Worker(new URL('../../../workers/game.worker.ts', import.meta.url), {
      type: 'module',
      name: 'niuma-game',
    });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerToMain>) => this.handle(event.data);
    worker.onerror = (event) => {
      console.error('[game] 渲染线程异常', event.message);
      this.options.callbacks.onStatus('error', '渲染线程异常，请刷新页面');
    };

    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage(
      {
        t: 'init',
        canvas: offscreen,
        control: this.writer.buffer,
        profile,
        resume,
        wsUrl: this.options.wsUrl,
        parkId: this.options.parkId,
        search: this.options.search,
        width: size.width,
        height: size.height,
        dpr: size.dpr,
      } satisfies MainToWorker,
      [offscreen],
    );

    this.keyboard = new KeyboardInput(this.writer, () => this.options.onRequestChat());
    this.keyboard.attach();

    // 尺寸变化走控制块：ResizeObserver 只在布局真的变了时回调，不必每帧量 DOM
    const observer = new ResizeObserver(() => this.syncViewport(host));
    observer.observe(host);
    this.observer = observer;
    // DPR 只在跨屏拖动 / 浏览器缩放时变，resize 事件足够
    const onWindowResize = () => this.syncViewport(host);
    window.addEventListener('resize', onWindowResize);

    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      // 停渲染、保连接：断线重连要重新入场，代价远大于留一条空闲连接
      worker.postMessage({ t: 'pause', paused: hidden } satisfies MainToWorker);
      if (hidden) this.persistSnapshot();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onPageHide = () => this.persistSnapshot();
    window.addEventListener('pagehide', onPageHide);

    this.cleanup = [
      () => window.removeEventListener('resize', onWindowResize),
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('pagehide', onPageHide),
    ];

    // localStorage 是同步 API：留在主线程，按 2s 从控制块读一次
    this.persistTimer = window.setInterval(() => this.persistSnapshot(), PERSIST_INTERVAL_MS);

    if (this.pendingMinimap) {
      const pending = this.pendingMinimap;
      this.pendingMinimap = null;
      this.attachMinimap(pending);
    }
  }

  attachMinimap(host: HTMLElement): void {
    if (!this.worker) {
      this.pendingMinimap = host;
      return;
    }
    // 每次挂载都新建画布：transfer 一次性的，React 节点会跨挂载复用
    const canvas = document.createElement('canvas');
    canvas.className = 'block';
    canvas.style.width = `${MINIMAP_SIZE}px`;
    canvas.style.height = `${MINIMAP_SIZE}px`;
    canvas.setAttribute('aria-hidden', 'true');
    host.replaceChildren(canvas);
    try {
      const offscreen = canvas.transferControlToOffscreen();
      this.worker.postMessage({ t: 'minimap', canvas: offscreen } satisfies MainToWorker, [offscreen]);
    } catch (error) {
      // 极老或受限环境：小地图留在空白态，不影响主画面与操作
      console.warn('[game] 小地图移交失败', error);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.persistSnapshot();
    this.keyboard?.detach();
    this.keyboard = null;
    this.observer?.disconnect();
    this.observer = null;
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    if (this.persistTimer !== null) window.clearInterval(this.persistTimer);
    this.persistTimer = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    this.canvas?.remove();
    this.canvas = null;
    this.badgeCb = null;
    this.badgeId = null;
  }

  setMoveVector(x: number, y: number): void {
    this.keyboard?.setMoveVector(x, y);
  }

  perform(action: ActionKey): void {
    // 动作与键盘共用同一个动作环：渲染线程只需排空一处，不必区分来源
    this.writer?.pushAction(ACTION_CODE[action]);
  }

  clearMovement(): void {
    this.keyboard?.clear();
    this.cancelNavigation();
  }

  sendChat(text: string): void {
    this.post({ t: 'chat', text });
  }

  requestHistory(beforeMsgId: number): void {
    this.post({ t: 'history', cursor: beforeMsgId });
  }

  setStatus(status: string): void {
    this.post({ t: 'status', text: status });
  }

  setAppearance(appearance: CharacterAppearance): void {
    this.post({ t: 'appearance', appearance });
  }

  navigateTo(id: NavTargetId): void {
    this.post({ t: 'navigate', id });
  }

  cancelNavigation(): void {
    this.post({ t: 'cancelNav' });
  }

  pick(stageX: number, stageY: number): void {
    this.post({ t: 'pick', x: stageX, y: stageY });
  }

  subscribeBadge(id: number | null, onChange: (badge: PlayerBadge | null) => void): void {
    this.badgeId = id;
    this.badgeCb = id === null ? null : onChange;
    this.post({ t: 'inspect', id });
  }

  retry(): void {
    this.post({ t: 'retry' });
  }

  private post(message: MainToWorker): void {
    this.worker?.postMessage(message);
  }

  private syncViewport(host: HTMLElement): void {
    if (!this.writer) return;
    const next = readHostSize(host);
    this.writer.writeViewport(next.width, next.height, next.dpr);
  }

  /**
   * 落点落盘。
   *
   * 共享内存时直接从控制块读（引擎 2s 写一次）；没有跨源隔离时读的是
   * Worker 回传的最后一份 patch。没有新值就不写盘，避免每 2s 一次空写。
   */
  private persistSnapshot(): void {
    if (this.writer?.readSnapshot(this.snapshotOut)) {
      this.lastSnapshot = { ...this.snapshotOut };
      this.snapshotDirty = true;
    }
    if (!this.snapshotDirty || !this.lastSnapshot) return;
    this.snapshotDirty = false;
    const patch = this.lastSnapshot;
    const park = this.options.parkId;
    // 字面量而不是展开：`saveSnapshot` 允许后续模块扩展未知字段，这里只管落点五个标量
    saveSnapshot({
      x: patch.x,
      y: patch.y,
      direction: patch.direction,
      pose: patch.pose,
      seatId: patch.seatId,
      ...(park ? { park } : {}),
    });
  }

  private handle(message: WorkerToMain): void {
    if (this.stopped) return;
    const callbacks = this.options.callbacks;
    switch (message.t) {
      case 'ready':
        return;
      case 'status':
        callbacks.onStatus(message.status, message.detail);
        return;
      case 'queue':
        callbacks.onQueue(message.queue);
        return;
      case 'rejected':
        callbacks.onRejected(message.reason);
        return;
      case 'stats':
        callbacks.onStats(message.stats);
        return;
      case 'chat':
        callbacks.onChat(message.entry);
        return;
      case 'history':
        callbacks.onChatHistory(message.entries, { replace: message.replace, hasMore: message.hasMore });
        return;
      case 'hint':
        callbacks.onHint(message.hint);
        return;
      case 'localState':
        callbacks.onLocalState({ pose: message.pose, seated: message.seated, seatKind: message.seatKind });
        return;
      case 'nav':
        callbacks.onNav(message.nav);
        return;
      case 'picked':
        this.options.onPick(message.id);
        return;
      case 'badge':
        if (message.id === this.badgeId) this.badgeCb?.(message.badge);
        return;
      case 'audio':
        applyAudioEvent(message.event, message.listenerX, message.listenerY);
        return;
      case 'snapshot':
        this.lastSnapshot = message.patch;
        this.snapshotDirty = true;
        return;
    }
  }
}
