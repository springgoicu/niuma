---
name: niuma-name-width-and-walk-jump
overview: 收紧头顶昵称的显示宽度（全角算 2、超宽省略号截断，输入仍限 16 字符），并让跳跃在行走中也能触发、通过图集腾空帧加客户端弹跳/阴影/尘土显著放大跳的观感。
todos:
  - id: name-width-core
    content: 在 shared-types 新增显示宽度与截断函数，truncateName 同步限 16 字符
    status: completed
  - id: name-surface
    content: 接入 JoinGate、profile、头顶昵称与聊天列表的宽度截断并补测试
    status: completed
    dependencies:
      - name-width-core
  - id: atlas-jump-frames
    content: 用 [skill:layer-pixel-art] 放大图集腾空帧与收腿幅度，调整帧时长后跑 pnpm assets
    status: completed
  - id: jump-arc-render
    content: 新增跳跃弧线纯函数，渲染层实现抬升、阴影切换、落地扬尘与昵称跟随
    status: completed
    dependencies:
      - atlas-jump-frames
  - id: walk-jump-gate
    content: 放开行走跳跃：session 与 clip 选帧、服务端准入，并更新 ADR-0018
    status: completed
    dependencies:
      - jump-arc-render
  - id: verify-all
    content: 用 [skill:impeccable] 实机验收边走边跳与长名截断，跑 test 与 typecheck
    status: completed
    dependencies:
      - name-surface
      - walk-jump-gate
---

## 产品概述
牛马园区多人小游戏：昵称固定在角色头顶，空格触发一次性跳跃，动作通过服务端广播给其他玩家。本次调整昵称长度的显示口径，让跳跃能在行走中触发，并显著放大跳跃的视觉表现。

## 核心功能
1. **昵称按显示宽度收敛**：输入仍最多 16 个字符，但新增“全角算 2 宽、半角算 1 宽”的口径；协议与服务端把“16 字符 + 48 字节”作为硬上限；头顶昵称超过 16 宽度单位时用省略号截断，宽度不再横跨两三个身位；昵称与聊天气泡、帽子/犄角的避让关系保持不变。
2. **行走中可跳**：按住方向键时按空格立即起跳，水平位移不中断；440ms 内播放“蹲下—腾空—落地”跳跃帧，落地后无缝回到走路循环。坐/躺仍先起身再跳；行走中按 C 叫唤仍然不触发。
3. **跳跃更明显**：图集腾空帧抬得更高、四条腿收得更紧；客户端在跳跃窗口内叠加整数纹素弧线抬升、腾空时阴影摊开、落地时阴影收紧并扬尘。蹲伏到顶点总落差约为角色身高的四分之一；昵称与气泡跟随抬升，不出现“头顶穿字”。
4. **远端一致**：其他玩家能看到“边走边跳”的位移、抬升与尘土；丢包最多漏一次表现，不会永久卡在腾空帧（440ms 到期自动回落）。
5. **边界不变**：帧时长合计仍为 440ms，协议包长不变，图集列数不变，不需要图集版本升级。


## 技术栈
沿用现有 monorepo，不引入新依赖：
- 前端：Next.js + React + TypeScript，PixiJS 渲染（`apps/web`）
- 服务端：Bun + WebSocket 权威模拟（`apps/game-server`）
- 图集生成：Bun 脚本（`packages/pixel-assets`），产物写入 `apps/web/public/sprites` 与 `apps/web/lib/game/sprite-layout.generated.ts`
- 协议与共享工具：`packages/shared-types`
- 测试：`bun test`；构建：`pnpm assets` + `turbo`

## 实现策略

### 1. 昵称宽度：让一个共享函数负责长度规则
- 在 `packages/shared-types/src/name.ts` 新增纯函数：`displayWidth()`（码点遍历，零宽为 0、全角/宽字符为 2、其余为 1）与 `truncateToDisplayWidth(text, maxUnits, '…')`。
- `protocol.ts` 的 `truncateName()` 改为同时约束“字符数 ≤ `MAX_NAME_CHARS`(16) + 字节数 ≤ `MAX_NAME_BYTES`(48)”，供 `encodeHello` / `decodeHello` 复用，服务端天然成为权威。
- 新增常量 `MAX_NAME_DISPLAY_UNITS = 16`（等于 8 个全角字符），输入框、sessionStorage、协议、渲染四处都引用同一常量，不再各自 `slice(0, 16)`。
- 渲染层在构造 `Text` 前调用 `truncateToDisplayWidth`，昵称是居中锚点、宽度变化不影响 `nameBottomY` 与气泡堆叠；`headTopYOf` 取所有帧列头顶锚点最小值，图集腾空变高后自动多让位。
- 截断必须按码点（`for...of`）处理，`slice` 会切坏 emoji 的代理对。

### 2. 行走跳：只放宽拦截规则，不改状态模型
- `clip.ts` 的 `overlayTrackFor`：`jumping` 时无论姿态都返回 jump 轨；`emoting` 在 Walk 时仍返回 null（行走没有叫唤帧，避免滑步张嘴）。
- `session.ts` 的 `perform`：行走中按空格不再 early-return，保持 `pose=Walk` 与 `moving=1`，只置 jump 位；坐/躺沿用“先起身再跳”。
- `session.ts` 的 tick 位移分支：只清 emote，不清 jump，否则“开始走动立即清叠加位”会把刚起跳的动作掐掉。
- 服务端 `movement.ts` 把 `overlaysAllowed` 拆成两条：emote 需要 `pose !== Walk && !moving`；jump 直接透传。到期仍由客户端 `expireOverlays()` 按 440ms 清位，服务端不新增计时器，保持 ADR-0018“服务端只保存与回传”的既定边界。
- 同步更新 `docs/adr/0018-emote-and-jump-overlay.md` 的 §3 防御条、§5 选帧优先级、§6 交互规则表，并写明“跳跃期间腿部定格、位移继续”的已知取舍。

### 3. 跳跃观感：图集 + 客户端双层放大
- 图集层（`quadruped.ts`）：腾空帧 hop 从 -3 改为 -6（图集内头顶余量仅约 9 纹素，-6 是安全上限，避免犄角/描边被裁），蹲伏 +3 保持，收腿 `lift` 从 3 提到 5，侧视与正视/背视两条几何路径同步修改。
- 帧节奏（`layout.ts`）：`jump.frameMs` 从 120/170/150 调整为 100/220/120，合计仍 440，让腾空帧停留更久，落地更干脆。
- 客户端层（`pony-motion.ts` + `renderer.ts`）：新增零分配纯函数 `jumpLiftTexels(phaseMs, durationMs)`，返回 0 到 -6 的整数弧线（起落为 0、中段触顶），仅在 jump 位为 1 时叠加到角色 body 容器 y；阴影按弧线切三档纹理（腾空 0 宽扁 / 落地瞬间 2 窄高 / 其余 1）；`labels` 容器同步加同样的 y 偏移，避免抬升后头顶撞昵称。
- 落地尘土：`buildLayers()` 里把 jump 末帧列加入 `dustFrames`，复用既有 `onFootfall` 逻辑，不新增粒子系统。
- 合成效果：蹲伏 +3 到顶点（图集 -6 加客户端 -6）约 12 纹素，按 3 CSS px/纹素约 36px，约为角色身高四分之一，远大于当前 3 纹素。

### 4. 性能与可靠性
- 每帧每个可见实体只做常数次整数运算，无 `new`、无纹理生成、无额外 GC 压力；阴影仍只换 texture 引用；昵称文字只在实体创建时截断一次。
- `shadowIndex` 在 `applyMotion` 与跳跃抬升之间共享同一字段，避免两者交替写导致纹理抖动。
- 不接上当前无调用方的 `setMotion/ponyMotion` 全局 bob：那会顺带改变待机/行走观感，超出本次需求。

### 5. 风险与回滚
- 图集与代码必须同批发布（`atlas.ts` 校验 `manifest.version` 与列数）；只回滚代码不会崩，但跳跃仍用新图集。
- 若行走跳观感不佳，回滚点集中在 `overlayTrackFor` 与 `perform` 两处，30 天内可单独恢复“行走不跳”而不动图集。

## 目录结构

```
packages/shared-types/src/
├── name.ts                          # [NEW] 显示宽度与截断纯函数：displayWidth / truncateToDisplayWidth，码点遍历，全角 2 半角 1
├── constants.ts                     # [MODIFY] 新增 MAX_NAME_DISPLAY_UNITS = 16，复用现有 MAX_NAME_CHARS / MAX_NAME_BYTES
├── protocol.ts                      # [MODIFY] truncateName 增加字符数上限，与字节上限并用；encodeHello / decodeHello 自动受益
├── index.ts                         # [MODIFY] 导出 name.ts 的公开函数与常量（若走 barrel 导出）
└── __tests__/name.test.ts           # [NEW] 覆盖中文、ASCII、emoji、零宽字符、边界 16 单元与省略号不超宽

apps/web/components/game/JoinGate.tsx  # [MODIFY] 保持 maxLength=16，输入变更与提交统一走 truncateName；补充“全角算 2 宽”的轻量提示
apps/web/lib/profile.ts                # [MODIFY] saveProfile / loadProfile 改用 truncateName，删除两处硬编码 slice(0, 16)
apps/web/lib/game/nameplate.ts         # [MODIFY] 增加昵称显示文本的宽度上限导出（纯文本函数，不引入 Pixi）
apps/web/lib/game/renderer.ts          # [MODIFY] 昵称 Text 使用截断文本；EntityView 新增 applyJump(lift, shadow)，body 与 labels 同步抬升；dustFrames 纳入 jump 末帧
apps/web/lib/game/pony-motion.ts       # [MODIFY] 新增 jumpLiftTexels 整数弧线纯函数，保持既有 0/-1 bob 契约不变
apps/web/lib/game/session.ts           # [MODIFY] perform 允许行走中起跳并保持 Walk/moving；tick 位移分支只清 emote；帧循环把跳跃弧线下发给渲染层
apps/web/lib/game/clip.ts              # [MODIFY] overlayTrackFor：jump 不再被 Walk 拦截，emote 在 Walk 仍回落基础轨
apps/web/components/game/ChatDock.tsx  # [MODIFY] 聊天列表昵称同样按显示宽度截断，避免撑开 340px 面板
apps/game-server/src/sim/movement.ts   # [MODIFY] 拆分 emote 与 jump 的准入条件，行走中放行 jump 位
packages/pixel-assets/src/quadruped.ts # [MODIFY] 跳跃腾空 hop -3 改 -6、收腿 lift 3 改 5，侧视与正/背视两条路径同步
packages/pixel-assets/src/layout.ts    # [MODIFY] jump 帧时长改 100/220/120，保持合计 440 与三帧预算
apps/web/lib/game/sprite-layout.generated.ts # [GENERATED] pnpm assets 重新生成，勿手改
apps/web/public/sprites/**             # [GENERATED] 图集与 manifest 重新生成
docs/adr/0018-emote-and-jump-overlay.md # [MODIFY] 更新行走跳跃规则、选帧优先级与取舍说明

测试：
apps/web/lib/game/__tests__/clip.test.ts          # [MODIFY] Walk+jump 返回 jump 轨；Walk+emote 仍为 null；原断言改写而非删除
apps/web/lib/game/__tests__/pony-motion.test.ts   # [MODIFY] 新增 jumpLiftTexels：整数、起落为 0、峰值不超过 6、单调区间正确
apps/web/lib/game/__tests__/nameplate.test.ts     # [MODIFY] 补充昵称显示截断与他人名字宽度上限用例
packages/pixel-assets/src/__tests__/overlay-frames.test.ts # [MODIFY] 提高腾空帧差异阈值，新增“顶部一行无像素”的裁切守卫
packages/pixel-assets/src/__tests__/layout.test.ts         # [MODIFY] 保持 440ms 合计断言，新增腾空帧时长大于蹲伏帧
```

## 关键结构

```ts
// packages/shared-types/src/name.ts
export function displayWidth(text: string): number;
export function truncateToDisplayWidth(text: string, maxUnits: number, ellipsis?: string): string;

// apps/web/lib/game/pony-motion.ts
/** 跳跃窗口内的整数抬升纹素：起落为 0，中段触顶 -6，供 body 与 labels 同步使用 */
export function jumpLiftTexels(phaseMs: number, durationMs: number): number;
```


## Agent Extensions

### Skill
- **layer-pixel-art**
  - Purpose: 指导 `quadruped.ts` 中跳跃蹲伏/腾空/落地三帧的比例与收腿几何调整，保证 64×64 帧内不裁犄角与描边
  - Expected outcome: 生成后的图集在腾空帧仍保留完整轮廓，头顶留白不少于 1 纹素
- **impeccable**
  - Purpose: 在实机验收阶段审查跳跃微动效的可读性、阴影切换与昵称跟随，避免抬升后文字压头或动效过冲
  - Expected outcome: 给出跳跃力度、阴影与文字避让的最终调整结论，形成可复验的验收清单
