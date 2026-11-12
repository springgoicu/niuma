---
name: danmaku-motion-smoothness
overview: 弹幕运动可读性优化：滚动时长 7200→9600ms 放慢，顶/底固定弹幕新增 300ms 缓动淡入，淡出改 smoothstep 曲线，消除"硬切出现、匀速划过"的生硬感。
todos:
  - id: slow-scroll-speed
    content: 使用 [skill:impeccable] 修改 danmaku.ts 滚动时长 7200→9600ms 并同步速度注释
    status: completed
  - id: smooth-fixed-transitions
    content: FixedItem 增加 spawnAt，实现固定弹幕 300ms easeOutCubic 淡入与 smoothstep 淡出
    status: completed
    dependencies:
      - slow-scroll-speed
  - id: verify-tests-typecheck
    content: 使用 [skill:verification-before-completion] 运行 pnpm test 与 pnpm typecheck 确认零失败
    status: completed
    dependencies:
      - smooth-fixed-transitions
  - id: update-release-notes
    content: 按 AGENTS.md 在 release-notes.json 最前追加记录并运行 pnpm changelog:check 通过
    status: completed
    dependencies:
      - verify-tests-typecheck
---

## Product Overview
园区全屏弹幕的运动观感优化。现状问题：滚动弹幕速度偏快（速度公式 (屏宽+360)/7200ms，1280px 屏约 228px/s，一句话约 7 秒划完，不易读）；顶/底固定弹幕出现时是硬切（alpha 瞬间置 1，无淡入），消失时为 0.5s 线性淡出，整体过渡生硬。

## Core Features
- 滚动弹幕放慢：参考时长 7200ms → 9600ms，滚速放慢约 25%，文字划过更易读；保持全部同速防追尾的轨道设计不变
- 固定弹幕平滑淡入：新增 300ms easeOutCubic 缓动淡入，消除出现瞬间的硬切感
- 淡出曲线平滑：0.5s 淡出由线性改为 smoothstep 缓动，首尾减速更自然
- 运动平滑性已确认无需改动：帧循环基于 ticker.deltaMS 推进（session.ts:1749，帧率无关）
- 范围边界：不加新的用户设置项（沿用设置面板"防打扰而非调外观"定位）；不动协议、对象池、轨道算法与偏好契约；不改历史 ADR

## Tech Stack
- 渲染层：PixiJS v8（Text / Container），无新增依赖，纯表现层常量与缓动曲线调整
- 改动集中在 `apps/web/lib/game/danmaku.ts`：常量、`FixedItem` 接口、`update()` 固定弹幕分支、`spawnFixed()`

## Implementation Approach
1. **滚速放慢**：`DANMAKU_SCROLL_DURATION_MS` 7200→9600，速度公式与 `SCROLL_TAIL_PAD=360` 短句保护不变
2. **淡入**：新增 `DANMAKU_FIXED_FADE_IN_MS = 300`；`FixedItem` 增加 `spawnAt` 字段，`until` 语义调整为淡出起点 = spawnAt + 淡入 + 停留；出现期 alpha = easeOutCubic(t)
3. **淡出**：线性 alpha 改为 `1 - smoothstep(t)`；淡入淡出缓动为模块内两个纯函数助手
4. **轨道占用兼容**：`fixedFreeUntil[lane] = until + FADE_MS + 1` 公式不变（until 已含淡入期），同帧连发互斥语义不受影响

## Performance Notes
- 每帧只写 alpha 标量，不重建纹理、不新增对象；对象池 120 / 活跃上限 100 不动
- 固定弹幕 spawn 即计轨道占用，淡入期间仍独占轨道，避让语义与之前一致
- dt 已在 update 内钳制 0~64ms，低帧率下运动与过渡都不会跳变

## Architecture Design
- 单文件表现层调优：`DanmakuField` 对外接口（push / setPrefs / resize / clear / destroy）签名不变
- 帧循环纪律保持：每帧只改 x / alpha，text 与 style 仍只在激活时写一次
- 不动 `danmaku-track.ts` 纯函数层、不动协议与偏好存储

## Directory Structure
```
niuma/
├── apps/web/lib/game/
│   └── danmaku.ts          # [MODIFY] 滚动时长常量 9600ms；FixedItem 增加 spawnAt；淡入 easeOutCubic 与淡出 smoothstep
├── apps/web/data/
│   └── release-notes.json  # [MODIFY] 提交前追加本次优化记录（perf/ui）
└── apps/web/lib/game/__tests__/
    └── danmaku.test.ts     # [READ-ONLY] 只测轨道布局与调色板，不导入 danmaku.ts，无需改动
```

## Key Code Structures
```ts
interface FixedItem {
  readonly sprite: Text;
  readonly mode: DanmakuMode;
  readonly lane: number;
  readonly spawnAt: number;  // 新增：淡入起点时刻
  readonly until: number;    // 淡出起点 = spawnAt + FADE_IN_MS + HOLD_MS
}
```

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: UI 相关代码修改的强制流程；本次为现有动效的表现层收窄精修，遵循 Refinement preserves 原则，只动用户指定范围
  - Expected outcome: 动效参数与缓动调整不引入反模式、不越界改动无关视觉元素
- **verification-before-completion**
  - Purpose: 交付前用 pnpm test / pnpm typecheck / pnpm changelog:check 的真实输出作为完成证据
  - Expected outcome: 全部验证命令 exit 0 后才宣布完成，不做无证据断言
