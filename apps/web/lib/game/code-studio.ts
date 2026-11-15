/**
 * 代码工位（F2 彩蛋）的唯一内容源。
 *
 * 纯模块：不写 'use client'、不碰 DOM、不读仓库文件——组件与测试共用同一份数据。
 * 高亮在模块加载时一次性算完，运行期切换文件只做数组读取，零解析开销。
 */

/** 代码着色的语义档位：颜色由组件按 VS Code 色板映射 */
export type CodeTone =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'type'
  | 'function'
  | 'muted';

export interface CodeToken {
  text: string;
  tone: CodeTone;
}

export interface CodeFile {
  id: string;
  /** 文件树与页签上的显示名 */
  name: string;
  /** 面包屑里的路径 */
  path: string;
  /** 状态栏语言标识与高亮规则 */
  language: string;
  /** 已按语言切好的逐行 token；空行用不换行空格占位 */
  lines: CodeToken[][];
  /** 文件树右侧的改动角标，纯装饰 */
  status?: 'M' | 'U';
}

/** TypeScript / JavaScript 关键字与字面量：颜色统一走「关键字蓝」 */
const KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'catch',
  'class',
  'const',
  'continue',
  'declare',
  'default',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'let',
  'new',
  'null',
  'number',
  'of',
  'private',
  'public',
  'readonly',
  'return',
  'string',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'var',
  'void',
  'while',
]);

/** 一次扫描同时认出注释、字符串、数字与标识符；左匹配优先保证字符串里的 // 不被切开 */
const SCAN = /\/\/[^\n]*|'[^'\n]*'|"[^"\n]*"|\b\d+(?:[._]\d+)*\b|[A-Za-z_$][\w$]*/g;

function classify(text: string, rest: string, json: boolean): CodeTone {
  if (text.startsWith('//')) return 'comment';
  const head = text[0];
  if (head === "'" || head === '"') {
    // JSON 的键也是字符串，但 VS Code 把它画成类型色，与值区分开
    return json && rest.trimStart().startsWith(':') ? 'type' : 'string';
  }
  if (/^\d/.test(text)) return 'number';
  if (KEYWORDS.has(text)) return 'keyword';
  // 紧跟着左括号的标识符按函数名处理（调用 / 声明都命中）
  if (rest.trimStart().startsWith('(')) return 'function';
  if (/^[A-Z]/.test(text)) return 'type';
  return 'plain';
}

/** 单行高亮：Markdown 只认标题与引用，其余语言走统一扫描 */
export function tokenizeLine(raw: string, language: string): CodeToken[] {
  const trimmed = raw.trimStart();
  if (language === 'Markdown') {
    if (/^#{1,6}\s/.test(trimmed)) return [{ text: raw, tone: 'keyword' }];
    if (trimmed.startsWith('>')) return [{ text: raw, tone: 'comment' }];
    return [{ text: raw.length > 0 ? raw : '\u00A0', tone: 'plain' }];
  }
  if (trimmed.startsWith('//')) return [{ text: raw, tone: 'comment' }];
  if (raw.length === 0) return [{ text: '\u00A0', tone: 'plain' }];

  const tokens: CodeToken[] = [];
  const scan = new RegExp(SCAN.source, 'g');
  const json = language === 'JSON';
  let cursor = 0;
  for (const match of raw.matchAll(scan)) {
    const text = match[0];
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ text: raw.slice(cursor, start), tone: 'plain' });
    tokens.push({ text, tone: classify(text, raw.slice(start + text.length), json) });
    cursor = start + text.length;
  }
  if (cursor < raw.length) tokens.push({ text: raw.slice(cursor), tone: 'plain' });
  return tokens.length > 0 ? tokens : [{ text: raw, tone: 'plain' }];
}

/** 整段源码 → 逐行 token；末尾换行不额外产出一行空行 */
export function tokenizeSource(source: string, language: string): CodeToken[][] {
  const rows = source.replace(/\n+$/, '').split('\n');
  return rows.map((row) => tokenizeLine(row, language));
}

interface FileSpec {
  id: string;
  name: string;
  path: string;
  language: string;
  status?: 'M' | 'U';
  source: string;
}

function buildFile({ source, ...meta }: FileSpec): CodeFile {
  return { ...meta, lines: tokenizeSource(source, meta.language) };
}

/*
 * 下面六份源码就是彩蛋的全部内容：写在「牛马园区」自己身上的假仓库。
 * 文案里不要出现真实域名、端口与仓库路径——工位屏幕只该有园区的事。
 */
const SOURCES: readonly FileSpec[] = [
  {
    id: 'readme',
    name: 'README.md',
    path: 'niuma-park / README.md',
    language: 'Markdown',
    source: [
      '# 牛马园区 · 工位终端',
      '',
      '一个把打工写进代码里的沙盒。',
      '你在这里敲下的每一行，园区里都会发生。',
      '',
      '## 常用指令',
      '- "pnpm dev" 启动园区，默认落在 03 号工位',
      '- "pnpm overtime" 自动加班，直到天亮',
      '- "pnpm slack" 摸鱼检测，12 秒不动就开始记录',
      '',
      '## 三条铁律',
      '1. 老板的血条每天回满',
      '2. 加班费永远是 0',
      '3. 想走就走，想留就留',
      '',
      '> 工位不重要，别把自己写进死循环。',
    ].join('\n'),
  },
  {
    id: 'overtime',
    name: 'overtime.ts',
    path: 'niuma-park / src / overtime.ts',
    language: 'TypeScript',
    status: 'M',
    source: [
      "import { addDays, now } from './clock';",
      '',
      '/** 加班：把今天的工时叠到明天，明天再叠到大后天 */',
      'export interface OvertimeTicket {',
      '  day: string;',
      '  hours: number;',
      '  paid: boolean;',
      '}',
      '',
      'const MAX_OVERTIME_HOURS = 23;',
      'const RATE = 0;',
      '',
      'export function bookOvertime(hours: number): OvertimeTicket {',
      '  const capped = Math.min(hours, MAX_OVERTIME_HOURS);',
      "  if (capped <= 0) throw new Error('今日工时已达标，请立即下班');",
      '',
      '  return {',
      '    day: addDays(now(), 1),',
      '    hours: capped,',
      '    paid: RATE > 0,',
      '  };',
      '}',
      '',
      "export const OVERTIME_RULE = '加班费按 0 元每小时结算，四舍五入到 0';",
    ].join('\n'),
  },
  {
    id: 'slack-detect',
    name: 'slack-detect.ts',
    path: 'niuma-park / src / slack-detect.ts',
    language: 'TypeScript',
    source: [
      'interface SlackSample {',
      '  at: number;',
      '  moving: boolean;',
      '}',
      '',
      '/** 摸鱼检测：连续 12 秒不动，就算在认真工作 */',
      'const SLACK_WINDOW_MS = 12_000;',
      'const ALARM_LEVEL = 3;',
      '',
      'export function isSlacking(samples: SlackSample[]): boolean {',
      '  const recent = samples.filter((item) => Date.now() - item.at < SLACK_WINDOW_MS);',
      '  if (recent.length === 0) return false;',
      '',
      '  let idle = 0;',
      '  for (const sample of recent) {',
      '    if (!sample.moving) idle += 1;',
      '  }',
      '',
      '  return idle >= recent.length - 1;',
      '}',
      '',
      'export function alarmText(level: number): string {',
      "  return level >= ALARM_LEVEL ? '你已经 12 秒没动了，组长正在看你' : '继续保持';",
      '}',
    ].join('\n'),
  },
  {
    id: 'punch-clock',
    name: 'punch-clock.ts',
    path: 'niuma-park / src / punch-clock.ts',
    language: 'TypeScript',
    source: [
      'interface Punch {',
      '  in: number;',
      '  out: number | null;',
      '}',
      '',
      'const GRACE_MINUTES = 0;',
      '',
      '/** 打卡：早到不算，晚走不算，忘记打卡算全勤 */',
      'export function workedMinutes(punch: Punch, now: number): number {',
      '  const end = punch.out ?? now;',
      '  const minutes = Math.max(0, Math.round((end - punch.in) / 60_000));',
      '  return minutes + GRACE_MINUTES;',
      '}',
      '',
      'export function punchLabel(minutes: number): string {',
      "  if (minutes >= 600) return '今天很努力';",
      "  if (minutes >= 480) return '刚好够本';",
      "  return '工位记得你';",
      '}',
    ].join('\n'),
  },
  {
    id: 'boss-hp',
    name: 'boss-hp.ts',
    path: 'niuma-park / src / boss-hp.ts',
    language: 'TypeScript',
    status: 'U',
    source: [
      'const MAX_HP = 100;',
      'const RESET_HOUR = 4;',
      '',
      '/** 老板血条：每天凌晨 4 点回满，被踹一次掉 38 点 */',
      'export const BOSS = {',
      '  maxHp: MAX_HP,',
      '  punchDamage: 38,',
      '  resetHour: RESET_HOUR,',
      '};',
      '',
      'export function hpAfterKicks(kicks: number): number {',
      '  return Math.max(0, BOSS.maxHp - kicks * BOSS.punchDamage);',
      '}',
      '',
      'export function isBossDown(kicks: number): boolean {',
      '  return hpAfterKicks(kicks) === 0;',
      '}',
    ].join('\n'),
  },
  {
    id: 'package',
    name: 'package.json',
    path: 'niuma-park / package.json',
    language: 'JSON',
    source: [
      '{',
      '  "name": "niuma-park",',
      '  "private": true,',
      '  "version": "3.0.0",',
      '  "scripts": {',
      '    "dev": "next dev",',
      '    "overtime": "node scripts/overtime.mjs",',
      '    "slack": "node scripts/slack.mjs"',
      '  },',
      '  "dependencies": {',
      '    "niuma": "workspace:*",',
      '    "moyu": "^1.0.0"',
      '  }',
      '}',
    ].join('\n'),
  },
];

/** 文件树顺序：README 在最前，脚本按字母排，package.json 收尾 */
export const CODE_STUDIO_FILES: readonly CodeFile[] = SOURCES.map((spec) => buildFile(spec));

/** 未知 id 回落到第一个文件：状态异常时也不该渲染出一块空屏 */
export function resolveStudioFile(files: readonly CodeFile[], id: string): CodeFile {
  return files.find((file) => file.id === id) ?? files[0];
}

/** 底部终端：几行固定日志，装着园区此刻的状态 */
export const CODE_STUDIO_TERMINAL: readonly CodeToken[] = [
  { text: '$ pnpm overtime', tone: 'plain' },
  { text: '[overtime] 今日工时 09:41 · 加班费 0.00 元', tone: 'comment' },
  { text: '[slack] 摸鱼检测已启动 · 阈值 12 秒', tone: 'type' },
  { text: '[boss] 血条 100/100 · 今日已被踹 0 次', tone: 'number' },
  { text: '[niuma] 工位已点亮，园区一切正常', tone: 'string' },
];

/** 底边状态栏：分支与统计值都是装饰，不读真实仓库状态 */
export const CODE_STUDIO_STATUS = {
  branch: 'main*',
  errors: 0,
  warnings: 3,
  indent: 'Spaces: 2',
  encoding: 'UTF-8',
  eol: 'LF',
} as const;

/** 标题栏里那一串菜单，只做视觉，不可展开 */
export const CODE_STUDIO_MENU: readonly string[] = [
  '文件',
  '编辑',
  '选择',
  '查看',
  '转到',
  '运行',
  '终端',
  '帮助',
];
