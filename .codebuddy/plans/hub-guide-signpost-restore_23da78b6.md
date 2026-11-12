---
name: hub-guide-signpost-restore
overview: 删除世界里拱门西侧的打卡签到处（渲染 + 共享地标数据 + 碰撞体），并把中央导览地标从「静态导览地图立牌」恢复成 ADR-0047 之前的四向指路牌（四行设施名 + 八向薄荷箭头 + 「你在这里」，箭头按牌位实时计算）；导览牌纸面上的打卡点随旧图一同消失。HUD 导览卡的点击寻路保持现状，不改行为。
todos:
  - id: remove-checkin
    content: 删除打卡签到处：WELCOME_LANDMARKS.checkin、HUB_SOLIDS 条目与 welcome.ts 的绘制和文字
    status: completed
  - id: restore-signpost
    content: 用 [skill:layer-pixel-art] 恢复四向指路牌图形与 navReadings 箭头逻辑，尺寸改为 96×92
    status: completed
    dependencies:
      - remove-checkin
  - id: tests-docs
    content: 更新 layout-hub 与 collision 测试及 README，新增 ADR-0049 记录本次回退
    status: completed
    dependencies:
      - restore-signpost
  - id: verify-nav
    content: 用 [skill:verification-before-completion] 跑测试与 typecheck，手工验证 HUD 四处寻路
    status: completed
    dependencies:
      - tests-docs
---

## 产品概述
把牛马园区中央广场的导览地标恢复成上一版四向指路牌，并移除世界里的打卡签到处；HUD 导览卡继续支持点击寻路。

## 核心功能
- 删除拱门西侧的打卡签到处：画面、地标与占位一起移除，广场上不再出现打卡柱，也不再挡路。
- 导览牌恢复为上一版四向指路牌：顶部「园区导览」，四行设施名（工作区 / 卫生间 / 宿舍区 / 会议室）加八向像素箭头，底部「你在这里」。
- 箭头按牌子自身位置实时计算，设施位置变化时方向自动跟随；牌面不再画静态小地图，原先的「打卡点」圆点随之消失。
- HUD 右侧导览卡保持四行可点击，点「去这里」角色自动寻路到对应设施，导航中可取消；本次只做回归验证，不改交互。

## 视觉结果
- 中央广场南缘：拱门居中，东侧立一块 96×92 的木质四向指路牌；西侧原本的打卡柱消失，圆庭外缘更干净。
- 指路牌为纸色牌面加薄荷箭头加深色「你在这里」标签，与现有拱门、路灯、花箱保持同一套木质与薄荷色板。
- 小地图与 HUD 布局不变。

## 技术栈
- 沿用现有 pnpm + Turbo monorepo：`packages/shared-types` 保存世界布局唯一真源，`apps/web` 用 Next.js 15 + React 19 + PixiJS 8 渲染；测试为 Vitest（shared-types）与 Bun test（web）。
- 不新增依赖，不改网络协议，不改服务端，不写 localStorage。

## 实现策略
1. **数据契约**：`packages/shared-types/src/world/layout.ts` 的 `WELCOME_LANDMARKS` 删除 `checkin`；`directory` 由 72×84 改为 96×92（旧画布真实尺寸）；`HUB_SOLIDS` 删除打卡柱条目，导览牌碰撞盒继续由 `directory.width/height` 派生，避免第二份尺寸。
2. **渲染回退**：以 `git show 9c913d4^:apps/web/lib/game/welcome.ts` 为蓝本，恢复 `OCTANT_VECTORS`、`drawArrow`、`drawSignpost`、`buildSignpost`、`signReadings`；删除 `drawDirectory`、`drawCheckin`、`buildCheckin`；`build()` 只建拱门与导览牌。
3. **单一尺寸来源**：恢复后的绘制以 `DIRECTORY.width/height` 参数化（顶牌 `(w-72)/2`、四行 `6..w-6`、底牌 `(w-52)/2`、文字 `base + h - 7`），在 96×92 下与旧像素逐一重合；不在 `welcome.ts` 写第二份 96/92 常量。
4. **箭头逻辑**：构造期调用 `navReadings(DIRECTORY.x, DIRECTORY.y)` 计算四行八向，烘焙进纹理；地标是静态的，方位只取决于牌子位置，不随玩家移动变化，也不进入帧循环。HUD `NavCard` 仍按玩家位置实时计算，两者共用 `NAV_TARGETS`。
5. **HUD 寻路**：`NavCard`、`GameViewport`、`session.navigateTo`、`pathfinding`、`navigator` 零改动，只在验收时回归四条路线。
6. **测试**：更新 `layout-hub` 与 `collision` 两处地标断言；新增「导览牌 96×92 占地不与任何路径多边形、拱门两立柱相交」与「`WELCOME_LANDMARKS` 只剩 `arch` / `directory`」。
7. **文档**：README 去掉「园区导览地图立牌与打卡签到处」；新增 `docs/adr/0049-hub-signpost-restore.md` 记录本次回退，不改写 ADR-0047。

## 性能与可靠性
- 图形全部在构造期烘焙成 1:1 纹理，中文走 Pixi `Text`；帧循环零分配、零新增绘制调用。
- 净变化：删除打卡柱（1 张纹理 + 2 张文字位图），导览牌文字从 2 张增至 6 张，总量约多 2 张位图，可忽略。
- 碰撞：新占地约 `x 4262..4358 / y 4340..4432`，与东南支路（半宽 48）最近约 7px，不重叠；与拱门右立柱（右缘 4246）留 16px；右侧花箱圆心 `(4372,4372)` 半径 12，与新右缘仅 2px。测试锁定不重叠，避免后续改路网时悄悄压路。
- 无网络、无持久化、无服务端改动；回滚只需还原 4 个文件。

## 实现要点
- 只删「世界里的打卡签到处」和「导览图上的打卡点」，保留 HUD「打卡下班」与 JoinGate「打卡进入园区」文案。
- 色板：新增 `clothLight: 0xfff3c9`；删除仅旧导览图使用的 `grass / water / dirt / pin`；`iron / ironLight` 仍被拱门使用，不能删。
- 四行顺序固定为 `NAV_TARGETS`：工作区 / 卫生间 / 宿舍区 / 会议室；箭头 `octant` 直接来自 `navReadings`。
- 不给世界地标加点选热区；本次点击寻路只走 HUD 卡（用户已确认）。
- 导览牌坐标保持 `(4310, 4432)`：西移会压拱门右立柱，东移会压花箱；若验收觉得与拱门 6px 太挤，只允许整体南移并同步测试，不要改路网。
- 绘制坐标全部 `Math.round`，保持 1px 硬边；旧画法的文字基准 `base = -h` 不要写死 85。
- 验证：`pnpm --filter @niuma/shared-types test`、`pnpm --filter @niuma/web test`、`pnpm typecheck`；手工从广场点四次「去这里」，确认到达四个房间。

## 架构与数据流
`layout.ts` 仍是唯一坐标源：`WELCOME_LANDMARKS` 提供位置与尺寸，`HUB_SOLIDS` 派生碰撞；`welcome.ts` 只读契约并在构造期烘焙；`nav.ts` 只做纯计算；`NavCard → session.navigateTo → pathfinding → navigator` 本次完全不动。无新模块、无新依赖、无跨包循环。

## 目录结构
```
packages/shared-types/src/world/layout.ts               # [MODIFY] 删除 checkin；directory 改为 96×92；HUB_SOLIDS 删打卡柱并更新注释
packages/shared-types/src/__tests__/layout-hub.test.ts  # [MODIFY] 地标断言改为 arch + directory；新增导览牌九点采样不压路、不压拱门立柱、WELCOME_LANDMARKS 无 checkin
packages/shared-types/src/__tests__/collision.test.ts   # [MODIFY] 去掉 checkin 解构与出生圈断言，仅保留 arch / directory
apps/web/lib/game/welcome.ts                            # [MODIFY] 删除 drawDirectory/drawCheckin/buildCheckin；恢复 OCTANT_VECTORS/drawArrow/drawSignpost/buildSignpost/signReadings；色板增删
README.md                                               # [MODIFY] 「园区导览地图立牌与打卡签到处」改为「四向园区导览牌」
docs/adr/0049-hub-signpost-restore.md                   # [NEW] 记录本次回退：删打卡柱、恢复四向牌、HUD 寻路不变、测试与回滚
```

不改动但需回归：`apps/web/components/game/NavCard.tsx`、`GameViewport.tsx`、`apps/web/lib/game/nav.ts`、`pathfinding.ts`、`navigator.ts`。

## 关键结构
```ts
export const WELCOME_LANDMARKS = {
  arch: { x: PLAZA_CENTER.x, y: 4408, width: 320, height: 112 },
  /** 四向园区导览牌：拱门东侧、圆庭外缘；96×92 与旧画布一致 */
  directory: { x: 4310, y: 4432, width: 96, height: 92 },
} as const;

function drawSignpost(g: Graphics, w: number, h: number, arrows: readonly number[]): void;
function buildSignpost(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void;
```

## Agent Extensions
### Skill
- **layer-pixel-art**
  - Purpose: 复核恢复后的四向指路牌像素画法：96×92 画布、12×12 八向箭头、整像素坐标、现有木质 / 纸色 / 薄荷色板。
  - Expected outcome: 四行箭头与文字在 1x / 2x DPR 下保持硬边，不糊、不偏色，与拱门、路灯、花箱风格一致。
- **verification-before-completion**
  - Purpose: 交付前跑 shared-types / web 测试与 typecheck，并手工核对 HUD 四条点击寻路。
  - Expected outcome: 有命令输出与手工验证证据，四个设施均可到达，不以「看起来没问题」收尾。
