/**
 * 预览台几何：把「角色多大、脚踩在哪」从写死比例改成由容器尺寸推导。
 *
 * 三条不变量：
 * 1. 每纹素仍占整数设备像素（pixel-scale 的约定），缩到多小都不会糊；
 * 2. 视觉盒（角色头顶 → 地面台座）完整落在容器内，且上下留白相等；
 * 3. 容器够高时回到基准倍率，桌面版式与改动前完全一致。
 */
import { fitMetrics, snapCss, type PixelMetrics } from './pixel-scale';
import { SPRITE_LAYOUT } from './sprite-layout.generated';

/** 容器四周的安全留白：角色不贴边，矮屏按比例收窄 */
const SAFE_PADDING_CSS = 8;

/**
 * 基准倍率：DPR 2 时每纹素 10 设备像素，依然能被整除。
 * 64 网格下是 5（角色约 295 CSS px 高），容器够高时用这个值，
 * 预览台版式与改动前一致；矮屏才往下降档。
 */
export const BASE_CSS_PER_TEXEL = 5;

/** 地面台座厚度（纹素）：最外圈椭圆下沿 + 一点余量 */
export const GROUND_TEXELS = 6;
/** 脚底以上到帧顶的纹素：按 origin.y 保守取，头饰总在帧内 */
const BODY_TEXELS = SPRITE_LAYOUT.origin.y;
const FRAME_W = SPRITE_LAYOUT.frame.w;

/** 视觉盒高（纹素）：角色头顶到地面台座底 */
export const VISUAL_TEXELS = BODY_TEXELS + GROUND_TEXELS;

export interface PreviewBox {
  width: number;
  height: number;
}

export interface PreviewPlacement {
  metrics: PixelMetrics;
  /** 脚底锚点的 CSS 坐标（相对画布左上角） */
  footX: number;
  footY: number;
  /** 平台 / 接触阴影相对基准倍率应使用的缩放 */
  scaleRatio: number;
}

/** 同时受宽高约束的档位：宽高任一不够就降一档，避免角色被裁 */
export function fitPreviewMetrics(box: PreviewBox, baseCssPerTexel: number, dpr: number): PixelMetrics {
  const width = Math.max(0, box.width);
  const height = Math.max(0, box.height);
  const pad = Math.min(SAFE_PADDING_CSS, height / 4, width / 4);
  const byHeight = (height - pad * 2) / VISUAL_TEXELS;
  const byWidth = (width - pad * 2) / FRAME_W;
  return fitMetrics(Math.min(baseCssPerTexel, byHeight, byWidth), dpr);
}

/**
 * 视觉盒中心对齐容器中心：
 * 脚底相对视觉盒中心向下偏 (身体纹素 - 地面纹素) / 2，乘上当前倍率即是脚底坐标。
 */
export function layoutPreview(box: PreviewBox, baseCssPerTexel: number, dpr: number): PreviewPlacement {
  const metrics = fitPreviewMetrics(box, baseCssPerTexel, dpr);
  const { cssScale } = metrics;
  const scaleRatio = cssScale / baseCssPerTexel;
  // 容器还没量出尺寸（首帧、隐藏状态）：先给出可用的默认值，等 ResizeObserver 再来一次
  if (!(box.width > 0) || !(box.height > 0)) {
    return { metrics, footX: 0, footY: 0, scaleRatio };
  }
  const footY = box.height / 2 + ((BODY_TEXELS - GROUND_TEXELS) / 2) * cssScale;
  return {
    metrics,
    footX: snapCss(box.width / 2, dpr),
    footY: snapCss(footY, dpr),
    scaleRatio,
  };
}
