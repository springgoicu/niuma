import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BOARD_METRIC, type BoardPacket } from '@niuma/shared-types';
import { LeaderboardDialog } from '../../../components/game/LeaderboardDialog';

function packet(overrides: Partial<BoardPacket> = {}): BoardPacket {
  return {
    metric: BOARD_METRIC.Duty,
    online: 23,
    slacking: 7,
    selfRank: 2,
    selfValue: 9_000,
    rows: [
      { id: 1, name: '夜班实习生', value: 12_345 },
      { id: 2, name: '摸鱼办主任', value: 9_000 },
      { id: 3, name: '马场小工', value: 8_100 },
      { id: 4, name: '工位钉子户', value: 7_200 },
      { id: 5, name: '咖啡续命员', value: 6_300 },
    ],
    ...overrides,
  };
}

function render(
  boards: Partial<Record<(typeof BOARD_METRIC)[keyof typeof BOARD_METRIC], BoardPacket>>,
  status: 'online' | 'offline' = 'online',
): string {
  return renderToStaticMarkup(
    <LeaderboardDialog boards={boards} status={status} onRequest={() => {}} onClose={() => {}} />,
  );
}

describe('牛马榜面板静态渲染', () => {
  it('五个纸签页签、前三领奖台、口径说明与底栏都在', () => {
    const html = render({ [BOARD_METRIC.Duty]: packet() });
    expect(html).toContain('牛马榜');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="leaderboard-panel"');
    expect(html).toContain('role="tabpanel"');
    for (const label of ['在岗', '工时', '摸鱼', '击倒', '步数', '人气']) expect(html).toContain(label);
    expect(html).toContain('本次连续在岗 · 服务端计时');
    expect(html).toContain('夜班实习生');
    expect(html).toContain('TOP 10');
    expect(html).toContain('仅统计本园区当前在岗 · 离线即离榜');
    // 自己在第 2 名：领奖台上带「你」小签
    expect(html).toContain('你');
  });

  it('空榜给出可执行的下一步，而不是三个空奖台', () => {
    const html = render({ [BOARD_METRIC.Duty]: packet({ rows: [], selfRank: 0, selfValue: 0 }) });
    expect(html).toContain('还没有人上榜');
    expect(html).not.toContain('TOP 10');
  });

  it('自己在前十之外时固定一条「我的位置」', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `牛马${index + 1}`,
      value: 1_000 - index,
    }));
    const html = render({ [BOARD_METRIC.Duty]: packet({ rows, selfRank: 12, selfValue: 88 }) });
    expect(html).toContain('我的位置 · 第 12 名');
    expect(html).toContain('01:28');
  });

  it('断线时保留快照并明确标注连接中断', () => {
    const html = render({ [BOARD_METRIC.Duty]: packet() }, 'offline');
    expect(html).toContain('连接中断，显示上次快照');
  });

  it('没有快照时显示加载骨架，不把 0 当成在岗人数', () => {
    const html = render({});
    expect(html).toContain('正在读取公告栏');
    expect(html).toContain('--');
  });
});
