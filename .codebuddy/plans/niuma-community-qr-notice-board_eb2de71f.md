---
name: niuma-community-qr-notice-board
overview: 在游戏内出生点（北门）新增「公告栏」浮层：展示微信交流群二维码与加群说明，首次进入自动弹出一次，关闭后保留「公告」入口按钮。二维码链接放进新增配置文件，客户端经同源 API 路由拉取、由 sharp 重新编码压缩（70KB → 约 9KB），规避 https 页面直连 http 图片的混合内容拦截。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素终端
    - 暖褐墨色
    - 木牌公告栏
    - 薄荷绿强调
    - 轻量浮层
  fontSystem:
    fontFamily: Oswald / JetBrains Mono / PingFang SC
    heading:
      size: 20px
      weight: 600
    subheading:
      size: 10px
      weight: 600
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
    background:
      - "#0F0C09"
      - "#14100C"
      - "#221B16"
      - "#F4EDE1"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#857463"
    functional:
      - "#F2C879"
      - "#E06A5A"
      - "#FFFFFF"
todos:
  - id: qr-config-api
    content: 新增 community 配置与 /api/community/qr 压缩接口，补充 sharp 依赖并更新锁文件
    status: completed
  - id: notice-board
    content: 用 [skill:impeccable] 实现公告栏浮层与入口按钮：二维码、文案、焦点、移动端紧凑态
    status: completed
    dependencies:
      - qr-config-api
  - id: hud-wiring
    content: 接入 game-ui 状态与 GameViewport 右上控件，首次上线 6.5 秒自动弹出一次
    status: completed
    dependencies:
      - notice-board
  - id: verify-qr
    content: 跑 typecheck、bun test、next build，实测接口体积/内容类型与二维码可扫
    status: completed
    dependencies:
      - hud-wiring
---

## 产品概述
在《牛马园》像素园区里，玩家进入出生点（北门迎宾区）时能看到一块「园区公告栏」，栏内放着牛马园微信交流群二维码，并明确提示可以扫码加群。公告栏在入场后自动出现一次，关闭后右上角常驻一枚「公告」入口，随时可再次打开。二维码图片地址放在独立配置文件中，换群只改这一处。

## 核心功能
- 入场自动展示：首次进入园区约 6 秒后自动展开公告栏，手动关闭后本次会话不再自动弹出。
- 公告栏浮层：包含「园区公告」标题、加群说明、微信群二维码、扫码/长按识别提示和二维码有效期提醒。
- 常驻入口：右上角控件区新增「公告」按钮（手机端为图标按钮），点击随时重新打开。
- 二维码清晰可扫：保持黑白对比与原始比例，桌面与横屏手机都能完整展示，支持微信长按识别/保存。
- 配置化换码：二维码图片链接集中在配置文件，换群只改链接并重新部署。
- 加载兜底：图片接口失败时给出可读提示，不出现破图。

## 交互与视觉
- 沿用现有像素/终端风格：暖褐深色卡片、薄荷绿强调色，公告栏带轻微木牌与图钉质感。
- 打开时铺一层轻遮罩；关闭按钮、点击遮罩、Esc 均可关闭，关闭后焦点回到「公告」按钮。
- 手机横屏时卡片自动收紧（二维码缩小、内部可滚动），保证在约 390px 的可视高度里也能完整关闭。


## 技术栈
- 前端：Next.js 15 App Router + React 19 + TypeScript + Tailwind CSS v4（现有 `@theme` token），状态用现有 zustand `useGameUi`
- 图片处理：`sharp@0.35.5`（已是 next 的 optionalDependency 且在 pnpm-lock 中，本次显式加进 `@niuma/web` 依赖）
- 服务端：Next Route Handler（Node runtime），无新增包、不改游戏服务端

## 实现方案
线上站点是 `https://bangying.top`，而二维码源链接是 `http://8.130.22.109:9001/...`，浏览器会按混合内容拦截，因此**不能**直接给 `<img>` 用远程链接；同时项目没有 `next/image`、没有 `images.remotePatterns`，也不引入。

采用「配置 + 同源压缩代理 + 纯展示组件」三段式：

1. `apps/web/lib/community.ts` 保存群名、源链接（原样使用用户给的 MinIO 直链）、有效期提示，组件与接口共用这一份。
2. `apps/web/app/api/community/qr/route.ts` 服务端 `fetch` 配置链接，用 sharp 重新编码为 16 色调色板 PNG（实测 70.2KB → 9.2KB，视觉无损），返回 `image/png`。**不接受任何 URL 查询参数**（避免变成公开代理/SSRF），只读配置。
3. `NoticeBoard.tsx` 用普通 `<img src="/api/community/qr">` 展示，配合 `useGameUi` 的 `noticeOpen` 状态与 GameViewport 右上角控件联动。

关键取舍（已实测，不要推翻）：
- WebP 体积反而更大（q90 24.5KB / q75 18.2KB），PNG 调色板 16 色最小且像素几何不变。
- 二值化 threshold 后二维码模块被破坏（实测整张花掉），**禁止使用**；也不做 median 等空间滤波。
- 不缩放：原图 249×254，缩小只会伤扫码率。

性能与可靠性：
- 路由内模块级内存缓存（TTL 6h），配合 `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`，常规请求不再触发 sharp（单次编码约 10ms 量级，仅冷启动一次）。
- 上游失败时优先返回旧缓存（`max-age=60` 让浏览器稍后重试），彻底无缓存才返回 502；sharp 抛错时兜底返回原图字节，保证二维码不因压缩链路挂掉。
- 原图只抓 1 次/进程/6h，且 nginx 不压缩图片，整条链路新增流量约 9KB/用户/天。

安全与规范：
- 接口只读配置常量，天然不被外部输入污染；不打印链接中的完整 query。
- 失败日志遵循现有 `console.error('[game] ...')` 风格，输出状态码与错误信息，不打印昵称/坐标。

## 实施要点（执行细节）
- `apps/web/tsconfig.json` 别名 `@/*` → `./*`；`lib/**/__tests__` 不参与 tsc，`bun test lib` 是单测入口。
- 根容器的 `.no-callout`（`-webkit-touch-callout:none; user-select:none`）会阻止微信长按识别，二维码 `<img>` 必须局部覆盖为 `default/auto`。
- 手机端舞台是「整块 CSS 旋转 90°」，浮层必须用 `absolute inset-0`（不能用 fixed），并带 `max-h-[92%] overflow-y-auto`；`compact` 时二维码 136px、桌面 168px。
- 右上角按钮需 `pointer-events-auto` 与 `data-no-immersive`（避开 GameViewport 首次按压自动全屏的手势拦截）；浮层 z-index 用 30，低于 QueueGate 的 z-40。
- 自动弹层用 `useRef` 守卫、不写 localStorage（与 WelcomeBanner 的「一次性引导不留状态」一致）；定时器 6500ms，错开 WelcomeBanner 的 5600+320ms；触发前若 `chatOpen` 为真则跳过；打开时顺手收起聊天/状态面板。
- 关闭交互：关闭按钮、遮罩点击、Esc；打开时聚焦关闭按钮，关闭后焦点回到「公告」按钮；`role="dialog" aria-modal="true"` + `aria-labelledby`。
- `sharp` 要加进 `apps/web/package.json` 并用 pnpm 更新 `pnpm-lock.yaml`（部署脚本用 `--frozen-lockfile`，不能手改 lock 结构）。若 standalone 未带上 sharp，在 `next.config.ts` 加 `serverExternalPackages: ['sharp']`。
- 上游链接 HEAD 返回 405（MinIO 只允许 GET），实现与验证一律用 GET。

## 架构设计
数据流（单向前进，无回环）：

玩家入场/点「公告」→ `NoticeBoard` 浮层 → `<img src="/api/community/qr">` → Route Handler 读配置 → fetch 源图 → sharp 编码 16 色 PNG → 内存缓存 + 浏览器缓存 → 展示

组件关系：
- `lib/community.ts` 是唯一配置真相，被 route 与组件共同引用；
- `lib/game-ui.ts` 只增加一个面板状态（`noticeOpen`），沿用现有「面板互斥」写法；
- `GameViewport` 只多挂一个入口按钮组件，不参与二维码逻辑。

## 目录结构
```
apps/web/
├── lib/
│   ├── community.ts                 # [NEW] 微信群配置：群名、MinIO 直链（原样）、有效期提示；唯一真相，route 与组件共用；文件头注释说明「改链接即可换群」
│   └── game-ui.ts                   # [MODIFY] 新增 noticeOpen / setNoticeOpen，打开时收起聊天与状态面板，INITIAL 里复位
├── app/api/community/qr/
│   └── route.ts                     # [NEW] 首个 Route Handler：runtime=nodejs、force-dynamic；fetch 配置链接 → sharp 转 16 色 palette PNG → 内存缓存（TTL 6h）→ image/png + 长缓存头；失败回退旧缓存，再失败 502；不接收入参
├── components/game/
│   ├── NoticeBoard.tsx              # [NEW] 导出 NoticeBoardButton（右上角入口，桌面图标+文字/手机 36px 图标，data-no-immersive）与 NoticeBoard（居中浮层：园区公告标题、加群文案、白色二维码区、扫码/长按提示、有效期提醒、关闭与焦点管理、移动端紧凑态）
│   └── GameViewport.tsx             # [MODIFY] 右上控件行插入 NoticeBoardButton；与 NavCard/WelcomeBanner 同级挂 NoticeBoard；传入 compact={isTouch}
├── package.json                     # [MODIFY] dependencies 增加 sharp（^0.35.5）
└── (根) pnpm-lock.yaml              # [MODIFY] pnpm 安装生成的 importer 变更
```

## 关键代码结构
```ts
// apps/web/lib/community.ts —— 配置形状（值按用户提供的链接原样填写）
export const COMMUNITY = {
  wechat: {
    title: '加入牛马园微信群',
    qrUrl: '用户提供的 MinIO 直链',
    expiryNote: '群二维码 7 天内有效，过期请联系管理员更新',
  },
} as const;
```

## 验证
1. `pnpm --filter @niuma/web typecheck`、`pnpm --filter @niuma/web test`。
2. `pnpm --filter @niuma/web build`：确认 route 进入 standalone，sharp 被正确打包（必要时补 `serverExternalPackages`）。
3. dev 起服务后 `curl -I http://127.0.0.1:3000/api/community/qr`：应返回 `image/png`、约 9KB、带长缓存头；断网/改错链接时应命中旧缓存或 502 而非 500。
4. 浏览器进入 `/play`：6.5 秒后自动弹出；关闭后仅剩「公告」按钮；桌面与手机横屏（DevTools 模拟 844×390）均能完整看到二维码并关闭；用手机微信扫一扫实测可识别。


## 设计风格
沿用园区既有的「像素终端 + 暖褐墨色」设计语言，不引入新的视觉体系。公告栏是园区的一件实体家具：一块钉在墙上的木牌公告，外层仍是 2px 深色描边卡片，内部用暖褐纸面 + 薄荷绿细线做层次，避免与游戏 HUD 的其他面板割裂。

## 布局与结构
- 入口：右上角控件行新增「公告」按钮，与静音/全屏/打卡下班同高同描边；桌面为「喇叭图标 + 公告」文字，手机为 36×36 图标按钮。
- 浮层：屏幕居中的 `min(340px, 92vw)` 卡片，铺一层 `ink-950/70` 轻遮罩。
- 卡片自上而下：顶部「// 园区公告」小标题 + 关闭按钮 → 主标题「加入牛马园微信群」→ 一句副文案 → 白色二维码托盘（带四角定位刻线，不压住码面）→ 「微信扫一扫 · 长按识别」→ 有效期提醒 → 页脚「#niuma · 交流群 / notice」。
- 木牌质感靠三处细节实现：顶部 2px 琥珀色横条、中轴一枚小圆钉、纸面区一条极淡的扫描线（仅限文字区，不覆盖二维码）。

## 交互与动效
- 打开：遮罩淡入 160ms，卡片自下 8px 上浮 220ms，使用现有 `--ease-out-expo`；`prefers-reduced-motion` 下自动降级。
- 关闭：关闭按钮、点遮罩、Esc 三条路径；焦点回到入口按钮。
- 悬停/聚焦：入口按钮描边转薄荷绿、文字转亮；二维码托盘 hover 时不缩放（避免影响扫码取景）。

## 响应式
- 桌面：二维码 168px，卡片约 380px 高，右下留白充足。
- 手机横屏（舞台旋转）：二维码 136px，内边距收紧，卡片 `max-h-[92%] overflow-y-auto`，关闭按钮始终在首屏可见。
- 触屏：二维码允许长按识别与保存（局部取消 `touch-callout: none`）。

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 按项目既有的像素/终端设计语言完成公告栏浮层的形态、排版、配色与交互，并做可访问性、响应式与动效自检
  - Expected outcome: 公告栏在桌面与旋转后的手机舞台上均无遮挡/溢出，对比度与焦点管理达标，视觉风格与现有 HUD 一致
