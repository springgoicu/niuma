'use client';

import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';
import {
  AMUSEMENT_PARK,
  AMUSEMENT_STREET,
  APARTMENT_SPECS,
  BOSS_ARENA,
  CLINIC_ACCESS_PAVING,
  CLINIC_RECT,
  COMPANY_FORECOURT,
  DICE_HALL,
  DICE_HALL_CENTER,
  DISTRICTS,
  LIVING_AVENUE,
  MOPING_PAVILION,
  PAVILION_CENTER,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  RING_ARENA,
  RING_BENCHES,
  SERVICE_SQUARE,
  SHRINE_ALTAR,
  TEA_STATION,
  VENT_ROOM,
  VILLA_SPECS,
  WORLD_LAYOUT,
  type WorldRect,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';
import { TOWN_MATERIALS, VENUE_COLORS, darken, lighten } from './venue-palette';
import { PLAZA_LAMP_COUNT, venueLights } from './venue-lights';
import { bannerSway, leafAlpha, leafX, leafY, neonPulse, seedUnit, waterGlint } from './venue-motion';

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

/** 光池：地面提亮不靠灯，靠一层极淡的暖色，省一盏灯的位置 */
function pool(g: Graphics, cx: number, cy: number, rx: number, ry: number, color: number): void {
  g.ellipse(cx, cy, rx, ry).fill({ color, alpha: 0.13 });
  g.ellipse(cx, cy, rx * 0.62, ry * 0.62).fill({ color, alpha: 0.1 });
}

export class VenueArt {
  /** 光位集中在 `venue-lights.ts`：纯数据、可单测预算，这里只负责转交光图 */
  readonly lights: LightSpec[] = venueLights();
  private readonly roots: Container[] = [];

  build(depth: DepthSink, base: Container): void {
    const flat = new Graphics();

    this.paintDiceHallFloor(flat);
    this.paintClinicApron(flat);
    this.paintRingApron(flat);
    this.paintApartmentDoors(flat);
    this.paintVillaGardens(flat);
    this.paintPlazaGround(flat);
    this.paintTeaAndShrine(flat);
    this.paintLakeShore(flat);
    this.paintParkGround(flat);
    // ADR-0097：五区街面收边、发泄室橡胶地与五座区门
    this.paintDistrictStreets(flat);
    this.paintVentRoom(flat);

    base.addChild(flat);

    this.depthApartmentDoors(depth);
    this.depthVillaGardens(depth);
    this.depthRingCorners(depth);
    this.depthDistrictGates(depth);
  }

  /** 五座区门：木构门架 + 区色匾额，夜里各有一盏低强度门灯（光位在 venue-lights） */
  private depthDistrictGates(depth: DepthSink): void {
    for (const district of DISTRICTS) {
      const root = new Container();
      root.position.set(district.gate.x, district.gate.y);
      const g = new Graphics();
      // 两根门柱 + 横枋：与牌坊同一套木料，不另起色系
      g.rect(-46, -72, 6, 72).fill(TOWN_MATERIALS.timberDark);
      g.rect(40, -72, 6, 72).fill(TOWN_MATERIALS.timberDark);
      g.rect(-46, -72, 2, 72).fill(TOWN_MATERIALS.timberLight);
      g.rect(40, -72, 2, 72).fill(TOWN_MATERIALS.timberLight);
      g.rect(-54, -88, 108, 16).fill(TOWN_MATERIALS.timber);
      g.rect(-54, -88, 108, 2).fill(TOWN_MATERIALS.timberLight);
      // 匾额：区色底 + 奶白描边，远看就知道是哪个区的门
      g.rect(-30, -84, 60, 10).fill(district.color);
      g.rect(-30, -84, 60, 1).fill(lighten(district.color, 0.5));
      g.rect(-30, -75, 60, 1).fill(darken(district.color, 0.7));
      root.addChild(g);
      depth.add(district.gate.y, root);
      this.roots.push(root);
    }
  }

  /** 五区街面：公共铺装的浅色收边 + 区门前一小块区色门垫 */
  private paintDistrictStreets(g: Graphics): void {
    const street = VENUE_COLORS.street;
    for (const rect of [AMUSEMENT_STREET, SERVICE_SQUARE, LIVING_AVENUE, COMPANY_FORECOURT]) {
      g.rect(rect.x, rect.y, rect.w, 2).fill({ color: street.seam, alpha: 0.3 });
      g.rect(rect.x, rect.y + rect.h - 2, rect.w, 2).fill({ color: street.seam, alpha: 0.24 });
      g.rect(rect.x, rect.y, 2, rect.h).fill({ color: street.seam, alpha: 0.18 });
      g.rect(rect.x + rect.w - 2, rect.y, 2, rect.h).fill({ color: street.seam, alpha: 0.18 });
    }
    for (const district of DISTRICTS) {
      pool(g, district.gate.x, district.gate.y + 10, 46, 20, district.color);
      g.rect(district.gate.x - 34, district.gate.y - 2, 68, 3).fill({ color: district.color, alpha: 0.45 });
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
    pool(g, VENT_ROOM.x + 150, VENT_ROOM.y + 130, 60, 28, c.accent);
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

  private depthRingCorners(depth: DepthSink): void {
    const corners = [
      { x: RING_ARENA.x + 6, y: RING_ARENA.y + 6 },
      { x: RING_ARENA.x + RING_ARENA.w - 6, y: RING_ARENA.y + 6 },
      { x: RING_ARENA.x + 6, y: RING_ARENA.y + RING_ARENA.h - 6 },
      { x: RING_ARENA.x + RING_ARENA.w - 6, y: RING_ARENA.y + RING_ARENA.h - 6 },
    ];
    corners.forEach((corner, index) => {
      const root = new Container();
      root.position.set(corner.x, corner.y);
      const g = new Graphics();
      // 角旗：深蓝旗面 + 沙色横条，与围绳同族
      g.rect(-1, -34, 2, 34).fill(darken(VENUE_COLORS.ring.seam, 0.85));
      g.rect(1, -34, 16, 11).fill(VENUE_COLORS.ring.accent);
      g.rect(1, -30, 16, 3).fill(VENUE_COLORS.ring.main);
      g.rect(1, -34, 16, 1).fill(lighten(VENUE_COLORS.ring.main, 0.4));
      if (index % 2 === 1) g.rect(1, -34, 16, 11).fill({ color: 0xffffff, alpha: 0.06 });
      root.addChild(g);
      depth.add(corner.y, root);
      this.roots.push(root);
    });
  }

  private paintDiceHallFloor(g: Graphics): void {
    const c = VENUE_COLORS.diceHall;
    pool(g, DICE_HALL_CENTER.x, DICE_HALL.y + DICE_HALL.h - 60, 190, 120, c.accent);
    // 金线方格：绒面地毯上的 60px 暗金格，只在边角出现，不压赌桌
    for (let y = DICE_HALL.y + 10; y < DICE_HALL.y + DICE_HALL.h; y += 60) {
      g.rect(DICE_HALL.x + 10, y, DICE_HALL.w - 20, 1).fill({ color: c.accent, alpha: 0.22 });
    }
    for (let x = DICE_HALL.x + 10; x < DICE_HALL.x + DICE_HALL.w; x += 60) {
      g.rect(x, DICE_HALL.y + 10, 1, DICE_HALL.h - 20).fill({ color: c.accent, alpha: 0.22 });
    }
    // 收边：内圈一道亮金线，读得出「这是一张赌桌大厅的地毯」
    g.rect(DICE_HALL.x + 6, DICE_HALL.y + 6, DICE_HALL.w - 12, 2).fill({ color: c.accent, alpha: 0.4 });
    g.rect(DICE_HALL.x + 6, DICE_HALL.y + DICE_HALL.h - 8, DICE_HALL.w - 12, 2).fill({ color: c.accent, alpha: 0.28 });
    // 台边散落的筹码：三处小堆，比整片装饰更像有人刚玩过
    const chips: ReadonlyArray<readonly [number, number]> = [
      [DICE_HALL_CENTER.x - 96, DICE_HALL.y + DICE_HALL.h - 78],
      [DICE_HALL_CENTER.x + 74, DICE_HALL.y + DICE_HALL.h - 104],
      [DICE_HALL_CENTER.x + 8, DICE_HALL.y + DICE_HALL.h - 46],
    ];
    for (const [cx, cy] of chips) {
      g.rect(cx, cy, 9, 3).fill(0xd64545);
      g.rect(cx + 2, cy - 3, 7, 3).fill(0xf2c879);
      g.rect(cx + 1, cy + 3, 8, 2).fill({ color: 0x1e2846, alpha: 0.25 });
    }
  }

  private paintClinicApron(g: Graphics): void {
    const c = VENUE_COLORS.clinic;
    pool(g, CLINIC_RECT.x + CLINIC_RECT.w / 2, CLINIC_RECT.y + CLINIC_RECT.h - 30, 110, 52, c.glow);
    // 西门外救护车位：两条黄线 + 中间一个红十字符，指向明显但不挡路
    const apron = CLINIC_ACCESS_PAVING;
    g.rect(apron.x + 12, apron.y + 4, 26, 2).fill({ color: 0xe8c47a, alpha: 0.55 });
    g.rect(apron.x + 12, apron.y + apron.h - 6, 26, 2).fill({ color: 0xe8c47a, alpha: 0.55 });
    g.rect(apron.x + 44, apron.y + 8, 10, 3).fill({ color: c.accent, alpha: 0.5 });
    g.rect(apron.x + 47, apron.y + 5, 4, 9).fill({ color: c.accent, alpha: 0.5 });
  }

  private paintRingApron(g: Graphics): void {
    const c = VENUE_COLORS.ring;
    // 擂台外的夯土圈：一圈被踩踏的浅沙，和 Arena 的毡垫区分开
    g.ellipse(
      RING_ARENA.x + RING_ARENA.w / 2,
      RING_ARENA.y + RING_ARENA.h / 2,
      RING_ARENA.w / 2 + 42,
      RING_ARENA.h / 2 + 34,
    ).fill({ color: c.main, alpha: 0.18 });
    // 观众席脚下的两道踏痕
    for (const bench of RING_BENCHES) {
      g.rect(bench.x - 26, bench.y + 16, 52, 8).fill({ color: c.seam, alpha: 0.16 });
    }
  }

  private paintApartmentDoors(g: Graphics): void {
    const c = VENUE_COLORS.apartment;
    for (const spec of APARTMENT_SPECS) {
      pool(g, spec.door.x, spec.door.y + 4, 30, 16, c.glow);
      // 门阶石：两块暖灰踏步
      g.rect(spec.door.x - 16, spec.door.y - 2, 32, 6).fill({ color: c.seam, alpha: 0.55 });
      g.rect(spec.door.x - 18, spec.door.y + 4, 36, 4).fill({ color: c.alt, alpha: 0.5 });
    }
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
      pool(g, pathX, spec.gate.y - 16, 26, 14, c.glow);
    }
  }

  private paintPlazaGround(g: Graphics): void {
    const c = VENUE_COLORS.plaza;
    // 广场地灯：光池跟灯位共用同一份角度，省一盏灯的位置就靠提亮地面代替
    for (let i = 0; i < PLAZA_LAMP_COUNT; i += 1) {
      const angle = (i / PLAZA_LAMP_COUNT) * Math.PI * 2 + Math.PI / 8;
      const x = PLAZA_CENTER.x + Math.cos(angle) * (PLAZA_RADIUS - 36);
      const y = PLAZA_CENTER.y + Math.sin(angle) * (PLAZA_RADIUS - 36) * 0.62;
      pool(g, x, y, 26, 16, c.accent);
    }
    // 内圈一道极淡的同心石纹，打破一整块灰的读感
    g.ellipse(PLAZA_CENTER.x, PLAZA_CENTER.y, PLAZA_RADIUS * 0.52, PLAZA_RADIUS * 0.36)
      .stroke({ color: c.seam, width: 2, alpha: 0.22 });
  }

  private paintTeaAndShrine(g: Graphics): void {
    const tea = VENUE_COLORS.tea;
    pool(g, TEA_STATION.x + TEA_STATION.width / 2, TEA_STATION.y + TEA_STATION.height + 10, 30, 16, tea.glow);
    // 茶台地面的茶渍：两圈深浅不一的环
    g.ellipse(TEA_STATION.x + 12, TEA_STATION.y + TEA_STATION.height + 22, 9, 5)
      .fill({ color: tea.seam, alpha: 0.3 });
    g.ellipse(TEA_STATION.x + 32, TEA_STATION.y + TEA_STATION.height + 30, 6, 3)
      .fill({ color: tea.seam, alpha: 0.22 });

    const shrine = VENUE_COLORS.shrine;
    pool(g, SHRINE_ALTAR.x + SHRINE_ALTAR.width / 2, SHRINE_ALTAR.y + SHRINE_ALTAR.height + 16, 34, 18, shrine.glow);
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
    pool(g, AMUSEMENT_PARK.x + AMUSEMENT_PARK.w / 2, AMUSEMENT_PARK.y + AMUSEMENT_PARK.h - 24, 62, 26, c.accent);
    // 亭子地面：木柱脚各一圈暖影，砂地因此有「有人在这儿坐过」的痕迹
    const pavilion = MOPING_PAVILION;
    g.ellipse(PAVILION_CENTER.x, PAVILION_CENTER.y + 40, 74, 40).fill({ color: 0x6b4a32, alpha: 0.1 });
    g.rect(pavilion.x + 6, pavilion.y + 6, pavilion.width - 12, 2).fill({ color: 0x96714f, alpha: 0.3 });
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

    this.neon = new Sprite(glow);
    this.neon.anchor.set(0.5, 0.5);
    this.neon.tint = 0xff6fb0;
    this.neon.position.set(DICE_HALL_CENTER.x, DICE_HALL.y - 137);
    this.container.addChild(this.neon);
  }

  /** 每帧推进：纯函数给值，这里只写属性 */
  update(nowMs: number): void {
    for (const leaf of this.leaves) {
      leaf.sprite.visible = true;
      leaf.sprite.x = leaf.x + leafX(leaf.seed, nowMs, leaf.span);
      leaf.sprite.y = leaf.y + leafY(leaf.seed, nowMs, 7);
      leaf.sprite.alpha = leafAlpha(leaf.seed, nowMs);
      leaf.sprite.rotation = bannerSway(leaf.seed, nowMs) * 0.35;
    }
    for (const glint of this.glints) {
      glint.sprite.alpha = 0.18 + waterGlint(glint.seed, nowMs) * 0.62;
      glint.sprite.scale.x = 0.7 + waterGlint(glint.seed + 13, nowMs) * 0.6;
    }
    this.neon.alpha = 0.35 + neonPulse(7, nowMs) * 0.5;
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
