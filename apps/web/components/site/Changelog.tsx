import { ChevronDown } from 'lucide-react';
import {
  RELEASE_NOTES,
  formatReleaseDate,
  groupReleaseNotes,
  releaseSequence,
  type ReleaseNoteEntry,
  type ReleaseNoteKind,
} from '@/lib/release-notes';

const KIND_LABEL: Record<ReleaseNoteKind, string> = {
  feat: '新增',
  fix: '修复',
  perf: '性能',
  ui: '观感',
  docs: '文档',
  chore: '内部',
};

/** 标签只借颜色分类，不抢正文：边框淡、文字保持可读 */
const KIND_TONE: Record<ReleaseNoteKind, string> = {
  feat: 'border-mint-400/40 text-mint-400',
  fix: 'border-amber-400/40 text-amber-400',
  perf: 'border-sky-400/40 text-sky-400',
  ui: 'border-lime-400/40 text-lime-400',
  docs: 'border-mist-500/60 text-mist-300',
  chore: 'border-mist-500/60 text-mist-400',
};

function NoteCard({ entry, highlight = false }: { entry: ReleaseNoteEntry; highlight?: boolean }) {
  const sequence = releaseSequence(entry.id);

  return (
    <li
      className={`panel p-5 transition-colors duration-150 sm:p-6 ${
        highlight ? 'border-mint-400/50' : 'hover:border-ink-500'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <time
          dateTime={entry.date}
          className="font-mono text-[11px] tracking-[0.18em] text-mist-300"
        >
          {formatReleaseDate(entry.date)}
        </time>
        {sequence > 1 ? (
          <span className="font-mono text-[10px] tracking-[0.16em] text-mist-500">#{sequence}</span>
        ) : null}
        {highlight ? (
          <span className="inline-flex items-center gap-1.5 border border-mint-400/40 bg-mint-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-mint-400">
            <span className="h-1 w-1 bg-mint-400" />
            最新
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 font-display text-xl font-semibold text-mist-100 sm:text-2xl">
        {entry.title}
      </h3>

      <ul className="mt-4 space-y-2.5">
        {entry.changes.map((change, index) => (
          <li
            key={`${change.kind}-${index}`}
            className="flex items-start gap-3 text-sm leading-relaxed text-mist-300"
          >
            <span
              className={`mt-0.5 inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.12em] ${KIND_TONE[change.kind]}`}
            >
              {KIND_LABEL[change.kind]}
            </span>
            <span className="min-w-0">{change.text}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function ChangelogSection() {
  const { latest, history } = groupReleaseNotes(RELEASE_NOTES, 3);
  const newest = latest[0];

  // 没有合法记录就不占版面：首页宁可不提，也不显示一块空壳
  if (!newest) return null;

  return (
    <section id="changelog" className="relative border-b-2 border-ink-700 py-20 lg:py-28">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="lg:sticky lg:top-24">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-mint-400">
              // 03 · release notes
            </p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl">
              这版又改了什么
            </h2>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-mist-300">
              每次发版都在这里留一张工报：只写进园区后看得见的变化，不贴内部流水账。
              最近三次直接摊开，更早的收在下面，想翻再翻。
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-ink-600 bg-ink-800/40 px-4 py-3">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mint-400">
                <span className="h-1.5 w-1.5 animate-blink bg-mint-400" />
                最新版本
              </span>
              <span className="font-mono text-[11px] tracking-[0.16em] text-mist-300">
                {formatReleaseDate(newest.date)}
              </span>
              <span className="font-mono text-[10px] tracking-[0.14em] text-mist-500">
                共 {RELEASE_NOTES.length} 次记录
              </span>
            </div>
          </div>

          <div>
            <ol className="space-y-4">
              {latest.map((entry, index) => (
                <NoteCard key={entry.id} entry={entry} highlight={index === 0} />
              ))}
            </ol>

            {history.length > 0 ? (
              <details className="group mt-4 border-2 border-ink-600 bg-ink-900/40">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-mono text-[11px] tracking-[0.16em] text-mist-300 transition-colors duration-150 hover:text-mint-400 [&::-webkit-details-marker]:hidden">
                  展开更早的 {history.length} 个版本
                  <ChevronDown className="h-4 w-4 shrink-0 text-mist-500 transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <ol className="space-y-4 border-t-2 border-ink-700 p-4 sm:p-5">
                  {history.map((entry) => (
                    <NoteCard key={entry.id} entry={entry} />
                  ))}
                </ol>
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
