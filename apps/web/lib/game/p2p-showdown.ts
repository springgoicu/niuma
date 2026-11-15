import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  P2P_ACTION,
  P2P_DICE_ROLL_MS,
  P2P_DUEL_FLAG_FINISHED,
  P2P_DUEL_HP,
  P2P_GAME_TYPE,
  P2P_SHOWDOWN_FLAG_TIE,
  type P2PDuelStatePacket,
  type P2PShowdownPacket,
} from '@niuma/shared-types';

/** 渲染层只依赖这三个公开成员，不反向 import GameRenderer，避免循环依赖 */
export interface P2PAnchor {
  readonly p2p: Container;
  readonly p2pTopY: number;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const INK = '#2b2118';
const CREAM = '#f7e7c6';
const GOLD = '#f2c879';
const GREEN = '#3fbf6f';
const RED = '#e75c4a';

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return document.createElement('canvas');
}

function paint(width: number, height: number, draw: (ctx: Canvas2D) => void): Texture {
  const canvas = makeCanvas(width, height);
  const ctx = (canvas as HTMLCanvasElement).getContext('2d') as Canvas2D;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const texture = Texture.from(canvas as unknown as HTMLCanvasElement);
  texture.source.scaleMode = 'nearest';
  return texture;
}

const PIP: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[8, 8]],
  2: [[5, 5], [11, 11]],
  3: [[5, 5], [8, 8], [11, 11]],
  4: [[5, 5], [11, 5], [5, 11], [11, 11]],
  5: [[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]],
  6: [[5, 5], [11, 5], [5, 8], [11, 8], [5, 11], [11, 11]],
};

let diceCache: Texture[] | null = null;
function diceTextures(): Texture[] {
  if (diceCache) return diceCache;
  diceCache = [];
  // 1..6：16×16 的纯像素骰面，边框 1px，点 2×2
  diceCache.push(
    paint(16, 16, () => undefined),
  );
  for (let face = 1; face <= 6; face += 1) {
    diceCache.push(
      paint(16, 16, (ctx) => {
        ctx.fillStyle = INK;
        ctx.fillRect(1, 1, 14, 14);
        ctx.fillStyle = CREAM;
        ctx.fillRect(2, 2, 12, 12);
        ctx.fillStyle = INK;
        for (const [x, y] of PIP[face]!) ctx.fillRect(x, y, 2, 2);
      }),
    );
  }
  return diceCache;
}

let gestureCache: Texture[] | null = null;
function gestureTextures(): Texture[] {
  if (gestureCache) return gestureCache;
  gestureCache = [
    paint(20, 20, () => undefined),
    // 石头：握拳
    paint(20, 20, (ctx) => {
      ctx.fillStyle = INK;
      ctx.fillRect(3, 6, 14, 11);
      ctx.fillStyle = CREAM;
      ctx.fillRect(4, 7, 12, 9);
      ctx.fillStyle = INK;
      ctx.fillRect(7, 3, 3, 5);
      ctx.fillRect(11, 3, 3, 5);
      ctx.fillRect(5, 12, 10, 1);
    }),
    // 剪刀：两根手指的 V
    paint(20, 20, (ctx) => {
      ctx.fillStyle = INK;
      ctx.fillRect(4, 3, 4, 12);
      ctx.fillRect(12, 3, 4, 12);
      ctx.fillRect(6, 12, 8, 5);
      ctx.fillStyle = CREAM;
      ctx.fillRect(5, 4, 2, 9);
      ctx.fillRect(13, 4, 2, 9);
      ctx.fillRect(7, 13, 6, 3);
    }),
    // 布：摊开的手掌
    paint(20, 20, (ctx) => {
      ctx.fillStyle = INK;
      ctx.fillRect(4, 4, 12, 13);
      ctx.fillStyle = CREAM;
      ctx.fillRect(5, 5, 10, 11);
      ctx.fillStyle = INK;
      for (let i = 0; i < 4; i += 1) ctx.fillRect(6 + i * 2, 5, 1, 5);
      ctx.fillRect(5, 12, 10, 1);
    }),
  ];
  return gestureCache;
}

/** 3×5 的极小字母表：WIN / LOSE / TIE 用纯像素拼，不依赖字体 */
const GLYPH: Record<string, readonly string[]> = {
  W: ['101', '101', '101', '111', '101'],
  I: ['111', '010', '010', '010', '111'],
  N: ['101', '111', '111', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  O: ['111', '101', '101', '101', '111'],
  S: ['111', '100', '111', '001', '111'],
  E: ['111', '100', '110', '100', '111'],
  T: ['111', '010', '010', '010', '010'],
};

const flagCache = new Map<string, Texture>();
function flagTexture(text: string, color: string): Texture {
  const key = `${text}:${color}`;
  const cached = flagCache.get(key);
  if (cached) return cached;
  const width = text.length * 4 + 3;
  const texture = paint(width, 7, (ctx) => {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, width, 7);
    ctx.fillStyle = CREAM;
    ctx.fillRect(1, 1, width - 2, 5);
    ctx.fillStyle = color;
    for (let i = 0; i < text.length; i += 1) {
      const glyph = GLYPH[text[i]!]!;
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          if (glyph[row]![col] === '1') ctx.fillRect(2 + i * 4 + col, 1 + row, 1, 1);
        }
      }
    }
  });
  flagCache.set(key, texture);
  return texture;
}

interface Showcase {
  entityId: number;
  view: P2PAnchor;
  container: Container;
  start: number;
  duration: number;
  gameType: number;
  winnerId: number;
  participantId: number;
  dice: Sprite[];
  finalDice: number[];
  gesture: Sprite | null;
  flag: Sprite;
  nextRollAt: number;
}

interface DuelHud {
  view: P2PAnchor;
  container: Container;
  fill: Graphics;
  timer: Text;
  hp: number;
  maxHp: number;
  remainingMs: number;
  receivedAt: number;
  lastWidth: number;
}

interface CoinFloat {
  text: Text;
  start: number;
  baseY: number;
}

const DIE_OFFSETS = [-18, 0, 18];

/** 头顶 P2P 演出：同一实体同一时间只保留一份亮牌，血条与飘字独立叠加 */
export class P2PFx {
  private readonly shows = new Map<number, Showcase>();
  private readonly huds = new Map<number, DuelHud>();
  private readonly floats = new Map<number, CoinFloat[]>();

  show(views: ReadonlyMap<number, P2PAnchor>, packet: P2PShowdownPacket): void {
    for (const participantId of [packet.aId, packet.bId]) {
      const view = views.get(participantId);
      if (!view) continue;
      this.clearShow(participantId);

      const container = new Container();
      container.position.set(0, view.p2pTopY);
      const diceSprites: Sprite[] = [];
      const finalDice =
        participantId === packet.aId ? packet.dice.slice(0, 3) : packet.dice.slice(3, 6);
      if (packet.gameType === P2P_GAME_TYPE.Dice) {
        for (let i = 0; i < 3; i += 1) {
          const sprite = new Sprite(diceTextures()[1]);
          sprite.anchor.set(0.5, 1);
          sprite.scale.set(2);
          sprite.position.set(DIE_OFFSETS[i]!, 0);
          diceSprites.push(sprite);
          container.addChild(sprite);
        }
      }

      let gesture: Sprite | null = null;
      if (packet.gameType === P2P_GAME_TYPE.Rps) {
        const action = participantId === packet.aId ? packet.aAction : packet.bAction;
        gesture = new Sprite(gestureTextures()[action] ?? gestureTextures()[P2P_ACTION.Rock]!);
        gesture.anchor.set(0.5, 1);
        gesture.scale.set(3);
        gesture.visible = false;
        container.addChild(gesture);
      }

      const tie = (packet.flags & P2P_SHOWDOWN_FLAG_TIE) !== 0;
      const won = packet.winnerId === participantId;
      const flagText = tie ? 'TIE' : won ? 'WIN' : 'LOSE';
      const flag = new Sprite(flagTexture(flagText, tie ? GOLD : won ? GREEN : RED));
      flag.anchor.set(0.5, 1);
      flag.scale.set(2);
      const flagY =
        packet.gameType === P2P_GAME_TYPE.Duel
          ? 0
          : packet.gameType === P2P_GAME_TYPE.Rps
            ? -66
            : -44;
      flag.position.set(0, flagY);
      flag.visible = false;
      container.addChild(flag);

      view.p2p.addChild(container);
      this.shows.set(participantId, {
        entityId: participantId,
        view,
        container,
        start: performance.now(),
        // 骰子先滚 1.5s，再让最终点数与 WIN/LOSE 完整停留 durationMs
        duration:
          Math.max(1_000, packet.durationMs) +
          (packet.gameType === P2P_GAME_TYPE.Dice ? P2P_DICE_ROLL_MS : 0),
        gameType: packet.gameType,
        winnerId: packet.winnerId,
        participantId,
        dice: diceSprites,
        finalDice,
        gesture,
        flag,
        nextRollAt: 0,
      });
    }
  }

  duel(views: ReadonlyMap<number, P2PAnchor>, packet: P2PDuelStatePacket): void {
    const finished = (packet.flags & P2P_DUEL_FLAG_FINISHED) !== 0;
    for (const participantId of [packet.aId, packet.bId]) {
      const view = views.get(participantId);
      if (!view) continue;
      const hp = participantId === packet.aId ? packet.hpA : packet.hpB;
      if (finished) {
        this.clearHud(participantId);
        continue;
      }
      let hud = this.huds.get(participantId);
      if (!hud) {
        const container = new Container();
        container.position.set(0, view.p2pTopY);
        const bg = new Graphics();
        bg.rect(-22, -6, 44, 6).fill(0x1a120e);
        bg.rect(-21, -5, 42, 4).fill(0x3a2a1e);
        const fill = new Graphics();
        const timer = new Text({
          text: '',
          style: {
            fontFamily: 'monospace',
            fontSize: 8,
            fontWeight: '700',
            fill: 0xf7e7c6,
            stroke: { color: 0x1a120e, width: 2 },
          },
        });
        timer.anchor.set(0.5, 1);
        timer.position.set(0, -8);
        container.addChild(bg, fill, timer);
        view.p2p.addChild(container);
        hud = {
          view,
          container,
          fill,
          timer,
          hp,
          maxHp: P2P_DUEL_HP,
          remainingMs: packet.remainingMs,
          receivedAt: performance.now(),
          lastWidth: -1,
        };
        this.huds.set(participantId, hud);
      }
      hud.hp = hp;
      hud.remainingMs = packet.remainingMs;
      hud.receivedAt = performance.now();
      hud.container.position.y = view.p2pTopY;
      this.paintHud(hud);
    }
  }

  coin(views: ReadonlyMap<number, P2PAnchor>, entityId: number, amount: number): void {
    const view = views.get(entityId);
    if (!view) return;
    const text = new Text({
      text: `${amount >= 0 ? '+' : ''}${amount}币`,
      style: {
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: '700',
        fill: amount >= 0 ? 0xffd166 : 0xff8a7a,
        stroke: { color: 0x1a120e, width: 3 },
      },
    });
    text.anchor.set(0.5, 1);
    const baseY = view.p2pTopY;
    text.position.set(0, baseY);
    view.p2p.addChild(text);
    const list = this.floats.get(entityId) ?? [];
    list.push({ text, start: performance.now(), baseY });
    this.floats.set(entityId, list);
  }

  update(now: number): void {
    for (const [id, show] of [...this.shows]) {
      const elapsed = now - show.start;
      if (elapsed >= show.duration) {
        this.clearShow(id);
        continue;
      }
      show.container.position.y = show.view.p2pTopY;
      const revealAt = show.gameType === P2P_GAME_TYPE.Dice ? P2P_DICE_ROLL_MS : 350;
      if (show.gameType === P2P_GAME_TYPE.Dice && elapsed < revealAt) {
        if (now >= show.nextRollAt) {
          show.nextRollAt = now + 90;
          for (const die of show.dice) die.texture = diceTextures()[1 + Math.floor(Math.random() * 6)]!;
        }
      } else if (show.gameType === P2P_GAME_TYPE.Dice) {
        for (let i = 0; i < show.dice.length; i += 1) {
          show.dice[i]!.texture = diceTextures()[show.finalDice[i] ?? 1]!;
        }
      }
      if (show.gesture && elapsed >= revealAt) show.gesture.visible = true;
      if (elapsed >= revealAt) {
        show.flag.visible = true;
        const pop = Math.min(1, (elapsed - revealAt) / 180);
        const scale = 1.7 + Math.sin(pop * Math.PI) * 0.5;
        show.flag.scale.set(scale);
      }
      show.container.alpha = elapsed > show.duration - 600 ? (show.duration - elapsed) / 600 : 1;
    }

    for (const [id, hud] of [...this.huds]) {
      hud.remainingMs = Math.max(0, hud.remainingMs - (now - hud.receivedAt));
      hud.receivedAt = now;
      hud.container.position.y = hud.view.p2pTopY;
      this.paintHud(hud);
      if (hud.remainingMs <= 0) this.clearHud(id);
    }

    for (const [id, list] of [...this.floats]) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const item = list[i]!;
        const age = now - item.start;
        if (age >= 900) {
          item.text.destroy();
          list.splice(i, 1);
          continue;
        }
        item.text.position.y = item.baseY - Math.round((age / 900) * 34);
        item.text.alpha = 1 - age / 900;
      }
      if (list.length === 0) this.floats.delete(id);
    }
  }

  /** 对局结束：血条不能留到下一局；亮牌仍按自己的 4s 时间自然淡出 */
  clearDuelHuds(): void {
    for (const id of [...this.huds.keys()]) this.clearHud(id);
  }

  drop(entityId: number): void {
    this.clearShow(entityId);
    this.clearHud(entityId);
    const list = this.floats.get(entityId);
    if (list) {
      for (const item of list) item.text.destroy();
      this.floats.delete(entityId);
    }
  }

  private paintHud(hud: DuelHud): void {
    const ratio = Math.max(0, Math.min(1, hud.hp / hud.maxHp));
    const width = Math.round(42 * ratio);
    if (width !== hud.lastWidth) {
      hud.lastWidth = width;
      hud.fill.clear();
      if (width > 0) {
        const color = ratio > 0.5 ? 0x3fbf6f : ratio > 0.25 ? 0xf2c879 : 0xe75c4a;
        hud.fill.rect(-21, -5, width, 4).fill(color);
      }
    }
    const seconds = Math.ceil(hud.remainingMs / 1000);
    const text = `${seconds}s`;
    if (hud.timer.text !== text) hud.timer.text = text;
  }

  private clearShow(entityId: number): void {
    const show = this.shows.get(entityId);
    if (!show) return;
    this.shows.delete(entityId);
    show.container.destroy({ children: true });
  }

  private clearHud(entityId: number): void {
    const hud = this.huds.get(entityId);
    if (!hud) return;
    this.huds.delete(entityId);
    hud.container.destroy({ children: true });
  }
}
