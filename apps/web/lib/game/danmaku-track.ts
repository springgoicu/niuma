import { coveredTrackCount, type DanmakuCoverage } from './danmaku-prefs';

/**
 * 弹幕轨道布局与避让的纯函数（ADR-0056）。
 *
 * 单独一层是为了能在没有 DOM / WebGL 的 bun 测试里直接验证避让规则；
 * `danmaku.ts` 只负责把结果画出来。
 */

/** 每条轨道的高度：16px 字号 + 描边 + 上下呼吸位 */
export const DANMAKU_TRACK_HEIGHT = 28;
/** 轨道数下限与上限：屏幕再高也不铺满整屏，避免聊天盖住操作视野 */
export const DANMAKU_MIN_TRACKS = 8;
export const DANMAKU_MAX_TRACKS = 12;
/** 顶部安全区：让开左上角工牌（桌面展开约 96px，手机紧凑约 72px） */
export const DANMAKU_TOP_INSET = 88;
/** 底部安全区：让开聊天框 / 动作条 / 小地图 */
export const DANMAKU_BOTTOM_INSET = 104;
/** 同一轨道前后两条滚动弹幕的最小横向间隙 */
export const DANMAKU_LANE_GAP = 48;

export interface TrackLayout {
  width: number;
  height: number;
  /** 参与弹幕的轨道数（已按覆盖区域裁剪） */
  trackCount: number;
  /** 轨道区顶边（CSS px） */
  bandTop: number;
  /** 滚动 / 顶端轨道的中心 y */
  laneY(index: number): number;
  /** 底端轨道中心 y：`index = 0` 是最靠下的一条 */
  bottomY(index: number): number;
}

/**
 * 轨道布局。
 *
 * 轨道数按可用高度算并夹在 8~12 之间；短视口宁可让最下面一条轨道压到底部安全区，
 * 也不退回 4 轨——轨道太少时固定弹幕会被挤成同一行。
 */
export function computeTrackLayout(width: number, height: number, coverage: DanmakuCoverage): TrackLayout {
  const usable = Math.max(0, height - DANMAKU_TOP_INSET - DANMAKU_BOTTOM_INSET);
  const fullTracks = Math.min(
    DANMAKU_MAX_TRACKS,
    Math.max(DANMAKU_MIN_TRACKS, Math.floor(usable / DANMAKU_TRACK_HEIGHT)),
  );
  const trackCount = Math.max(1, coveredTrackCount(coverage, fullTracks));
  const bandTop = DANMAKU_TOP_INSET;
  // 覆盖区域不是全屏时，底端轨道收进被覆盖的带内：用户选「精简」就是不想让弹幕压到脚下
  const bandBottom =
    coverage === 'full' ? height - DANMAKU_BOTTOM_INSET : bandTop + trackCount * DANMAKU_TRACK_HEIGHT;
  return {
    width,
    height,
    trackCount,
    bandTop,
    laneY: (index) =>
      bandTop + Math.min(index, trackCount - 1) * DANMAKU_TRACK_HEIGHT + DANMAKU_TRACK_HEIGHT / 2,
    bottomY: (index) =>
      bandBottom - Math.min(index, trackCount - 1) * DANMAKU_TRACK_HEIGHT - DANMAKU_TRACK_HEIGHT / 2,
  };
}

/** 供纯函数使用的轨道快照：`right` 是最近一条滚动弹幕的右边缘 */
export interface ScrollLaneSnapshot {
  right: number | null;
}

/**
 * 选择可进入的滚动轨道。
 *
 * 判定不是「上一条已离场」，而是「上一条的尾巴已经完全进入屏幕」——
 * 这正是经典弹幕能同时容纳多条同轨文本的原因。全部繁忙时返回 null，
 * 由调用方按轮替策略兜底。
 */
export function pickScrollLane(
  lanes: readonly ScrollLaneSnapshot[],
  width: number,
  gap: number = DANMAKU_LANE_GAP,
): number | null {
  const enterLine = width - gap;
  for (let i = 0; i < lanes.length; i += 1) {
    const right = lanes[i]!.right;
    if (right === null || right <= enterLine) return i;
  }
  return null;
}

/**
 * 选择固定弹幕的轨道：优先真正空闲的轨，全部被占时选「最早空出来」的那条。
 * 允许短暂交叠也比让人看不到自己的弹幕强——固定弹幕是「立刻可见」的语义。
 */
export function pickFixedLane(freeUntil: readonly number[], now: number): number {
  if (freeUntil.length === 0) return 0;
  for (let i = 0; i < freeUntil.length; i += 1) {
    if (freeUntil[i]! <= now) return i;
  }
  let best = 0;
  for (let i = 1; i < freeUntil.length; i += 1) {
    if (freeUntil[i]! < freeUntil[best]!) best = i;
  }
  return best;
}
