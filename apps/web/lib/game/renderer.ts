import {
  Application,
  Container,
  Graphics,
  RendererType,
  Sprite,
  Text,
  type Texture,
} from 'pixi.js';
import {
  BOSS,
  BOSS_MAX_HP,
  ENTITY_ROLE_BOSS_STEAMROLLER,
  ENTITY_ROLE_GUARD,
  ENTITY_ROLE_NURSE,
  ENTITY_ROLE_PET,
  ENTITY_ROLE_ROBO_DOG,
  ISLAND,
  PATIENT_STATE,
  WORLD_LAYOUT,
  isNightShift,
  isWadingAt,
  seatById,
  workDeskIndexOfSeat,
  type AmbulancePacket,
  type CharacterAppearance,
  type FishingStatePacket,
  type GigStatePacket,
  type P2PDuelStatePacket,
  type P2PShowdownPacket,
  type PatientStatusPacket,
  type ApartmentPeekEntry,
  type TurfStatePacket,
  type VehicleStatePacket,
  type VillaStatePacket,
  type BossShockPacket,
} from '@niuma/shared-types';
import { ClinicView } from './clinic-view';
import { GtaWorldView } from './gta-world-view';
import { WorldEventFx } from './world-event-fx';
import { loadAtlas, type Atlas } from './atlas';
import { BossView } from './boss';
import { BulletinView } from './bulletin';
import { DanmakuField, type DanmakuMessage } from './danmaku';
import { DEFAULT_DANMAKU_PREFS, type DanmakuPrefs } from './danmaku-prefs';
import { LanternView } from './lighting/lanterns';
import { FestivalArt } from './festival-art';
import { readFestivalEnabled } from './festival-decor';
import { ParkView } from './park';
import { PlaqueView } from './plaques';
import { VillasView } from './villas-view';
import { ApartmentView } from './apartment-view';
import { WindowPeekView } from './window-peek';
import { RitualFx } from './ritual-fx';
import { ShrineView } from './shrine';
import { TeaStationView } from './tea-station';
import { isOutdoorGround } from './ground';
import { InteriorArt } from './interior-art';
import { LightmapLayer } from './lighting/lightmap';
import { propLights } from './lighting/scene-lights';
import { readSeason, type SeasonState } from './season';
import { serverNow, serverTzOffsetMin } from './server-clock';
import { SnowField } from './snow-fx';
import { WinterArt } from './winter-art';
import { VenueArt, VenueFx } from './venue-art';
import { pickCharacter, type PickCandidate } from './badge';
import { cameraFocus } from './camera';
import { bakeCritterArt, type CritterArt } from './critter-art';
import { CritterField } from './critters';
import { FishField } from './fish';
import { GroundFx, SHADOW_NORMAL } from './fx';
import {
  bubbleTopY,
  headTopYOf,
  nameBottomY,
  nameplateText,
  statusBottomY,
  statusLabelText,
  statusStackHeight,
  NAME_STROKE_WIDTH,
} from './nameplate';
import { P2PFx } from './p2p-showdown';
import { PonyRenderer } from './pony';
import { BuffFx } from './buff-fx';
import type { PonyMotion } from './pony-motion';
import {
  BEACON_BLUE,
  BEACON_HEIGHT,
  BEACON_OFF_ALPHA,
  BEACON_RED,
  BEACON_WIDTH,
  beaconPhase,
} from './police-beacon';
import { PropsView } from './props';
import {
  capDpr,
  normalizeDpr,
  pixelMetrics,
  resolveDprCap,
  sameMetrics,
  snapCss,
  snapTexel,
  worldCssPerTexel,
  type PixelMetrics,
} from './pixel-scale';
import type { QualityTier } from './runtime/quality-tiers';
import {
  resolveGpuPreference,
  type GpuPreference,
} from './runtime/render-mode';
import { SortLayer } from './sort-layer';
import { SPRITE_LAYOUT } from './sprite-layout.generated';
import { TerrainView } from './terrain';
import { VenuePlay } from './venue-play';
import { venueRoomOfSeat } from './venue-spots';
import { WaterFx, makeWadingTexture } from './water-fx';
import { WelcomeView } from './welcome';

/** 黄金安全帽的目录键：脚底金光的唯一触发条件（ADR-0088） */
const GOLDEN_HELMET_ID = 'golden_helmet';

/** 涉水扩散环的节流间隔（ms）：与脚步小节拍分开，避免每一步都叠一圈半透明 */
const WADING_WAKE_MS = 380;

/**
 * 老板受击飘字的落脚高度：从脚底往上抬 84，`RitualFx` 再 -46 摆位，
 * 数字正好落在胸腹；避开头顶的血条（-266）与纸板名牌。
 */
const BOSS_DAMAGE_LIFT_PX = 84;
/** 老板 256 纹素高，默认 7 纹素的金色飘字在他身上只有零头，单独放大一档 */
const BOSS_DAMAGE_FONT_SIZE = 12;

/**
 * 世界倍率：1 纹素画 1.5 个 CSS 像素，角色站立 48 纹素 ≈ 72 CSS 像素（DPR 2）。
 *
 * 缩到 1.5 的前提是「每纹素占整数设备像素」（ADR-0005），而 1.5 × DPR 并不总是整数，
 * 所以各屏的实际高度散落在 64–96 之间，只有 DPR 2 正好是 72：
 *   DPR 1 → 2.0（96px）、1.25 → 1.6（76.8）、1.5 → 1.333（64）、2 → 1.5（72）、3 → 1.667（80）
 * 宁可接受这档差异，也不让纹素落在半像素上——半像素会让 1px 描边在相邻纹素之间轮流糊开。
 */
const DEFAULT_CSS_PER_TEXEL = 1.5;
/**
 * 大厅的纹素下限。DPR 1 的屏幕上 `round(1.5 × 1) = 2`，沿用默认下限 3 会被夹回 3，
 * 等于在 100% 缩放的桌面上「什么都没改」。预览台不走这个值。
 */
const MIN_DEVICE_PX_PER_TEXEL = 2;
/** `?zoom=` 回退开关的合法区间：`?zoom=3` 即退回改动前的倍率 */
const CSS_PER_TEXEL_MIN = 1;
const CSS_PER_TEXEL_MAX = 4;

/**
 * 灰度开关（与 `?flat=1` / `?light=0` 同一写法）：线上观感回归时一键退回旧倍率，
 * 不用回滚整次发布。非法值一律回落到默认倍率。
 *
 * `overridden` 为 true 表示用户显式给了倍率：此时竖屏自适应不再介入，
 * 保证 `?zoom=3` 在任何朝向下都是同一档倍率。
 */
function readCssPerTexel(search: string): { value: number; overridden: boolean } {
  const raw = new URLSearchParams(search).get('zoom');
  if (raw === null) return { value: DEFAULT_CSS_PER_TEXEL, overridden: false };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { value: DEFAULT_CSS_PER_TEXEL, overridden: false };
  return {
    value: Math.min(CSS_PER_TEXEL_MAX, Math.max(CSS_PER_TEXEL_MIN, value)),
    overridden: true,
  };
}

/**
 * 裁剪只关心帧尺寸；「昵称与气泡离头顶多远」交给 nameplate.ts。
 * 那个高度来自 manifest 的头顶锚点，不能再由帧底余量（frame.h - origin.y）反推：
 * 帧底余量是脚底到帧底的 5 纹素，按它摆会把名字画在膝盖上。
 */
const FRAME_H = SPRITE_LAYOUT.frame.h;
/** 裁剪余量：半帧宽 + 一帧高（树冠另算，由地形自己按纹理高度给） */
const CULL_PAD_X = SPRITE_LAYOUT.frame.w;
const CULL_PAD_Y = FRAME_H;

/**
 * 低档名牌预算的进出阈值（到玩家的平方距离，省掉每帧开方）。
 *
 * 两段阈值是滞回：已经显示的昵称要到 420 纹素外才收起，收起后回到 260 以内才重新显示。
 * 玩家在阈值附近来回走时，名字不会一闪一闪。
 */
const NAMEPLATE_KEEP_R2 = 260 * 260;
const NAMEPLATE_DROP_R2 = 420 * 420;

const NAME_STYLE = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 9,
  fill: 0xf4ede1,
  // 描边是暖深褐而不是炭黑：暖底画面上纯黑描边会立刻把观感拉回马赛克
  stroke: { color: 0x2b2118, width: NAME_STROKE_WIDTH },
  letterSpacing: 0.4,
};

/**
 * 状态行样式：比昵称小一号、用唯一的薄荷强调色，视觉上让位给名字。
 *
 * 字体栈末尾必须挂系统彩色 emoji：`JetBrains Mono` 与 `Noto Sans SC` 都没有 emoji 字形，
 * 缺了 fallback，🍵 与 🐟 会渲染成豆腐块。emoji 由系统字体自己上色，描边只作用于文字。
 */
const STATUS_STYLE = {
  fontFamily: 'JetBrains Mono, Noto Sans SC, Segoe UI Emoji, Apple Color Emoji, sans-serif',
  fontSize: 7,
  fill: 0x4fe3c1,
  stroke: { color: 0x2b2118, width: 3 },
  letterSpacing: 0.3,
};

class EntityView {
  /** 本体与阴影进 y 排序层，会被树冠正确遮挡 */
  readonly root = new Container();
  /** 昵称与气泡单独一层：立绘可以被树挡住，名字不行 */
  readonly labels = new Container();
  readonly body: PonyRenderer;
  private readonly label: Text;
  /**
   * 状态行：只在真的有状态时才创建。
   * 多数人没设状态，为每个人常备一个空 Text 等于给整屏多挂一层纹理与一次绘制调用。
   */
  private statusText: Text | null = null;
  /** 状态文字高度（0 = 没有状态）：气泡据此整体上移 */
  private statusHeight = 0;
  /** 当前文字位图分辨率：DPR 变化时状态行要跟着重建，否则小字发虚 */
  private textResolution: number;
  private readonly bubbleText: Text;
  private readonly bubbleBg = new Graphics();
  private readonly shadows: Texture[];
  private shadowIndex = SHADOW_NORMAL;
  /** 涉水水线覆盖层：固定在脚底，不跟随 body 的呼吸起伏与跳跃抬升 */
  private readonly wading: Sprite;
  private wadingShown = false;
  /** 上一次判定的吸附坐标：站立不动时不必每帧重查水域多边形 */
  private lastWadingX = Number.NaN;
  private lastWadingY = Number.NaN;
  /** 跳跃弧线的抬升纹素（0 或负值）：本体与昵称同步抬高，阴影留在地面 */
  private jumpLift = 0;
  private prevJumpLift = 0;
  /** 坐在座位上时整体上移的纹素（ADR-0032）：阴影与水线留在地面，昵称同步抬高 */
  private seatLift = 0;
  /** 发泄前倾位移与受击震动反馈（只作用于渲染容器，不碰权威坐标与阴影） */
  private lungeX = 0;
  private lungeY = 0;
  private hitUntil = 0;
  private hitDuration = 170;
  private hitDirX = 0;
  private hitDirY = 0;
  bubbleUntil = 0;
  private lastColumn = -1;
  /** 上一次的可见状态：只在翻转时才改 `renderable` */
  private shown = true;
  /** 是否正在公寓窗口探头：本体与昵称整体不画，只在窗口里留一颗头 */
  private peeked = false;
  /** 低档名牌预算：只影响昵称那一行，状态行与气泡不受影响 */
  private nameplateShown = true;
  /** 昵称文字底边（相对脚底）：换装改变头顶高度后重算 */
  private nameBottom: number;
  /** 头顶（相对脚底，负值）：眩晕星星绕它转，与配件挂点同源 */
  private readonly headTop: number;
  /** 上次气泡高度：换装重排时直接复用，不必重新测量文字 */
  private bubbleHeight = 0;
  
  // 气泡保护和性能优化字段
  private lastBubbleUpdateTime = 0;
  private readonly BUBBLE_UPDATE_THROTTLE = 300; // ms，300ms 内最多 1 个更新
  private readonly MAX_CHAT_LENGTH = 80; // 最大字符数
  private readonly MAX_LINES = 3; // 最大行数
  private readonly FADE_DURATION = 400; // 淡出持续时间 ms

  readonly bubble = new Container();
  /** P2P 头顶演出层：骰子 / 手势 / 血条 / 打赏飘字，跟随 labels 一起跳跃与入座 */
  readonly p2p = new Container();
  /** 是否保安：只有保安才有警灯，也只在 beacons 集合里逐帧更新 */
  readonly isGuard: boolean;
  /** 警灯容器：挂在 labels 上，不被树冠遮挡 */
  private beacon: Container | null = null;
  private beaconRed: Graphics | null = null;
  private beaconBlue: Graphics | null = null;
  /** 工伤保护盾：绿色盾牌 + 白十字，懒创建，只有被治愈过的人才有 */
  private shield: Graphics | null = null;
  /** 通缉星级徽章（1★~5★）：仅在星数变化时重绘，零 GC */
  private wantedBadge: Graphics | null = null;
  private lastWantedStars = 0;
  private lastGhostAlpha = 1;

  /** 切换头顶的绿色十字盾牌（ADR-0084）；星星由 StunStars 单独管理 */
  setShield(visible: boolean): void {
    if (visible) {
      if (!this.shield) {
        const g = new Graphics();
        // 盾牌轮廓：12×13，上圆下尖
        g.poly([-6, -12, 6, -12, 6, -4, 0, 0, -6, -4]).fill(0x1f9d55);
        g.poly([-5, -11, 5, -11, 5, -5, 0, -1, -5, -5]).fill(0x32c470);
        // 白十字
        g.rect(-1, -9, 2, 6).fill(0xf4fff8);
        g.rect(-3, -7, 6, 2).fill(0xf4fff8);
        g.position.set(0, this.nameBottom - this.label.height - 4);
        this.labels.addChild(g);
        this.shield = g;
      }
      this.shield.visible = true;
      return;
    }
    if (this.shield) this.shield.visible = false;
  }

  /** 通缉星徽章：头顶 1~5 颗脉冲像素星 */
  setWantedStars(stars: number): void {
    const clamped = Math.max(0, Math.min(5, Math.floor(stars)));
    if (clamped === this.lastWantedStars) return;
    this.lastWantedStars = clamped;
    if (clamped === 0) {
      if (this.wantedBadge) this.wantedBadge.visible = false;
      return;
    }
    if (!this.wantedBadge) {
      this.wantedBadge = new Graphics();
      this.labels.addChild(this.wantedBadge);
    }
    const g = this.wantedBadge;
    g.clear();
    const totalW = clamped * 8;
    const startX = -Math.round(totalW / 2);
    const py = this.nameBottom - this.label.height - 16;
    g.rect(startX - 2, py - 2, totalW + 4, 9).fill(0x2a3142);
    const fill = clamped >= 4 ? 0xe05252 : 0xf2c879;
    for (let i = 0; i < clamped; i += 1) {
      const sx = startX + i * 8;
      g.rect(sx + 1, py, 5, 5).fill(fill);
      g.rect(sx + 2, py - 1, 3, 7).fill(fill);
    }
    g.visible = true;
  }

  /** 幽灵半透明切换：只在变化时改 alpha */
  setGhostAlpha(alpha: number): void {
    if (Math.abs(alpha - this.lastGhostAlpha) < 0.02) return;
    this.lastGhostAlpha = alpha;
    this.root.alpha = alpha;
  }

  constructor(
    private readonly atlas: Atlas,
    name: string,
    appearance: CharacterAppearance,
    status: string,
    devicePxPerTexel: number,
    shadows: Texture[],
    wadingTexture: Texture,
    private readonly onFootfall: (x: number, y: number, wading: boolean) => void,
    private readonly onJumpLand: (x: number, y: number, wading: boolean) => void,
    role = 0,
  ) {
    this.isGuard = role === ENTITY_ROLE_GUARD || role === ENTITY_ROLE_ROBO_DOG;
    this.textResolution = devicePxPerTexel;
    // 接触阴影先入容器：它永远压在所有角色图层之下。
    // 阴影是 root 的直接子节点，角色本体的起伏只作用在 body.container 上，
    // 所以人抬起来时影子不会跟着飞。
    this.shadows = shadows;
    const shadowSprite = new Sprite(shadows[SHADOW_NORMAL]!);
    shadowSprite.anchor.set(0.5, 0.5);

    // 水线覆盖层锚在脚底，底边略低于脚底 1px，盖住接触阴影的上沿
    this.wading = new Sprite(wadingTexture);
    this.wading.anchor.set(0.5, 1);
    this.wading.position.set(0, 1);
    this.wading.visible = false;

    this.body = new PonyRenderer(atlas, appearance, 1);
    // 昵称底边贴着头顶外侧：头顶高度来自图集锚点，帽檐与犄角再由外观分档让位
    this.headTop = headTopYOf(atlas.manifest, appearance.species);
    this.nameBottom = nameBottomY(this.headTop, appearance);
    // 头顶只放得下 16 显示宽：再长的昵称换省略号，否则会压到邻座的名字与气泡
    this.label = new Text({ text: nameplateText(name), style: NAME_STYLE, resolution: devicePxPerTexel });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, this.nameBottom);

    // 有状态才建第二行：没设置的人与上一版逐帧一致
    const statusLabel = statusLabelText(status);
    if (statusLabel.length > 0) {
      const statusText = new Text({
        text: statusLabel,
        style: STATUS_STYLE,
        resolution: devicePxPerTexel,
      });
      statusText.anchor.set(0.5, 1);
      statusText.position.set(0, statusBottomY(this.nameBottom, this.label.height));
      this.statusText = statusText;
      this.statusHeight = Math.ceil(statusText.height);
    }

    this.bubbleText = new Text({
      text: '',
      resolution: devicePxPerTexel,
      style: {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: 8,
        fill: 0x2b2118,
        wordWrap: true,
        wordWrapWidth: 110,
        align: 'center',
        padding: 3,
      },
    });
    this.bubble.visible = false;
    this.bubble.addChild(this.bubbleBg, this.bubbleText);
    this.shadow = shadowSprite;

    // 保安警灯：灯座 + 红蓝双灯，底边贴在头顶文字上方 3px
    if (this.isGuard) {
      const top = this.statusText
        ? statusBottomY(this.nameBottom, this.label.height) - Math.ceil(this.statusText.height) - 3
        : this.nameBottom - this.label.height - 3;
      const beacon = new Container();
      beacon.position.set(0, top);
      const housing = new Graphics();
      const half = Math.round(BEACON_WIDTH / 2);
      housing.rect(-half, -BEACON_HEIGHT, BEACON_WIDTH, BEACON_HEIGHT).fill(0x1a1f2a);
      housing.rect(-half + 1, -BEACON_HEIGHT + 1, BEACON_WIDTH - 2, BEACON_HEIGHT - 2).fill(0x0d1119);
      const red = new Graphics();
      red.rect(-4, -4, 4, 3).fill(BEACON_RED);
      const blue = new Graphics();
      blue.rect(1, -4, 4, 3).fill(BEACON_BLUE);
      beacon.addChild(housing, red, blue);
      this.beacon = beacon;
      this.beaconRed = red;
      this.beaconBlue = blue;
    }
  }

  private readonly shadow: Sprite;

  async init(): Promise<void> {
    await this.body.build();
    // 水线覆盖层压在 body 之上：腿在水下，上半身仍是干的
    this.root.addChild(this.shadow, this.body.container, this.wading);
    // 状态行先入层：它永远在昵称与气泡之上，层级顺序不影响永不重叠的几何
    if (this.statusText) this.labels.addChild(this.statusText);
    if (this.beacon) this.labels.addChild(this.beacon);
    // 头顶演出不参与点选：点人命中仍只看角色本体
    this.p2p.eventMode = 'none';
    this.labels.addChild(this.label, this.bubble, this.p2p);
  }

  /**
   * P2P 头顶演出的锚点 y：压在状态行 / 昵称之上，内容从锚点向上生长。
   * 外观改名会改 `nameBottom`，所以每次演出都重读，不缓存。
   */
  get p2pTopY(): number {
    const nameTop = this.nameBottom - this.label.height;
    const statusTop = this.statusText ? nameTop - this.statusHeight - 2 : nameTop;
    return statusTop - 4;
  }

  /** 警灯相位：红蓝交替；没有警灯的实体不在 beacons 集合里，不会被调用 */
  updateBeacon(now: number): void {
    if (!this.beaconRed || !this.beaconBlue) return;
    const phase = beaconPhase(now);
    this.beaconRed.alpha = phase === 0 ? 1 : BEACON_OFF_ALPHA;
    this.beaconBlue.alpha = phase === 0 ? BEACON_OFF_ALPHA : 1;
  }

  /** DPR 变化时按新的设备纹素重建文字位图，否则文字会被拉伸到 2 倍而发虚 */
  setTextResolution(devicePxPerTexel: number): void {
    if (this.label.resolution === devicePxPerTexel) return;
    this.textResolution = devicePxPerTexel;
    this.label.resolution = devicePxPerTexel;
    this.bubbleText.resolution = devicePxPerTexel;
    if (this.statusText) this.statusText.resolution = devicePxPerTexel;
  }

  setPosition(x: number, y: number): void {
    this.root.position.set(x, y);
    // 昵称与气泡跟着跳跃 / 入座抬升：不然人会「穿」过自己的名字
    this.labels.position.set(x, y + this.jumpLift - this.seatLift);
  }

  /**
   * 入座抬升（ADR-0032）：只抬身体与昵称，阴影、水线与深度键留在座位锚点。
   * 深度键不动，是为了让「人 > 椅子 > 桌子」的排序在四向都成立。
   */
  setSeatLift(liftTexels: number): void {
    if (this.seatLift === liftTexels) return;
    this.seatLift = liftTexels;
    this.body.setSeatLift(liftTexels);
    this.labels.position.y = this.root.position.y + this.jumpLift - liftTexels;
  }

  /**
   * 屏外时整棵子树停止绘制：本体与昵称一起关掉。
   * 只在状态翻转时碰 Pixi 的标记位，稳态下零开销。
   */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.root.renderable = shown && !this.peeked;
    this.labels.renderable = shown && !this.peeked;
  }

  /**
   * 窗口探头（ADR-0098）：人在窗里，本体与昵称都不该出现在门口台阶上。
   *
   * 与 `setShown` 是两条独立开关（屏外剔除 / 探头隐藏），合成后才是真正的可见性。
   */
  setPeeked(peeked: boolean): void {
    if (peeked === this.peeked) return;
    this.peeked = peeked;
    this.root.renderable = this.shown && !peeked;
    this.labels.renderable = this.shown && !peeked;
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** 昵称当前是否在画：低档预算的滞回据此选阈值 */
  get hasNameplate(): boolean {
    return this.nameplateShown;
  }

  /**
   * 低档名牌预算：只切昵称那一行文本。
   *
   * 与 `setShown` / `setPeeked` 是第三条独立开关（屏外剔除 / 探头隐藏 / 画质预算），
   * 三者互不覆盖：`labels` 容器仍归前两者管，这里只动昵称子节点的 `visible`。
   */
  setNameplate(shown: boolean): void {
    if (shown === this.nameplateShown) return;
    this.nameplateShown = shown;
    this.label.visible = shown;
  }

  /** 头顶的世界坐标 y：眩晕星星与其它「挂头上」的特效都用它 */
  get headTopY(): number {
    return this.root.position.y + this.headTop;
  }

  /** 换列时顺手判定落脚：跨到接触帧才扬尘，站着不动不会一路冒土 */
  setPose(direction: number, column: number, dustFrames: Set<number>): void {
    this.body.setPose(direction, column);
    if (column !== this.lastColumn && dustFrames.has(column)) {
      // 水里不扬尘：由调用方改放涟漪
      this.onFootfall(this.root.position.x, this.root.position.y, this.wadingShown);
    }
    this.lastColumn = column;
  }

  /**
   * 按脚底坐标判定涉水。返回 true 表示「这一帧刚踏进水里」，调用方据此放一次大水花。
   *
   * 坐标没变就复用上次结果：站立角色不做任何几何查询，
   * 200 人同屏时只有移动中的实体才会重新判水。
   */
  setWadingAt(x: number, y: number): boolean {
    if (x === this.lastWadingX && y === this.lastWadingY) return false;
    this.lastWadingX = x;
    this.lastWadingY = y;
    const wading = isWadingAt(x, y);
    if (wading === this.wadingShown) return false;
    this.wadingShown = wading;
    this.wading.visible = wading;
    // 水里不该有贴地硬阴影：压到 0.35，保留一点接触感
    this.shadow.alpha = wading ? 0.35 : 1;
    return wading;
  }

  /** 微动效：整数纹素起伏 + 阴影形态切换（换 texture，不做浮点缩放） */
  applyMotion(motion: PonyMotion): void {
    this.body.setBob(motion.bobTexels);
    if (this.jumpLift === 0) this.setShadow(motion.shadow);
  }

  /** 合十作揖的下俯量（ADR-0061）：与呼吸起伏分开记，两者互不覆盖 */
  applyBow(bowTexels: number): void {
    this.body.setBow(bowTexels);
  }

  /** 发泄头槌等动作的纯表现层前倾位移（整数纹素，受击震动期间由震动叠加） */
  applyNudge(dx: number, dy: number): void {
    if (this.lungeX === dx && this.lungeY === dy) return;
    this.lungeX = dx;
    this.lungeY = dy;
    if (this.hitUntil === 0) this.body.setNudge(dx, dy);
  }

  /** 受击震退 + 瞬时高光染红：纯视觉反馈，不影响权威位置与其它实体 */
  triggerHitReact(fromX: number, fromY: number, now: number, durationMs = 170): void {
    const dx = this.root.position.x - fromX;
    const dy = this.root.position.y - fromY;
    const len = Math.hypot(dx, dy);
    if (len > 0.5) {
      this.hitDirX = dx / len;
      this.hitDirY = dy / len;
    } else {
      this.hitDirX = 0;
      this.hitDirY = 1;
    }
    this.hitDuration = Math.max(80, durationMs);
    this.hitUntil = now + this.hitDuration;
    this.tickReact(now);
  }

  /** 推进受击震动与染红；返回 true 表示仍在持续，false 表示已归位可移出活跃集 */
  tickReact(now: number): boolean {
    if (this.hitUntil === 0) return false;
    const remMs = this.hitUntil - now;
    if (remMs <= 0) {
      this.hitUntil = 0;
      this.body.setHitFlash(false);
      this.body.setNudge(this.lungeX, this.lungeY);
      return false;
    }
    const rem = remMs / this.hitDuration;
    const recoil = rem * 3;
    const shudder = (Math.floor(now / 36) & 1) === 0 ? 1 : -1;
    this.body.setHitFlash(rem > 0.35);
    this.body.setNudge(
      this.lungeX + Math.round(this.hitDirX * recoil) + (rem > 0.45 ? shudder : 0),
      this.lungeY + Math.round(this.hitDirY * recoil),
    );
    return true;
  }

  /**
   * 跳跃弧线：本体与昵称一起抬高，接触阴影留在地面。
   * 抬升量已经是整数纹素，不再覆写呼吸起伏槽位，落地瞬间补一次双侧扬尘/水花（ADR-0013）。
   */
  applyJump(liftTexels: number, shadow: number): void {
    const lift = Math.round(liftTexels);
    if (this.prevJumpLift < 0 && lift === 0) {
      this.onJumpLand(this.root.position.x, this.root.position.y, this.wadingShown);
    }
    this.prevJumpLift = lift;
    if (lift !== this.jumpLift) {
      this.jumpLift = lift;
      this.body.setJumpLift(lift);
      this.labels.position.y = this.root.position.y + lift - this.seatLift;
    }
    if (lift < 0) this.setShadow(shadow);
  }

  /** 阴影换纹理而不是缩放：三档形态预烘焙，来回切不会出现亚像素毛边 */
  private setShadow(index: number): void {
    if (index === this.shadowIndex) return;
    this.shadowIndex = index;
    this.shadow.texture = this.shadows[index] ?? this.shadows[SHADOW_NORMAL]!;
  }

  /** 换装会改变头顶高度（帽子 / 发型 / 角）：昵称、状态与气泡立即重新让位，不用重新入场 */
  setAppearance(appearance: CharacterAppearance): void {
    this.body.setAppearance(appearance);
    const nameBottom = nameBottomY(headTopYOf(this.atlas.manifest, appearance.species), appearance);
    if (nameBottom === this.nameBottom) return;
    this.nameBottom = nameBottom;
    this.label.position.y = nameBottom;
    // 状态行贴在昵称上沿：不跟着重排就会压到新帽檐上
    if (this.statusText) {
      this.statusText.position.y = statusBottomY(nameBottom, this.label.height);
    }
    if (this.bubble.visible) this.layoutBubble(this.bubbleHeight);
  }

  /**
   * 改头顶昵称。名字只影响这一行文本，锚点居中，横向不需要重排；
   * 行高变化时（字体 fallback 可能不同）状态行与气泡要跟着让位。
   */
  setName(name: string): void {
    const text = nameplateText(name);
    if (this.label.text === text) return;
    const previousHeight = Math.ceil(this.label.height);
    this.label.text = text;
    const height = Math.ceil(this.label.height);
    if (height === previousHeight) return;
    if (this.statusText) this.statusText.position.y = statusBottomY(this.nameBottom, height);
    if (this.bubble.visible) this.layoutBubble(this.bubbleHeight);
  }

  /**
   * 设置常驻状态。空串即清除：隐藏那一行并让气泡落回昵称上沿。
   * 只有行高真的变了才重排气泡——改字但高度不变时不必动虚拟机的布局。
   */
  setStatus(status: string): void {
    const text = statusLabelText(status);
    if (text.length === 0) {
      if (!this.statusText) return;
      this.statusText.visible = false;
      this.statusText.text = '';
      if (this.statusHeight === 0) return;
      this.statusHeight = 0;
      if (this.bubble.visible) this.layoutBubble(this.bubbleHeight);
      return;
    }

    let label = this.statusText;
    if (!label) {
      label = new Text({ text, style: STATUS_STYLE, resolution: this.textResolution });
      label.anchor.set(0.5, 1);
      label.position.set(0, statusBottomY(this.nameBottom, this.label.height));
      this.statusText = label;
      // 放在最前面：状态行永远在昵称与气泡之上，层级不影响永不重叠的几何
      this.labels.addChildAt(label, 0);
    } else {
      label.visible = true;
      if (label.text !== text) label.text = text;
    }

    // 字体 fallback 可能改变行高（emoji 与等宽字的行盒不同），按实测更新
    const height = Math.ceil(label.height);
    if (height !== this.statusHeight) {
      this.statusHeight = height;
      if (this.bubble.visible) this.layoutBubble(this.bubbleHeight);
    }
  }

  /** 气泡整体叠在昵称与状态行之外：底边与最后一行的间距固定，不向人物方向回落 */
  private layoutBubble(height: number): void {
    this.bubbleHeight = height;
    const stack = statusStackHeight(this.statusHeight);
    this.bubble.position.set(
      0,
      Math.round(bubbleTopY(this.nameBottom, this.label.height, height, stack)),
    );
  }

  showBubble(text: string, now: number, duration = 6000): void {
    // 节流：相同实体 300ms 内最多更新一次气泡
    if (now - this.lastBubbleUpdateTime < this.BUBBLE_UPDATE_THROTTLE) {
      return;
    }
    this.lastBubbleUpdateTime = now;

    // 限制字符数
    let sanitized = text.length > this.MAX_CHAT_LENGTH 
      ? text.substring(0, this.MAX_CHAT_LENGTH - 1) + '…'
      : text;
    
    // 限制行数
    const lines = sanitized.split('\n');
    if (lines.length > this.MAX_LINES) {
      sanitized = lines.slice(0, this.MAX_LINES).join('\n') + '…';
    }

    this.bubbleText.text = sanitized;
    const textW = Math.ceil(this.bubbleText.width);
    const textH = Math.ceil(this.bubbleText.height);
    const width = textW + 8;
    const height = textH + 4;
    const left = -Math.round(width / 2);
    const right = left + width;

    this.bubbleBg.clear();
    this.bubbleBg.rect(left, 0, width, height).fill(0xf4ede1);
    // 1px 硬边替代圆角 + 抗锯齿，气泡也跟着像素栅格走
    this.bubbleBg.rect(left, 0, width, 1).fill(0xb9a68c);
    this.bubbleBg.rect(left, height - 1, width, 1).fill(0xb9a68c);
    this.bubbleBg.rect(left, 0, 1, height).fill(0xb9a68c);
    this.bubbleBg.rect(right - 1, 0, 1, height).fill(0xb9a68c);

    this.bubbleText.position.set(-Math.round(textW / 2), 2);
    this.layoutBubble(height);
    this.bubble.visible = true;
    this.bubble.alpha = 1; // 重置透明度
    this.bubbleUntil = now + duration;
  }

  tickBubble(now: number): void {
    if (!this.bubble.visible) return;
    
    if (now > this.bubbleUntil) {
      // 平滑淡出（最后 FADE_DURATION ms）
      const fadeStart = this.bubbleUntil - this.FADE_DURATION;
      if (now > fadeStart) {
        const fadeProgress = (now - fadeStart) / this.FADE_DURATION;
        this.bubble.alpha = Math.max(0, 1 - fadeProgress); // 从 1 淡到 0
      }
      // 淡出完成后隐藏
      if (now > this.bubbleUntil) {
        this.bubble.visible = false;
        this.bubble.alpha = 1; // 重置 alpha 以备下次显示
      }
    }
  }

  destroy(): void {
    this.body.destroy();
    this.root.destroy({ children: true });
    this.labels.destroy({ children: true });
  }
}

/**
 * 渲染器初始化输入。
 *
 * 画布由宿主准备好：主线程侧新建 `<canvas>` 并挂到 DOM，Worker 侧是
 * `transferControlToOffscreen()` 移交进来的 `OffscreenCanvas`。渲染器本身
 * 既不创建也不挂载画布——那是线程宿主的事。
 */
export interface RendererInit {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  /** 平台查询串：`?zoom` / `?flat` / `?light` / `?bands` / `?season` / `?snow` 都从这里解析 */
  search: string;
  /** 字体就绪后再烘文字纹理：主线程等 `document.fonts`，Worker 等自己注册的 FontFace */
  fontsReady(): Promise<void>;
  /** 宿主注入的后端：缺省按查询串解析，最终落到 `webgl`（ADR-0071） */
  gpu?: GpuPreference;
  /** 弹幕偏好：宿主从 localStorage 读出后注入，渲染线程自己碰不到存储 */
  danmaku?: DanmakuPrefs;
}

/** 星星纹理的生成器：只用到 `generateTexture`，不必把整个 Application 传进来 */
type StarTextureFactory = Application['renderer'];

/** 同屏最多几组眩晕星星：一份 = 2 颗，够覆盖一个屏幕里同时倒地的所有人 */
const STUN_SLOTS = 6;
/** 绕头顶一圈的角速度基准（ms）：快一点才读得出「转晕了」 */
const STUN_SPIN_MS = 260;

/**
 * 眩晕星星：被创飞的人头顶绕两颗小星。
 *
 * 做成一个全局池而不是挂在 `EntityView` 上：200 人同屏时给每人常备两颗 Sprite
 * 就是 400 个从不显示的对象。这里只有 6 个槽位、12 个 Sprite，
 * 用完即回收，与脚下尘土池同一个思路。
 */
class StunStars {
  readonly container = new Container();
  private readonly texture: Texture;
  private readonly sprites: Sprite[] = [];
  /** 每个槽位绑定的实体 netId，0 表示空闲 */
  private readonly ids = new Int32Array(STUN_SLOTS);
  /** 每个槽位的消失时刻（performance.now 口径） */
  private readonly until = new Float64Array(STUN_SLOTS);
  private cursor = 0;

  constructor(renderer: StarTextureFactory) {
    // 3×3 的十字形硬边星：像素风里再小就只剩一个点，再大就糊成一团
    const g = new Graphics();
    g.rect(1, 0, 1, 3).fill(0xffffff);
    g.rect(0, 1, 3, 1).fill(0xffffff);
    this.texture = renderer.generateTexture({
      target: g,
      resolution: 1,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    g.destroy();

    for (let i = 0; i < STUN_SLOTS * 2; i += 1) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5, 0.5);
      sprite.tint = 0xffe08a;
      sprite.visible = false;
      this.container.addChild(sprite);
      this.sprites.push(sprite);
    }
  }

  /** 给某个实体点亮星星；重复命中只续期，不会占掉第二个槽位 */
  set(id: number, untilMs: number): void {
    for (let slot = 0; slot < STUN_SLOTS; slot += 1) {
      if (this.ids[slot] === id) {
        this.until[slot] = untilMs;
        return;
      }
    }
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % STUN_SLOTS;
    this.ids[slot] = id;
    this.until[slot] = untilMs;
  }

  /** 每帧更新：绕头顶走一条扁椭圆，两个相位差 π，坐标吸附到整纹素 */
  update(now: number, views: ReadonlyMap<number, EntityView>): void {
    const angle = now / STUN_SPIN_MS;
    for (let slot = 0; slot < STUN_SLOTS; slot += 1) {
      const id = this.ids[slot]!;
      const first = this.sprites[slot * 2]!;
      const second = this.sprites[slot * 2 + 1]!;
      if (id === 0) continue;
      const view = views.get(id);
      if (!view || now >= this.until[slot]! || !view.isShown) {
        first.visible = false;
        second.visible = false;
        this.ids[slot] = 0;
        continue;
      }
      const cx = view.root.position.x;
      const cy = view.headTopY - 4;
      // 只在整数纹素上落点：亚像素位置会让 3×3 的星糊成一团灰
      first.position.set(cx + Math.round(Math.cos(angle) * 8), cy + Math.round(Math.sin(angle * 2) * 2));
      second.position.set(
        cx + Math.round(Math.cos(angle + Math.PI) * 8),
        cy + Math.round(Math.sin(angle * 2 + Math.PI) * 2),
      );
      first.visible = true;
      second.visible = true;
    }
  }

  /** 治愈 / 断开：只收指定实体头顶的星，不影响同屏其他伤员 */
  clearEntity(id: number): void {
    for (let slot = 0; slot < STUN_SLOTS; slot += 1) {
      if (this.ids[slot] !== id) continue;
      this.ids[slot] = 0;
      this.sprites[slot * 2]!.visible = false;
      this.sprites[slot * 2 + 1]!.visible = false;
    }
  }

  /** 星点全部收掉：实体离场或整层销毁时调用 */
  clear(): void {
    for (let slot = 0; slot < STUN_SLOTS; slot += 1) {
      this.ids[slot] = 0;
      this.sprites[slot * 2]!.visible = false;
      this.sprites[slot * 2 + 1]!.visible = false;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.texture.destroy(true);
  }
}

export class GameRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  /**
   * 树、围栏、角色统一按脚底 y 排序。
   * 分桶而不是一个大容器：角色一走动就会改 zIndex，单容器意味着每帧重排整张地图。
   */
  private sortLayer!: SortLayer;
  private readonly labels = new Container();
  private readonly views = new Map<number, EntityView>();
  /** 只有保安加入：逐帧更新警灯，避免遍历全部实体 */
  private readonly beacons = new Set<EntityView>();
  /** 只有处于受击震动中的实体加入：平时为空，零帧开销 */
  private readonly reactingViews = new Set<EntityView>();
  private atlas!: Atlas;
  private terrain?: TerrainView;
  private props?: PropsView;
  /** 北门迎宾地标：横幅与指路牌，构造期烘焙一次（ADR-0036） */
  private welcome?: WelcomeView;
  /** 放假告示板的动态文本：红色横幅与常驻跑马灯（ADR-0059） */
  private bulletin?: BulletinView;
  /** 迎宾拱门与四角院落门柱上的铁艺挂灯（ADR-0096） */
  private lanterns?: LanternView;
  /** 石砌祈福龛：石座、拱形龛、白蜡烛与三缕白雾（ADR-0096） */
  private shrine?: ShrineView;
  /** 木吧台饮品站：保温壶、白瓷杯与蒸汽（ADR-0096） */
  private tea?: TeaStationView;
  /** 护士急救站：站台、病床、停车位与两辆救护车（ADR-0084） */
  private clinic?: ClinicView;
  /** 按实体记下最后一次伤员状态：视图进入 AOI 时用它补画星星 / 盾牌 */
  private readonly patientStates = new Map<number, PatientStatusPacket['state']>();
  /** 发泄区胖老板：地面垫子、200×256 本体、血条与倒地纸板（ADR-0070） */
  private boss?: BossView;
  /** P2P 头顶演出：骰子 / 猜拳手势 / 切磋血条 / 打赏飘字 */
  private readonly p2pFx = new P2PFx();
  /** 场所门牌：各入口一块小门牌（ADR-0091 / ADR-0096） */
  private plaques?: PlaqueView;
  /** 园区 8 处分阶房产：建筑、牌匾与收益道具 */
  private villas?: VillasView;
  /** GTA 全岛新增地标 / 载具 / 涂鸦墙 / 钓鱼台 / 零工信标层 */
  private gtaWorld?: GtaWorldView;
  /** 牛马公寓：只有外立面，室内与家具随 ADR-0098 下线 */
  private apartment?: ApartmentView;
  /** 公寓窗口探头：占用窗口里的头与亮灯，画在排序层之上 */
  private windowPeek?: WindowPeekView;
  /** 最近一次窗口占用快照：实体进场时按它补画（外观来自实体同步） */
  private peekEntries: ReadonlyArray<ApartmentPeekEntry> = [];
  /** 游乐园：入口门头、滑梯、秋千、跷跷板、旋转木马与灯串 */
  private park?: ParkView;
  /** 场所第二层：地面氛围、檐下小件与各场所焦点光（`?venue=0` 整层不构造） */
  private venueArt?: VenueArt;
  /** 场所微动效：落叶、水光与霓虹呼吸，纯函数推进 */
  private venueFx?: VenueFx;
  /** 上香 / 续杯的一次性反馈：金色飘字与当日首香光晕（ADR-0061） */
  private ritual?: RitualFx;
  /** 淡金光晕跟随的实体：0 表示当前没有光晕 */
  private auraEid = 0;
  /** 头顶眩晕星星：被发泄命中的角色脚下不倒，头上转圈（ADR-0051） */
  private stunStars?: StunStars;
  /** 持续型 Buff 表现：脚底风 / 护盾环 / 绿色贴纸（ADR-0085） */
  private buffFx?: BuffFx;
  /** 世界事件地面层：红包雨与画饼冲击波（ADR-0088） */
  private readonly worldEventFx = new WorldEventFx();
  /**
   * 脚底金光（ADR-0088）：黄金安全帽的附带特效。
   *
   * 外观编码是 32 字节定长，没有 aura 槽位；把金光绑在头饰上是唯一不改协议的方案，
   * 好处是远端玩家也看得到——否则只有本人能看见自己的光。
   */
  private readonly goldAura = new Graphics();
  private readonly goldHelmets = new Set<number>();
  /** 园区小动物与蝴蝶：纯客户端氛围，`?critters=0` 时整层不构造（ADR-0042） */
  private critters?: CritterField;
  /** 河道小鱼：与 critters 共用图集，`?fish=0` 时只关鱼（ADR-0045） */
  private fish?: FishField;
  /** 小动物 / 鱼的共享图集：由 renderer 持有并统一销毁 */
  private critterArt?: CritterArt;
  /** 相机焦点：小动物要按「玩家在哪」判定受惊，取同一帧 updateCamera 的结果 */
  private focusX = 0;
  private focusY = 0;
  /** 低清 Lightmap 光影层；`?light=0` 时整层不建 */
  private lightmap?: LightmapLayer;
  /** Lightmap 分辨率分母：默认 4，`?lm=2` 切 1/2 视口 */
  private lightmapDivisor = 4;
  /** 冬季雪景（ADR-0046）：非冬季时三个字段都不构造，零开销 */
  private snow?: SnowField;
  private winterArt?: WinterArt;
  /** 节日装饰（ADR-0063）：`?festival=0` 时整层不构造，构造后只切纹理与 tint */
  private festival?: FestivalArt;
  /** 屏幕空间弹幕（ADR-0056）：挂在 stage 最顶层，不进 world、不随相机 */
  private danmaku?: DanmakuField;
  /** 弹幕偏好：由宿主注入，`?danmaku=0` 可临时关闭 */
  private danmakuPrefs: DanmakuPrefs = { ...DEFAULT_DANMAKU_PREFS };
  /** 低帧自适应画质档：只作用于非关键观感层，默认高档（与改造前逐帧一致） */
  private qualityTier: QualityTier = 'high';
  /** 季节判定结果：只读一次，其余图层只消费 `winter` 布尔量 */
  private season: SeasonState = { winter: false, snow: false, source: 'date' };
  /** 室内陈设补完层：与季节无关，改动只落在渲染层 */
  private interior?: InteriorArt;
  /** 室内状态联动与微动效（`?interior=0` 关闭）：隔间门、吊灯断闪、宿舍暖光 */
  private interiorFx = true;
  /**
   * 弱交互场所演出层（会议室投屏 / 影厅大屏 / 影院压暗 / 音箱音符 / 打卡闪光）。
   * `?venue=0` 整层不构造；`?motion=0` 时停在第一帧。
   */
  private venuePlay?: VenuePlay;
  /** 已占用的座位镜像：只用于「变化沿」计数，避免重复广播把人数越加越多 */
  private readonly occupiedSeats = new Set<number>();
  private meetingSeated = 0;
  private theaterSeated = 0;
  /** 左右脚交替：同一条触地通路里按次数翻转，不用随机数 */
  private footprintFoot = false;
  private shadowTextures: Texture[] = [];
  private fx?: GroundFx;
  /** 涉水涟漪：与尘土分开，生命周期与图层位置都不同 */
  private waterFx?: WaterFx;
  /** 水线覆盖纹理：所有角色共用一张，不按人复制 */
  private wadingTexture?: Texture;
  /** 上一次涉水扩散环的时间戳（`performance.now()`），只用于 380ms 节流 */
  private wakeAt = 0;
  private dustFrames = new Set<number>();
  /** 树冠遮挡的输入缓冲：脚底坐标 (x, y) 成对写入，容量 512 人 */
  private readonly occluders = new Float32Array(1024);
  private lightEnabled = true;
  /** 当前设备像素比：主线程注入或 `resize()` 更新，不再从 `window` 现取 */
  private dpr = 1;
  /** `?dpr=` 上限：0 表示不封顶（默认与改造前一致），只在低端机自救时显式打开 */
  private dprCap = 0;
  private metrics: PixelMetrics = pixelMetrics(DEFAULT_CSS_PER_TEXEL, 1, MIN_DEVICE_PX_PER_TEXEL);
  /** 本实例实际使用的倍率：默认值或 `?zoom=` 覆盖值 */
  private cssPerTexel = DEFAULT_CSS_PER_TEXEL;
  /** `?zoom=` 是否显式锁定倍率：锁定时跳过竖屏自适应 */
  private zoomLocked = false;
  backend = 'initializing';
  private ready = false;
  private destroyed = false;
  /** 用于检测异步初始化期间实体是否被销毁或移出会话（generation token 机制） */
  private readonly pendingInit = new Map<number, { generation: number; abort: AbortController }>();
  private initGeneration = 0;
  /** 相机可见范围缓存，用于实体可见性筛选 */
  private cameraBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  // 气泡队列管理：限制同屏气泡数量
  private readonly MAX_VISIBLE_BUBBLES = 10;
  /** 活跃气泡的复用数组：活跃数通常 0–3，原来每帧都要新建数组 + 每个气泡一个对象 */
  private readonly activeBubbles: EntityView[] = [];
  /** 上次重算像素倍率时的屏幕尺寸与 DPR */
  private metricDpr = 0;
  private metricScreenW = -1;
  private metricScreenH = -1;

  async init(options: RendererInit): Promise<void> {
    // 上限先于度量计算：`pixelMetrics` 的整数化与 backing store 必须用同一个 dpr
    this.dprCap = resolveDprCap(options.search);
    const dpr = capDpr(normalizeDpr(options.dpr), this.dprCap);
    const params = new URLSearchParams(options.search);
    const zoom = readCssPerTexel(options.search);
    // 后端只判定一次：默认 WebGL2，`?gpu=webgpu` 才开 WebGPU（ADR-0071）
    const preference = resolveGpuPreference(options.search, options.gpu);
    this.cssPerTexel = zoom.value;
    this.zoomLocked = zoom.overridden;
    this.dpr = dpr;
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    // 竖屏首帧就落到目标视野：等第一帧 updateCamera 再缩，入场会先跳一下
    this.metrics = pixelMetrics(
      this.effectiveCssPerTexel(width, height),
      dpr,
      MIN_DEVICE_PX_PER_TEXEL,
    );
    await this.app.init({
      preference,
      background: 0x14100c,
      canvas: options.canvas,
      width,
      height,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      // backing store 与设备像素 1:1，避免合成阶段被浏览器重采样
      resolution: dpr,
    });
    this.backend = this.app.renderer.type === RendererType.WEBGPU ? 'webgpu' : 'webgl';
    // 挂载由宿主负责；Worker 侧的 OffscreenCanvas 没有 style，这里只是把主线程那份
    // 画布的默认内联样式补齐，避免出现行内基线间隙
    const canvas = this.app.canvas as HTMLCanvasElement;
    if (canvas.style) {
      canvas.style.touchAction = 'none';
      canvas.style.display = 'block';
    }

    this.atlas = await loadAtlas();
    if (this.destroyed) return;
    await options.fontsReady();
    if (this.destroyed) return;
    this.buildLayers(options.search);
    this.app.stage.addChild(this.world);
    // 飘雪在 world 之上、柔光之下：雪被柔光染一层冷色，才和整张图在同一光环境里。
    // `?snow=0` 只关这一层，覆雪地面与冬季道具保留
    if (this.season.snow) {
      this.snow = new SnowField(this.app.renderer);
      this.snow.resize(this.app.screen.width, this.app.screen.height);
      this.app.stage.addChild(this.snow.container);
    }
    // 光图压在 world 与雪层之上、屏幕空间：主场景画完才合成，不随相机缩放。
    // 地标光源在构造后一次注册：外景来自共享布局，室内由 InteriorArt 现场收集
    if (this.lightEnabled) {
      this.lightmap = new LightmapLayer(this.app.renderer, {
        winter: this.season.winter,
        divisor: this.lightmapDivisor,
      });
      this.lightmap.register(propLights(WORLD_LAYOUT.props));
      this.lightmap.register(this.interior?.lights ?? []);
      // 从 `buildLayers` 里构造的视图现场收集的光位（拱门/门柱挂灯 + 节日彩旗）
      this.lightmap.register(this.lanterns?.lights ?? []);
      this.lightmap.register(this.festival?.lights ?? []);
      this.lightmap.register(this.shrine?.lights ?? []);
      this.lightmap.register(this.park?.lights ?? []);
      // 场所第二层的焦点光：赌场霓虹、诊所冷白、擂台顶灯、公寓门廊灯、广场地灯…
      this.lightmap.register(this.venueArt?.lights ?? []);
      this.app.stage.addChild(this.lightmap.container);
    }
    // 弹幕是屏幕空间最顶层：必须在 lightmap 之后入栈，柔光才不会盖住文字。
    // 它不进 `world`，所以相机平移 / 缩放都不影响位置；DOM 面板天然在画布之上。
    this.danmakuPrefs = options.danmaku ? { ...options.danmaku } : { ...DEFAULT_DANMAKU_PREFS };
    const danmakuParam = params.get('danmaku');
    // 线上紧急开关：`?danmaku=0` 只关渲染，聊天仍写进频道列表
    if (danmakuParam === '0') this.danmakuPrefs = { ...this.danmakuPrefs, enabled: false };
    this.danmaku = new DanmakuField(
      this.danmakuPrefs,
      this.app.screen.width,
      this.app.screen.height,
      dpr,
      danmakuParam === 'stress',
    );
    this.app.stage.addChild(this.danmaku.container);
    this.world.scale.set(this.metrics.cssScale);
    this.ready = true;
  }

  /**
   * 图层顺序：地形地面 → 尘土 → y 排序层（树/围栏/角色）→ 标签气泡。
   * 地形纹理全部在这里一次性生成，帧循环里不会再 generateTexture。
   */
  private buildLayers(search: string): void {
    // 灰度开关：?flat=1 退回矩形平铺，?light=0 关掉柔光层，用于线上快速定位观感回归
    const params = new URLSearchParams(search);
    this.lightEnabled = params.get('light') !== '0';
    // `?lm=2` 用 1/2 视口光图看细节；默认 1/4，把填充率留给 30–50 个光源的合批
    this.lightmapDivisor = params.get('lm') === '2' ? 2 : 4;
    // 季节只在这里判定一次（`?season=winter` / `?season=off` / `?snow=0`），
    // 之后地形、柔光、飘雪、冬季道具都只消费 `winter` 布尔量（ADR-0046）
    this.season = readSeason(search);

    // `?bands=0` 退回单容器：与 `?flat=1` / `?light=0` 同一套灰度惯例，
    // 回退走的也是 add/update/remove 这同一条接口，不是一段会腐烂的分支。
    this.sortLayer = new SortLayer({
      originY: ISLAND.bounds.y,
      extentY: ISLAND.bounds.h,
      single: params.get('bands') === '0',
    });
    this.terrain = new TerrainView(this.app.renderer, {
      flat: params.get('flat') === '1',
      edge: params.get('edge') !== '0',
      winter: this.season.winter,
    });
    this.terrain.build(this.sortLayer);

    this.world.addChild(this.terrain.base);
    // 边缘层：草尖 / 外凸圆弧 / 内缘暗边，压在底色之上、贴花之下
    this.world.addChild(this.terrain.edge);
    // 贴花压在地面之上、尘土与角色之下
    this.world.addChild(this.terrain.decals);
    // 室内地板与墙体、园区铺装：与地形同层，压在贴花之上、y 排序层之下
    this.props = new PropsView();
    // `?decor=0` 只关过渡带的灌木与路边小物，地图与碰撞不变（与 `?venue=0` 同一套灰度惯例）；
    // `?flat=1` 同时关掉路口铺砖、斑马线、指引箭头与铺装路缘，回到旧的纯平铺画法
    this.props.build(this.sortLayer, this.app.renderer, {
      winter: this.season.winter,
      decor: params.get('decor') !== '0',
      flat: params.get('flat') === '1',
    });
    this.world.addChild(this.props.base);
    // 脚底金光压在铺装之上、角色之下：光环不该盖住腿，也不该被地面吃掉
    this.world.addChild(this.goldAura);

    // 室内陈设补完（会议室 / 宿舍 / 工作区 / 卫生间）：与季节无关，始终挂上。
    // 墙上的窗、钟、镜与衣柜这类「贴墙家具」都没有碰撞——贴墙位置本来就在墙体里
    this.interior = new InteriorArt();
    this.interior.build(this.sortLayer, this.props.base, this.app.renderer);
    // 室内「活起来」的那一层（隔间门开合 / 吊灯断闪 / 宿舍暖光）：`?interior=0` 一键退回静态美术，
    // 与 `?venue=0` / `?decor=0` 同一套灰度惯例——美术本体保留，只停掉状态联动与微动效
    this.interiorFx = params.get('interior') !== '0';
    if (this.interiorFx) {
      this.interior.setWarmEligible(this.season.winter || this.isNightNow());
    }

    // 弱交互场所演出（会议室投屏 / 影厅大屏 / 音符 / 打卡闪光）：
    // 屏幕是贴墙陈设，与室内地板同层——永远在角色脚下，不会盖住走进去的人。
    // `?venue=0` 与 venue 装饰层同一条关法；`?motion=0` 只冻结时间，画面照旧。
    if (params.get('venue') !== '0') {
      this.venuePlay = new VenuePlay(this.app.renderer, { animate: params.get('motion') !== '0' });
      this.venuePlay.build(this.props.base);
    }

    // 场所第二层：地面光池 / 收边 / 落地小物走 `props.base`（永远在角色脚下），
    // 檐下挂件与角标走 y 排序层，灯位交给下面的光图注册。`?venue=0` 整层不构造。
    if (params.get('venue') !== '0') {
      this.venueArt = new VenueArt();
      // `?light=0` 连地面光池一起退场：灯灭了却还留着一地暖椭圆会读成漏光
      this.venueArt.build(this.sortLayer, this.props.base, { light: this.lightEnabled });
    }

    // 冬季道具：雪人 / 雪堆进 y 排序层（会被树冠挡住），冰棱贴墙进地面层
    if (this.season.winter) {
      this.winterArt = new WinterArt();
      this.winterArt.attach(this.sortLayer, this.props.base, this.app.renderer);
    }

    // 氛围图集与小鱼层（ADR-0045）：鱼在水面之上、道具与角色之下，先于 y 排序层入场景。
    // 图集与地面小动物共用，只烘焙一次；`?fish=0` 只关鱼，`?critters=0` 两者都关。
    const seed = Date.now() >>> 0;
    const crittersEnabled = params.get('critters') !== '0';
    this.critterArt = crittersEnabled ? bakeCritterArt(this.app.renderer) : undefined;
    if (this.critterArt && params.get('fish') !== '0') {
      this.fish = new FishField(this.critterArt, seed);
      this.world.addChild(this.fish.layer);
    }

    // 北门迎宾地标：自己按脚底 y 进排序层，和树、桌椅、角色共用同一套遮挡关系
    this.welcome = new WelcomeView(this.season.winter);
    this.welcome.build(this.sortLayer, this.app.renderer, this.metrics.devicePxPerTexel);

    // 放假告示板的动态文本（ADR-0059）：展板本体已在 props 里，这里只叠横幅与跑马灯
    this.bulletin = new BulletinView(this.metrics.devicePxPerTexel);
    this.bulletin.build(this.sortLayer);

    // 固定挂灯（ADR-0096）：拱门横梁两端 + 四角院落门柱，入夜由光图层统一点亮
    this.lanterns = new LanternView();
    this.lanterns.build(this.sortLayer);

    // 祈福龛与饮品台（ADR-0096）：两件都是小件，按脚底 y 进同一套遮挡关系
    this.shrine = new ShrineView(this.app.renderer);
    this.shrine.build(this.sortLayer);
    this.tea = new TeaStationView(this.app.renderer);
    this.tea.build(this.sortLayer);

    // 护士急救站（ADR-0084）：地面/柜台走常规深度，救护车与护士帽红十字进覆盖层
    this.clinic = new ClinicView(this.season.winter);
    this.clinic.build(this.sortLayer, this.props.base);
    // 入场快照可能早于图集构建：把先到的治疗状态补喂给爱心层
    for (const [id, state] of this.patientStates) {
      this.clinic.setPatient({ entityId: id, state, seconds: 0 });
    }

    // 发泄区（ADR-0070）：垫子铺在地面层，本体按脚底 y 排序，血条与名牌进标签层
    this.boss = new BossView(this.app.renderer, this.metrics.devicePxPerTexel);
    this.boss.build(this.sortLayer, this.props.base, this.labels);

    // 场所门牌（ADR-0091 / ADR-0096）：墙体是平铺色带没有立面，各入口立一块小门牌
    this.plaques = new PlaqueView(this.metrics.devicePxPerTexel);
    this.plaques.build(this.sortLayer);

    // 园区建筑（ADR-0087）：8 处分阶房产、牛马公寓外立面。
    this.villas = new VillasView(this.season.winter, this.metrics.devicePxPerTexel);
    this.villas.build(this.sortLayer, this.props.base);
    this.gtaWorld = new GtaWorldView(this.season.winter, this.metrics.devicePxPerTexel);
    this.gtaWorld.build(this.sortLayer, this.props.base);
    this.apartment = new ApartmentView(this.season.winter, this.metrics.devicePxPerTexel);
    this.apartment.build(this.sortLayer, this.props.base);

    // 游乐园：入口门头、滑梯与三件器械；滑梯的深度键在塔顶，滑下时不会被盖住
    // `?motion=0` 时摩天轮停在 0 步、彩灯不闪：与 venue 演出层同一个开关
    this.park = new ParkView(
      this.app.renderer,
      this.metrics.devicePxPerTexel,
      params.get('motion') !== '0',
      this.season.winter,
    );
    this.park.build(this.sortLayer, this.props.base);

    // 节日装饰（ADR-0063 / ADR-0096）：跨路彩旗、门楣挂饰与树梢灯串；纯装饰、不参与碰撞。
    // 必须排在门牌之后入层：门楣彩旗与门牌同一条深度键，后入者压在上面；
    // `?festival=0` 时连纹理都不烘，运行时零开销
    if (readFestivalEnabled(search)) {
      this.festival = new FestivalArt({ winter: this.season.winter });
      this.festival.attach(this.sortLayer, this.app.renderer);
    }

    this.shadowTextures = GroundFx.shadowTextures(this.app.renderer);
    this.fx = new GroundFx(this.app.renderer);
    this.world.addChild(this.fx.container);

    // 涟漪在水面之上、角色之下：先于 y 排序层入场景
    this.wadingTexture = makeWadingTexture(this.app.renderer);
    this.waterFx = new WaterFx(this.app.renderer);
    this.world.addChild(this.waterFx.container);

    this.world.addChild(this.sortLayer.container);

    // 影院压暗压在排序层之后、昵称之前：坐下时整个座位区（含角色）一起暗下去，
    // 屏幕本身在暗区之上，才是「开场」而不是「关灯停电」
    if (this.venuePlay) this.world.addChild(this.venuePlay.dim);

    // 窗口探头压在排序层之后：公寓外立面的深度键在楼底，头必须画在楼面之上（ADR-0098）
    this.windowPeek = new WindowPeekView(this.atlas);
    this.world.addChild(this.windowPeek.container);

    // 场所微动效：落叶、水光与霓虹压在最上层——它们本来就该飘过脚背、盖住招牌
    if (this.venueArt) {
      this.venueFx = new VenueFx(this.app.renderer);
      this.world.addChild(this.venueFx.container);
    }

    // 护士站的救护车与护士帽红十字：动态物体，压在同层角色之上，避免车头被身体啃掉
    if (this.clinic) this.world.addChild(this.clinic.overlay);
    if (this.gtaWorld) this.world.addChild(this.gtaWorld.overlay);

    // 仪式反馈压在 y 排序层之后：金色飘字从头顶升起，不能被树冠或角色吃掉
    this.ritual = new RitualFx(this.app.renderer, this.metrics.devicePxPerTexel);
    this.world.addChild(this.ritual.container);

    // 星星在 y 排序层之后入场景：它绕在头顶，不该被树冠或角色身体挡住
    this.stunStars = new StunStars(this.app.renderer);
    this.world.addChild(this.stunStars.container);

    // 持续型 Buff：脚底风压在角色之下不重要，统一放在排序层之后，
    // 保证贴纸不会被树冠或邻座的身体吃掉
    this.buffFx = new BuffFx();
    this.world.addChild(this.buffFx.container);

    // 世界事件（ADR-0088）：红包与冲击波都画在世界坐标里，跟着相机一起缩放
    this.world.addChild(this.worldEventFx.container);

    // 氛围层：地面小动物进 y 排序层（会被树冠挡住），蝴蝶单独一层浮在景物之上、昵称之下。
    // `?critters=0` 时整层不构造：烘焙与撒点都发生在构造函数里，关掉就是真的零开销。
    if (crittersEnabled && this.critterArt) {
      const started = performance.now();
      this.critters = new CritterField(this.sortLayer, this.critterArt, seed);
      this.world.addChild(this.critters.butterflyLayer);
      if (params.get('critters') === 'debug') {
        console.info(
          `[critters] ${this.critters.groundCount} 只兔子 / ${this.critters.butterflyCount} 只蝴蝶 / ` +
            `${this.fish?.fishCount ?? 0} 条小鱼，构造 ${(performance.now() - started).toFixed(1)}ms`,
        );
      }
    }

    this.world.addChild(this.labels);

    const walk = this.atlas.manifest.clips.walk;
    const frames = walk?.frames ?? [];
    // 接触帧 = 每个步幅的第一帧；六拍走一圈扬两次尘
    this.dustFrames = new Set(frames.length > 0 ? [frames[0]!, frames[Math.floor(frames.length / 2)]!] : []);
    // 跳跃末帧是落地：复用同一条扬尘通路，不另建粒子系统
    const jump = this.atlas.manifest.clips.jump;
    const landing = jump ? jump.frames[jump.frames.length - 1] : undefined;
    if (landing !== undefined) this.dustFrames.add(landing);
  }

  /**
   * 加入一个角色。`x/y` 只用于首次归 band：之后每帧由 `updateEntity` 维护，
   * 传进来的目的是避免角色在加入的第一帧被塞进错误的 band 里闪一下。
   */
  async addEntity(
    id: number,
    name: string,
    appearance: CharacterAppearance,
    status: string,
    x = 0,
    y = 0,
    role = 0,
  ): Promise<void> {
    // 同一实体已有初始化在飞：重复 spawn 没有意义，等这一次完成即可
    if (!this.ready || this.views.has(id) || this.pendingInit.has(id)) return;
    
    // 为本次初始化分配 generation token 和 abort signal
    const generation = ++this.initGeneration;
    const abort = new AbortController();
    this.pendingInit.set(id, { generation, abort });
    
    const view = new EntityView(
      this.atlas,
      name,
      appearance,
      status,
      this.metrics.devicePxPerTexel,
      this.shadowTextures,
      this.wadingTexture!,
      (x, y, wading) => {
        // 水里换涟漪，陆地照旧扬尘：同一条落脚通路，不另建计时器
        if (wading) {
          this.waterFx?.spawn(x, y);
          // 涉水扩散环：380ms 最多一枚，走起来才有一圈圈推开的水纹
          const now = performance.now();
          if (now - this.wakeAt >= WADING_WAKE_MS) {
            this.wakeAt = now;
            this.waterFx?.spawnWake(x, y);
          }
        } else {
          this.fx?.spawn(x, y);
          // 雪地脚印：只踩在覆雪地面（户外草地）上。土路、桥、沙岸、室内都是
          // 不该留印子的地面——`isOutdoorGround` 就是贴花层用的那一份判定
          if (this.season.winter && isOutdoorGround(x, y)) {
            this.footprintFoot = !this.footprintFoot;
            this.fx?.spawnFootprint(x, y, this.footprintFoot);
          }
        }
      },
      (x, y, wading) => {
        if (wading) this.waterFx?.spawn(x, y, true);
        else this.fx?.spawnJumpDust(x, y);
      },
      role,
    );
    
    try {
      await view.init();
    } catch (error) {
      // 失败路径必须清掉 pendingInit：否则同一 netId 的后续 spawn / 重试
      // 会被上面的 `pendingInit.has(id)` 永久挡住。
      // 只清理属于本次 generation 的条目，避免误删更新一次的初始化。
      const pending = this.pendingInit.get(id);
      if (pending && pending.generation === generation) this.pendingInit.delete(id);
      // 中止（实体已离场 / 换世界）与资源加载失败都销毁半成品，不留幽灵容器
      view.destroy();
      // 中止不是错误：调用方已经不需要这个视图了
      if (abort.signal.aborted) return;
      throw error;
    }
    
    // 初始化完成后再次校验：Renderer 是否销毁、generation 是否一致、实体是否仍在会话
    if (this.destroyed || abort.signal.aborted) {
      view.destroy();
      this.pendingInit.delete(id);
      return;
    }
    
    const pending = this.pendingInit.get(id);
    if (!pending || pending.generation !== generation) {
      // 有更新的初始化请求或实体已被移除，销毁本视图
      view.destroy();
      this.pendingInit.delete(id);
      return;
    }
    
    // 所有检查通过，正式加入渲染系统
    this.views.set(id, view);
    if (view.isGuard) this.beacons.add(view);
    // 护士帽红十字登记到覆盖层（ADR-0109）：她巡游时帽徽跟着走，不留在站位
    if (role === ENTITY_ROLE_NURSE) this.clinic?.addNurse(id);
    // 伤员状态包可能早于 AOI 里的实体视图到达：补一次，保证盾牌 / 星星不丢
    this.applyPatientStatus(id, view, this.patientStates.get(id));
    // 先把位置摆好再挂进 band：否则首帧会停在 (0,0)，在地图左上角闪一下
    const sx = snapTexel(x);
    const sy = snapTexel(y);
    view.setPosition(sx, sy);
    // 入场首帧就判一次水：远端角色一出生就在河里时不会先干着站一帧
    view.setWadingAt(sx, sy);
    this.sortLayer.add(y, view.root);
    this.labels.addChild(view.labels);
    this.pendingInit.delete(id);
    // 脚底金光按头饰判定：入场首帧就要亮，否则戴冠的人会先秃一帧
    if (appearance.cosmetics?.headwear === GOLDEN_HELMET_ID) this.goldHelmets.add(id);
    else this.goldHelmets.delete(id);
    // 探头快照可能早于实体视图到达：这时才拿得到外观，补画一次窗口里的头
    if (this.peekEntries.some((entry) => entry.id === id)) {
      this.setApartmentPeek(this.peekEntries);
    }
  }

  removeEntity(id: number): void {
    const view = this.views.get(id);
    if (view) {
      this.views.delete(id);
      this.goldHelmets.delete(id);
      this.beacons.delete(view);
      this.reactingViews.delete(view);
      this.clinic?.removeNurse(id);
      this.p2pFx.drop(id);
      this.windowPeek?.drop(id);
      view.destroy();
    }
    
    // 如果实体正在初始化，中止异步过程
    const pending = this.pendingInit.get(id);
    if (pending) {
      pending.abort.abort();
      this.pendingInit.delete(id);
    }
  }

  /**
   * 更新远端角色。返回是否可见：屏外时位置、深度与批处理都不必碰，
   * 调用方可以据此跳过整段动画求值（那些结果本来就看不见）。
   *
   * 隐藏在最后一次可见时的位置上，回屏那一帧才重算——它本来是看不见的，
   * 所以不存在「瞬移一帧」的观感问题。
   */
  updateEntity(id: number, x: number, y: number): boolean {
    const view = this.views.get(id);
    if (!view) return false;
    const shown = this.isEntityVisible(x, y);
    view.setShown(shown);
    if (shown) {
      this.place(view, x, y);
      this.applyNameplateBudget(view, x, y);
    }
    return shown;
  }

  /** 本地角色：永远在画面中心，不做可见性判定 */
  updateLocalEntity(id: number, x: number, y: number): void {
    const view = this.views.get(id);
    if (!view) return;
    view.setShown(true);
    this.place(view, x, y);
  }

  private place(view: EntityView, x: number, y: number): void {
    const sx = snapTexel(x);
    const sy = snapTexel(y);
    view.setPosition(sx, sy);
    // 刚踏进水里的那一帧放一次大水花；之后水中落脚由 setPose 的小涟漪接管
    if (view.setWadingAt(sx, sy)) this.waterFx?.spawn(sx, sy, true);
    // 脚底 y 即深度：站在树后会被树冠挡住，站到树前就压回去
    this.sortLayer.update(view.root, sy);
  }

  /**
   * 低档名牌预算：只保留玩家附近的昵称。
   *
   * 以相机焦点（玩家所在处）而不是屏幕边缘作基准，配两段阈值做滞回。高档时只做一次
   * 布尔比较就返回；降档后每个可见角色多算 4 次乘加，比裁掉一张文字位图的绘制便宜得多。
   */
  private applyNameplateBudget(view: EntityView, x: number, y: number): void {
    if (this.qualityTier !== 'low') {
      if (!view.hasNameplate) view.setNameplate(true);
      return;
    }
    const dx = x - this.focusX;
    const dy = y - this.focusY;
    const d2 = dx * dx + dy * dy;
    const show = d2 <= (view.hasNameplate ? NAMEPLATE_DROP_R2 : NAMEPLATE_KEEP_R2);
    if (show !== view.hasNameplate) view.setNameplate(show);
  }

  setPose(id: number, direction: number, column: number): void {
    this.views.get(id)?.setPose(direction, column, this.dustFrames);
  }

  /**
   * 入座 / 起身抬升：由 session 按座位种类与朝向算出（`seat-art.ts`），
   * 这里只负责把身体与昵称抬起来。`0` 表示地面坐 / 躺或已起身。
   */
  setSeatLift(id: number, liftTexels: number): void {
    this.views.get(id)?.setSeatLift(liftTexels);
  }

  /** 待机呼吸 / 行走起伏 / 阴影 squash：全部是整数纹素与纹理切换 */
  setMotion(id: number, motion: PonyMotion): void {
    this.views.get(id)?.applyMotion(motion);
  }

  /** 作揖（ADR-0061）：900ms 的下俯包络，只作用于本机角色 */
  setBow(id: number, bowTexels: number): void {
    this.views.get(id)?.applyBow(bowTexels);
  }

  /** 跳跃弧线：抬升本体与昵称、切换阴影档位；lift 为 0 时即回到地面 */
  setJump(id: number, liftTexels: number, shadow: number): void {
    this.views.get(id)?.applyJump(liftTexels, shadow);
  }

  /** 动作微移（如发泄前倾 / 回弹）：纯视觉整数纹素，不改碰撞坐标 */
  setActionNudge(id: number, dx: number, dy: number): void {
    this.views.get(id)?.applyNudge(dx, dy);
  }

  /** 受击反馈：从施力点方向震退几像素 + 瞬时高光闪烁 */
  triggerHitReact(id: number, fromX: number, fromY: number, durationMs = 170): void {
    const view = this.views.get(id);
    if (!view || !view.isShown) return;
    view.triggerHitReact(fromX, fromY, performance.now(), durationMs);
    this.reactingViews.add(view);
  }

  setAppearance(id: number, appearance: CharacterAppearance): void {
    this.views.get(id)?.setAppearance(appearance);
    // 换帽子立刻换光环：戴上皇冠的人不该继续踩着金光，摘掉则相反
    if (appearance.cosmetics?.headwear === GOLDEN_HELMET_ID) this.goldHelmets.add(id);
    else this.goldHelmets.delete(id);
  }

  /** 状态变更：本机与视野内的远端角色走同一条路径，空串即清除 */
  setStatus(id: number, status: string): void {
    this.views.get(id)?.setStatus(status);
  }

  /** 改名变更：本机与视野内的远端角色走同一条路径 */
  setName(id: number, name: string): void {
    this.views.get(id)?.setName(name);
  }

  showBubble(id: number, text: string): void {
    this.views.get(id)?.showBubble(text, performance.now());
  }

  /** P2P 亮牌：骰子 / 猜拳 / 切磋结算，挂在参与者头顶，附近 AOI 都能看到 */
  showShowdown(packet: P2PShowdownPacket): void {
    this.p2pFx.show(this.views, packet);
  }

  /** 切磋实时血量与倒计时：只在该玩法里创建血条 */
  setDuelState(packet: P2PDuelStatePacket): void {
    this.p2pFx.duel(this.views, packet);
  }

  /** 打赏飘字：双方头顶各自 +N / -N */
  showCoinFloat(id: number, amount: number): void {
    this.p2pFx.coin(this.views, id, amount);
  }

  /** 对局结束：清掉切磋血条，亮牌继续按自己的 4s 时长淡出 */
  clearDuelHuds(): void {
    this.p2pFx.clearDuelHuds();
  }

  /**
   * 脚底金光：戴黄金安全帽的人踩着一圈金色光斑，两帧交替呼吸。
   *
   * 一个 Graphics 重画全层：同时戴着的人个位数，比每人备一个 Sprite 更省。
   */
  private goldAuraDrawn = false;

  private drawGoldAura(now: number): void {
    const gfx = this.goldAura;
    if (this.goldHelmets.size === 0) {
      if (this.goldAuraDrawn) {
        gfx.clear();
        this.goldAuraDrawn = false;
      }
      return;
    }
    gfx.clear();
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(now / 420));
    let drawn = false;
    for (const id of this.goldHelmets) {
      const view = this.views.get(id);
      if (!view || !view.isShown) continue;
      const x = Math.round(view.root.position.x);
      const y = Math.round(view.root.position.y);
      gfx.ellipse(x, y + 2, 17, 6).fill({ color: 0xf5c451, alpha: 0.12 * pulse });
      gfx.ellipse(x, y + 2, 11, 4).fill({ color: 0xfff3c4, alpha: 0.2 * pulse });
      drawn = true;
    }
    this.goldAuraDrawn = drawn;
  }

  /** 红包雨：按事件种子铺 25 个红包；`null` 表示事件结束、整层收起（ADR-0088） */
  setRedPacketSeed(seed: number | null): void {
    if (seed === null) this.worldEventFx.clearSpots();
    else this.worldEventFx.setSpots(seed);
  }

  /** 某个红包被抢走：本地立刻抹掉，不等下一帧回包 */
  claimRedPacket(index: number): void {
    this.worldEventFx.claim(index);
  }

  /** 画饼冲击波：预警 2 秒红圈 / 命中帧扩散闪白 */
  showBossShock(packet: BossShockPacket): void {
    this.worldEventFx.showShock(packet, performance.now());
  }

  /**
   * 弹幕上屏（ADR-0056）。
   *
   * 与 `showBubble` 并存：Zzz、发泄与互动台词仍然跟在角色头顶，
   * 只有聊天改走屏幕空间。
   */
  showDanmaku(message: DanmakuMessage): void {
    this.danmaku?.push(message);
  }

  /** 偏好变更：开关、不透明度与覆盖区域都只作用在这一层 */
  setDanmakuPrefs(prefs: DanmakuPrefs): void {
    this.danmakuPrefs = { ...prefs };
    this.danmaku?.setPrefs(prefs);
  }

  /**
   * 低帧自适应画质档：只开关非关键观感层。
   *
   * - `balanced` 关掉光图的 screen 层（一次全屏混合，只在傍晚/夜间存在）；
   * - `low` 再关飘雪与远景昵称。
   *
   * 刻意不动 DPR、光图分辨率与角色本体：改它们会在高 DPR 屏上引入重采样、
   * 让夜景糊成色块，或者拿走玩家判断位置的全部依据——那是画风与手感损失，
   * 不是「降一档画质」。档位变化极少（一次会话个位数次），这里打一条日志便于线上核对。
   */
  setQualityTier(tier: QualityTier): void {
    if (tier === this.qualityTier) return;
    this.qualityTier = tier;
    this.lightmap?.setScreenEnabled(tier === 'high');
    if (this.snow) this.snow.container.visible = tier !== 'low';
    console.info(`[render] 画质档 ${tier}`);
  }

  /** 重连 / 换园区时清屏：旧弹幕不该漂在新世界里 */
  clearDanmaku(): void {
    this.danmaku?.clear();
  }

  /**
   * 点亮头顶的眩晕星星。
   *
   * 时长由调用方给（与硬直同一个常量），渲染层不推断「为什么晕」——
   * 将来若有别的动作也会让人晕，这条通路不用改。
   */
  setStun(id: number, durationMs: number): void {
    if (!this.stunStars || durationMs <= 0) return;
    this.stunStars.set(id, performance.now() + durationMs);
  }

  /**
   * 持续型 Buff 表现（ADR-0085）：脚底风 / 护盾环 / 头顶绿色贴纸。
   *
   * 与 `setStun` 一样由调用方给时长，渲染层不推断「为什么有状态」——
   * 服务端广播的 `durationMs` 是唯一真相，本地不另算过期。
   */
  setBuffVisual(id: number, effect: number, durationMs: number): void {
    this.buffFx?.set(id, effect, durationMs, performance.now());
  }

  /** 护盾被消耗：只撤那一类表现，别顺手抹掉同时挂着的其它 Buff */
  clearBuffVisual(id: number, effect?: number): void {
    this.buffFx?.clear(id, effect);
  }

  /** 重连 / 换园区：所有临时状态都不该漂在新世界里 */
  clearBuffVisuals(): void {
    this.buffFx?.clearAll();
  }

  /** 房产牌匾：房主名、在线指示灯、锁形图标与门扇开合 */
  setVillaState(packet: VillaStatePacket): void {
    this.villas?.setState(packet);
  }

  setVehicles(packet: VehicleStatePacket): void {
    this.gtaWorld?.setVehicles(packet);
  }

  setTurf(packet: TurfStatePacket): void {
    this.gtaWorld?.setTurf(packet);
  }

  setFishing(packet: FishingStatePacket): void {
    this.gtaWorld?.setFishing(packet);
  }

  setGig(packet: GigStatePacket): void {
    this.gtaWorld?.setGig(packet);
  }

  setEntityWanted(id: number, stars: number): void {
    this.views.get(id)?.setWantedStars(stars);
  }

  setEntityGhost(id: number, alpha: number): void {
    this.views.get(id)?.setGhostAlpha(alpha);
  }

  /**
   * 公寓窗口占用快照（ADR-0098）：全量覆盖。
   *
   * 探头的人本体隐藏、头画到窗口上；窗口一并点亮。外观仍读常规实体视图，
   * 所以这里只是「谁在哪扇窗」，不重复传外观。
   */
  setApartmentPeek(entries: ReadonlyArray<ApartmentPeekEntry>): void {
    this.peekEntries = entries;
    const peeking = new Set<number>();
    for (const entry of entries) peeking.add(entry.id);
    for (const [id, view] of this.views) view.setPeeked(peeking.has(id));
    this.windowPeek?.setEntries(entries, (id) => this.views.get(id)?.body.appearance);
  }

  /** 上香成功：财神像闪一道金色微光（ADR-0061） */
  flashShrine(): void {
    this.shrine?.flash();
  }

  /** 头顶升起金色飘字：(x, y) 取角色的脚底坐标（ADR-0061） */
  showFloatText(x: number, y: number, text: string): void {
    this.ritual?.floatText(x, y, text, performance.now());
  }

  /** 当日首香的淡金光晕：跟着指定实体走，`durationMs` 后自动熄灭（ADR-0061） */
  grantAura(id: number, durationMs: number): void {
    if (!this.ritual) return;
    this.auraEid = id;
    this.ritual.grantAura(performance.now(), durationMs);
  }

  /**
   * 老板血量：下行广播与入场快照都走这里（ADR-0070）。
   *
   * 血条之外只外露一个档位给房间氛围（正常 / 残血 / 倒下）：
   * 两个类各自解释血量迟早会读出两种「残血」，而每帧读百分比又无从比较。
   */
  setBossHp(hp: number): void {
    this.boss?.setHp(hp);
    if (!this.interiorFx) {
      this.boss?.setAlert(0);
      this.venueArt?.setBossAlert(0);
      return;
    }
    const safe = Number.isFinite(hp) ? Math.max(0, Math.min(BOSS_MAX_HP, hp)) : BOSS_MAX_HP;
    const tier: 0 | 1 | 2 = safe <= 0 ? 2 : safe / BOSS_MAX_HP < 0.3 ? 1 : 0;
    this.boss?.setAlert(tier);
    this.venueArt?.setBossAlert(tier);
  }

  /** 园区本地时间的「夜班」判定：与工效加成的口径同一把尺子（服务端时钟 + 园区时区） */
  private isNightNow(): boolean {
    const hour = new Date(serverNow() + serverTzOffsetMin() * 60_000).getUTCHours();
    return isNightShift(hour);
  }

  /**
   * 老板受击反馈：**任何玩家**踢中都走这里（ADR-0105）。
   *
   * 抖动由服务端归因驱动——本地不做乐观预测，旁观者也不会看到「没判中也抖」。
   */
  flashBossHit(): void {
    this.boss?.flashHit();
  }

  /**
   * 老板受击飘字：位置取胸腹，避开头顶的血条与名牌。
   *
   * `floatText` 会把字放在 (x, y - 46) 再上浮，所以这里把 y 抬到肚子高度，
   * 让数字落在老板身上而不是脚边。合并窗口由会话层负责，这里只画。
   */
  showBossDamage(damage: number): void {
    if (damage <= 0) return;
    this.ritual?.floatText(
      BOSS.x,
      BOSS.y - BOSS_DAMAGE_LIFT_PX,
      `-${damage}`,
      performance.now(),
      BOSS_DAMAGE_FONT_SIZE,
    );
  }

  /** 视野内是否已有该实体的视图：押送气泡据此决定挂保安还是当事人 */
  hasEntity(id: number): boolean {
    return this.views.has(id);
  }

  /** 救护车四态同步（ADR-0084）；停泊时服务端不发冗余包，入场靠 snapshot 补一次 */
  setAmbulance(packet: AmbulancePacket): void {
    this.clinic?.setAmbulance(packet);
  }

  /** 伤员状态：昏迷挂星星、治疗冒爱心、治愈亮绿色十字盾（ADR-0084） */
  setPatientStatus(packet: PatientStatusPacket): void {
    this.clinic?.setPatient(packet);
    if (packet.state === PATIENT_STATE.None) this.patientStates.delete(packet.entityId);
    else this.patientStates.set(packet.entityId, packet.state);
    const view = this.views.get(packet.entityId);
    if (view) this.applyPatientStatus(packet.entityId, view, packet.state);
  }

  /** 把状态应用到已存在的视图：状态包与 AOI spawn 谁先到都能落到同一套图标上 */
  private applyPatientStatus(
    id: number,
    view: EntityView,
    state: PatientStatusPacket['state'] | undefined,
  ): void {
    switch (state) {
      case PATIENT_STATE.Incapacitated:
      case PATIENT_STATE.Treating:
        this.stunStars?.set(id, Number.POSITIVE_INFINITY);
        view.setShield(false);
        return;
      case PATIENT_STATE.Shielded:
        this.stunStars?.clearEntity(id);
        view.setShield(true);
        return;
      default:
        this.stunStars?.clearEntity(id);
        view.setShield(false);
    }
  }

  /**
   * 诊所覆盖层按实体跟位：直接读视图根节点的当前插值坐标。
   *
   * 箭头属性只建一次，每帧最多被问 2 次（护士帽 + 伤员爱心），不分配对象。
   */
  private readonly clinicAnchor = (id: number): { x: number; y: number } | null => {
    const view = this.views.get(id);
    return view ? view.root.position : null;
  };

  tickBubbles(dtMs: number): void {
    const now = performance.now();
    // 救护车警灯、护士帽红十字与伤员爱心共用同一条帧时钟，400ms 相位不额外维护状态
    this.clinic?.update(now, this.clinicAnchor, dtMs);
    this.gtaWorld?.update(now, dtMs);

    // 受击震动与瞬时染红（只在发生碰撞时存在元素，平时零遍历开销）
    for (const view of this.reactingViews) {
      if (!view.tickReact(now)) this.reactingViews.delete(view);
    }

    // 活跃气泡通常 0–3 个，复用一块数组：原来每帧新建数组 + 每个气泡一个
    // `{id, view, bubbleUntil}` 对象 + 一次 sort，哪怕一个气泡都没有。
    const active = this.activeBubbles;
    let count = 0;
    for (const view of this.views.values()) {
      if (!view.bubble.visible) continue;
      if (count < active.length) active[count] = view;
      else active.push(view);
      count += 1;
    }

    // 超过同屏上限时让最早的气泡提前淡出。只有真超限才排序（插入排序，元素极少）。
    if (count > this.MAX_VISIBLE_BUBBLES) {
      for (let i = 1; i < count; i += 1) {
        const view = active[i]!;
        const key = view.bubbleUntil;
        let j = i - 1;
        while (j >= 0 && active[j]!.bubbleUntil > key) {
          active[j + 1] = active[j]!;
          j -= 1;
        }
        active[j + 1] = view;
      }
      for (let i = 0; i < count - this.MAX_VISIBLE_BUBBLES; i += 1) {
        active[i]!.bubbleUntil = now;
      }
    }

    for (let i = 0; i < count; i += 1) active[i]!.tickBubble(now);

    // 星星与气泡同一个节拍：两者都挂在头顶，同一帧推进不会互相错位
    this.stunStars?.update(now, this.views);
    this.buffFx?.update(now, this.views);
    this.p2pFx.update(now);
    this.worldEventFx.update(now);
    this.drawGoldAura(now);

    // 警灯只遍历保安集合：普通实体与真人不会被每帧白算一次
    for (const view of this.beacons) view.updateBeacon(now);

    // 职场玄学两处的常驻微动（青烟 / 蒸汽）与一次性反馈（金色飘字、首香光晕）
    this.shrine?.update(dtMs);
    this.tea?.update(dtMs);
    this.boss?.update(dtMs);
    this.ritual?.update(now);
    if (this.auraEid !== 0) {
      const auraView = this.views.get(this.auraEid);
      if (auraView) this.ritual?.followAura(auraView.root.position.x, auraView.root.position.y);
    }

    this.fx?.update(dtMs);
    this.waterFx?.update(dtMs);
    this.terrain?.update(dtMs);
    // 跑马灯：只推进滚动坐标，文案每秒重算一次（ADR-0059）
    this.bulletin?.update(dtMs);
    // 雪在屏幕空间，只累加坐标；灯串亮度由它自己 30s 采样一次。
    // 低档整层不画，连坐标推进一起停掉：不可见的雪没有更新的理由
    if (this.qualityTier !== 'low') this.snow?.update(dtMs);
    // 弹幕与雪同一层空间：只改 x / alpha，离屏当帧回收
    this.danmaku?.update(dtMs);
    this.winterArt?.update(now);
    // 节日彩旗两帧飘动 + 30s 一次亮核采样（ADR-0063）
    this.festival?.update(now);
    // 场所微动效：落叶 / 水光 / 霓虹，离屏跳过计算
    this.venueFx?.update(now, this.cameraBounds ?? undefined);
    // 室内状态美术：工位代码行两帧 + 专注光呼吸、隔间门 / 吊灯 / 暖光、发泄室警戒光。
    // `?interior=0` 时整层停在这里：屏幕停在亮屏的静止帧，房间退回改前的样子
    if (this.interiorFx) {
      this.props?.update(now);
      this.interior?.update(now);
      this.venueArt?.update(now);
    }
    // 局域演出：会议投屏轮播、影厅频道动件、影院压暗收敛、音符与闪光
    this.venuePlay?.update(now, dtMs);
    // 游乐园：摩天轮吊舱换步、夜间彩灯逐颗脉冲
    this.park?.update(now);
    // 相机在 session 里先于本方法更新，这里拿到的边界与焦点属于同一帧
    this.critters?.update(dtMs, this.focusX, this.focusY, this.cameraBounds);
    this.fish?.update(dtMs, this.cameraBounds, this.focusX, this.focusY);
    this.syncOccluders();
    // 光图必须在 Pixi 渲染 stage 之前落盘：这是同帧唯一一次低清 RT Pass，
    // 也是唯一一次点光源提交（合成只读这张图，不重复提交光源）
    this.lightmap?.render(now);
  }

  /**
   * 判定实体是否在当前相机可见范围内（包括裁剪余量）
   */
  private isEntityVisible(x: number, y: number): boolean {
    if (!this.cameraBounds) return true;
    const padding = CULL_PAD_X; // 使用相同的裁剪余量
    return (
      x >= this.cameraBounds.minX - padding &&
      x <= this.cameraBounds.maxX + padding &&
      y >= this.cameraBounds.minY - padding &&
      y <= this.cameraBounds.maxY + padding
    );
  }

  /**
   * 把可见角色的脚底坐标喂给地形：树冠透明的唯一输入。
   * 复用一块 Float32Array，帧循环里不分配对象。
   * 只处理相机视口范围内的实体，减少输入数据量。
   */
  private syncOccluders(): void {
    if (!this.terrain) return;
    const capacity = this.occluders.length / 2;
    let count = 0;
    for (const view of this.views.values()) {
      if (count >= capacity) break;
      // 屏外角色的位置是最后一次可见时的旧值，喂进去只会让某棵树莫名变透明
      if (!view.isShown) continue;
      this.occluders[count * 2] = view.root.position.x;
      this.occluders[count * 2 + 1] = view.root.position.y;
      count += 1;
    }
    this.terrain.occlude(this.occluders, count);
  }

  /**
   * 视口同步。
   *
   * 主线程由 ResizeObserver 上报，Worker 每帧从控制块读到最新值；
   * 两者都收敛到这里，且只在尺寸或 DPR 真变了才动 renderer——
   * 每帧无脑 resize 会重建 backing store，高刷屏上等于自废帧率。
   */
  resize(width: number, height: number, dpr: number): void {
    if (this.destroyed) return;
    const nextW = Math.max(1, Math.round(width));
    const nextH = Math.max(1, Math.round(height));
    // 与 `init` 走同一条口径：拖窗口跨屏时上限照样生效
    const nextDpr = capDpr(normalizeDpr(dpr), this.dprCap);
    if (nextW === this.app.screen.width && nextH === this.app.screen.height && nextDpr === this.dpr) return;
    this.dpr = nextDpr;
    this.app.renderer.resize(nextW, nextH, nextDpr);
    // 尺寸变了要让光图与雪量立刻跟上，不然会等到下一次 updateCamera 才对齐
    this.lightmap?.resize(this.app.screen.width, this.app.screen.height);
    this.snow?.resize(this.app.screen.width, this.app.screen.height);
    this.danmaku?.resize(this.app.screen.width, this.app.screen.height, nextDpr);
  }

  updateCamera(x: number, y: number): void {
    const screen = this.app.screen;
    this.syncMetrics(screen.width, screen.height);
    // 雪按视口面积重排：缩放窗口时雪量跟着变，密度不会突然变稀或变密
    this.snow?.resize(screen.width, screen.height);
    const { dpr, cssScale } = this.metrics;
    const halfW = screen.width / cssScale / 2;
    const halfH = screen.height / cssScale / 2;
    // 相机夹在陆地包围盒内：贴到边界时角色不在正中，但画面不会露出世界外的黑
    const bounds = ISLAND.bounds;
    // 相机必须与角色用同一个吸附函数（snapTexel = round）：
    // 相机 floor + 角色 round 会让两者每移动 1 世界像素错开 1 纹素，
    // 表现为角色相对背景约 15Hz 横跳（ADR-0021）。
    const camX = cameraFocus(x, bounds.x, bounds.w, halfW);
    const camY = cameraFocus(y, bounds.y, bounds.h, halfH);
    // 小动物用相机焦点当「玩家在哪」：相机永远跟着本地角色，两者只差一个夹紧偏移
    this.focusX = camX;
    this.focusY = camY;

    // 缓存相机可见范围（用于实体筛选）
    this.cameraBounds = {
      minX: camX - halfW,
      maxX: camX + halfW,
      minY: camY - halfH,
      maxY: camY + halfH,
    };

    // 中心点与角色都落在整纹素栅格上：中心 → 设备像素，角色 → 世界像素。
    // camX/camY 已是整数纹素，直接参与世界层位移，不能再二次吸附。
    this.world.x = snapCss(screen.width / 2, dpr) - camX * cssScale;
    this.world.y = snapCss(screen.height / 2, dpr) - camY * cssScale;

    // 光图恰好覆盖当前相机视口：这里只同步尺寸/相机，RT Pass 在 tickBubbles 末尾
    this.lightmap?.setView(screen.width, screen.height, cssScale, camX, camY, halfW, halfH);

    // 只画看得见的树：余量按帧尺寸给，树冠那一截由地形自己补
    this.props?.cull(
      camX - halfW - CULL_PAD_X,
      camY - halfH - CULL_PAD_Y,
      camX + halfW + CULL_PAD_X,
      camY + halfH + CULL_PAD_Y,
    );
    this.terrain?.cull(
      camX - halfW - CULL_PAD_X,
      camY - halfH - CULL_PAD_Y,
      camX + halfW + CULL_PAD_X,
      camY + halfH + CULL_PAD_Y,
    );
  }

  /** 竖屏按屏宽降一档视野；`?zoom=` 显式锁定时原样返回，保证灰度开关在两种朝向下一致 */
  private effectiveCssPerTexel(width: number, height: number): number {
    if (this.zoomLocked) return this.cssPerTexel;
    return worldCssPerTexel(width, height, this.cssPerTexel);
  }

  /**
   * 拖窗口到另一块屏（DPR 变化）、旋转设备（宽高互换）时重建缩放与文字位图。
   *
   * 只在尺寸或 DPR 真变了才重算：原实现每帧都构造一个 metrics 对象再与旧值比较丢弃，
   * 等于每帧一次无谓的分配。
   */
  private syncMetrics(screenWidth: number, screenHeight: number): void {
    const dpr = this.dpr;
    if (dpr === this.metricDpr && screenWidth === this.metricScreenW && screenHeight === this.metricScreenH) {
      return;
    }
    this.metricDpr = dpr;
    this.metricScreenW = screenWidth;
    this.metricScreenH = screenHeight;

    const next = pixelMetrics(
      this.effectiveCssPerTexel(screenWidth, screenHeight),
      dpr,
      MIN_DEVICE_PX_PER_TEXEL,
    );
    if (sameMetrics(next, this.metrics)) return;
    this.metrics = next;
    this.world.scale.set(next.cssScale);
    if (this.app.renderer.resolution !== next.dpr) this.app.renderer.resolution = next.dpr;
    for (const view of this.views.values()) view.setTextResolution(next.devicePxPerTexel);
    this.welcome?.setTextResolution(next.devicePxPerTexel);
    this.bulletin?.setTextResolution(next.devicePxPerTexel);
    this.ritual?.setTextResolution(next.devicePxPerTexel);
    this.plaques?.setTextResolution(next.devicePxPerTexel);
    this.park?.setTextResolution(next.devicePxPerTexel);
    this.boss?.setTextResolution(next.devicePxPerTexel);
    this.villas?.setTextResolution(next.devicePxPerTexel);
    this.gtaWorld?.setTextResolution(next.devicePxPerTexel);
    this.apartment?.setTextResolution(next.devicePxPerTexel);
  }

  get entityCount(): number {
    return this.views.size;
  }

  /**
   * 舞台局部 CSS 坐标 → 世界坐标 → 最近角色 id。
   *
   * `world` 容器按 `cssScale` 缩放并平移，反变换只有一次除法和两次减法；
   * 拾取只在点击 / 轻点时执行，O(可见角色数) 的线性扫描不会进帧循环。
   * 屏外被 `setShown(false)` 的角色不参与命中——它们的位置停留在最后一次可见处。
   */
  pickEntityAt(stageX: number, stageY: number): number | null {
    const point = this.worldPointAt(stageX, stageY);
    if (!point) return null;
    const candidates: PickCandidate[] = [];
    for (const [id, view] of this.views) {
      if (!view.isShown) continue;
      candidates.push({ id, x: view.root.position.x, y: view.root.position.y });
    }
    return pickCharacter(candidates, point.x, point.y);
  }

  /**
   * 舞台局部 CSS 坐标 → 世界坐标。
   *
   * `world` 容器按 `cssScale` 缩放并平移，反变换只有一次除法和两次减法。
   * 点选角色与点选静态地标（放假告示板）共用这一份换算，避免两处各写一遍。
   */
  worldPointAt(stageX: number, stageY: number): { x: number; y: number } | null {
    const scale = this.metrics.cssScale;
    if (!Number.isFinite(stageX) || !Number.isFinite(stageY) || scale <= 0) return null;
    return { x: (stageX - this.world.x) / scale, y: (stageY - this.world.y) / scale };
  }

  /**
   * 座位占用变化：对应工位的显示器随占座点亮或熄灭。
   *
   * 顺带维护会议室 / 影厅的人头数（只读 `S2C_SEAT_STATE`，纯客户端演出）：
   * 只在真正的变化沿上加减，重复广播不会把人数越加越多。
   */
  setSeatOccupied(seatId: number, occupied: boolean): void {
    const seat = seatById(seatId);
    if (seat) this.props?.setSeatOccupied(seat, occupied);
    // 室内的第二处联动：马桶 → 隔间门，宿舍床 → 暖光条件（工位屏在 PropsView 里）
    if (this.interiorFx) this.interior?.setSeatOccupied(seatId, occupied);

    const had = this.occupiedSeats.has(seatId);
    if (occupied === had) return;
    if (occupied) this.occupiedSeats.add(seatId);
    else this.occupiedSeats.delete(seatId);

    const room = venueRoomOfSeat(seatId);
    if (!room || !this.venuePlay) return;
    const delta = occupied ? 1 : -1;
    if (room === 'meeting') {
      this.meetingSeated = Math.max(0, this.meetingSeated + delta);
      this.venuePlay.setRoomOccupied('meeting', this.meetingSeated);
    } else {
      this.theaterSeated = Math.max(0, this.theaterSeated + delta);
      this.venuePlay.setRoomOccupied('theater', this.theaterSeated);
    }
  }

  /**
   * 本地入座变化：只有坐在影厅座椅上才压暗影厅。
   * 座位 id 由 session 给出（0 = 起身），渲染层不自己猜。
   */
  setLocalSeatVenue(seatId: number): void {
    this.venuePlay?.setTheaterLocalSeated(venueRoomOfSeat(seatId) === 'theater');
  }

  /**
   * 局域水花：洗手台按 F 的一次性反馈（纯本地，不广播）。
   * 池子与尘土共用同一条 ticker，不为一次洗手新增图层。
   */
  showSplash(x: number, y: number): void {
    this.fx?.spawnSplash(x, y);
  }

  /**
   * 本人搬砖中：在对应工位上点亮一圈专注光。
   *
   * `seatId` 是本地座位（0 = 没坐），由 session 给出：渲染层不猜「谁在搬砖」。
   * 非工位座位一律收起——坐在长椅上不该有加班光。
   */
  setWorking(seatId: number, active: boolean): void {
    if (!this.props || !this.interiorFx) return;
    const deskIndex = active ? workDeskIndexOfSeat(seatId) : -1;
    this.props.setWorkingDesk(deskIndex, deskIndex >= 0);
  }

  /** 影厅换台（本地）：返回新频道名，供瞬时提示使用 */
  cycleTheaterChannel(): string {
    return this.venuePlay?.cycleChannel() ?? '';
  }

  /** 游乐园打卡闪光：纯客户端反馈，不广播 */
  flashPhotoAt(x: number, y: number): void {
    this.venuePlay?.flashPhoto(x, y);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    
    // 中止所有待处理的异步初始化
    for (const { abort } of this.pendingInit.values()) {
      abort.abort();
    }
    this.pendingInit.clear();
    
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    for (const texture of this.shadowTextures) texture.destroy(true);
    this.stunStars?.destroy();
    this.fx?.destroy();
    this.waterFx?.destroy();
    this.wadingTexture?.destroy(true);
    this.terrain?.destroy();
    this.props?.destroy();
    this.welcome?.destroy();
    this.bulletin?.destroy();
    this.lanterns?.destroy();
    this.festival?.destroy();
    this.shrine?.destroy();
    this.tea?.destroy();
    this.boss?.destroy();
    this.plaques?.destroy();
    this.villas?.destroy();
    this.gtaWorld?.destroy();
    this.apartment?.destroy();
    this.windowPeek?.destroy();
    this.park?.destroy();
    this.clinic?.destroy();
    this.ritual?.destroy();
    // 冬季与室内陈设的精灵先交给 app.destroy 统一回收，纹理在这里手动释放
    this.winterArt?.destroy();
    this.interior?.destroy();
    // 场所层的 Graphics 由 app.destroy 回收，这里只需释放微动效自己烘的三张小图
    this.venueFx?.destroy();
    // 局域演出自己烘的幻灯片 / 频道底图 / 动件 / 音符 / 闪光纹理都在这里释放
    this.venuePlay?.destroy();
    this.occupiedSeats.clear();
    this.snow?.destroy();
    this.danmaku?.destroy();
    // 先放两个 Field 的精灵，再放共享图集：反了会让还在引用纹理的 Sprite 悬空
    this.fish?.destroy();
    this.critters?.destroy();
    this.critterArt?.destroy();
    // 光图与光斑纹理都是手工资源：先释放，再交给 app.destroy 收尾
    this.lightmap?.destroy();
    this.app.destroy(true, { children: true });
  }
}
