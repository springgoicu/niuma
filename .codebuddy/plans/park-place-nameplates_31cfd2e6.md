---
name: park-place-nameplates
overview: 为园区 12 处导览场所各立一块小号中文门牌（横匾 + 短立柱，约 60×30），现有三块文艺匾额改为标准中文名并保留对联。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素国风
    - 木石小牌
    - 金漆细字
    - 克制统一
  fontSystem:
    fontFamily: system-ui
    heading:
      size: 8px
      weight: 600
    subheading:
      size: 7px
      weight: 600
    body:
      size: 6px
      weight: 400
  colorSystem:
    primary:
      - "#1B1A17"
      - "#C9A14A"
      - "#FFD166"
    background:
      - "#F9FAFB"
      - "#FFFFFF"
    text:
      - "#FFD166"
      - "#2B2118"
    functional:
      - "#2A3142"
      - "#6B4A33"
      - "#442D1E"
todos:
  - id: signs-data
    content: 用 [skill:lsp-code-analysis] 确认引用后，扩展 DoorPlaque 并补齐 10 条中文门牌，文案取自 NAV_TARGETS
    status: completed
  - id: signs-render
    content: plaques.ts 增加小横匾分支，保留大牌坊与工作区对联
    status: completed
    dependencies:
      - signs-data
  - id: villa-plaque
    content: villas-view.ts 院门牌匾加中文院名行，保留房主与待售信息
    status: completed
  - id: festival-filter
    content: festival-decor.ts 门楣彩旗只取 gate 形态，仍保持 4 条
    status: completed
    dependencies:
      - signs-data
  - id: signs-tests
    content: 新增门牌布局测试，覆盖 12 处与落点可站立，并跑 typecheck/test
    status: completed
    dependencies:
      - signs-data
      - signs-render
      - villa-plaque
      - festival-filter
  - id: docs-changelog
    content: 补 ADR-0091 与 release-notes 记录，跑 changelog:check
    status: completed
    dependencies:
      - signs-tests
---

## 产品概述
园区里的 12 处场所各自挂一块中文门牌，玩家走近就能一眼认出这是哪里。门牌是场景里的实体小牌，不参与碰撞，也不影响任何玩法与数据。

## 核心功能
- 12 处导览场所全部有门牌，牌面文字使用标准中文名：工作区、会议室、卫生间、宿舍区、财神供案、游乐园、发泄区、绩效八角笼、摸鱼大赌场、摸鱼一号院、摸鱼二号院、牛马公寓。
- 工作区、会议室、宿舍区沿用现有大牌坊，匾额文字从「难得糊涂 / 画饼充饥 / 安乐窝」换成上述中文名；工作区两侧竖排对联「有事烧香 / 无事摸鱼」保留。
- 卫生间、财神供案、游乐园、发泄区、绩效八角笼、摸鱼大赌场、牛马公寓新增小号门牌：单块横匾加左右短立柱、石质底座，约 60×30，立在入口侧前方。
- 两栋小院在院门现有牌匾上增加一行静态中文院名，下方继续显示「待售 / 房主名」与锁图标，不另立牌。
- 视觉规则统一：深漆匾面 + 1px 金边 + 金色中文，胡桃木短柱、深色硬描边，与既有国风牌坊同一套配色；门牌按脚底 y 参与遮挡，人物、树木、门牌之间的前后关系正确。
- 门牌不挡门洞、不挡通道、不进入碰撞体、不新增光源，昼夜与天气效果沿用现有表现；字体随设备像素清晰显示。


## 技术栈
沿用现有仓库：pnpm workspace + turbo + TypeScript；世界坐标与数据在 `@niuma/shared-types`（纯数据、无 Pixi/DOM）；渲染在 `apps/web` 的 Pixi.js v8（`lib/game/*`，Worker 渲染线程）；测试 bun:test。不新增依赖，不改协议、不改服务端、不落盘（遵守 ADR-0004 / ADR-0061 不变量）。

## 实现思路
1. **单一数据源**：`layout.ts` 的 `DOOR_PLAQUES` 从 3 条扩到 10 条（工作区/会议室/卫生间/宿舍区/财神供案/游乐园/发泄区/绩效八角笼/摸鱼大赌场/牛马公寓），每条新增 `id: NavTargetId` 与 `frame: 'gate' | 'board'`。文案不再手写第二份：把 `DOOR_PLAQUES` 定义移到 `NAV_TARGETS` 之后，用 `NAV_TARGETS` 按 id 取名（12 处中文名已在 `NAV_SOURCES` 定义）。
2. **坐标全部派生**，禁止第二份硬编码：
   - 工作区 `x = WORKROOM_GATE_X`、`depthY = WORKROOM.y + ROOM_H`；会议室 `MEETING_ROOM.x + 360`；宿舍区 `LOUNGE.x + 230`。
   - 卫生间 `x = RESTROOM.x + 240`、`depthY = RESTROOM.y - 6`（门洞 4666–4726 的东侧，避开门口与上方彩旗）。
   - 财神供案 `x = SHRINE_ALTAR.x + 60`、`depthY = SHRINE_ALTAR.y + 4`（案面 56 宽外沿，不压案腿）。
   - 游乐园 `x = PARK_SOUTH_GATE.x + 90`、`depthY = PARK_SOUTH_GATE.y + 20`（南门外侧草地，避开 132 宽门头与彩柱）。
   - 发泄区 `x = BOSS_ARENA.x + 40`、`depthY = BOSS_ARENA.y + 8`（垫子北缘，避开 200 宽的老板本体）。
   - 绩效八角笼 `x = RING_SIGNUP.x + 84`、`depthY = RING_ARENA.y + RING_ARENA.h + 12`（南门东侧，避开 56 宽门洞与两侧长椅）。
   - 摸鱼大赌场 `x = DICE_HALL.x + DICE_HALL.w - 130`、`depthY = DICE_HALL_APRON.y + 14`（南侧迎宾铺装东半边，不挡中间动线）。
   - 牛马公寓 `x = APARTMENT_DOOR.x + 110`、`depthY = APARTMENT_DOOR.y`（门东侧，避开立面霓虹字与进门热区）。
3. **渲染分支**：`PlaqueView` 按 `frame` 走两套几何。`gate` 复用现有牌坊（几何、对联、深度键都不动），只把文字换成「工 作 区」这类字距排版；`board` 新增小牌画法：匾 56×18、深漆底 + 1px 金边、8px 中文，左右 4px 短柱、52×3 石质底座，总高 30。所有 `Text` 构造期建好，帧循环零写入；`setTextResolution` / `destroy` 通路不变，`renderer.ts` 只更新注释。
4. **小院**：`villas-view.ts` 的院门牌匾由 104×22 改为 104×26，加一行 7px 静态院名（`spec.name`），下方房主/待售仍为 9px、锁图标位置不动；新 `Text` 进 `texts`，DPR 重设自动覆盖。院门空间只有 50px 夹道，立牌会挡路，因此改在既有牌匾上增行。
5. **节日装饰联动**：`festival-decor.ts` 的门楣彩旗只从 `frame === 'gate'` 的牌坊派生，卫生间那条例外补挂保留——彩旗仍是 4 条，`festival-decor.test.ts` 断言不变。
6. **验证**：新增 `packages/shared-types/src/__tests__/place-signs.test.ts`，断言 10 条列表 + 2 栋小院覆盖 12 个 `NavTargetId`、id 不重复、每条文案等于 `NAV_TARGETS` 名字、脚底点 `isOnLand` 且 `!isBlocked`、只有工作区带对联；再跑 `pnpm typecheck`、`pnpm test`。

## 实现要点
- 门牌是纯装饰：不登记 `solids`、不进 `WORLD_LAYOUT.solids`、不进协议、不进 `world-state.json`（AGENTS.md 落盘范围）。
- 深度：`root.position.set(x, depthY)` + `depth.add(depthY, root)`，与现有牌坊同一条通路；匾体向上生长，y 排序语义与树、桌椅一致。
- 字号与字宽：5 字最长名（绩效八角笼 / 摸鱼大赌场 / 摸鱼一号院）按 8px × 5 + 0.5 字距 ≈ 42px，容于 52px 匾面内，左右各留 5px；大牌坊 3 字名按 7px 排字距，远小于 64px 匾面。
- 性能：全静态，构造期 12 个 Container + 12 个 `Text`，帧循环零分配、零重排；相对现有 3 座牌坊只多 9 个小 Graphics，内存增量可忽略（<20KB 级）。
- 风险控制：新增落点若命中碰撞体（如游乐园围栏、院墙），沿表中方向微调不超过 16px 并在测试中固定；改动只碰牌匾/门牌链路，不动交互、导航、经济与服务端。

## 架构设计
数据流保持单向：`layout.ts`（场所名单 + 坐标）→ `PlaqueView`（世界内渲染）/ `VillasView`（院门牌匾）/ `festival-decor`（门楣彩旗派生）→ `SortLayer`（y 深度）。无新增模块、无新状态、无新协议。

## 目录结构
```
niuma/
├── packages/shared-types/src/
│   ├── world/layout.ts                          # [MODIFY] DoorPlaque 增加 id/frame；DOOR_PLAQUES 扩到 10 条并下移到 NAV_TARGETS 之后，文案按 id 取；3 条匾额改中文名，仅工作区保留对联；坐标全部由 WORKROOM / MEETING_ROOM / LOUNGE / RESTROOM / SHRINE_ALTAR / PARK_SOUTH_GATE / BOSS_ARENA / RING_SIGNUP / RING_ARENA / DICE_HALL / APARTMENT_DOOR 派生
│   └── __tests__/place-signs.test.ts            # [NEW] 门牌布局测试：覆盖 12 处、id 唯一、文案等于导览名、落点可站立、对联仅工作区
├── apps/web/lib/game/
│   ├── plaques.ts                               # [MODIFY] 按 frame 分支：保留牌坊几何与对联，新增小横匾 56×18 + 4px 短柱 + 石座（总高 30）；gate 文案自动加空格，board 用 8px 中文；Text 构造期建好，setTextResolution/destroy 不变
│   ├── villas-view.ts                           # [MODIFY] 院门牌匾 22→26 高，加 7px 静态院名行，房主/待售 9px 与锁位不动，新 Text 进 texts
│   ├── festival-decor.ts                        # [MODIFY] gateAnchors 只取 frame === 'gate'，卫生间补挂保留，彩旗仍 4 条
│   └── renderer.ts                              # [MODIFY] 仅更新「三座牌坊」注释为场所门牌清单
├── apps/web/data/release-notes.json             # [MODIFY] 追加一条玩家可感知记录（场所门牌上线）
└── docs/adr/0091-place-nameplates.md            # [NEW] 记录「12 处门牌 + 小横匾形态 + 别墅牌匾增行 + 彩旗只挂牌坊」决策
```

## 关键结构
```ts
export interface DoorPlaque {
  readonly id: NavTargetId;
  readonly text: string;            // 标准中文名，取自 NAV_TARGETS
  readonly x: number;
  readonly depthY: number;
  readonly frame: 'gate' | 'board'; // gate：保留大牌坊 + 对联；board：新增 60×30 小门牌
  readonly inkGold: boolean;        // 仅 gate 生效：黑漆金字 / 木底墨字
  readonly couplets: readonly [string, string] | null;
}
```


## 设计风格
像素国风下的「木石小牌」：与既有国风牌坊同源配色，克制、统一、远看有轮廓、近看能读字。门牌是场景实体，不做悬浮 UI，不使用发光描边。

## 造型与尺寸
- 小门牌：横匾 56×18（含 1px 金边外扩至 60 宽），左右 4px 胡桃木短柱，底部 52×3 石质底座，总高约 30。
- 匾面：深漆底 `#1B1A17`，上下两道 1px 金边 `#C9A14A`，中文 8px、字距 0.5、金色 `#FFD166`，居中单行；5 字名左右各留 5px 呼吸。
- 立柱：`#6B4A33` 主色 + `#8A6446` 左侧亮边 + `#442D1E` 暗边，整体 1px `#2A3142` 硬描边，与门头牌坊的柱式一致。
- 大牌坊（工作区/会议室/宿舍区）：几何不变，匾额字改中文名并保留 1px 字距，工作区两侧竖排红纸对联保留。

## 摆放与可读性
- 小牌立在入口侧前方：离门洞中线 60–110px，避开围栏、立柱、长椅与既有霓虹招牌，不遮门、不挡路。
- 按脚底 y 进入排序层，人物从牌前走过时压在牌上、从牌后走过时被牌挡，遮挡关系与树木一致。
- 夜景不新增光源，金边在现有光照下自然变暗；雪天不额外叠加积雪，保持像素干净。

## 小院门牌
院门原牌匾加高 4px，顶部一行 7px 静态院名（摸鱼一号院 / 摸鱼二号院），下方仍是 9px 的「待售 / 房主名」与右侧锁图标，信息层级从「院名 → 归属」自上而下。

### Skill
- **lsp-code-analysis**
  - Purpose: 在扩展 `DoorPlaque` 前用语义引用确认全仓库只有 `plaques.ts`、`festival-decor.ts` 消费该类型，避免遗漏调用点。
  - Expected outcome: 得到完整引用清单，类型新增 `id`/`frame` 后无编译缺口。
