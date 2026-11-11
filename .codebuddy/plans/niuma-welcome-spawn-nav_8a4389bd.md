---
name: niuma-welcome-spawn-nav
overview: 把出生点从办公广场中心（工位环内）挪到园区北门入园口，并在出生点加入世界实体横幅「欢迎来到牛马园」与四向导航地图牌；同时新增入场 HUD 欢迎横幅和可收起的「园区导览」导航卡，指向工作区、卫生间、休息室、会议室。共享世界布局作为唯一真值，服务端只改出生中心，客户端渲染与 HUD 共用同一份导航目标数据。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素办公室
    - 暖褐墨色
    - 薄荷单点强调
    - 木质指路牌
    - 工牌档案卡
    - 克制动效
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 10px
      weight: 400
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#FFE49A"
      - "#8FE3C7"
    background:
      - "#14100C"
      - "#1B1611"
      - "#2E241D"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#A2917A"
    functional:
      - "#E06A5A"
      - "#6FB6C9"
      - "#2B2118"
todos:
  - id: spawn-contract
    content: 在 shared-types 落地北门出生中心与半径、导航目标、欢迎地标与区域名，并更新碰撞采样测试
    status: completed
  - id: server-spawn
    content: 服务端 spawnPoint 与 config 改用共享出生常量，补充北门出生落点测试
    status: completed
    dependencies:
      - spawn-contract
  - id: world-landmark
    content: 用 [skill:impeccable] 实现 WelcomeView 的实体横幅与四向指路牌，接入 sortLayer、DPR 与销毁链
    status: completed
    dependencies:
      - spawn-contract
  - id: hud-onboarding
    content: 用 [skill:impeccable] 实现入场欢迎条、可收起导览卡与 nav.ts 方位计算及测试
    status: completed
    dependencies:
      - spawn-contract
  - id: docs-verify
    content: 新增 ADR-0035，并用 [skill:verification-before-completion] 跑类型检查、三包测试与桌面触摸验收
    status: completed
    dependencies:
      - server-spawn
      - world-landmark
      - hud-onboarding
---

## 用户需求
把出生点从办公广场中心的工位环内迁到园区北门入口（约 4096,3300 的入园路口），新玩家不再在工位之间出生；重连回到上次位置的既有行为保持不变。北门要成为一个有仪式感的迎宾区，玩家一进园就能看到「欢迎来到牛马园」的实体横幅和一块四向指路牌，同时 HUD 上出现欢迎提示与可收起的园区导览。

## Product Overview
一座像素办公园区的新手入场体验：出生点从「工位中间」挪到「园区北门」，用世界内的横幅、木质指路牌和 HUD 导览卡，让玩家在 3 秒内知道自己在哪里、工作区、卫生间、休息室、会议室分别在哪个方向、走过去大概要多久。

## Core Features
- 出生点迁到北门入园口：新玩家落在北门土路与门肩的空地上，面向办公区；不落在任何工位、桌面或花箱上，重连 resume 行为不变。
- 世界内欢迎横幅：两根木柱撑起一条奶油色布幡，主文案「欢迎来到牛马园」，挂在北门通道上方，常驻场景，走远仍可辨认。
- 世界内四向指路牌：木柱 + 四块箭头木牌，分别指向工作区、卫生间、休息室、会议室，底部标注「你在这里」。
- HUD 入场欢迎条：进入园区时从顶部淡入，显示园区名与控制提示，约 6 秒后淡出，不重复打扰重连。
- HUD 园区导览卡：四行实时八向箭头 + 设施名 + 步行约几秒，最近的目标高亮；桌面默认展开，触摸端可收起为一枚「导览」按钮，不遮挡摇杆、动作盘、聊天与小地图。

## 视觉与交互
延续园区的暖褐墨色 HUD 与木质像素世界：2px 深褐边框、薄荷绿单点强调、等宽小字、1px 深靛描边；横幅用奶油布与深褐字，指路牌用木色与纸色，不引入新色系。所有面板可折叠、可键盘聚焦，动效克制，减少动态偏好下只做淡入淡出。

## 技术栈
- 前端：Next.js 15 App Router + React 19 + TypeScript + Tailwind CSS v4 + zustand
- 渲染：PixiJS 8（WebGPU/WebGL），沿用现有 `GameRenderer`、`SortLayer`、`PropsView`、`bake()` 管线
- 共享契约：workspace 包 `@niuma/shared-types`，世界布局、碰撞、常量与区域名的唯一真值
- 服务端：Bun + 现有 game-server；不新增协议包、不落库
- 测试：vitest（shared-types）、bun test（game-server、web `lib`）

## 实现策略
1. **出生点契约进共享布局**：在 `layout.ts` 新增 `SPAWN_CENTER`，把 `SPAWN_RADIUS` 从 300 收到约 72，保证整个出生圆落在北门土路与门肩空地内；服务端 `spawnPoint()` 只换采样中心，保留 16 次拒绝采样与 `findFreePoint` 兜底，复杂度仍为 O(1)。
2. **导航目标单一来源**：由 `WORKROOM / RESTROOM / LOUNGE / MEETING_ROOM` 的矩形中心派生 `NAV_TARGETS`，世界指路牌、HUD 导览卡、测试都读这一份，避免三处各写坐标。
3. **世界地标独立视图**：新增 `apps/web/lib/game/welcome.ts` 的 `WelcomeView`，构造期用 Graphics 烘焙横幅与指路牌，用 Pixi `Text` 写中文，按脚底 y 加入 `SortLayer`；不新增碰撞体，不进入每帧循环。
4. **HUD 两层**：`WelcomeBanner` 只做一次性入场提示；`NavCard` 订阅 store 的 `x/y`（现有 500ms 更新）实时计算方位、距离与步行秒数；纯计算抽到 `nav.ts`，便于单元测试。
5. **不动协议与恢复链路**：出生点仍由服务端 `S2C_WELCOME` 下发，resume 逻辑、座位恢复、`GAME_SPAWN_RADIUS` 压测开关全部保留；回滚只需恢复两个常量并移除 `WelcomeView` 调用。

## 性能与可靠性
- 世界地标约 6–10 个常驻显示对象，构造期烘焙一次；帧循环零分配、零重算，显存与初始化开销可忽略。
- 出生采样最多 16 次、单次 O(1)；北门口袋无碰撞道具，绝大多数首次采样即命中，不会触发兜底挪位。
- HUD 只订阅 `status / x / y`，2Hz 变化；欢迎条约 6 秒后卸载，定时器在卸载时清理，无长驻轮询。
- 中文世界文字使用 CJK 系统字体栈，`resolution = devicePxPerTexel`，并在 `syncMetrics` 的 DPR 变化时更新，避免发虚；`destroy()` 释放 Text 与烘焙纹理。

## 实施注意
- **不要改 `findFreePoint` 的最终兜底**：它同时服务移动卡死恢复，改成北门会把远处卡住的玩家传送到入口，属于不必要的爆炸半径；只让 `spawnPoint` 的最终兜底使用 `SPAWN_CENTER`。
- 出生圆必须完整落在土路与门肩（x 约 4032–4160、y 约 3224–3368），不要沿用 300 的半径，否则会重新落进工位环。
- 指路牌与横幅沿用 lamp/sign 的约定，不新增 `SolidRect`；若与 lamp、bin 的精灵相交，允许在 ±32px 内微调，或在 `canPlantWildTree` 增加一个小的地标留白矩形（只少几棵树，不改变随机序列）。
- HUD 不新增网络请求、不写 localStorage；折叠状态只放组件 state；不打印坐标、昵称等个人信息。
- 保留 `GAME_SPAWN_RADIUS` 环境变量覆盖能力，压测机器人路径不变。

## 架构设计
- **数据流**：`layout.ts` 的 `SPAWN_CENTER / SPAWN_RADIUS / NAV_TARGETS / WELCOME_LANDMARKS / 北门区域名` → 服务端 `spawnPoint` 与 `config`；客户端 `WelcomeView`、`NavCard`、`WelcomeBanner`；测试同源。
- **组件关系**：`GameViewport` 组合 `WelcomeBanner` 与 `NavCard`；`NavCard → nav.ts → NAV_TARGETS + MOVE_SPEED`；`WelcomeView → 同一份 NAV_TARGETS + Text`；服务端仍是出生点唯一权威。
- 不新增分层、不新增包；共享契约层继续承担「世界是什么」，客户端只负责表现。

## 目录结构
```
packages/shared-types/
├── src/world/layout.ts                    # [MODIFY] 新增 SPAWN_CENTER、收小 SPAWN_RADIUS、NAV_TARGETS、WELCOME_LANDMARKS、北门区域名；保持 WORLD_CENTER 供其它模块使用
├── src/__tests__/collision.test.ts        # [MODIFY] 出生采样改用 SPAWN_CENTER；断言落点在北门区域、可站立、不落水
apps/game-server/
├── src/sim/resume.ts                      # [MODIFY] spawnPoint 用 SPAWN_CENTER 采样，最终兜底 findFreePoint(SPAWN_CENTER)
├── src/config.ts                          # [MODIFY] spawnRadius 默认值改读 shared-types 的 SPAWN_RADIUS，移除重复字面量
├── src/sim/resume.test.ts                 # [MODIFY] 新增北门出生落点测试，保留原有 resume 用例
apps/web/
├── lib/game/nav.ts                        # [NEW] 八向方位、距离、步行秒数、最近目标的纯函数；供 HUD 与世界指路牌共用
├── lib/game/__tests__/nav.test.ts         # [NEW] 覆盖四个目标的方位、距离、八向边界与最近目标
├── lib/game/welcome.ts                    # [NEW] WelcomeView：木柱布幡「欢迎来到牛马园」+ 四向指路牌 + 你在这里；bake 纹理、Text、setTextResolution、destroy
├── lib/game/renderer.ts                   # [MODIFY] buildLayers 构建 WelcomeView 并 sortLayer.add；syncMetrics 同步文字 DPR；destroy 释放
├── components/game/WelcomeBanner.tsx      # [NEW] 入场欢迎条：首次 online 淡入、约 6 秒淡出、桌面与触摸端不同锚点与提示文案
├── components/game/NavCard.tsx            # [NEW] 可收起园区导览卡：四行箭头 + 设施名 + 步行秒数 + 最近高亮；桌面展开、触摸端自动收起
├── components/game/GameViewport.tsx       # [MODIFY] 在顶部右列挂载 NavCard、在 HUD 层挂载 WelcomeBanner，处理触摸/旋转安全区
docs/adr/
└── 0035-welcome-spawn-and-park-nav.md     # [NEW] 记录出生点迁移、世界地标与 HUD 分工、导航数据单一来源、回滚方式
```

## 关键结构
```ts
export interface NavTarget {
  readonly id: 'workroom' | 'restroom' | 'lounge' | 'meeting';
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

export const SPAWN_CENTER: { readonly x: number; readonly y: number };
export const SPAWN_RADIUS: number;
export const NAV_TARGETS: readonly NavTarget[];
export const WELCOME_LANDMARKS: {
  banner: { x: number; y: number; width: number; height: number };
  signpost: { x: number; y: number };
};

export interface NavReading {
  target: NavTarget;
  distance: number;
  seconds: number;
  octant: number;   // 0..7，北起顺时针
  angleDeg: number;
}
export function navReadings(x: number, y: number): NavReading[];
```

## 验收
`pnpm typecheck`、`pnpm --filter @niuma/shared-types test`、`pnpm --filter @niuma/game-server test`、`pnpm --filter @niuma/web test` 全绿；本地 `pnpm dev` 创建新角色后出生在北门、能看到横幅与指路牌、HUD 欢迎条 6 秒后消失、导览卡四向与实地方位一致、走动时距离更新、触摸横屏不遮挡摇杆与动作盘。

## 设计基调
延续「夜班像素办公园区」的世界观：HUD 是工牌与档案卡的语言，世界地标是木质指路牌与布幡。整体暖褐墨色、薄荷绿单点强调、2px 硬边、等宽小字，不做通用玻璃卡片堆叠，不引入新色系。

## 世界内（北门迎宾区）
- 横幅拱门跨北门通道：两根木柱（深褐描边、浅木高光）撑起奶油布幡，布幡下缘做三角流苏，中央「欢迎来到牛马园」用深褐中文，左上角一枚薄荷小旗，整体高度高于角色头顶，按柱脚 y 进入深度排序。
- 四向指路牌立在门侧土路肩：一根木柱上叠四块纸色木牌，每块左侧是薄荷箭头、右侧是设施名；底部小牌写「你在这里」，顶部小字「园区导览」。四块牌按真实方位排布（休息室偏左上、工作区右下、卫生间向下、会议室左下），走近可读、走远仍能认出是指路牌。
- 不新增碰撞体，玩家可以贴近合影；牌面文字与木色沿用现有 props 的 paper、wood、mint 调色板与 1px 深靛描边。

## HUD 入场欢迎条
顶部居中、宽度 min(520px, 92vw) 的横向条：左上角薄荷小方块 + 主标题「欢迎来到牛马园」，下方 mono 大写「WELCOME TO NIUMA PARK」，右侧一组控制提示（桌面 WASD 移动、Z 坐下、X 躺平、F 互动、Enter 打字；触摸端左半屏拖动、右下动作盘）。顶部 2px 薄荷进度条在 6 秒内走完，随后整体淡出并卸载；进入时向下 8px 淡入，减少动态偏好下只淡入淡出。触摸端改为底部中央、动作盘上方的紧凑版本，避免压住顶部工牌与聊天。

## HUD 园区导览卡
桌面放在右上按钮列下方，宽约 196px：头部 Compass 图标 + 「园区导览 / NAV」+ 折叠箭头；四行固定顺序，每行左侧 14px 八向箭头（最近目标用薄荷实心，其余 mist），中间设施名，右侧「≈8s」等宽步行秒数；最近目标行左缘加 2px 薄荷竖条。折叠后保留 40px 高的「导览」胶囊，仍显示最近目标的箭头。触摸端默认展开约 8 秒或离开北门区域后自动收起，点击胶囊向下展开，不覆盖摇杆与动作盘。整卡为 2px 深褐边框、ink-900/92 底、backdrop-blur，和 MiniMap、工牌同一套语言。

## 响应式与可访问性
桌面与触摸横屏分别布局；所有可点区域带 aria-label 与 aria-expanded，箭头图标 aria-hidden，欢迎条使用 role=status 与 aria-live=polite；焦点环使用现有 mint 样式；不依赖颜色单独传达方向，箭头与文字并存。

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按项目既有的暖褐 ink / mist / mint 视觉语言，完成世界地标与 HUD 欢迎条、导览卡的设计与打磨，避免模板化的通用卡片观感。
  - Expected outcome: 出生点横幅与指路牌、入场欢迎条、可收起导览卡在桌面与触摸横屏下都具备清晰的层级、克制的动效与一致的可访问性，并通过反模式自检。
- **verification-before-completion**
  - Purpose: 在宣告完成前实际执行类型检查与三个包的测试，并核对桌面/触摸的关键路径。
  - Expected outcome: 所有验证命令有真实输出记录，出生点、导航方位、折叠交互与响应式布局均有可复现的通过证据。
