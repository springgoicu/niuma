---
name: niuma-work-boss-events-cosmetics
overview: 在既有牛马币经济（ADR-0082）与热区注册表（ADR-0087）之上，补齐工位搬砖小游戏、老板 World Boss 2.0（命中发币 / 25% 冲击波 / 尾刀大奖）、全局随机事件调度器（红包雨 + 突击查岗）、每日悬赏与 6 件像素配件及脚底金光。
design:
  architecture:
    framework: react
  styleKeywords:
    - Pixel Terminal
    - Ink & Mint
    - Gold Accent
    - Scanline Overlay
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 700
    subheading:
      size: 16px
      weight: 600
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#141A2B"
      - "#7CF5B0"
      - "#F5C451"
    background:
      - "#0B1020"
      - "#141C2E"
    text:
      - "#F2F5FF"
      - "#9AA7C7"
    functional:
      - "#E6483C"
      - "#3DDC97"
      - "#F5C451"
todos:
  - id: shared-protocol
    content: 扩展 shared-types：新 opcode 与编解码、经济原因与参数、工位热区、红包撒点，并更新 guard 表
    status: completed
  - id: server-work-quest
    content: 实现服务端搬砖结算与每日悬赏运行时，接入 dispatch 与钱包快照
    status: completed
    dependencies:
      - shared-protocol
  - id: server-boss2
    content: 实现 Boss 2.0：命中发币与暴击、25% 冲击波预警结算、尾刀大奖与全服弹幕
    status: completed
    dependencies:
      - shared-protocol
  - id: server-events
    content: 实现 WorldEventScheduler：红包雨与突击查岗，挂 Tick 并播全服横幅
    status: completed
    dependencies:
      - shared-protocol
  - id: client-pipeline
    content: 打通前端协议管线与渲染：net/session/worker/game-ui，红包与冲击波绘制
    status: completed
    dependencies:
      - server-work-quest
      - server-boss2
      - server-events
  - id: ui-overlays
    content: 开发终端小游戏浮窗、事件横幅、悬赏面板与工位 [F] 提示入口
    status: completed
    dependencies:
      - client-pipeline
  - id: pixel-cosmetics
    content: 新增 6 件像素配件与脚底金光贴图，bump ATLAS_VERSION 并执行 pnpm assets
    status: completed
    dependencies:
      - shared-protocol
  - id: docs-release
    content: 补 ADR-0088 与版本工报，收尾核对文档与玩家可见变化
    status: completed
    dependencies:
      - ui-overlays
      - pixel-cosmetics
---

## 需求概述
在现有的牛马乐园园区里，补完「打工产出、Boss 掉落、随机事件、新像素装扮」四条玩法线，所有奖励都接入既有的牛马币经济与钱包快照。

## 核心功能
- **工位搬砖小游戏**：坐在工作区 8 个工位任意座位时出现 `[F] 开始加班搬砖` 提示；点击后弹出不遮挡画面中央的终端小游戏，按顺序敲击高亮的字母，约 8 秒一轮；每轮完成发送领取请求，由服务端校验坐姿与时间间隔后发 15~30 币，工效等级加成、夜间加班 ×1.5。
- **老板 World Boss 2.0**：每次真实命中老板除扣血外再发 2~5 币（暴击翻倍）；血量每降 25% 触发「画饼冲击波」，先播 2 秒红色预警圈，未起跳的范围内玩家被震退并躺地 1.5 秒；最后一击归零者拿 500 币尾刀大奖，并在全服高光弹幕中播报。
- **全局随机事件**：每隔 10 分钟随机触发一种，全服横幅带倒计时播报。
  - 天降财神红包雨：广场周围刷新 25 个闪光红包，走近或按 F 抢到 10~40 币。
  - 老板突击查岗：10 秒倒计时后，坐在工位不动的玩家各领 60 币全勤奖，在广场乱晃的被点名摸鱼。
- **每日悬赏**：3 个每日任务（打老板 10 次、赢 1 局 P2P、搬砖 2 次），进度实时显示，达标后可一键领币，每日只能领一次。
- **像素装扮**：新增 6 件 20×20 灰度配件（黄金安全帽、皇冠、赛博墨镜、金丝眼镜、大金链、红围巾），以及角色脚底金光特效，重新生成图集并校验。

## 视觉与交互
- 终端小游戏以深色代码窗口悬浮在画面下三分之一，带像素边框、光标闪烁、连击计数与 8 秒进度条；输入法组合中按键一律忽略，Esc 可中断。
- 事件横幅位于画面顶部居中，金黄色描边、倒计时数字每秒跳动；红包为闪光像素袋，拾取时金币飘字上浮。
- 冲击波预警为红色扩散圆环加地面虚线，命中时画面轻微震动、玩家四脚朝天。
- 悬赏面板沿用园区档案卡风格，三项任务各带进度条与领取按钮；新增配件与既有装扮同一套灰度染色与描边规范。


## 技术栈
- 沿用现有 monorepo：`apps/web`（Next.js + React + TypeScript + Tailwind + PixiJS，游戏循环在 Worker）、`apps/game-server`（Bun + WebSocket，20Hz Tick）、`packages/shared-types`（协议与几何共享）、`packages/pixel-assets`（程序化图集生成，`bun scripts/generate.ts`）。
- 不引入新依赖、新框架、新存储；服务端零持久化不变（ADR-0004 / 0082）。

## 实现策略
1. **协议只追加**：新 opcode 从 `0x51` 起（现状尾部 `S2C_ROOM_INVITE = 0x50`），编解码成对放进 `protocol.ts`，入站包登记进 `net/guard.ts` 并把 `TABLE_SIZE` 扩到 `0x58`（必须严格大于最大 opcode）；`0x20/0x2a/0x2b/0x3d` 继续留空。
2. **发币全部走 `EconomyService`**：新增 `WALLET_REASON` 只追加 `WorkPay=28 / RedPacket=29 / BossHit=30 / InspectionBonus=31`，每次发币自动推完整钱包快照，前端不写增量合并。
3. **坐姿与工位判定共享一把尺子**：`layout.ts` 的 `SEAT_DRAFTS` 前 8 条就是 `WORKSTATIONS` 的椅子（`seat.id = 1..8`，`desk = 0..7`），在 `shared-types` 增 `isWorkDeskSeat(seatId)`，客户端提示与服务端校验同源；`SEATS` 不新增条目，避免 localStorage `seatId` 漂移。
4. **红包雨不做服务端实体**：`shared-types` 提供确定性撒点 `redPacketSpots(seed)`（seed = 事件 id），客户端据此绘制 25 个闪光红包，服务端只维护 `claimed` 位图 + 距离校验 + 已领校验，领取 O(1)，无需扩展 `S2C_ENTITY_SPAWN`。
5. **冲波阈值与调度器都在 Tick 内推进**：`BossRuntime` 维护 `nextShockHp`（7500/5000/2500，跨日 `syncDay` 清零），`resolveBossHit` 命中后由观察者端口回调服务端；`WorldEventScheduler` 不另开定时器，挂在主 `setInterval`（`server.ts` L1307）里按 `now` 推进，早退成本一次数值比较。
6. **前端链路按既有四段式复制**：`net/client.ts`（`NetHandlers`）→ `session.ts`（`SessionCallbacks` + `handleXxx`，顺带驱动 Pixi）→ `worker-protocol.ts` / `worker-host.ts` / `client/worker-client.ts`（两种 client 实现同接口）→ `useGameUi`（zustand）→ 组件订阅。

## 新增协议（定长，全部登记 guard）
| opcode | 名称 | 载荷 |
|---|---|---|
| 0x51 | `C2S_WORK_CLAIM` | `[op][combo u8]` 2B |
| 0x52 | `S2C_WORK_RESULT` | `[op][amount u16][mult u8][flags u8]` 5B（mult 为十分位，15=1.5×；bit0=夜班） |
| 0x53 | `C2S_QUEST_CLAIM` | `[op][questId u8]` 2B |
| 0x54 | `S2C_QUEST_STATE` | `[op][day u32][count u8]` + count×`[id u8][progress u16][target u16][claimed u8]`（变长，`defineVariable`） |
| 0x55 | `S2C_WORLD_EVENT` | `[op][kind u8][phase u8][remainingSec u16][seed u16]` 7B |
| 0x56 | `C2S_EVENT_CLAIM` | `[op][index u8]` 2B |
| 0x57 | `S2C_BOSS_SHOCK` | `[op][phase u8][x u16][y u16][radius u16][remainingMs u16]` 9B |

## 关键参数（集中在 `shared-types`，两端共用）
- `WORK_REWARD = { Min: 15, Max: 30, RoundMs: 8000, MinGapMs: 6000, NightMul: 1.5, PerEffLv: 0.08 }`；`isNightShift(serverHour)`：`hour >= 21 || hour < 6`。
- `BOSS_REWARD = { HitMin: 2, HitMax: 5, CritMul: 2, Blade: 500, ShockEvery: 2500, ShockWarnMs: 2000, ShockRadius: 320, ShockKnockback: 48, ShockStunMs: 1500 }`；暴击率 `min(0.35, critLv * 0.05)`，与商店文案口径一致。
- `WORLD_EVENT = { PeriodMs: 600000, AnnounceMs: 3000, RedPacketCount: 25, RedPacketMin: 10, RedPacketMax: 40, RedPacketPickRange: 72, InspectionWarnMs: 10000, InspectionReward: 60 }`。
- 每日悬赏：`bossHit ×10 → 60 币`、`p2pWin ×1 → 80 币`、`work ×2 → 40 币`；服务端按本地日期键重置，`claimed` 每项一次。

## 执行要点
- **幂等**：搬砖按 `lastWorkClaimAt` 单调递增判间隔（默认 6s，容忍 RTT 抖动，绝不因重发双发）；尾刀只走既有 `justDied`；查岗每场只结算一次（`resolved` 标志）；红包按 bit 置位后立即校验。
- **性能**：Tick 内新增开销为「调度器一次比较 + 冲击波阈值比较 + 25 位位图」；冲击波结算只在阈值跨越那一帧遍历玩家一次。渲染侧红包与金光走对象池（参考 `fx.ts` 的 `GroundFx`），帧内零分配。
- **防刷**：搬砖必须 `player.seat` 属于工位椅 + 在对应 `work-desk-<n>` 热区 `HOTSPOT_SERVER_SLACK=240` 内 + 未倒地；红包校验距离与未领取；悬赏领取校验进度与当日未领。
- **兼容**：旧客户端遇到新 S2C 由 `PACKET_UNKNOWN` 静默丢弃；新 C2S 走 `interactive` 限频闸门（`P2P_PACKET_INTERVAL_MS`），不新增限频机制。
- **脚底金光**：外观编码 32 字节定长无 aura 槽位，因此把金光做成「黄金安全帽」的附带特效贴图 `fx/aura-gold.png`，渲染层按实体 headwear 判定，远端玩家同样可见，不改协议。
- **日志**：沿用 `[game]` 前缀，只记 `ws=` 与金额/等级，不打印载荷；事件开始结束各一条。

## 目录结构
```
packages/shared-types/src/
├── types.ts                       # [MODIFY] OpCode 追加 0x51-0x57 与 packet 类型常量
├── protocol.ts                    # [MODIFY] 7 个编解码成对函数
├── economy.ts                     # [MODIFY] WALLET_REASON 28-31、COSMETIC_SKUS id 13-18
├── work.ts                        # [NEW] 搬砖与 Boss 2.0 / 世界事件参数、isNightShift、workPayout、redPacketSpots、世界事件文案模板
├── quest.ts                       # [NEW] 每日悬赏定义、进度快照类型、目标常量
├── catalog.ts                     # [MODIFY] HEADWEAR/EYEWEAR/NECKWEAR_IDS 各追加两件（只许追加）
└── world/hotspots.ts              # [MODIFY] HotspotKind 加 'workDesk'，WORLD_HOTSPOTS 由 WORKSTATIONS 生成 8 条，HOTSPOT_PRIORITY 插入 workDesk

packages/shared-types/src/world/layout.ts   # [MODIFY] 导出 isWorkDeskSeat(seatId) / WORK_DESK_SEAT_IDS

apps/game-server/src/
├── net/guard.ts                   # [MODIFY] 新 C2S 定长登记，TABLE_SIZE=0x58
├── sim/boss.ts                    # [MODIFY] hit 返回阈值跨越，nextShockHp 维护与跨日清零
├── sim/vent.ts                    # [MODIFY] VentHitObserver 增 onBossHit，resolveBossHit 回报伤害与暴击
├── sim/work.ts                    # [NEW] WorkShiftRuntime：坐姿/热区/间隔校验，按工效与夜班算钱
├── sim/quests.ts                  # [NEW] DailyQuestRuntime：noteBossHit/noteMatchWin/noteWork/claim/snapshot
├── sim/world-events.ts            # [NEW] WorldEventScheduler：10 分钟轮换、红包位图、查岗结算、横幅广播
├── sim/boss-shock.ts              # [NEW] 冲击波预警与结算（击退 + 倒地 1.5s，起跳免疫）
└── server.ts                      # [MODIFY] dispatch 新增 3 条 C2S 分支、Tick 挂调度器与冲击波、ventObserver 接线

apps/web/lib/net/client.ts                    # [MODIFY] NetHandlers + handle 分支
apps/web/lib/game/session.ts                  # [MODIFY] SessionCallbacks、handleXxx、claimWork/claimQuest/claimEvent、红包接近自动拾取
apps/web/lib/game/runtime/worker-protocol.ts  # [MODIFY] WorkerToMain / MainToWorker 消息
apps/web/lib/game/runtime/worker-host.ts      # [MODIFY] 入站 case 与回调转发
apps/web/lib/game/client/worker-client.ts     # [MODIFY] handle 分派
apps/web/lib/game/client/main-thread-client.ts# [MODIFY] 同步实现
apps/web/lib/game-ui.ts                       # [MODIFY] workOpen/quest/worldEvent/红点状态
apps/web/lib/game/hint-copy.ts                # [MODIFY] HINT 增 work 文案与按钮
apps/web/lib/game/interactions.ts             # [MODIFY] 工位热区提示（未入座提示先坐下）
apps/web/lib/game/work-grind.ts               # [NEW] 纯逻辑：字母序列、计时、连击、结算档位
apps/web/lib/game/red-packets.ts              # [NEW] 红包渲染对象池 + 拾取闪光
apps/web/lib/game/boss-shock.ts               # [NEW] 红色预警圈与命中表现
apps/web/lib/game/fx.ts                       # [MODIFY] 脚底金光贴图绘制（复用对象池）

apps/web/components/game/WorkGrindOverlay.tsx # [NEW] 终端小游戏浮窗（capture 键监听 + isComposing 守卫 + Esc 中断）
apps/web/components/game/WorldEventBanner.tsx # [NEW] 全服事件横幅与倒计时
apps/web/components/game/BountyDialog.tsx     # [NEW] 三任务进度与一键领取
apps/web/components/game/GameViewport.tsx     # [MODIFY] 挂载三个组件、接线 callbacks
apps/web/components/game/EconomyLayer.tsx     # [MODIFY] 悬赏入口与红点
apps/web/components/game/WalletBadge.tsx      # [MODIFY] 悬赏按钮（可选红点）

packages/pixel-assets/src/cosmetics.ts        # [MODIFY] 6 件配件绘制并入 COSMETIC_CATALOG
packages/pixel-assets/scripts/generate.ts     # [MODIFY] ATLAS_VERSION=11、输出 fx/aura-gold.png
apps/web/lib/game/sprite-layout.generated.ts  # [GENERATED] pnpm assets 重写

docs/adr/0088-work-boss2-world-events-bounty.md  # [NEW] 记录发币口径、红包确定性撒点、金光承载方式
apps/web/data/release-notes.json                 # [MODIFY] 玩家视角版本工报
```

## 关键结构
```ts
export interface WorldEventSnapshot {
  kind: 1 /* RedPacketRain */ | 2 /* Inspection */;
  phase: 1 /* Announce */ | 2 /* Active */ | 3 /* Resolve */;
  remainingSec: number;
  /** 确定性撒点种子：红包位置 = redPacketSpots(seed) */
  seed: number;
}

export interface QuestProgressEntry {
  id: number;
  progress: number;
  target: number;
  claimed: boolean;
}
```


## 设计风格
延续园区既有的「像素办公 + 冷调霓虹」语言：深墨色面板、薄荷绿描边、金色作为金钱高光。三个新界面共用同一套 2px 像素边框、等宽字体标签与轻微扫描线质感，不与世界画面争夺注意力。

## WorkGrindOverlay（终端小游戏）
- 位置：画面底部居中，宽 `min(560px, 92vw)`，高约 240px；不遮挡角色与老板血条。
- 结构：顶栏（`OVERTIME.EXE` 标题 + 8 秒细进度条 + 连击 xN）→ 中部代码区（3 行伪代码，当前目标字母高亮放大并按 4Hz 呼吸发光）→ 底栏（当前产出预估「本轮 ≈ 22 币」+ `ESC 摸鱼` 提示）。
- 命中反馈：按键正确时字符变金并炸出 1px 粒子，错误时整行轻微左右抖动并扣连击；每 10 连击顶栏闪一次金色描边。

## WorldEventBanner（事件横幅）
- 顶部居中安全区下方，圆角胶囊 + 金色双描边 + 左侧像素图标（红包 / 老板头像）。
- 主标题一行大字，副行倒计时 `00:10` 每秒跳变并有放大回弹；即将结算（≤3s）时边框由金转红并加速闪烁。
- 结算后 2 秒淡出，不与现有断线横幅、老板倒下提示重叠（错开 8px 堆叠）。

## BountyDialog（每日悬赏）
- 右侧滑入卡片宽 420px，遮罩半透明墨色；顶部「今日悬赏」+ 日期 + 已完成数。
- 三条任务行：图标 + 文案 + 进度条（`6/10`）+ 右侧「领取 60」按钮；未达标按钮置灰，已领取变金色对勾。
- 全部达成时顶部出现「一键领取全部」主按钮；领取成功触发金币飘字与 0.2s 缩放回弹。

## 配件与金光
- 六件配件统一 20×20、灰度四档（BASE/SHADE/DEEP/TRIM）+ 1px OUTLINE，染色后保持高对比：安全帽厚檐圆顶、皇冠三尖镶珠、赛博墨镜横贯镜带、金丝眼镜圆框细腿、大金链粗节链环、红围巾绕颈垂尾。
- 脚底金光：角色脚下 20×8 的椭圆光斑，两帧交替闪烁，低透明度叠在接触阴影之上，跳跃时随腾空抬升。

## 响应式与可访问性
- 触屏：终端小游戏底部显示可点的大字符键盘区；横幅与悬赏按钮高度不小于 44px。
- 动效统一 `prefers-reduced-motion` 降级为静态高亮，无闪烁。

## Agent Extensions
### SubAgent
- **code-explorer**
  - Purpose: 在实现每一阶段前，精准定位新增/修改点（协议编解码、guard 定长表、worker 消息管线、渲染层挂点、图集生成入口）。
  - Expected outcome: 每阶段拿到确切文件路径、导出符号与行号，避免凭空假设接口导致的返工。
