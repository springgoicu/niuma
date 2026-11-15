---
name: pixel-venue-polish
overview: 先新建项目级像素场所美学 skill（.codebuddy/skills/pixel-venue-polish），再用它作为设计规范，对园区全部场所的配色/地面材质、陈设细节、光照氛围与微动效做程序化美术升级，并保持玩法与协议一致。
design:
  architecture:
    framework: react
  styleKeywords:
    - 暖色低饱和像素
    - 1px 深靛描边
    - 场地色温差
    - 糖果色点缀
    - 烛光与霓虹对照
  fontSystem:
    fontFamily: Noto Sans SC
    heading:
      size: 28px
      weight: 700
    subheading:
      size: 16px
      weight: 600
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#2A3142"
      - "#8FE3C7"
      - "#FFE49A"
      - "#9FD3FF"
      - "#E0A9A0"
    background:
      - "#D9AB7C"
      - "#F3F8FB"
      - "#BBB2A0"
      - "#6F9B57"
      - "#232833"
    text:
      - "#2A3142"
      - "#F2E7CD"
      - "#F2C879"
    functional:
      - "#6FCF8E"
      - "#D64545"
      - "#1F6B4A"
      - "#1E2846"
      - "#5EEAD4"
todos:
  - id: skill-scaffold
    content: 用 [skill:skill-creator] 建立 .codebuddy/skills/pixel-venue-polish 并撰写 SKILL.md 与三份 references
    status: completed
  - id: venue-moodboard
    content: 用 [skill:多模态内容生成] 产出各场所配色参考图并归档到 docs/art/venue-moodboard
    status: completed
    dependencies:
      - skill-scaffold
  - id: venue-palette-floor
    content: 用 [subagent:code-explorer] 定位全部场所绘制点，新建 venue-palette.ts 并扩展 BuildingSpec.floor 地板族
    status: completed
    dependencies:
      - skill-scaffold
      - venue-moodboard
  - id: venue-decor-fx
    content: 新建 venue-art.ts 与 venue-motion.ts，在 renderer 挂载并加 ?venue=0 灰度开关
    status: completed
    dependencies:
      - venue-palette-floor
  - id: venue-detail-pass
    content: 逐场所补齐陈设细节与微动效：赌场、诊所、擂台、公寓、别墅、亭、祭坛、茶台、公园、湖畔、公告栏、六间室内
    status: completed
    dependencies:
      - venue-decor-fx
  - id: venue-lighting
    content: 扩容光源预算至 96，集中管理场所光 profile，补 lighting.test 预算断言
    status: completed
    dependencies:
      - venue-detail-pass
  - id: verify-release
    content: 跑 typecheck/test/changelog:check，新增 ADR-0090 与版本工报条目，并做 ?venue=0 回归核对
    status: completed
    dependencies:
      - venue-lighting
---

## 用户需求

在一座 2D 像素多人在线办公园区里，先建立一份项目专属的「像素场所美学」设计 skill，再以它为规范，把园区**全部场所**统一美化一遍。

## 产品概述

园区现有十余处可去的地方：工作区、会议室、宿舍区、卫生间、家庭影音室、小黑屋、中央广场、摸鱼亭、上香祭坛、茶台、摸鱼大赌场、绩效八角笼、牛马诊所、牛马公寓、别墅群、公园、湖畔、迎宾门与牛马榜公告栏。本次要让每一处都有自己可辨认的「场地味道」，而不是共用一套灰扑扑的地砖，同时不改变任何玩法、坐标与碰撞。

## 核心功能

- **设计规范沉淀**：在仓库内安装一个可复用的场所美学 skill，写清配色纪律、描边与分层规则、光照接入方式、微动效约定与验收清单；后续任何人加场所都能照它做。
- **场地配色与地面材质**：每处场所拥有独立的地砖/地毯/草坪/木地板/绒面配色与拼花纹理，同一处地面有主色、次色与压暗砖缝三档，描边取本体色相压暗，不使用纯黑。
- **陈设细节补完**：每处场所至少新增一处「生活细节」——墙面挂饰、桌面小物、盆栽、招牌、灯串、价目牌等，平面装饰始终压在角色下方，立式摆件按脚底排序，可被角色遮挡。
- **光照氛围**：各场所有自己的光——赌场檐下暖灯与霓虹、诊所冷白灯与警灯、擂台聚光、祭坛烛火、茶台暖黄、公寓走廊灯、湖畔与广场的夜间地标光。
- **微动效**：水波、烛火摇曳、霓虹呼吸、屏幕闪烁、落叶飘动、灯串轻晃等小幅循环动画，相位错开，同屏不同步，静止时也不显得是一张死图。
- **观感保留开关**：提供一键退回旧观感的方式，便于线上快速定位视觉回归。


## 技术栈

沿用当前仓库既有栈，不引入新框架：

| 层 | 选型 |
|---|---|
| 外壳 | Next.js 15 App Router · React 19 · TypeScript 5 strict |
| 渲染 | PixiJS 8（`Graphics` + 构造期烘焙 `Texture`）· 自定义 `SortLayer` 深度排序 |
| 共享契约 | `@niuma/shared-types`（`WORLD_LAYOUT` / `BuildingSpec` / `PropKind`） |
| 美术 | 纯程序化绘制，无外部图片工具；`bake()` 把 `Graphics` 烘焙成贴图 |
| 测试 | `bun test lib`（渲染纯模块）+ `shared-types` 单测 |

## 实现方案

**总体策略：先立规范，再统一收口，最后逐场所落细节。**

1. **Skill 先行**：用 skill-creator 的 `scripts/init_skill.py pixel-venue-polish --path .codebuddy/skills` 生成项目级 skill。SKILL.md 只留流程与硬约束（<5k 字），细节拆进 `references/`：`palette.md`（色板与描边算法）、`layering-and-lighting.md`（`flat` / `place()` / `DepthSink` / `LightSpec` 用法）、`venue-map.md`（场所 → 文件 → 锚点色 → 光位表）。SKILL.md 的 description 写成第三人称触发式（"This skill should be used when adding or restyling a venue in the pixel park…"），确保后续 AI 自动命中。

2. **配色与地面收口一处**：新建 `apps/web/lib/game/venue-palette.ts`，把「场所 → 地面族 + 主色/次色/缝隙/压暗边 + 点缀色」做成一张常量表，纪律对齐 `terrain-palette.ts` 已有的色温规范（暖色低饱和 pastel、暗边为同色相压暗、禁止纯黑与中性灰、明度阶梯只留两三档）。`props.ts` 的 `fillFloor*` 改为从该表取色，避免每处地板各写一份魔法数字。

3. **地板族扩展（唯一需要的共享契约改动）**：`BuildingSpec.floor` 现在只有 `'wood' | 'tile' | 'carpet' | 'cinema' | 'rubber' | 'concrete'`，赌场与别墅都在用 `wood`、公寓在用 `concrete`。新增 2–3 个纯表现枚举（如赌场绒面、公寓暖灰抹面、诊所冷白地砖），在 `campus.ts` 扩联合类型、`layout.ts` 改分配、`props.ts` 补绘制分支。
   **明确不动 `PropKind` / `WORLD_LAYOUT.props`**：本次新增的陈设全部是无碰撞的墙面与地面装饰，贴墙位置本就落在墙体碰撞盒内，走 `interior-art.ts` 已验证的 `flat` / `place()` 路线即可，避免碰撞回归与双端发版风险。只有将来需要「可交互/有碰撞」的新家具才动 `PropKind`。

4. **陈设装配层**：新建 `venue-art.ts`，提供与 `interior-art.ts` 同源的绘制原语（`box` / `rect` / `dot` / `wash` / `shadow` / `place`），按场所拆成 `decorateDiceHall` / `decorateClinic` / `decorateRing` / `decorateApartment` / `decorateVillas` / `decoratePlaza` 等私有方法，导出统一的 `build(depth, base, renderer)` 与 `lights: LightSpec[]`——与 `InteriorArt` / `PavilionView` / `ShrineView` 完全一致的接口形状，接入成本最低。

5. **微动效层**：新建 `venue-motion.ts`，全部是纯函数（`torchFlicker(seed, tMs)`、`neonPulse(seed, tMs)`、`leafDrift(seed, tMs)`、`waterGlint(seed, tMs)`），相位由 id/种子派生、LUT 查表复用 `light-registry.ts` 里 `flickerAt` 的做法，**零每帧分配、可单测区间**。由 `VenueFx` 单个图层在既有 tick 里统一 `update(elapsed)`，不新增 ticker。

6. **光照预算**：`light-registry.ts` 的 `MAX_LIGHTS` 现为 64、注释记录「场景常驻 39」，新增场所若每处 3–4 个光会静默丢光。做法：`MAX_LIGHTS` 提到 96，各场所只留 1–2 个**焦点光**，其余靠地面提亮与烘焙暖色表现；`scene-lights.ts` 用 profile 表集中管理，`lighting.test.ts` 增加「注册总数 ≤ 上限」的断言，避免以后悄悄超限。

7. **灰度开关与回归保护**：沿用 `?flat=1` / `?light=0` / `?bands=0` 惯例新增 `?venue=0`，只关新装饰与动效层，地板与既有视图保留，出问题可线上秒退。所有贴图构造期一次烘焙，帧循环只做裁剪与贴图切换，不新增 `generateTexture`。

**性能与可靠性**：新增绘制全部发生在 `buildLayers()` 一次构造期，帧开销为 O(可见贴花 + 一个 FX 图层)，与同屏人数无关；光源仍走 `LightRegistry.collect` 的圆-矩形剔除，光图维持 1/4 分辨率合批。风险点是灯位增加带来的填充率，验证时用 `?lm=2` 对比帧时间。

## 目录结构

```
niuma/
├── .codebuddy/
│   └── skills/
│       └── pixel-venue-polish/                       # [NEW] 项目级场所美学 skill
│           ├── SKILL.md                              # [NEW] 触发条件 + 五步工作流 + 硬约束（色相压暗描边、明度只留两三档、flat/place 分层、光位走 LightSpec、动效纯函数）+ 验收清单
│           └── references/
│               ├── palette.md                        # [NEW] 全站色板与「同色相压暗」算法、每场所锚点色与点缀色
│               ├── layering-and-lighting.md          # [NEW] DepthSink/flat/place 规则、LightSpec 字段与 flicker 用法、MAX_LIGHTS 预算
│               └── venue-map.md                      # [NEW] 场所 → 文件 → 坐标来源 → 光位 → 动效 的映射表
├── packages/shared-types/src/world/
│   ├── campus.ts                                     # [MODIFY] BuildingSpec.floor 联合类型扩展 2–3 个纯表现档（不新增 PropKind）
│   ├── layout.ts                                     # [MODIFY] 赌场/公寓/别墅/诊所按新地板族分配，必要时补 paved 细节区
│   └── __tests__/campus-layout.test.ts               # [MODIFY] 断言地板枚举覆盖率、buildings 数量与碰撞盒不变
└── apps/web/
    ├── data/release-notes.json                       # [MODIFY] 追加一条面向玩家的版本工报
    └── lib/game/
        ├── venue-palette.ts                          # [NEW] 场所配色与地面族常量表，props.ts 与各视图统一取色
        ├── venue-art.ts                              # [NEW] 场所陈设装配层：绘制原语 + 各场所 decorate*，导出 build(depth, base, renderer) 与 lights
        ├── venue-motion.ts                           # [NEW] 微动效纯函数（烛火/霓虹/落叶/水光），相位由种子派生、LUT 查表
        ├── props.ts                                  # [MODIFY] fillFloor* 从 venue-palette 取色，新增地板族分支，铺装加砖缝明暗层次
        ├── interior-art.ts                           # [MODIFY] 室内第二层细节补完（工作区/会议室/宿舍/卫生间/影音室/小黑屋）
        ├── renderer.ts                               # [MODIFY] 挂载 VenueArt 与 VenueFx、注册各场所光位、新增 ?venue=0 灰度开关
        ├── dice-hall-view.ts                         # [MODIFY] 赌场：绒面桌、筹码堆、檐下灯串、价目牌、霓虹微闪
        ├── clinic-view.ts                            # [MODIFY] 诊所：冷白地砖、候诊椅、药柜、红十字灯箱、警灯呼吸
        ├── ring.ts / ring-art.ts                     # [MODIFY] 擂台：八角围绳高光、角标、聚光灯位、观众椅细部
        ├── apartment-view.ts                         # [MODIFY] 公寓：走廊壁灯、门牌、消防栓、晾衣绳小物
        ├── villas-view.ts                            # [MODIFY] 别墅：石基、栅栏花箱、门廊灯、庭院小径
        ├── pavilion.ts / shrine.ts / tea-station.ts  # [MODIFY] 摸鱼亭/祭坛/茶台：竹影、供案烛火摇曳、茶烟与暖光
        ├── park.ts / bulletin.ts / plaques.ts        # [MODIFY] 公园、公告栏与牌匾：树池、路灯串、纸页翻动细节
        ├── water-fx.ts                               # [MODIFY] 湖畔水光与波纹相位，冬季冰缘过渡
        ├── lighting/light-registry.ts                # [MODIFY] MAX_LIGHTS 64 → 96，注释更新为实测常驻值
        ├── lighting/scene-lights.ts                  # [MODIFY] 场所光 profile 表，集中管理新增光位
        └── __tests__/
            ├── venue-palette.test.ts                 # [NEW] 断言每场所色板齐全、描边为同色相压暗、无纯黑
            ├── venue-motion.test.ts                  # [NEW] 断言动效输出落在区间内、同种子可复现、零分配路径
            └── lighting.test.ts                      # [MODIFY] 新增注册总数 ≤ MAX_LIGHTS 的预算断言
```

## 关键代码结构

```ts
// venue-art.ts —— 与 InteriorArt / PavilionView 对齐的装配接口
export type VenueId =
  | 'diceHall' | 'clinic' | 'ring' | 'apartment' | 'villas'
  | 'pavilion' | 'shrine' | 'tea' | 'park' | 'plaza' | 'bulletin';

export interface VenueDecor {
  /** 平面装饰进 base（始终在角色下方），立式摆件进 depth（按脚底 y 排序） */
  build(depth: DepthSink, base: Container, renderer: Application['renderer']): void;
  /** 构造期一次收集，由 renderer 交给 LightmapLayer.register */
  readonly lights: LightSpec[];
}
```


## 设计定位

这是一次纯游戏内像素场景的整体视觉升级：把「共用一套地砖的园区」变成「每走十步就换一种气氛的园区」。不做网页界面改版，所有产出都是 PixiJS 画布上的程序化像素绘制。

## 设计风格

**暖色低饱和 pastel + 硬朗卡通描边 + 场地色温差**。延续仓库既有色温纪律（`terrain-palette.ts` 注释记载的 ADR-0013）：全站暖色 pastel 打底，任何暗边都是本体色相压暗到四成明度，禁止纯黑与中性灰描边，明度阶梯只留两三档——地面越花，角色越出不来。

场地之间靠**色温**而不是靠更花的纹理区分：工作区与别墅偏暖木（奶油木色 + 胡桃），诊所与卫生间偏冷白（瓷砖 + 医用蓝），影音室与小黑屋走暗厅（炭蓝 + 酒红 + 水泥），赌场走墨绿绒 + 金 + 朱红，摸鱼亭走朱红柱 + 竹青，广场走暖灰石砖 + 奶油草。相邻场所的色相至少错开 90°，走到边界就能读出「换地方了」。

## 分层与光照

- **三层叠法**：地面族（`PropsView.base` / `TerrainView`）→ 平面装饰（`flat`，永远压在人脚下）→ 立式摆件与建筑（`DepthSink`，按脚底 y 与角色互相遮挡）。
- **每处至少一盏灯**：灯位走 `LightSpec`（`radius` / `color` / `intensity` / `flicker`），暖灯 `flicker` 0.08–0.16、霓虹 0.02、冷白灯 0。单场所只留 1–2 个焦点光，其余用地面提亮与烘焙的暖色块代替，守住 96 盏的预算。
- **微动效克制**：每屏同时运动的元素不超过三类（烛火、灯串、水光），周期 2–4 秒，相位按种子错开；不做整屏抖动，不做浮点缩放的呼吸（沿用「只抬高不下沉」的角色纪律）。

## 场所画面规划（每处四个区块）

1. **摸鱼大赌场**：墨绿绒地砖 + 金线收边；吧台、六根朱红柱、绿绒赌桌加筹码与小酒杯；檐下暖灯串与霓虹呼吸；背景价目牌。
2. **牛马诊所**：冷白方格地砖 + 天蓝接缝；候诊长椅、药柜、红十字灯箱；冷白顶灯 + 琥珀警灯缓慢脉冲；担架推到门边。
3. **绩效八角笼**：沙色夯土 + 深色围绳高光；角柱角标、观众长椅；顶部聚光锥与胜者侧暖光；绳网轻晃、旗帜微摆。
4. **中央广场**：暖灰石砖扇形铺装 + 深缝路缘；牛马榜公告栏、地灯、树池；夜里地标灯暖黄一片；地面落叶缓慢飘移。
5. **摸鱼亭 / 祭坛 / 茶台**：竹青与朱红同一套骨架；供案烛火摇曳、茶烟两缕上升、亭檐宫灯；三处共用一套暖光滤镜。
6. **工作区 / 会议室 / 宿舍 / 卫生间 / 影音室 / 小黑屋**：木地板与地毯各加一层拼花；桌面笔记本与冰美式、白板笔迹、晾衣绳、镜面水渍、银幕冷光反照；室内各加一盏壁灯或落地灯。
7. **公寓 / 别墅 / 公园 / 湖畔**：暖灰抹面与木格栅、栅栏花箱、路灯串；湖面水光相位错开，冬夏两套水色。

## 交互与响应

所有新增都是构造期烘焙的静态贴图 + 纯函数偏移，不监听输入、不产出新面板、不改任何按键与碰撞；`?venue=0` 一键退回旧观感，`?light=0` 单独验证无光场景是否仍然好看。

## Agent Extensions

### Skill

- **skill-creator**
  - Purpose: 按官方技能规范在 `.codebuddy/skills/pixel-venue-polish` 初始化并撰写 SKILL.md 与 `references/`，保证 frontmatter、命名与渐进式披露结构合规。
  - Expected outcome: 生成可直接命中触发条件的项目级 skill，含 `palette.md` / `layering-and-lighting.md` / `venue-map.md` 三份参考文档，并通过结构校验；后续美化任务全部以此规范为唯一依据。

- **多模态内容生成**
  - Purpose: 为各场所生成配色与氛围参考图（赌场、诊所、擂台、广场、公寓等），作为设计师视角的锚点，避免纯文字描述跑偏。
  - Expected outcome: 输出 4–6 张风格参考图归档到 `docs/art/venue-moodboard/`，仅作设计参考、不参与构建、不进游戏资源，配套一段「从参考图抽取到像素色板」的提炼说明。

### SubAgent

- **code-explorer**
  - Purpose: 在改动前对全部场所的绘制入口、光源注册点、地板族分支与测试覆盖做一次 medium 深度的定位，形成准确的「场所 → 文件 → 调用点」清单。
  - Expected outcome: 给出精确到函数与行号的映射清单，确保后续改造不漏场所、不误伤碰撞与服务端契约。
