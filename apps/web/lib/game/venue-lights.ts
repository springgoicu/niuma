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
  COMPANY_CORRIDOR,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  TEA_STATION,
  VENT_ROOM,
  VILLA_SPECS,
  WORLD_LAYOUT,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import { VENUE_COLORS } from './venue-palette';

/** 广场地灯盏数：八向均分，光池与灯位共用同一份角度 */
export const PLAZA_LAMP_COUNT = 8;
/**
 * 广场**真实光源**的盏数：只点亮四个正交方向。
 *
 * 斜向那四盏原本与它们脚下的灯柱道具光（`scene-lights` 的 lamp 档，r84 / 0.85）
 * 完全重复；把这四个名额让出来，才能给「广场中心一枚大半径暖光池」腾位置。
 * 地面光池仍按 `PLAZA_LAMP_COUNT` 画满八处，视觉上八盏灯都还亮着。
 */
export const PLAZA_LIGHT_COUNT = 4;

export function venueLights(): LightSpec[] {
  const lights: LightSpec[] = [];

  // 唯一一栋公寓（ADR-0101）：门廊一盏，暖光小半径，只照亮门口一级台阶；
  // 门前花园不添灯，夜里靠 `venue-art` 烘焙的石径暖光斑提亮
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

  // 8 处房产各配一盏标识焦点光：霓虹娱乐街用青/品红双色光，其余院落与木屋保持暖琥珀门灯
  // （正好与移除原擂台+赌场释放的 6 盏预算等量置换：venueLights() 仍维持 20 盏）
  for (const spec of VILLA_SPECS) {
    const color =
      spec.kind === 'club'
        ? VENUE_COLORS.neonStrip.accent
        : spec.kind === 'garage'
          ? VENUE_COLORS.neonStrip.glow
          : VENUE_COLORS.villas.glow;
    lights.push({
      x: spec.gate.x,
      y: spec.gate.y - 18,
      radius: spec.kind === 'club' ? 116 : spec.kind === 'garage' ? 96 : 74,
      color,
      intensity: spec.kind === 'club' ? 0.52 : 0.46,
      flicker: spec.kind === 'club' || spec.kind === 'garage' ? 0.04 : 0.08,
    });
  }

  // 诊所：站内冷白顶灯 + 西门外琥珀泊车灯。
  // 站内压到 0.34、门灯提到 0.4：夜里先看见的是「门」，进门之后才是冷白的诊台。
  lights.push(
    {
      x: CLINIC_RECT.x + CLINIC_RECT.w / 2,
      y: CLINIC_RECT.y + 22,
      radius: 130,
      color: VENUE_COLORS.clinic.glow,
      intensity: 0.34,
    },
    {
      x: CLINIC_ACCESS_PAVING.x + 60,
      y: CLINIC_ACCESS_PAVING.y + 22,
      radius: 88,
      color: 0xffc078,
      intensity: 0.4,
      flicker: 0.12,
    },
  );

  // 中央广场：四盏地灯绕外圈（斜向四盏交给灯柱道具光，见 PLAZA_LIGHT_COUNT）
  const plazaStep = PLAZA_LAMP_COUNT / PLAZA_LIGHT_COUNT;
  for (let i = 0; i < PLAZA_LIGHT_COUNT; i += 1) {
    const index = i * plazaStep;
    const angle = (index / PLAZA_LAMP_COUNT) * Math.PI * 2 + Math.PI / 8;
    lights.push({
      x: PLAZA_CENTER.x + Math.cos(angle) * (PLAZA_RADIUS - 36),
      y: PLAZA_CENTER.y + Math.sin(angle) * (PLAZA_RADIUS - 36) * 0.62,
      radius: 62,
      color: VENUE_COLORS.plaza.glow,
      intensity: 0.3,
      flicker: 0.08,
    });
  }

  // 广场中心：一枚大半径、极低强度的暖光池。
  // 半径 300 让动线在夜里读得出「广场是一个圆」，强度 0.2 保证石砖纹理不被洗白；
  // 这是全园最亮的一枚「面积」而不是最亮的一枚「点」，所以不刺眼。
  lights.push({
    x: PLAZA_CENTER.x,
    y: PLAZA_CENTER.y,
    radius: 300,
    color: 0xffd9a0,
    intensity: 0.2,
    flicker: 0.03,
  });

  // 茶台：一盏暖黄，烛火级别的抖动
  lights.push({
    x: TEA_STATION.x + TEA_STATION.width / 2,
    y: TEA_STATION.y + TEA_STATION.height + 6,
    radius: 64,
    color: VENUE_COLORS.tea.glow,
    intensity: 0.34,
    flicker: 0.14,
  });

  // 企业楼走廊：920px 的走廊此前一盏灯都没有，夜里从大门进来是一条黑缝。
  // 只放一盏在走廊中段，靠光图半径 120 把两端压低，不至于把整条走廊照成白条。
  // 色温改冷白荧光：这里是「加班楼」的压强来源，暖光会让它读成员工休息区。
  lights.push({
    x: COMPANY_CORRIDOR.x + COMPANY_CORRIDOR.w / 2,
    y: COMPANY_CORRIDOR.y + COMPANY_CORRIDOR.h / 2,
    radius: 120,
    color: 0xd8eef8,
    intensity: 0.3,
    flicker: 0.05,
  });

  // 发泄室：顶置旋转红光警示灯，低频微光扫过橡胶地中央
  lights.push({
    x: VENT_ROOM.x + VENT_ROOM.w / 2,
    y: VENT_ROOM.y + 24,
    radius: 96,
    color: 0xff6b5a,
    intensity: 0.26,
    flicker: 0.18,
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
