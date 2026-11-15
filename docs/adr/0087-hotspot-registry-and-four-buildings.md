# ADR-0087：热区注册表，以及赌场 / 八角笼 / 茶水站 / 豪宅与公寓

- 状态：已采纳
- 日期：2026-11-15
- 关联：扩展 ADR-0061（地标常量即真相）、ADR-0070 / 0073 / 0076（擂台与提前结算）、
  ADR-0081（共享运行态落盘）、ADR-0082（牛马币）、ADR-0083（挑战总线）、ADR-0085（商店与 Buff）

## 背景

「按 F 能做什么」在改造前散落在三处：客户端 `interactions.ts` 的若干 `isNearXxx`、
`GameSession.interact` 的分支顺序，以及服务端各玩法自己的距离判定。每加一座建筑都要同时改
提示条、交互分发与校验，任何一处漏改就出现「提示说能按、按下去没反应」或「提示没写、服务端却放行」。

同时，园区里还有四类没有落地的玩法需求：多人同桌的骰子公共局、带押注的 1v1 擂台、
卖永久属性与装扮的茶水站、可冠名的豪宅小院与带私有户型的公寓。

## 决策

### 1. 单一热区表

`packages/shared-types/src/world/hotspots.ts` 导出 `HotspotDef { id, kind, x, y, radius, label, seatGroupId? }`
与有序数组 `WORLD_HOTSPOTS`，并提供 `HOTSPOT_INDEX` / `hotspotById` / `isWithinHotspot` /
`nearestHotspotOfKinds`。坐标一律来自各建筑模块的常量，热区表不重写坐标。

- 客户端：`selectContextHint` 按 `HOTSPOT_PRIORITY` 逐级取最近命中，`GameSession.interact`
  用同一张表与同一优先级分发，避免提示与动作分叉；
- 服务端：交互包带桌号 / 院号 / 动作码，服务端用 `hotspotById` + `isWithinHotspot(…, HOTSPOT_SERVER_SLACK)`
  复核，240px 余量只用来吸收 RTT，挡的是离场后仍刷请求的伪造包；
- 需要运行时状态的少量热区保留谓词：告示板要面朝牌面、观战长椅要真的坐在 `arena-bench` 组上、
  公寓门口与屋内出口按 `roomId` 二选一、擂台提示由会话层读阶段后给。

### 2. 四类建筑的坐标与碰撞

全部落在岛屿内的空地上，不压广场、四角院落、南院、游乐园、三湖、主路与树丛：

| 建筑 | 地块 | 说明 |
|---|---|---|
| 摸鱼大赌场 `DICE_HALL` | 2620,3480,420×400 | 西主路以南、涟漪湖以北；两张 6 人绿绒桌，共 12 座 |
| 绩效八角笼 `ARENA` | 沿用 `RING_ARENA` | 四周 10px 围栏，南北正中各留 56px 门洞，场外 4 张观战长椅 |
| 赛博茶水强化站 | 沿用 `TEA_STATION` | 只升级美术与货架，热区与 48px 半径不变 |
| 豪宅小院 `VILLA_1/2` | 4670,4700 / 4670,4890 | 220 宽院地，院墙静态碰撞、门栅动态碰撞 |
| 牛马公寓 `APARTMENT` | 2620,5240,380×300 | 西南角，整圈封闭外墙，进出只走热区 |

冬季覆雪由各视图自己接 `winter` 标记（桌沿、院墙、楼顶积雪），冰棱仍由 `winter-art` 自动
挂在 `kind: 'wall'` 的 solids 上。

### 3. 押注用彩池，不用固定赔率

赌桌与观战押注共用同一套 pari-mutuel：每局所有注额合池，押中档位按注额比例分走全池，
平台不抽水、货币不增发，天然支持「多人同赢同输」；命中档位无人下注时全额退款。
整数余数按注额降序、id 升序兜底分配，保证同一输入在任意机器上结果一致。

- 注额经 `EconomyService.freezeEscrow` 冻结，派彩走 `payoutFromPool`（先清托管再入账），
  输了走 `clearEscrow`，因此重复结算不会重复发钱；
- 赌桌每局 5% 概率触发保安查岗：本局命中的彩池再抽走 5%（唯一保留的抽水彩蛋）；
- 八角笼：报名费 50 币，两人各交一次，100 币全给胜者；观战押注另算一池；
- 连胜：同一设备（重连也算同一人）连续夺冠计数，达到 3 场走大喇叭通道全服横幅。

### 4. 公寓用「同坐标不同频道」实现局部房间

所有房间复用楼内同一个矩形（`APARTMENT_INTERIOR`），`Player.roomId` 是频道号（0 = 园区，1..6 = 房间）。
`refreshView` 只让同频道的玩家互相可见，移动、AOI、深度排序与相机跟随因此不需要第二套实现。

- 进出只走 `C2S_APARTMENT` 的两个动作，服务端分配频道并传送，客户端按收到的 `S2C_ROOM_STATE`
  叠室内地板与家具；
- 家具布局由客户端上传（`C2S_ROOM_LAYOUT`），服务端按 `houseTier` 的槽位数、格子范围与
  「是否买过（`furn:<id>` 在解锁清单里）」过滤后再广播给同频道；
- 户型复用 `EconomyProfile.houseTier`：0 纸箱 / 1 隔断 / 2 一居室 / 3 大平层，升级价见 `HOUSE_TIERS`；
- 邀请：`C2S_APARTMENT_INVITE` 记一条 120 秒的票据，被邀请者在门口按 F 直接进邀请者的频道。

### 5. 动态碰撞只给门栅留一条口子

静态 `WORLD_LAYOUT.solids` 是模块级常量，锁门却是运行期状态。`collision.ts` 新增
`setDynamicSolids(rects)`：服务端在锁状态变化时重建，客户端在收到 `S2C_VILLA_STATE` 时
调同一个函数，两边读到同一组矩形，预测不会与权威打架。动态障碍至多两条，不进网格索引。

### 6. 落盘

`world-state` 升到版本 2，新增 `villas`（房主设备号 / 名字 / 锁状态 / 上次收币时刻）。
版本 1 的档按「空豪宅」接管，坏档仍隔离不覆盖。金币、属性、装扮解锁与房型仍遵守 ADR-0082：
会话内服务端权威，长期存档在浏览器 localStorage，只经 `S2C_WALLET_SYNC` 回写。

### 7. 协议

新增 11 条消息（0x46–0x50），全部定长上行 + 聚合下行：

| 方向 | 消息 | 载荷 |
|---|---|---|
| C2S | `DICE_BET` | `[table u8][side u8][amount u32]` |
| C2S | `VILLA` | `[villa u8][action u8]` |
| C2S | `ARENA_BET` | `[side u8][amount u32]` |
| C2S | `APARTMENT` | `[action u8][arg u8]` |
| C2S | `APARTMENT_INVITE` | `[targetId u16]` |
| C2S | `ROOM_LAYOUT` | `[count u8]` + count × `[id u8][cell u8]`（变长） |
| S2C | `DICE_STATE` | 两张桌一包，每桌 17 字节 |
| S2C | `VILLA_STATE` | 每栋一条：房主 id / 锁 / 可收币 / 名字 |
| S2C | `ARENA_POOL` | 红蓝池、阶段、自己的注 |
| S2C | `ROOM_STATE` | 门牌 / 房主 / 档位 / 家具 |
| S2C | `ROOM_INVITE` | 邀请人与门牌 |

`guard.ts` 的 `TABLE_SIZE` 抬到 0x52；新下行包在 worker-host 与 worker-client 都做了透传，
漏一处 Worker 模式就会静默丢包。

## 后果

- 新增建筑只需在共享层注册常量 + 一条热区，提示、交互与服务端校验自动跟上；
- 押注不增发货币，园区通胀只由既有奖励与摇钱树产出驱动；
- 公寓的「同坐标不同频道」省掉一套房间协议与第二套碰撞，代价是所有房间共享一块坐标空间——
  将来若要真正独立的室内地图，需要把 `APARTMENT_INTERIOR` 扩展成矩形列表；
- 冠名权只在本运行周期有效，重启园区重新挂牌，与「服务端零持久化」的边界一致。
