---
name: niuma-brand-mark
overview: 为《牛马 NIOMA》设计一枚程序化生成的 16×16 像素品牌标记（暗色圆角方块 + 奶油牛头 + 薄荷工牌耳标），导出标签页 favicon（16/32/48）、iOS 主屏图标（180）与首页导航 48px logo（hover 眨眼），沿用现有 pixel-assets 生成管线，不引入新依赖。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素艺术
    - 暖墨底
    - 单冷色强调
    - 工牌梗
    - 硬边剪影
  fontSystem:
    fontFamily: Oswald / JetBrains Mono / PingFang SC
    heading:
      size: 16px
      weight: 600
    subheading:
      size: 9px
      weight: 400
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#F4EDE1"
      - "#C7BCAB"
    background:
      - "#14100C"
      - "#0F0C09"
    text:
      - "#F4EDE1"
      - "#A2917A"
    functional:
      - "#221B16"
      - "#2E241D"
todos:
  - id: draw-mark
    content: 在 pixel-assets 新增 16×16 牛头+耳标标记与眨眼帧绘制模块，参考 [skill:layer-pixel-art] 工艺清单
    status: completed
  - id: export-brand
    content: 新增 brand 导出脚本，输出 16/32/48/48-blink/180 PNG 与校对图，并忽略产物
    status: completed
    dependencies:
      - draw-mark
  - id: visual-tune
    content: 目视 16px 与 8× 校对图，微调角、口鼻与耳标像素直至小尺寸可读
    status: completed
    dependencies:
      - export-brand
  - id: wire-favicon
    content: 在 layout.tsx 配置 metadata.icons（16/32/48 与 apple 180）
    status: completed
    dependencies:
      - visual-tune
  - id: wire-nav
    content: 新建 LogoMark 并替换 TopNav 的「牛」字方块，用 [skill:impeccable] 收尾对齐与 hover 眨眼
    status: completed
    dependencies:
      - visual-tune
  - id: verify-build
    content: 跑 pnpm assets、typecheck，核对输出尺寸、link 标签与导航无位移
    status: completed
    dependencies:
      - wire-favicon
      - wire-nav
---

## 产品概述
为《牛马 NIOMA》这座 2D 像素多人在线办公园区设计一枚品牌标记，用于浏览器标签页、iOS 主屏与首页导航，替换首页左上角现有的临时「牛」字方块。

## 核心功能
- **像素牛头标记**：16×16 像素网格绘制，暖墨色圆角方块底板 + 奶油色牛头 + 右耳一枚薄荷色「工牌」耳标，寓意「编号员工」；缩小到 16px 仍能读出牛角与头型。
- **多尺寸一致性**：标签页图标 16/32/48、iOS 主屏 180、导航 48，全部按整数倍最近邻导出，无抗锯齿、无渐变，任何屏幕缩放比下像素块宽度一致。
- **导航落位**：48px 标记与 NIOMA 字标并排，鼠标悬停时牛只眨一次眼；不位移、不闪烁、不改变 header 高度。
- **视觉统一**：沿用站点暖褐墨色底与唯一冷色薄荷，不引入第二种强调色，标签页图标底板与浏览器主题色同色。


## 技术栈
- 沿用现有栈：TypeScript 5（strict）+ Bun 脚本 + `packages/pixel-assets` 的 `Px` 绘制与零原生依赖 `encodePng`（仅 `node:zlib`）。
- 前端：Next.js 15 App Router 的 `metadata.icons` + Tailwind v4 现有工具类（`pixelated`、`group-hover`）。
- **不新增任何依赖**；不使用 `sharp`、不引入 SVG/外部美术工具、不新建 `app/icon.png` 文件约定。

## 实现策略
1. **单一真相**：标记只用一份 16×16 texel 源码描述。`src/logo.ts` 自带「slot → 品牌 hex」表（品牌图直接出彩色 RGBA，不复用游戏角色那套灰度 tint 调色板），复用 `Px` 的 `rect` / `roundRect` / `outline`，遵守 1px 硬边、本体 + 一档阴影、禁用半透明。
2. **整数倍导出**：`scripts/brand.ts` 做最近邻块缩放，产出 16/32/48/48-blink/180；180 不做 11.25 倍（会产生宽窄不一的块），改为 16×11=176 居中、四周用底板色补齐。
3. **接入分层**：`metadata.icons` 负责标签页与 iOS；`LogoMark` 组件负责导航的双帧叠图（两帧同时进 DOM，hover 只切 `opacity`，零请求、零 CLS）。
4. **性能与体积**：5 张 PNG 合计预计 < 10KB；`image-rendering: pixelated` 保证 DPR 2/3 下 48px 资源精确放大 2×/3×；不新增请求链路、不参与首屏字体/脚本。
5. **可回滚**：所有产物集中在 `apps/web/public/brand/`（与 `public/sprites` 同级，不会被生成脚本的 `rm -rf sprites` 波及），`.gitignore` 沿用「生成物不入库」，回滚只需还原 3 个前端文件。

## 架构与数据流
`logo.ts drawLogo('open' | 'blink') → Px` → `brand.ts（整数倍缩放 + encodePng）` → `public/brand/*.png` → 两条消费路径：`app/layout.tsx metadata.icons`（标签页/iOS）、`components/site/LogoMark.tsx → TopNav`（导航）。

## 目录结构
```
niuma/
├── packages/pixel-assets/
│   ├── src/logo.ts                    # [NEW] 品牌标记绘制：LOGO_SIZE=16、本地 slot→hex 调色板、
│   │                                  #       drawLogo('open'|'blink'): Px、logoRgba(px, size) 整数倍最近邻缩放。
│   │                                  #       牛头/角/耳/口鼻/耳标分层落笔，阴影只压右下，无抗锯齿。
│   └── scripts/
│       ├── brand.ts                   # [NEW] writeBrandAssets()：写 logo-{16,32,48,48-blink,180}.png，
│       │                              #       180 用 11× 内容居中补齐；另写 .proof/logo.png（16 原图 + 48 + 8× 并排）
│       └── generate.ts                # [MODIFY] main() 调 writeBrandAssets()，输出到 public/brand（不放进会被清空的 sprites）
├── .gitignore                         # [MODIFY] 增加 apps/web/public/brand/（生成物不入库）
└── apps/web/
    ├── app/layout.tsx                 # [MODIFY] metadata.icons：icon 16/32/48 + apple 180（绝对路径 /brand/…）
    └── components/site/
        ├── LogoMark.tsx               # [NEW] 48px 双帧叠图：alt=""、外层 aria-hidden、pixelated、
        │                              #       motion-safe:group-hover 切换眨眼帧，容器定宽定高
        └── Chrome.tsx                 # [MODIFY] TopNav 用 LogoMark 替换 h-9 w-9「牛」字方块，
                                       #       保留 group / aria-label / NIOMA 文字块与 h-16
```

## 关键结构
```ts
export const LOGO_SIZE = 16;

/** 两帧除眼睛外逐像素一致；'blink' 只把 1×2 的眼睛压成 1×1 横线 */
export function drawLogo(frame: 'open' | 'blink'): Px;

/** 整数倍最近邻放大，返回 width*height*4 的 RGBA，直接喂给 encodePng */
export function logoRgba(px: Px, scale: number): Uint8Array;
```

## 执行要点
- **画法纪律**：底板 `#14100c`（与 `viewport.themeColor` 同色）铺满并切掉四角 1px；深底上不描外轮廓（描边会被吃掉），剪影对比优先；牛头 `#f4ede1`、阴影 `#c7bcab`、口鼻 `#e2d8c6`、内部分界 `#221b16`、耳标 `#4fe3c1`；薄荷面积控制在 5% 以内。
- **可读性验收**：16px 原图必须读出「有角的头 + 右边一点薄荷」；48px 下口鼻、鼻孔、耳标横线清晰，无单像素毛刺；实现时按 16px 图与 8× 校对图目视迭代 1–3 轮（直接读 PNG 校对）。
- **防回归**：`encodePng` 会校验 `width*height*4`，缩放函数必须断言长度；`public/brand` 单独 `mkdir`，生成脚本保持幂等；不触碰 `public/sprites`。
- **无障碍**：LogoMark 外层 `aria-hidden`（链接已有 `aria-label="牛马 NIOMA 首页"`），眨眼开关用 `motion-safe:` 前缀，`prefers-reduced-motion` 下保持静态。
- **不重复出 link**：只走 `metadata.icons`，不新建 `app/icon.png`，否则 Next 会同时输出文件约定与 metadata 两套图标声明。


## 设计风格
硬边像素艺术 + 暖墨底色 + 单点薄荷冷光。标记本身是一枚「工牌」：暗色圆角方块像员工证件，奶油色牛头是主角，右耳挂着的薄荷耳标是唯一冷色，也是「编号牛马」这个梗的全部信息量。

## 标记构成
- 16×16 网格，四角各切 1px 成像素圆角，底板 `#14100C` 与浏览器主题色同色，不描外边框。
- 牛头为奶油色实心剪影，右下侧压一档 0.81 亮度阴影，不使用渐变与半透明；两只 1×2 的眼睛是唯一深色细节。
- 角与头同色，靠 1px 深色缺口分开；口鼻略暗一档，两个鼻孔像素点出牛的特征。
- 右耳下方挂 3×3 薄荷方块，内嵌 1px 深色横线，读作「印了字的工牌」。

## 落位与动效
- 导航：48px 标记 + 右侧 NIOMA（Oswald，字距 0.42em）与「牛马 · shift 03」（JetBrains Mono 9px）两行字标；标记在 64px 高的 header 内垂直居中，左边距与现有栅格一致。
- 交互：鼠标进入链接时切到眨眼帧（眼睛由竖条压成横线），离开立即复位；只换像素，不缩放、不位移、不加阴影，`prefers-reduced-motion` 下保持静态。
- 标签页：16/32/48 三级图标，暗底板在浅色与深色浏览器 UI 上都能立住；180px iOS 图标四周留同色底板，避免透明被系统填黑。

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按项目 UI 规则收尾导航落位——检查 48px 标记与字标的对齐、hover 眨眼是否造成位移或闪烁、`prefers-reduced-motion` 与焦点态是否符合规范。
  - Expected outcome: 导航区无布局抖动、无多余动画，视觉与站点既有暖墨 + 薄荷体系一致，改动文件扫描无 primary findings。
- **layer-pixel-art**
  - Purpose: 借用其像素工艺检查清单（16×16 网格、调色板收敛、禁抗锯齿、缩小后可读性）核对标记，不依赖其 Layer 生成工具。
  - Expected outcome: 16px 下牛角与耳标仍可辨识，48px 下无毛刺与半透明边，导出尺寸全部为整数倍。
