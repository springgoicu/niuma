import { describe, expect, it } from 'bun:test';
import { createModerationFilter } from '@niuma/shared-types';
import { resolveRename } from './name';

/** 固定词库：不依赖内置表的具体词条，测试只关心「拒绝 / 打码」两条分支 */
const FILTER = createModerationFilter({ political: ['禁词'], profanity: ['傻'] });

describe('改工牌名裁决', () => {
  it('干净名字直接生效', () => {
    expect(resolveRename('夜班实习生', '摸鱼老黄牛', FILTER)).toEqual({
      name: '摸鱼老黄牛',
      changed: true,
      verdict: 'allow',
      hits: 0,
    });
  });

  it('不文明用词按打码结果生效，与状态、聊天同一套规则', () => {
    const result = resolveRename('夜班实习生', '傻牛马', FILTER);
    expect(result.verdict).toBe('mask');
    expect(result.name).not.toContain('傻');
    expect(result.name).toContain('*');
    expect(result.changed).toBe(true);
  });

  it('政治敏感保留原名，不会把工牌洗成默认名', () => {
    const result = resolveRename('夜班实习生', '禁词实习生', FILTER);
    expect(result).toMatchObject({ name: '夜班实习生', changed: false, verdict: 'reject' });
    expect(result.hits).toBeGreaterThan(0);
  });

  it('空输入与纯空白保留原名', () => {
    expect(resolveRename('夜班实习生', '', FILTER)).toEqual({
      name: '夜班实习生',
      changed: false,
      verdict: 'empty',
      hits: 0,
    });
    expect(resolveRename('夜班实习生', '   ', FILTER).name).toBe('夜班实习生');
  });

  it('域名 / 邮箱形态没有任何正当昵称用途，直接保留原名', () => {
    expect(resolveRename('夜班实习生', 'foo.com', FILTER).verdict).toBe('reject');
    expect(resolveRename('夜班实习生', 'a@b.com', FILTER).name).toBe('夜班实习生');
  });

  it('超长名字按入场同一把尺子截断', () => {
    const result = resolveRename('夜班实习生', '牛'.repeat(20), FILTER);
    expect(result.name).toBe('牛'.repeat(16));
    expect(result.changed).toBe(true);
  });

  it('与当前名字完全相同时不触发变更，避免无意义的入场缓存重建', () => {
    expect(resolveRename('摸鱼老黄牛', '摸鱼老黄牛', FILTER).changed).toBe(false);
  });
});
