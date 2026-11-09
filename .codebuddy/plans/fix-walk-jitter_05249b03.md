---
name: fix-walk-jitter
overview: 修复走路时画面抖动：相机按 floor 取整、角色按 round 取整，导致角色相对屏幕每移动 1 世界像素横跳 1 纹素；同时本地玩家每 50ms 被服务端位置拉回 35%（偏差 > 8px 时直接瞬移），造成 20Hz 位置锯齿。两处一并修正。
todos:
  - id: camera-focus
    content: 新增 camera.ts 纯函数，让 updateCamera 与角色共用 round 吸附
    status: completed
  - id: local-reconcile
    content: 重写 handleSync 本地对齐：移除逐包回拉，超阈值才校正
    status: completed
  - id: camera-tests
    content: 补相机单测，覆盖夹紧、居中与行走相位一致，跑 typecheck 和 web 测试
    status: completed
    dependencies:
      - camera-focus
      - local-reconcile
  - id: verify-and-doc
    content: 用 [skill:verification-before-completion] 实机验证四向行走与海岸夹紧，补 ADR-0021
    status: completed
    dependencies:
      - camera-focus
      - local-reconcile
      - camera-tests
---

## 产品概述
《牛马》是 2D 像素多人在线办公园区，玩家用 WASD 在园区行走。当前行走时整屏画面高频抖动，角色相对背景来回跳动，明显影响操作与观感。

## 核心功能
- **角色相对屏幕稳定**：消除相机向下取整与角色四舍五入之间的相位差，角色不再每移动 1 世界像素横跳 1 纹素。
- **取消本地位置回拉**：不再每 50ms 按 35% 把本地位置拽向服务端坐标、偏差超 8px 时直接瞬移；移动中以本地预测为准，仅在真实失步（超过合法延迟上限）时一次性对齐。
- **保持像素完美**：相机与角色仍在整纹素、整设备像素上落笔，nearest 采样不变，不引入亚像素模糊。
- **边界与兼容**：相机继续夹在岛屿包围盒内，贴海岸时角色连续偏移；不改变移动速度、手感、动画节拍、协议、服务端权威与远端角色插值。

## 视觉验收
- 60Hz 与 144Hz 屏幕、DPR 1 / 1.25 / 1.5 / 2 下四向行走 10 秒：角色与昵称钉在屏幕中心（夹紧后为固定偏移），背景以稳定 1 纹素步进滚动，无高频横跳、无 20Hz 回弹。
- 走到海岸或围栏边：相机停止，角色平滑偏离中心，不抖动、不瞬移。
- 站立、入座、起身、跳跃、远端角色表现与现状一致。

## 技术栈与约束
沿用现有技术栈，不新增依赖、不改协议、不改服务端：pnpm workspace + TypeScript strict + PixiJS 8（`roundPixels`、nearest、整数设备像素缩放）+ bitecs SoA + Bun 20Hz 权威服务端。

必须保留 `docs/adr/0005-pixel-grid.md` 的取舍：相机与实体只在整纹素 / 整设备像素上落笔，不做亚像素滚动。

## 实施策略

### 1. 相机与角色共用同一吸附源（主因修复）
在 `apps/web/lib/game/renderer.ts:532-573` 中，相机用 `Math.floor`，角色在 `updateEntity`（`renderer.ts:433-441`）用 `snapTexel`（`Math.round`）。MOVE_SPEED = 165，60fps 下每帧 2.75 像素，`round(px) - floor(px)` 每 4 帧翻转一次（约 15Hz），角色相对背景每次跳 1 纹素（3 CSS px）。

做法：新增 `apps/web/lib/game/camera.ts`，把 `cameraAxis`（夹紧 / 居中 / NaN 回退）与 `cameraFocus`（夹紧后调用 `snapTexel`）收敛为纯函数；`updateCamera` 只用 `cameraFocus` 得到 camX / camY，未夹紧时 `camX === snapTexel(角色坐标)`，角色相对屏幕偏移恒为 0；夹紧时相机静止、角色连续偏移，不再发生量化翻转。世界层位置直接使用已取整的 camX，删除 `snapTexel(camX)` 冗余。不采用亚像素相机：会破坏 ADR-0005 的整纹素栅格与 nearest 采样，代价大于收益。

### 2. 本地预测优先的和解策略
`apps/web/lib/game/session.ts:221-242` 的本地分支每 50ms 把位置拉向服务端坐标。服务端 `apps/game-server/src/sim/movement.ts:44-104` 不自行推进位置，`player.x/y` 取客户端上包位置，因此 sync 坐标天然滞后「RTT/2 + 一个 Tick」（localhost 约 4–8px，跨网更大），现有逻辑把它变成 20Hz 锯齿。

做法：移动中不再按小偏差校正，只有偏差超过 `LOCAL_DRIFT_LIMIT`（建议 128px，约 0.78s 行程，覆盖高延迟链路）才一次性对齐；`Target` 始终与 `Position` 同步。站定时客户端仍每 50ms 上报位置，服务端会自然收敛，无需 idle 校正。超阈值对齐保留服务端权威：限速截断、地形求解分叉、传送仍会被纠正。远端角色继续走快照时间线插值，不受影响。

### 3. 性能与可靠性
两处均为每帧 O(1)，不新增对象分配；相机可见范围与 cull 继续使用同一个已取整 camX，裁剪边界不会因取整变化而闪烁。无新增日志与网络包，热路径开销不变。

## 架构设计
- `camera.ts`：纯函数、无 Pixi 依赖，可直接单测；`renderer.ts` 只负责 Pixi 装配与世界层写入，职责更清晰。
- `session.ts`：保留和解策略（网络语义）与配置常量，不引入新状态机。
- 数据流不变：本地输入 → 本地预测 → 实体与相机渲染 → 50ms 上报；服务端 sync 仅在异常时对齐本地。

## 目录结构
```
apps/web/lib/game/
├── camera.ts                      # [NEW] 纯函数：cameraAxis 夹紧/居中/NaN 回退 + cameraFocus 整纹素吸附
├── renderer.ts                    # [MODIFY] updateCamera 改用 cameraFocus，删除 floor 与 snapTexel(camX) 冗余，改写注释
├── session.ts                     # [MODIFY] handleSync 本地分支改为阈值对齐，MOVEMENT_CONFIG 增 LOCAL_DRIFT_LIMIT
└── __tests__/
    └── camera.test.ts             # [NEW] 居中、夹紧、NaN、行走相位一致性、阈值覆盖合法延迟
docs/adr/
└── 0021-camera-focus-snap.md      # [NEW] 记录取整同源与本地和解策略，不改写 ADR-0005
```

## 关键结构
```ts
// camera.ts
export function cameraAxis(value: number, start: number, length: number, half: number): number;
export function cameraFocus(value: number, start: number, length: number, half: number): number;

// session.ts
const MOVEMENT_CONFIG = { /* 既有字段 */ LOCAL_DRIFT_LIMIT: 128 };
```

## 实施注意
- `cameraFocus` 必须先夹紧再取整，保证贴边时相机落在包围盒内侧半个纹素以内，不露出世界外黑边。
- 改写 `updateCamera` 注释，写明相机与角色必须同源取整，防止后续再改回 floor。
- `LOCAL_DRIFT_LIMIT` 必须大于「MOVE_SPEED × (单向延迟上限 + 一个 Tick + 发送间隔)」；单测用 `MOVE_SPEED` 与 `TICK_MS` 常量断言，防止改速度或 Tick 后阈值失效。
- 不动服务端限速、`Snapshot` 组件、时间线插值、协议、移动速度与动画节拍；不改 UI 版式。
- 验证需覆盖 Windows 125% / 150% 缩放（cssScale 非整数）与高刷屏（144Hz）两种情形。

## Agent Extensions
### Skill
- **verification-before-completion**
  - Purpose: 在收尾阶段用真实命令输出与实机观察确认修复有效，避免仅凭代码推断宣称完成。
  - Expected outcome: 给出 `pnpm typecheck`、web 测试的实际结果，以及四向行走、海岸夹紧、不同 DPR 下的验证结论。
