---
name: player-badge-inspect
overview: 为工牌增加「在线时长」与「所在地」，服务端记录入场时间并通过 spawn 包扩展段下发；同时支持桌面点击、手机轻点其他角色弹出其工牌详情（基础信息 + 当前姿态与入座状态）。
design:
  architecture:
    framework: react
  fontSystem:
    fontFamily: Oswald / JetBrains Mono / PingFang SC
    heading:
      size: 20px
      weight: 600
    subheading:
      size: 11px
      weight: 500
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
    background:
      - "#14100C"
      - "#1B1611"
      - "#221B16"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#857463"
    functional:
      - "#F2C879"
      - "#E06A5A"
      - "#4FE3C1"
todos:
  - id: protocol-and-server
    content: 新增 spawn 在线时长扩展段与服务端 joinedAt，补协议测试，用 [skill:principal-software-architect] 写 ADR
    status: completed
  - id: client-badge-model
    content: 实现 badge 纯函数与测试，session 维护 species/status/online 并输出 badgeOf
    status: completed
    dependencies:
      - protocol-and-server
  - id: renderer-picking
    content: renderer 增加屏幕坐标拾取与最近角色判定，session 增加 inspectAt 并排除本地玩家
    status: completed
    dependencies:
      - client-badge-model
  - id: self-badge-hud
    content: 扩展 game-ui 与 SessionStats 的 region/onlineSec，工牌显示所在地与在线时长
    status: completed
    dependencies:
      - client-badge-model
  - id: inspect-card-and-tap
    content: 新建 InspectCard 并接入点击关闭，摇杆轻点转发，使用 [skill:impeccable] 完成双端形态
    status: completed
    dependencies:
      - renderer-picking
      - self-badge-hud
  - id: verify
    content: 运行 typecheck 与全部测试，双端手测点击、轻点/拖动、离线关闭与长文本
    status: completed
    dependencies:
      - inspect-card-and-tap
---

## 用户需求
- 在现有工牌上新增两项实时信息：**在线时长**与**所在地**（园区区域名，如办公区、摸鱼湖、加班林、园区野地等）。
- 支持**点击其他角色**（桌面鼠标）或**轻点其他角色**（手机）打开该角色的工牌详情。
- 他人工牌详情包含：昵称、物种、所在地、在线时长、常驻状态（有则显示）、当前姿态（在岗待命、搬砖中、入座摸鱼、席地而坐、躺平中）以及是否入座。
- 在线时长采用**服务端会话口径**：服务端记录每个人入场时刻并随入场包下发，确保任何人看到的时长都准确；本地玩家从入场成功时开始计时。
- 手机端左半屏是摇杆热区：轻点不移动、仅用于选中人物；只有拖动才产生移动。
- 点击空白处或关闭按钮收起详情；被查看者离开视野时自动收起；详情不引入任何持久化。
- 视觉上沿用现有深墨底、2px 硬边、薄荷绿强调的像素办公 HUD；桌面详情卡放在右上角控件列下方，手机放在动作盘上方，不遮挡主要操作区。

## 产品概述
把工牌从“静态名片”升级为“实时状态卡”：自己的工牌直接显示所在园区区域与本次在线时长；点击园区里的其他牛马，弹出对方的工牌，快速了解对方在哪、在线多久、在干什么。

## 核心功能
- 自身工牌常显所在地与在线时长，随位置与时间实时更新。
- 桌面点击、手机轻点其他角色，打开该角色的工牌详情。
- 他人工牌展示姓名、物种、所在地、在线时长、常驻状态、当前姿态与入座状态。
- 点击空白、关闭按钮或被查看者离开视野时收起详情。
- 手机摇杆区分轻点与拖动，轻点查看、拖动移动。

## 技术栈
- 沿用现有 monorepo：Next.js 15 + React 19 + Tailwind CSS v4 + Zustand 5 + PixiJS 8；服务端 Bun + `Bun.serve` WebSocket；`@niuma/shared-types` 手写二进制协议。无新增依赖。
- 现有约束：服务端零持久化（ADR-0004）；渲染层不在 20Hz 热路径做额外工作；HUD 统一使用 ink/mist/mint 设计令牌与 lucide 图标。

## 实现策略

### 1. 协议：给 S2C_ENTITY_SPAWN 追加在线时长段
- 沿用 ADR-0035 的“尾部追加 + 魔数”扩展方式：`[statusLen u8][status nB][0xfe][onlineSec u32 小端]`；没有状态时直接是 `[0xfe][onlineSec]`。
- `0xfe` 大于 `MAX_STATUS_BYTES`（48），不可能是合法状态长度；旧解码器读完状态后不校验尾部，天然忽略；新解码器先窥视首字节，遇到 `0xfe` 再读 5 字节，缺段时 `onlineSec` 为 `undefined`。
- `SpawnPacket` 增加 `onlineSec?: number`；`encodeSpawnInto` 增加可选参数，只在传入时写扩展段；`encodeSpawn` 透传；`buildSpawnBody` 与 `spawnBodyCache` 不变（在线秒数每秒变化，不能进缓存）。
- 备选与取舍：

| 方案 | 收益 | 代价 / 不可逆性 | 结论 |
|---|---|---|---|
| A 尾部追加（采用） | 入场包一包拿全，零额外往返，旧客户端忽略尾部 | 每个入场包 +5 字节；纯追加，30 天内可无迁移回滚 | 采用 |
| B 客户端首次看到起算 | 零协议改动 | 入服前已在线的人时长明显偏短，口径不准确 | 拒绝 |
| C 新增查询 opcode | 协议语义独立 | 多一次往返，需处理迟到、丢失与重连；改动面更大 | 拒绝 |

- 回滚路径：删除 `encodeSpawnInto` 的扩展写入与 `decodeSpawn` 的读取即可，既有字段偏移不变，不涉及数据迁移。

### 2. 服务端：入场时刻只在内存
- `Player` 增加 `joinedAt`（毫秒），`World.create` 增加可选 `joinedAt` 参数并写入，`reset()` 清零；`admit` 把已有的 `now` 传进去。
- `sim/view.ts` 的 `spawnPacketOf` 每次现算 `Math.max(0, Math.floor((Date.now() - joinedAt) / 1000))` 并传给 `encodeSpawnInto`。只发生在视野重算，不在 20Hz Tick 热路径。
- 不新增日志、不写磁盘；进程重启或断线重连即重置，符合 ADR-0004。

### 3. 客户端：会话数据与计时
- `session.ts` 新增 `welcomeAt`，以及 `species`、`statuses`、`online` 三张映射；在 `handleWelcome`、`handleSpawn`、`onAppearance`、`onStatus`、`handleDespawn`、`clearWorld` 中维护。
- 远端在线秒数 = 入场包携带的 `onlineSec` + 本地 `performance.now()` 相对接收时刻的增量；本地玩家 = 本地 `welcomeAt` 起算。不使用服务端绝对时间，规避客户端时钟偏差。旧服务端缺段时按 `0` 起算，退化为“首次看到起算”。
- `SessionStats` 增加 `region` 与 `onlineSec`，沿用现有 500ms `onStats` 节奏；`game-ui.ts` 增加同名字段，`PlayerCard` 直接读取。
- 新增纯模块 `apps/web/lib/game/badge.ts`：`PlayerBadge` 类型、`formatOnline`、`poseLabel`、`seatLabel`、`pickCharacter`（脚底锚点、半宽 20、纵向 -74 到 6 的拾取盒，最近者胜）。纯函数，便于 `bun:test`。
- `session.badgeOf(id)` 汇总昵称、物种、状态、`regionAt`、姿态、`entitySeat` 与 `seatById`；`session.inspectAt(stageX, stageY)` 调用 renderer 拾取并排除本地玩家。

### 4. 拾取与输入
- `renderer.pickEntityAt(stageX, stageY)`：`worldX = (stageX - world.x) / metrics.cssScale`，`worldY` 同理；只遍历 `views` 中 `isShown` 的实体，返回最近命中；点击频率低，允许一次小数组分配。
- 桌面：宿主 `onPointerDown` 记录“从画布开始按压”并沿用 `closePanels`；`onPointerUp` 用 `nativeEvent.offsetX/offsetY`（舞台局部 CSS 像素）调用 `inspectAt`，空点清除选中；忽略非左键。
- 手机：右半屏走宿主；左半屏 `Joystick` 增加轻点判定——按下记录位置与时刻，移动超过 10px 或按住超过 320ms 视为拖动，否则 `onTap(offsetX, offsetY)` 转发点选且不改变移动向量。旋转舞台沿用现有 `offsetX/offsetY` 约定。
- `InspectCard` 以 1Hz 轮询 `badgeOf`，玩家离开 AOI 或会话清空时返回 null 并自动关闭；关闭按钮与点击空白均可关闭；交互控件加 `data-no-immersive`。

### 5. 分层与改动边界
- 改动分层：契约层（shared-types）→ 服务端投影（`sim/view.ts`）→ 客户端会话聚合（`session.ts`）→ 拾取（`renderer.ts`）→ 展示（`Hud.tsx`、`InspectCard.tsx`）。
- 不修改碰撞、同步、座位占用、聊天、准入队列与状态编辑的既有路径。

证据基线：
```text
BASELINE | packages/shared-types/src/protocol.ts | expected: 尾部扩展可被旧解码器忽略 | observed: ADR-0035 的 status 段已按尾部追加落地，decodeSpawn 读完外观后才读可选段 | fit: align | 本次沿用同一 seam
BASELINE | apps/web/lib/game/renderer.ts | expected: 渲染层只做表现，不依赖网络协议 | observed: EntityView 已持有脚底坐标与可见标记，适合新增纯几何拾取 | fit: align | 本次只加 pickEntityAt
```

## 架构设计
- 数据流一：服务端 `joinedAt` → spawn 扩展段 → `GameSession` 三张映射 → `badgeOf` → `PlayerCard` / `InspectCard`。
- 数据流二：画布 `pointerup` / 摇杆 `onTap` → `renderer.pickEntityAt` → `session.inspectAt` → `GameViewport` 的 `inspectId` → `InspectCard`。
- 新增代码集中在 `badge.ts`（纯逻辑）、`session.ts`（数据聚合）、`InspectCard.tsx`（展示），不引入新服务、状态库或组件库；渲染热路径不变。

## 目录结构
```text
packages/shared-types/
├── src/constants.ts                     # [MODIFY] 新增 ONLINE_EXTENSION_MAGIC 与 ONLINE_EXTENSION_BYTES，注释说明与 MAX_STATUS_BYTES 的关系。
├── src/types.ts                         # [MODIFY] SpawnPacket 增加 onlineSec?: number。
├── src/protocol.ts                      # [MODIFY] encodeSpawnInto / encodeSpawn 支持 onlineSec；decodeSpawn 窥视 0xfe 扩展段；保持旧包可解。
└── src/__tests__/protocol.test.ts       # [MODIFY] 增加有/无 onlineSec、status 与 onlineSec 同时存在、截断扩展段、旧包兼容用例。

apps/game-server/
├── src/sim/world.ts                     # [MODIFY] Player.joinedAt；reset 清零；World.create 增加 joinedAt 参数并写入。
├── src/server.ts                        # [MODIFY] admit 调用 world.create 时传入已有的 now。
└── src/sim/view.ts                      # [MODIFY] spawnPacketOf 现算在线秒数并传给 encodeSpawnInto；保持 spawnBody 缓存不变。

apps/web/
├── lib/game/badge.ts                    # [NEW] PlayerBadge、formatOnline、poseLabel、seatLabel、pickCharacter 及拾取盒常量。
├── lib/game/__tests__/badge.test.ts     # [NEW] 时长格式化、姿态与入座文案、拾取最近者与边界。
├── lib/game/session.ts                  # [MODIFY] 维护 welcomeAt、species、statuses、online；实现 badgeOf / inspectAt；SessionStats 增加 region 与 onlineSec。
├── lib/game/renderer.ts                 # [MODIFY] pickEntityAt：屏幕到世界反变换与最近角色拾取。
├── lib/game-ui.ts                       # [MODIFY] 增加 region / onlineSec 字段并在 setStats 写入。
├── components/game/Hud.tsx              # [MODIFY] PlayerCard 显示所在地与在线时长（桌面常显、手机展开态）；保留现有状态编辑。
├── components/game/InspectCard.tsx      # [NEW] 他人工牌详情卡：姓名、物种、所在地、在线时长、状态、姿态、入座；1Hz 刷新、关闭按钮、无障碍标签。
├── components/game/GameViewport.tsx     # [MODIFY] inspectId 状态、宿主 pointerup、桌面右栏与手机底部渲染、关闭逻辑。
└── components/game/TouchControls.tsx    # [MODIFY] Joystick 轻点/拖动判定与 onTap 转发。

docs/adr/0036-badge-online-and-inspect.md # [NEW] 记录协议扩展、服务端 joinedAt、客户端计时、拾取与移动端轻点决策，含备选方案与回滚。
```

## 关键结构
```ts
interface PlayerBadge {
  id: number;
  name: string;
  species: Species;
  status: string;
  region: string;
  onlineSec: number;
  pose: Pose;
  seated: boolean;
  seatKind: SeatKind | null;
}
```

## 实施注意
- 不把 `onlineSec` 放进 `buildSpawnBody` 或 `spawnBodyCache`；它每秒变化，写进缓存会让后续进入视野的人看到旧值。
- `spawnPacketOf` 不在 Tick 热路径；`Date.now()` 只在此处与 `World.create` 使用，客户端计时统一用 `performance.now()`。
- `ByteWriter.u32` 为小端，扩展段读写必须使用同一端序；截断包或缺失段一律回退 `undefined`，不得越界读取。
- 拾取只在点击/轻点时执行，O(可见角色数)，不上帧循环；`views` 遍历中跳过 `isShown` 为 false 的实体。
- `InspectCard` 的轮询定时器必须在卸载时清理；`badgeOf` 返回 null 时立即关闭，避免显示已下线玩家的旧数据。
- 离线或重连中，自身工牌在线时长显示 `--:--`；不把断线时间计入会话时长。
- 不新增玩家昵称、状态或坐标日志；现有 moderation 日志只记录 verdict 与 wsId，保持不动。
- 长昵称、长状态在卡片内截断，不撑破 240px 桌面宽度与手机自适应宽度；关闭按钮保留 `aria-label` 与全局 focus-visible 焦点环。
- 验证：`pnpm typecheck`、`pnpm test`；再用两个浏览器窗口互点、断线重连、手机模拟器轻点与拖动各测一遍。

## 设计风格
工业像素办公 HUD：暖墨底、2px 硬边、无圆角、薄荷绿单一冷色强调。新卡片是现有工牌的“访客副本”，沿用既有 ink/mist/mint 令牌与 Oswald、JetBrains Mono、PingFang SC 字体，不引入新色系或新组件库。

## 布局
- 自身工牌：桌面在姓名下方常显一行「所在地 · 在线 HH:MM:SS」；手机折叠条保持一行姓名，展开后在姓名下方出现同一行。
- 他人工牌：桌面叠在右上角控件列下方，宽 240px；手机在动作盘上方居中浮出，宽 min(320px, 92vw)，不铺全屏遮罩。
- 卡片结构自上而下：头部（工牌 / 他人 / 关闭）、姓名与物种标签、所在地、在线时长、常驻状态（有则显示）、当前姿态、入座状态、底部「点击空白处关闭」。

## 交互与动效
- 点击或轻点角色即打开；点击空白或 X 关闭；被查看者离开视野自动收起。
- 在线时长每秒刷新；姿态、入座与所在地随会话数据刷新。
- 仅使用边框与文字颜色的 150ms 过渡，不使用 bounce、发光渐变或弹窗动画；焦点环沿用全局 mint 样式。
- 手机端轻点摇杆热区不产生位移；只有拖动才移动。

## 响应式与可访问性
- 桌面 240px、手机自适应宽度；长昵称与长状态截断省略，不撑破卡片。
- 关闭按钮有 aria-label；卡片有 aria-label；可交互元素保留 focus-visible；卡片本身不抢键盘焦点。

## Skill
### principal-software-architect
- Purpose: 复核 spawn 尾部扩展段的兼容性、性能与回滚成本，按项目惯例产出 ADR-0036。
- Expected outcome: 协议布局、服务端 joinedAt 生命周期、备选方案与回滚路径有明确记录，既有字段偏移不变。

### impeccable
- Purpose: 按现有像素 HUD 语言塑造并收尾他人工牌卡与自身工牌新增信息行，检查可访问性与响应式。
- Expected outcome: 桌面右栏与手机底部两种形态一致，无新色系与反模式，焦点态、关闭态与长文本截断均可用。
