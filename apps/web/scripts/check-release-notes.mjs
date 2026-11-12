#!/usr/bin/env node
/**
 * 版本工报校验：结构 + 敏感信息。
 *
 * 用法：node scripts/check-release-notes.mjs [file]
 * 默认读 `data/release-notes.json`，也可传入其他路径做本地试验。
 *
 * 只校验、不生成：记录内容由提交者（或 AI 助手）在提交前手写，
 * 这里只负责挡住结构错误与明显不该出现在公开页面上的信息。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(HERE, '../data/release-notes.json');
const MAX_ENTRIES = 50;
const MAX_CHANGES = 8;
const MAX_TITLE_LENGTH = 60;
const MAX_CHANGE_LENGTH = 80;
const KINDS = new Set(['feat', 'fix', 'perf', 'ui', 'docs', 'chore']);
const ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{1,2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const errors = [];

function fail(where, message) {
  errors.push(`${where}：${message}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(where, value, maxLength) {
  if (typeof value !== 'string') {
    fail(where, '必须是字符串');
    return false;
  }
  const text = value.trim();
  if (!text) {
    fail(where, '不能为空');
    return false;
  }
  if (text.length > maxLength) {
    fail(where, `长度 ${text.length} 超过上限 ${maxLength}`);
    return false;
  }
  if (/[\r\n]/.test(text)) {
    fail(where, '必须是单行文案，不能换行');
    return false;
  }
  if (value !== text) {
    fail(where, '首尾不能有空白');
    return false;
  }
  return true;
}

function checkDate(where, value) {
  if (typeof value !== 'string') {
    fail(where, '必须是 YYYY-MM-DD 字符串');
    return false;
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    fail(where, '日期必须是 YYYY-MM-DD');
    return false;
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) {
    fail(where, `不是真实存在的日期：${value}`);
    return false;
  }
  return true;
}

/**
 * 敏感信息扫描。
 *
 * 记录只写「玩家能感知的变化」，不应该出现地址、凭据与个人信息。
 * 这里宁可误报一点，也不让内网地址或密钥被构建进公开页面。
 */
const SENSITIVE_RULES = [
  { label: 'IPv4 地址', pattern: /\b\d{1,3}(?:\.\d{1,3}){3}\b/ },
  { label: 'URL', pattern: /\b(?:https?|wss?):\/\//i },
  { label: '邮箱', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { label: '密钥前缀', pattern: /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16})/ },
  { label: '凭据赋值', pattern: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S/i },
  { label: '私钥', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'Windows 绝对路径', pattern: /\b[A-Za-z]:\\/ },
  { label: 'Unix 绝对路径', pattern: /(?:^|\s)\/(?:home|Users|root|var|etc|opt|srv)\// },
  { label: '内网域名', pattern: /\.(?:internal|local|corp|lan)\b/i },
  { label: '手机号', pattern: /(?:^|\D)1[3-9]\d{9}(?:\D|$)/ },
  { label: '身份证号', pattern: /(?:^|\D)\d{17}[\dXx](?:\D|$)/ },
];

function checkSensitive(where, text) {
  for (const rule of SENSITIVE_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      fail(where, `疑似${rule.label}：${match[0]}`);
    }
  }
}

const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
let raw;

try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`无法读取版本记录：${file}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!isPlainObject(raw)) {
  console.error('版本记录顶层必须是对象：{ "entries": [...] }');
  process.exit(1);
}

const entries = raw.entries;
if (!Array.isArray(entries)) {
  console.error('版本记录缺少 entries 数组');
  process.exit(1);
}
if (entries.length === 0) {
  console.error('版本记录 entries 不能为空：至少保留一条首版记录');
  process.exit(1);
}
if (entries.length > MAX_ENTRIES) {
  fail('entries', `最多保留 ${MAX_ENTRIES} 条，当前 ${entries.length} 条，请归档更早的记录`);
}

const seenIds = new Set();
const seenDates = [];

entries.forEach((entry, index) => {
  const where = `entries[${index}]`;

  if (!isPlainObject(entry)) {
    fail(where, '必须是对象');
    return;
  }

  const { id, date, title, changes } = entry;

  if (typeof id !== 'string') {
    fail(`${where}.id`, '必须是字符串');
  } else {
    const match = ID_PATTERN.exec(id);
    if (!match) {
      fail(`${where}.id`, '必须形如 2026-11-12-1（日期 + 当日序号）');
    } else if (seenIds.has(id)) {
      fail(`${where}.id`, `重复的 id：${id}`);
    } else {
      seenIds.add(id);
      if (checkDate(`${where}.date`, date) && date !== match[1]) {
        fail(`${where}.id`, `id 的日期前缀与 date 不一致：${id} / ${date}`);
      }
    }
  }

  if (typeof date === 'string' && DATE_PATTERN.test(date)) {
    const idMatch = typeof id === 'string' ? ID_PATTERN.exec(id) : null;
    seenDates.push({ where, date, sequence: idMatch ? Number(idMatch[2]) : 0 });
  }

  if (checkText(`${where}.title`, title, MAX_TITLE_LENGTH)) {
    checkSensitive(`${where}.title`, title);
  }

  if (!Array.isArray(changes)) {
    fail(`${where}.changes`, '必须是数组');
    return;
  }
  if (changes.length === 0) {
    fail(`${where}.changes`, '至少写一条改动');
  }
  if (changes.length > MAX_CHANGES) {
    fail(`${where}.changes`, `最多 ${MAX_CHANGES} 条改动，当前 ${changes.length} 条`);
  }

  changes.forEach((change, changeIndex) => {
    const changeWhere = `${where}.changes[${changeIndex}]`;
    if (!isPlainObject(change)) {
      fail(changeWhere, '必须是对象');
      return;
    }
    if (!KINDS.has(change.kind)) {
      fail(`${changeWhere}.kind`, `必须是 ${[...KINDS].join(' / ')} 之一`);
    }
    if (checkText(`${changeWhere}.text`, change.text, MAX_CHANGE_LENGTH)) {
      checkSensitive(`${changeWhere}.text`, change.text);
    }
  });
});

/** 数据必须按新到旧排列；同一天允许并列，但序号大的在前 */
for (let index = 1; index < seenDates.length; index += 1) {
  const previous = seenDates[index - 1];
  const current = seenDates[index];
  if (previous.date < current.date) {
    fail(current.where, `顺序不对：${current.date} 比上一条 ${previous.date} 更新，新的应排在前面`);
  }
  if (previous.date === current.date && previous.sequence < current.sequence) {
    fail(
      current.where,
      `同日顺序不对：序号 ${current.sequence} 应排在序号 ${previous.sequence} 前面`,
    );
  }
}

if (errors.length > 0) {
  console.error(`版本记录校验失败（${errors.length} 处）：`);
  for (const message of errors) console.error(`  - ${message}`);
  console.error('\n如果命中的是敏感信息，请只描述玩家能感知的变化，不要写地址、路径、凭据与个人信息。');
  process.exit(1);
}

console.log(`版本记录校验通过：${entries.length} 条，最新 ${entries[0].date}（${entries[0].id}）`);
