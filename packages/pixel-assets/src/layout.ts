/**
 * 图集帧预算的唯一真相：列数、每列属于哪个动作、每个动作逐帧停留多久。
 *
 * 生成器只按这里的列号作画，客户端也只按这里的帧序播放，
 * 因此「加一帧」只需要改这一处，不需要再去 web 里找 `* 8`。
 */

export const FRAME_SIZE = 48;
export const COLUMNS = 16;
export const ROWS = 4;

export type PoseName = 'idle' | 'walk' | 'sit' | 'lie' | 'emote';

export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type DirectionName = (typeof DIRECTIONS)[number];

export interface ClipSpec {
  /** 列索引序列，允许重复：待机用重复帧把眨眼摊稀，而不是再加一张图 */
  frames: number[];
  /** 与 frames 等长的逐帧时长（毫秒） */
  frameMs: number[];
  /** 循环起点；> 0 表示前面若干帧只播一次（落座 / 躺下的过渡帧） */
  loopFrom: number;
  loop: boolean;
}

/**
 * 动作预算（16 列刚好铺满）：
 * idle 0-2（呼吸 2 + 眨眼 1）、walk 3-8（六拍）、sit 9-10、lie 11-12、emote 13-15。
 * 行走 6 拍 / 90ms 是四足「慢走」的常见节拍：再少会看出滑动，再快就不像踱步。
 */
export const CLIPS: Record<PoseName, ClipSpec> = {
  idle: {
    frames: [0, 1, 0, 1, 0, 2],
    frameMs: [430, 240, 430, 240, 430, 140],
    loopFrom: 0,
    loop: true,
  },
  // 80ms 一拍 ≈ 4.2 步/秒：和 MOVE_SPEED 132px/s 的手感对齐，再慢就像在冰上滑
  walk: {
    frames: [3, 4, 5, 6, 7, 8],
    frameMs: [80, 80, 80, 80, 80, 80],
    loopFrom: 0,
    loop: true,
  },
  // 坐/躺只有两帧：9/11 是坐定，10/12 抬 1px 当呼吸，两帧来回就是「还在动」
  sit: { frames: [9, 10], frameMs: [420, 420], loopFrom: 0, loop: true },
  lie: { frames: [11, 12], frameMs: [520, 520], loopFrom: 0, loop: true },
  emote: { frames: [13, 14, 15], frameMs: [120, 170, 150], loopFrom: 0, loop: false },
};

/** 列号 → 动作，供生成器反查；顺序与 CLIPS 的列区间必须一致 */
const COLUMN_POSES: PoseName[] = [
  'idle',
  'idle',
  'idle',
  'walk',
  'walk',
  'walk',
  'walk',
  'walk',
  'walk',
  'sit',
  'sit',
  'lie',
  'lie',
  'emote',
  'emote',
  'emote',
];

if (COLUMN_POSES.length !== COLUMNS) {
  throw new Error(`COLUMN_POSES 长度 ${COLUMN_POSES.length} 与 COLUMNS=${COLUMNS} 不一致`);
}

export function poseOfColumn(column: number): PoseName {
  return COLUMN_POSES[column] ?? 'idle';
}

/** 该列在所属动作内部是第几拍（0 起）；用于摆动、呼吸、过渡的时间轴 */
export function phaseOfColumn(column: number): number {
  const pose = poseOfColumn(column);
  const clip = CLIPS[pose];
  const at = clip.frames.indexOf(column);
  return at >= 0 ? at : 0;
}

/** 整段图集的总像素尺寸，生成器与客户端共用 */
export const ATLAS_WIDTH = FRAME_SIZE * COLUMNS;
export const ATLAS_HEIGHT = FRAME_SIZE * ROWS;
