/**
 * 词库自检：`bun run lexicon:check <lexicon.json>`
 *
 * 与服务器共用同一套解析逻辑（`auditLexicon`），把格式错、超长、空条目提前拦在发布前。
 * 退出码非 0 即视为词库不可用——CI 与运维上线前跑一次即可。
 */
import { readFileSync } from 'node:fs';
import { auditLexicon } from '../src/sim/moderation';

const path = process.argv[2] ?? process.env.GAME_MODERATION_LEXICON ?? '';
if (path.length === 0) {
  console.error('usage: bun run lexicon:check <lexicon.json>  (or set GAME_MODERATION_LEXICON)');
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`cannot read or parse ${path}: ${detail}`);
  process.exit(1);
}

const audit = auditLexicon(raw);
console.log(`political=${audit.counts.political} profanity=${audit.counts.profanity}`);
for (const issue of audit.issues) console.error(`- ${issue}`);

if (audit.issues.length > 0) {
  process.exit(1);
}

console.log('lexicon ok');
