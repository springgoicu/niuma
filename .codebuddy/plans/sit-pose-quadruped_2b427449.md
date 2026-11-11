---
name: sit-pose-quadruped
overview: 把牛/马的坐姿重画成猫狗式坐姿：后躯与臀部折起贴地、后腿收起，前腿直立撑地，侧视与正视/背视一致，同步覆盖 sitEmote / sitWave 并重新生成图集与校对图。
todos:
  - id: side-sit-redraw
    content: 重画侧视坐姿：躯干三段并集、臀部贴地、后腿收起、前腿直立撑地
    status: completed
  - id: facing-sit-redraw
    content: 拆分正视/背视 sit 与 lie，坐姿补两条前腿与折叠后腿并修正肩点
    status: completed
    dependencies:
      - side-sit-redraw
  - id: regenerate-tune
    content: 运行 pnpm assets 重生成图集，按 .proof 校对图微调坐姿参数
    status: completed
    dependencies:
      - side-sit-redraw
      - facing-sit-redraw
  - id: verify-regressions
    content: 跑 pixel-assets 测试与全仓 typecheck，处理描边、越界与差异阈值回归
    status: completed
    dependencies:
      - regenerate-tune
  - id: document-sit-pose
    content: 补写坐姿几何注释与 ADR-0027，记录调参旋钮与取舍
    status: completed
    dependencies:
      - regenerate-tune
---

## 产品概述
像素风多人游戏中的牛/马角色坐姿动画优化：让角色坐下时像小猫小狗一样，屁股落地、后腿收在身下、两条前腿直立撑住前身。

## 核心功能
- 侧视坐姿重画：后腿不再画成落地的直腿柱，后躯折叠成贴地的大臀部鼓包；两条前腿从胸前直立撑到地面，膝点略前倾；背线从肩到臀自然下斜，形成前高后低的坐姿剪影。
- 正视/背视坐姿同步：能清楚看到两条直立前腿与两侧折叠的后腿鼓包，不再像趴在地上；躺姿维持现状。
- 坐姿派生动作一致：坐着叫只动嘴；坐着挥手只抬一条前腿，另一条继续撑地；坐姿呼吸帧仍只抬 1 像素，不跳帧。
- 姿态衔接稳定：臀部高度与现有座位（椅子/马桶/沙发）的贴合关系不变，坐下不悬空、不穿椅面；所有朝向、物种、斑纹/长袜/角鬃变体一致，不出画框、描边不断。

视觉结果：玩家一眼读出「坐下了」，而不是「四条短腿蹲着」。

## 技术栈
- TypeScript + Bun：沿用现有程序化像素图集生成器与 `bun test`，不新增依赖。
- 绘制原语：项目自研 `Px` 索引位图（`roundRect` / `ellipse` / `polygon` / `taper` / `solid`，最终统一 `outline`），角色美术全部在 `packages/pixel-assets/src/quadruped.ts` 内生成。
- 产物链路：`pnpm assets` → `apps/web/public/sprites/**`（分层灰度图集，客户端染色）与 `sprite-layout.generated.ts`；客户端 PixiJS 只按列播放，不做运行时姿势变形。

## 实现方案
1. 侧视坐姿（`sideOptions` + `drawSideBody`）
   - 保留 `haunch` 作为坐姿标志（sit / sitEmote / sitWave 共用），改名为语义更准确的 `sitting`。
   - 躯干从单块 `roundRect` 改为三块 `roundRect` 的并集：胸（前上）、中段、臀（后下）。先用 `solid` 的回调整体画一遍 BodyShade（偏移 1px），再整体画一遍 Body，让三块合成无缝剪影；不要逐块 `solid`，否则接缝会出现内部暗边。
   - 不变量：臀部底边钉在 `FEET - 2`（与现状臀部底 56.8 同量级，保住座位 `SEAT_ART.sink = 6/6/8/4/16` 的贴合）；肩线（躯干底）比现状高约 1.5 texel；两前腿有效长度约 15 texel（现状约 13.7）；三段并集的整体宽度不超过站立 `bodyW`，胸/臀块圆心向内收。
   - 臀部上缘约在肩线下方 `0.35–0.5 × bodyH`，让背线自然下斜、不是台阶；加一道 `BodyShade` 膝褶弧暗示后腿折在身下。
   - `sitting` 为真时不画 `hindFar` / `hindNear`；删除旧的后补臀部块，臀块本身就是剪影的一部分。
   - 前腿继续用两段式 `drawLeg`，`legBase.top` 由坐姿肩线推导，膝点保持 `±0.8` 轻微前倾，蹄子落到 `FEET`。
   - 头心随躯干上移约 1.5 texel（`standHeadCY + 4.5` 量级），保证颈锥仍有 2–3 texel 可见；尾巴挂点继续取躯干顶，长度受 `FEET` 约束。
   - 斑纹 mask 必须复用同一份「三段并集」形状函数，不能再用单块 `roundRect`。
2. 正视/背视坐姿（`facingOptions` + `drawFacingBody`）
   - 把 `FacingOptions.sit` 拆成 `sit` 与 `lie` 两个独立标志：`sit` 只覆盖 sit / sitEmote / sitWave，`lie` 覆盖 lie / lieEmote / lieWave；躺姿绘制保持现状（贴地两截蹄子），避免回归 ADR-0026 的床上语义。
   - 坐姿：躯干下沉量从 `+9` 收到 `+5.5` 左右、`bodyH × 0.9`、头心 `+8`；在躯干之前画左右两块折叠后腿鼓包（外沿不超出躯干宽度）；两条前腿用比站姿更窄的对称间距（约 `BODY_CX ± 1.5 × legW`）从坐姿肩线直立到 `FEET`，蹄子落地；不再出现 `hipX` 位置的落地后腿。
   - `legTop` 改为按当前姿态的躯干底推导，不能继续用站立肩点，否则坐姿前腿会从胸口里长出来。
   - 挥手：沿用 `o.wave.side` 跳过该侧落地前腿，抬起腿从坐姿肩点出发；另一条前腿继续撑地。长袜（pattern=2）覆盖坐姿前腿。
   - 背视的尾巴、肩线与头部层次不变，只改下半身。
3. 生成与验收
   - `pnpm assets` 重生成图集、manifest 与 `.proof/sheet-{cow,horse}.png`。
   - 目视检查四向 × 9/10、19–21、28–30 列：侧视必须是「前腿立柱 + 后躯贴地」，正视/背视必须能数出两条前腿。
   - `pnpm --filter @niuma/pixel-assets test`、`pnpm typecheck`，根 `pnpm test` 兜底。

## 关键设计决策与权衡
- 用「多块圆角矩形并集」而不是倾斜 `polygon`：复用现有 `roundRect` + 两阶明暗，像素硬边下比手写八点斜四边形更稳；并集的 shade 只画一次，避免接缝。
- 不加帧、不改 `layout.ts`：列号、时长与客户端播放窗口是跨端动画契约，这次只换几何，图集列数、帧尺寸、层数不变。
- 不改躺姿：躺姿已有独立语义（床上），与坐姿混用会回归 ADR-0026。
- 座位对齐：脚底原点与 `SEAT_ART` 全部不动，只把臀部底边保持在脚底上方约 2 texel，前后偏差与现状同量级。
- 性能：纯生成期改动，运行时零额外开销；图集尺寸与层数不变，不增加纹理与绘制调用。

## 执行注意事项
- 描边只在 `drawSideBody` / `drawFacingBody` 末尾统一调用一次；对合成躯干中间调用 `outline()` 会把内部接缝描出来。
- `proportions.test.ts` 的「不越 64 帧」与「本体色不贴透明区」是全姿态遍历；臀块底边用 `FEET - 2` 而不是 `FEET`，为描边留出 1px。
- `overlay-frames.test.ts` 的坐姿叫唤差异 ≤12 像素、坐姿挥手差异小于 220 像素是回归线。几何改动会让抬腿起止点变化，先确认增量来自「腿变长」而不是躯干位移；确需调阈值时在 ADR 写明原因，不能为过测试回退姿势。
- 斑纹、长袜、配件锚点都从 `sideOptions` / `facingOptions` 推导：改完抽查 9/10、19–21、28–30 列的帽子、眼镜、颈饰与斑块，确认没有漂到轮廓外。
- 生成器会 `rm -rf` 整个 sprites 输出目录再重建；提交时包含 `cow/` 与 `horse/` 下所有变化的图层 PNG（根级 `manifest.json` 与 preview 被 .gitignore 忽略，不进版本库）。
- 坐姿新几何的所有数值集中写在 `sideOptions` / `facingOptions` 的坐姿分支，避免散落在绘制函数里；调参只改这一处。

## 架构设计
单文件几何改动，不引入新模块。数据流不变：`layout.ts`（列/时长）→ `quadruped.ts`（姿态参数 → 绘制）→ `generate.ts`（图集 / 锚点 / manifest）→ 客户端按列播放。坐姿语义仍由侧视 `sitting` 与正视 `sit` / `lie` 布尔区分，不新增姿态枚举、不改协议。

```ts
interface TorsoMass { cx: number; cy: number; w: number; h: number; r: number }

// 侧视坐姿躯干：胸 / 中段 / 臀 三块并集；臀底固定 FEET - 2，肩线由前腿长度反推
function sitTorsoMasses(a: Anatomy, bodyCY: number, bodyH: number, bodyW: number): TorsoMass[]

interface FacingOptions {
  sit: boolean; // 仅 sit / sitEmote / sitWave
  lie: boolean; // 仅 lie / lieEmote / lieWave
}
```

## 目录结构
```
packages/pixel-assets/
├── src/
│   ├── quadruped.ts                     # [MODIFY] 坐姿几何与绘制：侧视三段躯干并集、臀贴地、隐藏后腿、前腿撑地；
│   │                                    #   正视/背视拆分 sit 与 lie、补前腿与折叠后腿、修正 legTop 与挥手挂点；
│   │                                    #   复用同一份躯干形状函数给斑纹 mask；更新坐姿注释与调参旋钮
│   └── __tests__/
│       └── overlay-frames.test.ts       # [VERIFY/MODIFY] 仅在坐姿挥手/叫唤的逐像素差异阈值确需调整时改，
│                                        #   并注明增量来源；边界与描边契约不得放宽
├── scripts/
│   └── generate.ts                      # [READ ONLY] 生成流程不变
└── .proof/                              # [GENERATED, 不入库] sheet-cow.png / sheet-horse.png 人眼校对图
apps/web/
├── public/sprites/
│   ├── cow/*.png                        # [GENERATED] 分层图集重生成（坐姿帧变化）
│   ├── horse/*.png                      # [GENERATED] 分层图集重生成（坐姿帧变化）
│   └── cos/*.png                        # [GENERATED] 配件图，预期字节不变
└── lib/game/
    └── sprite-layout.generated.ts       # [GENERATED] 列预算未变，内容应保持一致
docs/adr/
└── 0027-quadruped-sit-geometry.md       # [NEW] 记录坐姿几何决策、备选方案、座位对齐约束与调参旋钮
```
