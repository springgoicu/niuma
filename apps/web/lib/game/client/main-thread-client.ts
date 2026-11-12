import type { CharacterAppearance, NavTargetId, ResumeState } from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import { ACTION_CODE, type ActionKey } from '../input';
import { KeyboardInput } from '../input-keyboard';
import { drawMiniMap, MINIMAP_SIZE, prepareMiniMap, type MiniMapContext } from '../minimap-draw';
import { applyAudioEvent } from '../runtime/audio-sink';
import {
  createLocalControlBlock,
  createLocalControlWriter,
  type ControlBlock,
  type ControlWriter,
} from '../runtime/control-channel';
import type { EngineEnv, SessionProfile } from '../runtime/engine-env';
import { GameSession } from '../session';
import { saveSnapshot } from '../snapshot';
import type { GameClient, GameClientOptions } from './game-client';

/** 小地图与工牌详情的刷新节拍：与 Worker 模式保持一致 */
const SLOW_FRAME_MS = 250;

function readHostSize(host: HTMLElement): { width: number; height: number; dpr: number } {
  const rect = host.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
    dpr: window.devicePixelRatio || 1,
  };
}

/**
 * 主线程回退宿主。
 *
 * 跑的是**同一个** `GameSession`：端口实现换成主线程版本（直接写 localStorage、
 * 直接合成音频、直接量 DOM），输入仍走同一块控制内存。这样两条路径不会腐烂——
 * 回退路径每次发版都会被真实验证一次。
 */
export class MainThreadGameClient implements GameClient {
  private session: GameSession | null = null;
  private block: ControlBlock | null = null;
  private writer: ControlWriter | null = null;
  private keyboard: KeyboardInput | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private cleanup: Array<() => void> = [];
  private slowTimer: number | null = null;
  private minimapCtx: MiniMapContext | null = null;
  private minimapDpr = 1;
  private badgeId: number | null = null;
  private badgeCb: ((badge: PlayerBadge | null) => void) | null = null;
  private stopped = false;

  constructor(private readonly options: GameClientOptions) {}

  async start(host: HTMLElement, profile: SessionProfile, resume?: ResumeState): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'block h-full w-full';
    host.appendChild(canvas);
    this.canvas = canvas;

    const size = readHostSize(host);
    this.minimapDpr = size.dpr;
    const block = createLocalControlBlock();
    block.writeViewport(size.width, size.height, size.dpr);
    this.block = block;
    this.writer = createLocalControlWriter(block);

    const env: EngineEnv = {
      search: this.options.search,
      canvas,
      control: block,
      readViewport: (out) => block.readViewport(out),
      fontsReady: async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      },
      writeSnapshot: (patch) => {
        const park = this.options.parkId;
        // 落点按园区分区：换园区后这份快照会被 resumeForPark 判为不匹配而丢弃
        saveSnapshot({
          x: patch.x,
          y: patch.y,
          direction: patch.direction,
          pose: patch.pose,
          seatId: patch.seatId,
          ...(park ? { park } : {}),
        });
      },
      emitAudio: (event, listenerX, listenerY) => applyAudioEvent(event, listenerX, listenerY),
    };

    const session = new GameSession(this.options.callbacks, env, {
      wsUrl: this.options.wsUrl,
      parkId: this.options.parkId,
    });
    this.session = session;
    await session.start(profile, resume);
    if (this.stopped) return;

    this.keyboard = new KeyboardInput(this.writer, () => this.options.onRequestChat());
    this.keyboard.attach();

    const observer = new ResizeObserver(() => this.syncViewport(host));
    observer.observe(host);
    this.observer = observer;
    const onWindowResize = () => this.syncViewport(host);
    window.addEventListener('resize', onWindowResize);

    // 回退模式下引擎与宿主同线程：可见性只需要暂停 ticker
    const onVisibility = () => session.setSuspended(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);

    this.cleanup = [
      () => window.removeEventListener('resize', onWindowResize),
      () => document.removeEventListener('visibilitychange', onVisibility),
    ];

    // 小地图与工牌详情：同一套 4Hz 慢循环，绘制函数与 Worker 模式共用
    this.slowTimer = window.setInterval(() => {
      if (this.stopped) return;
      if (this.minimapCtx) drawMiniMap(this.minimapCtx, session.worldSnapshot());
      if (this.badgeId !== null) this.badgeCb?.(session.badgeOf(this.badgeId));
    }, SLOW_FRAME_MS);
  }

  attachMinimap(host: HTMLElement): void {
    // 与 Worker 模式同样的约定：画布由宿主创建，React 只提供容器
    const canvas = document.createElement('canvas');
    canvas.className = 'block';
    canvas.style.width = `${MINIMAP_SIZE}px`;
    canvas.style.height = `${MINIMAP_SIZE}px`;
    canvas.setAttribute('aria-hidden', 'true');
    host.replaceChildren(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    prepareMiniMap(ctx, this.minimapDpr);
    this.minimapCtx = ctx;
    if (this.session) drawMiniMap(ctx, this.session.worldSnapshot());
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.slowTimer !== null) window.clearInterval(this.slowTimer);
    this.slowTimer = null;
    this.keyboard?.detach();
    this.keyboard = null;
    this.observer?.disconnect();
    this.observer = null;
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.session?.stop();
    this.session = null;
    this.minimapCtx = null;
    this.canvas?.remove();
    this.canvas = null;
    this.badgeCb = null;
    this.badgeId = null;
  }

  setMoveVector(x: number, y: number): void {
    this.keyboard?.setMoveVector(x, y);
  }

  perform(action: ActionKey): void {
    // 与键盘共用同一个动作环：帧循环里只排空一处，不区分来源
    this.writer?.pushAction(ACTION_CODE[action]);
  }

  clearMovement(): void {
    this.keyboard?.clear();
    this.cancelNavigation();
  }

  sendChat(text: string): void {
    this.session?.sendChat(text);
  }

  requestHistory(beforeMsgId: number): void {
    this.session?.requestHistory(beforeMsgId);
  }

  setStatus(status: string): void {
    this.session?.setStatus(status);
  }

  setAppearance(appearance: CharacterAppearance): void {
    this.session?.setAppearance(appearance);
  }

  navigateTo(id: NavTargetId): void {
    this.session?.navigateTo(id);
  }

  cancelNavigation(): void {
    this.session?.cancelNavigation();
  }

  pick(stageX: number, stageY: number): void {
    const badge = this.session?.inspectAt(stageX, stageY) ?? null;
    this.options.onPick(badge?.id ?? null);
  }

  subscribeBadge(id: number | null, onChange: (badge: PlayerBadge | null) => void): void {
    this.badgeId = id;
    this.badgeCb = id === null ? null : onChange;
  }

  retry(): void {
    this.session?.retry();
  }

  private syncViewport(host: HTMLElement): void {
    if (!this.writer) return;
    const next = readHostSize(host);
    this.minimapDpr = next.dpr;
    this.writer.writeViewport(next.width, next.height, next.dpr);
  }
}
