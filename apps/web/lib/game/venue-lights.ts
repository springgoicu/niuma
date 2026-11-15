/**
 * 场所焦点光：纯数据，不碰 Pixi，因此在 `bun:test` 里可以直接数数量。
 *
 * 抽出来的原因是预算：`LightRegistry` 超过 `MAX_LIGHTS` 会静默丢弃后来的光源，
 * 灯一多就会「某些灯不亮」且没有任何报错。把光位集中在这里，
 * `lighting.test.ts` 就能断言「场景常驻总数 ≤ 上限」，加灯时测试先炸，而不是线上先黑。
 *
 * 每处只留 1–2 盏：夜里靠对比，不靠堆灯。色温口径见 `venue-palette.ts` 的 `glow`。
 */

import {
  APARTMENT_SPECS,
  CLINIC_ACCESS_PAVING,
  CLINIC_RECT,
  DICE_HALL,
  DICE_HALL_CENTER,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  RING_ARENA,
  TEA_STATION,
  VILLA_SPECS,
  WORLD_LAYOUT,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import { VENUE_COLORS } from './venue-palette';

/** 广场地灯盏数：八向均分，光池与灯位共用同一份角度 */
export const PLAZA_LAMP_COUNT = 8;

export function venueLights(): LightSpec[] {
  const lights: LightSpec[] = [];

  // 六栋公寓：每栋门廊一盏，暖光小半径，只照亮门口一级台阶
  for (const spec of APARTMENT_SPECS) {
    lights.push({
      x: spec.door.x,
      y: spec.door.y - 32,
      radius: 64,
      color: VENUE_COLORS.apartment.glow,
      intensity: 0.42,
      flicker: 0.06,
    });
  }

  // 两栋小院：院门一盏，夜里能看见「家在哪儿」
  for (const spec of VILLA_SPECS) {
    lights.push({
      x: spec.gate.x,
      y: spec.gate.y - 18,
      radius: 72,
      color: VENUE_COLORS.villas.glow,
      intensity: 0.46,
      flicker: 0.08,
    });
  }

  // 擂台：顶部一盏冷白聚光 + 南侧一盏暖补光，胜者侧偏暖
  lights.push(
    {
      x: RING_ARENA.x + RING_ARENA.w / 2,
      y: RING_ARENA.y + 8,
      radius: 150,
      color: 0xfff0b8,
      intensity: 0.6,
    },
    {
      x: RING_ARENA.x + RING_ARENA.w / 2,
      y: RING_ARENA.y + RING_ARENA.h,
      radius: 110,
      color: 0xffd08a,
      intensity: 0.34,
    },
  );

  // 赌场：招牌霓虹（几乎不闪）+ 大厅暖灯
  lights.push(
    {
      x: DICE_HALL_CENTER.x,
      y: DICE_HALL.y + 20,
      radius: 140,
      color: 0xff6fb0,
      intensity: 0.5,
      flicker: 0.02,
    },
    {
      x: DICE_HALL_CENTER.x,
      y: DICE_HALL.y + DICE_HALL.h - 70,
      radius: 120,
      color: 0xffd08a,
      intensity: 0.4,
      flicker: 0.1,
    },
  );

  // 诊所：站内冷白顶灯 + 西门外琥珀泊车灯
  lights.push(
    {
      x: CLINIC_RECT.x + CLINIC_RECT.w / 2,
      y: CLINIC_RECT.y + 22,
      radius: 130,
      color: VENUE_COLORS.clinic.glow,
      intensity: 0.4,
    },
    {
      x: CLINIC_ACCESS_PAVING.x + 60,
      y: CLINIC_ACCESS_PAVING.y + 22,
      radius: 78,
      color: 0xffb84a,
      intensity: 0.3,
      flicker: 0.12,
    },
  );

  // 中央广场：八盏地灯绕外圈
  for (let i = 0; i < PLAZA_LAMP_COUNT; i += 1) {
    const angle = (i / PLAZA_LAMP_COUNT) * Math.PI * 2 + Math.PI / 8;
    lights.push({
      x: PLAZA_CENTER.x + Math.cos(angle) * (PLAZA_RADIUS - 36),
      y: PLAZA_CENTER.y + Math.sin(angle) * (PLAZA_RADIUS - 36) * 0.62,
      radius: 62,
      color: VENUE_COLORS.plaza.glow,
      intensity: 0.3,
      flicker: 0.08,
    });
  }

  // 茶台：一盏暖黄，烛火级别的抖动
  lights.push({
    x: TEA_STATION.x + TEA_STATION.width / 2,
    y: TEA_STATION.y + TEA_STATION.height + 6,
    radius: 64,
    color: VENUE_COLORS.tea.glow,
    intensity: 0.34,
    flicker: 0.14,
  });

  // 卫生间：唯一一间此前完全没有灯的室内，补一盏冷白顶灯（flicker 0，照明不抖）。
  // 房间矩形按显示名反查——这个名字同时被 HUD 区域标签使用，是稳定键（同 interior-art）
  const restroom = WORLD_LAYOUT.buildings.find((building) => building.name === '卫生间');
  if (restroom) {
    lights.push({
      x: restroom.rect.x + restroom.rect.w / 2,
      y: restroom.rect.y + restroom.rect.h / 2,
      radius: 96,
      color: VENUE_COLORS.restroom.glow,
      intensity: 0.34,
    });
  }

  return lights;
}
