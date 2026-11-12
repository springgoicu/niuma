import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * 部署版本号：由 Jenkins 在构建前注入（git sha + 构建号）。
 * 只保留 URL / JSON 安全字符，客户端会把它塞进 `?__v=` 强刷当前页面。
 */
function sanitizeBuildId(raw: string | undefined): string {
  const id = (raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 64);
  return id || 'dev';
}

const buildId = sanitizeBuildId(process.env.NEXT_PUBLIC_BUILD_ID);

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@niuma/shared-types'],
  reactStrictMode: true,
  /** 内联到服务端与客户端 bundle：两端的 BUILD_ID 必须来自同一次构建 */
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  /** `.next/BUILD_ID` 与对外版本保持同一值，部署日志可直接核对 */
  generateBuildId: () => buildId,
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },

  /**
   * 压缩交给 nginx：静态资源用 gzip_static 直接吐预压缩文件，
   * 动态 HTML 由 nginx gzip（C 实现）处理。
   * Node 侧再压一遍纯属浪费 CPU（4 核小机器 + Next 15 的压缩是同步 zlib）。
   */
  compress: false,
  /** 不泄漏技术栈 */
  poweredByHeader: false,
  /**
   * 生产包不产出 .map：源码映射等于把 TypeScript 原文交给任何打开 DevTools 的人，
   * 协议字段、状态机分支、限流阈值全部可读。排障用构建日志与版本号，不靠 sourcemap。
   */
  productionBrowserSourceMaps: false,

  /**
   * 构建期剥离 console.log / warn / info，只留 console.error。
   *
   * 客户端日志会把网络结构、重连时机、渲染降级路径直接打到控制台，
   * 对逆向的人是免费的说明书。error 保留：真正的异常堆栈是线上排障的唯一线索。
   * 注意这只影响生产构建（next build 走 webpack）；dev 下仍然全量输出。
   */
  compiler: {
    removeConsole: { exclude: ['error'] },
  },

  /**
   * 跨源隔离：`SharedArrayBuffer` 的启用前提。
   *
   * 输入控制块靠共享内存做到「零消息、每帧只读几个整数」；没有这两个头时
   * `crossOriginIsolated` 为 false，代码会自动退回定长 `Uint8Array` 消息通道
   * ——功能一致，只是每次按键多一次结构化克隆。
   *
   * 只在这里加，**nginx 不要重复 add_header**：响应出现两份同名头时浏览器
   * 会判定非法，`crossOriginIsolated` 反而变 false。文档类响应都来自 Next，
   * 静态资源不需要这两个头。
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },

  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
