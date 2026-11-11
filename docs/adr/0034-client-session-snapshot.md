# ADR-0034：浏览器会话快照，重进园区回到上次的位置与姿态

- 状态：已采纳
- 日期：2026-11-11
- 修订：ADR-0004 第 3 条（浏览器只用 `sessionStorage`）

## 背景

ADR-0004 的产品设定是「关掉网页即自由」：身份只是会话级昵称 + 外观，位置每次进场随机。
实际使用里，刷新一次就要重新走到工位、重新坐下，多人同屏时尤其割裂。

需求是同一个浏览器关掉标签页 / 关掉浏览器后再打开，回到上次所在的位置、朝向、姿态与座位。
这正好命中 ADR-0004 自己写下的复核信号「需要跨会话保留角色」。

## 决策

### 1. 持久化只发生在浏览器，服务端仍然零持久化

- `World` 依旧是唯一真相，进程不写盘、不接数据库；换设备、换浏览器仍是全新角色。
- 浏览器用 `localStorage` 存两份数据：
  - `niuma:profile:v2`：昵称与外观（从旧的 `niuma:profile:v1` / `sessionStorage` 首读时自动提升）。
  - `niuma:session:v1`：`{ v, savedAt, x, y, direction, pose, seatId }`，版本化扁平结构。
- 快照写入是 **merge** 语义：后续新增字段（聊天草稿、小地图缩放等）只需 `saveSnapshot({ newField })`，
  不会抹掉别的模块写进去的状态；版本不匹配整体丢弃，缺字段按默认值回落。
- 写入时机只有三处：帧循环 2s 节流、`pagehide` / `visibilitychange(hidden)`、`session.stop()`。
  `localStorage` 是同步 API，绝不进每帧路径。写失败（配额满、Safari 隐私模式）静默降级。

### 2. 位置由客户端上报、服务端重新校验，不做客户端瞬移

纯客户端把角色画到缓存坐标会在首个 sync 包被 `LOCAL_DRIFT_LIMIT`（128px）拉回，
且其他玩家会看到位置跳变。因此走「客户端上报 → 服务端裁决 → 服务端下发」：

```
C2S_HELLO (0x10) v2
[op u8][nameLen u8][name nB][appearance 32B][resume? 8B]

resume = [version u8=1][x u16][y u16][state u8][seatId u16]   // x/y 为 1/8 像素定点

S2C_WELCOME (0x11) v2
[op u8][entityId u16][tick u32][x u16][y u16][state u8]        // 11 → 12 字节
```

- `decodeHello` 按「appearance 之后还有没有 8 字节」判断，旧客户端与压测机器人不带这一段，
  帧长与行为完全不变；未知 `version` 整段忽略。
- `S2C_WELCOME` 带服务端裁决后的 `state`，客户端不再硬编码朝下站立。
- 选 HELLO 尾部而不是新增 OpCode：入场只有一个往返，不引入额外时序；
  排队期间 resume 随 `HelloPayload` 一起等待，放行时才裁决。

### 3. 出生点裁决（`apps/game-server/src/sim/resume.ts`）

```
无 resume                → 随机出生点，Down / Idle
seatId 有效且仍空闲      → 吸附座位锚点，朝向 = 座位朝向，姿态 = seatPose(kind)
座位被占 / 已不存在      → 以座位为锚点站旁边，姿态回 Idle，朝向保留
坐标可站立               → 原样恢复 x/y + 朝向 + 姿态（Walk 归一化为 Idle）
坐标非法（水/障碍/越界） → findFreePoint 就近挪，再不行才回落随机出生点
```

客户端缓存一律不可信：坐标重新过 `isOnLand / isBlocked / isWaterAt`，座位重新查
`SeatRegistry.isFree`，姿态只接受 `Idle / Sit / Lie`。

### 4. 座位释放增加归属校验

刷新时新旧两条连接短暂并存。`SeatRegistry.release` 原来无条件把 `occupant[seatId] = 0`；
改为只有 `occupant[seatId] === player.id` 时才清零并广播，避免旧连接迟到的 `onClose`
把新连接刚占住的椅子标成空位。

## 后果

- 正面：刷新、关标签页重开、断线重连三种场景都回到上次的位置；座位仍空着时连姿态一起回来。
  服务端仍然不落库，部署与数据合规成本不变。
- 负面：
  - 浏览器里开始有「痕迹」。首页「不留痕」与 README / 宣传稿必须同步改成
    「服务端不留痕，记录只在你自己的浏览器里」，否则文案与实现矛盾。
  - `localStorage` 是共享的：同一浏览器多标签页同时玩，后写入的快照会覆盖前者。
  - 座位被他人占走的刷新会降级为「站在旁边」——服务端不知道旧连接属于同一浏览器。
  - 协议破兼容：HELLO 可变长、WELCOME 11 → 12 字节，客户端与服务端必须同版本发布。
- 回滚成本：低。客户端停止发送 resume 段、`decodeWelcome` 兼容 11 字节旧包，
  存量用户的行为立刻回到随机出生；彻底回退只需删除 `niuma:session:v1`。

## 复核信号

出现「需要真正的账号体系」「需要跨设备恢复」「需要在服务端做位置审计或反作弊」中任意一条时，
重新评估把会话快照搬上服务端（此时才需要数据库）。
