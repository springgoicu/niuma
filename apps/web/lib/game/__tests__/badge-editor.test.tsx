import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BadgeEditor } from '../../../components/game/BadgeEditor';

const noop = () => {};

function render(name: string, status = ''): string {
  return renderToStaticMarkup(
    <BadgeEditor name={name} status={status} onSave={noop} onClose={noop} />,
  );
}

describe('工牌编辑器', () => {
  it('名字与状态是两个独立输入，保存按钮一次提交两者', () => {
    const html = render('夜班实习生', '摸鱼中');
    expect(html).toContain('工牌名');
    expect(html).toContain('状态内容');
    expect(html).toContain('保存工牌');
    expect(html).toContain('value="夜班实习生"');
    expect(html).toContain('value="摸鱼中"');
  });

  it('默认提示名字会同步到头顶与档案', () => {
    expect(render('夜班实习生')).toContain('工牌名会同步到头顶与档案');
  });

  it('空名字就地提示，不等到提交', () => {
    const html = render('');
    expect(html).toContain('工牌名不能空着');
    expect(html).toContain('aria-invalid="true"');
  });

  it('政治敏感整条拦下，不提示打码', () => {
    const html = render('示例敏感词甲');
    expect(html).toContain('这个工牌名用不了，换个说法');
    expect(html).not.toContain('会自动打码');
  });

  it('超宽名字提示保存时截断', () => {
    const html = render('牛'.repeat(10));
    expect(html).toContain('超出头顶宽度，保存时会截断');
  });
});
