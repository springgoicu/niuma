'use client';

import {
  MAX_NAME_DISPLAY_UNITS,
  MAX_STATUS_DISPLAY_UNITS,
  truncateToDisplayWidth,
  type CharacterAppearance,
} from '@niuma/shared-types';

/**
 * 昵称与聊天气泡的纵向几何：唯一真相。
 *
 * 这里曾经在 renderer 顶部用 `frame.h - origin.y` 推「头顶余量」，
 * 但那是脚底到帧底的 5 纹素，于是名字被画在膝盖上、气泡直接压在躯干上。
 * 头顶高度只有生成物知道：manifest 的 cosmeticAnchors 给的是相对脚底的头顶锚点，
 * 已经按物种 × 朝向 × 帧列算好，这里只负责取最高点，再按外观给帽檐与犄角让位。
 */

/** 昵称描边宽度：样式与避让读同一份，改宽度不会把描边漏在头顶上 */
export const NAME_STROKE_WIDTH = 4;
/** 描边向字形外各溢出一半，落在文字包围盒之外，必须单独计入避让 */
const STROKE_OVERFLOW = NAME_STROKE_WIDTH / 2;

/**
 * 头顶昵称的显示文本：超过显示宽度预算就换省略号。
 *
 * 头顶是共享空间：16 个汉字折 32 宽，会横跨三个身位、压住邻座的名字与气泡。
 * 截断只影响显示，存档与协议里仍是完整昵称（上限 16 字符）。
 */
export function nameplateText(name: string, maxUnits: number = MAX_NAME_DISPLAY_UNITS): string {
  return truncateToDisplayWidth(name.trim(), maxUnits);
}

/**
 * 头顶状态的显示文本：与协议同一份 16 显示宽预算，超宽换省略号。
 *
 * 协议层已经截过一刀；这里再截是防御旧包与自造包——
 * 一条 200 字的状态足以把整屏的名字连成一片。
 */
export function statusLabelText(status: string, maxUnits: number = MAX_STATUS_DISPLAY_UNITS): string {
  return truncateToDisplayWidth(status.trim(), maxUnits);
}

/** 裸头：头顶再留 1 纹素 */
const CLEARANCE_BARE = 1;
/** 牛角 / 马鬃尖端高出头顶约 4.8 */
const CLEARANCE_EXTRA = 6;
/** 发型图标最高约高出头顶 5 */
const CLEARANCE_HAIR = 6;
/** 礼帽 / 安全帽顶沿约高出头顶 10，再留 1 纹素 */
const CLEARANCE_HEADWEAR = 11;
/** 昵称上沿到气泡底边的固定间隙 */
const BUBBLE_GAP = 2;
/** 状态行底边与昵称上沿之间的间隙：两行文字要能一眼分开，又不能拱出一个身位 */
export const STATUS_GAP = 2;
/** manifest 缺锚点时的兜底：实测头顶（含跳跃弹跳）在脚底上方 50 纹素，绝不退回脚底 */
const FALLBACK_HEAD_TOP = -50;

/**
 * 只依赖头顶锚点这一小块，测试不必把整个 SpriteManifest 拖进来。
 * 结构等价于 `SpriteManifest['cosmeticAnchors']`，[x, y] 相对脚底原点。
 */
export interface AnchorSource {
  cosmeticAnchors?: Record<string, Record<string, Record<string, Record<string, [number, number] | null>>>>;
}

/**
 * 头顶相对脚底原点的 y（负值，越负越高）。
 *
 * 取所有朝向 × 帧列里最高的那个：
 * - 坐 / 躺会把头降下来，取最小值自然把它们排除，「昵称不跟随坐躺」不需要额外的姿态判断；
 * - 跳跃这一列会把角色整体蹦起 3 纹素，取最小值顺带把这段弹跳也避掉，跳起来不会顶到名字。
 */
export function headTopYOf(manifest: AnchorSource, species: string): number {
  const byDirection = manifest.cosmeticAnchors?.[species];
  if (!byDirection) return FALLBACK_HEAD_TOP;
  let top = Number.POSITIVE_INFINITY;
  for (const byColumn of Object.values(byDirection)) {
    for (const anchors of Object.values(byColumn)) {
      const head = anchors?.head;
      if (head && Number.isFinite(head[1])) top = Math.min(top, head[1]);
    }
  }
  return Number.isFinite(top) ? top : FALLBACK_HEAD_TOP;
}

function isWorn(id: string | undefined): boolean {
  return typeof id === 'string' && id.length > 0 && id !== 'none';
}

/** 该外观需要给头顶让出多少纹素：取最高那一件的余量，不逐件相加 */
export function nameClearanceFor(appearance: CharacterAppearance): number {
  const extraId = appearance.species === 'cow' ? appearance.parts.hornId ?? 0 : appearance.parts.maneId ?? 0;
  let clearance = extraId > 0 ? CLEARANCE_EXTRA : CLEARANCE_BARE;
  if (isWorn(appearance.cosmetics.hairstyle)) clearance = Math.max(clearance, CLEARANCE_HAIR);
  if (isWorn(appearance.cosmetics.headwear)) clearance = Math.max(clearance, CLEARANCE_HEADWEAR);
  return clearance;
}

/**
 * 昵称文字笔画的底边（相对脚底原点，供 Text 的 anchor.y = 1 直接使用）。
 * 描边溢出量一并扣掉，否则最外那 2 纹素仍会压在头顶 / 帽顶上。
 */
export function nameBottomY(headTopY: number, appearance: CharacterAppearance): number {
  return headTopY - nameClearanceFor(appearance) - STROKE_OVERFLOW;
}

/**
 * 状态行底边（相对脚底原点，供 anchor.y = 1 直接使用）。
 * 状态永远在昵称**上方**：昵称紧贴头顶，再往头顶方向塞字会压住帽檐。
 */
export function statusBottomY(nameBottom: number, nameHeight: number): number {
  return nameBottom - nameHeight - STATUS_GAP;
}

/**
 * 状态行给气泡让出的高度：没有状态时是 0，气泡可以贴着昵称。
 * 传的是测量后的状态文字高度——空串按 0 处理，不占位。
 */
export function statusStackHeight(statusHeight: number): number {
  return statusHeight > 0 ? STATUS_GAP + statusHeight : 0;
}

/**
 * 气泡容器的顶边：气泡整体落在昵称（以及它上方的状态行）之外，永不重叠。
 * `stackHeight` 是昵称之上已经占掉的高度（目前只来自状态行），默认 0 时行为与旧版一致。
 */
export function bubbleTopY(
  nameBottom: number,
  nameHeight: number,
  bubbleHeight: number,
  stackHeight = 0,
): number {
  return nameBottom - nameHeight - stackHeight - BUBBLE_GAP - bubbleHeight;
}
