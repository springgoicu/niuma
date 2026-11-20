import type {
  BoardMetric,
  CareerSummary,
  CharacterAppearance,
  ChatSendPacket,
  ClearStarRequest,
  CprRequest,
  FishingActionRequest,
  GigActionRequest,
  GraffitiRequest,
  NavTargetId,
  ResumeState,
  VehicleActionRequest,
  VillaCustomizeRequest,
} from '@niuma/shared-types';
import { reloadForStaleAssets, requestBuildCheck } from '../../build-version';
import type { PlayerBadge } from '../badge';
import type { DanmakuPrefs } from '../danmaku-prefs';
import { ensureDeviceId } from '../device-id';
import { readIncenseDay, writeIncenseDay } from '../incense-day';
import { ACTION_CODE, type ActionKey } from '../input';
import { KeyboardInput } from '../input-keyboard';
import { MINIMAP_SIZE } from '../minimap-draw';
import { applyAudioEvent } from '../runtime/audio-sink';
import { applyClockEpoch } from '../server-clock';
import { classifyBootMessage } from '../runtime/boot-gate';
import { createControlWriter, type ControlWriter, type SnapshotPatch } from '../runtime/control-channel';
import type { SessionProfile } from '../runtime/engine-env';
import { markRenderFallback, reloadForRenderFatal } from '../runtime/render-mode';
import type { MainToWorker, WorkerToMain } from '../runtime/worker-protocol';
import { saveSnapshot } from '../snapshot';
import type { GameClient, GameClientOptions } from './game-client';

/** 主线程落盘的节拍：与引擎写快照的节拍一致，2s 足够精确（ADR-0034） */
const PERSIST_INTERVAL_MS = 2000;
/** 启动闸门：Worker 脚本已下载但一直不回消息时，不能让用户无限等下去 */
const WORKER_BOOT_TIMEOUT_MS = 10_000;
/** 已经收到 progress（connecting）后的初始化预算：冷启动要拉图集与字体，比纯脚本加载慢 */
const WORKER_INIT_TIMEOUT_MS = 20_000;
/** 素材版本错配的玩家可读提示：受控重载被守卫拦下时才显示 */
const STALE_ASSET_HINT = '园区刚更新过，请刷新页面';

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
  /** fatal 只处理一次：`worker.onerror` 与 fatal 消息可能同帧各来一条 */
  private fatalHandled = false;
  /** 启动期发现图集版本不一致：本次不回退主线程，直接换图 */
  private staleAssets = false;
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
    this.lastFatal = '';
    this.fatalHandled = false;
    this.staleAssets = false;

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
    // 也可能加载成功但内部初始化抛错、或干脆一直不回消息。
    //
    // 注意 `GameSession.start()` 在 `await renderer.init()` 之前就同步发 connecting：
    // 它只说明 Worker 活着，不代表渲染器启动成功。真正的成功信号是 ready 或其后
    // 才可能出现的业务消息；初始化失败走 fallbackToMain()，不再把红条甩给玩家。
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
      const arm = (budgetMs: number) => {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          this.lastFatal = `渲染线程 ${Math.round(budgetMs / 1000)}s 内没有完成初始化`;
          finish(false);
        }, budgetMs);
      };
      arm(WORKER_BOOT_TIMEOUT_MS);
      settleBoot = finish;

      worker.onmessage = (event: MessageEvent<WorkerToMain | WorkerFatalMessage>) => {
        const data = event.data;
        if (data.t === 'fatal') {
          this.lastFatal = data.detail;
          if (settled) this.onWorkerFatal(data.detail);
          else finish(false);
          return;
        }
        if (!settled) {
          // 素材版本错配不是渲染线程坏了，而是页面已过期：换图比回退主线程正确，
          // 也不该把本次会话永久降级到主线程。
          if (data.t === 'status' && data.code === 'atlas-version') {
            this.staleAssets = true;
            this.lastFatal = data.detail || '图集版本不一致';
            finish(false);
            return;
          }
          const verdict = classifyBootMessage(data);
          if (verdict === 'failed') {
            this.lastFatal =
              data.t === 'status' ? data.detail || '渲染线程初始化失败' : '渲染线程初始化失败';
            finish(false);
            return;
          }
          if (verdict === 'alive') finish(true);
          // progress：Worker 活着但初始化未完成，给冷启动续一段更宽的预算
          else arm(WORKER_INIT_TIMEOUT_MS);
        }
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
          danmaku: this.options.danmakuPrefs,
          incenseDay: readIncenseDay(),
          // 设备号只在主线程生成：Worker 里 localStorage 不可用
          deviceId: ensureDeviceId(),
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
      if (this.staleAssets) {
        // 页面素材已过期：销毁 Worker 并受控换图；被重载守卫拦下才提示玩家手动刷新
        this.teardownWorker();
        if (!reloadForStaleAssets()) this.options.callbacks.onStatus('error', STALE_ASSET_HINT);
        return;
      }
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

  /**
   * 运行中崩溃：先换后端重载，再退主线程，玩家不需要手动刷新。
   *
   * 第一级：带 `gpu=webgl` 受控重载一次（ADR-0071）。多数崩溃是 WebGPU
   * 上传画布快照失败，换后端重走一遍启动链路就能真的恢复；重载前先把最近
   * 一次落点落盘，回来后由 `resume` 接着原位站着。
   *
   * 第二级：受控重载被守卫拦下（说明 WebGL2 也崩、或环境根本起不来 Worker），
   * 这时才记一笔「别再用 Worker」，下一次刷新走主线程渲染——至少还能玩。
   * 反过来在第一次就记，会把本来能救回来的会话白白降级成主线程渲染。
   */
  private onWorkerFatal(detail: string): void {
    console.error('[game] 渲染线程异常', detail);
    if (this.fatalHandled) return;
    this.fatalHandled = true;
    this.persistSnapshot();
    if (reloadForRenderFatal()) {
      // 页面马上要换掉，这条提示只是一闪而过的过渡态
      this.teardownWorker();
      this.options.callbacks.onStatus('error', '渲染异常，正在切换渲染后端…');
      return;
    }
    markRenderFallback();
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

  sendChat(packet: ChatSendPacket): void {
    if (this.delegate) return this.delegate.sendChat(packet);
    this.post({ t: 'chat', packet });
  }

  setDanmakuPrefs(prefs: DanmakuPrefs): void {
    if (this.delegate) return this.delegate.setDanmakuPrefs(prefs);
    this.post({ t: 'danmaku', prefs });
  }

  requestHistory(beforeMsgId: number): void {
    if (this.delegate) return this.delegate.requestHistory(beforeMsgId);
    this.post({ t: 'history', cursor: beforeMsgId });
  }

  setStatus(status: string): void {
    if (this.delegate) return this.delegate.setStatus(status);
    this.post({ t: 'status', text: status });
  }

  setName(name: string): void {
    if (this.delegate) return this.delegate.setName(name);
    this.post({ t: 'name', text: name });
  }

  setAppearance(appearance: CharacterAppearance): void {
    if (this.delegate) return this.delegate.setAppearance(appearance);
    this.post({ t: 'appearance', appearance });
  }

  updateCareer(career: CareerSummary): void {
    if (this.delegate) return this.delegate.updateCareer(career);
    this.post({ t: 'career', career });
  }

  requestBoard(metric: BoardMetric | 0 = 0): void {
    if (this.delegate) return this.delegate.requestBoard(metric);
    this.post({ t: 'board', metric });
  }

  like(targetId: number): void {
    if (this.delegate) return this.delegate.like(targetId);
    this.post({ t: 'like', id: targetId });
  }

  invite(targetId: number, gameType: number, wager: number): void {
    if (this.delegate) return this.delegate.invite(targetId, gameType, wager);
    this.post({ t: 'p2pInvite', request: { targetId, gameType, wager, extra: 0 } });
  }

  respond(inviteId: number, accept: boolean): void {
    if (this.delegate) return this.delegate.respond(inviteId, accept);
    this.post({ t: 'p2pRespond', request: { inviteId, accept } });
  }

  p2pAction(matchId: number, action: number): void {
    if (this.delegate) return this.delegate.p2pAction(matchId, action);
    this.post({ t: 'p2pAction', request: { matchId, action } });
  }

  tip(targetId: number, amount: number): void {
    if (this.delegate) return this.delegate.tip(targetId, amount);
    this.post({ t: 'tip', request: { targetId, amount } });
  }

  useItem(targetId: number, itemId: number): void {
    if (this.delegate) return this.delegate.useItem(targetId, itemId);
    this.post({ t: 'useItem', request: { targetId, itemId } });
  }

  buyShop(kind: number, id: number, count = 1): void {
    if (this.delegate) return this.delegate.buyShop(kind, id, count);
    this.post({ t: 'shopBuy', request: { kind, id, count } });
  }

  shout(text: string): void {
    if (this.delegate) return this.delegate.shout(text);
    this.post({ t: 'shout', text });
  }

  villaAction(villa: number, action: number): void {
    if (this.delegate) return this.delegate.villaAction(villa, action);
    this.post({ t: 'villa', request: { villa, action } });
  }

  apartmentAction(action: number): void {
    if (this.delegate) return this.delegate.apartmentAction(action);
    this.post({ t: 'apartment', request: { action, arg: 0 } });
  }

  /** 搬砖结算（ADR-0088）：只报连击数，金额由服务端算 */
  claimWork(combo: number): void {
    if (this.delegate) return this.delegate.claimWork(combo);
    this.post({ t: 'claimWork', combo });
  }

  /** 搬砖终端开关：把「正在倒计时」告诉渲染线程，点亮工位上那圈专注光 */
  setWorking(active: boolean): void {
    if (this.delegate) return this.delegate.setWorking(active);
    this.post({ t: 'working', active });
  }

  /** 领取每日悬赏 */
  claimQuest(questId: number): void {
    if (this.delegate) return this.delegate.claimQuest(questId);
    this.post({ t: 'claimQuest', questId });
  }

  /** 手动抢红包：自动拾取走会话层，这条只给「点界面上红包」用 */
  claimEvent(index: number): void {
    if (this.delegate) return this.delegate.claimEvent(index);
    this.post({ t: 'claimEvent', index });
  }

  vehicleAction(request: VehicleActionRequest): void {
    if (this.delegate) return this.delegate.vehicleAction(request);
    this.post({ t: 'vehicleAction', request });
  }

  clearStar(request: ClearStarRequest): void {
    if (this.delegate) return this.delegate.clearStar(request);
    this.post({ t: 'clearStar', request });
  }

  cpr(request: CprRequest): void {
    if (this.delegate) return this.delegate.cpr(request);
    this.post({ t: 'cpr', request });
  }

  fishingAction(request: FishingActionRequest): void {
    if (this.delegate) return this.delegate.fishingAction(request);
    this.post({ t: 'fishingAction', request });
  }

  graffiti(request: GraffitiRequest): void {
    if (this.delegate) return this.delegate.graffiti(request);
    this.post({ t: 'graffiti', request });
  }

  gigAction(request: GigActionRequest): void {
    if (this.delegate) return this.delegate.gigAction(request);
    this.post({ t: 'gigAction', request });
  }

  villaCustomize(request: VillaCustomizeRequest): void {
    if (this.delegate) return this.delegate.villaCustomize(request);
    this.post({ t: 'villaCustomize', request });
  }

  navigateTo(id: NavTargetId): void {
    if (this.delegate) return this.delegate.navigateTo(id);
    this.post({ t: 'navigate', id });
  }

  navigateHome(): void {
    if (this.delegate) return this.delegate.navigateHome();
    this.post({ t: 'navigateHome' });
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
        // 运行期才发现素材过期：同样走受控换图，不把开发者文案铺成红条
        if (message.code === 'atlas-version') {
          if (!reloadForStaleAssets()) callbacks.onStatus('error', STALE_ASSET_HINT);
          return;
        }
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
        callbacks.onLocalState({
          pose: message.pose,
          seated: message.seated,
          seatKind: message.seatKind,
          seatGroup: message.seatGroup,
        });
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
      case 'bossDown':
        callbacks.onBossDown?.(message.local);
        return;
      case 'bossReset':
        callbacks.onBossReset?.();
        return;
      case 'boardOpen':
        callbacks.onBoardOpen?.();
        return;
      case 'bulletinOpen':
        callbacks.onBulletinOpen?.();
        return;
      case 'directoryOpen':
        callbacks.onDirectoryOpen?.();
        return;
      case 'activity':
        callbacks.onActivity?.(message.event);
        return;
      case 'estateOpen':
        callbacks.onEstateBoardOpen?.();
        return;
      case 'wanted':
        callbacks.onWanted?.(message.packet);
        return;
      case 'vehicleState':
        callbacks.onVehicleState?.(message.packet);
        return;
      case 'ghost':
        callbacks.onGhost?.(message.packet);
        return;
      case 'fishing':
        callbacks.onFishing?.(message.packet);
        return;
      case 'turf':
        callbacks.onTurf?.(message.packet);
        return;
      case 'gig':
        callbacks.onGig?.(message.packet);
        return;
      case 'fall':
        callbacks.onFall?.(message.packet);
        return;
      case 'board':
        callbacks.onBoard?.(message.packet);
        return;
      case 'like':
        callbacks.onLike?.(message.packet);
        return;
      case 'wallet':
        callbacks.onWallet?.(message.packet);
        return;
      case 'p2pInvite':
        callbacks.onInvite?.(message.packet);
        return;
      case 'p2pInviteResult':
        callbacks.onInviteResult?.(message.packet);
        return;
      case 'p2pMatch':
        callbacks.onMatch?.(message.packet);
        return;
      case 'p2pShowdown':
        callbacks.onShowdown?.(message.packet);
        return;
      case 'p2pDuelState':
        callbacks.onDuelState?.(message.packet);
        return;
      case 'tip':
        callbacks.onTip?.(message.packet);
        return;
      case 'itemEffect':
        callbacks.onItemEffect?.(message.packet);
        return;
      case 'loudspeaker':
        callbacks.onLoudspeaker?.(message.packet);
        return;
      case 'shoutReject':
        callbacks.onShoutReject?.(message.packet);
        return;
      case 'itemReject':
        callbacks.onItemReject?.(message.packet);
        return;
      case 'interactReject':
        callbacks.onInteractReject?.(message.packet);
        return;
      case 'shopOpen':
        callbacks.onShopOpen?.(message.tab);
        return;
      case 'villa':
        callbacks.onVillaState?.(message.packet);
        return;
      case 'villaOpen':
        callbacks.onVillaOpen?.(message.villa);
        return;
      case 'workOpen':
        callbacks.onWorkOpen?.();
        return;
      case 'workResult':
        callbacks.onWorkResult?.(message.packet);
        return;
      case 'questState':
        callbacks.onQuestState?.(message.packet);
        return;
      case 'worldEvent':
        callbacks.onWorldEvent?.(message.packet);
        return;
      case 'eventClaim':
        callbacks.onEventClaim?.(message.packet);
        return;
      case 'bossShock':
        callbacks.onBossShock?.(message.packet);
        return;
      case 'clock':
        // 主线程自己的 serverNow 从来没对过时（pong 在 Worker 里），这里补上
        applyClockEpoch(message.epochMs, message.tzOffsetMin);
        return;
      case 'audio':
        applyAudioEvent(message.event, message.listenerX, message.listenerY);
        return;
      case 'snapshot':
        this.lastSnapshot = message.patch;
        this.snapshotDirty = true;
        return;
      case 'incenseDay':
        // 上香后 Worker 写不了存储：回落盘这条路，一个自然日只写一次
        writeIncenseDay(message.day);
        return;
      case 'build-check':
        // 渲染线程碰不到 window，版本检查交回主线程派发
        requestBuildCheck();
        return;
    }
  }
}
