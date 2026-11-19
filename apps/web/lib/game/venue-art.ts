'use client';

import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';
import {
  AMUSEMENT_PARK,
  AMUSEMENT_STREET,
  APARTMENT_GARDEN,
  APARTMENT_GARDEN_PATH,
  APARTMENT_SPECS,
  BOSS_ARENA,
  CLINIC_ACCESS_PAVING,
  CLINIC_RECT,
  COMPANY_CORRIDOR,
  COMPANY_FORECOURT,
  LIVING_AVENUE,
  NEON_STRIP_PLAZA,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  SERVICE_SQUARE,
  SHRINE_ALTAR,
  TEA_STATION,
  VENT_ROOM,
  VILLA_SPECS,
  WELCOME_LANDMARKS,
  WORLD_LAYOUT,
  type WorldRect,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';
import { TOWN_MATERIALS, VENUE_COLORS, VENUE_SHADOW, darken, lighten, outlineOf } from './venue-palette';
import { PLAZA_LAMP_COUNT, venueLights } from './venue-lights';
import { bannerSway, leafAlpha, leafX, leafY, neonPulse, seedUnit, torchFlicker, waterGlint } from './venue-motion';

type TextureFactory = Application['renderer'];

/**
 * 场所第二层：地面氛围 + 檐下小件 + 焦点光。
 *
 * 为什么不并进各 View：赌场、诊所、擂台各自已经画了自己的主体家具，
 * 但**地面氛围**（光池、收边、落地细节）与**灯位**是全场统一的一件事，
 * 散在各处又会重演「每处各写一份十六进制」的老问题。
 * 因此这一层只做三件事：
 *
 * 1. 地面氛围：低透明度色池 + 收边 + 落地小物，全部进 `base`（永远在角色脚下）；
 * 2. 檐下小件：贴墙挂件与角标，走 `depth.add(脚底 y)`，可被角色遮挡；
 * 3. 焦点光：每处 1–2 盏，交给 `renderer` 注册进光图。
 *
 * 纪律见 `.codebuddy/skills/pixel-venue-polish/`：描边取本体色相压暗、
 * 明度只留两三档、`?venue=0` 可整层关掉。
 */

export class VenueArt {
  /** 光位集中在 `venue-lights.ts`：纯数据、可单测预算，这里只负责转交光图 */
  readonly lights: LightSpec[] = venueLights();
  private readonly roots: Container[] = [];
  /**
   * 光池目标层：地面被灯照出来的那一圈暖色。
   *
   * 单开一层是为了 `?light=0` 能**整体退场**——关掉柔光却还留着一地暖椭圆，
   * 看起来像「灯灭了但地还在发光」。它是纯表现，所以不进 `flat`、不进排序层。
   */
  private glow?: Graphics;

  /**
   * 发泄室警戒光：残血变橙、倒下变灰，两层 Graphics 二选一。
   *
   * 不新增 `LightSpec`（预算 64 盏已经很紧）：警戒光只在房间四沿画一圈硬边色带，
   * 亮度靠 alpha 呼吸，关掉光图也还在——「里面那位快不行了」不该依赖柔光层。
   */
  private alertWarm?: Graphics;
  private alertDead?: Graphics;
  private alertTier: 0 | 1 | 2 = 0;
  /** 呼吸相位种子：与房间坐标绑定，重进场景不会跳相 */
  private readonly alertSeed = (VENT_ROOM.x * 7 + VENT_ROOM.y) | 0;

  /**
   * `options.light` 对应 `?light=0`：关掉时光池整层不挂进场景（与柔光层同一时刻退场）。
   */
  build(depth: DepthSink, base: Container, options: { light?: boolean } = {}): void {
    const flat = new Graphics();
    const glow = new Graphics();
    this.glow = glow;

    this.paintNeonStripApron(flat);
    this.paintClinicApron(flat);
    this.paintApartmentDoors(flat);
    this.paintApartmentGarden(flat);
    this.paintVillaGardens(flat);
    this.paintPlazaGround(flat);
    this.paintTeaAndShrine(flat);
    this.paintLakeShore(flat);
    this.paintParkGround(flat);
    // ADR-0097：五区街面收边、发泄室橡胶地
    this.paintDistrictStreets(flat);
    // 门前过渡（纯渲染）：拱门迎宾毯、企业楼走廊。
    // 全部画进同一张 flat（永远在角色脚下），不登记碰撞、不新增显示对象。
    this.paintArchThreshold(flat);
    this.paintCompanyCorridor(flat);
    this.paintVentRoom(flat);

    this.glow = undefined;
    base.addChild(flat);
    // 光池在铺装之上、角色之下：关灯时整层不挂进场景，画面回到纯平涂
    if (options.light !== false) base.addChild(glow);
    this.buildVentAlert(base);

    this.depthApartmentDoors(depth);
    this.depthVillaGardens(depth);
    // 建筑外立面：檐口色带 + 用途徽记。扫一眼墙面就知道里头是干什么的
    this.depthFacades(depth);
  }

  /**
   * 光池：地面提亮不靠灯，靠一层极淡的暖色，省一盏灯的位置。
   *
   * 落笔目标由 `this.glow` 决定（构造期指向独立的光池层），
   * 让「地面光池」与「灯具本身」能被同一个开关一起关掉。
   */
  private pool(g: Graphics, cx: number, cy: number, rx: number, ry: number, color: number): void {
    const target = this.glow ?? g;
    target.ellipse(cx, cy, rx, ry).fill({ color, alpha: 0.13 });
    target.ellipse(cx, cy, rx * 0.62, ry * 0.62).fill({ color, alpha: 0.1 });
  }

  /**
   * 建筑外立面：南墙上一道 12px 的檐口色带 + 一枚用途徽记。
   *
   * 为什么挂在南墙而不是「屋顶」：这套正交视角里唯一看得见的是朝向镜头的南立面，
   * 北缘之上是可行走草地，在那边画天际线会变成浮在空中的剪影。
   * 深度键取南墙线（`rect.y + rect.h`）：站在墙里的人被檐口挡住，站在门外的人挡住檐口。
   *
   * 只有**真的有南墙**的房间才画：工作区是开放平面（没有墙可依），
   * 在它南缘画一条色带会凭空造出一堵墙。
   */
  private depthFacades(depth: DepthSink): void {
    for (const building of WORLD_LAYOUT.buildings) {
      const profile = FACADE_PROFILES[building.name];
      if (!profile) continue;
      const { rect } = building;
      const segments = this.southWallSegments(rect);
      if (segments.length === 0) continue;
      const root = new Container();
      root.position.set(rect.x, rect.y + rect.h);
      const g = new Graphics();
      // 檐口：压在墙体上沿之外 2px，读起来是「屋檐压在墙上」
      g.rect(-2, -14, rect.w + 4, 15).fill(outlineOf(profile.eave));
      g.rect(0, -13, rect.w, 11).fill(profile.eave);
      g.rect(0, -13, rect.w, 1).fill(lighten(profile.eave, 0.42));
      g.rect(0, -4, rect.w, 2).fill(darken(profile.eave, 0.62));
      // 徽记只画在最长的一段墙上：门洞把南墙劈成两段时，
      // 两边各挂一枚会读成「两间房」，而它们其实是同一间。
      let widest = segments[0]!;
      for (const segment of segments) {
        if (segment.to - segment.from > widest.to - widest.from) widest = segment;
      }
      paintFacadeEmblem(g, profile, widest.from - rect.x, widest.to - rect.x);
      root.addChild(g);
      depth.add(rect.y + rect.h, root);
      this.roots.push(root);
    }
  }

  /** 南墙上的连续墙段（本地 x 区间）：门洞、楼梯口天然成为缺口 */
  private southWallSegments(rect: WorldRect): Array<{ from: number; to: number }> {
    const southY = rect.y + rect.h;
    const walls = WORLD_LAYOUT.solids
      .filter(
        (solid) =>
          solid.kind === 'wall' &&
          Math.abs(solid.y + solid.h - southY) < 4 &&
          solid.x >= rect.x - 2 &&
          solid.x + solid.w <= rect.x + rect.w + 2,
      )
      .sort((left, right) => left.x - right.x);
    return walls.map((wall) => ({ from: wall.x, to: wall.x + wall.w }));
  }

  /** 老板血量档位：0 正常 / 1 残血（<30%）/ 2 倒下 */
  setBossAlert(tier: 0 | 1 | 2): void {
    if (tier === this.alertTier) return;
    this.alertTier = tier;
    if (tier === 0 && this.alertWarm) this.alertWarm.visible = false;
    if (tier === 0 && this.alertDead) this.alertDead.visible = false;
  }

  /** 每帧推进：只有残血 / 倒下时写一次 alpha，其余时间直接返回 */
  update(nowMs: number): void {
    const warm = this.alertWarm;
    const dead = this.alertDead;
    if (!warm || !dead || this.alertTier === 0) return;
    if (this.alertTier === 2) {
      if (warm.visible) warm.visible = false;
      if (!dead.visible) dead.visible = true;
      // 倒下之后光也慢慢弱下去：房门里该是「结束了」的灰，不是烟花的灰
      dead.alpha = 0.16 + 0.05 * torchFlicker(this.alertSeed + 13, nowMs);
      return;
    }
    if (dead.visible) dead.visible = false;
    if (!warm.visible) warm.visible = true;
    warm.alpha = 0.14 + 0.12 * torchFlicker(this.alertSeed, nowMs);
  }

  /**
   * 房间四沿的一圈微光：上下两条 + 左右两条，贴在地面外沿。
   * ADR-0103 之后发泄室没有外墙，这条色带就是它唯一的边界表达。
   */
  private buildVentAlert(base: Container): void {
    const { x, y, w, h } = VENT_ROOM;
    const band = 4;
    const draw = (color: number): Graphics => {
      const g = new Graphics();
      g.rect(x, y, w, band).fill({ color, alpha: 0.9 });
      g.rect(x, y + h - band, w, band).fill({ color, alpha: 0.8 });
      g.rect(x, y, band, h).fill({ color, alpha: 0.7 });
      g.rect(x + w - band, y, band, h).fill({ color, alpha: 0.7 });
      // 四角各压一段更亮的角标，房间边界在暗地里也读得出来
      for (const [cx, cy] of [
        [x, y],
        [x + w - 10, y],
        [x, y + h - 10],
        [x + w - 10, y + h - 10],
      ] as const) {
        g.rect(cx, cy, 10, band).fill({ color, alpha: 1 });
      }
      g.visible = false;
      base.addChild(g);
      return g;
    };
    this.alertWarm = draw(0xffa24a);
    this.alertDead = draw(0x8a8f96);
  }

  /** 五区街面：公共铺装的浅色收边 */
  private paintDistrictStreets(g: Graphics): void {
    const street = VENUE_COLORS.street;
    for (const rect of [AMUSEMENT_STREET, SERVICE_SQUARE, LIVING_AVENUE, COMPANY_FORECOURT]) {
      g.rect(rect.x, rect.y, rect.w, 2).fill({ color: street.seam, alpha: 0.3 });
      g.rect(rect.x, rect.y + rect.h - 2, rect.w, 2).fill({ color: street.seam, alpha: 0.24 });
      g.rect(rect.x, rect.y, 2, rect.h).fill({ color: street.seam, alpha: 0.18 });
      g.rect(rect.x + rect.w - 2, rect.y, 2, rect.h).fill({ color: street.seam, alpha: 0.18 });
    }
  }

  /**
   * 迎宾拱门前的迎宾毯（纯渲染）。
   *
   * 拱门跨在南向主路（半宽 56）上，地毯只铺中间 112 宽的车道，
   * 两根立柱下方只留接触阴影——柱子底下铺毯会读成「毯子长在柱子里」。
   * 配色取 `VENUE_COLORS.arch`（奶油底 + 薄荷边），与拱门招牌同族，
   * 不与广场的暖黄石砖抢色。
   */
  private paintArchThreshold(g: Graphics): void {
    const arch = WELCOME_LANDMARKS.arch;
    const c = VENUE_COLORS.arch;
    const half = 56;
    // 从拱门线往北 28px 一直铺到广场南缘（`PLAZA_CENTER.y + PLAZA_RADIUS`），
    // 于是「广场石砖 → 迎宾毯 → 南向主路土路」三段在像素上首尾相接
    const top = arch.y - 28;
    const height = 76;
    for (const x of [arch.x - arch.width / 2 + 19, arch.x + arch.width / 2 - 19]) {
      g.ellipse(x, arch.y + 2, 22, 7).fill({ color: VENUE_SHADOW, alpha: 0.18 });
    }
    // 毯面：奶油底 + 一圈压暗收边
    g.rect(arch.x - half - 2, top - 2, half * 2 + 4, height + 4).fill({ color: darken(c.main, 0.72), alpha: 0.9 });
    g.rect(arch.x - half, top, half * 2, height).fill(c.main);
    // 薄荷双线：只压左右两条长边，中间留给「打卡线」
    g.rect(arch.x - half, top, 2, height).fill({ color: c.accent, alpha: 0.75 });
    g.rect(arch.x + half - 2, top, 2, height).fill({ color: c.accent, alpha: 0.75 });
    // 打卡线：与拱门底边同一条线，站上去就是「在门口打卡」
    g.rect(arch.x - half + 4, arch.y - 1, half * 2 - 8, 2).fill({ color: c.accent, alpha: 0.45 });
    // 南端三段石阶：毯口最后 9px 逐级收窄，接到南向主路的土路上
    const stepTop = top + height - 9;
    for (let i = 0; i < 3; i += 1) {
      g.rect(arch.x - half + 2 + i * 6, stepTop + i * 3, half * 2 - 4 - i * 12, 2).fill({
        color: TOWN_MATERIALS.stone,
        alpha: 0.34 - i * 0.08,
      });
    }
  }

  /**
   * 企业楼东侧走廊地面 + 中线引导（纯渲染）。
   *
   * 走廊（`COMPANY_CORRIDOR`）既不是 `buildings` 也不是 `paved`，此前露出的是草地：
   * 于是「从大门进来」这一段在视觉上没有地板。这里补一层石青地面与 12px 木色走道，
   * 再用暖白中线说清动线。
   *
   * ADR-0103 之后企业楼是开放平面：西端不再有封头墙，地板铺满整条走廊；
   * 会议室与发泄室也没有门洞了，原先指向门洞的两枚箭头一并删除。
   */
  private paintCompanyCorridor(g: Graphics): void {
    const corridor = COMPANY_CORRIDOR;
    const street = VENUE_COLORS.street;
    const wood = VENUE_COLORS.workroom;
    // 走廊地面：上下两条石青收边，中间 12px 木色走道（与工作区木地板同族）
    const x0 = corridor.x;
    const w = corridor.w;
    g.rect(x0, corridor.y, w, corridor.h).fill(street.main);
    g.rect(x0, corridor.y, w, 1).fill({ color: street.seam, alpha: 0.5 });
    g.rect(x0, corridor.y + corridor.h - 1, w, 1).fill({ color: street.seam, alpha: 0.4 });
    const laneTop = corridor.y + Math.round((corridor.h - 12) / 2);
    g.rect(x0, laneTop, w, 12).fill(wood.main);
    g.rect(x0, laneTop, w, 1).fill({ color: wood.alt, alpha: 0.8 });
    // 中线：2px 暖白 + 每 40px 一道节拍短横，读起来是「一条走道」而不是一块地毯
    const midY = corridor.y + corridor.h / 2 - 1;
    const line = { color: 0xfff3d0, alpha: 0.22 } as const;
    g.rect(x0 + 6, midY, w - 12, 2).fill(line);
    for (let x = x0 + 18; x < x0 + w - 18; x += 40) {
      g.rect(x, midY, 1, 2).fill({ color: 0xfff3d0, alpha: 0.34 });
    }
  }

  /** 发泄室：橡胶地 + 警示黄边 + 沙袋架阴影，进门一眼看出「这里是动手的地方」 */
  private paintVentRoom(g: Graphics): void {
    const c = VENUE_COLORS.vent;
    const mat = BOSS_ARENA;
    g.rect(mat.x, mat.y, mat.w, mat.h).fill({ color: c.main, alpha: 0.55 });
    g.rect(mat.x, mat.y, mat.w, 3).fill({ color: c.accent, alpha: 0.5 });
    g.rect(mat.x, mat.y + mat.h - 3, mat.w, 3).fill({ color: c.accent, alpha: 0.4 });
    // 防滑纹：每 24px 一道短竖线，只压在垫子上下两沿
    for (let x = mat.x + 16; x < mat.x + mat.w - 8; x += 24) {
      g.rect(x, mat.y + 8, 2, 6).fill({ color: c.seam, alpha: 0.4 });
      g.rect(x, mat.y + mat.h - 14, 2, 6).fill({ color: c.seam, alpha: 0.32 });
    }
    // 西侧沙袋架：三个矩形影子，读起来像挂着一排沙袋
    for (let i = 0; i < 3; i += 1) {
      g.rect(VENT_ROOM.x + 40 + i * 34, VENT_ROOM.y + 90, 26, 6).fill({ color: c.seam, alpha: 0.4 });
    }
    this.pool(g, VENT_ROOM.x + 150, VENT_ROOM.y + 130, 60, 28, c.accent);
    // ADR-0103：没有北墙之后不再有「门口」，警示条统一交给 `buildVentAlert` 的四沿色带
  }

  /** 构造期把挂件塞进 y 排序层：脚底 y 定层级，人走过去会被挡住 */
  private depthApartmentDoors(depth: DepthSink): void {
    for (const spec of APARTMENT_SPECS) {
      const root = new Container();
      root.position.set(spec.door.x, spec.door.y);
      const g = new Graphics();
      // 门廊壁灯：铁艺灯臂 + 两格暖窗
      g.rect(-1, -26, 2, 12).fill(darken(VENUE_COLORS.apartment.seam, 0.9));
      g.rect(-7, -38, 14, 10).fill(VENUE_COLORS.apartment.seam);
      g.rect(-6, -37, 12, 8).fill(VENUE_COLORS.apartment.accent);
      g.rect(-6, -37, 12, 2).fill(lighten(VENUE_COLORS.apartment.accent, 0.5));
      // 门牌：奶白底 + 绿色门号条
      g.rect(6, -30, 16, 9).fill(0xf6f1e6);
      g.rect(7, -29, 14, 7).fill(VENUE_COLORS.apartment.accent);
      g.rect(7, -29, 14, 1).fill(0xffffff);
      root.addChild(g);
      depth.add(spec.door.y, root);
      this.roots.push(root);
    }
  }

  private depthVillaGardens(depth: DepthSink): void {
    for (const spec of VILLA_SPECS) {
      const left = spec.rect.x + 14;
      const right = spec.rect.x + spec.rect.w - 14;
      const y = spec.rect.y + spec.rect.h - 10;
      for (const x of [left, right]) {
        const root = new Container();
        root.position.set(x, y);
        const g = new Graphics();
        // 花箱：木槽 + 三丛小花，花色取点缀绿的同色相提亮
        g.rect(-11, -10, 22, 10).fill(VENUE_COLORS.villas.seam);
        g.rect(-10, -10, 20, 3).fill(VENUE_COLORS.villas.alt);
        for (let i = 0; i < 3; i += 1) {
          const px = -7 + i * 7;
          g.rect(px, -16 - (i % 2) * 3, 3, 7 + (i % 2) * 3).fill(VENUE_COLORS.villas.accent);
          g.rect(px, -17 - (i % 2) * 3, 3, 2).fill(lighten(VENUE_COLORS.villas.accent, 0.45));
        }
        root.addChild(g);
        depth.add(y, root);
        this.roots.push(root);
      }
    }
  }

  /** 霓虹娱乐街北侧商业前广场：暗靛石板路面 + 粉青双道霓虹灯带与斑马线 */
  private paintNeonStripApron(g: Graphics): void {
    const c = VENUE_COLORS.neonStrip;
    const plaza = NEON_STRIP_PLAZA;
    g.rect(plaza.x, plaza.y, plaza.w, plaza.h).fill({ color: c.main, alpha: 0.72 });
    g.rect(plaza.x, plaza.y, plaza.w, 3).fill({ color: c.accent, alpha: 0.7 });
    g.rect(plaza.x, plaza.y + plaza.h - 3, plaza.w, 3).fill({ color: c.glow, alpha: 0.6 });
    for (let x = plaza.x + 28; x < plaza.x + plaza.w - 20; x += 56) {
      g.rect(x, plaza.y + 18, 22, 24).fill({ color: c.alt, alpha: 0.55 });
    }
    const club = VILLA_SPECS[2];
    if (club) this.pool(g, club.gate.x, club.gate.y + 12, 130, 56, c.accent);
    const garage = VILLA_SPECS[3];
    if (garage) this.pool(g, garage.gate.x, garage.gate.y + 10, 96, 44, c.glow);
  }

  private paintClinicApron(g: Graphics): void {
    const c = VENUE_COLORS.clinic;
    this.pool(g, CLINIC_RECT.x + CLINIC_RECT.w / 2, CLINIC_RECT.y + CLINIC_RECT.h - 30, 110, 52, c.glow);
    // 西门外救护车位：两条黄线 + 中间一个红十字符，指向明显但不挡路
    const apron = CLINIC_ACCESS_PAVING;
    g.rect(apron.x + 12, apron.y + 4, 26, 2).fill({ color: 0xe8c47a, alpha: 0.55 });
    g.rect(apron.x + 12, apron.y + apron.h - 6, 26, 2).fill({ color: 0xe8c47a, alpha: 0.55 });
    g.rect(apron.x + 44, apron.y + 8, 10, 3).fill({ color: c.accent, alpha: 0.5 });
    g.rect(apron.x + 47, apron.y + 5, 4, 9).fill({ color: c.accent, alpha: 0.5 });
  }

  private paintApartmentDoors(g: Graphics): void {
    const c = VENUE_COLORS.apartment;
    for (const spec of APARTMENT_SPECS) {
      this.pool(g, spec.door.x, spec.door.y + 4, 30, 16, c.glow);
      // 门阶石：两块暖灰踏步
      g.rect(spec.door.x - 16, spec.door.y - 2, 32, 6).fill({ color: c.seam, alpha: 0.55 });
      g.rect(spec.door.x - 18, spec.door.y + 4, 36, 4).fill({ color: c.alt, alpha: 0.5 });
    }
  }

  /**
   * 公寓门前口袋花园（ADR-0101）：四面低石沿 + 夜里石径中段的一段烘焙暖光。
   *
   * 石沿画在草地上，纯装饰、零碰撞；南北两缘在石板小径处各留 40px 缺口，
   * 「从门口一路走到生活大街」在视觉上不撞墙。夜里不添灯，用 `pool()` 提亮地面。
   */
  private paintApartmentGarden(g: Graphics): void {
    const c = VENUE_COLORS.apartment;
    const garden = APARTMENT_GARDEN;
    const path = APARTMENT_GARDEN_PATH;
    const edge = 6;
    const gapHalf = 20;
    const band = (x: number, y: number, w: number, h: number): void => {
      if (w <= 0 || h <= 0) return;
      g.rect(x, y, w, h).fill(TOWN_MATERIALS.stoneDark);
      g.rect(x, y, w, Math.max(1, h - 2)).fill(TOWN_MATERIALS.stone);
      g.rect(x, y, w, 1).fill(TOWN_MATERIALS.stoneLight);
    };

    // 南北两缘：石径两侧各一段，缺口正好 40px
    const westTo = path.x - gapHalf - garden.x;
    const eastFrom = path.x + path.w + gapHalf;
    band(garden.x, garden.y, westTo, edge);
    band(eastFrom, garden.y, garden.x + garden.w - eastFrom, edge);
    band(garden.x, garden.y + garden.h - edge, westTo, edge);
    band(eastFrom, garden.y + garden.h - edge, garden.x + garden.w - eastFrom, edge);
    // 东西两沿：整条通到两头，和南北缘在转角叠一层
    band(garden.x, garden.y, edge, garden.h);
    band(garden.x + garden.w - edge, garden.y, edge, garden.h);

    // 夜里石径中段的一圈暖光：不新增灯位，靠地面提亮
    this.pool(g, path.x + path.w / 2, garden.y + garden.h * 0.58, 46, 20, c.glow);
  }

  private paintVillaGardens(g: Graphics): void {
    const c = VENUE_COLORS.villas;
    for (const spec of VILLA_SPECS) {
      const pathX = spec.gate.x;
      const top = spec.house.y + spec.house.h;
      // 院内小径：从屋门到院门，三块错缝石板
      for (let i = 0; i < 3; i += 1) {
        const y = top + 14 + i * 22;
        g.rect(pathX - 13 + (i % 2) * 3, y, 26, 12).fill({ color: c.seam, alpha: 0.45 });
        g.rect(pathX - 13 + (i % 2) * 3, y, 26, 2).fill({ color: c.alt, alpha: 0.5 });
      }
      this.pool(g, pathX, spec.gate.y - 16, 26, 14, c.glow);
    }
  }

  private paintPlazaGround(g: Graphics): void {
    const c = VENUE_COLORS.plaza;
    // 广场地灯：光池跟灯位共用同一份角度，省一盏灯的位置就靠提亮地面代替
    for (let i = 0; i < PLAZA_LAMP_COUNT; i += 1) {
      const angle = (i / PLAZA_LAMP_COUNT) * Math.PI * 2 + Math.PI / 8;
      const x = PLAZA_CENTER.x + Math.cos(angle) * (PLAZA_RADIUS - 36);
      const y = PLAZA_CENTER.y + Math.sin(angle) * (PLAZA_RADIUS - 36) * 0.62;
      this.pool(g, x, y, 26, 16, c.accent);
    }
    // 内圈一道极淡的同心石纹，打破一整块灰的读感
    g.ellipse(PLAZA_CENTER.x, PLAZA_CENTER.y, PLAZA_RADIUS * 0.52, PLAZA_RADIUS * 0.36)
      .stroke({ color: c.seam, width: 2, alpha: 0.22 });
  }

  private paintTeaAndShrine(g: Graphics): void {
    const tea = VENUE_COLORS.tea;
    this.pool(g, TEA_STATION.x + TEA_STATION.width / 2, TEA_STATION.y + TEA_STATION.height + 10, 30, 16, tea.glow);
    // 茶台地面的茶渍：两圈深浅不一的环
    g.ellipse(TEA_STATION.x + 12, TEA_STATION.y + TEA_STATION.height + 22, 9, 5)
      .fill({ color: tea.seam, alpha: 0.3 });
    g.ellipse(TEA_STATION.x + 32, TEA_STATION.y + TEA_STATION.height + 30, 6, 3)
      .fill({ color: tea.seam, alpha: 0.22 });

    const shrine = VENUE_COLORS.shrine;
    this.pool(g, SHRINE_ALTAR.x + SHRINE_ALTAR.width / 2, SHRINE_ALTAR.y + SHRINE_ALTAR.height + 16, 34, 18, shrine.glow);
    // 供案前的蜡痕：三点暖白，暗示长期有人上香
    for (let i = 0; i < 3; i += 1) {
      g.ellipse(SHRINE_ALTAR.x + 12 + i * 16, SHRINE_ALTAR.y + SHRINE_ALTAR.height + 26, 3, 2)
        .fill({ color: 0xf2e7cd, alpha: 0.35 });
    }
  }

  private paintLakeShore(g: Graphics): void {
    const c = VENUE_COLORS.lake;
    for (const lake of WORLD_LAYOUT.lakes) {
      drawShoreRocks(g, lake.rect, lake.points, c.seam);
    }
  }

  private paintParkGround(g: Graphics): void {
    const c = VENUE_COLORS.park;
    // 门口一块迎宾圆垫：奶油色双环，和薄荷地胶拉开一档
    this.pool(g, AMUSEMENT_PARK.x + AMUSEMENT_PARK.w / 2, AMUSEMENT_PARK.y + AMUSEMENT_PARK.h - 24, 62, 26, c.accent);
  }
}

/** 建筑外立面的用途徽记：只画「远远一眼就能分辨」的那一件东西 */
type FacadeEmblem = 'meeting' | 'vent' | 'restroom' | 'cell' | 'lounge' | 'cinema';

interface FacadeProfile {
  /** 檐口色（取该场所地面主色的同族，不与相邻建筑撞色） */
  readonly eave: number;
  readonly emblem: FacadeEmblem;
}

/**
 * 谁有外立面徽记：只登记「有南墙、又需要远距离辨识」的房间。
 * ADR-0103 之后企业楼与生活区都是开放平面，只有卫生间与小黑屋还留南墙；
 * 公寓/赌场/别墅各自有自己的 View，不在这里。
 */
const FACADE_PROFILES: Record<string, FacadeProfile> = {
  卫生间: { eave: VENUE_COLORS.restroom.alt, emblem: 'restroom' },
  小黑屋: { eave: VENUE_COLORS.cell.main, emblem: 'cell' },
};

/**
 * 檐口上的一枚用途徽记。
 *
 * 全部压在同一段 11px 高的带子里、取两段墙中较长的一段居中：
 * 门洞两侧各一枚时读起来像「门牌」，只剩一段时也不会飘到门外。
 */
function paintFacadeEmblem(g: Graphics, profile: FacadeProfile, from: number, to: number): void {
  if (to - from < 40) return;
  const cx = Math.round((from + to) / 2);
  const top = -12;
  switch (profile.emblem) {
    case 'meeting': {
      // 投影幕 + 两侧筒灯：会议室最好认的是那块亮幕
      g.rect(cx - 11, top + 1, 22, 9).fill(0xfdfefe);
      g.rect(cx - 11, top + 1, 22, 2).fill(0xffffff);
      g.rect(cx - 11, top + 9, 22, 1).fill(0xbfd0dc);
      g.rect(cx - 8, top + 4, 12, 1).fill(0xc4d0dc);
      for (const dx of [-16, 16]) {
        g.rect(cx + dx - 1, top, 2, 3).fill(0xfff0b8);
      }
      return;
    }
    case 'vent': {
      // 黄黑警示斜纹：一眼就是「可以动手的地方」
      g.rect(cx - 15, top + 1, 30, 9).fill(TOWN_MATERIALS.iron);
      for (let i = 0; i < 8; i += 1) {
        g.rect(cx - 14 + i * 4, top + 1 + (i % 2), 2, 8 - (i % 2)).fill({ color: VENUE_COLORS.vent.accent, alpha: 0.9 });
      }
      return;
    }
    case 'restroom': {
      // 蓝 / 粉两块小牌：男女图标在像素尺度下的最小可读写法
      g.rect(cx - 15, top + 1, 30, 9).fill(0xe3edf3);
      g.rect(cx - 13, top + 2, 11, 7).fill(0x9fd3ff);
      g.rect(cx + 2, top + 2, 11, 7).fill(0xffb59e);
      g.rect(cx - 11, top + 4, 3, 4).fill(0x2a3142);
      g.rect(cx + 4, top + 4, 3, 4).fill(0x2a3142);
      return;
    }
    case 'cell': {
      // 铁栅窗 + 红叉：小黑屋只留这两样
      for (let i = 0; i < 4; i += 1) g.rect(cx - 13 + i * 4, top + 1, 1, 8).fill(0x2a3142);
      g.rect(cx - 14, top, 17, 1).fill(0x545861);
      g.rect(cx - 14, top + 9, 17, 1).fill(0x545861);
      g.rect(cx + 6, top + 2, 8, 7).fill(0xc9503f);
      g.rect(cx + 7, top + 3, 6, 1).fill(0xf4efe2);
      g.rect(cx + 7, top + 7, 6, 1).fill(0xf4efe2);
      g.rect(cx + 8, top + 4, 4, 3).fill(0xf4efe2);
      g.rect(cx + 9, top + 4, 2, 3).fill(0xc9503f);
      return;
    }
    case 'lounge': {
      // 晾衣绳 + 两件小衣：宿舍区的生活感靠这一条
      g.rect(cx - 16, top + 2, 32, 1).fill(0x8a6446);
      for (const [dx, color] of [
        [-9, 0x9fd3ff],
        [1, 0xffe49a],
      ] as const) {
        g.rect(cx + dx, top + 3, 6, 6).fill(color);
        g.rect(cx + dx, top + 3, 1, 6).fill(lighten(color, 0.4));
      }
      return;
    }
    case 'cinema': {
      // 紫色霓虹条 + 星点：影音室的招牌色与别处都不撞
      g.rect(cx - 15, top + 2, 30, 6).fill(VENUE_COLORS.theater.accent);
      g.rect(cx - 15, top + 2, 30, 1).fill(lighten(VENUE_COLORS.theater.accent, 0.5));
      g.rect(cx - 15, top + 7, 30, 1).fill(darken(VENUE_COLORS.theater.accent, 0.55));
      for (let i = 0; i < 3; i += 1) g.rect(cx - 8 + i * 8, top + 4, 1, 2).fill(0x232833);
      return;
    }
    default:
      return;
  }
}

/** 岸石：沿多边形顶点内侧两档各丢一小块，读起来像被水磨过的石头 */
function drawShoreRocks(g: Graphics, rect: WorldRect, points: ReadonlyArray<readonly [number, number]>, color: number): void {
  const step = Math.max(1, Math.floor(points.length / 8));
  for (let i = 0; i < points.length; i += step) {
    const point = points[i]!;
    const towardX = rect.x + rect.w / 2;
    const towardY = rect.y + rect.h / 2;
    const nx = point[0] + (towardX - point[0]) * 0.08;
    const ny = point[1] + (towardY - point[1]) * 0.08;
    g.rect(nx - 3, ny - 2, 7, 4).fill({ color, alpha: 0.35 });
    g.rect(nx - 2, ny - 3, 5, 2).fill({ color: 0xd8cfbb, alpha: 0.4 });
  }
}

/**
 * 场所微动效层：落叶、水光、霓虹呼吸。
 *
 * 只有一张容器，挂在 world 里、y 排序层之上——这些元素本来就该压在角色和建筑前面
 * （落叶飘过脚背、水光在岸上闪），所以不参与深度排序。
 */
export class VenueFx {
  readonly container = new Container();
  private readonly leaves: { sprite: Sprite; seed: number; x: number; y: number; span: number }[] = [];
  private readonly glints: { sprite: Sprite; seed: number }[] = [];
  private readonly neon: Sprite;
  private readonly textures: Texture[] = [];

  constructor(renderer: TextureFactory) {
    const leaf = bake(renderer, (g) => {
      g.rect(0, 1, 4, 2).fill(0xffffff);
      g.rect(1, 0, 2, 4).fill(0xffffff);
    });
    const glint = bake(renderer, (g) => {
      g.rect(0, 0, 6, 1).fill(0xffffff);
      g.rect(1, 1, 4, 1).fill({ color: 0xffffff, alpha: 0.6 });
    });
    const glow = bake(renderer, (g) => {
      g.ellipse(17, 6, 16, 5).fill({ color: 0xffffff, alpha: 0.5 });
      g.ellipse(17, 6, 10, 3).fill(0xffffff);
    });
    this.textures.push(leaf, glint, glow);

    const leafTints = [0xd8a04a, 0xa8724a, 0xe8c47a];
    // 广场与公园的落叶：各 14 片，锚点居中
    for (let i = 0; i < 28; i += 1) {
      const sprite = new Sprite(leaf);
      sprite.anchor.set(0.5, 0.5);
      sprite.tint = leafTints[i % leafTints.length]!;
      const seed = i * 37 + 11;
      const inPlaza = i < 14;
      const angle = seedUnit(seed) * Math.PI * 2;
      const radius = (inPlaza ? PLAZA_RADIUS - 40 : 0) * (0.35 + seedUnit(seed + 3) * 0.6);
      const x = inPlaza
        ? PLAZA_CENTER.x + Math.cos(angle) * radius
        : AMUSEMENT_PARK.x + 40 + seedUnit(seed + 7) * (AMUSEMENT_PARK.w - 80);
      const y = inPlaza
        ? PLAZA_CENTER.y + Math.sin(angle) * radius * 0.62
        : AMUSEMENT_PARK.y + 40 + seedUnit(seed + 9) * (AMUSEMENT_PARK.h - 80);
      sprite.position.set(x, y);
      sprite.visible = false;
      this.container.addChild(sprite);
      this.leaves.push({ sprite, seed, x, y, span: 18 + seedUnit(seed + 1) * 22 });
    }

    // 湖面反光：每个湖 8 点，落在湖心六成范围内
    let glintSeed = 101;
    for (const lake of WORLD_LAYOUT.lakes) {
      for (let i = 0; i < 8; i += 1) {
        const sprite = new Sprite(glint);
        sprite.anchor.set(0.5, 0.5);
        sprite.tint = VENUE_COLORS.lake.accent;
        const gx = lake.rect.x + lake.rect.w * (0.2 + seedUnit(glintSeed) * 0.6);
        const gy = lake.rect.y + lake.rect.h * (0.2 + seedUnit(glintSeed + 5) * 0.6);
        sprite.position.set(gx, gy);
        this.container.addChild(sprite);
        this.glints.push({ sprite, seed: glintSeed });
        glintSeed += 17;
      }
    }

    const club = VILLA_SPECS[2];
    this.neon = new Sprite(glow);
    this.neon.anchor.set(0.5, 0.5);
    this.neon.tint = VENUE_COLORS.neonStrip.accent;
    this.neon.position.set(club ? club.gate.x : 2760, club ? club.rect.y - 16 : 2624);
    this.container.addChild(this.neon);
  }

  /** 每帧推进：离屏粒子跳过波形计算并隐藏，同屏内才写属性 */
  update(
    nowMs: number,
    bounds?: { minX: number; minY: number; maxX: number; maxY: number },
  ): void {
    const pad = 48;
    const minX = bounds ? bounds.minX - pad : Number.NEGATIVE_INFINITY;
    const maxX = bounds ? bounds.maxX + pad : Number.POSITIVE_INFINITY;
    const minY = bounds ? bounds.minY - pad : Number.NEGATIVE_INFINITY;
    const maxY = bounds ? bounds.maxY + pad : Number.POSITIVE_INFINITY;

    for (const leaf of this.leaves) {
      const inView = leaf.x >= minX && leaf.x <= maxX && leaf.y >= minY && leaf.y <= maxY;
      if (!inView) {
        leaf.sprite.visible = false;
        continue;
      }
      leaf.sprite.visible = true;
      leaf.sprite.x = leaf.x + leafX(leaf.seed, nowMs, leaf.span);
      leaf.sprite.y = leaf.y + leafY(leaf.seed, nowMs, 7);
      leaf.sprite.alpha = leafAlpha(leaf.seed, nowMs);
      leaf.sprite.rotation = bannerSway(leaf.seed, nowMs) * 0.35;
    }
    for (const glint of this.glints) {
      const gx = glint.sprite.position.x;
      const gy = glint.sprite.position.y;
      const inView = gx >= minX && gx <= maxX && gy >= minY && gy <= maxY;
      if (!inView) {
        glint.sprite.visible = false;
        continue;
      }
      glint.sprite.visible = true;
      glint.sprite.alpha = 0.18 + waterGlint(glint.seed, nowMs) * 0.62;
      glint.sprite.scale.x = 0.7 + waterGlint(glint.seed + 13, nowMs) * 0.6;
    }
    const nx = this.neon.position.x;
    const ny = this.neon.position.y;
    const neonInView = nx >= minX && nx <= maxX && ny >= minY && ny <= maxY;
    this.neon.visible = neonInView;
    if (neonInView) {
      this.neon.alpha = 0.35 + neonPulse(7, nowMs) * 0.5;
    }
  }

  destroy(): void {
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
    this.leaves.length = 0;
    this.glints.length = 0;
    this.container.destroy({ children: true });
  }
}

/** 构造期小贴图：nearest 采样，和 terrain 的 `bake` 同一套参数 */
function bake(renderer: TextureFactory, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    resolution: 1,
    antialias: false,
    textureSourceOptions: { scaleMode: 'nearest' },
  });
  g.destroy();
  return texture;
}
