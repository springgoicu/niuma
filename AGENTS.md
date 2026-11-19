# AGENTS.md

面向 AI 助手与工程师的《牛马 NIOMA》工程协作规范。

## 开发命令与环境（npm workspaces）

- 运行全量检查（Node ≥ 20，Windows PowerShell 5.1 请用 `; if ($?) { ... }` 串联，勿用 `&&`）：
  - `npm run typecheck` — 四包全量类型检查
  - `npm run test` — Vitest 全仓单元与 React 组件渲染测试（`apps/**` 与 `packages/**` 下 `*.test.{ts,tsx}`）
  - `npm run build` — 生成像素图集并构建 Next.js 生产包（含 `.gz` 预压缩）
  - `npm run assets` — 按 `packages/pixel-assets/src/layout.ts` 重新生成角色精灵图集与品牌图
  - `npm run bench` — 200 机器人服务端压测（需先启动服务器）
  - `npm run changelog:check` — 提交前校验 `apps/web/data/release-notes.json`

## 单仓结构边界

- `packages/shared-types` — 前后端与 Worker 唯一同构契约（类型、OpCode、二进制编解码、世界布局、`collision.ts`）；**严禁引入 Pixi、React、DOM 或 Node 专属 API**。
- `packages/pixel-assets` — 零原生依赖的程序化 64×64 像素图集生成器（列号只追加，不可移动 `0..33` 既有列）。
- `apps/game-server` — Node.js `ws` + 20Hz 权威世界服务器；`apps/web` — Next.js 15 App Router + Dedicated Worker `OffscreenCanvas` 渲染客户端。

## 性能、零 GC 与实时同步铁律

1. **热路径零 GC（Zero-GC）**：
   - 服务端 20Hz（`TICK_MS = 50`：`runTick`、`refreshView`、`villas`、`resolveMotionInto`）与客户端 60fps 渲染循环（`tick`、`tickBubbles`、`SortLayer.update`、`LightmapLayer.render`、`villas-view`、`minimap-draw`）禁止每帧/每 Tick 新建对象、闭包、数组或拼接字符串；统一复用 SoA `TypedArray`、静态缓冲区与原始字段脏检查。
2. **变更驱动同步（Event-Driven Sync）**：
   - 状态广播严禁无差别每秒向全员轮询重发未变数据（如房产收益/在线态只在真实变更或在线房主待领收益跨分钟时定向下发，旁观者共享同一份预编码快照）。
3. **时间口径唯一**：
   - 服务端玩法与冷却一律用 `clock.now()`；客户端倒计时与跨日判定一律用 `serverNow()` / `serverDateKey()`，禁止裸用 `Date.now()` / `new Date()`（仅面板返回键守卫、重连退避与日志除外）。
4. **渲染与视觉硬约束**：
   - 全局光源上限 `MAX_LIGHTS = 96`（`apps/web/lib/game/lighting/light-registry.ts`），常驻场所光保持预算区间；
   - 角色/建筑像素绘法严禁纯黑 `0x000000` 与中性死灰，描边统一走有色深靛（`VENUE_OUTLINE = 0x2a3142`）；参考内置 Skill `.codebuddy/skills/pixel-venue-polish/SKILL.md`。

## 协议与落盘边界

- **二进制协议**：OpCode 只追加不复用，废弃号永久保留作墓碑；新增 `C2S_*` 上行包必须在 `apps/game-server/src/net/guard.ts` 注册并保证 `TABLE_SIZE` 覆盖最高编号。
- **共享运行态落盘**：`world-state.json`（v5）仅落盘 `boss`、8 处房产 `villas`、`wallets` 与 `profiles`（点赞）；会话、聊天、考勤、外观及瞬态玩法仅存进程内存与浏览器 `localStorage`。

## 文档与提交流程

- 当前唯一活跃主规划：[`docs/nioma-pixel-overhaul-masterplan.md`](docs/nioma-pixel-overhaul-masterplan.md)；不修改历史 `docs/adr/*`，新重大决策按现有格式新增 ADR。
- 仅在准备 `git commit` 时，按**玩家可感知结果**（单行中文 ≤ 80 字，严禁出现文件名/函数名/IP/URL/密钥等内部信息）向 `apps/web/data/release-notes.json` 的 `entries` 头部追加一条更新，并通过 `npm run changelog:check` 后同次提交；日常迭代调试不频繁改写该文件。
