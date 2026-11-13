---
name: npc-five-random-names-chat-timing
overview: 将园区 NPC 默认数量从 10 改为 5，名字改为「真人感 + 牛马梗」的随机组合生成，并把弹幕节奏调整为更安静的随机间隔（首次 2–5 分钟，之后 5–12 分钟）。
todos:
  - id: tune-npc-config
    content: 调整默认 5 位与弹幕首次 2–5 分钟、后续 5–12 分钟，并同步 config/social/director/integration 测试
    status: completed
  - id: rewrite-npc-names
    content: 重写 roster 名字生成：姓氏加真名或牛马梗随机组合，保证不重名与长度合法，更新 roster 测试
    status: completed
  - id: update-npc-docs
    content: 更新 README 的 NPC 数量、发言节奏与名字说明
    status: completed
    dependencies:
      - tune-npc-config
      - rewrite-npc-names
  - id: add-release-note
    content: 在 release-notes.json 追加版本记录并运行 changelog:check
    status: completed
    dependencies:
      - tune-npc-config
      - rewrite-npc-names
  - id: verify-npc-changes
    content: 运行 game-server 测试、全仓 typecheck 与 changelog:check，修复回归
    status: completed
    dependencies:
      - tune-npc-config
      - rewrite-npc-names
      - update-npc-docs
      - add-release-note
---

## 产品概述
调整园区服务端同事（NPC）的数量、名字与弹幕节奏：默认常驻同事由 10 位改为 5 位；名字改为每次开服随机生成、像真人姓名但偶尔带牛马梗；弹幕整体更安静，发言时间随机错开。

## 核心功能
- **默认 5 位同事**：每台 game-server 启动后生成 5 位服务端 NPC；`GAME_NPC_COUNT=0` 仍可完整关闭，环境变量仍可覆盖数量。前 4 位固定落在广场，玩家进园仍能立刻看到同事。
- **随机真人感名字**：使用常见姓氏与名字随机组合，生成 2–3 字姓名，如「张伟」「李静」「王思远」；约四分之一带牛马梗，如「张加班」「李摸鱼」「王周报」。同一次开服的 5 位同事不重名，每次开服换一批。
- **更安静的随机弹幕**：每位同事首次发言在 2–5 分钟后，之后每 5–12 分钟最多一句；每条间隔独立抽取，5 人的发言时间自然错开，不按固定节拍刷屏；视野内没有真人时保持沉默。
- **视觉与交互不变**：头顶名字、工牌、工号、部门、外观、走动与互动完全沿用现有表现；工号与部门继续由名字哈希稳定派生，无需协议或客户端改动。

## 技术栈
- 语言与运行时：TypeScript + Bun，服务端模块 `apps/game-server/src/npc/`。
- 测试：`bun:test`，通过 `pnpm --filter @niuma/game-server test` 与全仓 `pnpm typecheck` 验证。
- 不涉及客户端、协议、数据库或部署配置改动。

## 实现方案
### 1. 默认数量与弹幕区间
在 `apps/game-server/src/npc/config.ts` 中调整 `DEFAULT_NPC_CONFIG`：
- `count: 10 → 5`，保留 `MAX_NPC_COUNT = 64` 与 `GAME_NPC_COUNT` 环境变量覆盖；`0` 仍是完整回滚开关。
- `chatDelayMs.first: [60_000, 180_000] → [120_000, 300_000]`（2–5 分钟）。
- `chatDelayMs.repeat: [240_000, 600_000] → [300_000, 720_000]`（5–12 分钟）。
- 同步修正 `MAX_NPC_COUNT` 上方「10 是默认值」的注释。

发言随机性沿用现有机制，不新增配置字段：
- `brain.ts` 的 `createAgent` 为每位同事独立抽取首次发言时刻；
- `social.ts` 每发出一条后重新抽取下一次间隔；
- `LONELY_RECHECK_MS`（30–60 秒）与「视野内无真人不说」保持不变；
- `GAME_NPC_CONFIG` 仍可覆盖 `chatDelayMs`，现有校验与回退逻辑不动。

### 2. 名字生成
在 `apps/game-server/src/npc/roster.ts` 内新增内部函数 `buildNpcNames(rng, count): string[]`，替换原 `NAME_POOL` 静态池：
- 姓氏池：约 40 个常见中文姓（张、王、李、赵、刘、陈、杨、黄、周、吴等）。
- 普通名池：约 45 个单字或双字名（伟、静、磊、洋、敏、思远、子涵、雨欣、嘉怡等）。
- 牛马梗名池：约 14 个双字词（加班、摸鱼、周报、打卡、开会、续命、返工、赶工、待命、熬夜、通勤、搬砖、划水、复盘）。
- 每次生成按约 75% 普通名、25% 梗名抽取，拼成「姓 + 名」的 2–3 字姓名。
- 唯一性：预先构造全部「姓 × 名」组合（约 2,300 个），用 `rng.shuffle` 洗牌后取前 `count` 个；组合空间远大于 `MAX_NPC_COUNT = 64`，因此 5 位与 64 位都不会重名，且无需循环重试。
- 完全使用 `npc/rng.ts` 的 `Rng`，同一 `GAME_NPC_SEED` 可复现；禁止 `Math.random`。
- 姓名长度天然满足 `MAX_NAME_CHARS = 16` 与 `MAX_NAME_DISPLAY_UNITS = 16`，无需客户端截断。
- `buildNpcRoster` 改为消费 `buildNpcNames`，外观、考勤、步速、弹幕颜色与入场时刻逻辑不变；更新文件头与函数注释，说明名字风格与唯一性策略。

### 3. 测试与文档
- `config.test.ts`：默认数量断言 5；新增 `chatDelayMs.first` 与 `repeat` 等于新区间的断言。
- `roster.test.ts`：保留同种子可复现、字符数与显示宽合法断言；新增 5 位名字唯一、长度为 2–3 字；将原「数量超过名字池允许重名」改为 64 位名字仍互不重复。
- `social.test.ts`：发言后 `nextChatAt` 落在 `NOW + 300_000` 到 `NOW + 720_000` 之间，锁住「更安静且随机」。
- `director.test.ts`：`setup` 默认数量改为 5，首条用例的数量断言同步改为 5；其余显式传参用例保持。
- `integration.test.ts`：`setup` 默认数量改为 5，保留「广场至少 4 位同事可见」断言；`PLAZA_SEATS = 4` 不改。
- `README.md`：更新「每台进程生成 5 位」、发言区间「首次 2–5 分钟、之后 5–12 分钟」、`GAME_NPC_COUNT` 默认 `5`，并补充名字为随机真人感姓名加牛马梗。
- `docs/adr/0061-server-side-npcs.md` 是历史 ADR，按项目规则不修改；本次属于参数调优，不新增 ADR。

### 4. 发布记录
在 `apps/web/data/release-notes.json` 顶部追加一条记录（当前最新为 `2026-11-12-12`，新记录用 `2026-11-12-13`），面向玩家描述「同事变 5 位、名字更像真人、弹幕更安静随性」，随后运行 `pnpm changelog:check`。

## 性能与可靠性
- 名字组合仅在 `spawn()` 时生成一次，约 2,300 个短字符串，耗时可忽略；不进入 `socialIntervalMs = 500ms` 的社交检查路径，更不影响 20Hz Tick。
- 同事数量 10 → 5，实体数、AOI 同步与出口带宽同步下降；静止同事仍然零发包。
- 不新增异常路径：配置区间仍由 `parseNpcConfig` 做上下界纠正，`GAME_NPC_COUNT=0` 回滚能力不变，单个 NPC 异常兜底逻辑不动。

## 架构设计
沿用现有分层，不新增模块：
- `config` 只负责默认值与校验；`director` 仍是唯一门面；`roster` 只负责名字、外观与考勤；`brain`/`social` 只消费配置。
- 数据流：`loadNpcConfig` → `createNpcDirector.spawn` → `buildNpcRoster`/`buildNpcNames` → `world.createNpc` → 工牌与聊天复用现有实体通道。
- 客户端 `apps/web/lib/game/badge.ts` 继续按名字哈希派生工号、部门与班次，名字内容变化无需同步改动。

## 目录结构
```
apps/game-server/src/npc/
├── config.ts          # [MODIFY] 默认数量 5；首次发言 2–5 分钟、后续 5–12 分钟；更新注释
├── roster.ts          # [MODIFY] 用姓氏池 + 普通名池 + 牛马梗名池替换 NAME_POOL，新增 buildNpcNames，保证不重名与长度合法
├── config.test.ts     # [MODIFY] 默认 5 位与新区间断言
├── roster.test.ts     # [MODIFY] 名字唯一性、2–3 字、显示宽合法；64 位不重名
├── social.test.ts     # [MODIFY] 下一次发言落在 5–12 分钟区间
├── director.test.ts   # [MODIFY] 默认 setup 数量改 5，同步首条用例断言
└── integration.test.ts# [MODIFY] setup 默认数量改 5，保留广场至少 4 位可见断言

README.md                                   # [MODIFY] NPC 数量、发言节奏、名字风格与 GAME_NPC_COUNT 默认值
apps/web/data/release-notes.json            # [MODIFY] 追加 2026-11-12-13 版本记录

# 不改动：brain.ts、social.ts、director.ts、spots.ts、rng.ts、协议与客户端、历史 ADR
```
