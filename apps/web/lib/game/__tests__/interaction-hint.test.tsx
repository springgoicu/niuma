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
    expect(html).toContain('min-h-8');
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

  it('告示板提示继续落在右下角，通用提示在底部居中', () => {
    const bulletinDesktop = render(HINT.bulletin);
    expect(bulletinDesktop).toContain('bottom-28 right-4');
    expect(bulletinDesktop).not.toContain('left-1/2');

    const bulletinPortrait = render(HINT.bulletin, false, true);
    expect(bulletinPortrait).toContain('bottom-[300px] right-3');

    const bulletinTouch = render(HINT.bulletin, true);
    expect(bulletinTouch).toContain('bottom-56 right-3');
    expect(bulletinTouch).not.toContain('left-1/2');

    expect(render(HINT.seat)).toContain('left-1/2');
    expect(render(HINT.seat, true)).toContain('left-1/2');
    expect(render(HINT.seat, true)).toContain('bottom-56');
    expect(render(HINT.seat, false, true)).toContain('bottom-[296px]');
  });

  it('桌面端提示抬到动作条上方并带层级，不会被读成动作条的一部分', () => {
    const html = render(HINT.seat);
    expect(html).toContain('bottom-[112px]');
    expect(html).not.toContain('bottom-24 ');
    expect(html).toContain('z-30');
  });
});
