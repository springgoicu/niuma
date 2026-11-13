# ADR-0063：NPC 全岛漫游、移除发言，保安身份走 spawn 角色尾段

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** 用户（需求确认）、服务端模拟、协议层、客户端渲染
- **Tags:** npc, protocol, cosmetics, rendering, zero-persistence
- **Supersedes / superseded by:** 修订 ADR-0061 的数量、活动范围与发言口径；不改写历史 ADR

## Context

需求是「NPC 改为 2 个、全地图自动行为、删除有人就发弹幕的逻辑，只保留动作；另外增加 3 个警察装扮的保安，头顶闪烁警灯」。现状与约束：

- ADR-0061 的 NPC 仍按广场 / 工作区 / 宿舍 / 会议室等固定区域采样，区域半径最多放大到 1200px，无法表达「全岛漫游」；
- NPC 发言链路横跨 `config`（`chat` / `chatDelayMs` / `chatLines` / `regions`）、`roster`（台词池与弹幕色）、`brain`（`nextChatAt`）、`social`（发言分支）、`director`（外置台词审核）与 `server.ts`（审核注入）；
- 客户端完全不知道谁是 NPC，更没有「保安」这一角色；`SpawnPacket` 只有名字、外观、状态、在线秒数、考勤与点赞；
- 外观是 32 字节定长编码，四个配件槽与一个 reserved 字节；追加配件必须放在目录末尾，旧档字节语义不能变；
- 服务端零持久化，NPC 与保安都只活在进程内存里。

被否决的候选：

1. **用状态文字识别保安（如 `status='保安执勤'`）**：零协议改动，但玩家可以设置同样状态，从而伪装成保安；身份判定不应该建立在玩家可控的文本上。
2. **用外观颜色或警帽识别**：玩家同样可以穿戴，而且外观调色是自由输入，无法稳定判定。
3. **新增独立 OpCode 广播保安身份**：需要额外的连接态、重连补发与 AOI 维护，成本远高于一个可选尾段。

## Decision

1. **数量与角色**：普通同事默认 2 位（`GAME_NPC_COUNT` 控制），保安固定 3 位（`GUARD_COUNT`）。`GAME_NPC_ENABLED=0` 或 `GAME_NPC_COUNT=0` 一起关闭，保持一条环境变量回滚。
2. **全岛漫游**：删除区域体系，落点在 `WORLD_BOUNDS`（岛包围盒）内均匀采样，用 `isBlocked` 过滤海与障碍；最多 24 次重试，换路点前 20 次要求离当前位置至少 240px，失败时 `findFreePoint` 就近脱困。出生点额外要求彼此相距 160px；第 1 位同事与第 1 位保安从广场出发，保证进场就能看到人。
3. **仅保留动作**：NPC 不再进入聊天历史、不产生任何聊天广播。`sim/chat.ts` 的 `broadcastChatLine` 保留给真人，不做删除。
4. **保安身份走 spawn 可选尾段**：

   ```text
   S2C_ENTITY_SPAWN  ...[likes 0xfb?][role 0xfd u8]
   ```

   常量与类型放在 `packages/shared-types/src/role.ts`；`role <= 0` 时一个字节都不写，普通玩家与普通同事的包体与上一版完全一致。`decodeSpawn` 的状态长度排除表加入 `0xfd`，角色段追加在 likes 之后，读取时不消费调用方 offset。
5. **旧客户端降级**：旧客户端读到 `0xfd` 会当作非法状态长度并忽略尾段，表现为「没有警灯」，不会崩溃；代价是保安的 career / likes 尾段不再被旧客户端解析，这属于可接受的展示降级。
6. **警服像素件**：外观目录末尾追加 `police_cap`（头饰 #9）与 `epaulette`（颈饰 #6），旧 id 编号与 32 字节长度不变。保安使用深藏蓝配色 + 大檐警帽 + 银白肩章/反光条；捏人界面通过 `PLAYER_HEADWEAR_IDS` / `PLAYER_NECKWEAR_IDS` 过滤掉这两件，玩家不可自选。
7. **警灯渲染**：客户端在 `EntityView` 的 `labels` 层（不受树冠遮挡）创建灯座与红蓝双灯，底边贴在头顶文字上方 3px。相位由 `beaconPhase(now)` 纯函数按 400ms 交替，熄灭的一盏保留 0.22 alpha。只有保安加入 `beacons` Set，`tickBubbles` 定向遍历，普通实体不承担每帧判断。
8. **健康检查**：`/health.npc` 增加 `guards`，与 `count` 分开；启动日志同时打印 `count` 与 `guards`。

## Consequences

- NPC 与保安都不占真人名额、不进牛马榜、不计入 `/health.online`；实体上限、AOI 与碰撞路径不变。
- 全岛采样只在出生与换路点时执行，单次最多 24 次 `isBlocked` 查询，不进入 20Hz 热路径；5 个 NPC 的落点成本可以忽略。
- 删除发言后，NPC 不再触发聊天历史、广播与审核路径，服务端 CPU 与出口流量均下降。
- 旧客户端看不到警灯，也会丢失保安的 career / likes 尾段；旧服务端则完全正常，新客户端把 `role` 当 undefined 处理。
- 玩家不能伪装保安：角色字段只由服务端写入，外观与状态都不参与判定。
- 回滚仍是一条环境变量：`GAME_NPC_COUNT=0` 重启即不生成、不广播；协议尾段为可选追加，不需要版本协商。

## Baselines

- `CODEBASELINE | NPC 活动范围 | expected: 全岛可行走区域 | observed: 8 个固定圆区 | fit: drift → align`
- `CODEBASELINE | NPC 发言 | expected: 无发送信息功能 | observed: 定时弹幕 + 外置台词审核 | fit: drift → align`
- `APIBASELINE | 实体角色 | expected: 客户端可靠区分保安 | observed: 无任何角色字段 | fit: drift → align（可选 0xfd 尾段）`
- `QUALITY | 兼容性 | stimulus: 新旧客户端混部 | response: 新端画警灯，旧端只少一盏灯 | measure: 解析异常 = 0`
- `QUALITY | 回滚 | stimulus: 投诉或带宽吃紧 | response: `GAME_NPC_COUNT=0` 重启 | measure: 无协议 / 客户端 / 数据迁移`
- `QUALITY | 静止零发包 | stimulus: 保安站着发呆 | response: 不产生同步条目，警灯只在客户端本地闪 | measure: 连续两 Tick packets = 0`
