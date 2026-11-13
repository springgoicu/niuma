import { describe, expect, it } from 'bun:test';
import { AtlasLoadError, atlasErrorCodeOf, isAtlasVersionMismatch } from '../atlas-errors';

describe('图集错误分类', () => {
  it('识别三类错误码', () => {
    expect(atlasErrorCodeOf(new AtlasLoadError('manifest', 'x', true))).toBe('manifest');
    expect(atlasErrorCodeOf(new AtlasLoadError('texture', 'x', true))).toBe('texture');
    expect(atlasErrorCodeOf(new AtlasLoadError('version-mismatch', 'x', false))).toBe(
      'version-mismatch',
    );
  });

  it('版本错配不可重试', () => {
    const error = new AtlasLoadError('version-mismatch', '版本不一致', false);
    expect(error.retryable).toBe(false);
    expect(isAtlasVersionMismatch(error)).toBe(true);
  });

  it('鸭子类型也认 code，未知错误返回 null', () => {
    expect(atlasErrorCodeOf({ code: 'version-mismatch' })).toBe('version-mismatch');
    expect(atlasErrorCodeOf(new Error('x'))).toBeNull();
    expect(atlasErrorCodeOf(null)).toBeNull();
    expect(atlasErrorCodeOf({ code: 'unknown' })).toBeNull();
  });

  it('其它错误码不算版本错配', () => {
    expect(isAtlasVersionMismatch(new AtlasLoadError('texture', 'x', true))).toBe(false);
    expect(isAtlasVersionMismatch(new Error('x'))).toBe(false);
  });
});
