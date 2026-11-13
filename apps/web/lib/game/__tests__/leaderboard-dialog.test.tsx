import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BOARD_METRIC, type BoardMetric, type BoardPacket } from '@niuma/shared-types';
import { LeaderboardDialog } from '../../../components/game/LeaderboardDialog';

function packet(overrides: Partial<BoardPacket> = {}): BoardPacket {
  return {
    metric: BOARD_METRIC.TodayMinutes,
    online: 23,
    slacking: 7,
    selfRank: 2,
    selfValue: 90,
    rows: [
      { id: 1, name: '夜班实习生', value: 123 },
      { id: 2, name: '摸鱼办主任', value: 90 },
      { id: 3, name: '马场小工', value: 81 },
      { id: 4, name: '工位钉子户', value: 72 },
      { id: 5, name: '咖啡续命员', value: 63 },
    ],
    ...overrides,
  };
}

function render(
  boards: Partial<Record<BoardMetric, BoardPacket>>,
  status: 'online' | 'offline' = 'online',
  extras: { selfValue?(metric: BoardMetric): number } = {},
): string {
  return renderToStaticMarkup(
    <LeaderboardDialog
      boards={boards}
      status={status}
      onRequest={() => {}}
      onClose={() => {}}
      {...extras}
    />,
  );
}

describe('牛马榜面板静态渲染', () => {
  it('五个今日页签、前三领奖台、口径说明与底栏都在', () => {
    const html = render({ [BOARD_METRIC.TodayMinutes]: packet() });
    expect(html).toContain('牛马榜');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="leaderboard-panel"');
    expect(html).toContain('role="tabpanel"');
    for (const label of ['工时', '如厕', '击倒', '被创', '步数']) expect(html).toContain(label);
    expect(html).toContain('今日累计工时 · 本人浏览器计时');
    expect(html).toContain('>23</span> 人 · 今日五榜');
    expect(html).toContain('夜班实习生');
    expect(html).toContain('TOP 10');
    expect(html).toContain('今日数据存本浏览器 · 换设备重新开始');
    // 自己在第 2 名：领奖台上带「你」小签
    expect(html).toContain('你');
  });

  it('数值相同的相邻行标「并列」，不让人以为是排序出错', () => {
    const html = render({
      [BOARD_METRIC.TodayMinutes]: packet({
        rows: [
          { id: 1, name: '并排甲', value: 600 },
          { id: 2, name: '并排乙', value: 600 },
          { id: 3, name: '第三位', value: 300 },
        ],
      }),
    });
    expect(html).toContain('并列');
    expect(html).toContain('10h');
  });

  it('空榜给出可执行的下一步，而不是三个空奖台', () => {
    const html = render({
      [BOARD_METRIC.TodayMinutes]: packet({ rows: [], selfRank: 0, selfValue: 0 }),
    });
    expect(html).toContain('今天还没有人上报工时');
    expect(html).not.toContain('TOP 10');
  });

  it('自己在前十之外时固定一条「我的位置」', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `牛马${index + 1}`,
      value: 100 - index,
    }));
    const html = render({
      [BOARD_METRIC.TodayMinutes]: packet({ rows, selfRank: 12, selfValue: 88 }),
    });
    expect(html).toContain('我的位置 · 第 12 名');
    expect(html).toContain('1h 28m');
  });

  it('用本地今日值给自己那一行兜底，不回写别人的快照', () => {
    const html = render(
      { [BOARD_METRIC.TodayMinutes]: packet({ selfValue: 30 }) },
      'online',
      { selfValue: () => 95 },
    );
    // 自己在第 2 名：本地 95 分钟盖住服务端的 90 分钟
    expect(html).toContain('1h 35m');
    // 第一名仍是服务端快照，不被本地值污染
    expect(html).toContain('2h 3m');
  });

  it('断线时保留快照并明确标注连接中断', () => {
    const html = render({ [BOARD_METRIC.TodayMinutes]: packet() }, 'offline');
    expect(html).toContain('连接中断，显示上次快照');
  });

  it('没有快照时显示加载骨架，不把 0 当成在线人数', () => {
    const html = render({});
    expect(html).toContain('正在读取公告栏');
    expect(html).toContain('--');
  });
});
