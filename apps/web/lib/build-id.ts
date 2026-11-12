/**
 * 构建版本号：`next.config.ts` 的 `env` 把同一个值内联进服务端与客户端 bundle。
 *
 * 只读这一份常量，不要另读 `process.env`：客户端与服务端一旦取自不同的环境变量，
 * `/api/version` 会和页面自身版本永远不一致，导致刷新死循环。
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
