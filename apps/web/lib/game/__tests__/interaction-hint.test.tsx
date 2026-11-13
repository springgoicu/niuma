import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InteractionHint } from '../../../components/game/InteractionHint';
import { HINT } from '../hint-copy';

/** 服务端静态渲染：只断言产出结构，不依赖浏览器事件 */
function render(hint: string, isTouch = false, portrait = false): string {
  return renderToStaticMarkup(
    <InteractionHint hint={hint} isTouch={isTouch} portrait={portrait} onAction={() => {}} />,
  );
}

describe('设施互动提示', () => {
  it('桌面端把可互动提示渲染成带键帽、动作名与「点击」的按钮', () => {
    const html = render(HINT.seat);
    expect(html).toContain('<button');
    expect(html).toContain('aria-keyshortcuts="Z"');
    expect(html).toContain('<kbd');
    expect(html).toContain('>Z</kbd>');
    expect(html).toContain('坐下');
    expect(html).toContain('点击');
    expect(html).toContain('min-h-14');
    expect(html).not.toContain('role="status"');
  });

  it('触屏端不显示键帽，改用「轻点」', () => {
    const html = render(HINT.bed, true);
    expect(html).toContain('<button');
    expect(html).toContain('aria-keyshortcuts="X"');
    expect(html).toContain('躺平');
    expect(html).toContain('轻点');
    expect(html).toContain('min-h-10');
    expect(html).not.toContain('<kbd');
    expect(html).not.toContain('点击');
  });

  it('每条可互动提示都产出按钮', () => {
    for (const hint of [
      HINT.seat,
      HINT.toilet,
      HINT.bed,
      HINT.board,
      HINT.bulletin,
      HINT.interact,
      HINT.shrine,
      HINT.tea,
    ]) {
      expect(render(hint)).toContain('<button');
    }
  });

  it('劝阻与状态文案保持纯文本，不产出按钮', () => {
    for (const hint of [HINT.lieOnSeat, HINT.sitOnBed, HINT.bedOnly, '移动即可起身', '附近没有可互动的设施']) {
      const html = render(hint);
      expect(html).not.toContain('<button');
      expect(html).toContain('role="status"');
    }
  });

  it('电脑端提示统一落在画面中线偏下，告示板也在同一位置', () => {
    for (const hint of [HINT.seat, HINT.board, HINT.bulletin, HINT.bed]) {
      const html = render(hint);
      expect(html).toContain('left-1/2');
      expect(html).toContain('top-[62%]');
      expect(html).toContain('-translate-y-1/2');
      expect(html).not.toContain('bottom-56');
    }
    // 桌面窗口拉成竖长条仍按电脑端处理，不退回触屏的底部偏移
    expect(render(HINT.seat, false, true)).toContain('top-[62%]');
    expect(render(HINT.seat, false, true)).not.toContain('bottom-[296px]');
  });

  it('触屏落位保持原样：告示板贴右下角，其余底部居中', () => {
    const bulletinLandscape = render(HINT.bulletin, true);
    expect(bulletinLandscape).toContain('bottom-56 right-3');
    expect(bulletinLandscape).not.toContain('left-1/2');

    const bulletinPortrait = render(HINT.bulletin, true, true);
    expect(bulletinPortrait).toContain('bottom-[300px] right-3');

    const seatLandscape = render(HINT.seat, true);
    expect(seatLandscape).toContain('left-1/2');
    expect(seatLandscape).toContain('bottom-56');
    expect(seatLandscape).not.toContain('top-[62%]');

    expect(render(HINT.seat, true, true)).toContain('bottom-[296px]');
  });

  it('电脑端提示放大一档并带层级，不会被读成动作条的一部分', () => {
    const html = render(HINT.seat);
    expect(html).toContain('min-h-14');
    expect(html).toContain('text-[15px]');
    expect(html).toContain('h-8');
    expect(html).toContain('z-30');
    expect(html).not.toContain('bottom-[112px]');
    expect(html).not.toContain('bottom-24 ');
  });

  it('电脑端状态胶囊同步放大，触屏尺寸不变', () => {
    expect(render(HINT.lieOnSeat)).toContain('text-[13px]');
    expect(render(HINT.lieOnSeat, true)).toContain('text-[10px]');
    expect(render(HINT.bed, true)).toContain('min-h-10');
  });
});
