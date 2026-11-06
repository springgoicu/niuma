/**
 * 图集帧预算的唯一真相：列数、每列属于哪个动作、每个动作逐帧停留多久。
 *
 * 生成器只按这里的列号作画，客户端也只按这里的帧序播放，
 * 因此「加一帧」只需要改这一处，不需要再去 web 里找 `* 8`。
 */

/**
 * 帧边长 64：48 的画布上角色只有约 41 texel 高，头、躯干、四条腿互相挤，
 * 只能靠「前后腿错 2px」糊成两根柱子；64 才画得开四段腿与两道关节。
 * 列数只增不改已有列号：CLIPS 的列区间与时长表是动画契约，一动全端跟着抖。
 */
export const FRAME_SIZE = 64;
export const COLUMNS = 34;
export const ROWS = 4;

/**
 * 脚底原点：帧内像素坐标。生成器按它落脚底线与配件挂点，
 * 客户端按 origin.y / FRAME_SIZE 设精灵锚点——之前这个 45/48 在客户端被写死过一次，
 * 现在它是唯一真相，写进 manifest 与 sprite-layout.generated.ts。
 */
export const ORIGIN = { x: FRAME_SIZE / 2, y: 59 } as const;

/**
 * 基础姿态只有四种；`jump`、三套 `*Emote` 与三套 `*Wave` 是叠加式一次性动作，
 * 客户端只在播放窗口内临时替换帧序列，不写回姿态（ADR-0018 / ADR-0019）。
 */
export type PoseName =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'lie'
  | 'jump'
  | 'emote'
  | 'sitEmote'
  | 'lieEmote'
  | 'wave'
  | 'sitWave'
  | 'lieWave';

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
 * 眨眼列：生成器按列号把眼睛画成闭合态（`spec.column === BLINK_COLUMN`）。
 *
 * 它必须仍然被 idle 的 frames 覆盖——`__tests__/layout.test.ts` 要求每一列
 * 恰好属于一个动作。但客户端播放时会把这一列从循环里剔除，改由 35s 调度注入：
 * 原来 1.9s 循环一次眨眼，比真眨眼密得多，看起来像在抽搐（ADR-0013）。
 */
export const BLINK_COLUMN = 2;

/**
 * 动作预算（34 列）：
 * idle 0-2（呼吸 2 + 眨眼 1）、walk 3-8（六拍）、sit 9-10、lie 11-12、
 * jump 13-15（蹲-起跳-落地）、emote 16-18 / sitEmote 19-21 / lieEmote 22-24（只动嘴）、
 * wave 25-27 / sitWave 28-30 / lieWave 31-33（抬前蹄挥一下）。
 *
 * 行走 6 拍 / 90ms 是四足「慢走」的常见节拍：再少会看出滑动，再快就不像踱步。
 * 叫唤与跳统一 440ms：客户端的播放窗口按它算，动画长度与窗口对齐才不会在末帧停顿。
 * 挥手 660ms：抬蹄占一拍、挥出占一拍、收回占一拍；压到 440ms 三帧会读成抽搐（ADR-0019）。
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
  // 跳：蹲下 → 抬起四条腿腾空 → 落地，嘴巴全程闭着（叫唤的嘴只留给 emote）。
  // 腾空帧 220ms：蹲伏 100ms + 落地 120ms，一次跳跃的重心停在空中，才读得出「跳」而不是「抖」
  jump: { frames: [13, 14, 15], frameMs: [100, 220, 120], loopFrom: 0, loop: false },
  // 叫唤：只动嘴，闭嘴 → 张嘴 → 闭嘴；身体不位移，姿势由调用方决定
  emote: { frames: [16, 17, 18], frameMs: [140, 160, 140], loopFrom: 0, loop: false },
  sitEmote: { frames: [19, 20, 21], frameMs: [140, 160, 140], loopFrom: 0, loop: false },
  lieEmote: { frames: [22, 23, 24], frameMs: [140, 160, 140], loopFrom: 0, loop: false },
  // 打招呼：抬前蹄 → 挥出 → 收回，三拍各 220ms。躯干与头不动，只抬一条前腿
  wave: { frames: [25, 26, 27], frameMs: [220, 220, 220], loopFrom: 0, loop: false },
  sitWave: { frames: [28, 29, 30], frameMs: [220, 220, 220], loopFrom: 0, loop: false },
  lieWave: { frames: [31, 32, 33], frameMs: [220, 220, 220], loopFrom: 0, loop: false },
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
  'jump',
  'jump',
  'jump',
  'emote',
  'emote',
  'emote',
  'sitEmote',
  'sitEmote',
  'sitEmote',
  'lieEmote',
  'lieEmote',
  'lieEmote',
  'wave',
  'wave',
  'wave',
  'sitWave',
  'sitWave',
  'sitWave',
  'lieWave',
  'lieWave',
  'lieWave',
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
