'use client';

import {
  CRITTER_VIEW_DOWN,
  CRITTER_VIEW_SIDE,
  CRITTER_VIEW_UP,
  FRAME_GRAZE,
  FRAME_IDLE,
  FRAME_WALK_A,
  FRAME_WALK_B,
} from './critter-art';
import type { ButterflySpawn, FishSpawn, GroundSpawn } from './critter-spawn';

/**
 * 小动物行为：纯函数 + 标量状态，不依赖 Pixi，可直接 `bun:test`。
 *
 * 为什么不做寻路：动物只是氛围，A* 的成本与收益完全不成比例。
 * 这里用「前瞻点 + 换向」的软避障：每 100ms 探一次身前 10–16px，
 * 被挡就转 90°、再挡转另一侧、还挡就掉头，全挡就停下吃草。
 * 于是它永远停在合法地面上，而每只动物每秒最多做 10 次碰撞查询。
 */

export const CRITTER_IDLE = 0;
export const CRITTER_WANDER = 1;
export const CRITTER_FLEE = 2;

/** 游走速度（px/s），按物种：兔轻快、猫散漫、狗最欢 */
const WALK_SPEED = [42, 38, 54] as const;
/** 逃跑速度（px/s） */
const RUN_SPEED = [120, 110, 130] as const;
/** 受惊半径（px）：兔最警觉、猫次之、狗最迟钝 */
const SCARE_RADIUS = [96, 88, 104] as const;
/** 离巢牵引半径：超出就朝巢点偏转，避免越逛越远最后卡在地图角落 */
const HOME_RANGE = 220;
/** 碰撞探测节流：100ms 一次，配合前瞻距离足以避免贴脸撞墙 */
const PROBE_MS = 100;
/** 逃跑后的冷却：不给冷却会变成「玩家站着不动、兔子原地抽搐」 */
const FLEE_COOLDOWN_MS = 1800;

export interface GroundCritter {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  dirX: number;
  dirY: number;
  /** 0 兔 / 1 猫 / 2 狗 */
  species: number;
  variant: number;
  /** 0 正面 / 1 侧面 / 2 背面 */
  view: number;
  /** 侧面朝左时置 true，渲染层用 `scale.x = -1` 镜像 */
  flip: boolean;
  state: number;
  /** 当前状态剩余时长 */
  stateLeftMs: number;
  /** 受惊冷却 */
  cooldownMs: number;
  frame: number;
  frameLeftMs: number;
  /** 距离上次碰撞探测的累计时长 */
  probeMs: number;
}

export interface Butterfly {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  phase: number;
  radiusX: number;
  radiusY: number;
  speed: number;
  variant: number;
  frame: number;
  frameLeftMs: number;
  /** 离地高度（纹素）：整数台阶，不做亚像素浮动 */
  height: number;
}

export function createGroundCritter(spawn: GroundSpawn): GroundCritter {
  return {
    x: spawn.x,
    y: spawn.y,
    homeX: spawn.homeX,
    homeY: spawn.homeY,
    dirX: spawn.dirX,
    dirY: spawn.dirY,
    species: spawn.species,
    variant: spawn.variant,
    view: CRITTER_VIEW_DOWN,
    flip: false,
    state: CRITTER_IDLE,
    stateLeftMs: 600,
    cooldownMs: 0,
    frame: FRAME_IDLE,
    frameLeftMs: 900,
    probeMs: 0,
  };
}

export function createButterfly(spawn: ButterflySpawn): Butterfly {
  return {
    x: spawn.homeX,
    y: spawn.homeY,
    homeX: spawn.homeX,
    homeY: spawn.homeY,
    phase: spawn.phase,
    radiusX: spawn.radiusX,
    radiusY: spawn.radiusY,
    speed: spawn.speed,
    variant: spawn.variant,
    frame: 0,
    frameLeftMs: 90,
    height: 11,
  };
}

function faceDirection(c: GroundCritter): void {
  const ax = Math.abs(c.dirX);
  const ay = Math.abs(c.dirY);
  if (ax >= ay) {
    c.view = CRITTER_VIEW_SIDE;
    c.flip = c.dirX < 0;
  } else {
    c.view = c.dirY > 0 ? CRITTER_VIEW_DOWN : CRITTER_VIEW_UP;
    c.flip = false;
  }
}

function beginIdle(c: GroundCritter, random: () => number, min = 800, span = 2200): void {
  c.state = CRITTER_IDLE;
  c.stateLeftMs = min + random() * span;
  c.frame = FRAME_IDLE;
  c.frameLeftMs = 600 + random() * 600;
}

function beginWander(c: GroundCritter, random: () => number): void {
  const angle = random() * Math.PI * 2;
  c.dirX = Math.cos(angle);
  c.dirY = Math.sin(angle);
  c.state = CRITTER_WANDER;
  c.stateLeftMs = 900 + random() * 1300;
  c.frame = FRAME_WALK_A;
  c.frameLeftMs = 130;
  c.probeMs = PROBE_MS;
  faceDirection(c);
}

function beginFlee(c: GroundCritter, dx: number, dy: number, random: () => number): void {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length > 0.001) {
    c.dirX = dx / length;
    c.dirY = dy / length;
  } else {
    const angle = random() * Math.PI * 2;
    c.dirX = Math.cos(angle);
    c.dirY = Math.sin(angle);
  }
  c.state = CRITTER_FLEE;
  c.stateLeftMs = 450 + random() * 250;
  c.frame = FRAME_WALK_A;
  c.frameLeftMs = 95;
  c.probeMs = 0;
  faceDirection(c);
}

/**
 * 换向：先右转、再左转、最后掉头，取第一个前瞻点能站的方向。
 * `canStand` 是稳定引用（构造期建一次），这里不创建闭包。
 */
function steer(
  c: GroundCritter,
  random: () => number,
  canStand: (x: number, y: number) => boolean,
  look: number,
): boolean {
  const ax = c.dirX;
  const ay = c.dirY;
  const clockwiseFirst = random() < 0.5;
  const turns = clockwiseFirst
    ? [
        [-ay, ax],
        [ay, -ax],
        [-ax, -ay],
      ]
    : [
        [ay, -ax],
        [-ay, ax],
        [-ax, -ay],
      ];
  for (const [dx, dy] of turns) {
    if (canStand(c.x + dx! * look, c.y + dy! * look)) {
      c.dirX = dx!;
      c.dirY = dy!;
      faceDirection(c);
      return true;
    }
  }
  return false;
}

function advance(
  c: GroundCritter,
  dtMs: number,
  speed: number,
  random: () => number,
  canStand: (x: number, y: number) => boolean,
): void {
  const dt = dtMs / 1000;
  // 离巢太远就朝巢点偏转：动物不会自己走回出生点，但至少不会一路漂出去
  const hx = c.homeX - c.x;
  const hy = c.homeY - c.y;
  if (hx * hx + hy * hy > HOME_RANGE * HOME_RANGE) {
    const length = Math.sqrt(hx * hx + hy * hy) || 1;
    // 朝巢点的权重必须压过当前方向：0.65 vs 0.35 时，正背对巢点的动物会真的掉头，
    // 而 0.5/0.5 会被归一化抹平成「继续往前」。
    let dx = c.dirX * 0.35 + (hx / length) * 0.65;
    let dy = c.dirY * 0.35 + (hy / length) * 0.65;
    const blend = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= blend;
    dy /= blend;
    c.dirX = dx;
    c.dirY = dy;
    faceDirection(c);
  }

  const nx = c.x + c.dirX * speed * dt;
  const ny = c.y + c.dirY * speed * dt;

  // 节流探测：100ms 一次，前瞻距离至少覆盖一个探测周期的位移
  c.probeMs += dtMs;
  if (c.probeMs >= PROBE_MS) {
    c.probeMs = 0;
    const look = Math.max(10, speed * 0.12);
    if (!canStand(nx + c.dirX * look, ny + c.dirY * look)) {
      if (!steer(c, random, canStand, look + 8)) beginIdle(c, random, 400, 600);
      return;
    }
  }

  c.x = nx;
  c.y = ny;
  // 每帧对着实际位移方向校准视图：外部改了 dir 也不会出现「横着走却朝屏幕」的错帧
  faceDirection(c);
}

function animate(c: GroundCritter, dtMs: number, random: () => number): void {
  c.frameLeftMs -= dtMs;
  if (c.frameLeftMs > 0) return;
  if (c.state === CRITTER_IDLE) {
    // 站立与低头吃草交替：比走路的节拍慢得多，才像在觅食而不是原地抖
    c.frame = c.frame === FRAME_GRAZE ? FRAME_IDLE : FRAME_GRAZE;
    c.frameLeftMs = 700 + random() * 700;
    return;
  }
  c.frame = c.frame === FRAME_WALK_A ? FRAME_WALK_B : FRAME_WALK_A;
  c.frameLeftMs = c.state === CRITTER_FLEE ? 95 : 130;
}

/**
 * 推进一帧。位移只在 wander / flee 发生；数值保留浮点，落屏时由渲染层吸附整纹素
 * （与角色同一条纪律，ADR-0021）。
 */
export function stepGroundCritter(
  c: GroundCritter,
  dtMs: number,
  playerX: number,
  playerY: number,
  random: () => number,
  canStand: (x: number, y: number) => boolean,
): void {
  if (c.cooldownMs > 0) c.cooldownMs = Math.max(0, c.cooldownMs - dtMs);

  if (c.state !== CRITTER_FLEE && c.cooldownMs === 0) {
    const dx = c.x - playerX;
    const dy = c.y - playerY;
    const radius = SCARE_RADIUS[c.species] ?? SCARE_RADIUS[0]!;
    if (dx * dx + dy * dy < radius * radius) {
      beginFlee(c, dx, dy, random);
      c.cooldownMs = FLEE_COOLDOWN_MS;
    }
  }

  c.stateLeftMs -= dtMs;
  switch (c.state) {
    case CRITTER_WANDER:
      advance(c, dtMs, WALK_SPEED[c.species] ?? WALK_SPEED[0]!, random, canStand);
      if (c.stateLeftMs <= 0) beginIdle(c, random);
      break;
    case CRITTER_FLEE:
      advance(c, dtMs, RUN_SPEED[c.species] ?? RUN_SPEED[0]!, random, canStand);
      if (c.stateLeftMs <= 0) beginIdle(c, random, 700, 500);
      break;
    default:
      if (c.stateLeftMs <= 0) beginWander(c, random);
      break;
  }

  animate(c, dtMs, random);
}

/** 蝴蝶：绕巢点做椭圆盘旋，两帧振翅。飞行不入 y 排序，也不参与碰撞 */
export function stepButterfly(b: Butterfly, dtMs: number): void {
  b.phase += b.speed * (dtMs / 1000);
  if (b.phase > Math.PI * 2) b.phase -= Math.PI * 2;
  b.x = b.homeX + Math.cos(b.phase) * b.radiusX;
  b.y = b.homeY + Math.sin(b.phase) * b.radiusY;
  // 高度取整数台阶：亚像素浮动会让硬像素翅膀立刻发糊（ADR-0005）
  b.height = 11 + Math.round(Math.sin(b.phase * 3) * 2);
  b.frameLeftMs -= dtMs;
  if (b.frameLeftMs <= 0) {
    b.frameLeftMs = 90;
    b.frame = b.frame === 0 ? 1 : 0;
  }
}

/**
 * 小鱼（ADR-0045）：沿河道切向在 ±range 间往返，转身时翻转朝向。
 *
 * 纯客户端、状态只有标量：不寻路、不碰撞，端点由撒点阶段保证在水里。
 * 侧向摆尾用 sin 做 3px 横移；这是客户端表现层，不受布局层「禁止 sin/cos」约束。
 */
export interface Fish {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  dirX: number;
  dirY: number;
  range: number;
  /** 当前离 home 的带符号位移 */
  travel: number;
  /** +1 顺切向 / -1 逆切向 */
  heading: 1 | -1;
  /** 头朝屏幕左时置 true，渲染层用 scale.x = -1 镜像 */
  facesLeft: boolean;
  variant: number;
  speed: number;
  phase: number;
  /** 累计时间（ms），只用于摆尾相位 */
  elapsedMs: number;
  frame: number;
  frameLeftMs: number;
}

export function createFish(spawn: FishSpawn): Fish {
  return {
    x: spawn.x,
    y: spawn.y,
    homeX: spawn.homeX,
    homeY: spawn.homeY,
    dirX: spawn.dirX,
    dirY: spawn.dirY,
    range: spawn.range,
    travel: 0,
    heading: 1,
    facesLeft: spawn.dirX < 0,
    variant: spawn.variant,
    speed: spawn.speed,
    phase: spawn.phase,
    elapsedMs: 0,
    frame: 0,
    frameLeftMs: 140,
  };
}

/** 单帧推进：往返 + 摆尾。位置保留浮点，落屏时吸附整纹素（与角色同一条纪律） */
export function stepFish(fish: Fish, dtMs: number): void {
  const dt = dtMs / 1000;
  fish.elapsedMs += dtMs;
  fish.travel += fish.heading * fish.speed * dt;
  if (fish.travel > fish.range) {
    fish.travel = fish.range - (fish.travel - fish.range);
    fish.heading = -1;
  } else if (fish.travel < -fish.range) {
    fish.travel = -fish.range + (-fish.range - fish.travel);
    fish.heading = 1;
  }
  // 侧向摆尾：3px 横移，永远小于半河宽与撒点的岸边余量
  const sway = Math.sin(fish.phase + fish.elapsedMs * 0.0016) * 3;
  const sideX = -fish.dirY;
  const sideY = fish.dirX;
  fish.x = fish.homeX + fish.dirX * fish.travel + sideX * sway;
  fish.y = fish.homeY + fish.dirY * fish.travel + sideY * sway;
  fish.facesLeft = fish.dirX * fish.heading < 0;

  fish.frameLeftMs -= dtMs;
  if (fish.frameLeftMs <= 0) {
    fish.frameLeftMs = 140;
    fish.frame = fish.frame === 0 ? 1 : 0;
  }
}
