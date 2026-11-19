import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: [
      { find: /^bun:test$/, replacement: 'vitest' },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'apps/web/$1') },
    ],
  },
  test: {
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.next-dev/**'],
  },
});
