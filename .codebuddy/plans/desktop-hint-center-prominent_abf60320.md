---
name: desktop-hint-center-prominent
overview: 把电脑端（非触屏）的互动提示从贴近底部的 112px 处迁到画面中线下方约 62% 处居中，并整体放大字号、键帽、内边距与光晕，让"靠近设施能互动"这件事一眼可见；触屏与竖屏落位保持现状，同步补测试、新 ADR 与版本工报。
todos:
  - id: hint-component
    content: 重构 InteractionHint：桌面提示移到 62% 居中并整体放大，使用 [skill:impeccable] 校验视觉层级
    status: completed
  - id: hint-tests
    content: 更新 interaction-hint 落位与尺寸断言，运行 bun test 与 typecheck
    status: completed
    dependencies:
      - hint-component
  - id: hint-docs
    content: 新增 ADR 0079 记录桌面落位变更，追加版本工报并跑 changelog:check
    status: completed
    dependencies:
      - hint-component
  - id: hint-verify
    content: 在 1280×720、1920×1080 与竖长窗口实测：不遮挡角色与动作条，可点击可键盘触发
    status: completed
    dependencies:
      - hint-tests
      - hint-docs
---

## 用户需求
电脑端靠近设施时弹出的互动提示不够醒目：现在贴在画面底部、字号偏小，容易被动作条与场景淹没。需要把它放到画面中明显的位置并放大。

## 产品概述
不改变互动逻辑、出现时机与可点击行为，只调整电脑端提示的落位与视觉分量，让玩家在场景中一眼看到「此刻能做什么」，并仍可用鼠标点击或快捷键触发。

## 核心功能
- 桌面端全部提示（可点互动按钮、状态/劝阻文案、告示板提示）统一落在画面中线偏下约 62% 处水平居中，避开画面正中的角色本体
- 桌面端提示整体放大一档：键帽、动作名、内边距、描边与光晕同步增强，保持现有像素风 HUD 语言
- 触屏端与竖屏落位、尺寸保持现状；点击、悬停、键盘焦点、aria 说明与入场动效不变
- 提示仍然只在靠近设施时出现，消失时机、按键映射与服务端判定零改动

## 技术栈
- Next.js 15 + React 19 + TypeScript（`apps/web/components/game/InteractionHint.tsx`，客户端展示组件）
- Tailwind CSS v4 原子类（项目现有 HUD 样式体系：`ink-*` / `mint-*` / `mist-*` 令牌、`font-mono`、`animate-hint-in`）
- 测试：bun test（`pnpm --filter @niuma/web test`，即 `bun test lib`）+ `tsc --noEmit`
- 记录：`docs/adr/` 新增决策，`pnpm changelog:check` 校验版本工报

## 实现方案

### 1. 落位改为「设备优先」而非「提示类型优先」
`placement()` 当前先判 `HINT.bulletin` 再按 `isTouch/portrait` 分三套偏移，桌面通用提示是 `bottom-[112px]`、桌面告示板是 `bottom-28 right-4`，都在画面下缘。改为：

- `!isTouch`（真正的电脑端，含桌面窗口被拖成竖长条的情况）先返回统一桌面锚点：`left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2`；
- 其余分支（触屏横屏 `bottom-56`、触屏竖屏 `bottom-[296px]`、告示板 `bottom-56 right-3` / `bottom-[300px] right-3`）原样保留；
- 桌面端告示板特例随之上移，符合「桌面端全部提示统一位置」的确认结果。

锚点用 Tailwind 任意值 `top-[62%]`，相对 `GameViewport` 的 `relative h-dvh overflow-hidden` 容器，无需改配置或新增 CSS 变量。

### 2. 尺寸分级：桌面放大、触屏不动
在组件内沿用现有三元表达式风格做两档尺寸，不引入抽象层：

- 桌面按钮：容器 `min-h-14 gap-3 px-5 py-3`，键帽 `h-8 min-w-8 text-[13px]`，动作名 `text-[15px] tracking-[0.14em]`，分隔线 `h-5`，副标 `text-[11px]`，光晕从 `-6px` 扩到约 `0 0 32px -8px`；
- 桌面状态胶囊：`px-5 py-2.5 text-[13px] tracking-[0.18em]`，保留 `role="status"` 与 `signal-500` 文案色；
- 触屏两档尺寸、`min-h-10`、隐藏键帽、`轻点` 文案全部保持原值。

### 3. 关键取舍
| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| A. 屏幕正中 50% | 最醒目 | 压住正中的角色与设施本体 | 用户已否决 |
| B. 跟着设施在世界里浮动 | 指向最准 | Worker 无投影能力，需新增每帧坐标同步（ADR-0068 备选 B 已否决） | 否决 |
| C. 中线偏下 62% + 桌面尺寸分级（采纳） | 不挡角色、离开底部动作条、改动只在一层视图 | 告示板桌面落位与 ADR-0068 记录冲突，需新增 ADR 覆盖 | 采纳 |

### 4. 性能与可靠性
- 纯静态类名变更，无新增监听、无每帧计算；组件只在 `hint` 字符串变化时重渲染；
- 入场动效 `animate-hint-in` 挂在内层按钮上，位移 `-translate-y-1/2` 必须留在外层 wrapper，避免叠加 transform 抖动；
- 全站 `prefers-reduced-motion` 规则会把动画时长归零，无需单独处理；
- 不触碰 `GameViewport` 的 props、`onAction → perform` 链路与 Worker 协议，回滚只需还原 `placement()` 与尺寸类名。

## 实现注意事项
- 现有测试把「桌面 + portrait」当作旧落位（`bottom-[296px]`、`bottom-28 right-4`）断言，改造后这类组合会走 62% 锚点，必须把触屏竖屏用例改成 `isTouch=true, portrait=true` 再断言；
- 二合一笔记本因 `any-pointer: coarse` 判为触屏（ADR-0032），仍走触屏落位，本次不新增设备嗅探；
- 提示外层仍是 `pointer-events-none`，只有按钮 `pointer-events-auto`；放大后不要给 wrapper 加 `pointer-events-auto`，否则会挡住点选角色与场景点击；
- 不要修改 `docs/adr/0068-facility-hint-buttons.md`，按项目规则新增 ADR 覆盖其桌面落位条款；
- 版本工报 id 顺延为 `2026-11-13-25`，只写玩家可感知结果，不出现文件名、类名、坐标值。

## 架构设计
单层展示组件调整：`GameViewport`（定位宿主，不改）→ `InteractionHint`（落位函数 + 尺寸分级）→ `hint-copy`（文案与动作映射，不改）。无新增模块、无跨层依赖，未引入新模式。

## 目录结构
```
niuma/
├── apps/web/
│   ├── components/game/
│   │   └── InteractionHint.tsx                     # [MODIFY] 重写 placement()：!isTouch 统一 62% 居中锚点（含告示板），触屏/竖屏分支保留；新增桌面尺寸档：按钮 min-h-14/px-5/py-3、键帽 h-8、动作名 15px、状态胶囊 13px，光晕加强；保留 animate-hint-in 在内层、pointer-events 与 aria 属性不变
│   ├── lib/game/__tests__/
│   │   └── interaction-hint.test.tsx               # [MODIFY] 断言桌面含 top-[62%]、-translate-y-1/2 且不含 bottom-[112px]/bottom-28；桌面+portrait 也居中；触屏横竖屏与告示板旧落位改用 isTouch=true 断言；补桌面状态胶囊放大与触屏尺寸不变用例
│   └── data/
│       └── release-notes.json                      # [MODIFY] entries 首位插入 2026-11-13-25，一条 ui 类改动说明桌面提示上移放大
└── docs/adr/
    └── 0079-desktop-hint-prominence.md             # [NEW] 记录桌面提示迁到 62% 与尺寸放大的决策：背景、决策、备选对照、后果与回滚；显式覆盖 ADR-0068 第 3 条中「桌面底部居中」的约定，不改历史 ADR
```

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按项目 UI 规范执行提示的视觉层级调整（/impeccable polish），校验放大后的字号、对比度、描边与光晕是否协调，避免堆砌发光导致廉价感
  - Expected outcome: 桌面提示在 62% 落位下清晰、克制、与现有像素风 HUD 一致，并通过无障碍与 reduced-motion 自检
