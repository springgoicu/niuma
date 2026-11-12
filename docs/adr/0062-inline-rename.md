# ADR-0062：工牌名可在工牌卡内就地修改，走独立的低频广播通道

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（需求确认）、客户端数据层、服务端模拟、协议层
- **Tags:** badge, profile, protocol, moderation, zero-persistence
- **Supersedes / superseded by:** 无；扩展 ADR-0035（玩家状态）的「工牌卡内联编辑」形态

## Context

需求是「左上角点击个人信息增加可以修改名称」。现状：

- 工牌名只在 `C2S_HELLO` 里上传一次，服务端存进 `Player.name`，之后没有任何更新路径；
- 状态已经有一条成熟的低频通道：`C2S_SET_STATUS / S2C_STATUS`，服务端审核、节流、回执本人并广播 `player.known`（ADR-0035）；
- 工牌卡点击已展开内联编辑区，右侧竖条才是档案入口，两个交互不嵌套；
- 昵称是档案工号、部门、班次的哈希输入（ADR-0052），改名会换工号；
- 聊天历史条目自带昵称快照（ADR-0039），改名不回溯历史；
- 服务端零持久化（ADR-0004）：名字只在进程内存与浏览器 `localStorage`。

失败的候选方案：

1. **改名后重连（重新 HELLO）**：零协议改动，但会打断在岗计时、落点与常驻聊天面板；`GameViewport` 的启动 effect 只依赖 `entering`，还要额外改造才能重建会话。
2. **复用聊天通道**：会污染聊天记录、受聊天限速影响，新入场者拿不到新名字。
3. **只写本地存档**：当前园区里别人看你还是旧名，自己面板显示新名，属于自相矛盾的状态。

## Decision

新增一条与状态同构的低频通道，按「新增独立 OpCode」落地：

```text
C2S_SET_NAME (0x28)   [op][len u16][utf8]
S2C_NAME     (0x29)   [op][entityId u16][len u16][utf8]
```

1. **协议纯追加**：旧客户端 `default` 丢弃未知 opcode，不需要版本协商；空名与越界长度都解码成空串，绝不越过缓冲，也绝不让 `truncateName` 把空串换成兜底名——否则一次空包就会把玩家改成默认工牌名。
2. **服务端唯一裁决入口**：`sim/name.ts` 的 `resolveRename(current, raw, moderation)` 与 `C2S_HELLO` 共用同一把尺子。与入场不同的只有失败策略：空输入、域名/邮箱形态与政治敏感**保留原名**，不替换成 `FALLBACK_NICKNAME`；脏话取打码结果照常生效。
3. **只在真的变化时写字段**：`player.name` 变化才 `markSpawnDirty()`，避免无意义的入场缓存重建；回执本人 + 遍历 `player.known` 广播，与状态同一量级，不进 Tick。
4. **节流独立**：`RENAME_THROTTLE_MS = 1000`，比状态的 200ms 更宽——改名更罕用，且每次都要重建入场资料缓存。
5. **客户端乐观上屏**：`GameSession.setName` 先改 `names` 表与头顶 Text，再上行；服务端回执经 `onName` 对齐打码后的文本。`GameSession` 新增 `private name`，重连的 `handleWelcome` 用它重建本地角色，不能读 `start()` 的 profile 闭包（与 `status` 同理）。
6. **UI 沿用已有形态**：`StatusEditor` 扩为 `BadgeEditor`，名字行在状态行上方，保存按钮一次提交两个字段；清除按钮只清状态。名字行复用 `checkProfileName` / `describeProfileName`，空名与敏感词在输入时就提示，超宽提示保存时截断。
7. **告知副作用**：编辑区常驻一句「改名会换工号与部门」，因为工号、部门、班次都由昵称哈希派生（ADR-0052）。

## Consequences

- 改名会立刻影响他人工牌、牛马榜与聊天弹幕里的名字；聊天历史里的旧快照保持不变（ADR-0039 既有语义）。
- 改名会换工号与部门；这是哈希派生的必然结果，已用文案说明，不做兼容层。
- 服务端仍不持久化：换设备、换浏览器是全新角色；名字只随 `localStorage` 走。
- 协议多两个 opcode；旧服务端收到 `0x28` 会静默忽略，改名退化为「只改本地」，不会断线。

## Baselines

- `CODEBASELINE | BadgeCard 内联编辑 | expected: 点击工牌展开名字 + 状态 | observed: 只有状态 | fit: partial → align`
- `PROTOCOLBASELINE | 昵称更新 | expected: 会话内可改且视野内可见 | observed: 仅 HELLO 一次 | fit: drift → align`
- `QUALITY | 兼容性 | stimulus: 新旧混部 | response: 旧端忽略未知 opcode，正常入场 | measure: 旧端失败率 = 0`
- `QUALITY | 审核一致 | stimulus: 伪造空名 / 敏感名 | response: 保留原名 | measure: 名字被改写成空或兜底名的次数 = 0`
