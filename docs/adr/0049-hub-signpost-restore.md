# ADR-0049：中央导览牌回退为四向指路牌、删除打卡签到处

- 状态：已采纳
- 日期：2026-11-12

## 背景

ADR-0047 把中央广场的地标改成「霓虹拱门 + 园区导览地图立牌 + 打卡签到处」：导览牌是一张静态小地图
（草块、两片水、两条路、一个打卡点圆点），打卡柱立在拱门西侧。用户反馈两点：

1. 地图上不要打卡——世界里的打卡签到处，以及导览图上的打卡点圆点都要去掉；
2. 园区导览要回到 ADR-0047 之前那块**四向指路牌**：四行设施名 + 八向像素箭头 + 「你在这里」，
   箭头按牌子自身位置实时计算；点击寻路继续走 HUD 导览卡，不做世界地标点选。

## 决策

### 1. 删除打卡签到处

`WELCOME_LANDMARKS` 删除 `checkin`，`HUB_SOLIDS` 删除对应碰撞盒；`welcome.ts` 删除
`drawCheckin` / `buildCheckin` 与「打卡 / 签到」两条文字。广场西侧不再有立柱，也不再挡路。

### 2. 导览牌恢复上一版图形与逻辑

以 `9c913d4^` 的 `drawSignpost` / `drawArrow` 为蓝本恢复：

- 顶牌「园区导览」+ 菱形记号，四行设施牌（工作区 / 卫生间 / 宿舍区 / 会议室），底部「你在这里」反色标签；
- 箭头在**构造期**用 `navReadings(DIRECTORY.x, DIRECTORY.y)` 取八向并烘焙进纹理；地标是静态的，
  方位只取决于牌子位置，不随玩家移动变化，也不进入帧循环；
- 绘制尺寸按 `DIRECTORY.width / height` 参数化（96×92 与旧画布逐一重合），不在 `welcome.ts` 写第二份尺寸；
- 删掉静态小地图，纸面上的「打卡点」圆点随之消失。

### 3. 尺寸进入共享契约

`directory` 由 72×84 改为 96×92（旧画布真实尺寸），碰撞盒仍由 `directory.width / height` 派生。
新占地为 `x 4262..4358 / y 4340..4432`：与东南支路（半宽 48）最近约 22px，与拱门右立柱留 16px，
与东侧花箱（圆心 4372,4372 / 半径 12）留 2px，均不重叠。

### 4. HUD 点击寻路不变

`NavCard` 四行 → `session.navigateTo` → `pathfinding` / `navigator` 零改动；
本轮**不做**世界地标点选热区，也**不做**小地图点击寻路。

## 后果

- 正面：中央广场回到「拱门 + 四向指路牌」的轻量构图，牌面直接可读四个设施的真实方位；
  世界与 HUD 仍共用 `NAV_TARGETS`，改房间位置不会出现第二份坐标。
- 负面：纸面小地图的「俯瞰感」消失，玩家要靠牌面文字与 HUD 卡理解园区；
  导览牌文字从 2 张位图增至 6 张，净增约 2 张（打卡柱的两张文字同步删除）。
- 回滚成本：低。四个文件即可还原：`layout.ts`、`welcome.ts`、两处布局测试；ADR 无需回滚。

## 复核信号

- 广场上又出现打卡柱：查 `WELCOME_LANDMARKS.checkin` 是否被加回、`build()` 是否多了一次构建；
- 导览牌箭头不跟着设施位置变：查是否仍走 `navReadings(DIRECTORY.x, DIRECTORY.y)`，不要写死 octant；
- 牌面与东南支路/花箱重叠：先查 `directory` 的 96×92 是否被改小或改大，再查 `layout-hub` 的九点采样断言；
- 点击 HUD 导览卡没反应：查 `NavCard` 的 `onNavigate` 是否仍接到 `session.navigateTo`，与本 ADR 无关。

## 验证

- `pnpm --filter @niuma/shared-types test`
- `pnpm --filter @niuma/web test`
- `pnpm typecheck`
- 手工：从中央广场点四次「去这里」，确认四个房间均可到达、导航中可取消。

## 参考

- Code: `packages/shared-types/src/world/layout.ts`、`apps/web/lib/game/welcome.ts`、
  `apps/web/components/game/NavCard.tsx`
- Related ADRs: ADR-0036（四向指路牌与 HUD 导览）、ADR-0040（自动寻路）、ADR-0047（中央枢纽，部分被本 ADR 取代）
