# ADR-0071：渲染后端默认改为 WebGL2，WebGPU 降为显式灰度

- 状态：已采纳
- 日期：2026-11-13
- 关联：接续 ADR-0005「复核信号」里那条「WebGPU 初始化失败不回落」；混合模式与遮罩的
  验证清单沿用 ADR-0013、ADR-0012、ADR-0048；渲染宿主分层见 `lib/game/runtime/`

## 背景

线上偶发「进入园区后整屏黑掉 + 顶部一条红字」：红字是
`Uncaught TypeError: Failed to copy content from external image.`，
尾部还带「刷新后自动改用主线程」的提示。刷新一次才恢复，多端出现过、没有稳定复现环境。

排查结论按调用链排列，不是推测：

1. 抛错的是 Chromium 而不是 Pixi：`gpu_queue.cc` 的 `copyExternalImageToTexture()` 在
   `CopyStaticImageBitmapToWGPUTexture()` 返回 false 时抛这个 TypeError。
2. 失败分支集中在 `external_image_utils.cc` 的 CPU 回读路径：mapped buffer 申请失败
   （源码注释写明可能是 OOM 或尺寸超出 uint32）或 `readPixels` 失败；Android 分支
   `forceReadback = !image->IsTextureBacked()` 让文字画布额外多一次回读。
3. Pixi 的文字纹理正好走这条路径：`CanvasTextSystem` → `getPo2TextureFromSource`
   （`CanvasPool` 的 2D 画布）→ `GpuTextureSystem.onSourceUpdate` → `uploader.upload`。
   项目里所有 `new Text()`（昵称、气泡、弹幕、告示、血条文字）都在这条路径上。
4. `DanmakuField` 的池化 Text 在 `acquire()` 里写 `text`、`resize()` 里批量改 `resolution`，
   一次视口变化能触发几十张文字纹理重建——与「概率性、弹幕多时更容易」吻合。
5. 后果被放大：异常从 Worker 帧循环里逃出来，整个渲染线程被判成 fatal，画面停止更新，
   玩家只有一条红字，必须手动刷新。

约束：

- 不改业务与协议，不引入新依赖；
- 服务端零持久化，客户端崩溃不能让玩家丢掉落点；
- 30 天内必须能回滚到 WebGPU：灰度对照与后端回归定位能力要保留。

## 选项

| 选项 | 收益 | 代价 | 可逆性 |
|---|---|---|---|
| A. 默认 WebGL2，WebGPU 变 `?gpu=webgpu` | 彻底绕开该 API；文字纹理走 `texImage2D`，Android 上少一次 CPU 回读 | 失去 WebGPU 默认路径，`multiply` / `screen` / stencil 的实测覆盖面变小 | 低（单参数） |
| B. 只移动端降级，桌面保留 WebGPU | 桌面继续吃 WebGPU 默认路径 | 多一层 UA 分支，两端行为不一致，桌面仍可能在同一条路径上崩 | 中 |
| C. 保留 WebGPU，加上传守卫 + 崩溃自愈 | 不动默认路径 | 失败在 Chromium/Dawn 内部，JS 侧没有可用的重试或前置校验（Pixi 已把纹理尺寸夹到资源尺寸）；半提交的 `CopyTextureForBrowser` 批次会让渲染器状态可疑；风险仍然留在默认路径上 | 高 |

选 A。

## 决策

### 1. 后端解析收口到一个纯函数

`resolveGpuPreference(search, override)`：`?gpu=webgpu` → WebGPU，`?gpu=webgl` → WebGL2，
缺省或非法值 → `override ?? 'webgl'`。大厅 `GameRenderer` 与捏人预览 `CreatorPreview` 共用它，
预览不再硬编码 `preference: 'webgpu'`（原先两处各写一遍，改默认值要改两处）。

### 2. 崩溃恢复阶梯，而不是「红条 + 手动刷新」

`WorkerGameClient.onWorkerFatal()` 分两级：

1. 带 `gpu=webgl` 受控重载一次（`reloadForRenderFatal()`，复用 `allowReloadForVersion`
   守卫：会话内一次、10s 冷却）。重载前先把最近一次落点落盘，回来由 `resume` 接着原位站着。
2. 被守卫拦下（说明 WebGL2 也崩、或 Worker 在这个环境里根本起不来）才
   `markRenderFallback()`，下一次刷新走主线程渲染，并给出可读提示。

关键点：**第一次 fatal 不再立刻记「Worker 不可用」**。原写法会让重载之后直接掉到主线程渲染，
救回来反而更慢；而且「Worker 崩溃」与「GPU 后端挑错」本来就不是同一件事。

### 3. 不作为：不在 WebGPU 路径上加守卫

`?gpu=webgpu` 是灰度开关，不是产品默认路径。给它加重试既治不了 Chromium 内部失败，
又会把「个别机器坏」摊成「所有机器多一层同步」，等上游问题收敛后按新证据重新评估。

## 后果

- 正面：默认路径绕开 `copyExternalImageToTexture`；Android 上文字纹理重建不再有 mapped buffer
  分配与 `readPixels`，弹幕和昵称密集的场景反而更省；恢复从「手动刷新」变成「一次自动重载」，
  落点不丢；大厅与预览行为一致。
- 负面：WebGPU 不再是被动验证的默认路径，混合模式与海岸 stencil 要靠 `?gpu=webgpu` 主动看
  （ADR-0013 / 0012 / 0048 的清单不变）；极少数 WebGL2 不完整的设备会退到主线程渲染，
  这是既有兜底，不是本次新增。
- 回滚成本：低。`?gpu=webgpu` 立即切回；代码层面只需把 `resolveGpuPreference` 的默认值改回
  `webgpu`。

## 复核信号

- 线上仍出现 `Failed to copy content from external image` → 说明还有代码显式走 WebGPU：
  查 `?gpu=webgpu` 的灰度用户，以及 `RendererInit.gpu` 的注入点。
- 默认 WebGL2 之后 stats 的 `fps` 中位数掉超过 10%（按设备分档看）→ 重新评估按设备灰度，
  而不是整体切回 WebGPU。
- 「刷新后自动改用主线程」的提示变多 → 说明 `reloadForRenderFatal()` 的守卫太紧（当前会话内
  一次），要查这批设备是否连 WebGL2 都起不来。
- 老设备反馈文字发糊或遮罩缺失 → 按 ADR-0005 / ADR-0012 的清单复查整数倍率与 stencil。
