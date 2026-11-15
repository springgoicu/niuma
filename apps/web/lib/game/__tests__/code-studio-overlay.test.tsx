import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeStudio } from '../../../components/game/CodeStudio';
import { CODE_STUDIO_FILES } from '../code-studio';

/** 服务端静态渲染：只断言结构，不依赖浏览器事件 */
function render(): string {
  return renderToStaticMarkup(<CodeStudio onClose={() => {}} />);
}

describe('代码工位界面', () => {
  it('是一块带语义的只读层，默认停在整个 HUD 之上', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="代码工位"');
    expect(html).toContain('z-[120]');
    expect(html).toContain('fixed inset-0');
  });

  it('文件树列出全部文件，且当前文件标成选中态', () => {
    const html = render();
    for (const file of CODE_STUDIO_FILES) {
      expect(html).toContain(file.name);
    }
    expect(html).toContain('aria-current="true"');
    expect(html.match(/data-studio-action="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(
      CODE_STUDIO_FILES.length,
    );
  });

  it('代码区彻底只读：没有输入框、没有可编辑区域，但能选中复制', () => {
    const html = render();
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('contenteditable');
    expect(html).toContain('select-text');
    // 行号列不参与选中：复制代码不会带出一串数字
    expect(html).toContain('select-none');
    expect(html).toContain('<pre');
  });

  it('退出路径一眼可见：Esc 键帽、返回园区文案与关闭按钮', () => {
    const html = render();
    expect(html).toContain('Esc');
    expect(html).toContain('返回园区');
    expect(html).toContain('aria-label="关闭代码工位"');
  });

  it('终端与状态栏都渲染出来，不做成空壳', () => {
    const html = render();
    expect(html).toContain('[overtime]');
    expect(html).toContain('[boss]');
    expect(html).toContain('main*');
    expect(html).toContain('只读');
    expect(html).toContain('牛马在线');
  });
});
