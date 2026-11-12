---
name: niuma-badge-attendance-share
overview: 在 apps/web 内实现「本地考勤引擎 + IP 归属地接口/会话缓存 + 左上角工牌 HUD + 像素档案弹窗 + Canvas 工卡分享」五个模块，并接入现有 /play HUD；全程服务端零持久化，仅用 localStorage / sessionStorage。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素工业
    - 塑料工牌套
    - 暖褐暗底
    - 薄荷冷光
    - 复印纸噪点
    - 镂空印章
    - 2px 硬边
    - 微动效
  fontSystem:
    fontFamily: Oswald / JetBrains Mono / PingFang SC
    heading:
      size: 20-28px
      weight: 600
    subheading:
      size: 13-16px
      weight: 500
    body:
      size: 12-14px
      weight: 400
  colorSystem:
    primary:
      - "#4FE3C1"
      - "#2FB59A"
      - "#F2C879"
    background:
      - "#0F0C09"
      - "#14100C"
      - "#1B1611"
      - "#E9E1CF"
    text:
      - "#F4EDE1"
      - "#C8B8A2"
      - "#A2917A"
    functional:
      - "#34D399"
      - "#38BDF8"
      - "#FB7185"
      - "#C0392B"
todos:
  - id: attendance-engine
    content: 实现 attendance.ts 引擎与纯函数，扩展 djb2 工号并补单测
    status: completed
  - id: geo-service
    content: 实现 /api/geo 与 geo.ts 会话缓存，内网与超时优雅降级
    status: completed
  - id: share-card
    content: 用 [skill:layer-pixel-art] 实现 Canvas 工卡染色、排版、复制与下载
    status: completed
    dependencies:
      - attendance-engine
  - id: badge-ui
    content: 用 [skill:impeccable] 实现 BadgeCard 与 BadgeDetailModal 及焦点守卫
    status: completed
    dependencies:
      - attendance-engine
      - geo-service
      - share-card
  - id: integrate-hud
    content: 接入 GameViewport，替换 PlayerCard 并清理 Hud 死代码
    status: completed
    dependencies:
      - badge-ui
  - id: verify
    content: 运行 typecheck 与 bun 测试，用 [skill:impeccable] 和 [skill:vercel-react-best-practices] 收尾审查
    status: completed
    dependencies:
      - integrate-hud
---

## 产品概述
为《牛马 NIOMA》重构左上角工牌，并新增可展开的牛马考勤档案弹窗与一键生成工卡图片。所有考勤与归属地数据只在前端计算，持久化仅使用 localStorage 与 sessionStorage，服务端不落任何用户数据。

## 核心功能
- 考勤引擎：以 `niuma:attendance:v1` 存储首次入职日、累计在岗、每日记录与本次打卡时间；1 秒内存心跳驱动走秒，30 秒批量落盘，切后台与关窗强制落盘；跨零点自动切分当日记录；派生当前在岗时长、日均工时、工龄与职级。
- 归属地服务：读取转发 IP，本地与内网直接返回园区局域网；公网查询失败时降级为赛博空间，绝不返回 500；前端写入 `niuma:geo:v1`，同一会话只请求一次。
- 工牌 HUD：左上角半透明像素黑底卡片，三行展示物种图标、昵称与状态、出勤地、在岗走秒；点击卡片编辑状态，右侧档案按钮打开详情。
- 考勤档案弹窗：挂绳孔与金属夹、双色硬边、伪条形码/二维码/安全芯片、15 度倾斜镂空印章；展示固定工号、职级与警示、本次在岗、日均在线、累计工龄、出勤地点；支持 Esc 退出、焦点复位并阻断移动键。
- 工卡分享：480×720、2 倍采样 Canvas，绘制复印纸噪点、带外观染色的物种立绘、档案明细、随机职场金句、条形码与红章；优先复制到剪贴板，失败降级下载，成功后显示像素风 Toast。

## 视觉与体验
暗色暖褐游戏 HUD 上叠一张半透明像素工牌，薄荷绿走秒与琥珀色细节形成冷光焦点；弹窗模拟真实塑料工牌套，红或金空心印章压角；分享图呈现复古工卡拍立得质感，硬边、无圆角、无模糊。


## 技术栈
- Next.js 15 App Router + React 19 + TypeScript strict
- Tailwind CSS v4（复用 ink/mist/mint/amber/signal token）与 lucide-react
- Zustand（现有依赖）承载 1 秒心跳与考勤视图状态
- 原生 Canvas 2D 离屏绘制，不引入第三方 Canvas 或图片合成库
- localStorage / sessionStorage，复用 `lib/storage.ts` 的 browserStorage/readJson/writeJson

## 实现方案

### 1. 考勤引擎（lib/game/attendance.ts）
- 严格导出 `AttendanceStorage` 与 `ATTENDANCE_KEY = 'niuma:attendance:v1'`；持久化对象只含需求定义的四个字段。
- 纯函数：`formatDuration(ms)`、`getCurrentSessionDuration(startTime, now = Date.now())`、`getDailyAverageHours(storage)`、`getSeniorityDays(firstJoinDate)`、`getJobTitle(avgDailyHours)`、`splitAttendanceInterval(daily, fromMs, toMs)`、`getStampTitle(avg, seniorityDays)`。
- 单参调用保持兼容，增加可选 `now` 参数仅用于测试与跨零点推导；非有限值或非正数打卡时间返回 `00:00:00`。
- 日期键统一使用本地日历（年/月/日），禁止 `toISOString()`，避免东八区零点前后错位。
- `AttendanceTracker`：启动时读取 storage（readJson + guard 清洗），保留历史总额与每日记录，把 `sessionStartTime` 重置为当前时间；内存中累计总时长与当日时长；每 1 秒更新 zustand，不在 tick 内写 localStorage；每 30 秒 flush 一次；监听 visibilitychange(hidden)、beforeunload、pagehide，并在 dispose 时 flush。
- 跨天：tick 时把 `[上次 tick, now]` 交给 `splitAttendanceInterval`，按本地零点逐日切片，O(跨天次数)，自动生成新日期键。
- 指标口径：日均只统计大于 0 的日期并四舍五入到一位小数；工龄按本地零点日期差计算且最小为 1；职级边界 2.0 与 8.0 按需求包含。
- 存储写入失败由 writeJson 吞掉，不阻断游戏；StrictMode 双挂载用模块级引用计数保证启动/停止幂等。

### 2. 归属地（app/api/geo/route.ts + lib/game/geo.ts）
- Route Handler：`runtime = 'nodejs'`、`dynamic = 'force-dynamic'`；读取 `x-forwarded-for` 第一段或 `x-real-ip`，规范化 IPv6-mapped IPv4、去除端口与 unknown。
- 环回、私网、缺失或非法 IP 直接返回 `{ region: '园区局域网', city: '工位内网', isp: '直连' }`。
- 公网先请求 ip-api.com（2 秒超时、lang=zh-CN），失败再请求 ipapi.co（1.5 秒）；任何异常返回 `{ region: '赛博空间', city: '边缘节点', isp: '未知网络' }`；整体 try/catch，始终返回 200 JSON，`cache-control: private, no-store`。
- 客户端：`GeoInfo` 类型 + `sanitizeGeo`；`loadGeo()` 先读 sessionStorage，模块级 in-flight Promise 去重，成功或降级结果都写回 `niuma:geo:v1`，保证同一标签页会话不重复请求；fetch 自带 4 秒超时。

### 3. 工牌与弹窗（components/BadgeCard.tsx + components/BadgeDetailModal.tsx）
- BadgeCard 取代 GameViewport 左上角的 PlayerCard，保留 StatusEditor 与 `useGameUi.statusOpen` 的既有逻辑；整卡点击切换状态编辑，右侧竖条档案按钮独立触发弹窗。
- 物种图标使用 `/sprites/preview-{species}.png` 并加 `pixelated`；走秒下沉到独立 `SessionClock` 子组件订阅 zustand，避免整卡每秒重渲染；出勤地来自 geo 缓存，首帧同步读取、无缓存时异步补全。
- 打开档案前关闭状态编辑、调用 `document.activeElement?.blur()`，并由 GameViewport 清除移动输入；弹窗通过 `createPortal` 挂到 body，避免工牌 `backdrop-filter` 形成 fixed 包含块。
- 弹窗：`role="dialog"`、`aria-modal`；挂载时聚焦关闭按钮，window 捕获阶段拦截 Escape 与 WASD/方向键/空格/动作键，保留 Tab 焦点循环；卸载时 blur 并聚焦游戏 canvas（按需设置 tabIndex=-1）。
- 工号：djb2 对昵称按码点哈希，输出 `#NM-` 加 5 位补零；印章按日均与工龄映射为终身免下班、全勤特等牲、模范标兵、摸鱼练习生，红或金描边、旋转 15 度、镂空字。
- 弹窗指标实时订阅考勤 store；当日键由 store 的 now 推导，跨零点自动切换。

### 4. 分享卡（lib/game/share-card.ts）
- 模块级缓存 manifest、图片与染色结果；`renderShareCard(data)` 创建 480×720 逻辑画布、`ctx.scale(2, 2)`、关闭平滑。
- 立绘：按 PONY_LAYER_ORDER 读取 `/sprites/{path}` 第 0 帧（down idle），每层在 64×64 离屏 canvas 用 multiply + destination-in 完成色调相乘并保留 alpha；bodyLight 与 eyeLight 用 mixHex 0.22/0.7；整数 4 倍合成；配件按 manifest 锚点与 cosmeticSize 绘制；单层失败跳过，整体失败退回大号文字占位。
- 版式：卡头、纸纹人像框、姓名与职级、五行明细（点线引导）、随机金句、工号派生条码、15 度红章、页脚零持久化说明。
- 复制：点击栈内同步创建 `ClipboardItem({ 'image/png': blobPromise })`，满足 Safari 用户手势要求；不支持或被拒时自动下载；下载用 `toDataURL` 加锚点，文件名 `牛马工牌-NM-xxxxx.png`（去掉井号以兼容文件系统）。
- Toast 文案沿用需求原文；渲染与素材加载失败也有兜底提示。
- 只做 manifest 的 type import，不把 Pixi 运行时带进分享模块。

### 5. 性能、可靠性与兼容
- 每秒只写内存与 zustand；localStorage 写入固定为 30 秒、切后台、关窗与卸载。
- geo 每会话一次；分享卡仅在操作时渲染，素材与 manifest 缓存复用。
- 所有 storage、clipboard、canvas、image 失败均有降级；分享卡只引用同源 `/sprites/*`，满足 COEP。
- 警告闪烁复用现有 `.animate-blink`，reduced-motion 下由全局规则自动关闭。
- 不新增依赖、不改协议、不触碰 apps/server 与部署配置。

## 数据流
`GameViewport` 持有 Profile 并启动 AttendanceTracker；`BadgeCard` 订阅考勤 store 与 geo，打开 portal 弹窗；`BadgeDetailModal` 汇总指标并调用 `share-card`；服务端仅 `/api/geo` 无状态读取请求头。

## 目录结构
```
apps/web/
├── app/
│   └── api/
│       └── geo/
│           └── route.ts              [NEW] IP 归属地 Route Handler：IP 规范化、私网判断、双供应商超时查询、统一降级与 no-store 响应
├── components/
│   ├── BadgeCard.tsx                 [NEW] 左上角工牌 HUD：三行信息、状态编辑、会话走秒、地理缓存、档案入口与 portal 弹窗
│   ├── BadgeDetailModal.tsx          [NEW] 像素挂卡弹窗：字段明细、印章、条码/二维码/芯片、焦点与按键守卫、复制/下载与 Toast
│   └── game/
│       ├── GameViewport.tsx          [MODIFY] 用 BadgeCard 替换 PlayerCard；启动/停止考勤时钟；打开档案时清移动输入
│       └── Hud.tsx                   [MODIFY] 移除仅被旧 PlayerCard 使用的 CardStats/BadgeMeta/StatusBlock/PlayerCard，保留 SpeciesTag 等共用件
└── lib/
    ├── __tests__/
    │   └── attendance.test.ts        [NEW] 覆盖时长格式、日均、工龄、职级边界、工号、午夜切分
    └── game/
        ├── attendance.ts             [NEW] AttendanceStorage、纯函数、Zustand 视图 store、内存优先 Tracker 与多事件 flush
        ├── badge.ts                  [MODIFY] 追加 djb2 工号派生函数，保持纯函数与现有工牌模型不变
        ├── geo.ts                    [NEW] GeoInfo、sessionStorage 清洗读写、in-flight 去重与降级缓存
        └── share-card.ts             [NEW] 原生 Canvas 工卡渲染、分层染色、金句/条码/印章、剪贴板与下载通路
```
复用不改：`lib/storage.ts`、`lib/color.ts`、`lib/game-ui.ts`、`components/game/StatusEditor.tsx`、`packages/shared-types` 与 `/sprites` 资源。

## 关键结构
```ts
export interface GeoInfo {
  region: string;
  city: string;
  isp: string;
}

export interface ShareCardData {
  name: string;
  employeeNo: string;
  jobTitle: string;
  species: Species;
  appearance: CharacterAppearance;
  location: string;
  todayDuration: string;
  dailyAverageHours: number;
  stamp: string;
  quote?: string;
}
```

## 实现注意
- 优先复用 `browserStorage/readJson/writeJson`、`mixHex/toHexString`、`StatusEditor`、`useGameUi` 与现有主题 token，不另建存储或样式体系。
- 开工前按项目规则加载 impeccable 处理 UI；分享卡绘制遵守整数缩放、最近邻采样与 64×64 帧原点。
- 注意 StrictMode 双挂载、Modal 监听器与 tracker 定时器清理；避免每秒重渲染整张工牌。
- 仓库没有天气组件，BadgeCard 占用现有左上角工牌槽位；FPS/PING/POS 诊断行随旧卡移除。
- 验收：`pnpm --filter @niuma/web typecheck` 零错误；`cd apps/web && bun test lib` 通过；手动核对弹窗 Esc、焦点复位与复制/下载降级。


## 设计方向
像素工业风工牌套：暖褐暗底、半透明塑料黑卡、2px 硬边、无圆角、复印纸与金属夹细节；薄荷绿作为唯一冷光，琥珀与印章红承担状态强调。

## 工牌 HUD
桌面宽约 268px、移动端约 200px，位于视口左上角现有工牌槽位。三行信息：物种像素图标、粗体白名、薄荷绿状态（单行省略）；出勤地与绿色等宽走秒。右侧 36px 竖条档案入口，带书本图标与竖排小字，悬停时薄荷描边。点击主体展开状态编辑，展开方向向下，不遮挡画面中心。卡片进入时轻微上浮，状态展开使用 160ms 硬朗位移，不使用弹跳缓动。

## 档案弹窗
居中 portal，宽 430px、最大高 92dvh，移动端 94vw 且内部滚动。外层模拟塑料套：顶部挂绳孔与金属夹凹槽、双层 2px 描边、内层深色面板。字段采用等宽小字左标签、右值，分隔线为点线；警示行使用玫红闪烁。右下压一枚 15 度旋转的红或金空心印章，覆盖在伪条形码与伪二维码之上；左下安全芯片为金色小方块。底部两枚等宽操作按钮，复制与下载并排，处理中显示冲洗态。Toast 从弹窗底部滑入，硬边像素框，3 秒后消失。

## 分享卡
480×720 竖版，2 倍采样。复古灰黄纸底叠加细密噪点与扫描线；顶部居中的挂绳孔与卡头；中部人像框内是带外观色调的物种大立绘，整数 4 倍像素放大；姓名与职级压在框下；五行明细使用点线引导；底部左侧防伪条码，右侧 15 度红章，页脚标注仅供自嘲。整体像一张从工牌打印机里吐出的拍立得。

## 响应式与可访问性
桌面与移动端共享同一信息层级；移动端缩小字号与内边距，档案入口保留可点面积。所有文字单行省略或内部滚动，不撑破视口。弹窗保留可见焦点环、Tab 循环、Escape 关闭与背景遮罩点击关闭；reduced-motion 下关闭闪烁与位移动效。

## Agent Extensions
### Skill
- **impeccable**
  - Purpose: 设计并打磨 BadgeCard 与 BadgeDetailModal 的像素视觉、交互状态、焦点管理与响应式表现。
  - Expected outcome: 工牌与弹窗符合项目暗色像素体系，无通用模板感，键盘与移动端体验完整。
- **layer-pixel-art**
  - Purpose: 指导分享卡中 64×64 分层精灵的取帧、最近邻放大、整数缩放与色调合成。
  - Expected outcome: 立绘边缘锐利无插值，图层顺序与配件锚点正确，导出图保持像素质感。
- **vercel-react-best-practices**
  - Purpose: 审查 React 19 客户端组件、effect 清理、zustand 订阅粒度与分享模块的包体边界。
  - Expected outcome: 每秒心跳不引发整卡重渲染，StrictMode 下定时器与监听器无泄漏，分享模块不引入 Pixi 运行时。
