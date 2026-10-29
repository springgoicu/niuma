# 牛马 NIOMA

一座永不下班的 2D 像素多人在线办公园区。选一头牛或一匹马，走进工位、打字聊天、坐下躺平。

**核心约束：零持久化。** 世界只活在游戏进程内存里，昵称与外观只写进浏览器 `sessionStorage`。关掉标签页，你就自由了。

## 技术栈

| 层 | 选型 |
|---|---|
| Monorepo | pnpm 10 + Turborepo 2 + TypeScript 5（strict） |
| Web | Next.js 15 App Router · React 19 · Tailwind CSS v4 · Zustand 5 |
| 渲染 | PixiJS 8（WebGPU 优先，自动回落 WebGL2）· bitecs 0.4（SoA + TypedArray） |
| 美术 | 程序化生成 48×48 分层像素图集，16 列帧预算（走 6 拍 / 待机呼吸 + 眨眼 / 坐躺 / 叫唤） |
| 服务 | Bun `Bun.serve` WebSocket（内部即 uWebSockets）· 20Hz 固定 Tick |
| 协议 | 手写二进制帧，移动包固定 **8 字节**；无 JSON、无轮询 |
| 数据 | 进程内存（唯一真相）+ 浏览器会话缓存；无数据库、无 ORM |

## 快速开始

```bash
pnpm install
pnpm dev
```

- 园区首页 <http://localhost:3000>
- 捏人工作台 <http://localhost:3000/create>
- 进入园区 <http://localhost:3000/play>
- 服务器状态 <http://localhost:3001/health>

需要 Node ≥ 20 与 pnpm 10。Bun 作为工作区开发依赖安装（`node_modules/.bin/bun`），无需全局安装。

想直接进服，可以用深链：`/play?name=夜班实习生&species=horse`。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 重新生成图集并同时启动 Web + 游戏服务器 |
| `pnpm build` | 生成图集并构建生产包 |
| `pnpm typecheck` | 四个包全量类型检查 |
| `pnpm test` | 协议单测（vitest）+ AOI 单测（bun:test） |
| `pnpm assets` | 重新生成双物种分层像素图集 |
| `pnpm bench` | 200 机器人压测（需先启动服务器） |

压测可调环境变量：`BENCH_BOTS=200 BENCH_MS=20000 pnpm bench`。

## 目录

```
apps/game-server     Bun 权威服务器：Tick 循环、空间哈希 AOI、限速校验、聊天广播
apps/web             Next.js 外壳 + Pixi 视口 + 捏人工作台
packages/shared-types 同构契约：类型、OpCode、定点量化、20 字节外观编解码
packages/pixel-assets 程序化像素图集生成器（零依赖 PNG 编码 + 参数化四足）
docs/adr             关键决策记录
```

## 角色与动画

角色是 `packages/pixel-assets` 里的程序化像素画，不依赖任何外部美术工具：

- **帧预算**在 `src/layout.ts` 一处定义：每方向 16 列，idle 0-2、walk 3-8（六拍 80ms）、
  sit 9-10、lie 11-12、emote 13-15。生成器按列作画，客户端按同一份布局切片与播放。
- **分层染色**：图集导出成 `body / pattern / bodyLight / hoof / eyes / eyeLight / extra / snout`
  八张灰度图，运行时逐层 `Sprite.tint`。`bodyLight` / `eyeLight` 是纯白层，靠把本体色往白里混
  得到提亮——`tint` 是乘法，没有独立图层就画不出背线高光与眼神光（见 ADR-0006）。
- **播放**：`apps/web/lib/game/clip.ts` 把 manifest 的逐帧时长预编译成时间轴，相位按 `netId`
  哈希错开，所以同一屏里的人不会同时抬腿。

改帧数只需动 `layout.ts` 再跑 `pnpm assets`：布局会重新写到
`apps/web/lib/game/sprite-layout.generated.ts`，客户端与落地页的 CSS mask 都读它。

## 二进制协议

移动包固定 8 字节，小端：

```
[op 1B][entityId 2B][x 2B][y 2B][state 1B]
```

- 坐标：1/8 像素定点，u16 覆盖 8192×8192 世界
- state：`dir(2b) | pose(3b) | moving(1b)`
- 同步包：`[op][tick u32][count u16]` + 每个实体 7 字节
- 外观：20 字节定长（物种 1 + RGB565 五色 10 + 部件 4 + 配件 4 + 保留 1）

客户端与服务端共用 `packages/shared-types/src/protocol.ts`，不允许各自实现一份。

## 性能

- AOI：512px 单元，900px 视野，跨格才重算订阅；广播量随视野人数增长，而非全图
- 特效：接触阴影全局共用一张纹理，踏步扬尘是固定 48 个精灵的对象池，帧循环不 new 对象
- 广播：可见性对称，`known` 集合本身就是订阅者列表，Tick 内不再做空间查询
- 渲染：分层灰度图 + `Sprite.tint`，数学上等价于调色板替换，但完全合批、每帧零开销
- 状态：帧循环只读写 TypedArray 与精灵位置，运行期不产生对象；React 不参与帧循环

本机实测（Windows，200 个机器人客户端与服务器同机竞争 CPU）：

| 场景 | p50 | p95 | 单客户端下行 |
|---|---|---|---|
| 200 人稀疏分布（出生半径 3000px） | 7.0 ms | 9.2 ms | 2.3 KB/s |
| 200 人全部同屏（出生半径 240px，全互联最坏情况） | 9.3 ms | 13.9 ms | 22.7 KB/s |
| 6 人 | 0.33 ms | 0.55 ms | — |

已知尖刺：200 个连接在同一秒内涌入时，每名新玩家的首次视野结算会让 Tick 出现一次百毫秒级长帧
（实测 max ≈ 158ms）。常态加入（服务器启动后逐个进入）不触发该问题。压测命令：

```bash
GAME_SPAWN_RADIUS=3000 BENCH_BOTS=200 BENCH_MS=12000 pnpm bench
```

## 已知边界

不含多地图/分线、好友私聊、Redis 分片、完整反作弊、移动端虚拟摇杆；美术是脚本生成的像素画，
替换 `apps/web/public/sprites/` 下的图集与 `manifest.json`（含 `version: 2` 的 clips 结构）即可接入正式美术。
