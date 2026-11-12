'use client';

import { Container, Graphics, Text } from 'pixi.js';
import { BULLETIN_BOARD } from '@niuma/shared-types';
import { TICKER_HEIGHT, TICKER_WIDTH, tickerOffset, tickerSlot } from './bulletin-ticker';
import { tickerMessages } from './holiday-calendar';
import type { DepthSink } from './sort-layer';

export { TICKER_HEIGHT, TICKER_SLOT_MS, TICKER_SLOTS, TICKER_WIDTH, tickerOffset, tickerSlot } from './bulletin-ticker';

/**
 * 世界空间放假告示板（ADR-0059）：横幅中文 + 常驻薄荷绿跑马灯。
 *
 * 展板本体走道具管线（`props.ts` 的 `bulletin` kind），这里只负责两块**动态文本**：
 * 1. 红布横幅上的「放假就是生产力」——静态，但烘焙纹理装不下中文；
 * 2. 板顶的跑马灯——每秒刷新倒计时，每 6 秒平滑滚过一句，三句循环。
 *
 * 与 `welcome.ts` 同一条纪律：构造期建好 Text，帧循环只写 `x` / `text`，
 * 不生成节点、不创建纹理；DPR 变化走 `setTextResolution`。
 */

const CJK_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
/** 跑马灯：等宽字体优先，emoji 交给系统彩色字体兜底 */
const PIXEL_FONT =
  "'JetBrains Mono', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', monospace";

const COLOR = {
  ink: 0x1e2846,
  mint: 0x4fe3c1,
  mintGlow: 0xd9fff2,
  paper: 0xfff6e0,
} as const;

export class BulletinView {
  private readonly root = new Container();
  private readonly banner: Text;
  private readonly ticker = new Container();
  private readonly tickerMask = new Graphics();
  private readonly tickerText: Text;
  private elapsedMs = 0;
  private lastSecond = -1;
  private messages: readonly [string, string, string] = ['', '', ''];
  private destroyed = false;

  constructor(devicePxPerTexel: number) {
    this.root.position.set(BULLETIN_BOARD.x, BULLETIN_BOARD.y);

    /** 横幅文字：板面顶部红布的正中，5px 中文刚好塞进 48px 布面 */
    this.banner = new Text({
      text: '放假就是生产力',
      resolution: devicePxPerTexel,
      style: {
        fontFamily: CJK_FONT,
        fontSize: 5,
        fontWeight: '600',
        fill: COLOR.paper,
        letterSpacing: 1,
      },
    });
    this.banner.anchor.set(0.5, 0.5);
    this.banner.position.set(0, -(BULLETIN_BOARD.height - 5));
    this.root.addChild(this.banner);

    /** 跑马灯：深 ink 小底板 + 薄荷细边 + 可滚动文本 */
    const plate = new Graphics();
    plate.roundRect(-TICKER_WIDTH / 2 - 2, -TICKER_HEIGHT / 2, TICKER_WIDTH + 4, TICKER_HEIGHT, 2).fill({
      color: COLOR.ink,
      alpha: 0.82,
    });
    plate.roundRect(-TICKER_WIDTH / 2 - 2, -TICKER_HEIGHT / 2, TICKER_WIDTH + 4, TICKER_HEIGHT, 2).stroke({
      width: 1,
      color: COLOR.mint,
      alpha: 0.45,
    });
    this.ticker.addChild(plate);

    this.tickerText = new Text({
      text: '',
      resolution: devicePxPerTexel,
      style: {
        fontFamily: PIXEL_FONT,
        fontSize: 6,
        fontWeight: '600',
        fill: COLOR.mintGlow,
        letterSpacing: 0,
      },
    });
    this.tickerText.anchor.set(0, 0.5);
    this.ticker.addChild(this.tickerText);

    // 遮罩：只在 92×12 的窗口里显示，文字从右侧滑入、左侧滑出
    this.tickerMask.rect(-TICKER_WIDTH / 2, -TICKER_HEIGHT / 2, TICKER_WIDTH, TICKER_HEIGHT).fill(0xffffff);
    this.ticker.addChild(this.tickerMask);
    this.ticker.mask = this.tickerMask;
    // 板顶上方 8px：不压横幅，也不挡从北面走来的人
    this.ticker.position.set(0, -(BULLETIN_BOARD.height + 8));
    this.root.addChild(this.ticker);
  }

  /** 构造期一次：进深度层，与树、桌椅、角色共用同一套遮挡 */
  build(depth: DepthSink): void {
    // y+1：同一帧里排在告示板道具与同排角色之后，跑马灯永远露在最上面
    depth.add(BULLETIN_BOARD.y + 1, this.root);
  }

  /**
   * 每帧推进：滚动只写坐标；文案每整秒重算一次。
   * 文案来自 `tickerMessages`——与弹窗共用同一份纯函数，两处不会各说各话。
   */
  update(dtMs: number, now: number = Date.now()): void {
    if (this.destroyed) return;
    this.elapsedMs += Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0;

    const second = Math.floor((Number.isFinite(now) ? now : Date.now()) / 1000);
    if (second !== this.lastSecond) {
      this.lastSecond = second;
      const next = tickerMessages(Number.isFinite(now) ? now : Date.now());
      if (next[0] !== this.messages[0] || next[1] !== this.messages[1] || next[2] !== this.messages[2]) {
        this.messages = next;
      }
    }

    const slot = tickerSlot(this.elapsedMs);
    const text = this.messages[slot] ?? '';
    if (this.tickerText.text !== text) this.tickerText.text = text;
    this.tickerText.x = tickerOffset(this.elapsedMs, this.tickerText.width);
  }

  /** DPR 变化时重设位图分辨率，否则 6px 小字会被拉伸到 2 倍而发虚 */
  setTextResolution(devicePxPerTexel: number): void {
    if (this.banner.resolution !== devicePxPerTexel) this.banner.resolution = devicePxPerTexel;
    if (this.tickerText.resolution !== devicePxPerTexel) this.tickerText.resolution = devicePxPerTexel;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.destroy({ children: true });
  }
}
