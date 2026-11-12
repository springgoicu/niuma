---
name: niuma-landing-copy-playful
overview: 重写《牛马 NIOMA》官网落地页宣传文案，新增一段独立「玩法」区块，突出按 E 发泄创飞同事、工牌实时在岗时长与职级印章、工牌分享图三个玩乐钩子，同时修正官网上与代码不符的数字，并同步 docs/promo.md。
design:
  architecture:
    framework: react
  styleKeywords:
    - 工业终端
    - 像素办公园区
    - 硬边面板
    - 等宽排版
    - 冷幽默
    - 单一冷色强调
  fontSystem:
    fontFamily: Oswald + JetBrains Mono + PingFang SC
    heading:
      size: 48px
      weight: 700
    subheading:
      size: 24px
      weight: 600
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
    background:
      - "#0F0C09"
      - "#14100C"
      - "#1B1611"
      - "#221B16"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#A2917A"
      - "#857463"
    functional:
      - "#F2C879"
      - "#CFE08A"
      - "#E06A5A"
      - "#6FB6C9"
todos:
  - id: rewrite-hero-copy
    content: 重写 Hero 主段与指标，改 1000px、60 人、工牌计时，删虚构数字
    status: completed
  - id: build-play-section
    content: 新建 PlaySection 三卡玩法区块并接入 page.tsx 首屏之后
    status: completed
    dependencies:
      - rewrite-hero-copy
  - id: renumber-and-nav
    content: 更新 Chrome 导航锚点、Footer 免责文案与各区块编号顺延
    status: completed
    dependencies:
      - build-play-section
  - id: fix-tech-and-benefits
    content: 修正 TechSection 数字口径，为福利条补创飞与工牌梗
    status: completed
  - id: sync-meta-and-promo
    content: 同步 layout metadata 与 docs/promo.md 的玩法事实清单和两版推荐稿
    status: completed
    dependencies:
      - build-play-section
  - id: polish-and-verify
    content: 用 [skill:impeccable] 打磨新区块，跑 typecheck 与 build 验证
    status: completed
    dependencies:
      - renumber-and-nav
      - fix-tech-and-benefits
      - sync-meta-and-promo
---

## 产品概述
重写《牛马 NIOMA》官网落地页的宣传文案，把「发泄、在岗时长、工牌」这三个真实可玩的钩子推到台前，语气沿用现有的冷幽默职场黑话与 ASCII 围栏，但句子更短、更有动作感。保持现有视觉语言不变，只加一段新内容、改一批字。

## 核心功能
- **新增「怎么玩」区块**：位于首屏与物种档案之间，三张面板卡分别讲清发泄、在岗时长、工牌；每卡一个键位或符号方块、一句标题、一段玩法说明、三格可核对数字、一行终端回显。
- **首屏钩子前置**：主段落改写为「进门即打卡，工牌开始计时；坐下即摸鱼」+「按 E 把同事创飞 32 像素，倒地 1.5 秒，判定为工伤」；次要按钮从「查看物种档案」改为跳转新区块。
- **首屏数字换成玩乐口径**：32px 创飞距离、1.5s 倒地时长、8 种工牌印章、0 条服务端持久化记录。
- **导航与区块编号重排**：新增「怎么玩」锚点，页面编号统一为 01 玩法 / 02 物种 / 03 技术 / 04 守则，移动端菜单自动同步。
- **事实纠偏**：AOI 900px 改 1000px；删掉虚构的 floor 03 与 24 online；Tick 预算与实体槽位口径与代码对齐。
- **福利条与页脚加梗**：加入「创飞同事算工伤（开玩笑的）」「在岗时长不计薪」等新条目，页脚说明改为与服务端零持久化一致的说法。
- **对外稿同步**：docs/promo.md 的事实清单与两版推荐稿补上三条玩法。

## 视觉结果
玩家第一屏就能读到「可以动手」的钩子；向下滚动遇到一段整齐的三列硬边面板，方块键位、等宽小字与终端回显组成密集的「操作手册」观感，和现有首屏终端窗、物种档案卡完全同源，不出现新的配色或圆角卡片。


## 技术栈
沿用现状，不引入任何新依赖：
- Next.js 15 App Router + React 19，落地页为 Server Component（`apps/web/app/page.tsx`）
- Tailwind CSS 4 的 `@theme` token + `app/globals.css` 内既有组件类 `.panel` `.panel-scan` `.tag` `.btn-primary` `.btn-ghost` `.grid-bg`
- 图标沿用 `lucide-react`（已在依赖内）
- 字体沿用自托管的 Oswald / JetBrains Mono，中文走系统栈

## 实现策略
本次改动是「文案 + 一个新区块」，不做视觉重构。核心策略是把散落在 `Hero`、`Sections`、`Chrome` 里的宣传句收拢成一套有据可查的玩法叙事，并新增一个数据驱动的三卡区块承载它。

关键决定：
1. **新区块独立成文件** `components/site/PlaySection.tsx`，而不是继续往已 287 行的 `Sections.tsx` 里堆。理由：`Sections.tsx` 已聚合四类强耦合模块，再塞一个区块会让该文件成为改动热点；新文件是纯 Server Component，零状态、零副作用，符合现有 `Hero.tsx` / `Chrome.tsx` 的拆分粒度。
2. **卡片数据用模块级常量数组 + `map` 渲染**，与 `SPECIES` / `BENEFITS` / `METRICS` 完全同构，避免三份重复 JSX；后续加第四张卡只改数组。
3. **不引入动画库、不新增 `'use client'`**：沿用 `.animate-blink` 与 `hover:border-mint-400/60`、`group-hover:-translate-y-1` 这几种既有微交互，bundle 不增长，SSR 输出纯静态 HTML。
4. **数字一律来自代码常量**，不手写记忆值：`VENT_KNOCKBACK_PX`、`VENT_STUN_MS`、`VIEW_RADIUS`、`MAX_ENTITIES`、`GAME_TICK_BUDGET_MS`、`getStampTitle`、`BADGE` 部门表、`SHARE_CARD_WIDTH/HEIGHT`。文案里出现的数字须能在这些出处找到，避免再次漂移。
5. **叙事顺序即操作顺序**：首屏抛钩子 → 玩法区拆解三个动作 → 物种区解决「我长什么样」 → 技术区回答「为什么手感顺」 → 守则区处理隐私顾虑。每一步都承接上一段的疑问，不重复论点。

性能与可靠性：新增内容为纯 JSX 常量渲染，无客户端 JS、无图片、无请求，HTML 体积增加约 4 KB；`page.tsx` 仍是静态可预渲染，`homeAutoEnterScript` 逻辑不受影响。文案中所有承诺（免注册、服务端不落库、工牌只在本地）必须与 `RulesSection` 与页脚口径一致，否则会形成互相打脸的三处说法。

## 实施注意事项
- 落地页是 Server Component：新区块禁止出现 `useState` / `useEffect` / 事件处理器；键位用 `<kbd>` 语义标签，不做点击交互。
- 不要写代码里不存在的玩法：没有打印机 / 沙袋 / 情绪条 / 钓鱼 / 组队 / 私聊 / 传送 / 楼层。发泄只有「按 E 冲撞 + 创飞 + 倒地」这一套，别扩写成「砸东西」。
- 不要写「园区里随时换装」：协议支持换装但游戏内无入口，换装必须回 `/create`。
- 页面区块编号是硬编码字符串（`// 01 · roster` 等），插入新区块后必须同步顺延，否则目录感断裂。
- `SPECIES` 里的产能 / 摸鱼 / 咖啡耐受是角色面板数值，不属于产品事实，可以保留；但任何「技术上可实现」的数字必须与常量一致。
- 触屏用户没有键盘：三卡文案里提到 `E` 时，要在段落或眉标里补一句「手机上点动作栏同名的按钮」，避免移动端读者以为玩不了。
- `TopNav` 的 `NAV` 数组同时驱动桌面导航与 `MobileNav`，只改数组即可，不要复制第二份菜单。
- 收尾跑 `pnpm --filter @niuma/web typecheck` 与 `pnpm --filter @niuma/web build`（`build` 含 `next build` + 预压缩脚本），确认无新增 TS 报错、静态导出正常。
- `docs/promo.md` 开头明确要求「改动玩法或文案后请同步更新本文档」，属于仓库约定，必须一起改。

## 目录结构
```
d:/other/project/niuma/
├── apps/web/
│   ├── app/
│   │   ├── page.tsx                        # [MODIFY] 引入并插入 <PlaySection />（Hero 之后、SpeciesSection 之前）
│   │   └── layout.tsx                      # [MODIFY] metadata.description 补发泄 / 工牌口径，保持 title 不变
│   └── components/site/
│       ├── PlaySection.tsx                 # [NEW] 「怎么玩」三卡区块。定义 PLAY_CARDS 常量数组（glyph/kicker/title/body/stats/echo），渲染 // 01 眉标 + 两行标题 + 导语 + 三列面板 + 底部 CTA 条。纯 Server Component，复用 .panel / .tag / .btn-primary，hover 用 border-mint-400/60 与 group-hover:-translate-y-1
│       ├── Hero.tsx                        # [MODIFY] 重写主段落为「打卡计时 + 按 E 创飞」双钩子；METRICS 换成 32px / 1.5s / 8 种印章 / 0 条持久化；终端回显改 1000px 与工牌计时；角标 24 online 换「园区上限 60 人」；floor 03 换「北门 → 中庭 · 单层园区」
│       ├── Sections.tsx                    # [MODIFY] SpeciesSection 编号改 02 并在导语点出 11 个独立色槽；BENEFITS 追加创飞 / 工牌类梗；TechSection 编号改 03，METRICS 改 25ms 预算 / 60 人基准 / 1023 槽位 / 0 持久化，正文 900px 改 1000px；RulesSection 编号改 04，第三条补「工牌与在岗时长只写在你自己的浏览器」
│       └── Chrome.tsx                      # [MODIFY] NAV 插入 { href: '#play', label: '怎么玩' } 并置于首位；SiteFooter 简介补工牌计时一句；免责声明改为「工牌、在岗时长、上次落点只写在你的浏览器里，换设备就重新入职」，修掉与 localStorage 考勤矛盾的说法
└── docs/promo.md                           # [MODIFY] 事实清单「玩法」行补发泄 / 在岗时长 / 工牌导出；新增「玩法亮点」小节列三条可引用事实；短版与长版推荐稿各补一句发泄与工牌，保持免注册 / 零持久化 / 程序化美术三个卖点不变
```

## 关键代码结构
三卡共用同一形状，提前定死可避免三份 JSX 漂移：

```ts
interface PlayCard {
  /** 卡片左上角方块里的大字：键位（E）或符号（#） */
  glyph: string;
  /** 头部小字分类，例如「发泄 / vent」 */
  kicker: string;
  title: string;
  body: string;
  /** 三格硬指标，值必须能在代码常量里找到出处 */
  stats: ReadonlyArray<readonly [value: string, label: string]>;
  /** 面板底部的终端回显，沿用「> 」前缀 */
  echo: string;
}
```



## 设计定位
不改造现有页面，只为新区块补一段与整站同源的「操作手册」式内容。整体延续工业终端 + 像素办公园区的质感：暖褐底、2px 硬边、等宽小字、唯一冷色 mint 作为强调。新区块读起来应该像贴在走廊墙上的一张值班表，而不是一张营销卡片。

## 区块结构（自上而下）
1. **眉标行**：`// 01 · 怎么玩` 等宽小字，uppercase，`tracking-[0.28em]`，mint-400；右侧可挂一个 `tag` 显示「3 个动作」。
2. **标题区**：左侧两行大标题，`--font-display`（Oswald）48–56px，第一行 `进门三件事：` 用 mist-100，第二行 `打卡、创飞、开工牌。` 用 mist-100 且把三个动词分别用 mint-400 / amber-400 / lime-400 点一下；右侧一段 14px 导语，mist-300，最大宽度 28rem，写明「E 是发泄，F 是续命，工牌替你记账」，并补一句「手机上点动作栏同名按钮」。
3. **三卡面板**：桌面三列 `lg:grid-cols-3`，间距 1.5rem；平板两列、手机单列。每张卡 `.panel`，内边距 1.75rem，hover 时边框转 `mint-400/60` 并整体上移 2px。
4. **卡片内部**：顶部一行左侧 56×56 的方块（2px 边框 + 内阴影，模拟实体键帽），方块内是 28px 等宽字符 `E` / `#`，右侧对齐一个分类小字；标题 24px Oswald 600；正文 14px / 1.75 行高 / mist-300；三格指标排成三列，值用 18px Oswald 600 mist-100，标签用 9px 等宽 uppercase mist-500，格子之间用 1px ink-600 竖线分隔；底部一条 `border-t-2 border-ink-700` 的终端回显，11px 等宽，`>` 前缀 mint-400。
5. **区块收尾条**：整宽 2px 边框横条，左侧一句 `现在打卡，工牌从 00:00:00 开始走。`，右侧 `.btn-primary`「现在打卡」，下方 10px 等宽小字 `免注册 · 服务端不落库 · 关掉就下班`。与首屏角标同款横向结构，形成呼应。

## 交互与动效
- 仅三种：卡片 hover 边框提亮 + 上移 2px（`transition-transform duration-300`）；键帽 hover 时字符转 mint-400；收尾条沿用 `.btn-primary::after` 的扫光。不新增 keyframes。
- 全局 `prefers-reduced-motion` 规则已覆盖所有 transition，无需额外处理。
- 键位字符用 `<kbd>`，不绑定点击；移动端靠动作栏，因此文案显式说明，避免给出无法执行的指令。

## 响应式
- ≥1024px：三列等宽，卡片等高（`h-full` + flex 纵向，回显贴底）。
- 640–1023px：两列，第三张卡跨列并压缩正文宽度。
- <640px：单列，键帽缩到 44×44，指标三格改为横排等分不换行，标题降到 36px。

## 文案锚点（实现时按此落字，不要自由发挥）
- 首屏主段：`一座永不下班的像素办公园区。进门就算打卡，工牌开始一秒一秒记你的在岗时长；工位随便坐，坐下就算摸鱼。`
- 首屏钩子句：`想活动一下：走到同事面前按 E，把他创飞 32 像素——倒地 1.5 秒，判定为工伤。`
- 首屏收尾：`没有注册，没有存档，没有绩效面谈。关掉标签页，你就自由了。`
- 卡一：`把同事创飞 32 像素` / 正文点出 64px 判定、60° 扇形、1.5 秒起不来 / 回显 `> 判定为工伤！`
- 卡二：`工牌替你记工，一秒不落` / 正文点出 2 小时实习摸鱼生、8 小时标准牛马、超 8 小时骨灰级卷王与「建议立刻前往中庭吃草」/ 回显 `> 你已经在岗 120 分钟，起来走动两步`
- 卡三：`一张能发出去的工牌` / 正文点出固定工号、六个部门含「摸鱼办」、480×720 PNG / 回显 `> NIOMA HR · VERIFIED`
- 福利条新增：`创飞同事算工伤（开玩笑的）` `在岗时长不计薪` `工牌可下载，工位不可带走`


## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按用户规则在写 UI 代码前加载，用 `/impeccable polish` 收尾新区块与首屏改写，检查排版节奏、对比度、hover 态、响应式与反模式（禁用紫蓝渐变、纯黑纯灰、bounce 缓动等）
  - Expected outcome: 新区块在 1440 / 768 / 375 三档下无溢出、无对比度不足、无新增反模式告警，且与既有 `.panel` 设计语言一致
- **codebase-design**
  - Purpose: 落地前复核 `PlaySection.tsx` 的模块边界与接口形状，确认新文件是「深模块」而非把复杂度平摊到调用方
  - Expected outcome: 区块对外只暴露一个无参组件，文案数据与渲染逻辑都收在模块内部
