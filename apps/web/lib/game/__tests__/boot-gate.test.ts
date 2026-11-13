import { describe, expect, it } from 'bun:test';
import { classifyBootMessage } from '../runtime/boot-gate';

describe('渲染线程启动闸门', () => {
  it('connecting 只算进度，不把初始化失败掩盖成启动成功', () => {
    expect(classifyBootMessage({ t: 'status', status: 'connecting', detail: '' })).toBe('progress');
  });

  it('ready 才算启动成功', () => {
    expect(classifyBootMessage({ t: 'ready', backend: 'webgl' })).toBe('alive');
  });

  it('初始化错误算启动失败', () => {
    expect(classifyBootMessage({ t: 'status', status: 'error', detail: '图集清单加载失败' })).toBe(
      'failed',
    );
  });

  it('素材版本错配也走失败分支，由宿主先看 code 决定换图还是回退', () => {
    expect(
      classifyBootMessage({
        t: 'status',
        status: 'error',
        detail: '版本不一致',
        code: 'atlas-version',
      }),
    ).toBe('failed');
  });

  it('初始化之后才可能出现的业务消息算启动成功', () => {
    expect(classifyBootMessage({ t: 'queue', queue: null })).toBe('alive');
  });
});
