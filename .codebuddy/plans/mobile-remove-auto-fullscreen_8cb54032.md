---
name: mobile-remove-auto-fullscreen
overview: 移除手机端所有主动进入全屏的逻辑（首次按下自动全屏、点「上岗」顺带全屏），只保留右上角手动全屏按钮，同时清理因此失效的 data-no-immersive 白名单标记。
todos:
  - id: remove-auto-fullscreen
    content: 删除 GameViewport 自动全屏 effect、autoImmersiveRef 与 JoinGate 内的 immersive.enter()
    status: completed
  - id: keep-manual-fullscreen
    content: 复检右上角手动全屏按钮，更新 GameViewport 与 use-touch-stage 注释为手动唯一入口
    status: completed
    dependencies:
      - remove-auto-fullscreen
  - id: cleanup-markers
    content: 清理 7 个组件中 13 处 data-no-immersive 白名单标记
    status: completed
    dependencies:
      - remove-auto-fullscreen
  - id: record-adr
    content: 新增 ADR 0055，记录取消自动全屏并说明取代 ADR-0033 第 5 节白名单
    status: completed
    dependencies:
      - remove-auto-fullscreen
  - id: verify-mobile
    content: 运行 typecheck 与单测，检索无残留，并按手机端清单验收全屏行为
    status: completed
    dependencies:
      - keep-manual-fullscreen
      - cleanup-markers
      - record-adr
---

## 产品概览
移除手机端所有自动进入全屏的行为，让页面保持浏览器默认显示；仅保留用户主动点击全屏按钮这一条入口，降低突然全屏带来的惊吓感。

## 核心功能
- 删除进入园区后首次按压屏幕自动全屏的逻辑
- 删除点击「上岗」进入园区时顺带请求全屏的行为
- 保留右上角手动全屏按钮，可主动进入与退出全屏
- 横竖屏切换只影响界面布局，不发起任何全屏请求
- 清理仅服务于自动全屏的 data-no-immersive 白名单标记，避免遗留误导性死代码

## 技术栈
- 前端：Next.js 15 + React 19 + TypeScript（复用 apps/web 现有栈，不新增依赖）
- 验证：pnpm --filter @niuma/web typecheck、bun test lib、全局残留检索

## 实现方案
采用「单点收敛」策略：全屏能力只由用户手势显式触发，自动触发路径全部移除。

- 删除 `GameViewport.tsx` 中的 `autoImmersiveRef` 与监听 `window pointerdown` 的自动全屏 effect，同时删除其中的 `[data-no-immersive]` 选择器判断
- 删除 `GameViewport.tsx` 中 `JoinGate` 的 `onEnter` 回调里的 `immersive.enter()`，上岗仅做登记与姿态切换
- 保留 `useImmersiveStage()` 与右上角全屏按钮：`enter/exit/toggle`、`supported/active`、卸载时退出全屏的清理逻辑均不动。全屏请求仍由按钮 click 同步触发，符合浏览器手势要求
- 删除 7 个组件里 13 处 `data-no-immersive` 属性；这些属性只被已删除的自动全屏白名单读取，无样式或测试依赖
- 更新注释语义：GameViewport 中「自动全屏被系统拒掉之后」的说明改为「手机端唯一全屏入口」；`use-touch-stage.ts` 注释明确该 hook 只服务手动按钮
- 新增 ADR `0055-manual-only-fullscreen.md` 记录该决策，并注明取代 ADR-0033 第 5 节的自动全屏白名单；按项目规则不改写历史 ADR

关键取舍：不做「横屏自动全屏」。方向变化不是用户手势，`requestFullscreen` 在移动浏览器会被拒绝，且失败路径会带来额外状态与埋点复杂度，收益为零。

性能与可靠性：删除一个 window 级 pointerdown 监听与相关分支，减少一次全局事件处理与潜在的全屏状态抖动；无新增运行时开销。所有删除均为行为收敛，不涉及数据流、渲染循环或网络协议。

## 实现注意事项
- 不要删除 `useRef` import：`profileRef`、`clientRef`、`careerClockRef` 等仍在使用
- 不要删除 `useImmersiveStage` 的卸载清理 effect（离开园区时退出全屏，避免把全屏带到其他页面）
- 不改动 `useIsPortrait` 与 `portrait` 布局分支，横竖屏排布保持现状
- 删除属性后确认无残留引用：检索 `autoImmersive`、`data-no-immersive`、`immersive.enter`
- 手机端验收：进入园区、首次按屏幕、点「上岗」均不触发浏览器全屏；右上角按钮可正常进入与退出；旋转设备不触发全屏

## 目录结构
```
apps/web/
├── components/game/GameViewport.tsx        # [MODIFY] 删除 autoImmersiveRef、pointerdown 自动全屏 effect、JoinGate 中的 immersive.enter()；保留手动全屏按钮并改写注释
├── components/game/ChatDock.tsx            # [MODIFY] 删除聊天折叠头上的 data-no-immersive
├── components/game/LeaderboardDialog.tsx   # [MODIFY] 删除遮罩与面板上的 2 处 data-no-immersive
├── components/game/NoticeBoard.tsx         # [MODIFY] 删除触发器与收起按钮上的 2 处 data-no-immersive
├── components/game/TouchControls.tsx       # [MODIFY] 删除摇杆热区上的 data-no-immersive
├── components/BadgeCard.tsx                # [MODIFY] 删除工牌与档案入口上的 2 处 data-no-immersive
├── components/badge/BadgeArchiveDialog.tsx # [MODIFY] 删除遮罩与面板上的 2 处 data-no-immersive
└── lib/use-touch-stage.ts                  # [MODIFY] 仅更新注释：全屏 hook 只服务手动按钮，行为不变
docs/adr/
└── 0055-manual-only-fullscreen.md          # [NEW] 记录取消自动全屏、仅保留用户手势入口的决策与后果
```

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 在删除全屏按钮周边注释与属性后，复检手机端 HUD 的交互层级与可访问性未被破坏
  - Expected outcome: 手动全屏按钮的 aria-label、aria-pressed、焦点样式与触控热区保持可用，无新增 a11y 告警
