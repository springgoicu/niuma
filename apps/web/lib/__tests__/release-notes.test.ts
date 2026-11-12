import { describe, expect, it } from 'bun:test';
import {
  RELEASE_NOTES,
  formatReleaseDate,
  groupReleaseNotes,
  readReleaseNotes,
  releaseSequence,
  sortReleaseNotes,
  type ReleaseNoteEntry,
} from '../release-notes';

function entry(id: string, date: string, title = '版本标题'): ReleaseNoteEntry {
  return {
    id,
    date,
    title,
    changes: [{ kind: 'feat', text: '一条改动' }],
  };
}

describe('版本记录解析', () => {
  it('只保留合法条目并按日期倒序', () => {
    const entries = readReleaseNotes({
      entries: [
        { id: '2026-11-01-1', date: '2026-11-01', title: '旧版本', changes: [{ kind: 'fix', text: '修了个问题' }] },
        { id: '2026-11-12-1', date: '2026-11-12', title: '新版本', changes: [{ kind: 'feat', text: '加了个功能' }] },
        { id: '2026-11-05-1', date: '2026-11-05', title: '中间版本', changes: [{ kind: 'ui', text: '换了个样式' }] },
      ],
    });
    expect(entries.map((item) => item.id)).toEqual([
      '2026-11-12-1',
      '2026-11-05-1',
      '2026-11-01-1',
    ]);
  });

  it('同一天按序号倒序，后提交的排在前面', () => {
    const entries = readReleaseNotes({
      entries: [
        { id: '2026-11-12-1', date: '2026-11-12', title: '上午', changes: [{ kind: 'feat', text: '第一版' }] },
        { id: '2026-11-12-2', date: '2026-11-12', title: '下午', changes: [{ kind: 'fix', text: '第二版' }] },
      ],
    });
    expect(entries.map((item) => item.title)).toEqual(['下午', '上午']);
  });

  it('丢弃日期非法、id 与日期不一致、未知 kind、空改动的条目', () => {
    const entries = readReleaseNotes({
      entries: [
        { id: '2026-02-30-1', date: '2026-02-30', title: '不存在的日期', changes: [{ kind: 'feat', text: 'x' }] },
        { id: '2026-11-12-1', date: '2026-11-11', title: 'id 与日期错位', changes: [{ kind: 'feat', text: 'x' }] },
        { id: '2026-11-13-1', date: '2026-11-13', title: '未知类型', changes: [{ kind: 'unknown', text: 'x' }] },
        { id: '2026-11-14-1', date: '2026-11-14', title: '空改动', changes: [] },
      ],
    });
    expect(entries).toEqual([]);
  });

  it('丢弃超长或带换行的文案，但保留同一条目里的合法改动', () => {
    const entries = readReleaseNotes({
      entries: [
        {
          id: '2026-11-12-1',
          date: '2026-11-12',
          title: '文案过滤',
          changes: [
            { kind: 'feat', text: '正常改动' },
            { kind: 'fix', text: '换\n行' },
            { kind: 'fix', text: '长'.repeat(81) },
          ],
        },
      ],
    });
    expect(entries[0]?.changes).toEqual([{ kind: 'feat', text: '正常改动' }]);
  });

  it('重复 id 只保留第一条，并限制条目与改动数量', () => {
    const entries = readReleaseNotes({
      entries: [
        { id: '2026-11-12-1', date: '2026-11-12', title: '第一次', changes: [{ kind: 'feat', text: 'a' }] },
        { id: '2026-11-12-1', date: '2026-11-12', title: '重复', changes: [{ kind: 'feat', text: 'b' }] },
        {
          id: '2026-11-11-1',
          date: '2026-11-11',
          title: '改动过多',
          changes: Array.from({ length: 12 }, (_, index) => ({ kind: 'feat', text: `第 ${index} 条` })),
        },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries.find((item) => item.id === '2026-11-12-1')?.title).toBe('第一次');
    expect(entries.find((item) => item.id === '2026-11-11-1')?.changes).toHaveLength(8);
  });

  it('顶层结构不对时返回空数组，不抛错', () => {
    expect(readReleaseNotes(null)).toEqual([]);
    expect(readReleaseNotes([])).toEqual([]);
    expect(readReleaseNotes({ entries: 'nope' })).toEqual([]);
  });
});

describe('版本记录分组', () => {
  const entries = [
    entry('2026-11-12-1', '2026-11-12'),
    entry('2026-11-11-1', '2026-11-11'),
    entry('2026-11-10-1', '2026-11-10'),
    entry('2026-11-09-1', '2026-11-09'),
  ];

  it('默认前三条展开，其余进入历史', () => {
    const groups = groupReleaseNotes(entries);
    expect(groups.latest).toHaveLength(3);
    expect(groups.history.map((item) => item.date)).toEqual(['2026-11-09']);
  });

  it('条目不足时不会补空位，历史为空', () => {
    const groups = groupReleaseNotes(entries.slice(0, 2));
    expect(groups.latest).toHaveLength(2);
    expect(groups.history).toEqual([]);
  });

  it('传入负数或小数时按 0 条处理', () => {
    expect(groupReleaseNotes(entries, -1).latest).toEqual([]);
    expect(groupReleaseNotes(entries, 1.8).latest).toHaveLength(1);
  });

  it('排序不修改原数组', () => {
    const source = [entry('2026-11-01-1', '2026-11-01'), entry('2026-11-12-1', '2026-11-12')];
    const sorted = sortReleaseNotes(source);
    expect(source[0]?.id).toBe('2026-11-01-1');
    expect(sorted[0]?.id).toBe('2026-11-12-1');
  });
});

describe('版本记录格式化', () => {
  it('日期用点号展示', () => {
    expect(formatReleaseDate('2026-11-12')).toBe('2026.11.12');
  });

  it('同日序号解析失败时按 1 处理', () => {
    expect(releaseSequence('2026-11-12-2')).toBe(2);
    expect(releaseSequence('2026-11-12')).toBe(1);
    expect(releaseSequence('')).toBe(1);
  });
});

describe('仓库内的版本记录', () => {
  it('至少有一条可展示的记录', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
  });
});
