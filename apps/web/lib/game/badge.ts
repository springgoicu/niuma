import { POSE, type Pose, type SeatKind, type Species } from '@niuma/shared-types';

/**
 * 工牌展示模型：自己的工牌与点击他人打开的详情共用同一份结构。
 *
 * 这里只放纯函数与常量，不碰网络、Pixi 或 React——服务端入场包 → 会话聚合 → UI
 * 这条链路上，它是唯一对「工牌长什么样」负责的地方。
 */
export interface PlayerBadge {
  id: number;
  name: string;
  species: Species;
  /** 常驻状态；空串表示没设置 */
  status: string;
  /** 园区区域名，来自 `regionAt` */
  region: string;
  /** 服务端会话口径的已在线秒数 */
  onlineSec: number;
  pose: Pose;
  moving: boolean;
  seated: boolean;
  seatKind: SeatKind | null;
}

/**
 * 在线时长：`HH:MM:SS`。小时不封顶——挂在园区里一天也不会溢出不存在的位数。
 * 非有限值（断线 / 还没入场）显示 `--:--`，不要用 00:00:00 假装刚上线。
 */
export function formatOnline(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 当前姿态文案。坐姿分「入座摸鱼」与「席地而坐」，因为这两件事在园区里的语义完全不同；
 * 行走与 moving 标志都算搬砖——服务端抖动时姿态与标志可能差一拍，取并集避免闪字。
 */
export function poseLabel(pose: Pose, moving: boolean, seated: boolean): string {
  if (pose === POSE.Lie) return '躺平中';
  if (pose === POSE.Sit) return seated ? '入座摸鱼' : '席地而坐';
  if (moving || pose === POSE.Walk) return '搬砖中';
  return '在岗待命';
}

/** 入座状态文案：没坐就是「未入座」，坐下时说明坐在什么上面 */
export function seatLabel(seatKind: SeatKind | null): string {
  if (seatKind === null) return '未入座';
  if (seatKind === 'bed') return '床位';
  if (seatKind === 'chair') return '工位椅';
  if (seatKind === 'stool') return '凳子';
  if (seatKind === 'sofa') return '沙发';
  return '马桶';
}

/** 点击命中盒：以脚底为原点，覆盖角色本体与头顶昵称，和 `EntityView` 的锚点一致 */
export const PICK_HALF_WIDTH = 20;
export const PICK_TOP = -74;
export const PICK_BOTTOM = 6;
const PICK_CENTER_Y = (PICK_TOP + PICK_BOTTOM) / 2;
const PICK_HALF_HEIGHT = (PICK_BOTTOM - PICK_TOP) / 2;

export interface PickCandidate {
  id: number;
  x: number;
  y: number;
}

/**
 * 从可见角色里挑出被点中的那个：命中盒内取中心最近者。
 *
 * 纯几何、无渲染依赖：renderer 只负责把屏幕坐标反变换成世界坐标，
 * 「点谁」的判定放在这里，才能被单测覆盖，也不必在帧循环里跑。
 */
export function pickCharacter(
  candidates: readonly PickCandidate[],
  worldX: number,
  worldY: number,
): number | null {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  let bestId: number | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
    const dx = worldX - candidate.x;
    if (Math.abs(dx) > PICK_HALF_WIDTH) continue;
    const dy = worldY - (candidate.y + PICK_CENTER_Y);
    if (Math.abs(dy) > PICK_HALF_HEIGHT) continue;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = candidate.id;
    }
  }
  return bestId;
}
