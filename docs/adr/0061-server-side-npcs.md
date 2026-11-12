# ADR-0061：服务端权威同事，复用真人实体通道

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（「部署后每个服务器自动生成 10 个随机走走停停的 NPC」）、服务端模拟、AOI/同步层
- **Tags:** npc, aoi, simulation, bandwidth, zero-persistence
- **Supersedes / superseded by:** 不推翻 ADR-0003（AOI 对称）、ADR-0043（去脏与紧凑同步）、ADR-0004（零持久化）；新增「实体」与「真人」两条口径的分离

## Context

园区需要一批看起来像真人的同事：部署后自动出现 10 位，会沿着广场、工位、宿舍与庭院走走停停，停下时四处张望，迎面有人会让路，偶尔在频道说一句职场黑话；被玩家创飞后自己爬起来，不还手。玩家端不做任何改动，也看不出他们是 NPC。

现状里 `Player` 同时承担两件事：

1. **角色实体**：坐标、朝向、姿态、外观、工牌、AOI 订阅、同步广播；
2. **连接**：`wsId`、聊天限速、点赞去重、考勤上报。

AOI、去脏广播、地形碰撞与工牌渲染都长在「角色实体」这一侧，且已经被 200 人压测验证过。重新造一套 NPC 实体意味着复制这些能力，并让客户端同时理解两套实体。

硬约束：

- 服务端零持久化：NPC 只活在进程内存，重启重新生成；
- 协议不改一个字节：旧客户端、旧服务端、压测机器人都不能因此错位；
- 玩家端零改动：NPC 走同一条 `S2C_ENTITY_SPAWN` / `S2C_SYNC_ENTITIES` / `S2C_CHAT_BROADCAST`；
- 人数容量、排队闸门、牛马榜与 `/health.online` 只认真人；NPC 永远不占真人名额；
- 出口带宽是物理共享的，不能从实测水位里「扣掉」NPC 的字节。

## Quality scenarios and invariants

```text
QUALITY | 开服即有同事 | source: 玩家 | stimulus: 打开 /play | environment: 单园区默认部署 | artifact: World / NpcDirector | response: 广场视野内至少看到 4 位同事 | measure: spawn 包 ≥ 4 且首帧即渲染 | priority: 高
QUALITY | 不占真人名额 | source: 真人玩家 | stimulus: GAME_NPC_COUNT 从 0 调到 64 | environment: GAME_MAX_ONLINE=60 | artifact: admission.decide / /health.online | response: capacity 与 online 口径不变 | measure: 只有实测带宽水位可能上升 | priority: 高
QUALITY | 静止零发包 | source: 观察者 | stimulus: 同事站着发呆 | environment: 20Hz Tick | artifact: runTick / markDirtyIfChanged | response: 该同事一个同步条目都不产生 | measure: 连续两 Tick 的 packets = 0 | priority: 高
QUALITY | 不穿墙不卡死 | source: 同事 | stimulus: 目标点落在树后 / 墙角 | environment: 静态地形 | artifact: resolveMotionInto + 卡住恢复 | response: 沿墙滑行，连续两次挪不动就换点，五次就原地休息 | measure: 位置始终 isBlocked=false，且 2 分钟内离开原位 > 40px | priority: 高
QUALITY | 单人异常不拖垮 Tick | source: 同事 | stimulus: 坐标被写成 NaN | environment: 20Hz Tick | artifact: director.update | response: 拉回区域安全点并继续 | measure: Tick 不抛出、其余同事照常推进 | priority: 中
QUALITY | 回滚一条环境变量 | source: 运维 | stimulus: 同事引发投诉或带宽吃紧 | environment: 生产 | artifact: GAME_NPC_COUNT | response: 设为 0 重启即完全关闭 | measure: 无协议 / 客户端 / 数据迁移 | priority: 高
```

不变量：

- NPC 的 `wsId = 0`，`humans` 只在 `World.create`（真人）时增加，`destroy` 按 `isNpc` 分别减账。
- 准入、排队、牛马榜、`/health.online` 只读 `world.humans`；`world.size` 仍是总实体数。
- NPC 的 `known` 与真人双向对称，否则它感知不到附近的人，也无法让路。
- 同事的坐标、朝向、姿态全部走 `resolveMotionInto` 与 `packState`，与真人同一套权威路径。
- 外置台词的审核失败即整条丢弃（fail-closed），未审文本不进频道。

## Decision

采用「**服务端内存实体，复用 `Player` 与现有实体通道**」：

- `Player` 只增加 `isNpc`，其余字段原样复用；
- `World` 增加 `createNpc` 与 O(1) 的 `humans` / `npcCount`；
- 行为态（路点、停顿、卡住计数、台词冷却）收在 `npc/director` 私有的 `Map<id, NpcAgent>`，不进 `Player.reset()`；
- 每 Tick 在 `resolveVents` 之后、`runTick` 之前推进：新坐标与朝向赶在同一帧广播；
- `view` / `tick` 对 `wsId === 0` 短路：不为 NPC 编码、不写 NPC 的发送缓冲，但保留 `known` 维护；
- 聊天核心抽出 `broadcastChatLine`，玩家与同事共用同一份 msgId 与历史；
- 外置配置 `GAME_NPC_CONFIG` 与 `GAME_NPC_COUNT` / `GAME_NPC_SEED` / `GAME_NPC_CHAT` / `GAME_NPC_INTERACT`，文件损坏只告警不阻断开服。

## Alternatives considered

| 方案 | 否决理由 |
|---|---|
| 独立 `Npc` 类型 + 专属协议 | 双端必须同版本发版；要复制 AOI、去脏、碰撞与工牌；回滚成本高。 |
| 纯客户端本地生成 | 各人看到的 NPC 不一致，无法被玩家击中、点赞或共同观察；与「模拟真人」直接冲突。 |
| 让 NPC 也建 WebSocket 连接（服务端自连自己） | 多一层网络与限速，NPC 的移动还要过 `applyMove` 的时间窗；白白消耗 fd 与序列化。 |

## Consequences

**正向**

- 零客户端改动、零协议改动；NPC 自动获得 AOI、去脏广播、地形碰撞、工牌与聊天历史。
- 回滚是一条环境变量：`GAME_NPC_COUNT=0` 重启，无数据迁移。
- 静止同事零发包；10 位同事的 Tick 增量在实测中为微秒级，`/health.npc.updateMs` 可单独观测。

**负向 / 明确不做的**

- NPC 占用实体 id（10 个，远低于 `MAX_ENTITIES=1023`）与真实下行字节；带宽水位按实测计入，不从水位里扣掉——扣掉会让闸门在带宽已满时误判为「还很空」。
- 玩家无法分辨 NPC 与真人（产品选择）：可能有人对 NPC 搭话而没有回应，也可能把 NPC 台词当成真人发言。缓解手段是低频台词 + 固定台词池，不做「AI 同事」标识。
- 不做全图寻路：只用「区域内随机采样 + 碰撞滑行 + 卡住重选」。工作区与宿舍的墙会把同事挡在门口，这是可接受的漫游，不是导航。
- 不做 NPC 占座、上下班作息、对话树与运行时热更。

**数字**

- 默认 10 位；`MAX_NPC_COUNT=64` 只是误配保护，不是推荐值。
- 步速 `0.62–0.95 × MOVE_SPEED`，永不快于真人。
- 停顿三档：短 1.2–3s（10%）、常规 3–12s（70%）、长 20–60s（20%）。
- 发言：首次 60–180s，之后 240–600s，且视野内至少有一名真人。

## Rollback

`GAME_NPC_COUNT=0`（或 `GAME_NPC_ENABLED=0`）后重启进程：不生成、不广播、不发言，世界与协议与改造前完全一致。

## Revisit triggers

- `/health` 的 `admission.dominant` 长期为 `Bandwidth`，且关掉同事后明显回落：考虑把默认数量降到 6 或提高 `GAME_MAX_EGRESS_KBPS`。
- 玩家反馈「园区的同事不会回话」：需要对话树或至少一条自动回复，届时再评估是否引入新的协议段。
- 需要同事占座、上下班作息或跨区域通勤：当前「区域内随机漫游 + 直线滑行」不够，需要导航网格或 A*，成本另算。
- 需要玩家端区分 NPC 与真人（合规或产品透明度）：需要新增一个只读的身份位，属于协议改动，必须双端同版本发版。
