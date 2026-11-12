import type { CareerSummary, CharacterAppearance, NavTargetId, ResumeState } from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import { ACTION_CODE, type ActionKey } from '../input';
import { KeyboardInput } from '../input-keyboard';
import { MINIMAP_SIZE } from '../minimap-draw';
import { applyAudioEvent } from '../runtime/audio-sink';
import { createControlWriter, type ControlWriter, type SnapshotPatch } from '../runtime/control-channel';
import type { SessionProfile } from '../runtime/engine-env';
import { markRenderFallback } from '../runtime/render-mode';
import type { MainToWorker, WorkerToMain } from '../runtime/worker-protocol';
import { saveSnapshot } from '../snapshot';
import type { GameClient, GameClientOptions } from './game-client';

/** 主线程落盘的节拍：与引擎写快照的节拍一致，2s 足够精确（ADR-0034） */
const PERSIST_INTERVAL_MS = 2000;
/** 启动闸门：Worker 脚本已下载但一直不回消息时，不能让用户无限等下去 */
const WORKER_BOOT_TIMEOUT_MS = 10_000;

/** Worker 内部未捕获异常上报（见 workers/game.worker.ts），不属于业务消息协议 */
interface WorkerFatalMessage {
  t: 'fatal';
  detail: string;
}

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
  /** 启动失败后接管全部方法的门面；本对象继续保留，React 侧的 ref 无需重建 */
  private delegate: GameClient | null = null;
  private lastFatal = '';
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
    // 已经回退过：后续 start 直接交给主线程实现，不再碰 Worker
    if (this.delegate) return this.delegate.start(host, profile, resume);

    // 每次会话新建画布：`transferControlToOffscreen()` 是一次性的，
    // StrictMode 双挂载时必须换一块，不能复用已经移交过的画布。
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'block h-full w-full';
    host.appendChild(canvas);
    this.canvas = canvas;

    const size = readHostSize(host);
    const writer = createControlWriter((message) => {
      this.worker?.postMessage({ t: 'control', message } satisfies MainToWorker);
    });
    this.writer = writer;
    writer.writeViewport(size.width, size.height, size.dpr);

    const worker = new Worker(new URL('../../../workers/game.worker.ts', import.meta.url), {
      type: 'module',
      name: 'niuma-game',
    });
    this.worker = worker;

    // 启动闸门：Worker 脚本可能被 COEP/CSP 拦掉（此时 onerror.message 是空的），
    // 也可能加载成功但内部初始化抛错、或干脆一直不回消息。只有收到第一条业务
    // 消息才算真正活着；其余情况一律销毁并回退主线程，绝不把状态挂死在 error。
    let settleBoot: (alive: boolean) => void = () => {};
    const booted = new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: number | undefined;
      const finish = (alive: boolean) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) window.clearTimeout(timer);
        resolve(alive);
      };
      timer = window.setTimeout(() => {
        this.lastFatal = `渲染线程 ${WORKER_BOOT_TIMEOUT_MS / 1000}s 内没有响应`;
        finish(false);
      }, WORKER_BOOT_TIMEOUT_MS);
      settleBoot = finish;

      worker.onmessage = (event: MessageEvent<WorkerToMain | WorkerFatalMessage>) => {
        const data = event.data;
        if (data.t === 'fatal') {
          this.lastFatal = data.detail;
          if (settled) this.onWorkerFatal(data.detail);
          else finish(false);
          return;
        }
        finish(true);
        this.handle(data);
      };
      worker.onerror = (event) => {
        const where = event.filename ? ` (${event.filename})` : '';
        const detail = event.message
          ? `${event.message}${where}`
          : `Worker 脚本加载失败${where}，检查 COEP/CORP 响应头与脚本可达性`;
        this.lastFatal = detail;
        if (settled) this.onWorkerFatal(detail);
        else finish(false);
      };
    });

    try {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage(
        {
          t: 'init',
          canvas: offscreen,
          control: writer.buffer,
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
    } catch (error) {
      this.lastFatal = `画布移交失败：${error instanceof Error ? error.message : String(error)}`;
      settleBoot(false);
    }

    const alive = await booted;
    if (this.stopped) return;
    if (!alive) {
      await this.fallbackToMain(host, profile, resume);
      return;
    }

    this.keyboard = new KeyboardInput(writer, () => this.options.onRequestChat());
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
    if (this.delegate) return this.delegate.attachMinimap(host);
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
    if (this.delegate) {
      this.delegate.stop();
      this.delegate = null;
      return;
    }
    this.persistSnapshot();
    this.teardownWorker();
    this.badgeCb = null;
    this.badgeId = null;
  }

  /** 只拆 Worker 侧资源，不动 stopped：回退之后本对象还要继续当门面用 */
  private teardownWorker(): void {
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
    // 这块画布已经 transfer 过，主线程实现会自己新建一块
    this.canvas?.remove();
    this.canvas = null;
    this.writer = null;
  }

  /**
   * Worker 启动失败：销毁它，改用同一个 GameSession 的主线程实现重新入场。
   * 上层拿到的还是这个 GameClient 引用，React effect 不需要重建。
   */
  private async fallbackToMain(host: HTMLElement, profile: SessionProfile, resume?: ResumeState): Promise<void> {
    const detail = this.lastFatal || '渲染线程不可用';
    markRenderFallback();
    console.warn('[game] 渲染线程启动失败，自动回退主线程渲染：', detail);
    this.teardownWorker();
    const { MainThreadGameClient } = await import('./main-thread-client');
    if (this.stopped) return;
    const main = new MainThreadGameClient(this.options);
    this.delegate = main;
    await main.start(host, profile, resume);
    if (this.pendingMinimap) {
      const pending = this.pendingMinimap;
      this.pendingMinimap = null;
      main.attachMinimap(pending);
    }
  }

  /** 运行中崩溃：本次会话记一笔（刷新后直接走主线程），并把真实原因显示出来 */
  private onWorkerFatal(detail: string): void {
    markRenderFallback();
    console.error('[game] 渲染线程异常', detail);
    const brief = detail.split('\n')[0]?.slice(0, 120) || '渲染线程异常';
    this.options.callbacks.onStatus('error', `${brief}（刷新后自动改用主线程）`);
  }

  setMoveVector(x: number, y: number): void {
    if (this.delegate) return this.delegate.setMoveVector(x, y);
    this.keyboard?.setMoveVector(x, y);
  }

  perform(action: ActionKey): void {
    if (this.delegate) return this.delegate.perform(action);
    // 动作与键盘共用同一个动作环：渲染线程只需排空一处，不必区分来源
    this.writer?.pushAction(ACTION_CODE[action]);
  }

  clearMovement(): void {
    if (this.delegate) return this.delegate.clearMovement();
    this.keyboard?.clear();
    this.cancelNavigation();
  }

  sendChat(text: string): void {
    if (this.delegate) return this.delegate.sendChat(text);
    this.post({ t: 'chat', text });
  }

  requestHistory(beforeMsgId: number): void {
    if (this.delegate) return this.delegate.requestHistory(beforeMsgId);
    this.post({ t: 'history', cursor: beforeMsgId });
  }

  setStatus(status: string): void {
    if (this.delegate) return this.delegate.setStatus(status);
    this.post({ t: 'status', text: status });
  }

  setAppearance(appearance: CharacterAppearance): void {
    if (this.delegate) return this.delegate.setAppearance(appearance);
    this.post({ t: 'appearance', appearance });
  }

  updateCareer(career: CareerSummary): void {
    if (this.delegate) return this.delegate.updateCareer(career);
    this.post({ t: 'career', career });
  }

  navigateTo(id: NavTargetId): void {
    if (this.delegate) return this.delegate.navigateTo(id);
    this.post({ t: 'navigate', id });
  }

  cancelNavigation(): void {
    if (this.delegate) return this.delegate.cancelNavigation();
    this.post({ t: 'cancelNav' });
  }

  pick(stageX: number, stageY: number): void {
    if (this.delegate) return this.delegate.pick(stageX, stageY);
    this.post({ t: 'pick', x: stageX, y: stageY });
  }

  subscribeBadge(id: number | null, onChange: (badge: PlayerBadge | null) => void): void {
    if (this.delegate) return this.delegate.subscribeBadge(id, onChange);
    this.badgeId = id;
    this.badgeCb = id === null ? null : onChange;
    this.post({ t: 'inspect', id });
  }

  retry(): void {
    if (this.delegate) return this.delegate.retry();
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
    if (this.stopped || this.delegate) return;
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
        this.options.onPick(message.id, message.badge ?? null);
        return;
      case 'badge':
        if (message.id === this.badgeId) this.badgeCb?.(message.badge);
        return;
      case 'ventHit':
        callbacks.onVentHit?.(message.local);
        return;
      case 'ventDealt':
        callbacks.onVentDealt?.();
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
