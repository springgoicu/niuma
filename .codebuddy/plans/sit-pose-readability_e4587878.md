---
name: sit-pose-readability
overview: 重画牛/马坐姿几何，让「正坐（面朝镜头）/ 侧坐（侧面）/ 背坐（背对镜头）」三个朝向的坐下剪影都明显区别于站立：躯干整体压低变宽、臀底贴地、前腿明显变短并露出折叠后腿线索；只改 pixel-assets 的坐姿参数并重生成图集，客户端零改动。
todos:
  - id: side-sit-geometry
    content: 重画侧视坐姿：三块并集压低变宽、臀底贴地、短前腿、折叠后腿暗弧与 tailX
    status: completed
  - id: facing-sit-geometry
    content: 强化正视/背视坐姿：躯干下沉变宽、臀部鼓包外扩不落地、短前腿、尾巴下移
    status: completed
    dependencies:
      - side-sit-geometry
  - id: sit-wave-tuning
    content: 新增 SIT_WAVE 三拍并接进 sitWave，保证抬腿不钻胸口、只抬一条
    status: completed
    dependencies:
      - side-sit-geometry
      - facing-sit-geometry
  - id: sit-silhouette-tests
    content: 新增 sit-silhouette.test.ts 锁定矮 6px、差异 350、臀底贴地、两条前腿等硬指标
    status: completed
    dependencies:
      - sit-wave-tuning
  - id: regenerate-and-tune
    content: 跑 pnpm assets，按 .proof 校对图逐列微调坐姿并在四朝向工位目视确认
    status: completed
    dependencies:
      - sit-silhouette-tests
  - id: document-adr
    content: Use [skill:domain-modeling] 撰写 ADR-0030 并更新坐姿调参旋钮注释，Use [skill:verification-before-completion] 完成全量验证
    status: completed
    dependencies:
      - regenerate-and-tune
---

## 产品概述
游戏里牛/马角色坐下时，「正坐（面朝镜头）」「侧坐（侧面）」「背坐（背对镜头）」三个朝向的坐姿剪影都太像站立，其中侧视最弱：躯干几乎没下降、前腿比站立还长，只多出一团臀部，玩家看不懂「坐下了」。本次把三向坐姿统一强化成「贴地宽圆团 + 两条短前腿 + 头压在上面」的构图，让坐下与站立一眼可分。

## 核心功能
- **侧坐强化**：躯干整体压低、后躯变宽变圆并贴地，前腿明显变短，背线从胸到臀自然下斜，新增「后腿折在身下」的暗折线索（必要时再露一小截后蹄），整体剪影比站立矮一截。
- **正坐 / 背坐同步强化**：躯干下沉更多、变矮变宽，臀部鼓包加大并向外探出形成梨形剪影，两条直立前腿变短但可数，背视尾巴随躯干下移、不盖满臀部。
- **坐姿派生动作保持一致**：坐着叫只动嘴；坐着挥手只抬一条前腿、另一条继续撑地，抬腿幅度按新的短腿重新配拍，蹄子不钻进胸口、不顶到脸。
- **三向一致**：牛与马、四个朝向、斑纹/长袜/角鬃变体都给出同一个「坐下」读法，不越出 64 帧、描边不断裂。
- **工位朝向**：四个朝向入座时坐姿都要读得出来（仅目视确认，不改朝向链路与家具贴图）。

视觉结果：玩家在任何朝向坐下，都能一眼区分「站着」与「坐着」，侧坐不再像「站着多了一团屁股」。


## 技术栈
- TypeScript + Bun：沿用项目自研的程序化像素图集生成器（`packages/pixel-assets`），不新增依赖。
- 绘制原语：`Px` 索引位图（`roundRect` / `ellipse` / `ellipseMasked` / `polygon` / `taper` / `solid`，末尾统一 `outline`），角色全部在 `quadruped.ts` 内生成。
- 产物链路：`pnpm assets` → `apps/web/public/sprites/{cow,horse}/*.png` + `sprite-layout.generated.ts` + `.proof/sheet-*.png`；客户端只按列播放，不做运行时变形。

## 实现方案
### 总体策略
只改「姿态 → 几何参数」的坐姿分支，不动绘制管线、不动列预算、不动客户端。三向共用一条设计原则：站姿 = 高躯干 + 四条长腿；坐姿 = 贴地宽圆团 + 两条短前腿。用**比例（`ANATOMY` 的倍数）**表达所有新数值，牛马自动同构；用**可量化的验收带**（bbox 高度、腿长比、贴地行、Hoof 游程数）把「明显」钉成回归测试，避免下一次微调又悄悄退回站姿。

已核实的现状（牛，`FEET=59 / BODY_CX=26`）：
- 侧视坐姿 `hipBottom=56`、`hipH=16.52`、`chestCY=35.99`、`legTop=41.77`（前腿可见 17.2，比站立 16.2 还长）、`headCY=24`（站 22）→ 剪影仅比站立矮 5px，胸线几乎与站立同高，这是「侧坐最不明显」的根因。
- 正/背视坐姿 `bodyCY=stand+4.5`、`bodyH*0.92`、`headCY=stand+7`、腿可见 13.35；臀部鼓包只有 3px 露在躯干外，被吃掉大半。

### 关键决策
1. **侧视继续用「胸 / 腰 / 臀三块并集」而不是倾斜 polygon**：复用现有 `roundRect` 与两阶明暗，像素硬边下最稳；整体 `solid` 一遍避免接缝暗边（ADR-0027 已验证）。本次只换三块的尺寸与圆心。
2. **「压低」靠比例，不靠减帧**：`layout.ts` 的列号、时长、`CLIPS` 是跨端动画契约，本次一列都不动，`sprite-layout.generated.ts` 预期内容不变（若变了说明列预算被误改，立即停下排查）。
3. **正视/背视不追平侧视的躯干高度**：侧视的「低胸」是前倾躯干在侧面的投影，若把正视躯干也压到同一高度，会与 `lie`（床上的躺姿）糊成一片。正视只做 `stand+6.5 / 0.82H / 1.2W`，保证与躺姿的头位差 ≥3 texel。
4. **新增 `SideOptions.tailX`**：臀部变宽后尾巴不能再按站立后缘 `BODY_CX - bodyW/2 - 1.5` 挂点，否则尾巴会被臀块吃掉；由坐姿分支按臀块左缘推导。这是本次唯一的接口字段新增，仍在本模块内。
5. **新增坐姿专用挥手三拍 `SIT_WAVE_REACH/LIFT`**：腿变短后复用站姿 `[4,7,1]/[2,4,1]` 会把蹄子抬进胸口；改成略前伸、少抬，并受 `overlay-frames` 的 `<220px`、跨度 `≤20` 回归线约束。
6. **不加过渡帧、不加坐姿微动**：用户明确选择「只改坐姿几何 + 重生成图集」，而且「站→坐」是硬切，剪影差异变大后硬切反而更醒目。

### 初始参数（按 `ANATOMY` 比例表达，括号内为牛的实际 texel；允许在校对图上收敛，但验收带不放宽）
侧视坐姿（`sideOptions` 的 sit 分支）：
- `hipBottom = FEET - 1`（58，旧 56）；`hipH = bodyH * 0.74`（12.0，旧 16.5）；`hipW = bodyW * 0.82`（20.3，旧 15.4）；臀心 `BODY_CX - bodyW * 0.16`（22.0）
- 腰块 `h = bodyH * 0.66`、`w = bodyW * 0.96`、`cy = hipBottom - hipH * 0.55`，把胸与臀的落差摊成斜坡
- 胸块 `h = bodyH * 0.72`（11.7）、`w = bodyW * 0.60`（14.9）、`cx = BODY_CX + bodyW * 0.20`、`cy = shoulderY - chestH / 2 + 1` → **胸顶约 38**
- `shoulderY = FEET - legH * 0.59`（49.4）→ `legTop = shoulderY - 2`（47.4），前腿可见 ≈ 11.6（站立的 0.72）
- `headCY = standHeadCY + 8`（30）→ 头顶 19.7，整体剪影 38.3 高（站立 47.3，矮 19%），头底与胸顶重叠 2–3px
- `tailX = hipCX - hipW / 2 - 1.2`（≈10.6），`tailTop = hipBottom - hipH + 2`
- 折叠后腿线索：在躯干并集画完后用 `px.ellipseMasked(臀块下前方, S.BodyShade, torsoMask)` 压一道斜向暗弧；可选在臀底露 1–2px `S.HoofShade` 后蹄楔，**校对图上若读成「第三条腿」就删掉后蹄、只留暗弧**

正/背视坐姿（`facingOptions` 的 sit 分支 + `drawFacingBody` 的 `else if (o.sit)`）：
- `bodyCY = standBodyCY + 6.5`、`bodyH = bodyH * 0.82`、`bodyW = bodyW * 1.20`（宽 29.8）
- `headCY = standHeadCY + 8`、`legTop = bodyCY + bodyH / 2 - 1`（≈47.9，腿可见 ≈11.1 = 0.69）
- 臀部鼓包 `haunchW = legW * 1.9`（9.5）、`haunchTop = bodyBottom - 4`、`haunchBottom = FEET - 5`（**仍不落地**），圆心外移到 `x0 + haunchW * 0.28` / `x1 - haunchW * 0.28`，向外探出躯干约 2px 形成梨形
- 背视尾巴 `tailTop` 随躯干下移，`tailEnd = FEET - 2` 不变

### 验收带（硬指标，落成新测试）
1. 四向 × 两物种：坐姿（列 9）bbox 高 ≤ 站立（列 0）高 − 6，且 bbox 底边相同（脚底线不动）；
2. 四向 × 两物种：坐姿与站立逐像素差异 ≥ 350（防止改回站姿却无人发现）；
3. 侧视（方向 1/2）：`FEET - 1` 行在躯干后段必须有不透明像素（臀底落地），后段方向由 `landmarksOf` 的 head/torso 相对位置推导（方向 1 已整体 `flipX`）；
4. 正/背视，列 9/10：贴地区 `S.Hoof` 像素只形成 2 段连续游程（能数出两条前腿），且臀部鼓包 `S.BodyShade` 不触到 `FEET - 1`；
5. 正/背视：坐姿头心比躺姿（列 11）头心高 ≥ 3 texel；
6. 沿用现有全部测试：描边闭合、不越帧边界、`sitEmote` 只动嘴（≤12px 且贴吻部）、`sitWave` 只抬一条腿（<220px、跨度 ≤20）、挥手不动嘴。

### 性能与可靠性
- 纯生成期改动：运行时零额外开销，图集帧尺寸/层数/列数不变，纹理与 draw call 数量不变。
- 复杂度：仍是 O(帧数 × 像素)，与现状同阶；只是三块并集与两处 `ellipseMasked` 的常数项。
- 风险控制：所有新形状都在末尾 `px.outline()` 之前绘制；臀部鼓包不落地（否则被数成第三、四条腿）；斑纹遮罩继续复用同一份 `o.torso` 并集，禁止另写几何。

## 目录结构
```
packages/pixel-assets/
├── src/
│   ├── quadruped.ts                              # [MODIFY] 侧视坐姿：三块并集压低变宽、臀底贴地、前腿变短、
│   │                                             #   新增 tailX 与折叠后腿暗弧；正视/背视：躯干下沉变宽、
│   │                                             #   臀部鼓包外扩不落地、短前腿、背视尾巴下移；
│   │                                             #   新增 SIT_WAVE_REACH/LIFT 并接进 sitWave；更新调参旋钮注释
│   └── __tests__/
│       └── sit-silhouette.test.ts                # [NEW] 坐姿可读性回归：bbox 高度差、差异像素数、臀底贴地、
│                                                 #   Hoof 两段游程、坐/躺头位差；沿用 frameAt/diff 既有写法
├── .proof/sheet-{cow,horse}.png                  # [GENERATED] 3 倍校对图，目视 9/10、19–21、28–30 列
apps/web/
├── public/sprites/cow/*.png                      # [GENERATED] 分层图集重生成（坐姿帧变化）
├── public/sprites/horse/*.png                    # [GENERATED] 分层图集重生成
└── lib/game/sprite-layout.generated.ts           # [GENERATED] 列预算未动，内容应保持一致（变了就是误改）
docs/adr/
└── 0030-compact-sit-silhouette.md                # [NEW] 记录强化坐姿的备选方案、参数、验收带、回滚与复核信号，
                                                  #   在「修订」中点名作废 ADR-0027 的哪些数值
```
不改：`layout.ts`、`apps/web/**` 源码、服务端、协议。


## Agent Extensions
### Skill
- **domain-modeling**
  - Purpose: 按项目既有格式撰写 `docs/adr/0030-compact-sit-silhouette.md`（ADR-FORMAT），保证「背景 / 备选方案 / 决策 / 后果 / 复核信号」结构与前 29 篇一致。
  - Expected outcome: 一份可直接入库的 ADR，明确本方案修订 ADR-0027 的哪些数值、为什么不做过渡帧、调参旋钮与回滚路径。
- **verification-before-completion**
  - Purpose: 在收尾阶段按该技能要求真实执行 `pnpm assets`、pixel-assets 测试、全仓 typecheck/test，并用命令输出作为「已完成」的证据，而不是口头断言。
  - Expected outcome: 每一步验收都有可粘贴的命令输出；`.proof` 校对图逐列对照结论写清；出现回归时先定位再声明完成。
