'use client';

import { useEffect, useState } from 'react';
import type { CharacterAppearance, Species } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { unlockedAchievements } from '@/lib/game/almanac-store';
import { buildSelfArchive } from '@/lib/game/archive';
import { useAttendance } from '@/lib/game/attendance';
import { useCareer } from '@/lib/game/career';
import type { GeoInfo } from '@/lib/game/geo';
import { BadgeArchiveDialog } from './BadgeArchiveDialog';

interface SelfArchiveDialogProps {
  name: string;
  species: Species;
  appearance: CharacterAppearance;
  status: string;
  geo: GeoInfo;
  onClose: () => void;
}

/**
 * 本人档案的取数壳：直接订阅本地考勤、行为统计与 HUD 状态，不走网络。
 * 展示完全交给 `BadgeArchiveDialog`，与他人档案共用同一套字段。
 */
export function SelfArchiveDialog({
  name,
  species,
  appearance,
  status,
  geo,
  onClose,
}: SelfArchiveDialogProps) {
  const now = useAttendance((state) => state.now);
  const firstJoinDate = useAttendance((state) => state.firstJoinDate);
  const totalOnlineMs = useAttendance((state) => state.totalOnlineMs);
  const dailyRecords = useAttendance((state) => state.dailyRecords);
  const sessionStartTime = useAttendance((state) => state.sessionStartTime);
  const stats = useCareer();
  const region = useGameUi((state) => state.region);
  const board = useGameUi((state) => state.board);
  const rank = useGameUi((state) => state.rank);
  const pose = useGameUi((state) => state.localPose);
  const seated = useGameUi((state) => state.seated);
  const seatKind = useGameUi((state) => state.seatKind);
  const onlineSec = useGameUi((state) => state.onlineSec);
  const connection = useGameUi((state) => state.status);
  const myLikes = useGameUi((state) => state.myLikes);
  /** 成就存在 localStorage：首帧给空数组，挂载后再读，避免 SSR 读不到本地数据 */
  const [achievements, setAchievements] = useState<string[]>([]);
  useEffect(() => {
    setAchievements(unlockedAchievements());
  }, []);

  const archive = buildSelfArchive({
    name,
    species,
    appearance,
    status,
    region,
    geo,
    attendance: { firstJoinDate, totalOnlineMs, dailyRecords, sessionStartTime },
    stats,
    pose,
    seated,
    seatKind,
    board,
    rank,
    // 与服务端会话同一口径：断线时不给一个还在往前走的数字
    onlineSec: connection === 'online' ? onlineSec : null,
    likes: myLikes,
    achievements,
    now: now || Date.now(),
  });

  return <BadgeArchiveDialog archive={archive} onClose={onClose} />;
}
