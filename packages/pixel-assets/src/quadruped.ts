import { Px, solid, taper } from './canvas';
import { S } from './palette';
import { COLUMNS, FRAME_SIZE, ORIGIN, ROWS, phaseOfColumn, poseOfColumn, type PoseName } from './layout';

export { COLUMNS, FRAME_SIZE, ROWS };

export type SpeciesName = 'cow' | 'horse';

export interface FrameSpec {
  species: SpeciesName;
  /** 0 down / 1 left / 2 right / 3 up */
  direction: 0 | 1 | 2 | 3;
  /** 0-33，含义见 layout.ts 的 CLIPS */
  column: number;
  /** 0 短尾 / 1 长尾 */
  tail: number;
  /** 0 无 / 1 斑块 / 2 长袜 */
  pattern: number;
  /** 牛：0 无角 / 1 短角 / 2 长角 / 3 断角；马：0 短鬃 / 1 长鬃 / 2 竖鬃 */
  extra: number;
  /** 0 宽钝 / 1 窄长 */
  snout: number;
}

/**
 * 画布基准：脚底永远落在 ORIGIN.y（manifest 与客户端锚点同源）。
 * 所有姿态只挪躯干与头，不挪脚底线——否则换动作时角色会整体跳一下。
 */
const FEET = ORIGIN.y;
/**
 * 躯干中线压到 26：64px 的画布里，只有把身体收窄、整体左移，
 * 才放得下「头 + 吻」这一整段前伸，否则头只能叠在躯干上，看着像团子。
 */
const BODY_CX = 26;
/** 头心：42 → 40.5。头径 +2 以后原来的间距让侧视读成「长脖子」，往躯干收 1.5 才贴回去 */
const HEAD_CX = 40.5;

interface Anatomy {
  /** 躯干整宽 / 整高 / 圆角半径：牛用小块圆角压成方块，马用大圆角收成流线 */
  bodyW: number;
  bodyH: number;
  bodyR: number;
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
 * 牛马共用同一套总高（站立 46.2 / 46.7 texel，差 0.5，肉眼齐高），
 * 但把高度分配到完全不同的部位——这是「比例和谐」的真正含义：
 * 并排站时一样高，剪影一眼分得开。
 *
 * 幼态化优化第二轮（2026-11）：在 ADR-0014 基础上进一步微调，增强视觉和谐度。
 * 调整重点：头部 +0.6、颈部参数优化、腿部宽度调整、躯干圆角增大。
 * 确保四条契约保持：总高差≤2、总高 46-56、牛宽>马宽+2、头占比≥0.42、腿占比≤0.38。
 *
 * 牛：腿 16→16.2、躯干 24.4×16→24.8×16.2、颈 5.4→5.6、头 10.4→11.0、吻保持。
 * 马：腿 17.6→17.8、躯干 19.8×14→20.2×14.2、颈 7.6→7.8、头 9→9.6、吻保持。
 */
const ANATOMY: Record<SpeciesName, Anatomy> = {
  cow: {
    bodyW: 24.8,
    bodyH: 16.2,
    bodyR: 6.8,
    legH: 16.2,
    legW: 5,
    hoofH: 4.2,
    headR: 11,
    neckH: 5.6,
    neckW: 6.2,
    muzzleRx: 4.2,
    muzzleRy: 3,
    earW: 5.2,
    earH: 3.6,
  },
  horse: {
    bodyW: 20.2,
    bodyH: 14.2,
    bodyR: 7.6,
    legH: 17.8,
    legW: 4.4,
    hoofH: 4.2,
    headR: 9.6,
    neckH: 7.8,
    neckW: 5.4,
    muzzleRx: 3.2,
    muzzleRy: 3,
    earW: 2.6,
    earH: 3.6,
  },
};

/** 站立总高：脚底到头顶（不含角与鬃）。比例契约测试直接读它 */
export function standHeightOf(species: SpeciesName): number {
  const a = ANATOMY[species];
  const bodyCY = FEET - a.legH - a.bodyH / 2;
  const headCY = bodyCY - a.bodyH / 2 - a.neckH + 1;
  return FEET - (headCY - a.headR * 0.94);
}

/**
 * 幼态比例：头径、腿长各占站立高的几成。
 * 比例契约测试与美术评审读同一份数，免得「看起来够萌」只存在于截图里。
 */
export function proportionsOf(species: SpeciesName): { head: number; leg: number } {
  const height = standHeightOf(species);
  const a = ANATOMY[species];
  return { head: (a.headR * 2) / height, leg: a.legH / height };
}

/** 眼睛边长：幼态契约与配件（眼镜）锚点都读它，改眼型只改一处 */
export function eyeSizeOf(species: SpeciesName): { w: number; h: number } {
  const { w, h } = eyeMetricsOf(ANATOMY[species]);
  return { w, h };
}

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

/** 把「临时画一遍再取遮罩」收成一件事：斑纹与月牙高光都要贴着形体落笔 */
function maskOfShape(px: Px, draw: (canvas: Px) => void): Uint8Array {
  const tmp = new Px(px.w, px.h);
  draw(tmp);
  return tmp.maskOf(['body']);
}

interface EyeMetrics {
  w: number;
  h: number;
  /** 眼框左上角相对头心的纵向偏移 */
  dy: number;
}

/**
 * 眼睛尺寸：牛 5×5、马 4×4。绘制与配件锚点（landmarksOf）共用这一份，
 * 眼镜才不会随改比例漂走（ADR-0007）。
 * 
 * 优化第二轮：头部增大后，眼睛相应增大以维持幼态感。
 */
function eyeMetricsOf(a: Anatomy): EyeMetrics {
  // 头径增大后，眼睛也增大，保持最小值 5×5：牛 5×5→6×5.5、马需要 5×5
  return a.headR >= 10 ? { w: 6, h: 5.5, dy: -3.2 } : { w: 5, h: 5, dy: -3.4 };
}

/**
 * 眼睛：眼珠 + 上眼睑 1px（EyeShade）+ 增强高光。
 * 旧版在眼睛上方隔 1px 压一道 BodyShade 眉线，在浅色脸上读成「皱眉」；
 * 换成贴着眼球的眼睑以后，眼睛变大、脸变软，朝向仍靠眼睑的暗边读得出。
 * 高光必须单独成层——tint 只能乘，眼睛色本身没法被提亮。
 * 
 * 优化第二轮：增大高光区域，使眼神更有神采、更显生动。
 */
function drawEye(px: Px, x: number, y: number, w: number, h: number, closed = false): void {
  if (closed) {
    // 闭眼只留一条与眼珠同宽的眼线：眨眼帧不该出现第二种眼睛造型
    px.rect(x, y + Math.floor((h - 1) / 2), w, 1, S.EyeShade);
    return;
  }
  // 只压一道上眼睑。左右再各加 1px 边，5px 的眼珠会被撑成 7px 的深色方框，
  // 放大后读成「戴墨镜」而不是「大眼睛」。
  px.rect(x - 1, y - 1, w + 2, 1, S.EyeShade);
  px.rect(x, y, w, h, S.Eye);
  // 高光：眼睛变大后，高光也增大以维持比例。牛 3×2→3×3、马 2×2→3×2
  if (w >= 5.5) {
    px.rect(x, y, 3, 3, S.EyeLight);
    px.rect(x + 1, y + 2, 1, 1, S.Eye);
  } else {
    px.rect(x, y, 3, 2, S.EyeLight);
  }
}

/**
 * 尾巴：短尾带尾锤、长尾分三节；摆动只挪 1px，多了会像在抽搐。
 * 尾巴要挂到躯干下缘之外才读得出来，贴着臀部的短茬只会变成一块凸起。
 *
 * 长度必须受脚底线约束：躺姿躯干贴地，固定长度的尾巴会直接穿到地面以下，
 * 在图集里表现为「脚底多出一截描边」。
 */
function drawTail(px: Px, species: SpeciesName, x: number, top: number, sway: number, long: boolean): void {
  const room = Math.max(5, FEET - 2 - top);
  if (species === 'cow') {
    const len = Math.min(long ? 16 : 10, room * 0.72);
    px.polygon(taper(x, top, x - 1 + sway * 0.5, top + len, 4, 3), S.Tail);
    // 尾锤加大一格：幼态比例下尾巴是「小短尾」，一撮蓬松的毛比一根细绳更像小牛
    const tuftH = Math.min(5, Math.max(2.5, room - len));
    px.roundRect(x - 3.2 + sway, top + len, 5.2, tuftH, 1.8, S.TailShade);
    return;
  }
  const len = Math.min(long ? 22 : 16, room * 0.9);
  const mid = top + len * 0.55;
  px.polygon(taper(x, top, x - 1, mid, 4.4, 3.8), S.Tail);
  px.polygon(taper(x - 1, mid - 1, x - 2 + sway, top + len, 3.8, 2.4), S.TailShade);
}

interface LegOptions {
  /** 髋 / 肩中心 x */
  x: number;
  /** 本拍的摆动量，正负 2px */
  swing: number;
  /** 本拍的抬脚量 */
  lift: number;
  /** 与躯干连接处 */
  top: number;
  w: number;
  hoofH: number;
  far: boolean;
  /** 侧视时前腿略向前、后腿略向后，让腿不是一根直柱 */
  bend: number;
  /** 小腿整段换成斑纹色（长袜） */
  sock: boolean;
}

/**
 * 一条腿两段：髋到膝、膝到蹄，膝点横向偏移 1–2px。
 * 远端腿整条压暗且不描阴影——侧视时前后四条腿才不会糊成一根柱子。
 */
function drawLeg(px: Px, o: LegOptions): void {
  const x = o.x + o.swing;
  const bottom = FEET - o.lift;
  const fetY = bottom - o.hoofH;
  const kneeY = o.top + (fetY - o.top) * 0.55;
  const kneeX = x + o.bend;

  if (o.far) {
    px.polygon(taper(x, o.top, kneeX, kneeY, o.w, o.w * 0.86), S.BodyDeep);
    px.polygon(taper(kneeX, kneeY, x, fetY, o.w * 0.86, o.w * 0.82), o.sock ? S.PatternShade : S.BodyDeep);
    px.rect(x - o.w / 2, bottom - o.hoofH, o.w + 0.5, o.hoofH, S.HoofShade);
    return;
  }

  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.polygon(taper(x + dx, o.top + dy, kneeX + dx, kneeY + dy, o.w, o.w * 0.86), slot);
    px.polygon(taper(kneeX + dx, kneeY + dy, x + dx, fetY + dy, o.w * 0.86, o.w * 0.82), slot);
  });

  // 关节：一道 1px 暗线，把大腿与小腿分开，腿才不是一根竖着的方条
  px.rect(kneeX - o.w * 0.44, kneeY, o.w * 0.88, 1, S.BodyShade);
  // 长袜：小腿从膝下换成斑纹色
  if (o.sock) px.polygon(taper(kneeX, kneeY + 1, x, fetY, o.w * 0.8, o.w * 0.78), S.Pattern);
  px.rect(x - o.w / 2, bottom - o.hoofH, o.w + 0.6, o.hoofH, S.Hoof);
  px.rect(x - o.w / 2, bottom - o.hoofH, o.w + 0.6, 1, S.HoofShade);
}

interface RaisedLegOptions extends WaveAnim {
  /** 肩点（与落地腿同一个挂点） */
  x: number;
  top: number;
  w: number;
  hoofH: number;
  sock: boolean;
}

/**
 * 举起来的前腿：从肩点斜向外上，末端横一块蹄子。
 *
 * `drawLeg` 只能从躯干底画到脚底线，蹄子必须落在地面上；挥手要的恰恰是
 * 「蹄子离开地面、停在空中」，所以单独一条两段式肢体，形状语言与落地腿一致。
 */
function drawRaisedLeg(px: Px, o: RaisedLegOptions): void {
  const w = o.w;
  const endX = o.x + o.reach;
  const endY = o.top - o.lift;
  const midX = o.x + o.reach * 0.45;
  const midY = o.top - o.lift * 0.62;

  // 举腿会横过躯干：先在腿形外圈铺一道描边，跨过躯干时才读得出「这是一条腿」，
  // 否则同色叠同色，正视/背视里就是胸口多了一道浅色带。
  px.polygon(taper(o.x, o.top, midX, midY, w + 2, w * 0.9 + 2), S.Outline);
  px.polygon(taper(midX, midY, endX, endY, w * 0.9 + 2, w * 0.84 + 2), S.Outline);
  px.rect(endX - w / 2 - 1, endY - o.hoofH / 2 - 1, w + 2.6, o.hoofH + 2, S.Outline);

  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.polygon(taper(o.x + dx, o.top + dy, midX + dx, midY + dy, w, w * 0.9), slot);
    px.polygon(taper(midX + dx, midY + dy, endX + dx, endY + dy, w * 0.9, w * 0.84), slot);
  });

  // 关节：与落地腿同一道 1px 暗线，抬起来也读得出「这是腿」
  px.rect(midX - w * 0.42, midY, w * 0.84, 1, S.BodyShade);
  if (o.sock) px.polygon(taper(midX, midY + 1, endX, endY, w * 0.8, w * 0.78), S.Pattern);

  // 蹄面横着落在末端：抬腿时蹄底朝前，比竖着收一截更容易读成「挥手」
  px.rect(endX - w / 2, endY - o.hoofH / 2, w + 0.6, o.hoofH, S.Hoof);
  px.rect(endX - w / 2, endY - o.hoofH / 2, w + 0.6, 1, S.HoofShade);
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
  const top = headY - a.headR * 0.94;

  if (species === 'cow') {
    if (view === 'side') {
      // 侧面只看得见近侧那只角：扎根在头顶偏后，向外上方挑出去
      const baseX = headX - a.headR * 0.45;
      if (variant === 3) {
        // 断角：只剩一截茬口
        px.polygon(taper(baseX, top + 2, baseX - 1, top - 1, 4.4, 3.2), S.ExtraShade);
        return;
      }
      // 短而钝（ADR-0014）：reach 由 4/6 收到 3.2/4.6，二段尖角加粗到 3.4 并补半圆尖。
      // 细长尖角在 64 格里读成一根针，粗短的圆角才是「小牛」
      const reach = variant === 2 ? 4.6 : 3.2;
      const tipX = baseX - reach;
      const tipY = top - 3.2;
      px.polygon(taper(baseX, top + 2, baseX - reach * 0.5, top - 1.8, 5.4, 4.4), S.Extra);
      px.polygon(taper(baseX - reach * 0.5, top - 1.4, tipX, tipY, 4.4, 3.4), S.Extra);
      px.ellipse(tipX, tipY, 1.8, 1.6, S.Extra);
      px.polygon(taper(baseX + 1, top + 2, baseX + 0.5, top, 3, 2), S.ExtraShade);
      return;
    }
    const lift = variant === 2 ? 3.6 : 2.8;
    const spread = variant === 2 ? 4.6 : 3.4;
    if (variant === 3) {
      // 断角：一边长一边只剩茬口
      px.polygon(taper(headX - a.headR * 0.72, top + 2, headX - a.headR * 0.72 - spread, top - lift, 5, 3.4), S.Extra);
      px.rect(headX + a.headR * 0.52, top, 3.5, 2.5, S.ExtraShade);
      return;
    }
    for (const side of [-1, 1]) {
      const baseX = headX + side * a.headR * 0.72;
      const tipX = baseX + side * spread;
      const tipY = top - lift;
      px.polygon(taper(baseX, top + 2, baseX + side * spread * 0.6, top - lift * 0.6, 5.4, 4.4), S.Extra);
      px.polygon(taper(baseX + side * spread * 0.6, top - lift * 0.5, tipX, tipY, 4.4, 3.4), S.Extra);
      px.ellipse(tipX, tipY, 1.8, 1.5, S.Extra);
      px.polygon(taper(baseX, top + 2, baseX + side * spread * 0.5, top - lift * 0.5, 2, 1.6), S.ExtraShade);
    }
    return;
  }

  // 马鬃：披肩长发沿颈背往下，竖鬃是沿头顶排一列尖——五根短钝的脊比四根长尖更像一撮毛
  if (variant === 2) {
    for (let i = 0; i < 5; i += 1) {
      const spikeX = headX - a.headR * 0.7 + i * 2.7;
      px.polygon(taper(spikeX, top + 2, spikeX + 0.6, top - 3.2 - (i % 2), 3, 2), S.Extra);
    }
    return;
  }

  const nx0 = headX - a.headR * 0.62;
  const ny0 = top + 2;
  const nx1 = headX - a.headR * 1.9;
  const ny1 = headY + a.headR * 0.95;
  if (view === 'side') {
    // 披肩长发：只压颈背，压到头顶就变成一顶深色头盔，整颗头会糊掉
    px.polygon(taper(nx0, ny0, nx1, ny1, 5, 3.8), S.Extra);
    px.polygon(taper(nx1 + 1, ny1 - 2, nx1 - 1, ny1 + 5, 3.8, 2.4), S.ExtraShade);
    return;
  }
  // 正面 / 背面只留头顶一撮：两侧再包就成了一顶深色头盔，整颗头读不出结构。
  // 五根短脊（中间最高）而不是三根尖：正面才读得出「这是一匹有鬃毛的马」
  for (let i = -2; i <= 2; i += 1) {
    const baseX = headX + i * a.headR * 0.26;
    const lift = 2.6 + (2 - Math.abs(i)) * 0.8;
    px.polygon(taper(baseX, top + 3, baseX + i * 0.8, top - lift, 3.6, 2.2), S.Extra);
  }
}

/** 斑块只落在躯干：落在脸上会压住眼睛与口鼻，整张脸就读不出结构 */
function stampBlobs(px: Px, species: SpeciesName, bodyCY: number, mask: Uint8Array): void {
  if (species === 'cow') {
    // 手排三块，落点写死不随机：上背一大块、臀部一块、前胸一小块
    px.ellipseMasked(BODY_CX - 3.5, bodyCY - 3, 4.6, 3.4, S.Pattern, mask);
    px.ellipseMasked(BODY_CX + 4.5, bodyCY + 2.4, 3.4, 2.8, S.Pattern, mask);
    px.ellipseMasked(BODY_CX - 6, bodyCY + 3.2, 2.6, 2.2, S.Pattern, mask);
    return;
  }
  // 马身上斑纹面积要小：大面积白斑会让棕马变花牛
  px.ellipseMasked(BODY_CX - 2, bodyCY - 2.6, 3.6, 2.4, S.Pattern, mask);
  px.ellipseMasked(BODY_CX + 5.5, bodyCY + 1.8, 2.4, 2, S.Pattern, mask);
}

interface WaveAnim {
  /** 前伸量：侧视朝面朝的方向，正视 / 背视朝屏幕左侧（负值） */
  reach: number;
  /** 上抬量：蹄子相对肩点的高度 */
  lift: number;
}

/**
 * 挥手三拍：抬 → 挥出 → 收回（ADR-0019）。
 *
 * 抬蹄与落蹄各占一拍，不能压成两帧：两帧来回读起来是「抖腿」而不是「打招呼」。
 * 第三拍只留 1 的残余抬起，接回站姿时不会突然掉下去。
 */
const WAVE_REACH = [4, 7, 1] as const;
const WAVE_LIFT = [2, 4, 1] as const;
/** 躺姿的肩点本来就在躯干上，腿要抬得更高才出得来剪影 */
const LIE_WAVE_REACH = [-2, -4, -1] as const;
const LIE_WAVE_LIFT = [8, 10, 6] as const;
/**
 * 正视 / 背视：从肩线往外上方举，蹄子要甩到躯干轮廓之外。
 * 只伸到胸口以内会和躯干同色叠在一起，读成「胸口多了一道浅色带」而不是一条腿。
 */
const FACING_WAVE_REACH = [-8, -10, -5] as const;
const FACING_WAVE_LIFT = [5, 8, 3] as const;

function waveAt(phase: number, reach: readonly number[], lift: readonly number[]): WaveAnim {
  return { reach: reach[phase] ?? 0, lift: lift[phase] ?? 0 };
}

interface SideOptions {
  bodyCY: number;
  bodyW: number;
  bodyH: number;
  headCY: number;
  headX: number;
  hindFar: LegAnim;
  hindNear: LegAnim;
  frontFar: LegAnim;
  frontNear: LegAnim;
  tailSway: number;
  openMouth: boolean;
  /** 躺姿：不画腿，只露一截蹄子 */
  lying: boolean;
  /** 坐下时把后腿折成臀部的鼓包 */
  haunch: boolean;
  /** 打招呼：抬起的近侧前腿；null 表示四条腿照常落地 */
  wave: WaveAnim | null;
  blink: boolean;
}

function drawSideBody(px: Px, spec: FrameSpec, a: Anatomy, o: SideOptions): void {
  const bodyTop = o.bodyCY - o.bodyH / 2;
  const bodyBottom = o.bodyCY + o.bodyH / 2;
  const sock = spec.pattern === 2;
  const longTail = spec.tail === 1;

  // 挂点外移 1px：幼态比例下臀部更圆，尾巴贴着躯干画会被躯干吃掉，只剩一个不读数的凸起
  drawTail(px, spec.species, BODY_CX - o.bodyW / 2 - 1.5, bodyTop + 2, o.tailSway, longTail);

  const legBase = {
    top: bodyBottom - 3,
    w: a.legW,
    hoofH: a.hoofH,
    sock,
  };
  const hindX = BODY_CX - o.bodyW / 2;
  const frontX = BODY_CX + o.bodyW / 2;

  // 远侧两条腿先画：它们永远压在躯干与近侧腿之下。
  // 屈膝量 1.6 → 1.2：腿变短以后原来的折角会读成「弯折的棍子」而不是膝盖
  if (!o.lying) {
    drawLeg(px, { ...legBase, x: hindX + 1, far: true, bend: -1.2, ...o.hindFar });
    drawLeg(px, { ...legBase, x: frontX - 1 - a.legW, far: true, bend: 1.2, ...o.frontFar });
  }

  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.roundRect(BODY_CX + dx, o.bodyCY + dy, o.bodyW, o.bodyH, a.bodyR, slot);
  });

  if (spec.pattern === 1) {
    stampBlobs(
      px,
      spec.species,
      o.bodyCY,
      maskOfShape(px, (canvas) => canvas.roundRect(BODY_CX, o.bodyCY, o.bodyW, o.bodyH, a.bodyR, S.Body)),
    );
  }

  if (!o.lying) {
    drawLeg(px, { ...legBase, x: hindX + 1 + a.legW + 1.2, far: false, bend: -0.8, ...o.hindNear });
    if (o.wave) {
      // 打招呼：近侧前腿离地举起，蹄子按三拍前伸 / 上抬；远侧前腿照常撑地
      drawRaisedLeg(px, { x: frontX - 1, top: legBase.top, w: a.legW, hoofH: a.hoofH, sock, ...o.wave });
    } else {
      drawLeg(px, { ...legBase, x: frontX - 1, far: false, bend: 0.8, ...o.frontNear });
    }
  }

  if (o.lying) {
    px.rect(o.headX - 14, FEET - a.hoofH, a.legW + 1.5, a.hoofH, S.Hoof);
    px.rect(o.headX - 14, FEET - a.hoofH, a.legW + 1.5, 1, S.HoofShade);
    px.roundRect(BODY_CX - o.bodyW / 2 + 4, bodyBottom - 1, 11, 6, 2.5, S.BodyShade);
    if (o.wave) {
      // 躺姿没有腿柱可抬：把贴地那截前蹄抬到躯干上方，躯干与头保持贴地不动
      drawRaisedLeg(px, {
        x: o.headX - 14 + a.legW / 2,
        top: FEET - a.hoofH,
        w: a.legW,
        hoofH: a.hoofH,
        sock,
        ...o.wave,
      });
    }
  }

  if (o.haunch) {
    // 坐下时的后腿：折起来只剩臀部一团，比画四条凳子腿更符合四足动物。
    // 尺寸跟 bodyW 走——写死 12×8 在幼态比例下会变成贴在肚子下面的一小块补丁
    const haunchW = Math.max(10, o.bodyW * 0.5);
    px.roundRect(BODY_CX - o.bodyW / 2 + 4, bodyBottom + 1, haunchW, 7.5, a.bodyR * 0.55, S.BodyShade);
    px.roundRect(BODY_CX - o.bodyW / 2 + 5, bodyBottom + 2, haunchW - 4, 4.5, a.bodyR * 0.4, S.Body);
  }

  // 颈：从躯干前上缘斜拉到下颌，锥形收窄。
  // 挂点往上收到 0.22 体高：颈短了以后还从体侧中线起步，侧视会读成「头悬在身体前面」
  const neckBaseX = BODY_CX + o.bodyW / 2 - 6;
  const neckBaseY = o.bodyCY - o.bodyH * 0.22;
  const neckTopX = o.headX - a.headR * 0.3;
  const neckTopY = o.headCY + a.headR * 0.55;
  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.polygon(taper(neckBaseX + dx, neckBaseY + dy, neckTopX + dx, neckTopY + dy, a.neckW + 1.4, a.neckW * 0.82), slot);
  });

  // 耳朵先画，再让头顶盖住根部，才像长在头上而不是贴上去。
  // 牛耳横向贴一片、末端补圆头；马耳竖着立一支，根部加粗、压低——细长三角耳放大后像贴了片纸。
  if (spec.species === 'cow') {
    const earRootX = o.headX - a.headR * 0.72;
    const earRootY = o.headCY - 2.8;
    const earTipX = earRootX - a.earW;
    const earTipY = earRootY + 1.6;
    px.polygon(taper(earRootX, earRootY, earTipX, earTipY, a.earH, a.earH * 0.72), S.Body);
    px.ellipse(earTipX, earTipY, a.earH * 0.5, a.earH * 0.46, S.Body);
  } else {
    const earRootY = o.headCY - a.headR * 0.66;
    px.polygon(taper(o.headX - 1, earRootY, o.headX - 1.8, earRootY - a.earH, a.earW, a.earW * 0.72), S.Body);
    px.ellipse(o.headX - 1.8, earRootY - a.earH, a.earW * 0.52, a.earW * 0.5, S.Body);
  }

  drawHornOrMane(px, spec.species, spec.extra, 'side', o.headX, o.headCY, a);

  const headRy = a.headR * 0.94;
  const headMask = maskOfShape(px, (canvas) => canvas.ellipse(o.headX, o.headCY, a.headR, headRy, S.Body));
  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.ellipse(o.headX + dx, o.headCY + dy, a.headR, headRy, slot);
  });
  // 月牙高光：偏移后的椭圆被头形裁掉，只在左上弧留 1px 亮边——成块，不逐列撒点
  px.ellipseMasked(o.headX - 1.4, o.headCY - 1.6, a.headR, headRy, S.BodyLight, headMask);
  // 下颌阴影：头与颈同色时，不压这一道线整颗头会和身体糊成一块
  px.ellipse(o.headX - 0.5, o.headCY + headRy * 0.82, a.headR * 0.7, 1.6, S.BodyShade);

  // 吻部：牛宽而钝、马窄而长，靠前伸量与高度区分；宽吻长吻由 snout 选。
  // 纵向压到 0.52（旧版 0.42）——头变大以后吻必须贴着脸下半，否则挂在下巴外像一截管子
  const longSnout = spec.snout === 1;
  const muzzleX = o.headX + a.headR - 1.5 + (longSnout ? 1.2 : 0);
  const muzzleY = o.headCY + a.headR * 0.52;
  const muzzleRx = a.muzzleRx * (longSnout ? 1.12 : 1);
  const muzzleRy = a.muzzleRy * (longSnout ? 0.86 : 1);
  solid(px, S.Snout, S.SnoutShade, (slot, dx, dy) => {
    px.ellipse(muzzleX + dx, muzzleY + dy, muzzleRx, muzzleRy, slot);
  });
  // 鼻孔：一个 1.5×1.2 的暗格，比描一圈深边更省像素也更清楚；吻缩小后鼻孔也要收
  px.rect(muzzleX + muzzleRx - 2.5, muzzleY - 1.2, 1.5, 1.2, S.SnoutShade);
  if (o.openMouth) px.rect(muzzleX - 0.5, muzzleY + muzzleRy - 1, 3, 1.6, S.SnoutShade);

  const eye = eyeMetricsOf(a);
  drawEye(px, o.headX + 0.5, o.headCY + eye.dy, eye.w, eye.h, o.blink);

  px.outline();
  px.retagOutline(S.Outline, 'tail', S.TailOutline);
  px.closeDiagonalGaps();
}

function sideLegs(phase: number, moving: boolean) {
  const anim = (offset: number): LegAnim => (moving ? animAt(phase, offset) : STILL);

  // 四拍慢走：近后腿 → 远前腿 → 远后腿 → 近前腿，四条腿各占一拍
  return {
    hindFar: anim(3),
    hindNear: anim(0),
    frontFar: anim(1),
    frontNear: anim(4),
  };
}

/**
 * 呼吸：待机、坐下、躺下都在第二帧把身体抬 1px，是「活着」的最低成本信号。
 *
 * 叫唤（`emote` / `sitEmote` / `lieEmote`）不参与呼吸：叫唤只动嘴，
 * 任何整体位移都会让「坐着叫唤」读成「坐着弹一下」，也会让像素回归测试失去意义。
 */
function breatheOffset(spec: FrameSpec, pose: PoseName, phase: number): number {
  if (spec.column === 1) return -1;
  if ((pose === 'sit' || pose === 'lie') && phase === 1) return -1;
  return 0;
}

/**
 * 姿态 → 侧视构图参数。抽出来是为了让锚点生成与绘制共用同一份几何：
 * 配件的挂点若另写一套偏移，改一次美术就会漂一次（ADR-0007）。
 */
function sideOptions(spec: FrameSpec, a: Anatomy, pose: PoseName, phase: number): SideOptions {
  const standBodyCY = FEET - a.legH - a.bodyH / 2;
  const standHeadCY = standBodyCY - a.bodyH / 2 - a.neckH + 1;
  const bob = pose === 'walk' ? (BOB_WALK[phase] ?? 0) : 0;
  const breathe = breatheOffset(spec, pose, phase);
  const blink = spec.column === 2;
  const walk = pose === 'walk';
  const legs = sideLegs(walk ? phase : 0, walk);
  /** 叫唤只动嘴：站/坐/躺三套姿势共用同一条「第二拍张嘴」的节奏 */
  const openMouth = (pose === 'emote' || pose === 'sitEmote' || pose === 'lieEmote') && phase === 1;

  if (pose === 'sit' || pose === 'sitEmote' || pose === 'sitWave') {
    // 坐下：后腿折成臀部，前腿直撑；尾巴落地。
    // 落座量 7 → 5.5、低头量 5 → 4：腿短了 2，原来的位移会让屁股悬在半空
    return {
      bodyCY: standBodyCY + 5.5 + breathe,
      bodyW: a.bodyW,
      bodyH: a.bodyH * 0.9,
      headCY: standHeadCY + 6 + breathe,
      headX: HEAD_CX,
      hindFar: STILL,
      hindNear: STILL,
      frontFar: STILL,
      frontNear: STILL,
      tailSway: 0,
      openMouth,
      lying: false,
      haunch: true,
      wave: pose === 'sitWave' ? waveAt(phase, WAVE_REACH, WAVE_LIFT) : null,
      blink,
    };
  }

  if (pose === 'lie' || pose === 'lieEmote' || pose === 'lieWave') {
    return {
      bodyCY: FEET - (a.bodyH * 0.72) / 2 - 2 + breathe,
      bodyW: a.bodyW + 1,
      bodyH: a.bodyH * 0.72,
      headCY: FEET - a.headR - 2 + breathe,
      headX: HEAD_CX,
      hindFar: STILL,
      hindNear: STILL,
      frontFar: STILL,
      frontNear: STILL,
      tailSway: 0,
      openMouth,
      lying: true,
      haunch: false,
      wave: pose === 'lieWave' ? waveAt(phase, LIE_WAVE_REACH, LIE_WAVE_LIFT) : null,
      blink,
    };
  }

  // jump：先蹲、再蹦、落地；只挪躯干，脚底线不动。
  // 腾空 -5 是帧顶安全上限：牛角尖端与 1px 描边在站立时已到 y≈6，再高就会被 64 帧裁掉。
  // 剩下的落差交给客户端程序化抬升（renderer 的跳跃弧线），图集只负责「收腿离地」的姿势。
  const jumping = pose === 'jump';
  const hop = jumping ? ([3, -5, 0][phase] ?? 0) : 0;
  const jumpLegs: LegAnim = jumping && phase === 1 ? { swing: 0, lift: 5 } : STILL;
  return {
    bodyCY: standBodyCY + bob + hop + breathe,
    bodyW: a.bodyW,
    bodyH: a.bodyH,
    headCY: standHeadCY + bob + hop + breathe,
    headX: HEAD_CX,
    hindFar: jumping ? jumpLegs : legs.hindFar,
    hindNear: jumping ? jumpLegs : legs.hindNear,
    frontFar: jumping ? jumpLegs : legs.frontFar,
    frontNear: jumping ? jumpLegs : legs.frontNear,
    tailSway: walk ? (TAIL_SWAY[phase] ?? 0) : 0,
    openMouth,
    lying: false,
    haunch: false,
    wave: pose === 'wave' ? waveAt(phase, WAVE_REACH, WAVE_LIFT) : null,
    blink,
  };
}

function drawSide(spec: FrameSpec, a: Anatomy, pose: PoseName, phase: number): Px {
  const px = new Px();
  drawSideBody(px, spec, a, sideOptions(spec, a, pose, phase));
  return px;
}

interface FacingOptions {
  bodyCY: number;
  bodyW: number;
  bodyH: number;
  headCY: number;
  legTop: number;
  back: boolean;
  sit: boolean;
  legLift: [number, number];
  openMouth: boolean;
  /** 打招呼：举起的近侧前腿与所在侧（0 = 屏幕左），null 表示四条腿都落地 */
  wave: (WaveAnim & { side: 0 | 1 }) | null;
  blink: boolean;
}

function drawFacingBody(px: Px, spec: FrameSpec, a: Anatomy, o: FacingOptions): void {
  // 正面头必须窄于肩宽：正面只看得到肩与四条腿，头若与躯干同宽，
  // 一颗头正好盖住整个上身，整只动物就糊成一个白团（48px 那版的问题）
  // 马脸按比例更窄，但窄到与圆桶躯干脱节就只剩一颗「小头」；正面给马多留 0.3 的半个像素
  const headRx = a.headR + (spec.species === 'horse' ? 0.7 : 0.4);
  // 0.94 而不是 0.9：幼态头是圆的，扁头会把刚放大的眼睛又压回一条带子里
  const headRy = a.headR * 0.94;
  // 吻部压在脸的下半而不是下巴尖：贴到下巴就会和肩线连成一块浅色胸兜
  const muzzleY = o.headCY + headRy * 0.52;
  const legW = a.legW;
  const x0 = BODY_CX - o.bodyW / 2;
  const x1 = BODY_CX + o.bodyW / 2;
  const bodyBottom = o.bodyCY + o.bodyH / 2;

  // 正面四条腿按「后腿在外、前腿在内」排布：外侧压暗，内侧提亮。
  // 腿变粗后把 1.8 的缝收到 1.2：四根柱子分开站，正面才不显笨重。
  const hipX: [number, number] = [x0 + 0.5, x1 - 0.5 - legW];
  const shoulderX: [number, number] = [x0 + legW + 1.2, x1 - legW * 2 - 1.2];

  if (!o.sit) {
    for (let side = 0; side < 2; side += 1) {
      const lift = o.legLift[side] ?? 0;
      const farX = hipX[side]!;
      const nearX = shoulderX[side]!;
      // 后腿在外侧、更暗；前腿在内侧、更亮，正面才分得出四条腿
      px.polygon(taper(farX + legW / 2, o.legTop, farX + legW / 2, FEET - lift - a.hoofH, legW, legW * 0.9), S.BodyShade);
      px.rect(farX, FEET - lift - a.hoofH, legW, a.hoofH, S.HoofShade);
      // 打招呼那一侧的前腿离地：不画落地柱，改由躯干之后的举腿分支接手
      if (o.wave?.side === side) continue;
      px.polygon(taper(nearX + legW / 2, o.legTop, nearX + legW / 2, FEET - lift - a.hoofH, legW, legW * 0.9), S.Body);
      px.rect(nearX, FEET - lift - a.hoofH, legW, a.hoofH, S.Hoof);
      px.rect(nearX, FEET - lift - a.hoofH, legW, 1, S.HoofShade);
    }
  } else {
    // 正面坐下 / 躺下：四条腿折在身下，只在贴地处露两截蹄子
    const hoofY = FEET - a.hoofH;
    px.rect(BODY_CX - 8, hoofY, legW + 1.5, a.hoofH, S.Hoof);
    px.rect(BODY_CX + 2, hoofY, legW + 1.5, a.hoofH, S.Hoof);
    px.rect(BODY_CX - 8, hoofY, legW + 1.5, 1, S.HoofShade);
    px.rect(BODY_CX + 2, hoofY, legW + 1.5, 1, S.HoofShade);
  }

  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.roundRect(BODY_CX + dx, o.bodyCY + dy, o.bodyW, o.bodyH, a.bodyR, slot);
  });

  if (spec.pattern === 1) {
    stampBlobs(
      px,
      spec.species,
      o.bodyCY,
      maskOfShape(px, (canvas) => canvas.roundRect(BODY_CX, o.bodyCY, o.bodyW, o.bodyH, a.bodyR, S.Body)),
    );
  }
  if (spec.pattern === 2) {
    // 正面长袜：两条前腿下段换色，比侧面细一分，读的是「四条腿里有一对是白的」
    for (let side = 0; side < shoulderX.length; side += 1) {
      // 举手那一侧的长袜由举腿分支自己画，这里再画一条落地柱会多出一条腿
      if (o.wave?.side === side) continue;
      const nearX = shoulderX[side]!;
      px.rect(nearX, bodyBottom - 1, legW, FEET - bodyBottom + 1, S.Pattern);
      px.rect(nearX, FEET - a.hoofH, legW, a.hoofH, S.Hoof);
      px.rect(nearX, FEET - a.hoofH, legW, 1, S.HoofShade);
    }
  }

  // 肩线：一条轻薄的暗带而不是横杠。头坐上去以后只在两侧露出肩膀，
  // 这是正视下「头 / 肩」唯一读得出来的分界——侧视靠前后错位，正视只能靠它。
  // 宽度收到 bodyW-4、厚度 1.6：旧的 2.4 厚横杠正是「方块肩」的来源。
  const bodyTop = o.bodyCY - o.bodyH / 2;
  px.roundRect(BODY_CX, bodyTop + 1.4, o.bodyW - 4, 1.6, 0.8, S.BodyShade);

  // 打招呼：举起的近侧前腿画在躯干之后，才压得住躯干轮廓；
  // 坐姿 / 躺姿的躯干更低，肩点跟着上移一格，蹄子才不会撞到贴地那一排
  if (o.wave) {
    const { reach, lift, side } = o.wave;
    drawRaisedLeg(px, {
      x: shoulderX[side]! + legW / 2,
      top: o.sit ? bodyBottom - 2 : bodyBottom - 3,
      w: legW,
      hoofH: a.hoofH,
      sock: spec.pattern === 2,
      reach,
      lift,
    });
  }

  // 耳朵先画，再让头顶盖住根部，才像长在头上而不是贴上去
  if (spec.species === 'cow') {
    for (const side of [-1, 1]) {
      const rootX = BODY_CX + side * headRx * 0.82;
      const rootY = o.headCY - 2.8;
      const tipX = BODY_CX + side * (headRx * 0.82 + a.earW);
      const tipY = rootY + 1.6;
      px.polygon(taper(rootX, rootY, tipX, tipY, a.earH, a.earH * 0.72), S.Body);
      px.ellipse(tipX, tipY, a.earH * 0.5, a.earH * 0.46, S.Body);
    }
  } else {
    for (const side of [-1, 1]) {
      const rootX = BODY_CX + side * a.headR * 0.58;
      const rootY = o.headCY - headRy * 0.66;
      const tipX = BODY_CX + side * a.headR * 0.76;
      const tipY = rootY - a.earH;
      px.polygon(taper(rootX, rootY, tipX, tipY, a.earW, a.earW * 0.72), S.Body);
      px.ellipse(tipX, tipY, a.earW * 0.52, a.earW * 0.5, S.Body);
    }
  }

  drawHornOrMane(px, spec.species, spec.extra, o.back ? 'back' : 'front', BODY_CX, o.headCY, a);

  const headMask = maskOfShape(px, (canvas) => canvas.ellipse(BODY_CX, o.headCY, headRx, headRy, S.Body));
  solid(px, S.Body, S.BodyShade, (slot, dx, dy) => {
    px.ellipse(BODY_CX + dx, o.headCY + dy, headRx, headRy, slot);
  });
  px.ellipseMasked(BODY_CX - 1.4, o.headCY - 1.6, headRx, headRy, S.BodyLight, headMask);

  if (o.back) {
    // 背面：后脑 + 从身体中线垂下来的尾巴；长度同样受脚底线约束（坐/躺时躯干更低）
    const tailTop = o.bodyCY + o.bodyH / 2 - 3;
    const tailEnd = FEET - 2;
    const mid = tailTop + Math.max(4, (tailEnd - tailTop) * 0.55);
    if (spec.species === 'cow') {
      px.polygon(taper(BODY_CX, tailTop, BODY_CX - 0.5, mid, 3.4, 2.8), S.Tail);
      px.roundRect(BODY_CX - 2, mid, 4.5, Math.max(2.5, tailEnd - mid - 1), 1.5, S.TailShade);
    } else {
      px.polygon(taper(BODY_CX, tailTop, BODY_CX - 1, mid, 4, 3.2), S.Tail);
      px.polygon(taper(BODY_CX - 1, mid - 1, BODY_CX - 2, tailEnd, 3.2, 1.6), S.TailShade);
    }
  } else {
    const longSnout = spec.snout === 1;
    const muzzleRx = a.muzzleRx * (longSnout ? 0.8 : 0.92);
    const muzzleRy = a.muzzleRy * (longSnout ? 1.18 : 1);
    solid(px, S.Snout, S.SnoutShade, (slot, dx, dy) => {
      px.ellipse(BODY_CX + dx, muzzleY + dy, muzzleRx, muzzleRy, slot);
    });
    // 鼻孔从 1px 点改成 1×1.2 的细缝：吻缩小后一个像素点会被当成污点
    px.rect(BODY_CX - muzzleRx + 1.2, muzzleY - 0.8, 1, 1.2, S.SnoutShade);
    px.rect(BODY_CX + muzzleRx - 2.2, muzzleY - 0.8, 1, 1.2, S.SnoutShade);
    px.rect(BODY_CX - 1.2, muzzleY + muzzleRy - 1, 2.4, 1, S.SnoutShade);
    if (o.openMouth) px.rect(BODY_CX - 1.6, muzzleY + muzzleRy - 2, 3.2, 1.6, S.SnoutShade);

    const eye = eyeMetricsOf(a);
    const eyeGap = headRx * 0.52;
    drawEye(px, BODY_CX - eyeGap - eye.w / 2, o.headCY + eye.dy, eye.w, eye.h, o.blink);
    drawEye(px, BODY_CX + eyeGap - eye.w / 2, o.headCY + eye.dy, eye.w, eye.h, o.blink);
  }

  px.outline();
  px.retagOutline(S.Outline, 'tail', S.TailOutline);
  px.closeDiagonalGaps();
}

/** 姿态 → 正视 / 背视构图参数，理由同 sideOptions */
function facingOptions(spec: FrameSpec, a: Anatomy, pose: PoseName, phase: number): FacingOptions {
  const back = spec.direction === 3;
  const standBodyCY = FEET - a.legH - a.bodyH / 2;
  const standHeadCY = standBodyCY - a.bodyH / 2 - 3.5;
  const bob = pose === 'walk' ? (phase % 2 === 0 ? 0 : 1) : 0;
  // 与侧视同一条上限：腾空 -5，再高牛角会顶到帧顶
  const hop = pose === 'jump' ? ([3, -5, 0][phase] ?? 0) : 0;
  const breathe = breatheOffset(spec, pose, phase);
  // 正视 / 背视把坐与躺画成同一套「腿折在身下」，叫唤与挥手沿用各自的基座
  const sit =
    pose === 'sit' ||
    pose === 'lie' ||
    pose === 'sitEmote' ||
    pose === 'lieEmote' ||
    pose === 'sitWave' ||
    pose === 'lieWave';
  const walkLift = pose === 'walk' ? phase % 2 : 0;
  const jumpLift = pose === 'jump' && phase === 1 ? 5 : 0;
  const openMouth = (pose === 'emote' || pose === 'sitEmote' || pose === 'lieEmote') && phase === 1;
  // 正视 / 背视看不到哪条腿是「近侧」，统一举屏幕左侧那条前腿，四向看起来是同一个动作
  const waving = pose === 'wave' || pose === 'sitWave' || pose === 'lieWave';
  const faceWave = waveAt(phase, FACING_WAVE_REACH, FACING_WAVE_LIFT);
  /**
   * 背面看不见嘴：不补这一下，朝上叫唤会完全没有反馈。
   * 只抬 1px 的头（耳、角跟着走），身体不动，读作「仰头叫一声」而不是蹦跳。
   */
  const backBarkLift = back && openMouth ? -1 : 0;

  return {
    bodyCY: sit ? standBodyCY + 9 + breathe : standBodyCY + bob + hop + breathe,
    // 正视的躯干比侧视宽 14%：四足动物从正面看是「肩宽大于体深」，
    // 这条差值就是头两侧能露出来的那 2–3px 肩线
    bodyW: a.bodyW * 1.14,
    bodyH: sit ? a.bodyH * 0.92 : a.bodyH,
    headCY: sit ? standHeadCY + 11 + breathe + backBarkLift : standHeadCY + bob + hop + breathe + backBarkLift,
    legTop: standBodyCY + a.bodyH / 2 - 3,
    back,
    sit,
    legLift: [walkLift + jumpLift, 1 - walkLift + jumpLift],
    openMouth,
    wave: waving ? { ...faceWave, side: 0 } : null,
    blink: spec.column === 2,
  };
}

function drawFacing(spec: FrameSpec, a: Anatomy, pose: PoseName, phase: number): Px {
  const px = new Px();
  drawFacingBody(px, spec, a, facingOptions(spec, a, pose, phase));
  return px;
}

/** 锚点坐标系：manifest 的 cosmeticAnchors 相对脚底原点，与客户端 sprite.position 同域 */
const ORIGIN_X = ORIGIN.x;
const ORIGIN_Y = ORIGIN.y;

/**
 * 配件挂点：由同一份解剖学 + 姿态参数推出，绘制与锚点不会再各写一套。
 * 坐标为帧内像素中心坐标，转成相对脚底原点后返回（朝左的帧整体镜像，x 取反）。
 */
export interface FrameLandmarks {
  /** 头心 */
  head: [number, number];
  /** 头顶（帽子基准） */
  headTop: [number, number];
  /** 眼线中心；朝上时看不见眼睛，为 null */
  eye: [number, number] | null;
  /** 吻部中心 */
  muzzle: [number, number];
  /** 颈线（下巴与胸口交界，围巾 / 项圈基准） */
  neck: [number, number];
  /** 躯干中心（诊断与旧背包锚点参考；新配件不再挂这里） */
  torso: [number, number];
}

function localize(point: [number, number], mirror: boolean): [number, number] {
  const x = point[0] - ORIGIN_X;
  return [mirror ? -x : x, point[1] - ORIGIN_Y];
}

function sideLandmarks(a: Anatomy, o: SideOptions): Omit<FrameLandmarks, 'eye'> & { eye: [number, number] } {
  const headRy = a.headR * 0.94;
  const eye = eyeMetricsOf(a);
  return {
    head: [o.headX, o.headCY],
    headTop: [o.headX, o.headCY - headRy],
    // 眼线中心必须与 drawEye 的落笔算同一个中心，否则换眼型时眼镜会漂（ADR-0007）
    eye: [o.headX + 0.5 + eye.w / 2, o.headCY + eye.dy + eye.h / 2],
    muzzle: [o.headX + a.headR - 1.5, o.headCY + a.headR * 0.52],
    neck: [o.headX - 3, o.headCY + headRy * 0.9],
    torso: [BODY_CX, o.bodyCY],
  };
}

function facingLandmarks(a: Anatomy, o: FacingOptions): FrameLandmarks {
  const headRy = a.headR * 0.94;
  const eye = eyeMetricsOf(a);
  return {
    head: [BODY_CX, o.headCY],
    headTop: [BODY_CX, o.headCY - headRy],
    eye: o.back ? null : [BODY_CX, o.headCY + eye.dy + eye.h / 2],
    muzzle: [BODY_CX, o.headCY + headRy * 0.52],
    neck: [BODY_CX, o.headCY + headRy + 1],
    torso: [BODY_CX, o.bodyCY],
  };
}

export function landmarksOf(species: SpeciesName, direction: number, column: number): FrameLandmarks {
  const a = ANATOMY[species];
  const pose = poseOfColumn(column);
  const phase = phaseOfColumn(column);
  const spec: FrameSpec = { species, direction: direction as 0 | 1 | 2 | 3, column, tail: 0, pattern: 0, extra: 0, snout: 0 };

  if (direction === 1 || direction === 2) {
    const raw = sideLandmarks(a, sideOptions(spec, a, pose, phase));
    const mirror = direction === 1;
    return {
      head: localize(raw.head, mirror),
      headTop: localize(raw.headTop, mirror),
      eye: localize(raw.eye, mirror),
      muzzle: localize(raw.muzzle, mirror),
      neck: localize(raw.neck, mirror),
      torso: localize(raw.torso, mirror),
    };
  }

  const raw = facingLandmarks(a, facingOptions(spec, a, pose, phase));
  return {
    head: localize(raw.head, false),
    headTop: localize(raw.headTop, false),
    eye: raw.eye ? localize(raw.eye, false) : null,
    muzzle: localize(raw.muzzle, false),
    neck: localize(raw.neck, false),
    torso: localize(raw.torso, false),
  };
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
