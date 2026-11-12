# ADR-0055：手机端取消自动全屏，只保留手动按钮入口

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（体验反馈）、Web 客户端
- **Tags:** mobile, fullscreen, ux
- **Supersedes / superseded by:** 取代 ADR-0033 第 5 节中「自动全屏白名单 / `data-no-immersive`」部分，其余结论继续有效

## Context

此前手机端有两条被动进入全屏的路径：

1. 已有工牌的玩家在园区里第一次按下屏幕时，`GameViewport` 会在 `window` 的 `pointerdown` 里调用 `requestFullscreen`；
2. 新玩家点「上岗」时，`JoinGate` 的 `onEnter` 在同一个手势栈里顺带请求全屏。

线上反馈是「体验感不好、太吓人」：用户只想走一步或确认上岗时，浏览器界面突然消失，页面失去地址栏与返回入口，第一反应是页面被劫持。

浏览器要求 `requestFullscreen` 必须由用户手势同步触发，所以「横屏时自动全屏」也无法可靠实现：方向变化不是手势，移动端会直接拒绝。

## Decision

1. 删除所有主动进入全屏的逻辑：首次 `pointerdown` 自动全屏、`JoinGate` 上岗顺带全屏。
2. 页面默认保持浏览器原样（地址栏、导航条都在）。
3. 唯一的全屏入口是手机端右上角的全屏按钮（`useImmersiveStage().toggle`），由用户显式点击进入/退出。
4. 横竖屏切换不发起任何 `requestFullscreen`；朝向只影响 HUD 与触控区排布。
5. 删除 `data-no-immersive` 白名单标记：它只服务于已删除的自动全屏手势过滤。

## Consequences

- 玩家进入园区、首次操作、上岗都不再被强制全屏，主动退出全屏后也不会被再次拉回。
- 想沉浸玩的人仍可一键全屏；iOS Safari 不支持 `Element.requestFullscreen` 时按钮不出现（`supported === false`）。
- 保留离开园区时自动退出全屏的清理，避免全屏状态被带到其他页面。
- ADR-0033 第 5 节的 `data-no-immersive` 白名单与「点打卡下班先进全屏」排查项不再适用；历史 ADR 不改写。
- 回归检查：进入园区 / 首次按压 / 上岗均不触发全屏；右上角按钮可正常进出；旋转设备不触发全屏。
