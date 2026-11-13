'use client';

import { WORLD_LAYOUT, isOnLand, isOnPlaza, isWaterAt, pointInPolygon, rectContains } from '@niuma/shared-types';

/**
 * 「户外可行走地面」的唯一判定：草地贴花撒点与小动物撒点共用这一份。
 *
 * 之前它埋在 `terrain.ts` 的 `grassDecorAllowed` 里，只服务于贴花。
 * 小动物要落在同样的地面上，复制一份必然漂移（改了花海排除规则却忘同步），
 * 所以抽成纯函数放在这里——两边都只认它。
 *
 * 排除项与贴花层完全一致：土路、石砖圆庭、铺装、建筑内部与所有水面。
 * ADR-0047：中央广场已铺石砖，不再允许长草花或小动物。
 */
export function isOutdoorGround(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  // ADR-0064：陆地就是矩形，直接判边界，不再做多边形扫描
  if (!isOnLand(x, y)) return false;
  if (isOnPlaza(x, y)) return false;
  for (const path of WORLD_LAYOUT.paths) {
    if (rectContains(path.rect, x, y) && pointInPolygon(x, y, path.polygon)) return false;
  }
  for (const area of WORLD_LAYOUT.paved) if (rectContains(area, x, y)) return false;
  for (const building of WORLD_LAYOUT.buildings) if (rectContains(building.rect, x, y)) return false;
  if (isWaterAt(x, y)) return false;
  return true;
}
