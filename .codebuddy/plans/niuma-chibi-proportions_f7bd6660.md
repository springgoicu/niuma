---
name: niuma-chibi-proportions
overview: 把牛马角色的比例改为幼态萌（大头、短粗腿、圆躯干、大眼去眉线、小吻），保持 64×64 帧几何、16 列动画契约、图集层数与 20×20 配件尺寸不变，并守住现有比例/边界/描边测试。
todos:
  - id: restyle-anatomy
    content: 重写 ANATOMY 两物种参数为幼态比例，守住总高与牛宽契约
    status: completed
  - id: soften-face
    content: 放大眼睛并去眉线，缩小吻部，圆化牛角与耳朵
    status: completed
    dependencies:
      - restyle-anatomy
  - id: round-body-legs
    content: 圆化躯干、缩短加粗腿与蹄，重算坐躺蹦姿态偏移
    status: completed
    dependencies:
      - restyle-anatomy
  - id: skill-art-review
    content: 用 [skill:layer-pixel-art] 复核帧剪影、眼位与腿部分离
    status: completed
    dependencies:
      - soften-face
      - round-body-legs
  - id: add-adr-tests
    content: 新增 ADR-0014 与幼态比例回归断言
    status: completed
    dependencies:
      - skill-art-review
  - id: regenerate-proof
    content: 运行 pnpm assets 重生成图集，目检 pair、worn 与 preview
    status: completed
    dependencies:
      - soften-face
      - round-body-legs
  - id: verify-suites
    content: 运行测试与类型检查，确认比例、边界、描边全部通过
    status: completed
    dependencies:
      - add-adr-tests
      - regenerate-proof
---

## 用户需求
把「牛马」角色的造型比例改得可爱一些，解决当前形象偏生硬的问题。

## 产品概览
牛、马是同一套程序化像素角色，覆盖四向站立、行走、坐下、躺下、蹦跳共 16 帧，并承载帽子、眼镜、颈饰、发型四类配饰。当前在游戏画面与落地页中以原始像素尺寸放大显示，观感偏「小头长腿方身子」，像板凳上架着一颗方块头。

## 核心特性
- 幼态化比例：头部放大、脖子缩短、腿缩短加粗、躯干加宽并加大圆角，整体仍是同一只动物、同一身高的世界尺度。
- 面部软化：眼睛放大、眼线加宽，去掉压在上方的横眉；吻部缩小变圆、鼻孔缩小，耳朵与牛角改为短而钝的圆弧造型。
- 保持可辨识度：牛仍是宽身短颈、钝吻、短角；马仍是窄身长颈、略长吻、竖鬃。并排站立时一样高，但剪影一眼可分。
- 姿态一致：站立、行走、坐下、躺下、蹦跳五段动作的脚底基准不变，换动作时角色不会跳一下；坐下时的臀部鼓包、躺下时的贴地姿态随新比例重新贴合。
- 配饰不退化：20×20 的帽子、发型仍稳稳扣在头顶，眼镜仍对齐眼线，不出现浮空或压住眼睛。
- 视觉纪律不变：保留 1 像素硬描边与两阶明暗，不引入抗锯齿、半透明或渐变，保持像素风的清晰轮廓。

## 技术栈
沿用现有：TypeScript + Bun 测试 + 自研像素画布（`Px`、`solid`、`taper`）与程序化图集生成脚本，`pnpm assets` 产出图集与 manifest，Next.js 客户端只消费生成物。不引入任何新依赖。

## 实现方案

### 核心策略
按「单一真相 + 派生」改造，而不是逐帧打补丁：全部体型参数集中在 `packages/pixel-assets/src/quadruped.ts` 的 `ANATOMY`，`standHeightOf()`、`landmarksOf()`、配饰锚点表与比例测试都从它派生。只改这一处，帧几何、锚点、manifest 自动跟随。

### 关键决策与取舍
1. **改参数而非改画法**：绘制函数已经参数化（`headR`、`legW`、`bodyR`、`muzzleRx/Ry`、`earW/H`）。新增分叉会让「一个部位两处定义」重演 ADR-0010 之前的漂移问题。
2. **总高只降不升**：新参数使站立高从 48.6/49.8 变为约 46.6/47.0，仍在既有 46..56 契约内且两物种差小于 1。这样不需要联动世界坐标、碰撞半径、相机与地形比例。
3. **「软」靠比例与圆角，不靠去描边**：64 格下 1 像素描边是深色地面上的轮廓底线；生硬感来自头小、腿直、直角肩线与眉线。描边、双阶明暗、二值 alpha 全部保留，这也是 `Sprite.tint` 分层染色的前提。
4. **眼睛改造用「深色眼线」替代「眉线」**：先铺一圈 `EyeShade` 作为眼圈，再叠 `Eye` 内芯与左上 `EyeLight` 高光。眼球在浅色牛脸上仍然读得出，但不再有皱眉的横杠。
5. **配饰尺寸不动**：头径 18.4 增至约 20.5（约 11%），仍在 20×20 图标可覆盖范围；锚点继续由 `landmarksOf()` 推导，不手调锚点表（ADR-0007）。

### 目标参数（实现时以目视为准微调）
| 部位 | 牛（现 → 新） | 马（现 → 新） |
|---|---|---|
| headR | 9.2 → 10.2 | 7.6 → 8.7 |
| legH / legW | 17.5/4.2 → 15.4/4.8 | 20/3.6 → 17.2/4.2 |
| bodyW / bodyH / bodyR | 23/15.2/3.5 → 24.4/16.0/6.2 | 19/13.2/6.5 → 19.8/13.8/7.6 |
| neckH / neckW | 8.2/5.2 → 6.6/6.0 | 10.5/4.2 → 8.8/5.2 |
| muzzleRx / muzzleRy | 5/3.4 → 4.2/3.2 | 3.4/3.2 → 3.2/3.0 |
| earW / earH | 4.5/3 → 5.2/3.6 | 2/4 → 2.6/3.6 |

复算：牛 46.59、马 47.00，差 0.41；头身比 0.38 提升到 0.41/0.35；腿占比 0.36/0.40 降到 0.33/0.37。

### 绘制细节改造点
- `drawEye()`：删除眼上方的 `BodyShade` 横条；眼睛尺寸 4×4 → 5×5（牛）、3×4 → 4×5（马）；闭眼线宽度跟随新眼宽；眼睛纵向位置由 `headCY - 3.5` 上移到 `headCY - 2.6` 附近（幼态脸的眼睛在中线略下）。
- `drawSideBody()` / `drawFacingBody()`：吻部纵向由 `headRY * 0.42` 下移到约 0.5，让吻贴在下半脸而不是挂在下巴外；鼻孔从 2×1.6 收到 1.5×1.3；正面肩线宽度由 `bodyW - 1.5` 收到 `bodyW - 4`，避免一条横杠把圆肩切成方块。
- 耳朵：牛由细长贴片改为更宽的圆弧贴片（用短 `taper` + 1 像素椭圆补圆），马耳加粗根部、压低高度。
- 牛角：`reach` 由 4/6 收到 3/4.6，二段尖角加粗收短，断角保持一截圆钝茬口，避免细长尖刺的锋利感。
- 腿与蹄：正面 `hipX`/`shoulderX` 间距各收 0.6，四条腿靠拢；蹄高 4 → 4.2，形成小短腿大蹄子的憨感；膝点弯曲量由 1 收到 0.8，减少折线感。
- 姿态偏移重算：`sit` 的 `bodyCY` 从 `+7` 收到 `+5.5`、`headCY` 从 `+5` 收到 `+4`（腿变短后若不收，坐姿会悬空）；`lie` 的 `headCY` 改为按新 `headR` 与躯干上缘取大值，避免头埋进身体；`haunch` 的 12×8 圆角块按 `bodyW` 比例缩放并改用 `bodyR`。

### 性能与可靠性
- 绘制只在构建期发生，复杂度仍为 O(物种 × 方向 × 列 × 帧面积) ≈ 2 × 4 × 16 × 4096，毫秒级；运行时零增量。
- 图集尺寸 1024×256、图层数 9、帧列数 16 全部不变，纹理内存与合批结构不变。
- 生成脚本确定性（无随机、无时间依赖），同一参数必得同一图集，便于 diff 审阅。

## 架构设计
沿用现有分层：参数源（`quadruped.ts` 的 `ANATOMY`）→ 帧绘制（侧视/正视 + 姿态参数）→ 图集导出（`generate.ts` 拆灰度图层）→ 生成物（`public/sprites`、`sprite-layout.generated.ts`、manifest 锚点）→ 客户端叠层染色。本次只动最底层参数与绘制细节，上层接口与协议零改动。

## 目录结构
```
d:/other/project/niuma/
├── packages/pixel-assets/
│   ├── src/
│   │   ├── quadruped.ts                    # [MODIFY] 核心改动。重写 ANATOMY 两物种参数为幼态比例（头大、腿短粗、躯干圆、颈短、吻小、耳圆角钝）；重算 standHeightOf 相关常量；drawEye 去掉眉线并加宽眼圈、放大眼珠与闭眼线；adjust 侧面/正面吻部落点与鼻孔；圆化躯干圆角与肩线；收窄正面腿间距、抬高蹄子；drawHornOrMane 缩短并加粗牛角、加粗马耳与鬃；sideOptions/facingOptions 重算 sit/lie/emote 的躯干与头部偏移，haunch 随 bodyW 缩放。保持所有函数签名与导出不变。
│   │   └── __tests__/
│   │       └── proportions.test.ts         # [MODIFY] 保留三条既有断言不放松，新增幼态比例回归断言：头身比下限（牛 headR*2/standHeight ≥ 0.40、马 ≥ 0.34）、腿占比上限（legH/standHeight ≤ 0.38）、眼宽与闭眼线一致性。断言读取导出常量而非复制魔数。
│   ├── src/cosmetics.ts                    # [不修改] 仅确认 SIZE=20 与新头径的覆盖关系，无代码改动
│   └── scripts/generate.ts                 # [不修改] 由 pnpm assets 驱动，重建图集与校对图
├── docs/adr/
│   └── 0014-chibi-character-proportions.md # [NEW] 记录：现状问题、备选（温和圆润/幼态萌/Q 版）、采纳幼态萌的理由、新旧参数对照表、被取代的 ADR-0010 第 52-54 行、后果（总高降至 46.6、配件相对缩小约 10%、需重跑资源）、复核信号（若配件出现浮空则只调 landmarks 派生系数，不手改锚点表）。
├── apps/web/public/sprites/                # [GENERATED] 全部重新生成：cow/horse 各图层图集、preview-*.png、manifest.json（cosmeticAnchors 数值随新头位自动更新）
└── apps/web/lib/game/sprite-layout.generated.ts  # [GENERATED] 期望内容不变（帧尺寸、原点、CLIPS 未动），重跑后确认无意外 diff
```

## 执行要点
- 改完先目视 `.proof/pair.png`（6 倍并排）判断「是否更萌」与「是否仍一眼分牛马」，再目视 `.proof/worn.png` 确认 20×20 帽子/发型咬住头顶、眼镜对齐眼线；不达标优先回头调 `ANATOMY`，最多两轮。
- 单帧可读性以 `.proof/sheet-{species}.png` 的四向全帧为准，重点看行走帧的腿是否糊成柱子、坐下帧臀部鼓包是否错位。
- 若牛剪影宽不再领先马 2 像素，先加宽 `cow.bodyW`，不得下调测试阈值。
- 若闭眼帧的眼睛造型与新眼宽不一致（出现两种眼型），修 `drawEye` 的闭眼分支，不加特例帧。

## Agent Extensions
### Skill
- **layer-pixel-art**
  - Purpose: 在改完 ANATOMY 与绘制细节后，用像素美术的网格对齐、剪影与色阶规范复核牛马造型，确保比例调整没有引入模糊边缘、错位像素或走样的行走帧。
  - Expected outcome: 输出一份针对 64×64 帧的可读性自查结论（剪影、眼位、腿部分离、描边闭合），并在发现问题时给出具体到部位的像素级修正建议。
