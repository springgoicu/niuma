---
name: danmaku-font-clarity
overview: 放大弹幕字号（16→22px）、去掉描边与投影，改为单色实心清晰文字，并把轨道高度从 28px 调到 32px 以容纳新字号。
todos:
  - id: update-create-style
    content: 修改 apps/web/lib/game/danmaku.ts 的 createStyle()：fontSize 16→22，删除 stroke 与 dropShadow，padding 4→2，同步更新注释说明单色实心设计
    status: completed
  - id: bump-track-height
    content: 修改 apps/web/lib/game/danmaku-track.ts：DANMAKU_TRACK_HEIGHT 28→32，注释改为按 22px 字号描述
    status: completed
    dependencies:
      - update-create-style
  - id: run-tests-typecheck
    content: 运行 pnpm test（弹幕轨道/调色板测试）与 pnpm typecheck，确认轨道数场景断言全部通过
    status: completed
    dependencies:
      - update-create-style
      - bump-track-height
  - id: update-release-notes
    content: 按 AGENTS.md 在 release-notes.json 追加 ui 记录并运行 pnpm changelog:check 通过
    status: completed
    dependencies:
      - run-tests-typecheck
---

## Product Overview
园区全屏弹幕的可读性优化：当前弹幕为 16px 粗体 + 2px 黑描边 + 黑投影，小字叠加描边投影在快速划过时边缘发糊、难以辨认。

## Core Features
- 放大弹幕字号：16px → 22px，划过屏幕时更容易看清
- 移除描边与投影：文字变为单一实色、干净锐利，无花哨效果
- 保持粗体字重（700）：无描边时靠粗体维持雪地、草地等背景上的辨识度
- 保持发送者 8 色调色板功能不变（用户要求"单颜色"指文字实色渲染，不是砍掉选色功能）
- 轨道高度 28px → 32px，容纳放大后的字号，保持上下呼吸位
- 弹幕设置面板（总开关 / 不透明度 / 覆盖区域）行为完全不变

## Tech Stack
- 渲染：PixiJS v8 `TextStyle`（弹幕为屏幕空间层，挂在 stage 顶层，ADR-0056）
- 无新增依赖，纯表现层常量与样式调整

## Implementation Approach
弹幕文字样式只有唯一来源 `createStyle()`（8 种颜色各一份共享 `TextStyle`，激活时才写 style，帧循环只改 x/alpha）。改动集中在该函数与轨道布局常量：

1. **`createStyle()`**：`fontSize` 16→22；删除 `stroke` 与 `dropShadow` 两个字段；`padding` 4→2（描边投影移除后不再溢出字形包围盒，保留少量 padding 防止 emoji 前缀裁切）；`fontWeight` 保持 '700'；`fill` 保持调色板单色 hex。
2. **`DANMAKU_TRACK_HEIGHT`** 28→32 并同步注释（原注释写明是按"16px 字号 + 描边"设计）。
3. 轨道数钳制（8~12）下已验证关键场景不变：720p 仍 12 轨（usable 528/32=16→钳 12）、800x300 仍 8 轨（108/32=3→钳 8）、compact 3 轨、half 6 轨；测试文件全部引用 `DANMAKU_TRACK_HEIGHT` 常量、无硬编码 28，无需改测试。
4. 提交前按 AGENTS.md 追加版本工报记录并跑 `pnpm changelog:check`。

## Performance Notes
- 字号增大会让单条 Text 纹理面积增大约 80%（22²/16²），但对象池上限 120 / 活跃上限 100 不变，纹理仅在激活时重建，帧预算影响可忽略
- 移除描边投影后纹理更小更干净，反而略降显存
- 不动协议、不动调色板契约、不动 Worker 通道、不改历史 ADR（本次为表现层调优，不构成关键决策）

## Directory Structure Summary
```
niuma/
├── apps/web/lib/game/
│   ├── danmaku.ts          # [MODIFY] createStyle()：fontSize 16→22，删除 stroke 与 dropShadow，padding 4→2，更新注释
│   └── danmaku-track.ts    # [MODIFY] DANMAKU_TRACK_HEIGHT 28→32，同步常量注释
├── apps/web/data/
│   └── release-notes.json  # [MODIFY] 提交前追加一条 ui 记录（玩家可感知：弹幕更大更清晰）
└── apps/web/lib/game/__tests__/
    └── danmaku.test.ts     # [READ-ONLY] 测试引用常量，轨道数场景已人工验证不变，无需改动
```

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按 UI 修改强制流程加载设计纪律；本次为现有表现层收窄精修（Refinement preserves），遵循"保留现有身份、只改用户指定范围"原则
  - Expected outcome: 样式调整不引入反模式、不越界改动无关视觉元素
- **verification-before-completion**
  - Purpose: 交付前用真实命令输出（pnpm test / pnpm typecheck / changelog:check）作为完成证据，不做无证据断言
  - Expected outcome: 测试与类型检查全部通过后再宣布完成
