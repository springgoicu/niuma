import { Px, mulberry32 } from './canvas';
import { S } from './palette';
import { COLUMNS, FRAME_SIZE, ROWS, phaseOfColumn, poseOfColumn, type PoseName } from './layout';

export { COLUMNS, FRAME_SIZE, ROWS };

export type SpeciesName = 'cow' | 'horse';

export interface FrameSpec {
  species: SpeciesName;
  /** 0 down / 1 left / 2 right / 3 up */
  direction: 0 | 1 | 2 | 3;
  /** 0-15，含义见 layout.ts 的 CLIPS */
  column: number;
  tail: number;
  pattern: number;
  extra: number;
  snout: number;
}

/**
 * 画布基准：脚底永远落在 y=45（manifest.origin.y）。
 * 所有姿态只挪躯干与头，不挪脚底线——否则换动作时角色会整体跳一下。
 */
const FEET = 45;
/**
 * 躯干中线压到 22：48px 的画布里，只有把身体收窄、整体左移，
 * 才放得下「头 + 吻」这一整段前伸，否则头只能叠在躯干上，看着像团子。
 */
const BODY_CX = 22;
const HEAD_CX = 33;

interface Anatomy {
  bodyRx: number;
  bodyRy: number;
  /** 站立腿长：躯干底 → 脚底 */
  legH: number;
  legW: number;
  hoofH: number;
  headR: number;
  /** 侧面颈长与颈宽 */
  neckH: number;
  neckW: number;
  muzzleRx: number;
  muzzleRy: number;
  /** 耳朵：牛横着贴一片，马竖着立一支 */
  earW: number;
  earH: number;
}

/**
 * 大头小身：头径接近躯干半宽的 1.6 倍，是这个尺度下「可爱」的主要来源。
 * 牛与马靠四个量分开剪影——颈长、腿长、吻宽、耳形。
 */
const ANATOMY: Record<SpeciesName, Anatomy> = {
  cow: {
    // 方身、短腿、宽吻：一眼是牛
    bodyRx: 8,
    bodyRy: 5.6,
    legH: 12,
    legW: 3,
    hoofH: 3,
    headR: 6.8,
    neckH: 6.5,
    neckW: 3.8,
    muzzleRx: 3.8,
    muzzleRy: 2.5,
    earW: 3,
    earH: 2,
  },
  horse: {
    // 长颈、长腿、窄吻：一眼是马
    bodyRx: 7,
    bodyRy: 5.2,
    legH: 15,
    legW: 3,
    hoofH: 3,
    headR: 5.8,
    neckH: 7.5,
    neckW: 3.2,
    muzzleRx: 2.6,
    muzzleRy: 2.6,
    earW: 2,
    earH: 3,
  },
};

/**
 * 六拍行走：-2 到 +2 的摆动跨度，只在回收相抬 1px。
 * 抬再多就成了「跳」，四足慢走的步幅就是脚贴地滑过去。
 */
const SWING = [2, 1, 0, -2, -1, 0];
const LIFT = [0, 0, 0, 1, 1, 0];
/** 重心起伏：着地那两拍压低 1px，是走路「有重量」的关键 */
const BOB_WALK = [0, 1, 0, 0, 1, 0];
const TAIL_SWAY = [0, 1, 1, 0, -1, -1];

interface LegAnim {
  swing: number;
  lift: number;
}

const STILL: LegAnim = { swing: 0, lift: 0 };

function animAt(phase: number, offset: number): LegAnim {
  const at = (((phase + offset) % 6) + 6) % 6;
  return { swing: SWING[at] ?? 0, lift: LIFT[at] ?? 0 };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 眼睛 2×3：左上角那一格走独立图层当高光。
 * 高光必须单独成层——tint 只能乘，眼睛色本身没法被提亮。
 */
function drawEye(px: Px, x: number, y: number, closed = false): void {
  if (closed) {
    // 闭眼只留一条 2×1 的眼线：眨眼帧不该出现第二种眼睛造型
    px.rect(x, y + 1, 2, 1, S.EyeShade);
    return;
  }
  px.rect(x, y, 2, 3, S.Eye);
  px.set(x, y, S.EyeLight);
  px.rect(x - 1, y - 2, 2, 1, S.BodyShade);
}

/** 尾巴：短尾带尾锤，长尾分三节；摆动只挪 1px，多了会像在抽搐 */
function drawTail(px: Px, species: SpeciesName, x: number, top: number, sway: number): void {
  if (species === 'cow') {
    // 尾巴要挂到躯干下缘之外才读得出来，贴着臀部的短茬只会变成一块凸起
    px.rect(x, top, 2, 4, S.Body);
    px.rect(x - 1 + sway * 0.5, top + 3, 2, 5, S.Body);
    px.rect(x - 2 + sway, top + 7, 2, 4, S.BodyShade);
    px.rect(x - 3 + sway, top + 10, 3, 3, S.BodyShade);
    return;
  }
  px.rect(x, top, 3, 4, S.Body);
  px.rect(x - 1, top + 3, 3, 6, S.Body);
  px.rect(x - 2 + sway, top + 8, 2, 6, S.BodyShade);
  px.rect(x - 3 + sway, top + 13, 3, 4, S.BodyShade);
}

interface LegOptions {
  x: number;
  top: number;
  knee: number;
  hoofH: number;
  w: number;
  far: boolean;
  anim: LegAnim;
  /** 小腿整段换成斑纹色（长袜） */
  sock: boolean;
}

/**
 * 一条腿三段：大腿压暗、小腿提亮、蹄子描深。
 * 远端腿整体再压一档，侧视时前后腿才不会糊成一根柱子。
 */
function drawLeg(px: Px, o: LegOptions): void {
  const x = o.x + o.anim.swing;
  const bottom = FEET - o.anim.lift;
  const upper = o.far ? S.BodyDeep : S.BodyShade;
  const lower = o.far ? S.BodyShade : S.Body;
  const hoof = o.far ? S.HoofShade : S.Hoof;

  px.rect(x, o.top, o.w, o.knee - o.top, upper);
  // 小腿比大腿窄 1px：有关节收窄，腿才不像一根竖着的方条
  px.rect(x, o.knee, o.w - 1, bottom - o.hoofH - o.knee, o.sock ? S.Pattern : lower);
  px.rect(x, bottom - o.hoofH, o.w, o.hoofH, hoof);
  px.rect(x, bottom - o.hoofH, o.w, 1, S.HoofShade);
}

function drawNeck(px: Px, x0: number, y0: number, x1: number, y1: number, r0: number, r1: number): void {
  const steps = 7;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    px.ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r * 1.02, S.Body);
  }
}

/** 牛角 / 马鬃：变体 0 一律不画，所以 extra-0.png 是空图 */
function drawHornOrMane(
  px: Px,
  species: SpeciesName,
  variant: number,
  view: 'side' | 'front' | 'back',
  headX: number,
  headY: number,
  a: Anatomy,
): void {
  if (variant <= 0) return;
  const top = headY - a.headR;

  if (species === 'cow') {
    if (view === 'side') {
      // 侧面只看得见近侧那只角，短而外倾
      if (variant === 1) {
        px.rect(headX + 1, top - 2, 2, 3, S.Extra);
        px.rect(headX + 2, top - 3, 2, 2, S.Extra);
        px.rect(headX + 1, top - 1, 2, 1, S.ExtraShade);
      } else if (variant === 2) {
        px.rect(headX + 1, top - 2, 2, 3, S.Extra);
        px.rect(headX + 3, top - 3, 2, 2, S.Extra);
        px.rect(headX + 1, top, 2, 1, S.ExtraShade);
      } else {
        px.rect(headX + 1, top - 2, 2, 3, S.Extra);
        px.rect(headX + 1, top, 2, 1, S.ExtraShade);
      }
      return;
    }
    if (variant === 1) {
      // 两只角向外上方岔开：直上直下会像两根天线
      px.rect(headX - 7, top - 2, 2, 3, S.Extra);
      px.rect(headX - 8, top - 3, 2, 2, S.Extra);
      px.rect(headX + 5, top - 2, 2, 3, S.Extra);
      px.rect(headX + 6, top - 3, 2, 2, S.Extra);
      px.rect(headX - 7, top - 1, 2, 1, S.ExtraShade);
      px.rect(headX + 5, top - 1, 2, 1, S.ExtraShade);
    } else if (variant === 2) {
      px.rect(headX - 7, top - 2, 2, 3, S.Extra);
      px.rect(headX - 9, top - 3, 3, 2, S.Extra);
      px.rect(headX + 5, top - 2, 2, 3, S.Extra);
      px.rect(headX + 7, top - 3, 3, 2, S.Extra);
    } else {
      // 断角：一边长一边只剩茬口
      px.rect(headX - 7, top - 2, 2, 3, S.Extra);
      px.rect(headX + 5, top, 2, 2, S.ExtraShade);
    }
    return;
  }

  // 马鬃：variant 2 是竖起来的莫西干
  if (variant === 2) {
    for (let i = 0; i < 4; i += 1) {
      px.rect(headX - 5 + i * 2, top - 2 - (i % 2), 2, 3 + (i % 2), S.Extra);
    }
    if (view === 'side') {
      for (let i = 0; i < 4; i += 1) {
        px.rect(headX - 5 + i, headY - 4 + i * 2, 2, 3, S.Extra);
      }
    }
    return;
  }

  if (view === 'side') {
    // 披肩长发：只压颈后缘，压到头顶就变成一顶深色头盔，整颗头会糊掉
    px.rect(headX - 5, top - 1, 4, 2, S.Extra);
    for (let i = 0; i < 5; i += 1) {
      px.rect(headX - 4.5 - i, headY + i * 1.8, 2, 3, S.Extra);
    }
    px.rect(headX - 9, headY + 6, 2, 4, S.ExtraShade);
    return;
  }

  // 正面 / 背面：额前刘海压住一部分额头
  px.rect(headX - 6, top - 1, 12, 2, S.Extra);
  px.rect(headX - 3, top + 1, 2, 3, S.ExtraShade);
  px.rect(headX + 1, top + 1, 2, 2, S.ExtraShade);
}

/** 斑块只落在躯干：落在脸上会压住眼睛与口鼻，整张脸就读不出结构 */
function stampBlobs(px: Px, species: SpeciesName, face: Rect, torso: Rect): void {
  const mask = px.maskOf(['body']);
  for (let y = Math.max(0, face.y0); y <= Math.min(px.h - 1, face.y1); y += 1) {
    for (let x = Math.max(0, face.x0); x <= Math.min(px.w - 1, face.x1); x += 1) {
      mask[y * px.w + x] = 0;
    }
  }
  const rnd = mulberry32(species === 'cow' ? 20261028 : 77123);
  // 三块就够：这个尺寸下再多，斑纹会把躯干填满，看起来只剩一颗黑球
  const blobs = 3;
  for (let i = 0; i < blobs; i += 1) {
    const cx = torso.x0 + rnd() * (torso.x1 - torso.x0);
    const cy = torso.y0 + rnd() * (torso.y1 - torso.y0);
    px.ellipseMasked(cx, cy, 1.4 + rnd() * 2.2, 1.3 + rnd() * 1.7, S.Pattern, mask);
  }
}

interface SideOptions {
  bodyCY: number;
  headCY: number;
  headX: number;
  bodyRx: number;
  bodyRy: number;
  /** 后排腿（先画，压在躯干下面） */
  farLegs: Array<{ x: number; anim: LegAnim }>;
  /** 前排腿（后画，盖在躯干上） */
  nearLegs: Array<{ x: number; anim: LegAnim }>;
  tailSway: number;
  openMouth: boolean;
  /** 躺姿：不画腿，只露一截蹄子 */
  lying: boolean;
  /** 坐下时把后腿折成臀部的鼓包 */
  haunch: boolean;
  blink: boolean;
}

function drawSideBody(px: Px, spec: FrameSpec, a: Anatomy, o: SideOptions): void {
  const bodyTop = o.bodyCY - o.bodyRy;
  const bodyBottom = o.bodyCY + o.bodyRy;
  // 关节要落在躯干之下：膝盖若在躯干内部，大腿那段会被躯干整段盖掉
  const knee = bodyBottom + 4;
  const sock = spec.pattern === 2;

  drawTail(px, spec.species, BODY_CX - o.bodyRx - 2, bodyTop + 1, o.tailSway);

  for (const leg of o.farLegs) {
    drawLeg(px, {
      x: leg.x,
      top: bodyBottom - 3,
      knee,
      hoofH: a.hoofH,
      w: a.legW,
      far: true,
      anim: leg.anim,
      sock,
    });
  }

  px.ellipse(BODY_CX, o.bodyCY, o.bodyRx, o.bodyRy, S.Body);
  // 前胸：牛宽、马窄，侧面剪影靠它分开「方块」与「流线」
  px.ellipse(BODY_CX + o.bodyRx - 2, o.bodyCY + o.bodyRy * 0.2, o.bodyRx * 0.4, o.bodyRy * 0.8, S.Body);
  px.bottomShadeAbove(bodyBottom, S.BodyShade, 2);
  px.rightShade(S.BodyShade, Math.round(bodyTop), Math.round(bodyBottom));

  for (const leg of o.nearLegs) {
    drawLeg(px, {
      x: leg.x,
      top: bodyBottom - 3,
      knee,
      hoofH: a.hoofH,
      w: a.legW,
      far: false,
      anim: leg.anim,
      sock,
    });
  }

  if (o.lying) {
    px.rect(o.headX - 12, FEET - a.hoofH, a.legW + 1, a.hoofH, S.Hoof);
    px.rect(o.headX - 12, FEET - a.hoofH, a.legW + 1, 1, S.HoofShade);
    px.ellipse(BODY_CX - o.bodyRx + 2, bodyBottom - 1, 3.4, 2.2, S.BodyShade);
  }

  if (o.haunch) {
    // 坐下时的后腿：折起来只剩臀部一团，比画四条凳子腿更符合四足动物
    px.ellipse(BODY_CX - o.bodyRx + 4, bodyBottom + 1, 5.2, 3.6, S.BodyShade);
    px.ellipse(BODY_CX - o.bodyRx + 3, bodyBottom + 2, 3.4, 2.2, S.Body);
  }

  drawNeck(px, BODY_CX + o.bodyRx - 4, o.bodyCY - o.bodyRy * 0.5, o.headX - 1, o.headCY + a.headR * 0.3, a.neckW * 0.8, a.neckW * 0.55);

  px.ellipse(o.headX, o.headCY, a.headR, a.headR * 0.94, S.Body);
  // 腮部：让头不是一颗正圆
  px.ellipse(o.headX - a.headR * 0.3, o.headCY + a.headR * 0.38, a.headR * 0.55, a.headR * 0.42, S.Body);
  // 下颌阴影：头与颈同色时，不压这一道线整颗头会和身体糊成一块
  px.ellipse(o.headX - 1, o.headCY + a.headR * 0.78, a.headR * 0.72, 1.6, S.BodyShade);

  if (spec.species === 'cow') {
    px.rect(o.headX - a.headR - 1, o.headCY - 4, a.earW, a.earH, S.Body);
    px.rect(o.headX - a.headR - 1, o.headCY - 3, 2, 1, S.BodyShade);
  } else {
    px.rect(o.headX - 1, o.headCY - a.headR - a.earH, a.earW, a.earH + 1, S.Body);
    px.rect(o.headX - 1, o.headCY - a.headR - 1, 1, 2, S.BodyShade);
  }

  drawHornOrMane(px, spec.species, spec.extra, 'side', o.headX, o.headCY, a);

  // 吻部：牛宽而钝、马窄而长，靠前伸量与高度区分
  const muzzleX = o.headX + a.headR - 1.6;
  const muzzleY = o.headCY + a.headR * 0.42;
  // 吻部与本体同色系，只有 luma 差 10%，不描一圈深色边缘就等于没画
  px.ellipse(muzzleX, muzzleY, a.muzzleRx + 1, a.muzzleRy + 1, S.SnoutShade);
  px.ellipse(muzzleX, muzzleY, a.muzzleRx, a.muzzleRy, S.Snout);
  px.set(muzzleX + a.muzzleRx - 2, muzzleY - 1, S.SnoutShade);
  if (o.openMouth) px.rect(muzzleX - 1, muzzleY + a.muzzleRy - 1, 3, 2, S.SnoutShade);

  drawEye(px, o.headX + 1, o.headCY - 2, o.blink);

  px.topLight(S.BodyLight, 3);
  if (spec.pattern === 1) {
    // 侧视时头在右侧，斑块只铺在躯干那一段
    stampBlobs(
      px,
      spec.species,
      {
        x0: o.headX - a.headR - 2,
        y0: o.headCY - a.headR - 2,
        x1: o.headX + a.headR + 2,
        y1: o.headCY + a.headR + 2,
      },
      { x0: BODY_CX - o.bodyRx + 2, y0: bodyTop + 3, x1: BODY_CX + o.bodyRx - 3, y1: bodyBottom - 3 },
    );
  }

  px.outline();
  px.closeDiagonalGaps();
}

function sideLegs(a: Anatomy, bodyRx: number, phase: number, moving: boolean) {
  const bodyLeft = BODY_CX - bodyRx;
  const bodyRight = BODY_CX + bodyRx;
  // 48px 下画不出四条分开的腿：前、后各两腿只错开 2px，合成一条带明暗的粗腿，
  // 前后两组之间留 5px 空档——这一步比画四条细腿更容易读出四足结构。
  const hindFar = bodyLeft + 0.5;
  const hindNear = bodyLeft + 2.5;
  const frontFar = bodyRight - 5.5;
  const frontNear = bodyRight - 3.5;
  const anim = (offset: number): LegAnim => (moving ? animAt(phase, offset) : STILL);

  // 对角步态：前近与后远同相，前远与后近同相
  return {
    farLegs: [
      { x: hindFar, anim: anim(3) },
      { x: frontFar, anim: anim(0) },
    ],
    nearLegs: [
      { x: hindNear, anim: anim(0) },
      { x: frontNear, anim: anim(3) },
    ],
  };
}

/** 呼吸：待机、坐下、躺下都在第二帧把身体抬 1px，是「活着」的最低成本信号 */
function breatheOffset(spec: FrameSpec, pose: PoseName, phase: number): number {
  if (spec.column === 1) return -1;
  if ((pose === 'sit' || pose === 'lie') && phase === 1) return -1;
  return 0;
}

function drawSide(spec: FrameSpec, a: Anatomy, pose: PoseName, phase: number): Px {
  const px = new Px();
  const standBodyCY = FEET - a.legH - a.bodyRy;
  const standHeadCY = standBodyCY - a.bodyRy - a.neckH + 1;
  const bob = pose === 'walk' ? (BOB_WALK[phase] ?? 0) : 0;
  const breathe = breatheOffset(spec, pose, phase);
  const blink = spec.column === 2;
  const legs = sideLegs(a, a.bodyRx, pose === 'walk' ? phase : 0, pose === 'walk');

  if (pose === 'sit') {
    // 坐下：后腿折成臀部，前腿直撑；尾巴落地
    drawSideBody(px, spec, a, {
      bodyCY: standBodyCY + 6 + breathe,
      headCY: standHeadCY + 4 + breathe,
      headX: HEAD_CX,
      bodyRx: a.bodyRx,
      bodyRy: a.bodyRy,
      farLegs: [{ x: BODY_CX + a.bodyRx - 8, anim: STILL }],
      nearLegs: [{ x: BODY_CX + a.bodyRx - 3, anim: STILL }],
      tailSway: 0,
      openMouth: false,
      lying: false,
      haunch: true,
      blink,
    });
    return px;
  }

  if (pose === 'lie') {
    drawSideBody(px, spec, a, {
      bodyCY: FEET - a.bodyRy * 0.8 - 1 + breathe,
      headCY: FEET - a.headR - 1 + breathe,
      headX: HEAD_CX,
      bodyRx: a.bodyRx + 1,
      bodyRy: a.bodyRy * 0.8,
      farLegs: [],
      nearLegs: [],
      tailSway: 0,
      openMouth: false,
      lying: true,
      haunch: false,
      blink,
    });
    return px;
  }

  // emote：先蹲、再蹦、落地；只挪躯干，脚底线不动
  const hop = pose === 'emote' ? ([2, -3, 0][phase] ?? 0) : 0;
  const emoteLegs: LegAnim = pose === 'emote' && phase === 1 ? { swing: 0, lift: 2 } : STILL;
  drawSideBody(px, spec, a, {
    bodyCY: standBodyCY + bob + hop + breathe,
    headCY: standHeadCY + bob + hop + breathe + (pose === 'emote' && phase === 1 ? -1 : 0),
    headX: HEAD_CX,
    bodyRx: a.bodyRx,
    bodyRy: a.bodyRy,
    farLegs: pose === 'emote' ? legs.farLegs.map((leg) => ({ ...leg, anim: emoteLegs })) : legs.farLegs,
    nearLegs: pose === 'emote' ? legs.nearLegs.map((leg) => ({ ...leg, anim: emoteLegs })) : legs.nearLegs,
    tailSway: pose === 'walk' ? (TAIL_SWAY[phase] ?? 0) : 0,
    openMouth: pose === 'emote' && phase !== 0,
    lying: false,
    haunch: false,
    blink,
  });
  return px;
}

interface FacingOptions {
  bodyCY: number;
  headCY: number;
  bodyRx: number;
  bodyRy: number;
  legTop: number;
  legW: number;
  back: boolean;
  sit: boolean;
  legLift: [number, number];
  openMouth: boolean;
  blink: boolean;
}

function drawFacingBody(px: Px, spec: FrameSpec, a: Anatomy, o: FacingOptions): void {
  const legW = o.legW;
  // 头比躯干宽一圈：正面看才像「大头小身」，也让头与身子在剪影上分得开
  const headRx = a.headR + 1.2;
  const headRy = a.headR * 0.92;
  const muzzleY = o.headCY + headRy * 0.58;

  // 正面四条腿按「外后内前」排布：后腿在身体外缘（更暗），前腿靠中间（更亮）
  const x0 = BODY_CX - o.bodyRx;
  const span = o.bodyRx * 2;
  const hipX: [number, number] = [x0, x0 + span - legW];
  const shoulderX: [number, number] = [x0 + 3.5, x0 + span - 3.5 - legW];

  if (!o.sit) {
    for (let i = 0; i < 2; i += 1) {
      const lift = o.legLift[i] ?? 0;
      // 后腿在外侧、更暗；前腿在内侧、更亮，正面才分得出四条腿
      px.rect(hipX[i]!, o.legTop, legW, FEET - o.legTop - lift, S.BodyShade);
      px.rect(hipX[i]!, FEET - a.hoofH - lift, legW, a.hoofH, S.HoofShade);
      px.rect(shoulderX[i]!, o.legTop + 1, legW, FEET - o.legTop - 1 - lift, S.Body);
      px.rect(shoulderX[i]!, FEET - a.hoofH - lift, legW, a.hoofH, S.Hoof);
      px.rect(shoulderX[i]!, FEET - a.hoofH - lift, legW, 1, S.HoofShade);
    }
  } else {
    // 正面坐下/趴下：四条腿折在身下，只在贴地处露两截蹄子
    const hoofY = FEET - a.hoofH;
    px.rect(BODY_CX - 6, hoofY, legW + 1, a.hoofH, S.Hoof);
    px.rect(BODY_CX + 2, hoofY, legW + 1, a.hoofH, S.Hoof);
    px.rect(BODY_CX - 6, hoofY, legW + 1, 1, S.HoofShade);
    px.rect(BODY_CX + 2, hoofY, legW + 1, 1, S.HoofShade);
  }

  px.ellipse(BODY_CX, o.bodyCY, o.bodyRx, o.bodyRy, S.Body);
  px.bottomShadeAbove(o.bodyCY + o.bodyRy, S.BodyShade, 2);
  px.rightShade(S.BodyShade, Math.round(o.bodyCY - o.bodyRy), Math.round(o.bodyCY + o.bodyRy));

  // 下颌投影画在头之前：头盖掉上半，只留下巴底下一条弧，头和身子才不是一坨
  px.ellipse(BODY_CX, o.headCY + headRy * 0.92, headRx * 0.82, 1.4, S.BodyShade);

  // 耳朵先画，再让头顶盖住根部，才像长在头上而不是贴上去
  if (spec.species === 'cow') {
    px.rect(BODY_CX - headRx - 3, o.headCY - 4, a.earW + 1, a.earH + 1, S.Body);
    px.rect(BODY_CX + headRx - 1, o.headCY - 4, a.earW + 1, a.earH + 1, S.Body);
    px.rect(BODY_CX - headRx - 3, o.headCY - 3, 2, 1, S.BodyShade);
    px.rect(BODY_CX + headRx + 1, o.headCY - 3, 2, 1, S.BodyShade);
  } else {
    px.rect(BODY_CX - 6, o.headCY - headRy - a.earH, a.earW, a.earH + 2, S.Body);
    px.rect(BODY_CX + 4, o.headCY - headRy - a.earH, a.earW, a.earH + 2, S.Body);
  }

  px.ellipse(BODY_CX, o.headCY, headRx, headRy, S.Body);

  drawHornOrMane(px, spec.species, spec.extra, o.back ? 'back' : 'front', BODY_CX, o.headCY, a);

  if (o.back) {
    // 背面：后脑 + 从身体中线垂下来的尾巴
    if (spec.species === 'cow') {
      px.rect(BODY_CX - 1, o.bodyCY + o.bodyRy - 2, 2, 5, S.Body);
      px.rect(BODY_CX - 3, o.bodyCY + o.bodyRy + 3, 5, 3, S.BodyShade);
    } else {
      px.rect(BODY_CX - 1, o.bodyCY + o.bodyRy - 3, 3, 7, S.Body);
      px.rect(BODY_CX - 2, o.bodyCY + o.bodyRy + 4, 3, 5, S.BodyShade);
      px.rect(BODY_CX - 3, o.bodyCY + o.bodyRy + 9, 4, 3, S.BodyShade);
    }
  } else {
    px.ellipse(BODY_CX, muzzleY, a.muzzleRx + 1.2, a.muzzleRy + 1, S.SnoutShade);
    px.ellipse(BODY_CX, muzzleY, a.muzzleRx + 0.4, a.muzzleRy, S.Snout);
    px.set(BODY_CX - a.muzzleRx + 1, muzzleY, S.SnoutShade);
    px.set(BODY_CX + a.muzzleRx - 2, muzzleY, S.SnoutShade);
    px.rect(BODY_CX - 1, muzzleY + a.muzzleRy - 1, 3, 1, S.SnoutShade);
    if (o.openMouth) px.rect(BODY_CX - 2, muzzleY + a.muzzleRy - 2, 4, 2, S.SnoutShade);

    drawEye(px, BODY_CX - 5, o.headCY - 3, o.blink);
    drawEye(px, BODY_CX + 3, o.headCY - 3, o.blink);
  }

  px.topLight(S.BodyLight, 3);
  if (spec.pattern === 1) {
    stampBlobs(
      px,
      spec.species,
      {
        x0: BODY_CX - headRx - 3,
        y0: o.headCY - headRy - 4,
        x1: BODY_CX + headRx + 3,
        y1: o.headCY + headRy + 4,
      },
      { x0: BODY_CX - o.bodyRx + 2, y0: o.bodyCY - o.bodyRy + 2, x1: BODY_CX + o.bodyRx - 3, y1: o.bodyCY + o.bodyRy - 2 },
    );
  }

  px.outline();
  px.closeDiagonalGaps();
}

function drawFacing(spec: FrameSpec, a: Anatomy, pose: PoseName, phase: number): Px {
  const px = new Px();
  const back = spec.direction === 3;
  const standBodyCY = FEET - a.legH - a.bodyRy;
  const standHeadCY = standBodyCY - a.bodyRy - 3;
  const bob = pose === 'walk' ? (phase % 2 === 0 ? 0 : 1) : 0;
  const hop = pose === 'emote' ? ([2, -3, 0][phase] ?? 0) : 0;
  const breathe = breatheOffset(spec, pose, phase);
  const sit = pose === 'sit' || pose === 'lie';
  const walkLift = pose === 'walk' ? phase % 2 : 0;
  const emoteLift = pose === 'emote' && phase === 1 ? 2 : 0;

  drawFacingBody(px, spec, a, {
    bodyCY: sit ? standBodyCY + 8 + breathe : standBodyCY + bob + hop + breathe,
    headCY: sit ? standHeadCY + 9 + breathe : standHeadCY + bob + hop + breathe,
    bodyRx: a.bodyRx,
    bodyRy: a.bodyRy,
    legTop: standBodyCY + a.bodyRy - 3,
    legW: 3,
    back,
    sit,
    legLift: [walkLift + emoteLift, 1 - walkLift + emoteLift],
    openMouth: pose === 'emote' && phase !== 0,
    blink: spec.column === 2,
  });
  return px;
}

export function drawFrame(spec: FrameSpec): Px {
  const pose = poseOfColumn(spec.column);
  const phase = phaseOfColumn(spec.column);
  const a = ANATOMY[spec.species];
  if (spec.direction === 1 || spec.direction === 2) {
    const canvas = drawSide(spec, a, pose, phase);
    return spec.direction === 1 ? canvas.flipX() : canvas;
  }
  return drawFacing(spec, a, pose, phase);
}
