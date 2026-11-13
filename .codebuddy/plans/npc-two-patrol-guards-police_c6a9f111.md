---
name: npc-two-patrol-guards-police
overview: 园区改为 2 个普通同事 + 3 个保安，全部在整座岛随机漫游；彻底移除 NPC 发言功能；新增警察装扮（警帽、肩章与反光条）与头顶红蓝闪烁警灯，并通过新增协议角色字段让客户端可靠识别保安。
todos:
  - id: police-cosmetics
    content: 新增警帽与肩章像素件、追加外观目录并在捏人界面隐藏，补像素测试
    status: completed
  - id: npc-roster
    content: 配置改为 2 同事 + 3 保安，名册删除发言字段并增加警服外观与角色
    status: completed
    dependencies:
      - police-cosmetics
  - id: island-roam-and-silence
    content: 全岛采样替换区域体系，删除 NPC 发言链路，更新 brain、social、director 与 server
    status: completed
    dependencies:
      - npc-roster
  - id: role-protocol
    content: 新增 0xfd 角色尾段，服务端 Player.role 与 spawn 编码，补协议测试
    status: completed
    dependencies:
      - npc-roster
  - id: beacon-render
    content: 客户端接收角色字段，头顶绘制红蓝闪烁警灯并补相位测试
    status: completed
    dependencies:
      - role-protocol
  - id: docs-adr-release
    content: Use [skill:domain-modeling] 更新 README、新增 ADR 与版本工报
    status: completed
    dependencies:
      - island-roam-and-silence
      - role-protocol
      - beacon-render
  - id: verify-all
    content: 运行资源生成、全仓测试、类型检查与 changelog 校验并修复回归
    status: completed
    dependencies:
      - docs-adr-release
---

## 产品概述
调整园区服务端 NPC：普通同事改为 2 位，新增 3 位穿警服、头顶闪烁警灯的保安，共 5 位；所有 NPC 不再局限于广场与房间附近，而是在整座岛随机漫游；彻底移除 NPC 在频道发言的能力，只保留走动、张望、让路与招手等动作。

## 核心功能
- **人数调整**：2 位普通同事 + 3 位保安，共 5 位；`GAME_NPC_COUNT` 默认 2 控制普通同事，`GAME_NPC_ENABLED=0` 或 `GAME_NPC_COUNT=0` 仍可整批关闭（含保安）。
- **全岛自动行为**：取消原有的广场、工作区、宿舍、会议室、主路等固定活动区域，NPC 在整座岛的可行走范围内随机选点漫游，跨区域自由移动；为便于进场发现，保留 1 位同事与 1 位保安出生在广场附近，之后同样走向全岛。
- **移除 NPC 发言**：删除 NPC 台词池、发言计时、弹幕颜色、外置台词审核与 `GAME_NPC_CHAT` 配置；NPC 不再进入聊天历史、不产生任何聊天广播。玩家聊天与 `broadcastChatLine` 保持原样。
- **警察装扮**：保安使用深藏蓝制服配色，新增专用像素件「大檐警帽」与「肩章 + 胸前反光条」，组合成完整警服；警用件不出现在捏人界面，玩家无法自行穿戴。
- **头顶警灯**：保安头顶显示红蓝双色警灯，约 400ms 交替明暗，位于昵称与状态文字上方，不被树冠遮挡；普通同事与真人没有警灯。
- **身份可靠**：服务端通过新增 spawn 尾段下发角色类型，客户端据此绘制警灯；旧客户端只表现为「没有警灯」，玩家无法通过改名字或状态伪装成保安。

## 视觉与交互
保安远看是深蓝警服 + 大檐帽，近看有肩章与反光条；头顶红蓝灯交替闪烁，在夜间与人群中都容易辨认。除以上变化外，工牌、工号、部门、外观渲染、AOI 与碰撞表现保持现状。


## 技术栈
- 服务端：TypeScript + Bun，模块位于 `apps/game-server/src/npc/`。
- 协议与模型：`packages/shared-types`（32 字节外观编码、spawn 尾段扩展）。
- 像素资产：`packages/pixel-assets` 的程序化像素绘制与图集生成，根命令 `pnpm run assets`。
- 客户端：PixiJS + Web Worker/OffscreenCanvas，改动集中在 `apps/web/lib/game/`。
- 测试：`bun:test`、`pnpm typecheck`、`pnpm changelog:check`。

## 实现方案

### 1. 服务端：2 位同事 + 3 位保安
- `config.ts`：`DEFAULT_NPC_CONFIG.count` 改为 2；删除 `chat`、`chatDelayMs`、`chatLines`、`regions` 字段与 `readChatLines`、`readRegionOverrides`、`GAME_NPC_CHAT` 解析；`GAME_NPC_CONFIG` 只保留 `speed`、`pauseMs`、`socialIntervalMs`。
- `roster.ts`：
  - `NpcProfile` 删除 `chatColor`，新增 `role: 0 | 1`（0 普通，1 保安）。
  - 导出 `GUARD_COUNT = 3`；`buildNpcRoster` 改为 `buildNpcRoster(rng, { workers, guards }, options)`，一次生成 `workers + guards` 个互不重名的名字，再分别分配普通外观或保安外观。
  - 新增 `buildGuardAppearance(rng)`：深藏蓝 body、深色 pattern、金色 neckwear 色槽，`headwear: 'police_cap'`、`neckwear: 'epaulette'`、`eyewear: 'sun'` 或 `'none'`、`hairstyle: 'buzz'`；物种、角/鬃、尾巴仍随机。
  - 保安 `status` 为空串，避免头顶状态行与警灯拥挤；普通同事保留随机状态池。
  - 删除 `NPC_CHAT_LINES` 与全部台词相关代码。
- `director.ts`：
  - 生成计划：`workers: config.count`、`guards: GUARD_COUNT`；`count <= 0` 或 `enabled=false` 时整批不生成，保持完整回滚。
  - 出生点：第 1 位同事与第 1 位保安出生在广场中心附近（`findFreePoint(WORLD_CENTER.x, WORLD_CENTER.y + 200, PLAYER_RADIUS, true)`），其余全岛随机；之后行为没有区域限制。
  - 删除 `PLAZA_SEATS`、`chooseRegion`、`resolveRegions`、`chatHistory`、`inspect`、`chatLines`。
  - `NpcDirector` 增加 `readonly guardCount`，供 `/health` 与启动日志区分。
  - 异常坐标兜底改为 `findFreePoint(player.x, player.y, PLAYER_RADIUS, true)`，不再依赖固定区域圆心。

### 2. 全岛漫游
- `spots.ts` 删除 `NpcRegion`、`NPC_REGIONS`、`resolveRegions`、`pickRegion`，改为：
  - `pickWaypoint(rng, from?)`：在 `WORLD_BOUNDS`（`ISLAND.bounds`）矩形内均匀采样，`isBlocked(x, y, PLAYER_RADIUS)` 过滤海与障碍，重试最多 24 次；与前一点距离小于 240px 的点在大部分尝试中拒绝，避免走两步就停；失败时用 `findFreePoint` 就近兜底。
  - `pickSpawnPoint(rng)`：同一套全岛采样，初始点额外要求距离其他 NPC 至少 160px，避免 5 人叠在一起。
- `brain.ts` 删除 `NpcAgent.region`、`chatColor`、`nextChatAt`；`createAgent` 不再接收 region；`enterWalk` 与卡住换点改调 `pickWaypoint(rng, currentPosition)`。
- `social.ts` 只保留对视、让路、招手；`NpcSocialContext` 收缩为 `world`、`config`、`rng`；删除发言分支、`LONELY_RECHECK_MS`、`transport`、`history`、`chatLines`。
- `server.ts` 删除传给 director 的 `chatHistory` 与 `inspect`，启动日志改为 `count`、`workers`、`guards`、`seed`；`/health.npc` 增加 `guards`。

### 3. spawn 角色尾段
- 新建 `packages/shared-types/src/role.ts`：
  - `ENTITY_ROLE_PLAYER = 0`、`ENTITY_ROLE_GUARD = 1`。
  - `ROLE_EXTENSION_MAGIC = 0xfd`、`ROLE_EXTENSION_BYTES = 2`。
  - `SpawnPacket` 增加可选 `role?: number`。
- `protocol.ts`：
  - `encodeSpawnInto` 末尾增加可选 `role` 参数，在 `writeLikeSegment` 之后调用 `writeRoleSegment`；`role <= 0` 时一个字节都不写。
  - `readRoleSegment(data, offset)` 不消费调用方 offset，长度不足或 magic 不符返回 `undefined`。
  - `decodeSpawn` 的 status 魔数排除表加入 `0xfd`；role 读取位置为 `likes 段起点 + (likes 段存在 ? 3 : 0)`。
  - `encodeSpawn` 容量预算增加 2 字节。
- `sim/world.ts`：`Player` 增加 `role = 0`，`reset()` 归零；`createNpc` 增加末尾可选 `role = 0` 参数。
- `sim/view.ts`：`encodeSpawnInto` 传入 `player.role`。
- 兼容性：旧客户端读到 `0xfd` 会把 status 长度判为非法并停止解析尾段，表现为没有警灯且丢失保安的 career/likes，不会崩溃；新客户端完整解析。

### 4. 整套警服像素件
- `packages/shared-types/src/catalog.ts`：
  - `HEADWEAR_IDS` 末尾追加 `'police_cap'`（index 9）。
  - `NECKWEAR_IDS` 末尾追加 `'epaulette'`（index 6）。
  - 旧 id 编号不变，32 字节外观编码长度与 reserved 字节不动。
- `packages/pixel-assets/src/cosmetics.ts`：
  - `COSMETIC_CATALOG.head` 追加 `'police_cap'`，`neck` 追加 `'epaulette'`，顺序与 shared-types 一致。
  - `drawHeadwear` 新增 `police_cap`：正面帽顶 + 帽箍 + 向前伸出的帽檐 + 2×2 帽徽亮块；侧面同构并前伸；背面只留帽顶与后箍。保持纯灰度、留白、三朝向有像素。
  - `drawNeckwear` 新增 `epaulette`：左右肩章各 3×2 亮块，胸前两条横向反光条；侧面与背面按朝向调整，保证镜像两次回到原图。
  - 锚点由现有解剖学 `cosmeticAnchors` 自动推导，无需按 id 新增。
- 捏人界面隐藏警用件：`creator-store.ts` 导出过滤后的 `PLAYER_HEADWEAR_IDS`（排除 `police_cap`）与 `PLAYER_NECKWEAR_IDS`（排除 `epaulette`），`partCatalog` 与 `PartRail.tsx` 的 `cosmeticGroup` 使用过滤后的数组；随机外观入口同样不包含警用件。

### 5. 客户端警灯
- 新建 `apps/web/lib/game/police-beacon.ts`：
  - `BEACON_PERIOD_MS = 400`、`BEACON_WIDTH`、`BEACON_HEIGHT`。
  - `beaconPhase(now)` 返回 0 或 1，非有限时间按 0 处理；纯函数可单测。
- `session.ts`：新增 `roleById` 侧表；`handleSpawn` 保存 `packet.role ?? 0` 并传给 `renderer.addEntity`；`despawn` 时清理。
- `renderer.ts`：
  - `addEntity(id, name, appearance, status, x, y, role = 0)`；`EntityView` 构造参数增加 role。
  - `EntityView` 在 role 为 `ENTITY_ROLE_GUARD` 时创建 `beacon` 容器：深色底座 + 红、蓝两个 3×3 灯珠，挂在 `labels` 容器内，位置在头顶文字最上方（状态行存在时位于状态行之上，否则位于昵称上方 3px），anchor 为底部居中。
  - `updateBeacon(now)`：按 `beaconPhase(now)` 切换红蓝灯珠 alpha（亮 1 / 暗 0.25），无 beacon 时首行早退。
  - `GameRenderer` 维护 `beacons: Set<EntityView>`；addEntity 成功且 role 为保安时加入，removeEntity 时删除；`tickBubbles` 只遍历这个集合更新，避免给 200 个实体每帧做无效判断。
- 警灯挂在 `labels` 容器，天然不被树冠遮挡；不进入 ECS，不增加协议负载。

### 6. 测试与文档
- 服务端测试：`config.test.ts` 默认 2、无 chat 字段；`roster.test.ts` 2+3、名字唯一、保安 role 与警服外观、64 个名字仍不重名；`spots.test.ts` 全岛采样落在可行走位置、覆盖跨度足够大、同种子可复现；`brain.test.ts` 不再依赖 region；`social.test.ts` 删除发言组；`director.test.ts` 共 5 个、3 个保安、count=0 全关；`integration.test.ts` 广场至少 2 位可见、role 段正确解码。
- 协议测试：role 尾段往返、无 role 旧包、role 与 likes/career 共存、status 排除表正确。
- 像素测试：新增 id 与目录顺序一致、每朝向有像素、灰度、镜像往返；补警帽帽檐与肩章反光条的像素断言。
- 客户端：`police-beacon.test.ts` 验证相位交替与周期；typecheck 覆盖 renderer/session 签名。
- 文档：更新 `README.md` 的数量、全岛漫游、删除发言与 `GAME_NPC_CHAT`、警服与警灯说明；新增 `docs/adr/0063-npc-guards-and-role-field.md`，记录角色尾段、兼容性与回滚；不修改历史 ADR-0061。
- 版本工报：`apps/web/data/release-notes.json` 顶部追加 `2026-11-13-1`，面向玩家描述人数、保安、全岛巡逻与不再发弹幕。

## 性能与可靠性
- 全岛采样只在换路点与出生时执行，单次最多 24 次 `isBlocked` 查询；5 个 NPC 不会进入 20Hz 热路径。
- 警灯只对 3 个保安创建，使用 Set 定向更新，不增加全体实体的每帧开销。
- 协议尾段只在保安实体上多 2 字节，普通玩家与普通同事的包体不变。
- 删除 NPC 发言后，NPC 不再触发聊天历史、广播与审核路径，流量与 CPU 均下降。
- 回滚：`GAME_NPC_ENABLED=0` 或 `GAME_NPC_COUNT=0` 关闭全部 NPC；协议 role 段为可选尾段，旧客户端自动降级。

## 架构设计
沿用现有门面分层，不新增服务或持久化：
- `config` 负责默认值与校验；`roster` 负责姓名、外观、角色与考勤；`spots` 负责全岛落点；`brain` 负责行为状态机；`social` 只负责肢体互动；`director` 是唯一门面。
- 数据流：`loadNpcConfig` 生成数量与节奏，`createNpcDirector.spawn` 调 `buildNpcRoster` 生成 2+3 份档案，`world.createNpc` 写入实体并设置 `role`，`view.ts` 在 spawn 包尾部写入 0xfd 角色段；客户端 `session.handleSpawn` 保存 role，`renderer.addEntity` 为保安创建警灯，`tickBubbles` 按时间相位闪烁。
- 像素资产：`catalog.ts` 追加 id，`cosmetics.ts` 绘制图标，`pnpm run assets` 重新生成图集，客户端按 catalog 渲染。

## 目录结构
```text
packages/shared-types/src/
├── role.ts                                   # [NEW] 角色常量与 0xfd 尾段定义
├── types.ts                                  # [MODIFY] SpawnPacket 增加 role
├── protocol.ts                               # [MODIFY] role 段读写、status 排除表、容量预算
├── catalog.ts                                # [MODIFY] 追加 police_cap / epaulette
└── __tests__/
    ├── protocol.test.ts                      # [MODIFY] role 段往返与兼容
    └── appearance-guofeng.test.ts            # [MODIFY] 新 id 追加编号断言

packages/pixel-assets/src/
├── cosmetics.ts                              # [MODIFY] 绘制警帽与肩章/反光条，同步目录
└── __tests__/cosmetics.test.ts               # [MODIFY] 新件像素、灰度、镜像断言

apps/game-server/src/
├── npc/config.ts                             # [MODIFY] 默认 2、删除 chat 与 regions 配置
├── npc/roster.ts                             # [MODIFY] 2+3 名册、role、警服外观、删台词
├── npc/spots.ts                              # [MODIFY] 全岛采样替换区域体系
├── npc/brain.ts                              # [MODIFY] 去 region、去发言字段
├── npc/social.ts                             # [MODIFY] 只保留肢体互动
├── npc/director.ts                           # [MODIFY] 2+3 生成、全岛出生、guardCount
├── npc/index.ts                              # [MODIFY] 按需导出 GUARD_COUNT
├── npc/config.test.ts                        # [MODIFY] 默认 2 与配置字段
├── npc/roster.test.ts                        # [MODIFY] 2+3、role、警服、唯一性
├── npc/spots.test.ts                         # [MODIFY] 全岛采样
├── npc/brain.test.ts                         # [MODIFY] 去 region 后的行为断言
├── npc/social.test.ts                        # [MODIFY] 删除发言组
├── npc/director.test.ts                      # [MODIFY] 5 个、3 保安、回滚
├── npc/integration.test.ts                   # [MODIFY] 广场可见数与 role 解码
├── sim/world.ts                              # [MODIFY] Player.role、createNpc 参数
├── sim/view.ts                               # [MODIFY] spawn 包写入 role
└── server.ts                                 # [MODIFY] 去聊天传参、日志与 /health

apps/web/
├── lib/game/police-beacon.ts                 # [NEW] 警灯相位纯函数与尺寸常量
├── lib/game/__tests__/police-beacon.test.ts  # [NEW] 相位交替与周期
├── lib/game/session.ts                       # [MODIFY] roleById 与 addEntity 传参
├── lib/game/renderer.ts                      # [MODIFY] EntityView 警灯与定向更新
├── lib/creator-store.ts                      # [MODIFY] 过滤警用件、partCatalog
├── components/creator/PartRail.tsx           # [MODIFY] 使用过滤后的目录
└── data/release-notes.json                   # [MODIFY] 追加 2026-11-13-1

README.md                                       # [MODIFY] 数量、全岛、删发言、警服与警灯
docs/adr/0063-npc-guards-and-role-field.md      # [NEW] 保安角色与协议尾段决策记录
```


## Agent Extensions
### SubAgent
- **code-explorer**
  - Purpose: 实现前核对 catalog、cosmetics、manifest、renderer 与 session 的实际调用链，确认新增外观 id、role 参数与警灯挂点没有遗漏。
  - Expected outcome: 输出一份带文件路径与行号的接线清单，降低跨端改动漏改风险。
### Skill
- **domain-modeling**
  - Purpose: 按项目现有 `docs/adr/` 格式撰写本次「NPC 保安角色与 spawn 角色尾段」的架构决策记录。
  - Expected outcome: 生成 `0063-npc-guards-and-role-field.md`，包含背景、决策、兼容性、回滚与复访触发条件。
