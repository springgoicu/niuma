import { atlasErrorCodeOf } from '../atlas-errors';
import { GameSession, type ChatEntry } from '../session';
import { drawMiniMap, prepareMiniMap, type MiniMapContext } from '../minimap-draw';
import { ControlBlock } from './control-channel';
import type { EngineEnv } from './engine-env';
import type { MainToWorker, WorkerToMain } from './worker-protocol';

/** Worker 全局里我们真正用到的那几个成员：`lib: dom` 下没有 DedicatedWorkerGlobalScope 类型 */
export interface WorkerScope {
  postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MainToWorker>) => void): void;
}

/** 小地图与工牌详情的刷新节拍：4Hz，主线程完全不再参与 */
const SLOW_FRAME_MS = 250;
/**
 * 时钟转发节流（ADR-0081）。
 *
 * 心跳是 1Hz，但主线程只用这份时钟画 HUD 倒计时与「今天」的切日，
 * 5 秒一次足够把误差压在毫秒级；时区变了（重启换部署）则立刻补发。
 */
const CLOCK_FORWARD_MS = 5_000;

/**
 * 渲染线程的宿主。
 *
 * 它只做三件事：
 * 1. 把 `EngineEnv` 的三个平台能力落到「控制块 + 一条消息」上；
 * 2. 把 `GameSession` 的回调翻成 `WorkerToMain` 消息；
 * 3. 管住小地图 / 工牌这两个 4Hz 的慢循环与暂停、销毁。
 *
 * 引擎本身不知道自己在 Worker 里——回退到主线程时跑的是同一个 `GameSession`。
 */
export function runWorkerHost(scope: WorkerScope): void {
  let session: GameSession | null = null;
  let control: ControlBlock | null = null;
  let minimapCtx: MiniMapContext | null = null;
  let minimapDpr = 1;
  let inspectId: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let slowTick = 0;
  let paused = false;
  let disposed = false;

  const post = (message: WorkerToMain): void => scope.postMessage(message);

  const drawMinimap = (): void => {
    if (!session || !minimapCtx) return;
    drawMiniMap(minimapCtx, session.worldSnapshot());
  };

  const slowFrame = (): void => {
    if (paused || disposed) return;
    drawMinimap();
    // 工牌档案字段多，降为 2Hz；小地图仍 4Hz，视觉上不能变卡
    slowTick = (slowTick + 1) % 2;
    if (slowTick !== 0) return;
    // 工牌详情只在被查看时推送，收起后不再产生任何消息
    if (inspectId !== null && session) {
      post({ t: 'badge', id: inspectId, badge: session.badgeOf(inspectId) });
    }
  };

  const attachMinimap = (canvas: OffscreenCanvas): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    prepareMiniMap(ctx, minimapDpr);
    minimapCtx = ctx;
    drawMinimap();
  };

  const start = (message: Extract<MainToWorker, { t: 'init' }>): void => {
    control = new ControlBlock(message.control ?? undefined);
    // 私有控制块（无跨源隔离）时 init 是视口的唯一来源；共享内存时这里写的是同一块内存，幂等
    control.writeViewport(message.width, message.height, message.dpr);
    minimapDpr = message.dpr;
    // 小地图可能比 init 早到（组件先挂载）：那时 DPR 还是默认值，这里补一次变换
    if (minimapCtx) prepareMiniMap(minimapCtx, minimapDpr);

    const block = control;
    /** 首次一定放行：`-Infinity` 让「刚连上」这一拍不受节流影响 */
    let clockForwardAt = Number.NEGATIVE_INFINITY;
    let clockForwardTz = Number.NaN;
    const env: EngineEnv = {
      search: message.search,
      canvas: message.canvas,
      control: block,
      readViewport: (out) => block.readViewport(out),
      fontsReady: readFontsReady,
      // 偏好由主线程读盘后随 init 带进来：Worker 碰不到 localStorage
      danmakuPrefs: message.danmaku,
      // 当日首香标记同理：读盘在主线程，写回也交回主线程
      incenseDay: message.incenseDay,
      deviceId: message.deviceId,
      writeIncenseDay: (day) => post({ t: 'incenseDay', day }),
      writeSnapshot: (patch) => {
        block.writeSnapshot(patch);
        // 没有共享内存时主线程读不到这块私有内存，另发一条定长消息由它落盘
        if (!block.isShared) post({ t: 'snapshot', patch });
      },
      emitAudio: (event, listenerX, listenerY) => post({ t: 'audio', event, listenerX, listenerY }),
      requestBuildCheck: () => post({ t: 'build-check' }),
    };

    session = new GameSession(
      {
        onStatus: (status, detail) => post({ t: 'status', status, detail: detail ?? '' }),
        onQueue: (queue) => post({ t: 'queue', queue }),
        onRejected: (reason) => post({ t: 'rejected', reason }),
        onStats: (stats) => post({ t: 'stats', stats }),
        onChat: (entry: ChatEntry) => post({ t: 'chat', entry }),
        onChatHistory: (entries, meta) =>
          post({ t: 'history', entries, replace: meta.replace, hasMore: meta.hasMore }),
        onHint: (hint) => post({ t: 'hint', hint }),
        onLocalState: ({ pose, seated, seatKind, seatGroup }) =>
          post({ t: 'localState', pose, seated, seatKind, seatGroup }),
        onNav: (nav) => post({ t: 'nav', nav }),
        onVentHit: (local) => post({ t: 'ventHit', local }),
        onVentDealt: () => post({ t: 'ventDealt' }),
        onBossDown: (local) => post({ t: 'bossDown', local }),
        onBossReset: () => post({ t: 'bossReset' }),
        onBoardOpen: () => post({ t: 'boardOpen' }),
        onBulletinOpen: () => post({ t: 'bulletinOpen' }),
        onBoard: (packet) => post({ t: 'board', packet }),
        onLike: (packet) => post({ t: 'like', packet }),
        onRing: (packet, receivedAt) => post({ t: 'ring', packet, receivedAt }),
        onWallet: (packet) => post({ t: 'wallet', packet }),
        onInvite: (packet) => post({ t: 'p2pInvite', packet }),
        onInviteResult: (packet) => post({ t: 'p2pInviteResult', packet }),
        onMatch: (packet) => post({ t: 'p2pMatch', packet }),
        onShowdown: (packet) => post({ t: 'p2pShowdown', packet }),
        onDuelState: (packet) => post({ t: 'p2pDuelState', packet }),
        onTip: (packet) => post({ t: 'tip', packet }),
        onItemEffect: (packet) => post({ t: 'itemEffect', packet }),
        onLoudspeaker: (packet) => post({ t: 'loudspeaker', packet }),
        onShoutReject: (packet) => post({ t: 'shoutReject', packet }),
        onItemReject: (packet) => post({ t: 'itemReject', packet }),
        // 茶台 F：把「开面板」这个 React 侧的意图交回主线程
        onShopOpen: (tab) => post({ t: 'shopOpen', tab }),
        // 热区建筑（ADR-0087）：开面板意图与下行快照都要透传，漏一条 Worker 模式就丢包
        onDiceOpen: (table) => post({ t: 'diceOpen', table }),
        onArenaBetOpen: () => post({ t: 'arenaBetOpen' }),
        onVillaOpen: (villa) => post({ t: 'villaOpen', villa }),
        onDiceState: (packet) => post({ t: 'dice', packet }),
        onVillaState: (packet) => post({ t: 'villa', packet }),
        onArenaPool: (packet) => post({ t: 'arenaPool', packet }),
        // 打工产出与随机事件（ADR-0088）
        onWorkOpen: () => post({ t: 'workOpen' }),
        onWorkResult: (packet) => post({ t: 'workResult', packet }),
        onQuestState: (packet) => post({ t: 'questState', packet }),
        onWorldEvent: (packet) => post({ t: 'worldEvent', packet }),
        onEventClaim: (packet) => post({ t: 'eventClaim', packet }),
        onBossShock: (packet) => post({ t: 'bossShock', packet }),
        onClock: (sample) => {
          const now = performance.now();
          if (clockForwardTz === sample.tzOffsetMin && now - clockForwardAt < CLOCK_FORWARD_MS) {
            return;
          }
          clockForwardAt = now;
          clockForwardTz = sample.tzOffsetMin;
          post({ t: 'clock', epochMs: sample.epochMs, tzOffsetMin: sample.tzOffsetMin });
        },
      },
      env,
      { wsUrl: message.wsUrl, parkId: message.parkId },
    );

    void session
      .start(message.profile, message.resume)
      .then(() => {
        if (disposed) return;
        post({ t: 'ready', backend: session?.backend ?? 'initializing' });
        drawMinimap();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : '渲染线程初始化失败';
        // 图集版本错配 = 页面已过期，不是渲染线程坏了：打上 code 让主线程换图，
        // 而不是把「请重跑 pnpm assets」这种开发者文案直接铺到玩家脸上。
        if (atlasErrorCodeOf(error) === 'version-mismatch') {
          post({ t: 'status', status: 'error', detail, code: 'atlas-version' });
          return;
        }
        post({ t: 'status', status: 'error', detail });
      });

    timer = setInterval(slowFrame, SLOW_FRAME_MS);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    session?.stop();
    session = null;
    minimapCtx = null;
    control = null;
    scope.close();
  };

  scope.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.t) {
      case 'init':
        if (!session) start(message);
        return;
      case 'minimap':
        attachMinimap(message.canvas);
        return;
      case 'control':
        control?.apply(message.message);
        return;
      case 'chat':
        session?.sendChat(message.packet.text, message.packet.colorIndex, message.packet.danmakuMode);
        return;
      case 'danmaku':
        session?.setDanmakuPrefs(message.prefs);
        return;
      case 'history':
        session?.requestHistory(message.cursor);
        return;
      case 'status':
        session?.setStatus(message.text);
        return;
      case 'name':
        session?.setName(message.text);
        return;
      case 'appearance':
        session?.setAppearance(message.appearance);
        return;
      case 'career':
        session?.updateCareer(message.career);
        return;
      case 'board':
        session?.requestBoard(message.metric);
        return;
      case 'like':
        session?.like(message.id);
        return;
      case 'p2pInvite':
        session?.inviteDuel(
          message.request.targetId,
          message.request.gameType,
          message.request.wager,
        );
        return;
      case 'p2pRespond':
        session?.respondInvite(message.request.inviteId, message.request.accept);
        return;
      case 'p2pAction':
        session?.p2pAction(message.request.matchId, message.request.action);
        return;
      case 'tip':
        session?.tip(message.request.targetId, message.request.amount);
        return;
      case 'useItem':
        session?.useItem(message.request.targetId, message.request.itemId);
        return;
      case 'shopBuy':
        session?.buyShop(
          message.request.kind,
          message.request.id,
          message.request.count,
        );
        return;
      case 'shout':
        session?.shout(message.text);
        return;
      case 'diceBet':
        session?.placeDiceBet(message.request.table, message.request.side, message.request.amount);
        return;
      case 'villa':
        session?.villaAction(message.request.villa, message.request.action);
        return;
      case 'arenaBet':
        session?.placeArenaBet(message.request.side, message.request.amount);
        return;
      case 'apartment':
        if (message.request.action === 1) session?.exitApartment();
        else session?.enterApartment();
        return;
      case 'claimWork':
        session?.claimWork(message.combo);
        return;
      case 'working':
        session?.setWorking(message.active);
        return;
      case 'claimQuest':
        session?.claimQuest(message.questId);
        return;
      case 'claimEvent':
        session?.claimEvent(message.index);
        return;
      case 'navigate':
        session?.navigateTo(message.id);
        return;
      case 'navigateHome':
        session?.navigateHome();
        return;
      case 'cancelNav':
        session?.cancelNavigation();
        return;
      case 'pick': {
        const badge = session?.pickAt(message.x, message.y) ?? null;
        // 首帧直接带工牌：主线程不用先开一个空弹窗等 250ms 的第一次推送
        post({ t: 'picked', id: badge?.id ?? null, badge });
        return;
      }
      case 'inspect':
        inspectId = message.id;
        return;
      case 'retry':
        session?.retry();
        return;
      case 'pause':
        paused = message.paused;
        session?.setSuspended(message.paused);
        return;
      case 'dispose':
        dispose();
        return;
    }
  });
}

/**
 * Worker 侧的字体就绪。
 *
 * 字体由 `font-bootstrap.ts` 与宿主并行注册，这里等 `fonts.ready`。
 * 但 Chrome 的 Worker `FontFaceSet.ready` 有个坑：手动 `fonts.add()` 之后
 * `status` 已是 `loaded`、`size` 也对，这个 Promise 却可能永远不 resolve
 * （CDP 实测 Promise.race 判为 TIMEOUT）。没有上限会让 `renderer.init()`
 * 永久挂起，NetClient 根本没机会创建，页面一直停在「正在接入园区…」。
 * 宁可字宽略有差异，也不能把入场卡死。
 */
async function readFontsReady(): Promise<void> {
  const fonts = (globalThis as { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.race([
      fonts.ready,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 1500);
      }),
    ]);
  } catch {
    // fonts.ready 只会 reject 在极端情况下，吞掉继续
  }
}
