import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@niuma/shared-types'],
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
