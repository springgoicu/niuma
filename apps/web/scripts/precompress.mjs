#!/usr/bin/env node
/**
 * 构建后预压缩静态资源。
 *
 * 目的：线上 nginx 开了 gzip_static，请求静态资源时若同目录存在 foo.js.gz，
 * 直接把 .gz 吐出去（Content-Encoding: gzip），省掉每次请求的实时压缩开销。
 *
 * 放在 next build 之后执行，.gz 会跟着 .next/static 与 public 一起被部署脚本复制走，
 * 不依赖部署脚本是否支持额外的压缩步骤。
 *
 * 只压文本类资源；woff2 / png / webp 本身已压缩，再压只会更大。
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOTS = ['.next/static', 'public'];
const EXT = new Set(['.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest', '.xml']);
const MIN_BYTES = 1024; // 小于 1KB 的压缩收益为负（gzip 头开销）
const LEVEL = 9;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 目录不存在直接跳过
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let count = 0;
let saved = 0;

for (const root of ROOTS) {
  for await (const file of walk(root)) {
    if (file.endsWith('.gz')) continue;
    if (!EXT.has(extname(file))) continue;

    const { size, mtimeMs } = await stat(file);
    if (size < MIN_BYTES) continue;

    const out = `${file}.gz`;
    try {
      const gzStat = await stat(out);
      if (gzStat.mtimeMs >= mtimeMs) continue; // 已有且比源文件新，跳过
    } catch {
      // 没有 .gz，继续压
    }

    const gz = gzipSync(await readFile(file), { level: LEVEL });
    await writeFile(out, gz);
    count += 1;
    saved += size - gz.length;
  }
}

console.log(
  `[precompress] ${count} 个文件已生成 .gz，节省 ${(saved / 1024).toFixed(0)}KB（nginx gzip_static 直接命中）`,
);
