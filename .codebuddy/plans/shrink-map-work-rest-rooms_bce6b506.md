---
name: shrink-map-work-rest-rooms
overview: 把海岛再收紧约 25–30%（镜头倍率不变），并在广场南向主路两侧新建两栋可进入的「工作区」与「休息室」；扩展座位类型支持床（只能躺）与凳子/沙发（只能坐），补充简单可玩互动（售货机/饮水机/咖啡机气泡、上床打呼）。
todos:
  - id: compress-island
    content: 重排 layout.ts 海岸线、河道、湖、林地与土路，岛收到约 5436×6018，并用 [subagent:code-explorer] 复核坐标引用
    status: completed
  - id: add-rooms-and-seats
    content: campus.ts 新增工作区/休息室、床位凳子沙发、饮水机咖啡机，扩展 SeatKind 与 seatPose
    status: completed
    dependencies:
      - compress-island
  - id: server-bed-poses
    content: 服务端 seats/movement 支持床位躺姿与按座位校验姿态，补 seats 单测
    status: completed
    dependencies:
      - add-rooms-and-seats
  - id: client-action-intents
    content: 客户端接入 resolveInteraction，实现床位吸附、起身、床边提示与分类座位提示
    status: completed
    dependencies:
      - server-bed-poses
  - id: render-room-art
    content: PropsView 绘制地毯地板、床凳沙发、饮水机咖啡机并校准床位对齐
    status: completed
    dependencies:
      - add-rooms-and-seats
  - id: interact-and-ui
    content: 新增 F 互动与气泡，动作条/触屏加按钮，补 interactions 单测并用 [skill:impeccable] 收尾
    status: completed
    dependencies:
      - client-action-intents
      - render-room-art
  - id: adr-and-verify
    content: 用 [skill:principal-software-architect] 写 ADR-0024、更新 README，跑 typecheck/test 与双人联机手测
    status: completed
    dependencies:
      - interact-and-ui
---

## 产品概述
在现有 2D 像素多人在线园区里做一次「更紧凑、更好逛、更能玩」的扩建：把海岛整体收紧，让广场到研发园的步行距离明显变短；在广场南向主路两侧新建「工作区」与「休息室」两栋可进入的室内空间；让角色能真正躺上床、坐上凳子与沙发，并补一组轻量互动反馈。

## 核心功能
- **地图收紧**：海岸线、林地、摸鱼湖、周报河、水塘与土路整体向广场收拢，岛的面积减少约三成；镜头倍率保持 1.5 不变，角色大小与视野范围不动。
- **工作区**：一栋可进入的室内房间，内设 6 个工位（桌面、椅子、显示器），有人入座时显示器点亮；配饮水机、咖啡机、绿植与垃圾桶。
- **休息室**：一栋可进入的室内房间，铺地毯，放 3 张单人床、1 张沙发、2 张凳子、小圆桌、床头灯与绿植；床只能躺，凳子与沙发只能坐。
- **入座与躺床**：靠近家具自动吸附最近的可用户位；按 Z 坐凳子、沙发、工位椅、会议椅与马桶，按 X 上床躺平；再按对应按键或移动即可起身。站在床边按 Z 会提示「床上只能躺」。
- **轻互动**：靠近售货机、饮水机、咖啡机按 F 触发一句随机生活化气泡（如「咔哒——冰可乐到手」）；躺在床上静置数秒后周期性冒出「Zzz…」气泡。
- **氛围**：休息室用地毯与暖色床品、沙发、床头灯营造「下班角落」；工作区用整齐的工位、亮起的屏幕与咖啡机营造「加班现场」；两栋房间都有独立区域名，进入后状态栏与小地图可辨认。

## 视觉与体验效果
地图更紧凑，从广场南门到研发园的路程缩短约四分之一；两栋新房间夹着主路，门口连短铺装，走进去能立刻看到床、沙发与工位；躺下时角色横卧在床垫上，气泡与屏幕光让场景有生活气，但不引入复杂系统或数值玩法。

## 边界
不改镜头倍率、不新增协议字段、不做持久化、不做白板留言、不做任务或成就系统、不做新的灯光或音频系统；床不可坐，凳子不可躺。


## 技术栈
沿用现有栈，不引入新依赖：pnpm + Turborepo + TypeScript strict；共享契约在 `packages/shared-types`；服务端 Bun + `Bun.serve`；客户端 Next.js 15 + React 19 + PixiJS 8；像素家具全部用 Pixi `Graphics` 构造期烘焙，禁止 `sprite.scale`。

## 实施方案

### 1. 地图收紧（只改静态布局常量）
- **规则**：以世界中心 (4096,4096) 为原点，对「地形」与「聚簇锚点」做一次 0.84 的等比收缩，四舍五入到偶数后**写死为字面量**；不得在运行时做缩放计算，也不得使用 `Math.random / Math.sin / Math.cos`（Bun 与 V8 末位差异会让双端地图分叉）。
- **聚簇内部尺寸一律不动**（延续 ADR-0022）：广场 1120×936、围栏 1760×1384、门洞 120、工位 88×40、房间 440×280、研发园 2100×800。
- **目标量**：岛从 6470×7164 收到约 **5436×6018**（面积约 −29%）；广场南门到研发园的路由 1492 缩到约 1132（−24%）；世界尺寸 `8192×8192`、`VIEW_RADIUS`、`MOVE_SPEED` 全部不动。
- **建议坐标**（实施时以测试与实机走查为准，允许 ±50 微调）：

| 对象 | 建议坐标 |
|---|---|
| 海岛包围盒 | x 1310–6746，y 1038–7056 |
| 海岛南侧海湾内壁 | y 从 6662 抬到 6900，给研发园留陆地 |
| 广场 / 围栏 | 保持 `{3536,3628,1120,936}` / `{3216,3404,1760,1384}` |
| 研发园 | `{3000,5900,2100,800}`；庭院 `{3100,5920,1900,740}` |
| 会议室 / 卫生间 | `{3180,5980,440,280}` / `{4380,5980,400,280}` |
| 工作区房间 | `{4240,4990,450,360}`，西墙开门 |
| 休息室房间 | `{3470,4990,460,360}`，东墙开门 |
| 南向主路 | `{4032,4788,128,1132}` |
| 北 / 东 / 西支路 | `{4032,3020,128,384}` / `{4976,4032,300,128}` / `{2874,4032,342,128}` |
| 木桥 | `{2618,4020,255,150}` |
| 摸鱼湖 | 顶点按 0.84 收缩，包围盒约 4803–6169 × 4919–5799 |
| 林地 | 共 6 片：西 1310–2578 × 1078–2877、东北 4625–6619 × 1090–2827、东南 5250–6600 × 5900–6800、北门两侧两片、东湾与湖之间一片；删除原「办公区—研发园之间的林带」（与新房间冲突） |

- **连带修正**：`isPlantable()` 增加新房间与铺装的留白；花海第 3 片（原 2900–3900 × 5000–6200）与新休息室冲突，移到河西岸或删除；水塘按同一比例收缩；撒树密度重调（`WILD_TREE_CELL 160 → 150`、`WILD_TREE_CHANCE 0.72 → 0.82`），保证「森林树 > 200、孤树 > 60」的既有断言。
- **碰撞不新增机制**：墙、新家具自碰撞体继续走 `WORLD_LAYOUT.solids`，已有 128px 网格索引，新增约 20 个矩形对单次查询可忽略。

### 2. 座位模型：用具类型决定姿态，而不是加协议
- `SeatKind` 从 `'chair' | 'toilet'` 扩为 `'chair' | 'toilet' | 'stool' | 'sofa' | 'bed'`。
- 新增纯函数 `seatPose(kind)`：`bed` 返回 `POSE.Lie`，其余返回 `POSE.Sit`。服务端、客户端、提示文案、测试全部读这一个函数，禁止各自写分支。
- **不加协议字段**：座位广播仍只带 `seatId`，客户端从 `WORLD_LAYOUT.seats` 反查类型与姿态；`ACTION` 仍只有 `Sit / Lie / Stand`。
- `findNearestSeat()` 增加可选过滤回调（第 5 个参数，默认不过滤），保持现有调用与测试兼容；Z 只接受非床座位，X 只接受床位。
- `roomWalls()` 的门从「固定南墙」改为 `DoorSpec { side, from, to }`，支持东西南北四面开门；现有会议室、卫生间改传 `side: 'south'`，新工作区传 `'west'`、休息室传 `'east'`。

### 3. 服务端权威
- `SeatRegistry` 抽出 `occupy(player, seat, pose, now)`；`sit()` 只用非床座位并落 `POSE.Sit`；新增 `lie()` 只找空床，落 `POSE.Lie` 并广播座位；找不到床则保留原来的地面躺。
- `applyMove()` 的座位校验从「姿态不等于 Sit 就起身」改为「姿态不等于该座位应有姿态就起身」：床上报 `Lie` 保持锁定，床上报 `Sit/Walk/Idle` 视为起身；床上不接受跳跃。
- `server.ts` 的 `ACTION.Lie` 改走 `seats.lie()`；`ACTION.Sit`、`ACTION.Stand` 行为不变。

### 4. 客户端动作裁决统一
- 现状是 `actions.ts` 的 `resolveInteraction()` 只被单测使用，`session.perform()` 自己又写了一套判定。本次把 `perform()` 真正切到 `resolveInteraction()`，让「坐 / 躺 / 起身 / 被拦」只有一处规则；这是床位功能的必要条件，也修掉「按钮显示起身但按下无反应」的存量不一致。
- `InteractionState` 增加 `seatKind`、`bedAvailable`；`InteractionIntent` 增加 `lie-bed`、`interact`。
- 语义：Z 在座上或坐姿时起身；有非床空位时入座；只有床可用时提示「床上只能躺，按 X 上床」；X 在床位躺姿时起身，在坐姿座上提示先起身，有空床时上床，否则地面躺。
- 座位吸附沿用 `localSeat` + 座位广播校正；`sitIntent` 更名 `seatIntent`，坐与躺共用；吸附后姿态取 `seatPose(seat.kind)`。

### 5. 轻互动（客户端本地，零协议）
- 新增 `apps/web/lib/game/interactions.ts`：`INTERACT_RANGE = 56`、`nearestInteractiveProp(x,y)`、`INTERACTION_LINES`（售货机 / 饮水机 / 咖啡机各 3 句）、`pickLine(kind, counter)`、`snoreDue(pose, seatKind, elapsed, lastAt)`。
- F 键触发：取最近可互动道具，节流 900ms，走 `renderer.showBubble(localId, text)` 与现有气泡通道；其他玩家看不到该气泡（明确记为取舍，不新增同步包）。
- 躺床打呼：`pose === Lie` 且座位类型为 `bed`，静置 5s 后每 9s 冒一次「Zzz…」。
- 提示优先级：已入座「移动即可起身」→ 附近床「按 X 上床躺平」→ 附近非床座位「按 Z 坐下 / 坐工位 / 用马桶」→ 附近互动道具「按 F 取饮料」。

### 6. 渲染与美术
- `BuildingSpec.floor` 增加 `'carpet'`；`PropsView` 增加地毯地板、床（64×42，左/右两张烘焙，不用 scale 翻转）、凳子（18×22）、沙发（58×30）、饮水机（20×30）、咖啡机（22×28）；`PROP_SIZE` 同步补齐。
- 座位渲染按 kind 选贴图与下沉量：椅/马桶 6、凳子 4、沙发 8、床 16（以实机躺姿对齐为准，角色躯干落在床垫上）。
- 床、凳子、沙发**不做碰撞体**（与现有椅子一致），保证 `isBlocked(seat)` 为假；饮水机与咖啡机是自碰撞道具，新增 `isSelfSolidProp(kind)` 同时供布局测试与渲染层跳过重复平面绘制，避免「道具陷进自己的碰撞体」断言失效。
- 氛围只靠美术与已有系统：休息室地毯 + 暖色床品 + 床头灯（`drawProp('lamp')` 自带光晕）+ 绿植；工作区整齐工位 + 入座点亮显示器（已有 `setSeatOccupied`）+ 咖啡机。不新增粒子、音频、灯光层。

## 架构与数据流
- **契约层**（shared-types）：世界布局、房间规格、座位类型与 `seatPose`、道具类型、`findNearestSeat` 过滤。
- **权威层**（game-server）：`SeatRegistry` 占座/释放、`applyMove` 姿态校验、`ACTION.Lie` 分流。
- **表现层**（web）：`PropsView` 静态贴图与裁剪；`GameSession` 预测与广播校正；`actions.ts` 纯裁决；`interactions.ts` 纯查询；React 只做按钮与提示。
- 数据流：按键 → `InputController` → `session.perform` → `resolveInteraction` → 找座位/床 → 本地姿态 + 上行动作 → 服务端占座广播 → 各端 `handleSeatState` 校正姿态与显示器。协议字节数不变。
- 依赖方向保持内向：布局不依赖 Pixi/Bun；服务端不依赖 React；渲染层只读共享契约。

## 性能与可靠性
- 布局是编译期常量，帧循环零新增成本；新增贴图按 kind 缓存（沿用 `propTextures`），一次性烘焙约 8 张。
- 岛缩小约三成，树与贴花数量同比下降，初始化与碰撞索引反而更轻。
- `findNearestSeat` 约 60 个座位，仅在 6.7Hz 提示与按键时扫描；F 互动只在按键时遍历 5 个可互动道具；打呼是单玩家 1Hz 定时判断。
- 无持久化、无新增网络包、无新增日志；不触碰倍率、AOI、插值、聊天与准入。

## 实现要点（防回归）
- 坐标一律手写偶数；海岸线、河道、湖、水塘、林地、花海、土路、铺装、道具、座位必须**同一次提交内**对齐，布局改动静默双端同版本发布。
- `isPlantable` 必须排除两栋新房间与门口铺装，否则树会长进屋里。
- 所有新座位必须满足既有断言：在陆地、离水、`isBlocked(seat, PLAYER_RADIUS) === false`、两两间距大于 40、id 连续。
- 东西向的门洞要做通行测试：从门外 20px 走到门内 20px，`resolveMotion` 必须通过。
- 床位姿态只有一个真相 `seatPose`；服务端、客户端、提示、测试不得复制映射表。
- 不做运行时布局开关（与 ADR-0022 一致）；回滚 = 回退布局常量 + 双端同版本重发。
- UI 改动只加一个「互动」按钮，沿用现有方形动作条与圆形触屏按钮样式，用 `[skill:impeccable]` 收尾间距、焦点态与 aria。

## 目录结构
```
packages/shared-types/
├── src/world/layout.ts                      # [MODIFY] 海岸线/河道/湖/林地/花海/土路/铺装/区域/座位表重排；findNearestSeat 增加过滤；isPlantable 排除新房间；导出 seatPose
├── src/world/campus.ts                      # [MODIFY] SeatKind 扩为 chair/toilet/stool/sofa/bed；新增 seatPose；roomWalls 支持四面开门；新增工作区/休息室规格、墙体、地板、床位凳子沙发、饮水机咖啡机、自碰撞道具判定
├── src/__tests__/collision.test.ts          # [MODIFY] 更新岛/区域/树/花海断言，新增新房间不挡门与树不进房间
├── src/__tests__/seats.test.ts              # [MODIFY] 新增床位/凳子/沙发断言与 seatPose 映射；自碰撞道具例外走 isSelfSolidProp
└── src/__tests__/river.test.ts              # [MODIFY] 按新河道与桥位更新中心线不穿路/林断言

apps/game-server/src/
├── sim/seats.ts                             # [MODIFY] 抽出 occupy；sit 排除床；新增 lie 只占床并落 Lie
├── sim/movement.ts                          # [MODIFY] 座位按 seatPose 校验，床上允许 Lie，其它姿态视为起身
├── server.ts                                # [MODIFY] ACTION.Lie 走 seats.lie()
└── sim/seats.test.ts                        # [MODIFY] 新增上床/床上被拒坐/床上移动起身/断线释放床位

apps/web/
├── lib/game/props.ts                        # [MODIFY] 地毯地板、床/凳/沙发/饮水机/咖啡机贴图与座位下沉；按 kind 选贴图
├── lib/game/session.ts                      # [MODIFY] perform 走 resolveInteraction；座位类别吸附与提示；F 互动；打呼气泡
├── lib/game/actions.ts                      # [MODIFY] InteractionState 增加 seatKind/bedAvailable；新增 lie-bed/interact 意图
├── lib/game/input.ts                        # [MODIFY] ActionKey 增加 interact，绑定 F
├── lib/game/interactions.ts                 # [NEW] 可互动道具查询、台词表、打呼判定（纯函数，可单测）
├── lib/game/__tests__/actions.test.ts       # [MODIFY] 覆盖床位、凳子、床边按 Z、互动降级
├── lib/game/__tests__/interactions.test.ts  # [NEW] 最近道具、台词确定性、打呼窗口
├── components/game/ActionBar.tsx            # [MODIFY] 增加「互动 [F]」按钮
└── components/game/TouchControls.tsx        # [MODIFY] 触屏动作盘增加互动按钮

docs/adr/0024-compact-island-work-rest-rooms.md  # [NEW] 记录收缩比例、房间位置、床位姿态修订 ADR-0020、互动本地化的取舍与回滚路径
README.md                                        # [MODIFY] 地图尺度、房间与家具、Z/X/F 操作说明
```

## 关键接口
```ts
export type SeatKind = 'chair' | 'toilet' | 'stool' | 'sofa' | 'bed';

export function seatPose(kind: SeatKind): Pose;
// bed -> POSE.Lie；其余 -> POSE.Sit

export interface DoorSpec {
  side: 'north' | 'south' | 'east' | 'west';
  from: number;
  to: number;
}

export interface InteractionState {
  pose: Pose;
  seated: boolean;
  seatKind: SeatKind | null;
  moving: boolean;
  seatAvailable: boolean;
  bedAvailable: boolean;
}

export type InteractionIntent =
  | { kind: 'sit-seat' }
  | { kind: 'sit-ground' }
  | { kind: 'lie-bed' }
  | { kind: 'lie' }
  | { kind: 'stand' }
  | { kind: 'jump' }
  | { kind: 'emote'; animated: boolean }
  | { kind: 'wave' }
  | { kind: 'interact' }
  | { kind: 'blocked'; hint: string };
```


## Agent Extensions

### Skill
- **impeccable**
  - Purpose: 为动作条与触屏动作盘新增「互动」按钮做 UI 收尾，检查间距、焦点态、aria 与可点击区域。
  - Expected outcome: 桌面与触屏两套动作入口视觉一致，新增按钮不破坏原有布局与可访问性。

- **principal-software-architect**
  - Purpose: 复核「床位姿态归属座位类型」「互动留在客户端」「布局收缩无运行时开关」三项决策，并按项目 ADR 结构写 ADR-0024。
  - Expected outcome: ADR 记录备选方案、代价、回滚路径与复核信号，修订 ADR-0020 的「座位上不能躺」。

### SubAgent
- **code-explorer**
  - Purpose: 在布局重排前做一次全量坐标引用核对，列出所有依赖岛界、河道、湖、林地、铺装、座位与道具坐标的调用点与断言。
  - Expected outcome: 输出改动文件清单与「坐标被引用位置」清单，确保没有遗漏小地图、撒树留白、测试断言与渲染裁剪。
