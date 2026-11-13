---
name: render-backend-webgl2-default-and-crash-recovery
overview: 把渲染后端默认值从 WebGPU 切到 WebGL2（Worker 与预览统一，`?gpu=webgpu` 才开 WebGPU），并为渲染线程 fatal 补一条「带 `gpu=webgl` 受控重载一次 → 守卫拦下后退回主线程」的自动恢复阶梯；补 ADR、单测与版本工报。
todos:
  - id: gpu-preference
    content: 新增 resolveGpuPreference 并接入 renderer 与预览，补齐默认 webgl 的单测
    status: completed
  - id: render-fatal-reload
    content: 在 render-mode 实现 reloadForRenderFatal：URL 写 gpu=webgl 且只放行一次
    status: completed
    dependencies:
      - gpu-preference
  - id: worker-fatal-ladder
    content: 改造 worker-client 的 fatal 恢复阶梯：先降级重载，拦下后退主线程
    status: completed
    dependencies:
      - render-fatal-reload
  - id: adr-and-docs
    content: Use [skill:domain-modeling] 写 ADR-0071，并同步 README、promo 与灰度注释
    status: completed
    dependencies:
      - gpu-preference
      - worker-fatal-ladder
  - id: release-and-verify
    content: Use [skill:verification-before-completion] 补版本工报并跑 typecheck、test、changelog 校验
    status: completed
    dependencies:
      - adr-and-docs
---

## 用户需求
进入园区后偶发「整屏黑掉 + 顶部红条」，红条内容为 `Uncaught TypeError: Failed to copy content from external image.`，尾部还带「刷新后自动改用主线程」提示；刷新一次才能恢复，多端出现过、无稳定复现环境。

## 现象与影响
- 异常发生在渲染线程：文字位图等画布贴图上传 GPU 时抛错，异常逃出帧循环，整个渲染线程被判为 fatal，画面停止更新。
- 玩家侧只有一条红字，没有恢复入口，必须手动刷新；刷新后落点与面板状态被重置。
- 同一套代码在桌面与手机上都跑，后端由客户端自行挑选，出问题的路径无法被灰度隔离。

## 核心功能
1. 默认渲染后端统一改为更稳的 WebGL2（大厅与捏人预览一致），WebGPU 变为显式开关，保留对照与回归能力。
2. 渲染线程异常时自动恢复：先带兼容后端参数受控重载一次，落点由既有快照恢复，不再要求玩家手动刷新。
3. 恢复失败不进入刷新循环：退回主线程渲染并给出可读提示，保证「至少能玩」。
4. 同步更新架构决策记录与玩家可见的版本工报。


## 技术栈
沿用现状，不引入新依赖：Next.js 15 + React 19（`apps/web`）、PixiJS 8.22（WebGPU / WebGL2 双后端）、Dedicated Worker + `OffscreenCanvas`、`bun:test`。

## 根因证据
- 报错来自 Chromium 而非 Pixi：`gpu_queue.cc` 的 `copyExternalImageToTexture()` 在 `CopyStaticImageBitmapToWGPUTexture()` 返回 false 时抛 `TypeError("Failed to copy content from external image.")`。
- 失败分支集中在 `external_image_utils.cc` 的 CPU 回读路径：mapped buffer 申请失败（注释写明 OOM）或 `readPixels` 失败；Android 分支 `forceReadback = !image->IsTextureBacked()` 让文字画布额外多一次回读。
- Pixi 链路：`CanvasTextSystem` → `getPo2TextureFromSource`（`CanvasPool` 2D 画布）→ `GpuTextureSystem.onSourceUpdate` → `uploader.upload` → `copyExternalImageToTexture`。项目内所有 `new Text()` 都走这条路径；`danmaku.ts` 的池化 Text 在 `acquire()` 写 `text`、在 `resize()` 批量改 `resolution`，一次视口变化可触发几十张文字纹理重建，与「概率性、弹幕多时更容易」吻合。
- 现状默认后端：`renderer.ts:797` 为 `options.gpu ?? 'webgpu'`，`preview.ts:43` 硬编码 `'webgpu'`；`?gpu=webgl` 是唯一出口。

## 方案
### 1. 默认后端改为 WebGL2（`lib/game/runtime/render-mode.ts`）
新增纯函数 `resolveGpuPreference(search, override?)`：`?gpu=webgpu` → `webgpu`，`?gpu=webgl` → `webgl`，缺省/非法 → `override ?? 'webgl'`。`renderer.ts:792-797` 与 `preview.ts:40-49` 同时接入（预览侧读 `window.location.search` 并做 SSR 守卫），删除 `preview.ts` 的硬编码。`?gpu=webgpu` 保留为灰度开关，`RendererInit.gpu` 覆盖位保留。

### 2. 崩溃恢复阶梯（`render-mode.ts` + `client/worker-client.ts:337-343`）
- 新增 `reloadForRenderFatal(now?, options?)`：复用 `build-version.ts` 已有守卫 `allowReloadForVersion(session, 'render-fatal', now, 10s, 1)`，重载 URL = 当前 URL 覆盖 `gpu=webgl`（清掉显式 `gpu=webgpu`），返回是否真的发起。
- `onWorkerFatal` 改为三级：① 原样 `console.error`；② 首次 fatal → `reloadForRenderFatal()` 成功则先 flush 一次落点快照（复用现有 `saveSnapshot` 与 `snapshotOut`）、`teardownWorker()`、打一条中性恢复提示并 return，**不再立刻 `markRenderFallback()`**（否则重载后直接掉到主线程渲染）；③ 被守卫拦下 → `markRenderFallback()` + 现有文案，保证下一次刷新走主线程。
- 用 `recovering` 标志做幂等：`worker.onerror` 与 `t === 'fatal'` 可能同帧各来一次，避免重复重载。

### 3. 性能与可靠性
- 不新增热路径：解析函数在 `init` 调用一次，恢复逻辑只在 fatal 时执行。
- WebGL2 的 canvas 上传是 `texImage2D` 直取画布，Android 上省掉 WebGPU 路径的 mapped buffer + `readPixels`，文字密集场景反而更省。
- 风险点：极少数设备 WebGL2 也不可用时，Pixi 的 `preference` 回落与主线程兜底仍在；视觉回归重点为夜景 `multiply`、光斑 `screen`、海岸 stencil、文字清晰度（ADR-0048 / 0012 复核项）。

### 4. 回滚与灰度
- 灰度回滚：`?gpu=webgpu` 单参数即可切回；代码回滚只需还原 `resolveGpuPreference` 的默认值。
- 恢复策略回滚：`reloadForRenderFatal` 返回 false 时行为与今天一致。

## 目录结构
```
apps/web/lib/game/runtime/render-mode.ts        # [MODIFY] 新增 resolveGpuPreference 与 reloadForRenderFatal；更新 FALLBACK_KEY 注释（worker 崩溃 ≠ Worker 能力不可用）
apps/web/lib/game/renderer.ts                   # [MODIFY] :792-797 默认后端改走 resolveGpuPreference；:579-580 注释同步
apps/web/lib/game/preview.ts                    # [MODIFY] :40-49 去掉硬编码 webgpu，改为同一解析函数
apps/web/lib/game/client/worker-client.ts       # [MODIFY] :337-343 fatal 恢复阶梯 + 幂等标志 + 重载前落点 flush
apps/web/lib/game/runtime/engine-env.ts         # [MODIFY] :44-46 ?gpu 灰度语义注释
apps/web/lib/__tests__/render-mode.test.ts      # [NEW] 默认/参数/覆盖/非法值；重载 URL 含 gpu=webgl、首次放行、二次拦截
docs/adr/0071-webgl2-default-render-backend.md  # [NEW] 背景、选项对比、决策、后果、复核信号、回滚（现有 ADR 到 0070）
README.md                                       # [MODIFY] :19 渲染选型行与 :393-394 灰度开关说明
docs/promo.md                                   # [MODIFY] :23 技术描述
apps/web/data/release-notes.json                # [MODIFY] 追加 2026-11-13-1 一条 fix，跑 changelog:check
```

## 关键接口
```ts
type GpuPreference = 'webgl' | 'webgpu';
/** `?gpu=` 显式值 > 宿主覆盖 > 默认 webgl */
export function resolveGpuPreference(search: string, override?: GpuPreference): GpuPreference;
/** 渲染线程 fatal 后的受控重载；返回是否真的发起（false = 被守卫拦下或无 location） */
export function reloadForRenderFatal(now?: number, options?: { location?: LocationLike | null; storage?: StorageLike | null }): boolean;
```

## 验收
1. 默认启动：入场状态与 stats 的 `backend` 为 `webgl`；`?gpu=webgpu` 仍起 WebGPU；`?gpu=webgl` 与默认一致。
2. 人为在 Worker 内抛错：首次自动重载且 URL 带 `gpu=webgl`；守卫拦下后转主线程提示，不出现刷新循环。
3. 视觉回归：夜景柔光、光斑、海岸遮罩、昵称/弹幕文字清晰度。
4. `pnpm typecheck`、`pnpm test`、`pnpm changelog:check` 全绿。


## Agent Extensions
### Skill
- **domain-modeling**
  - Purpose: 按项目既有 ADR 格式落 `docs/adr/0071-webgl2-default-render-backend.md`，把「WebGPU 优先」改为「WebGL2 优先 + WebGPU 灰度」的决策、证据与回滚写清楚
  - Expected outcome: 一份与历史 ADR 结构一致、可直接进入代码评审的决策记录
- **verification-before-completion**
  - Purpose: 在声明修复完成前，逐条跑通类型检查、单测与工报校验，并核对默认 backend 与 `?gpu=webgpu` 两条路径
  - Expected outcome: 有命令输出为证的完成结论，而不是「应该没问题」
