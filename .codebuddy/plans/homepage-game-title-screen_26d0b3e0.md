---
name: homepage-game-title-screen
overview: 把首页首屏重做成像素游戏「标题画面」：大标题 + 可点角色舞台 + 开始主按钮 + 像素化 HUD 条；物种档案卡改为整卡可点，直达 /create?species=，悬停出现「进入捏人」提示。首屏以下区块全部保留。
design:
  architecture:
    framework: react
  styleKeywords:
    - 游戏标题画面
    - 像素街机
    - 暖褐单冷色强调
    - 终端 HUD
    - 克制微动效
  fontSystem:
    fontFamily: Oswald
    heading:
      size: 132px
      weight: 700
    subheading:
      size: 28px
      weight: 600
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#3D3026"
    background:
      - "#0F0C09"
      - "#171310"
      - "#221B15"
    text:
      - "#F3EFE4"
      - "#D8CFC1"
      - "#8F8377"
    functional:
      - "#FF6047"
      - "#C8F26B"
      - "#E8B14C"
todos:
  - id: species-source
    content: 新建 components/site/species.ts 汇总物种数据，改造 CharacterSprite 与 SpeciesSection 复用
    status: completed
  - id: stage-css
    content: 在 globals.css 追加舞台地平线、网格渐隐工具类与像素待机 bob keyframes
    status: completed
    dependencies:
      - species-source
  - id: hero-title-screen
    content: 用 [skill:impeccable] 重写 Hero.tsx 为标题画面：居中标题、双角色选角舞台、主次按钮、底部 HUD 条
    status: completed
    dependencies:
      - stage-css
  - id: species-clickable-card
    content: 改造 SpeciesSection 为整卡可点链接，加悬停/聚焦「进入捏人」提示并移除卡内二次焦点
    status: completed
    dependencies:
      - species-source
  - id: changelog-verify
    content: 用 [skill:impeccable] 做视觉与可访问性打磨，追加版本工报并跑 typecheck 与 changelog:check
    status: completed
    dependencies:
      - hero-title-screen
      - species-clickable-card
---

## 用户需求

把现有营销型首页改造成「像素游戏开始画面」，让访客第一眼就觉得自己打开了一款游戏；同时让角色入口更直接：点击牛或马直接进入捏人界面。

## Product Overview

首页第一屏从「左文案 + 右假截图」的 SaaS 分栏，改为游戏标题画面：中央大标题、两名可点角色站在同一地平线上的选角舞台、「开始」主按钮、底部像素 HUD 状态条。下方物种档案、福利跑马灯、技术底牌、版本工报、工位守则全部保留，只重排首屏与物种区块。

## Core Features

- **标题画面首屏**：居中的「牛马 / NIOMA」大标题与一句定位文案；两名角色并排站在共享舞台上，带像素待机微动效与名牌；一个主按钮「打卡上班」、一个次按钮「查看物种档案」；底部 HUD 条展示 20 Hz tick、8 B 移动包、900 px AOI、在线人数与闪烁 REC 点，沿用现有终端语气。
- **角色直入捏人**：首屏两名角色与下方两张物种卡整块可点，直达 `/create?species=cow|horse`；悬停或键盘聚焦时出现「进入捏人」提示，角色轻抬、角标点亮。
- **整卡交互**：物种卡不再只有底部文字链，整张卡片（含角色图）都是链接；卡内不再有第二个可聚焦元素，避免嵌套交互。
- **信息分层**：首屏是「选角舞台」（角色图 + 名称 + 一句定位），下方是「档案卡」（简介 + 产能/摸鱼/咖啡耐受数值），不重复堆同样的内容。
- **保留既有行为**：回访者自动直达园区的脚本逻辑、导航、锚点、其余区块与配色体系不变。


## 技术栈

沿用现有栈，不新增依赖：Next.js 15 App Router（React 19 Server Components）+ TypeScript + Tailwind CSS 4 + lucide-react。首页保持纯静态 RSC 输出，不引入客户端组件、不新增请求、不新增状态源。

## 实现思路

1. **单一数据源**：把 `Sections.tsx` 中的 `SPECIES` 抽到新建的 `components/site/species.ts`，补首屏专用的 `tagline` 字段并导出 `SiteSpecies` 类型；`CharacterSprite` 与 `SpeciesSection` 都从这里取用，避免同一头牛在两处出现文案/配色漂移。
2. **重建 Hero 为标题画面**：用 CSS 分层做舞台背景（ink-900 底 + 极淡薄荷径向光 + 32px 网格向下渐隐 + 扫描线 + 底部暗角），三段式布局（顶部状态细条 / 中部标题与选角舞台 / 底部 HUD 条）。角色块改成 `<a href="/create?species=...">`，与主按钮并列；原 desk-cam 假面板与 boot 日志收拢为一条 HUD 条，保留 `boot --shift 03`、`0 条持久化记录`、`24 online` 的原有语气。
3. **物种卡整卡可点**：`<article>` 换成带 `.panel` 样式的 `<a>`，底部原 `<Link>` 降级为非交互 `<span>` 视觉 CTA，右上角加 `group-hover` / `group-focus-visible` 才浮现的「进入捏人 →」小标签。
4. **动效只走 CSS**：新增 2 个工具类与 2~3 条 keyframes（像素阶梯式待机 bob、地平线微光），全部集中在 `globals.css` 既有 `@keyframes` 区块，靠文件末尾的 `prefers-reduced-motion` 兜底自动关停。
5. **保持零持久化与静态预渲染**：不触碰 `page.tsx` 里的 `homeAutoEnterScript()`（ADR-0038），不改 `/create`、`/play` 与 TopNav。

## 性能与可靠性

- 首屏不增加任何 JS 体积；角色图仍是 `/sprites/preview-cow.png`、`preview-horse.png`，首屏与物种区共用同一 URL，命中同一次请求。
- 全部动效只改 `transform` / `opacity`，不触发布局；`CharacterSprite` 已输出 `width/height`，无 CLS。
- 像素图放大必须走 `pixelSize()` 的 64 整数倍：首屏用 192（≥640px）/ 128（<640px），不要用 160、176 这类会取整到 192 的尺寸。
- 整卡链接内不得再嵌套 `<button>` / `<a>`；用 `aria-label` 覆盖链接名，避免读屏把整段卡片文案当作链接名。

## 改动范围控制

只改 4 个文件 + 新建 1 个数据文件 + 1 条版本工报；`page.tsx`、导航、其余区块、`/create`、`/play`、共享包与服务端一律不动。没有新架构模式、没有新依赖、没有新抽象层。

## 目录结构

```
apps/web/
├── components/site/
│   ├── species.ts             # [NEW] 站点级物种数据单一事实源：SiteSpecies 类型 + SPECIES（key/name/latin/tagline/color/blurb/stats）
│   ├── CharacterSprite.tsx    # [MODIFY] 改为从 species.ts 取 SiteSpecies 类型并对外 re-export，渲染逻辑与整数倍放大规则不变
│   ├── Hero.tsx               # [MODIFY] 重写为标题画面：顶部状态条 + 居中标题 + 双角色选角舞台（整块可点）+ 主/次按钮 + 底部 HUD 条；内部提取本地 SpeciesTile 子组件
│   └── Sections.tsx           # [MODIFY] SpeciesSection 改用 species.ts 数据；每张卡整体包成 <a href=/create?species=...>，加悬停/聚焦「进入捏人」提示，移除卡内第二个焦点元素
├── app/
│   └── globals.css            # [MODIFY] 新增舞台地平线/网格渐隐工具类与像素待机 bob keyframes；沿用既有 reduced-motion 兜底
└── data/
    └── release-notes.json     # [MODIFY] 追加一条玩家可感知的版本工报
```

## 关键数据结构

```ts
export type SiteSpecies = 'cow' | 'horse';

export interface SpeciesProfile {
  key: SiteSpecies;
  name: string;
  latin: string;
  /** 首屏选角舞台的一句定位，与档案卡的长简介分开 */
  tagline: string;
  color: string;
  blurb: string;
  stats: ReadonlyArray<readonly [string, number]>;
}

export const SPECIES: ReadonlyArray<SpeciesProfile>;
```

## 验证

`pnpm --filter @niuma/web typecheck`、`pnpm changelog:check`；本地 `pnpm --filter @niuma/web dev` 后在 1440 / 768 / 390 三档宽度检查首屏不溢出、角色与卡片可点、键盘 Tab 有可见焦点；改动文件跑一次 `npx impeccable detect`，应无 primary findings。



## 设计风格

游戏标题画面（Title Screen），延续既有暖褐 + 米色 + 薄荷绿单冷色强调的像素设计语言，不换配色、不引入渐变花活。关键是构图：从「左文右图」的分栏落地页，改为上中下三段式的街机开始界面。

## 首屏构图

- **顶部状态细条**：左侧闪烁薄荷方点 + `SHIFT 03 · 夜班园区`，右侧 `NO SAVE · NO LOGIN`；1px 墨色分隔线，10px mono 字号、0.22em 字距。
- **背景舞台**：ink-900 底 + 中央极淡薄荷径向光（≤18% 不透明度）+ 32px 网格向下渐隐 + 细扫描线 + 底部暗角，读作「屏幕里的房间」而不是海报。
- **标题区**：`牛马` 用 Oswald 700，`clamp(64px, 10vw, 132px)`，字距 -0.02em，保留向右下偏移 4px 的薄荷残影；下方 `NIOMA` 40px / 0.44em 字距 mist-500；再一行 mono 小字「一座永不下班的像素办公园区」。
- **选角舞台**：两名角色并排站在同一条地平线上（≥640px 用 192px 精灵，窄屏 128px）。每个角色是一整块可点链接，但不做成「卡片」：只保留左右上角的选择角标、脚下 8px 像素阴影与名牌，避免与下方档案卡形成卡片套卡片。悬停/聚焦时角标点亮为薄荷，角色按像素步进上抬 4px，名牌下方浮现 `▸ 进入捏人`。
- **名牌**：`牛` 28px Oswald + `BOS TAURUS · 稳定输出型` 9px mono、0.2em 字距、mist-500。
- **操作区**：主按钮「▶ 打卡上班」沿用 `.btn-primary` 的薄荷底与扫光；次按钮「查看物种档案」用 `.btn-ghost`；下方一行闪烁 mono 提示 `PRESS START · 无需注册`。
- **HUD 条**：首屏底部一条 2px 上边框通栏状态带，左 `● REC`（signal 红闪烁），中 `20 HZ TICK · 8 B MOVE · 900 PX AOI`（窄屏只留两项），右 `24 ONLINE`（薄荷）。原单独一行的四项指标收进这条带，降低首屏信息密度。

## 物种区块

保持标题与总述，卡片改为整块链接：悬停/聚焦时边框转 `mint-400/60`、底色微提亮、右上角滑出「进入捏人 →」小标签、角色上移、底部 CTA 文字转薄荷。过渡 150ms `--ease-out-expo`，不使用弹跳或弹性缓动。

## 响应式

≥1024px 首屏在 `calc(100svh - 4rem)` 内上中下三段分布，视线自然落在标题与两名角色上；768–1023px 改为自然高度、留白收紧；<640px 标题降到 64px，角色 128px 仍两列并排，HUD 精简为 tick 与 online 两项。所有可点区域远大于 44px。

## 可访问性与动效

- 角色与卡片都是原生 `<a>`，Enter 即可进入；焦点用全局 `:focus-visible` 薄荷描边，并同步点亮角标（`group-focus-visible`）。
- 链接用 `aria-label` 声明「选择牛，进入捏人界面」，装饰性精灵 `alt=""`，避免读屏把整段介绍当链接名。
- 待机动效为 2 帧阶梯 bob（`steps(1, end)`，2.8s，两名角色错开 0.4s），扫描线 6s 循环；全部只改 transform/opacity，并由全站 reduced-motion 兜底关停。


## Agent Extensions

### Skill
- **impeccable**
  - Purpose: 按 shape → 实现 → polish 流程产出标题画面首屏与整卡可点交互，落实反模式禁令（不用默认字体作展示字、不用紫蓝渐变、卡片不套卡片、不用 bounce/elastic 缓动），最后跑 detect 校验。
  - Expected outcome: 首屏构图与交互符合游戏标题画面观感，`npx impeccable detect` 无 primary findings。
