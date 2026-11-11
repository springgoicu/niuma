/**
 * 把开源词库导成服务端能读的 `lexicon.json`（ADR-0028）。
 *
 *   bun run lexicon:import -- --political ./政治类.txt --profanity ./低俗辱骂.txt --out lexicon.json
 *   bun run lexicon:import -- --dir ./Sensitive-lexicon/Vocabulary --out lexicon.json
 *
 * 只读本地文件：开源词库请自行 clone，本仓库不内置、不下载任何词条。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { MODERATION_CATEGORY } from '@niuma/shared-types';
import { importLexicon, serializeLexicon, type ImportSource } from '../src/sim/lexicon-import';

interface Args {
  political: string[];
  profanity: string[];
  dirs: string[];
  out: string;
}

const USAGE = `用法:
  bun run lexicon:import -- --political <file> [--political <file>...] \\
                          [--profanity <file>...] [--dir <dir>...] [--out <file>]

  --political   显式指定政治类词表（可重复）
  --profanity   显式指定污言秽语词表（可重复）
  --dir         递归扫描目录，按文件名判定类别（政治/时政/暴恐/违禁/涉枪/涉爆 → political，
                辱骂/低俗/脏话/谩骂/不文明 → profanity，其余跳过并列出）
  --out         输出路径，默认 lexicon.json`;

function parseArgs(argv: string[]): Args {
  const args: Args = { political: [], profanity: [], dirs: [], out: 'lexicon.json' };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (!value || value.startsWith('--')) {
      console.error(`缺少参数值: ${flag}`);
      console.error(USAGE);
      process.exit(1);
    }
    if (flag === '--political') args.political.push(value);
    else if (flag === '--profanity') args.profanity.push(value);
    else if (flag === '--dir') args.dirs.push(value);
    else if (flag === '--out') args.out = value;
    else {
      console.error(`未知参数: ${flag}`);
      console.error(USAGE);
      process.exit(1);
    }
    i += 1;
  }

  return args;
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else if (['.txt', '.dic', '.text'].includes(extname(entry).toLowerCase())) out.push(full);
  }
  return out;
}

function readSource(path: string, name = path): ImportSource {
  return { name, text: readFileSync(path, 'utf8') };
}

const args = parseArgs(process.argv.slice(2));
if (args.political.length === 0 && args.profanity.length === 0 && args.dirs.length === 0) {
  console.error('没有输入文件。\n');
  console.error(USAGE);
  process.exit(1);
}

const sources: ImportSource[] = [];

try {
  for (const path of args.political) {
    sources.push({ ...readSource(path), category: MODERATION_CATEGORY.Political });
  }
  for (const path of args.profanity) {
    sources.push({ ...readSource(path), category: MODERATION_CATEGORY.Profanity });
  }
  for (const dir of args.dirs) {
    for (const file of collectFiles(dir)) {
      // 目录模式下用相对路径当 name，报告里能定位到具体文件
      sources.push(readSource(file, relative(dir, file)));
    }
  }
} catch (error) {
  console.error(`读取词库失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const report = importLexicon(sources);

for (const line of report.skipped) console.warn(`skip  ${line}`);
for (const line of report.issues) console.warn(`warn  ${line}`);

const total = report.counts.political + report.counts.profanity;
if (total === 0) {
  console.error('没有导入任何词条：检查文件分隔符，或用 --political / --profanity 显式指定类别。');
  process.exit(1);
}

writeFileSync(args.out, serializeLexicon(report.lexicon), 'utf8');

console.log(`political=${report.counts.political} profanity=${report.counts.profanity} → ${args.out}`);
console.log(`下一步: 把 GAME_MODERATION_LEXICON 指向 ${args.out} 的绝对路径，然后重启游戏服`);
