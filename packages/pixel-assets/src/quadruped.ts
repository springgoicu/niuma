import { Px, mulberry32 } from './canvas';
import { S } from './palette';

export const FRAME_SIZE = 48;
export const COLUMNS = 8;
export const ROWS = 4;

export type SpeciesName = 'cow' | 'horse';
export type Pose = 'idle' | 'walk' | 'sit' | 'lie';

export interface FrameSpec {
  species: SpeciesName;
  /** 0 down / 1 left / 2 right / 3 up */
  direction: 0 | 1 | 2 | 3;
  /** 0-1 idle, 2-5 walk, 6 sit, 7 lie */
  frame: number;
  tail: number;
  pattern: number;
  extra: number;
  snout: number;
}

interface Params {
  torsoRx: number;
  torsoRy: number;
  headR: number;
  legW: number;
  headY: number;
  neckW: number;
}

const PARAMS: Record<SpeciesName, Params> = {
  cow: { torsoRx: 11, torsoRy: 8.6, headR: 6.6, legW: 3, headY: 16, neckW: 4.4 },
  horse: { torsoRx: 9.8, torsoRy: 7.8, headR: 5.8, legW: 2, headY: 15, neckW: 3.6 },
};

const SWING = [2, 0, -2, 0];

export function poseOf(frame: number): Pose {
  if (frame <= 1) return 'idle';
  if (frame <= 5) return 'walk';
  if (frame === 6) return 'sit';
  return 'lie';
}

function drawLeg(px: Px, x: number, top: number, bottom: number, swing: number, width: number, slot: number): void {
  px.rect(x + swing, top, width, bottom - top, slot);
  px.rect(x + swing, bottom - 3, width, 3, S.Hoof);
  px.rect(x + swing, bottom - 4, width, 1, S.HoofShade);
}

interface FaceRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 眼睛：2×3，右下角那一格留空露出身体色当高光，放大后眼神才不会糊成一块黑 */
function drawEye(px: Px, x: number, y: number): void {
  px.rect(x, y, 2, 1, S.Eye);
  px.rect(x, y + 1, 1, 1, S.Eye);
}

function stampPattern(px: Px, variant: number, species: SpeciesName, face?: FaceRect): void {
  if (variant <= 0) return;
  const mask = px.maskOf(['body']);
  // 斑块不落在脸上：否则会压住眼睛与口鼻，整张脸读不出结构
  if (face) {
    for (let y = Math.max(0, face.y0); y <= Math.min(px.h - 1, face.y1); y += 1) {
      for (let x = Math.max(0, face.x0); x <= Math.min(px.w - 1, face.x1); x += 1) {
        mask[y * px.w + x] = 0;
      }
    }
  }
  if (variant === 1) {
    const rnd = mulberry32(species === 'cow' ? 20261028 : 77123);
    const blobs = species === 'cow' ? 6 : 4;
    for (let i = 0; i < blobs; i += 1) {
      const cx = 14 + rnd() * 18;
      const cy = 22 + rnd() * 9;
      px.ellipseMasked(cx, cy, 1.8 + rnd() * 3.2, 1.6 + rnd() * 2.4, S.Pattern, mask);
    }
    px.ellipseMasked(24, 13, 2.4, 2.2, S.Pattern, mask);
    return;
  }
  for (let i = 0; i < px.data.length; i += 1) {
    if (!mask[i]) continue;
    const y = Math.floor(i / px.w);
    if (y >= 39) px.data[i] = S.Pattern;
  }
}

function drawHornOrMane(
  px: Px,
  species: SpeciesName,
  variant: number,
  direction: 0 | 1 | 2 | 3,
  headX: number,
  headY: number,
  p: Params,
): void {
  if (variant <= 0) return;
  if (species === 'cow') {
    const top = headY - p.headR - 1;
    if (direction === 0 || direction === 3) {
      if (variant === 1) {
        px.rect(16, top - 3, 2, 5, S.Extra);
        px.rect(30, top - 3, 2, 5, S.Extra);
        px.rect(15, top + 1, 4, 2, S.ExtraShade);
        px.rect(29, top + 1, 4, 2, S.ExtraShade);
      } else if (variant === 2) {
        px.rect(16, top, 2, 3, S.Extra);
        px.rect(13, top - 2, 4, 2, S.Extra);
        px.rect(30, top, 2, 3, S.Extra);
        px.rect(31, top - 2, 4, 2, S.Extra);
      } else {
        px.rect(16, top - 2, 2, 5, S.Extra);
        px.rect(30, top + 2, 2, 2, S.Extra);
      }
      return;
    }
    if (variant === 1) {
      px.rect(headX + 2, top - 3, 2, 5, S.Extra);
    } else if (variant === 2) {
      px.rect(headX + 2, top, 2, 3, S.Extra);
      px.rect(headX + 4, top - 2, 3, 2, S.Extra);
    } else {
      px.rect(headX + 2, top - 1, 2, 3, S.Extra);
    }
    return;
  }

  // 马鬃：沿颈线铺一条，variant 决定长度与形状
  const top = headY - p.headR - 1;
  if (direction === 0 || direction === 3) {
    if (variant === 1) {
      px.rect(21, top - 1, 6, 2, S.Extra);
      px.rect(23, headY - 5, 2, 4, S.Extra);
    } else if (variant === 2) {
      px.rect(15, top - 1, 3, 2, S.Extra);
      px.rect(20, top - 2, 3, 3, S.Extra);
      px.rect(25, top - 1, 3, 2, S.Extra);
      px.rect(30, top - 2, 3, 3, S.Extra);
    } else {
      px.rect(21, top - 1, 6, 2, S.Extra);
    }
    return;
  }
  if (variant === 1) {
    px.rect(headX - 4, top - 1, 8, 3, S.Extra);
    px.rect(headX - 6, headY + 2, 3, 12, S.Extra);
    px.rect(headX - 3, headY + 2, 2, 8, S.ExtraShade);
  } else if (variant === 2) {
    px.rect(headX - 4, top - 2, 2, 4, S.Extra);
    px.rect(headX - 1, top - 3, 2, 5, S.Extra);
    px.rect(headX + 2, top - 2, 2, 4, S.Extra);
  } else {
    px.rect(headX - 4, top - 1, 7, 2, S.Extra);
  }
}

function drawSideRight(spec: FrameSpec, p: Params, pose: Pose, phase: number): Px {
  const px = new Px();
  const bob = pose === 'walk' ? (phase === 1 || phase === 3 ? 1 : 0) : spec.frame === 1 ? 1 : 0;
  const bodyY = (pose === 'lie' ? 33 : pose === 'sit' ? 30 : 28) + bob;
  const headX = 35;
  const headY = (pose === 'lie' ? 25 : pose === 'sit' ? 18 : p.headY) + bob;
  const swing = pose === 'walk' ? SWING[phase]! : 0;

  // 尾巴
  if (spec.tail === 0) {
    px.rect(9, bodyY - 6, 2, 7, S.Body);
    px.rect(8, bodyY - 9, 4, 4, S.Body);
  } else {
    px.rect(8, bodyY - 7, 2, 13, S.Body);
    px.rect(9, bodyY + 5, 2, 3, S.BodyShade);
  }

  if (pose !== 'lie') {
    drawLeg(px, 15, bodyY + 6, 45, -swing, p.legW, S.BodyShade);
    drawLeg(px, 19, bodyY + 6, 45, swing, p.legW, S.BodyShade);
  }

  px.ellipse(22, bodyY, p.torsoRx, p.torsoRy, S.Body);
  px.ellipse(headX - 5, (bodyY + headY) / 2 + 2, p.neckW, 6, S.Body);

  if (pose !== 'lie') {
    drawLeg(px, 26, bodyY + 6, 45, swing, p.legW, S.Body);
    drawLeg(px, 30, bodyY + 6, 45, -swing, p.legW, S.Body);
  }

  px.ellipse(headX, headY, p.headR, p.headR * 0.94, S.Body);
  px.rect(headX - 4, headY - p.headR - 1, 2, 3, S.Body);
  drawHornOrMane(px, spec.species, spec.extra, spec.direction, headX, headY, p);

  const snoutWide = spec.species === 'cow' || spec.snout === 0;
  px.ellipse(headX + p.headR - 1, headY + 3, snoutWide ? 3.2 : 2.6, snoutWide ? 2.4 : 2, S.Snout);
  drawEye(px, headX + 1, headY - 1);
  px.rect(headX + 1, headY + 1, 2, 1, S.EyeShade);

  px.bottomShade(S.BodyShade, 2);
  stampPattern(px, spec.pattern, spec.species, {
    x0: headX - 8,
    y0: headY - 8,
    x1: headX + 8,
    y1: headY + 8,
  });
  // 描边最后画：斑纹永远吃不掉轮廓
  px.outline();
  px.closeDiagonalGaps();
  return px;
}

function drawFacing(spec: FrameSpec, p: Params, pose: Pose, phase: number, view: 'front' | 'back'): Px {
  const px = new Px();
  const bob = pose === 'walk' ? (phase === 1 || phase === 3 ? 1 : 0) : spec.frame === 1 ? 1 : 0;
  const lie = pose === 'lie';
  const bodyY = (lie ? 33 : pose === 'sit' ? 31 : 29) + bob;
  const headY = (lie ? 26 : pose === 'sit' ? 17 : 15) + bob;
  const lift = pose === 'walk' ? (phase % 2 === 0 ? 1 : 0) : 0;

  if (!lie) {
    px.rect(15, 33 - lift, p.legW, 12, S.BodyShade);
    px.rect(33 - p.legW + 1, 33, p.legW, 12, S.BodyShade);
    px.rect(19, 33, p.legW, 12, S.Body);
    px.rect(29 - p.legW, 33 - lift, p.legW, 12, S.Body);
    for (const x of [15, 19, 29 - p.legW, 33 - p.legW + 1]) {
      px.rect(x, 42, p.legW, 3, S.Hoof);
    }
  }

  px.ellipse(24, bodyY, 10, 8.6, S.Body);

  if (view === 'front') {
    px.ellipse(24, headY, 7.2, 7, S.Body);
    px.rect(15, headY - 8, 3, 3, S.Body);
    px.rect(30, headY - 8, 3, 3, S.Body);
    drawHornOrMane(px, spec.species, spec.extra, spec.direction, 24, headY, p);
    const snoutWide = spec.species === 'cow' || spec.snout === 0;
    px.ellipse(24, headY + 4, snoutWide ? 4.2 : 3, snoutWide ? 2.6 : 3, S.Snout);
    drawEye(px, 20, headY - 1);
    drawEye(px, 26, headY - 1);
    px.rect(20, headY + 1, 2, 1, S.EyeShade);
    px.rect(26, headY + 1, 2, 1, S.EyeShade);
  } else {
    // 背面：后脑 + 尾巴
    px.ellipse(24, headY + 1, 7, 6.6, S.Body);
    px.rect(16, headY - 6, 2, 3, S.Body);
    px.rect(30, headY - 6, 2, 3, S.Body);
    drawHornOrMane(px, spec.species, spec.extra, spec.direction, 24, headY, p);
    if (spec.tail === 0) {
      px.ellipse(24, bodyY + 6, 2, 3.4, S.Body);
      px.ellipse(24, bodyY + 10, 3, 2.6, S.Body);
    } else {
      px.rect(23, bodyY + 4, 2, 10, S.Body);
      px.rect(22, bodyY + 13, 4, 2, S.BodyShade);
    }
  }

  px.bottomShade(S.BodyShade, 2);
  stampPattern(px, spec.pattern, spec.species, {
    x0: 15,
    y0: headY - 8,
    x1: 33,
    y1: headY + 8,
  });
  px.outline();
  px.closeDiagonalGaps();
  return px;
}

export function drawFrame(spec: FrameSpec): Px {
  const pose = poseOf(spec.frame);
  const phase = pose === 'walk' ? spec.frame - 2 : 0;
  const p = PARAMS[spec.species];
  if (spec.direction === 1 || spec.direction === 2) {
    const canvas = drawSideRight(spec, p, pose, phase);
    return spec.direction === 1 ? canvas.flipX() : canvas;
  }
  return drawFacing(spec, p, pose, phase, spec.direction === 0 ? 'front' : 'back');
}
