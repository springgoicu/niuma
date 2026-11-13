/**
 * 图集加载错误分类。
 *
 * 这个模块刻意不 import Pixi：`worker-host`、`worker-client` 与单测都要判断
 * 「这次失败是不是页面过期」，而后两者不应该为了一个枚举把渲染器拉进 bundle。
 *
 * 三类错误：
 * - `manifest`：清单请求 / 解析失败，可重试；
 * - `texture`：单张贴图加载失败，可重试；
 * - `version-mismatch`：清单版本与客户端布局不一致，属于「页面已过期」，
 *   重试没有意义，应该受控换图。
 */

export type AtlasErrorCode = 'manifest' | 'texture' | 'version-mismatch';

export class AtlasLoadError extends Error {
  readonly code: AtlasErrorCode;
  readonly retryable: boolean;

  constructor(code: AtlasErrorCode, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AtlasLoadError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 取错误码时同时认 `instanceof` 与鸭子类型：
 * 打包边界或跨实现（单测注入普通对象）下，类身份不一定保得住，但 `code`
 * 是协议的一部分，按字段判断更稳。
 */
export function atlasErrorCodeOf(error: unknown): AtlasErrorCode | null {
  if (error instanceof AtlasLoadError) return error.code;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === 'manifest' || code === 'texture' || code === 'version-mismatch' ? code : null;
}

/** 页面与服务端素材版本不一致：重试无用，交给受控换图处理 */
export function isAtlasVersionMismatch(error: unknown): boolean {
  return atlasErrorCodeOf(error) === 'version-mismatch';
}
