/**
 * 版本工报（release notes）的解析与读取。
 *
 * 数据源是仓库里的 `data/release-notes.json`，构建期打进服务端 bundle：
 * 随代码一起发布，不写数据库、不落运行时存储，也不进园区快照（ADR-0043）。
 * 解析对坏字段一律丢弃而不是抛错：一条手写错误不该让首页整块白屏。
 */
import rawReleaseNotes from '../data/release-notes.json';

export type ReleaseNoteKind = 'feat' | 'fix' | 'perf' | 'ui' | 'docs' | 'chore';

export interface ReleaseNoteChange {
  kind: ReleaseNoteKind;
  text: string;
}

export interface ReleaseNoteEntry {
  id: string;
  date: string;
  title: string;
  changes: ReleaseNoteChange[];
}

export interface ReleaseNoteGroups {
  latest: ReleaseNoteEntry[];
  history: ReleaseNoteEntry[];
}

export const RELEASE_NOTE_KINDS: readonly ReleaseNoteKind[] = [
  'feat',
  'fix',
  'perf',
  'ui',
  'docs',
  'chore',
];

const MAX_ENTRIES = 50;
const MAX_CHANGES = 8;
const MAX_TITLE_LENGTH = 60;
const MAX_CHANGE_LENGTH = 80;
/** `2026-11-12-1`：日期 + 当日序号，序号用来区分同一天的多条提交 */
const ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{1,2})$/;

function isKind(value: unknown): value is ReleaseNoteKind {
  return typeof value === 'string' && (RELEASE_NOTE_KINDS as readonly string[]).includes(value);
}

/** 单行短文案：带换行或超长的内容多是误贴了 commit / diff，直接丢弃 */
function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maxLength) return null;
  if (/[\r\n]/.test(text)) return null;
  return text;
}

/** 只认真实存在的日历日期：`2026-02-30` 这类手写错误直接丢弃 */
function readDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function readChange(value: unknown): ReleaseNoteChange | null {
  if (typeof value !== 'object' || value === null) return null;
  const draft = value as Record<string, unknown>;
  if (!isKind(draft.kind)) return null;
  const text = readText(draft.text, MAX_CHANGE_LENGTH);
  if (!text) return null;
  return { kind: draft.kind, text };
}

function readEntry(value: unknown): ReleaseNoteEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const draft = value as Record<string, unknown>;

  const id = typeof draft.id === 'string' ? draft.id.trim() : '';
  const match = ID_PATTERN.exec(id);
  if (!match) return null;

  const date = readDate(draft.date);
  // id 前缀必须与 date 一致：两者不同步时以谁为准都会让同日序号错位
  if (!date || date !== match[1]) return null;

  const title = readText(draft.title, MAX_TITLE_LENGTH);
  if (!title) return null;
  if (!Array.isArray(draft.changes)) return null;

  const changes: ReleaseNoteChange[] = [];
  for (const item of draft.changes) {
    const change = readChange(item);
    if (change) changes.push(change);
    if (changes.length >= MAX_CHANGES) break;
  }
  if (changes.length === 0) return null;

  return { id, date, title, changes };
}

function entrySequence(entry: ReleaseNoteEntry): number {
  const match = ID_PATTERN.exec(entry.id);
  return match ? Number(match[2]) : 0;
}

/** 日期倒序；同一天按 id 序号倒序，`#2` 永远排在 `#1` 前面 */
export function sortReleaseNotes(entries: readonly ReleaseNoteEntry[]): ReleaseNoteEntry[] {
  return [...entries].sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    return entrySequence(right) - entrySequence(left);
  });
}

/** 把任何 JSON 值解析成合法条目：坏条目丢弃，重复 id 只留第一条 */
export function readReleaseNotes(raw: unknown): ReleaseNoteEntry[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const list = (raw as Record<string, unknown>).entries;
  if (!Array.isArray(list)) return [];

  const seen = new Set<string>();
  const entries: ReleaseNoteEntry[] = [];
  for (const item of list) {
    const entry = readEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= MAX_ENTRIES) break;
  }
  return sortReleaseNotes(entries);
}

/** 最新 N 条直接展开，其余收进「更早的版本」 */
export function groupReleaseNotes(
  entries: readonly ReleaseNoteEntry[],
  latestCount = 3,
): ReleaseNoteGroups {
  const list = sortReleaseNotes(entries);
  const count = Math.max(0, Math.floor(latestCount));
  return { latest: list.slice(0, count), history: list.slice(count) };
}

/** `2026-11-12` → `2026.11.12`：票据上的日期不用连字符，读起来更像工牌 */
export function formatReleaseDate(date: string): string {
  return date.replaceAll('-', '.');
}

/** 同一天的第二条提交显示 `#2`；序号解析失败按 1 处理 */
export function releaseSequence(id: string): number {
  const match = ID_PATTERN.exec(id);
  const value = match ? Number(match[2]) : 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** 构建期解析一次，组件只消费这份结果 */
export const RELEASE_NOTES: readonly ReleaseNoteEntry[] = readReleaseNotes(rawReleaseNotes);
