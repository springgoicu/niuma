import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_APPEARANCE, POSE } from '@niuma/shared-types';
import { buildSelfArchive } from '../archive';
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
      totalOnlineMs: 0,
      dailyRecords: {},
      sessionStartTime: Date.now(),
    },
    stats: {
      distancePx: 0,
      steps: 0,
      slackCount: 0,
      ventedCount: 0,
      knockdownCount: 7,
      overtimeCount: 0,
      lastOvertimeDay: '',
    },
    pose: POSE.Idle,
    seated: false,
    seatKind: null,
    board: [],
    rank: null,
    onlineSec: 0,
    now: Date.now(),
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
  });

  it('renders the week meter and activity panels', () => {
    const attendance = renderToStaticMarkup(<AttendancePanel archive={archive()} />);
    expect(attendance).toContain('本周工时');
    expect(attendance).toContain('本次在岗');
    const activity = renderToStaticMarkup(<ActivityPanel archive={archive()} />);
    expect(activity).toContain('击倒');
    expect(activity).toContain('同屏劳模榜');
  });
});
