/**
 * 发泄区与老板：服务端碰撞、客户端烘焙、交互感应与布局测试共用的唯一坐标真相。
 *
 * 坐标约定与 `WELCOME_LANDMARKS` 一致：`x` 是横向中心，`y` 是脚底（南沿），
 * 宽高是含头顶 UI 在内的整体包围盒。发泄区落在研发园（南侧休息庭院）铺装中央，
 * 从南向主路进院就能正对垫子（ADR-0070）。
 */

import { rectContains, type WorldRect } from './geometry';

/**
 * 发泄区地面：研发园铺装中央偏西，四角距铺装边缘 140 / 60 / 524 / 496。
 * 北沿离庭院入口 160，南沿离铺装底 60，两侧野餐桌与长椅留在垫外。
 */
export const BOSS_ARENA: WorldRect = { x: 3900, y: 5300, w: 420, h: 320 };

/**
 * 老板形象：200×256 texel，1:1 烘焙后按 nearest 放大。
 * 脚底距垫底 40、头顶距垫顶 24，与旧垫的站位比例一致；背对北侧入口。
 */
export const BOSS = {
  x: 4110,
  y: 5580,
  width: 200,
  height: 256,
} as const;

/** 脚底碰撞：只挡站稳的 160×44，正面仍能贴到肚子前出招 */
export const BOSS_SOLID: WorldRect = {
  x: BOSS.x - 80,
  y: BOSS.y - 44,
  w: 160,
  h: 44,
};

/** 受击区：脚底以上 150×110，覆盖躯干与肚子；不在受击区内的空挥不计伤害 */
export const BOSS_HIT_RECT: WorldRect = {
  x: BOSS.x - 75,
  y: BOSS.y - 110,
  w: 150,
  h: 110,
};

/** 每日满血：全园区共享一条血，归零后不再扣点，次日零点重置 */
export const BOSS_MAX_HP = 10000;

/** 是否站在发泄区地面内：只用于区域名与氛围，不参与碰撞 */
export function isInBossArena(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return rectContains(BOSS_ARENA, x, y);
}

/** 受击矩形上离出招者最近的一点：用于把「踢向肚子」折算成一次扇形判定 */
export function bossHitPoint(px: number, py: number): { x: number; y: number } {
  const minX = BOSS_HIT_RECT.x;
  const maxX = BOSS_HIT_RECT.x + BOSS_HIT_RECT.w;
  const minY = BOSS_HIT_RECT.y;
  const maxY = BOSS_HIT_RECT.y + BOSS_HIT_RECT.h;
  return {
    x: px < minX ? minX : px > maxX ? maxX : px,
    y: py < minY ? minY : py > maxY ? maxY : py,
  };
}
