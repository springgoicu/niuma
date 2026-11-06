import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@niuma/shared-types'],
  reactStrictMode: true,
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
  productionBrowserSourceMaps: false,

  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
