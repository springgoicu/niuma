import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_APPEARANCE, POSE } from '@niuma/shared-types';
import { buildRemoteArchive, buildSelfArchive } from '../archive';
import { EMPTY_CAREER_DAY } from '../career';
import { BadgeArchiveDialog } from '../../../components/badge/BadgeArchiveDialog';
import { AttendancePanel } from '../../../components/badge/AttendancePanel';
import { ActivityPanel } from '../../../components/badge/ActivityPanel';

function archive() {
  return buildSelfArchive({
    name: '夜班实习生',
    species: 'cow',
    appearance: DEFAULT_APPEARANCE.cow,
    status: '摸鱼中',
    region: '工作区',
    geo: { region: '浙江', city: '杭州', isp: '电信' },
    attendance: {
      firstJoinDate: '2026-03-30',
      dailyRecords: { '2026-04-01': 2 * 3_600_000 },
      dailyToiletRecords: { '2026-04-01': 30 * 60_000 },
    },
    stats: {
      daily: {
        '2026-04-01': { ...EMPTY_CAREER_DAY, distancePx: 1_600, knockdownCount: 7 },
      },
    },
    pose: POSE.Idle,
    seated: false,
    seatKind: null,
    board: [],
    rank: null,
    likes: 4,
    now: new Date(2026, 3, 1, 12, 0, 0).getTime(),
  });
}

function remoteArchive(liked = false) {
  return buildRemoteArchive({
    id: 7,
    name: '摸鱼办主任',
    species: 'cow',
    appearance: DEFAULT_APPEARANCE.cow,
    status: '',
    region: '工作区',
    pose: POSE.Idle,
    moving: false,
    seated: false,
    seatKind: null,
    career: undefined,
    board: [],
    rank: null,
    likes: 9,
    liked,
  });
}

describe('archive dialog static render', () => {
  it('renders the three tabs and the fixed footer', () => {
    const html = renderToStaticMarkup(
      <BadgeArchiveDialog archive={archive()} onClose={() => {}} />,
    );
    expect(html).toContain('证件');
    expect(html).toContain('考勤');
    expect(html).toContain('行为');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="archive-panel"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('固定工号');
    expect(html).toContain('复制工卡');
    expect(html).toContain('考勤小票');
    expect(html).toContain('NIOMA HR · VERIFIED');
    expect(html).toContain('收到的赞');
    expect(html).toContain('4');
  });

  it('renders the like count and button for a remote badge', () => {
    const html = renderToStaticMarkup(
      <BadgeArchiveDialog archive={remoteArchive()} onClose={() => {}} onLike={() => {}} />,
    );
    expect(html).toContain('9');
    expect(html).toContain('点赞');
    expect(html).toContain('代打存档');
  });

  it('shows 已点赞 after the server confirms', () => {
    const html = renderToStaticMarkup(
      <BadgeArchiveDialog archive={remoteArchive(true)} onClose={() => {}} onLike={() => {}} />,
    );
    expect(html).toContain('已点赞');
    expect(html).not.toContain('收到的赞');
  });

  it('renders today attendance with a toilet share, no week or session totals', () => {
    const attendance = renderToStaticMarkup(<AttendancePanel archive={archive()} />);
    expect(attendance).toContain('今日工时');
    expect(attendance).toContain('02:00');
    expect(attendance).toContain('今日如厕');
    expect(attendance).toContain('30 分钟');
    expect(attendance).toContain('如厕占今日工时 25%');
    expect(attendance).not.toContain('本周工时');
    expect(attendance).not.toContain('本次在岗');
    expect(attendance).not.toContain('连续在岗');
    expect(attendance).not.toContain('工龄');

    const activity = renderToStaticMarkup(<ActivityPanel archive={archive()} />);
    expect(activity).toContain('今日口径');
    expect(activity).toContain('击倒');
    expect(activity).toContain('同屏劳模榜');
    expect(activity).not.toContain('摸鱼次数');
  });
});
