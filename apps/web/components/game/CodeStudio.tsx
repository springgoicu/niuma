'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Blocks,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  FileCode,
  FileJson,
  FileText,
  Files,
  GitBranch,
  Package,
  Play,
  Search,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import {
  CODE_STUDIO_FILES,
  CODE_STUDIO_MENU,
  CODE_STUDIO_STATUS,
  CODE_STUDIO_TERMINAL,
  resolveStudioFile,
  type CodeFile,
  type CodeTone,
  type CodeToken,
} from '@/lib/game/code-studio';

/** VS Code 的深色色板只活在这一层：园区自身的暖褐调不被它污染 */
const TONE_TEXT: Record<CodeTone, string> = {
  plain: 'text-[#D4D4D4]',
  comment: 'text-[#6A9955]',
  string: 'text-[#CE9178]',
  keyword: 'text-[#569CD6]',
  number: 'text-[#B5CEA8]',
  type: 'text-[#4EC9B0]',
  function: 'text-[#DCDCAA]',
  muted: 'text-[#858585]',
};

const TONE_BAR: Record<CodeTone, string> = {
  plain: 'bg-[#555555]',
  comment: 'bg-[#4E6B45]',
  string: 'bg-[#7A5B4A]',
  keyword: 'bg-[#3F6FA0]',
  number: 'bg-[#55704F]',
  type: 'bg-[#3E7A74]',
  function: 'bg-[#8A8556]',
  muted: 'bg-[#3A3A3A]',
};

const ACTIVITY_ICONS = [
  { key: 'files', icon: Files, label: '资源管理器' },
  { key: 'search', icon: Search, label: '搜索' },
  { key: 'git', icon: GitBranch, label: '源代码管理' },
  { key: 'run', icon: Play, label: '运行与调试' },
  { key: 'extensions', icon: Blocks, label: '扩展' },
] as const;

function FileMark({ language }: { language: string }) {
  const Icon = language === 'JSON' ? FileJson : language === 'Markdown' ? FileText : FileCode;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-[#519ABA]" aria-hidden />;
}

/** 文件树的一行：原生按钮，鼠标点选与 Tab + Enter 等价 */
function FileRow({
  file,
  active,
  depth,
  onSelect,
}: {
  file: CodeFile;
  active: boolean;
  depth: number;
  onSelect(id: string): void;
}) {
  return (
    <button
      type="button"
      data-studio-action="true"
      onClick={() => onSelect(file.id)}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full cursor-pointer items-center gap-2 py-1 pr-3 text-left text-[12px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#007ACC] ${
        depth > 0 ? 'pl-9' : 'pl-6'
      } ${active ? 'bg-[#04395E] text-white' : 'text-[#CCCCCC] hover:bg-[#2A2D2E]'}`}
    >
      <FileMark language={file.language} />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      {file.status === 'M' && <span className="shrink-0 text-[10px] text-[#F2C879]">M</span>}
      {file.status === 'U' && <span className="shrink-0 text-[10px] text-[#4FE3C1]">U</span>}
    </button>
  );
}

/** 资源管理器里的文件夹行：只有展开箭头，没有折叠逻辑 */
function FolderRow({ label, indent }: { label: string; indent?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1 py-1 text-[11px] tracking-[0.04em] text-[#CCCCCC] ${
        indent ? 'pl-6' : 'pl-3'
      }`}
    >
      <ChevronDown className="h-3 w-3" aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}

/** 行号列 + 只读代码：选中复制只带代码，不带行号 */
function CodeRows({ file }: { file: CodeFile }) {
  return (
    <div className="animate-archive-panel-in min-h-full py-3">
      {file.lines.map((line, index) => (
        <div key={`${file.id}-${index}`} className="flex">
          <span
            aria-hidden
            className="w-12 shrink-0 select-none pr-3 text-right text-[11px] leading-5 text-[#858585] tabular-nums"
          >
            {index + 1}
          </span>
          <pre className="min-w-0 flex-1 whitespace-pre pr-6 text-[13px] leading-5">
            {line.map((token, tokenIndex) => (
              <span key={`${index}-${tokenIndex}`} className={TONE_TEXT[token.tone]}>
                {token.text}
              </span>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** minimap：按每行字符数画一条半透明色块，只装饰、不滚动 */
function Minimap({ file }: { file: CodeFile }) {
  return (
    <div className="hidden w-[60px] shrink-0 overflow-hidden border-l border-[#2B2B2B] bg-[#1E1E1E] px-2 py-3 min-[1100px]:block">
      {file.lines.map((line, index) => {
        const text = line.map((token) => token.text).join('');
        const tone = line.find((token) => token.tone !== 'plain')?.tone ?? 'plain';
        return (
          <span
            key={`${file.id}-mini-${index}`}
            className={`mb-[2px] block h-[2px] ${TONE_BAR[tone]}`}
            style={{ width: `${Math.min(100, 14 + text.length * 1.8)}%` }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

function TerminalLine({ token }: { token: CodeToken }) {
  return (
    <p className={`whitespace-pre-wrap break-words ${TONE_TEXT[token.tone]}`}>{token.text}</p>
  );
}

export interface CodeStudioProps {
  onClose(): void;
}

/**
 * 代码工位（F2 彩蛋）：一屏只读的仿 VS Code 界面。
 *
 * 不走协议、不读仓库文件、不暂停世界——它只是盖在园区上的一块屏幕。
 * 打开期间在 window capture 阶段接管全部按键，Esc 是唯一出口；
 * Tab 只在层内循环，Enter / 空格等效于点击当前按钮。
 */
export function CodeStudio({ onClose }: CodeStudioProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState(CODE_STUDIO_FILES[0].id);
  const activeFile = resolveStudioFile(CODE_STUDIO_FILES, activeId);
  // 资源管理器按路径分层：src 之外的挂在仓库根，src 里的缩进一层
  const rootFiles = CODE_STUDIO_FILES.filter((file) => !file.path.split(' / ').includes('src'));
  const sourceFiles = CODE_STUDIO_FILES.filter((file) => file.path.split(' / ').includes('src'));

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // Ctrl / Cmd / Alt 组合放行给浏览器：刷新、复制、地址栏都不该被吞
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Tab') {
        const root = rootRef.current;
        if (!root) return;
        const focusables = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (focusables.length === 0) return;
        const current = focusables.indexOf(document.activeElement as HTMLElement);
        const step = event.shiftKey ? -1 : 1;
        const next = (current + step + focusables.length) % focusables.length;
        event.preventDefault();
        event.stopPropagation();
        focusables[current === -1 ? 0 : next].focus();
        return;
      }
      const target = event.target;
      const onAction = target instanceof HTMLElement && target.dataset.studioAction === 'true';
      if (onAction && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
        target.click();
        return;
      }
      // 其余一律吞掉：事件停在 window capture，到不了游戏的 bubble 监听
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="代码工位"
      tabIndex={-1}
      className="animate-code-studio-in fixed inset-0 z-[120] flex select-text flex-col overflow-hidden bg-[#1E1E1E] font-mono text-[13px] text-[#D4D4D4] outline-none"
    >
      {/* 标题栏：三枚圆点 + 项目名；右侧永远是第一眼能看到的退出路径 */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[#2B2B2B] bg-[#3C3C3C] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#F14C4C]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F2C879]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#4FE3C1]" />
          </span>
          <span className="ml-2 truncate text-[12px] text-[#CCCCCC]">
            niuma-park — Visual Studio Code
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-studio-action="true"
            onClick={onClose}
            aria-label="返回园区（Esc）"
            title="返回园区（Esc）"
            className="flex cursor-pointer items-center gap-1.5 border border-[#4A4A4A] bg-[#2A2A2A] px-2 py-0.5 text-[11px] text-[#CCCCCC] transition-colors hover:bg-[#37373D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007ACC]"
          >
            <kbd className="border border-[#4A4A4A] bg-[#1E1E1E] px-1 text-[10px] leading-4">Esc</kbd>
            <span>返回园区</span>
          </button>
          <button
            type="button"
            data-studio-action="true"
            onClick={onClose}
            aria-label="关闭代码工位"
            title="关闭代码工位"
            className="grid h-6 w-6 cursor-pointer place-items-center text-[#CCCCCC] transition-colors hover:bg-[#F14C4C] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007ACC]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* 菜单行：只做视觉，不可展开 */}
      <div className="flex h-6 shrink-0 items-center gap-4 border-b border-[#2B2B2B] bg-[#252526] px-4 text-[11px] text-[#CCCCCC]">
        {CODE_STUDIO_MENU.map((item) => (
          <span key={item} className="cursor-default hover:text-white">
            {item}
          </span>
        ))}
        <span className="ml-auto text-[10px] tracking-[0.08em] text-[#858585]">
          只读演示 · Esc 返回园区
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 活动栏：选中项左侧一道蓝线 */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#2B2B2B] bg-[#333333] py-2">
          {ACTIVITY_ICONS.map((item, index) => {
            const Icon = item.icon;
            return (
              <span
                key={item.key}
                title={item.label}
                className={`relative grid h-9 w-12 place-items-center ${
                  index === 0 ? 'text-white' : 'text-[#858585]'
                }`}
              >
                {index === 0 && (
                  <span className="absolute left-0 h-6 w-[2px] bg-[#007ACC]" aria-hidden />
                )}
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            );
          })}
          <span className="mt-auto grid h-9 w-12 place-items-center text-[#858585]" aria-hidden>
            <CircleUserRound className="h-4 w-4" />
          </span>
          <span className="grid h-9 w-12 place-items-center text-[#858585]" aria-hidden>
            <Settings className="h-4 w-4" />
          </span>
        </div>

        {/* 资源管理器：文件树是真按钮，点选与 Tab + Enter 等价 */}
        <div className="flex w-[240px] shrink-0 flex-col border-r border-[#2B2B2B] bg-[#252526] max-[900px]:w-[190px]">
          <div className="flex h-7 items-center gap-1 border-b border-[#2B2B2B] px-3 text-[11px] uppercase tracking-[0.08em] text-[#CCCCCC]">
            <ChevronDown className="h-3 w-3" aria-hidden />
            资源管理器
          </div>
          <FolderRow label="niuma-park" />
          {rootFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              active={file.id === activeFile.id}
              depth={0}
              onSelect={setActiveId}
            />
          ))}
          <FolderRow label="src" indent />
          {sourceFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              active={file.id === activeFile.id}
              depth={1}
              onSelect={setActiveId}
            />
          ))}

          <div className="mt-auto border-t border-[#2B2B2B] px-3 py-2 text-[10px] leading-relaxed text-[#858585]">
            这屏代码跑不了。
            <br />
            能跑的是园区里的你。
          </div>
        </div>

        {/* 编辑器：页签 + 面包屑 + 行号代码 + minimap */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#1E1E1E]">
          <div className="flex h-9 shrink-0 items-center border-b border-[#2B2B2B] bg-[#252526]">
            <span className="flex h-full items-center gap-2 border-r border-[#2B2B2B] border-t-2 border-t-[#007ACC] bg-[#1E1E1E] px-3 text-[12px] text-white">
              <FileMark language={activeFile.language} />
              {activeFile.name}
              <span className="ml-1 text-[10px] uppercase tracking-[0.08em] text-[#858585]">
                read only
              </span>
            </span>
          </div>

          <div className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b border-[#2B2B2B] px-4 text-[11px] text-[#858585]">
            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{activeFile.path}</span>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto">
              <CodeRows key={activeFile.id} file={activeFile} />
            </div>
            <Minimap file={activeFile} />
          </div>

          {/* 终端：固定几行日志，把园区此刻写成构建输出 */}
          <div className="flex h-[168px] shrink-0 flex-col border-t border-[#2B2B2B] bg-[#1E1E1E]">
            <div className="flex h-7 shrink-0 items-center gap-4 bg-[#252526] px-4 text-[11px] text-[#858585]">
              {['问题', '输出', '调试控制台', '终端'].map((label) => (
                <span
                  key={label}
                  className={
                    label === '终端'
                      ? 'border-b-2 border-[#007ACC] pb-0.5 text-white'
                      : 'cursor-default'
                  }
                >
                  {label}
                </span>
              ))}
              <span className="ml-auto flex items-center gap-1 text-[10px]">
                <Terminal className="h-3 w-3" aria-hidden />
                只读
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-2 text-[11px] leading-5">
              {CODE_STUDIO_TERMINAL.map((token, index) => (
                <TerminalLine key={index} token={token} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 状态栏：VS Code 蓝只出现在这一条 */}
      <div className="flex h-6 shrink-0 items-center justify-between gap-3 bg-[#007ACC] px-3 text-[11px] text-white">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" aria-hidden />
            {CODE_STUDIO_STATUS.branch}
          </span>
          <span className="flex items-center gap-1 opacity-80">
            <Bug className="h-3 w-3" aria-hidden />
            {CODE_STUDIO_STATUS.errors}
          </span>
          <span className="flex items-center gap-1 opacity-80">
            <Package className="h-3 w-3" aria-hidden />
            {CODE_STUDIO_STATUS.warnings}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 opacity-90">
          <span>
            Ln {activeFile.lines.length}, Col 4
          </span>
          <span className="hidden sm:inline">{CODE_STUDIO_STATUS.indent}</span>
          <span className="hidden sm:inline">{CODE_STUDIO_STATUS.encoding}</span>
          <span className="hidden sm:inline">{CODE_STUDIO_STATUS.eol}</span>
          <span>{activeFile.language}</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-blink bg-[#4FE3C1]" aria-hidden />
            牛马在线
          </span>
        </div>
      </div>
    </div>
  );
}
