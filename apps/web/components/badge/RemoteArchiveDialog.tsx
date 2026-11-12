'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildRemoteArchive } from '@/lib/game/archive';
import type { PlayerBadge } from '@/lib/game/badge';
import { BadgeArchiveDialog } from './BadgeArchiveDialog';

interface RemoteArchiveDialogProps {
  /** 被查看的角色；null 表示不显示 */
  playerId: number | null;
  /** 点选当帧的工牌：首帧直接渲染，不必等第一次 2Hz 推送 */
  seed?: PlayerBadge | null;
  subscribeBadge: (id: number | null, onChange: (badge: PlayerBadge | null) => void) => void;
  onClose: () => void;
}

/**
 * 他人工牌的取数壳：只持有 playerId，展示数据由渲染线程按 2Hz 推送。
 * 被查看者 despawn 后 `badgeOf` 返回 null，这里直接收起，不留一张旧位置的卡。
 */
export function RemoteArchiveDialog({
  playerId,
  seed = null,
  subscribeBadge,
  onClose,
}: RemoteArchiveDialogProps) {
  const [badge, setBadge] = useState<PlayerBadge | null>(
    seed && seed.id === playerId ? seed : null,
  );

  useEffect(() => {
    if (playerId === null) {
      setBadge(null);
      return;
    }
    setBadge(seed && seed.id === playerId ? seed : null);
    subscribeBadge(playerId, (next) => {
      if (!next) {
        onClose();
        return;
      }
      setBadge(next);
    });
    // 收起时必须退订：渲染线程不再为这张卡片产生任何消息
    return () => subscribeBadge(null, () => {});
  }, [playerId, seed, subscribeBadge, onClose]);

  // 切人时旧 badge 与新 playerId 会有一帧不匹配：宁可空白，也不要闪一下上一个人的档案
  if (playerId === null || badge === null || badge.id !== playerId) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <BadgeArchiveDialog archive={buildRemoteArchive(badge)} onClose={onClose} />,
    document.body,
  );
}
