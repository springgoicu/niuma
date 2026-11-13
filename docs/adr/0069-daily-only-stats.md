# ADR-0069：所有统计只保留当日，今日数据以本机存档为准

- 状态：已采纳
- 日期：2026-11-13
- 关联：覆盖 ADR-0054（牛马榜公告栏）中的周 / 累计口径；协议在 ADR-0039 基础上
  升级到 v3；与「服务端零持久化」约束一致

## 背景

牛马榜与工牌此前混用了四种时间口径：本次在岗（服务器会话秒）、本周工时、累计工时、
累计行为计数。它们都由服务端进程内状态推算，带来两个问题：

1. 服务端每次部署或重启都会丢失会话累计，玩家看到「在岗」「本周工时」归零，
   榜单排名随之洗牌；
2. 同一名玩家在工牌、榜单、分享卡上看到的数字口径不同，无法核对。

需求是「删除所有时间维度，只统计当日」，并且部署、刷新、断线重连后当日数字都不归零。
约束：

- 服务端零持久化：不新增数据库、Redis 或服务端落盘；
- 今日数据必须能跨进程生命周期存活；
- 今日如厕是今日工时的子集，任何展示都不能出现如厕大于工时；
- 滚动发布期间新旧客户端可能同时在线。

## 决策

### 1. 今日数据唯一事实源放在浏览器

`localStorage` 保存三份按本地日历分桶的存档：

- 考勤：`dailyRecords[dayKey] = onlineMs`、`dailyToiletRecords[dayKey] = toiletMs`；
- 行为：`daily[dayKey] = { distancePx, slackCount, ventedCount, knockdownCount, overtimeCount }`。

日期键用本地日历 `dayKey`，禁止 `toISOString()`；跨零点时按 tick 时间点把区间切开，
分别记到两天。多标签页写入用 merge-max，30 秒批处理落盘，并在 `pagehide` /
`visibilitychange(hidden)` / 坐离切换时立即 flush。

服务端只在进程内存里聚合同一份上报摘要，进程结束即丢弃；重连时客户端在 `HELLO`
里带上缓存的最近一次摘要，服务端据此重建榜单。

### 2. 协议升到 v3，只传今日字段

`CareerSummary` 收敛为：

```ts
interface CareerSummary {
  firstJoinDate: string; // 身份信息，不派生统计
  province: string;
  todayMinutes: number;
  todayToiletMinutes: number; // ≤ todayMinutes
  todaySteps: number;
  todayKnockdown: number;
  todayVented: number;
  todayOvertime: number;
}
```

`firstJoinDate` 仅用于工牌展示「入职日期」。v1/v2 解码时只映射语义确定的
`todayMinutes` 与省份，历史累计字段一律丢弃；旧解码器丢弃 v3 包时，服务端表现为
「该玩家今日未上报」，不会把旧累计灌进今日榜。

### 3. 榜单改为五个今日指标，并去掉时间推进

指标 id 使用 7–11（`today_minutes`、`today_toilet`、`today_knockdown`、
`today_vented`、`today_steps`），与旧版 1–6 错开，避免滚动发布时语义错位。
删除人气榜与「本次在岗 / 本周工时 / 摸鱼次数」页签；工牌点赞功能保留。

`withCareerDelta`、`advanceBoardValue`、会话增量续算全部删除，避免
「本地推进 + 服务端快照」双重计数。为了让刚部署后打开公告栏的玩家不看到自己的 0 值，
面板只用本地当日值给「自己那一行」做展示层 `max(server, local)` 兜底，不回写快照。
自己那一行由快照自带的 `selfRank` 定位，不依赖昵称或实体 id。

### 4. 今日如厕放在考勤，而不是行为计数

它是有跨零点切分与 merge-max 需求的时长区间，与在线时长同构，复用同一套区间结算代码。
角色坐在地铁 / 马桶座（`seatKind === 'toilet'`）时开始累计，起身或换座时结算。
服务端 `sanitizeCareer` 再钳一次 `todayToiletMinutes ≤ todayMinutes`，防止脏存档
或旧包破坏排序。

### 5. 职级与印章按今日重标定

`getJobTitle(todayMinutes)`、`getStampTitle(todayMinutes, todayStats)` 去掉工龄、
连续天数与日均入参，阈值改按单日可达区间取值。分享卡与工牌档案只展示今日字段。

## 代价与取舍

- 换浏览器、换设备或清空站点数据会从零开始，无法跨设备继承；已在公告栏页脚
  用玩家可读的一句话说明；
- 服务端榜单最多落后 20 秒（周期补报），刚部署后的首个快照可能依赖 `HELLO` 缓存；
- 放弃了服务端权威的会话时长，客户端本机计时理论上可被玩家篡改，属于可接受的
  娱乐场景作弊成本；
- 旧存档里的历史累计不迁移进今日桶，老玩家不会因历史数据在当日榜上占据优势。

## 备选方案（未采纳）

- 服务端使用 Redis / 数据库持久化当日累计：违反零持久化约束，且部署后仍需处理
  多实例一致性与清理任务；
- 仅靠刷新页面重发会话：无法解决服务端重启，且会把「在岗」与「工时」继续混在一起；
- 保留周榜并只把「累计」改成本地：口径仍然多源，玩家依旧无法核对。
