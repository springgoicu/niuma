import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BulletinModal } from '../../../components/BulletinModal';

/**
 * 告示板弹窗的静态渲染：
 * 只钉结构与文案，不模拟点击——敲击逻辑在 `almanac-store` 的纯函数里已被覆盖。
 */
function render(): string {
  return renderToStaticMarkup(<BulletinModal onClose={() => {}} />);
}

describe('牛马放假告示板弹窗', () => {
  it('是模态对话框，三个板块都在', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('牛马放假告示板');
    expect(html).toContain('本周下班冲刺');
    expect(html).toContain('最近重大假日');
    expect(html).toContain('今日牛马老黄历');
  });

  it('本周冲刺给的是秒级时钟、进度条与起止刻度', () => {
    const html = render();
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('本周工时已消耗');
    expect(html).toContain('周一 09:00');
    expect(html).toContain('周五 18:00');
  });

  it('黄历带宜忌标签与评语，日期口径写在标题旁', () => {
    const html = render();
    expect(html).toContain('>宜<');
    expect(html).toContain('>忌<');
    expect(html).toMatch(/2026-\d{2}-\d{2}/);
  });

  it('木鱼进度与收起入口都在，农历表口径有交代', () => {
    const html = render();
    expect(html).toContain('今日');
    expect(html).toContain('/ 20');
    expect(html).toContain('空格敲木鱼');
    expect(html).toContain('合上告示板');
    expect(html).toContain('对照表推算');
  });
});
