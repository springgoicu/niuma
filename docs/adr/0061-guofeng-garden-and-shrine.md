# ADR-0061：国风园林与职场玄学——灰度配件、双深度键凉亭、灯笼光池与本地日签

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（需求与三处澄清授权）、捏人资产管线、世界布局、渲染层、交互层
- **Tags:** world-layout, rendering, cosmetics, lighting, audio, zero-persistence, ui
- **Supersedes / superseded by:** 无；继续遵守 ADR-0004（零持久化）、ADR-0005（整数纹素）、ADR-0011（配件单色化）、ADR-0013（烘焙与帧循环纪律）、ADR-0028（岛域尺寸）、ADR-0032（座位接触契约）、ADR-0047（中央枢纽）、ADR-0048（音频池）、ADR-0049（渲染线程拆分）

## Context

需求是给整座园区注入「中式传统园林 + 中式职场玄学」：捏人页补 5 件国风配件（后续澄清追加 2 件国风发型，共 7 件）、摸鱼湖畔立一座八角重檐凉亭、铺两片翠竹林、广场拐角摆太湖石、工作区入口供财神香案、饮水机旁加紫砂茶台、三处门头挂牌匾，入夜点 10 盏红灯笼。

现状约束（全部经代码核实）：

1. **服务端零持久化**（ADR-0004）：状态只活在进程内存与浏览器 `localStorage`。
2. **配件是纯灰度图**（ADR-0011）：`cosmetics.ts` 只写四档明度，颜色由 `Sprite.tint` 从外观色槽取；`cosmetics.test.ts` 有一条断言逐像素检查 `r == g == b`。任何「红金 / 翠绿」只能靠明度分层 + 玩家所选色槽表达。
3. **32 字节外观编码已满**：`[27..30]` 是四类配件各 1 字节，新增 id 只占已有字节的新值，**新增类别**才需要改协议。
4. **动作预算钉死在 34 列**：`CLIPS` 与「每列恰属一个动作」测试共同锁死列号；为「合十作揖」新增 clip 要同时改生成器、`COLUMN_POSES` 与布局测试。
5. **墙体是平铺 10px 色带**：`props.ts` 的 `fillSolidFlat` 只填地面矩形，没有立面。所以「门头挂牌匾」在现有房间里无墙可挂。
6. **世界空间中文只能用 Pixi `Text`**：仓库没有位图 CJK 字库（`interior-art.ts` 的 `glyph()` 只够 3×5 拉丁与符号）。
7. **光源上限 64**（`light-registry.ts`），超限时 `add()` 静默返回 -1。
8. **音频必须经 `AudioEvent` 落到主线程**：`AudioContext` 只能在主线程创建；`sfx.ts` 的 6 路 `Voice` 池每路只有 3 个振荡器。
9. **`localStorage` 只能在主线程读写**：Worker 侧靠 init 消息带初值、靠一条回传消息落盘（`danmakuPrefs` 已是这条通路）。

## Quality scenarios and invariants

```text
QUALITY | 配色不打架 | source: 玩家 | stimulus: 把 headwear 色槽拖到金色 | environment: 捏人页 | artifact: 财神官帽 | response: 明度分层保留，色相跟随色槽 | measure: 每像素 r==g==b；任意色槽下轮廓仍可读 | priority: 高
QUALITY | 亭子能走进去 | source: 玩家 | stimulus: 从南侧走进摸鱼亭坐到石鼓凳 | environment: 亭内 | artifact: 后景/前景深度键 | response: 人不会被屋顶盖住，也不会穿过前柱 | measure: 亭内实体 y ∈ (后沿, 前沿) 时渲染顺序 = 后景 < 人 < 前景 | priority: 高
QUALITY | 光源不超预算 | source: 渲染线程 | stimulus: 全图光源注册 | environment: 任意季节时刻 | artifact: LightRegistry | response: 不出现静默丢弃 | measure: 外景 + 宫灯 6 + 亭角 4 + 供案 2 + 室内预留 8 ≤ 64 | priority: 高
QUALITY | 入夜自动点亮 | source: 时间 | stimulus: 跨过黄昏进入夜间 | environment: 30s 采样 | artifact: 红灯笼光池 | response: 白昼 0、黄昏淡入、深夜满亮 | measure: 复用 localLightGain，无自定义昼夜判断 | priority: 高
QUALITY | 当日首香只本机知道 | source: 玩家 | stimulus: 同一天连按两次 F | environment: 刷新后 | artifact: localStorage 日签 | response: 第二次不再给光晕 | measure: 同日 writeIncenseDay 只写一次；跨日自动恢复 | priority: 高
QUALITY | 帧预算 | source: 渲染线程 | stimulus: 青烟 / 蒸汽 / 飘字常驻 | environment: 60fps | artifact: ShrineView / TeaStationView / RitualFx | response: 每帧只写 position 与 alpha | measure: 新增每帧 new = 0；generateTexture = 0 | priority: 中
```

不变量：

- 服务端不写盘、不新增协议字段；`incenseDay` 只走 Worker 与本机存储之间的既有通路。
- 世界坐标只在 `layout.ts` 定义一次：`MOPING_PAVILION` / `MOPING_PAVILION_SOLIDS` / `SHRINE_ALTAR(_SOLID)` / `TEA_STATION(_SOLID)` / `BAMBOO_ZONES` / `TAIHU_ROCKS` / `ARCH_LANTERN_POSTS` / `DOOR_LANTERN_POSTS` / `DOOR_PLAQUES`，渲染、交互与测试全部派生。
- 配件目录只允许追加，禁止插入或重排（`catalog.ts` 与 `cosmetics.ts` 两份顺序由测试逐项比对）。
- 亭柱只挡 12×10 的柱础，亭心留空；供案与茶台只挡贴地那一截。
- 作揖不下沉超过 2 纹素，且不做纵向缩放（ADR-0005）。

## Decision

采用 **灰度配件追加 + 数据驱动的国风地标 + 双深度键大件 + 光池复用 + 本地日签**：

1. **配件（7 件，全部追加）**：`HEADWEAR_IDS` 追加 `god_of_wealth / bamboo_hat / curse_hoop`（索引 6–8）、`NECKWEAR_IDS` 追加 `chinese_knot / jade_pendant`（4–5）、`HAIR_IDS` 追加 `topknot / braid`（6–7）。绘制仍是 20×20 灰度四档 + `silhouette()` 1px 硬描边。三件头饰的差异靠**构图**而不是配色：官帽压 row 6–7 的展角飞翅、斗笠靠每行左端收一列做倾斜 + row 9 一整条 `TRIM` 编织纹、紧箍压 row 10–12 的横箍 + 正中 3×3 空心方环当卷云。平安扣中心 1px 用 `OUTLINE` 而不是透明——`silhouette()` 只沿外沿生长，内部留透明会被身体色直接穿透，1px 的洞看不成洞。`ATLAS_VERSION` 8 → 9，让旧 manifest 的 `cosmeticFiles` 失效。
2. **摸鱼亭**：`MOPING_PAVILION = {x: 5790, y: 5210, w: 200, h: 180}`（底边中心锚点），落在湖东北岸的凸角，亭心离水面 > 120px。八根柱位是 45° 一圈的**整数化**坐标（半径 ~88），手写而不用 `Math.cos/sin` —— 本文件禁止三角函数，两端浮点差 1px 就会各画各的地图。深度键拆两条：后景（后排四柱 + 靠背栏杆 + 汉白玉石桌 + 两级屋檐 + 宝顶）压后沿 `y - height + 2`，前景（前排四柱 + 前檐两盏灯）压前沿 `y`。台基走 `props.base` 地面层。
3. **座位**：新增 `SeatKind 'drum'`（石鼓凳），`seatPose('drum')` 自然落到 `Sit`；四张凳子绕亭心 ±40，全部 `facing: Down`——湖在亭子南侧，「坐下即观湖沉思」靠朝向而不是另设姿态。补齐 `seat-art.ts OTHER_SEATS`、`props.ts seatTextures`、`badge.ts seatLabel`。
4. **竹林与太湖石走道具管线**：新增 `PropKind 'bamboo' / 'taihu'`，拿到纹理复用、视锥裁剪与碰撞派生。`BAMBOO_ZONES` 两片矩形交给 `isPlantable` 排除，普通树自然让位——「替换部分普通树木」就是这一条排除，不另写删除清单。竹丛按 56px 网格错列、奇偶行偏移 28，固定步长而非随机。竹笋作为新贴花 `shoot` 追加进 `DECAL_KINDS`，只在竹林区撒点。
5. **财神供案 / 紫砂茶台**：需求点名了独立文件，且二者的绘制尺度与遮挡关系超出 `PROP_SIZE` 单精灵模型，因此各自建视图（`shrine.ts` / `tea-station.ts`），按脚底 y 进 `SortLayer`，碰撞在 `layout.ts` 显式登记。青烟 3 缕、蒸汽 2 股全部构造期建池，帧里只写 `position / alpha`。
6. **作揖**：不新增 atlas 列。`pony-motion.ts` 加 `bowTexelsAt()`（900ms 三角包络，0→2→0，45% 下 / 55% 回），`PonyRenderer` 加独立的 `bowTexels` 槽位并在 `applyOffset()` 里与起伏、座位抬升合成——**不复用 `setBob`**，那个槽位每帧被呼吸覆盖。
7. **磬音与喝茶声**：新模块 `ritual-audio.ts`，沿用 `woodfish-audio.ts` 的「一次性振荡器 + 短延迟反馈」路子。磬音是 523Hz 基频 + 1.47× / 2.09× / 3.13× 三个非谐分音，高次分音先散（0.55s），基频留 2.6s。**不进 `sfx` 的 6 路池**：每路只有 3 个振荡器装不下 4 个分音，且长衰减会被 `acquire()` 优先抢占。播放一律经 `AudioEvent`（新增 `incense` / `tea` 两种）落到主线程。
8. **当日首香**：`incense-day.ts` 存 `niuma.incense.day = YYYY-MM-DD`（本地时区，复用 `localDateKey`）。存日期而不是布尔量，隔天自动失效、无需清理。Worker 侧经 `EngineEnv.incenseDay` / `writeIncenseDay` 走既有通路：init 消息带初值，一条 `{ t: 'incenseDay' }` 回传落盘。60 秒淡金光晕只在本机可见，不做任何广播。
9. **灯笼**：`lighting/lanterns.ts` 提供像素画 `paintLantern()` 与 `LANTERN_LIGHT`（半径 48 / `0xff5a3c` / 0.72 / flicker 0.12），摸鱼亭与门柱共用同一套，改口径只改一处。白昼熄灭完全交给 `lightmap.render()` 的 `localLightGain(tone)`，**没有一行自定义昼夜判断**。挂点：拱门横梁两端 2 盏 + 四角院落门柱各 1 盏（挂在**门柱**上而不是门洞正中，否则灯正好垂在玩家脸上）+ 亭子四角 4 盏。
10. **门头牌匾**：因为墙体没有立面，每处门头自带一座牌坊（两柱 + 横枋 + 匾额），底边中心锚在门线上进 y 排序。匾额与竖排对联都用 Pixi `Text`（`resolution` 跟设备像素，`setTextResolution` 由 renderer 转发）。

### 世界坐标

```text
MOPING_PAVILION        x=5790  y=5210  w=200 h=180  亭心 (5790, 5120)
SHRINE_ALTAR           x=3740  y=3800  w=56  h=44   贴地碰撞 56×18
TEA_STATION            x=3534  y=3810  w=46  h=40   贴地碰撞 44×16
BAMBOO_ZONES           [3440,3296,224,100] / [3136,3592,126,228]
TAIHU_ROCKS            (4534,3960) / (3658,3960)    广场中心左右各 438
WORKROOM_GATE          x=3566（= NAV_ARRIVALS.workroom 的 x）
```

## Options considered

### Option A — 灰度追加 + 数据驱动地标 + 双深度键 + 光池复用（chosen）

- Pros：不碰协议、不碰服务端、不碰 atlas 列预算；配色统一由色槽决定；亭子的遮挡关系一次解决；灯笼「入夜点亮」零代码。
- Cons：配件的「红金 / 翠绿」只在玩家选到对应色槽时才成立；匾额中文是系统字体渲染，与像素风有轻微割裂；竹林与太湖石各占 4 个 texture 变体。
- Reverse cost：低。删 `PropKind`、四个新视图、7 个目录 id 与相关常量即可，无数据迁移（旧存档字节仍在合法区间）。

### Option B — 配件烘焙彩色（rejected）

- Pros：官帽真的是红金、玉璧真的是翠绿。
- Cons：`Sprite.tint` 是乘法，彩色底图会被色槽再乘一次，深色槽下直接发黑；且逐像素纯灰度断言必须删掉，等于推翻 ADR-0011 的全部收益。
- Reverse cost：高（要改图集管线与客户端染色通路）。

### Option C — 为「合十作揖」新增 atlas clip（rejected）

- Pros：动作可以真正画出来，比程序化包络自然。
- Cons：`CLIPS` 列预算 34 列已满，加 clip 要同时改生成器、`COLUMN_POSES`、布局测试与所有按列号的播放逻辑；一次 900ms 的行礼不值得动这条骨架。
- Reverse cost：中。

### Option D — 亭子用单条深度键（rejected）

- Pros：一个容器、一次 `depth.add`。
- Cons：玩家走进亭内会被屋顶整个盖住（脚的 y 大于屋顶键），或者反过来穿过后柱。亭子只要「能走进去」，单键就一定错。
- Reverse cost：低，但错误在肉眼验收前不可见。

### Option E — 磬音塞进 `sfx` 的 Voice 池（rejected）

- Pros：复用现成的声道、空间化与节流。
- Cons：每路只有 3 个振荡器（body / sub / lfo），装不下 4 个非谐分音；`acquire()` 会抢占最早结束的声道，一声 2.6 秒的钟很容易被咀嚼音打断。
- Reverse cost：低。

### Option F — 上香状态进服务端（rejected）

- Pros：换设备也能记住「今天拜过了」。
- Cons：直接推翻零持久化；为一次装饰性反馈引入账号级状态不值得。
- Reverse cost：高。

### Option G — 把匾额挂在现有墙上（rejected）

- Pros：不用建牌坊。
- Cons：墙体是平铺的 10px 色带，没有立面。硬贴上去等于在草地上画一块木板，读不出「门头」。

反向成本（不做 / 晚做）：园区仍是纯现代办公风，没有任何一处能承载「中式职场玄学」的语气；捏人页的头饰槽在学士帽与礼帽之间没有国风选项；夜间只有路灯的暖黄，没有冷暖撞色。

## Consequences

### Positive

- 世界坐标只有一份：坐标漂到水里 / 漂到路上 / 压到花箱，都会被 `layout-guofeng.test.ts` 与既有密度测试当场拦下。
- 灯笼「白天熄灭、入夜点亮」是零成本继承：`lightmap` 的白昼 `visible=false` 与 `localLightGain` 已经把这件事做完了。
- 青烟、蒸汽、飘字、光晕四个反馈全部构造期建池，帧循环零分配。
- 「当天首次上香」跨刷新有效，且不产生任何服务端状态。

### Negative / risks

- 配件的「红金 / 翠绿」依赖玩家色槽：默认色槽下官帽是蓝的、玉璧也可能是蓝的。这是 ADR-0011 的既定代价，本次没有推翻它。
- 匾额与对联是系统 CJK 字体渲染，字号 7px / 6px：缺字形时会退化，截图与实机可能略有差异。
- 三座牌坊会遮住各自门口的北侧一小片区域（俯视视角无法避免），玩家在门内侧紧贴牌坊时会被横枋压住。
- 竹林与太湖石各占 4 个 `kind:variant` 纹理；虽然共享绘制函数，但初始化时间会增加几毫秒。
- 光源已经很接近 64 上限：再想加灯必须先减灯，`ritual.test.ts` 有一条断言把这条预算钉住。
- `localStorage` 可被清空或手改：清掉之后当天会再送一次光晕。它只是装饰反馈，不参与任何权威判定。

### Neutral

- 石鼓凳复用了 `stool` 的坐姿与座位契约，只是换了外观与 `SeatKind`。
- 摸鱼亭进了 `REGIONS`（排在「摸鱼湖」之前），状态栏会显示「摸鱼亭」。

## Revisit triggers

We will reopen this ADR if:

- [ ] 玩家普遍反馈「官帽怎么是蓝的」→ 讨论是否为配件引入第二个固定强调色槽（需要新协议字节）。
- [ ] 亭内遮挡仍然穿帮（例如坐在南北凳上被前柱切断）→ 考虑三键或按座位的局部遮挡层。
- [ ] 灯笼数量继续增加逼近 64 → 先做光源合并或提高上限，不能靠静默丢弃。
- [ ] 出现「茶台按不出饮水机」投诉 → 复核 48px 与 56px 两个感应区的重叠带。
- [ ] 匾额需要真实玩家可编辑内容 → 必须走审核与截断，不能复用静态文案通道。

## Delivery and validation

- **First reversible slice**：`catalog.ts` 追加 id + `cosmetics.ts` 绘制 → `pnpm assets` → 捏人页肉眼验收 → `layout.ts` 地标 + 布局测试 → 道具贴图与贴花 → 亭子视图 → 灯笼与光源 → 供案 / 茶台与交互 → 牌匾。
- **Compatibility / migration**：世界坐标属静态内容，需前后端同版本；外观协议零改动（新增 id 只占已有字节的新值，旧档语义不变）；`ATLAS_VERSION` 8 → 9 让旧 manifest 失效。无数据迁移。
- **Rollback**：撤回 4 个新视图、`PropKind 'bamboo' / 'taihu'`、`SeatKind 'drum'`、7 个目录 id 与相关常量；`ATLAS_VERSION` 回退并重跑 `pnpm assets`。30 天内可回滚。
- **Tests / fitness functions**：
  - `pnpm --filter @niuma/pixel-assets test`（48，含新增 5 条国风配件设计意图断言）
  - `pnpm --filter @niuma/shared-types test`（284，含新增 `layout-guofeng.test.ts` 12 条）
  - `pnpm --filter @niuma/web test`（618，含新增 `ritual.test.ts` 11 条）
  - `pnpm typecheck`（4 包全绿）、`pnpm assets`、`pnpm changelog:check`
  - 手工（未自动化）：捏人页试戴 7 件新配件 → 进摸鱼亭按 Z 落座 → 供案按 F 听磬音看金字 → 茶台按 F 看气泡 → 等入夜看灯笼与冷暖撞色 → 次日再上香确认光晕恢复。
- **Security / reliability / data / ownership**：不新增持久化实体、不新增自由文本、不新增外部依赖、不新增网络包；本地日签带格式校验，坏数据按「从未上香」处理；所有新地标坐标经 `isOnLand` / `isWaterAt` / 路径多边形三重判定。

## Baselines

```text
BASELINE | packages/shared-types（世界真相） | expected: 坐标与碰撞单点定义，不依赖 Pixi/DOM，可被测试直接判定 | observed: MOPING_PAVILION / SHRINE_ALTAR(_SOLID) / TEA_STATION(_SOLID) / BAMBOO_ZONES / TAIHU_ROCKS / 灯笼挂点 / 匾额全部在 layout.ts；渲染与交互只派生 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 后续调位只动这几组常量，再跑 layout-guofeng 与密度测试
BASELINE | packages/pixel-assets（配件） | expected: 20×20 纯灰度四档 + 1px 描边，目录顺序与 shared-types 一致 | observed: 7 件新件全部走 Icon/band/heap/silhouette；cosmetics.test 的灰度、朝向、留白、镜像与新增设计意图断言全绿 | fit: align | patterns: [P-Single-Source, G-Strategy] | violations: [] | suggestion: 新配件只追加分支，不改四档明度含义
BASELINE | apps/web/lib/game（渲染层） | expected: 构造期烘焙 / 建 Text，帧循环只写标量；DPR 变化重建位图 | observed: PavilionView 双深度键 + 地面层台基；ShrineView/TeaStationView/RitualFx 构造期建池；PlaqueView/RitualFx 提供 setTextResolution；四处 destroy 已接 | fit: align | patterns: [G-Composite, G-Flyweight] | violations: [] | suggestion: 若牌匾文案将来要变，只改 DOOR_PLAQUES 常量
BASELINE | apps/web/lib/game（交互与音频） | expected: F 键只加判定不加按键；音频一律经 AudioEvent 落主线程 | observed: isNearShrine/isNearTeaStation 复用地标常量；incense / tea 两个新 AudioEvent 由 audio-sink 分发；磬音不进 Voice 池 | fit: align | patterns: [P-Ports-Adapters] | violations: [] | suggestion: 新增仪式动作沿用同一条事件通路，不要在 Worker 里直接摸 AudioContext
BASELINE | 零持久化（架构约束） | expected: 服务端不因本次改动增加任何状态 | observed: incenseDay 只在本机 localStorage；协议零新增字段；game-server 代码未改 | fit: align | patterns: [] | violations: [] | suggestion: 若将来要跨设备，必须先推翻 ADR-0004
```

```text
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```

对抗审查摘要：

- ARCH-PRIMARY：在「灰度配件 + 单点坐标 + Worker 渲染 + 零持久化」四条约束下，把国风件全部做成「追加数据 + 渲染层视图」，是唯一不引入第二份坐标、不新增协议字段的落法。
- ARCH-ADVERSARY：彩色配件会与 tint 相乘发脏；单键排序会让亭子把玩家盖住；茶台与饮水机 34px 相邻会互相抢 F；首香若进服务端就推翻零持久化；磬音进 Voice 池会被抢占；匾额在平铺墙体上无处可挂；灯笼光源会顶到 64 上限；`NAV_ARRIVALS.workroom` 的竖直路线会被新家具挡住。处置：全部走灰度追加、亭子拆双深度键、茶台感应区收到 48px 并排在设施之前、首香存本地日期键、磬音改一次性合成、牌匾改自建牌坊、新增 12 盏灯并写死预算断言、茶台横向偏移卡到 `+198`。
- ARCH-SYNTH：保留方案 A；把「配件强调色」「亭内遮挡穿帮」「光源上限」写入复核信号；明确世界坐标双端同发版。

## References

- Code: `packages/shared-types/src/catalog.ts`、`world/layout.ts`、`world/campus.ts`
- Code: `packages/pixel-assets/src/cosmetics.ts`、`scripts/generate.ts`
- Code: `apps/web/lib/game/pavilion.ts`、`shrine.ts`、`tea-station.ts`、`plaques.ts`、`ritual-fx.ts`、`ritual-audio.ts`、`incense-day.ts`、`lighting/lanterns.ts`
- Code: `apps/web/lib/game/props.ts`、`seat-art.ts`、`decals.ts`、`terrain-textures.ts`、`terrain-palette.ts`、`pony.ts`、`pony-motion.ts`、`interactions.ts`、`hint-copy.ts`、`session.ts`、`renderer.ts`、`runtime/engine-env.ts`、`runtime/audio-sink.ts`
- Related ADRs: ADR-0004（零持久化）、ADR-0005（整数纹素）、ADR-0011（配件单色化）、ADR-0013（烘焙与帧循环纪律）、ADR-0032（座位接触契约）、ADR-0048（音频池）、ADR-0049（渲染线程拆分）
- User requirement: 2026-11-12《牛马 NIOMA 国风升级：园林、玄学与门头》
