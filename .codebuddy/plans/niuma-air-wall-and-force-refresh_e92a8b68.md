---
name: niuma-air-wall-and-force-refresh
overview: 修复地图中的空气墙（树/花箱碰撞圆心错位、部署后客户端与服务端地图版本错配），并建立部署后自动强制刷新机制：构建版本号 + /api/version 接口 + 客户端 BuildWatcher + Nginx HTML/精灵缓存策略，确保用户始终加载最新地图。
todos:
  - id: build-version-plumbing
    content: 注入构建版本号并新增 /api/version，更新 Next、Turbo 与 Jenkins 配置
    status: completed
  - id: client-build-watcher
    content: 实现 BuildWatcher 与版本工具，挂载根布局并在断线时触发检查
    status: completed
    dependencies:
      - build-version-plumbing
  - id: nginx-cache-policy
    content: 调整 Nginx 的 HTML、manifest 与精灵缓存头，保留安全头并记录 reload 步骤
    status: completed
  - id: collision-footprint-fix
    content: 用 [skill:test-driven-development] 先写失败测试，再修正树与花箱碰撞圆心
    status: completed
  - id: final-verification
    content: 补 ADR 并用 [skill:verification-before-completion] 跑 typecheck、测试、构建与缓存头核对
    status: completed
    dependencies:
      - build-version-plumbing
      - client-build-watcher
      - nginx-cache-policy
      - collision-footprint-fix
---

## 用户需求
- 检查并修复游戏中“看得见的路却走不过去”的空气墙。
- 每次部署后，让已经打开页面的用户自动切换到最新地图，避免旧地图与新服务端碰撞不一致。

## 产品概述
玩家在园区中移动时，角色应与画面中的树木、花箱、建筑和道路保持一致：画面里没有实体的地方不应阻挡，画面里有实体的地方不应穿过去。部署新地图后，用户不需要手动清缓存，页面会自动检测版本并重载，确保看到的画面、碰撞和服务器一致。

## 核心功能
- 修正树木与花箱的碰撞范围，使碰撞底边贴合可见底座，消除物体南侧的隐形阻挡。
- 版本检测：页面在打开、切回前台、重新聚焦、定时检查以及网络断线重连时，比对当前页面版本与服务端最新版本。
- 自动重载：发现版本不一致时，自动以带版本参数的地址重载页面，并避免重复刷新死循环。
- 缓存策略：页面文档、图集清单与图集图片不使用长期强缓存，确保重载后拿到最新资源；构建产物继续使用内容哈希长缓存。
- 部署校验：部署完成后核对线上版本与本次构建一致。


## 技术栈
- 前端：现有 Next.js 15 App Router + React 19 + TypeScript，standalone 输出
- 服务端：现有 Bun WebSocket 游戏服 + Nginx 反向代理 + Jenkins 部署脚本
- 测试：`packages/shared-types` 使用 Vitest，`apps/web` 与 `apps/game-server` 使用 Bun test
- 新增依赖：无；不引入 Service Worker

## 实现策略

### 1. 构建版本号从构建期贯穿到运行期
- 在 `apps/web/next.config.ts` 计算 `buildId = process.env.NEXT_PUBLIC_BUILD_ID || 'dev'`，并做一次安全字符过滤，只保留字母、数字、点、下划线和短横线。
- 同时设置：
  - `env: { NEXT_PUBLIC_BUILD_ID: buildId }`，让 Next 把版本号内联进服务端与客户端 bundle；
  - `generateBuildId: () => buildId`，让 `.next/BUILD_ID` 与对外版本一致。
- 新增 `apps/web/lib/build-id.ts` 导出 `BUILD_ID`，服务端路由和客户端组件都只读这一份值，避免运行时环境变量缺失导致两端不一致。
- 新增 `apps/web/app/api/version/route.ts`，`dynamic = 'force-dynamic'`，返回 `{ id: BUILD_ID }`，响应头 `Cache-Control: no-store, max-age=0`。
- 在 `turbo.json` 的 `build.env` 中加入 `NEXT_PUBLIC_BUILD_ID`，否则 Turbo 会过滤该变量，且缓存命中会复用旧构建。
- 在 `deploy/jenkins-deploy.sh` 构建前注入唯一版本号，优先使用 `GIT_COMMIT`，附加 `BUILD_NUMBER` 或时间戳；不要复用现有的 `BUILD_ID=dontKillMe`，那是 Jenkins 保活变量。
- 部署探活通过后，请求 `/api/version` 并与本次构建版本比对，不一致直接判定部署失败。

### 2. 客户端版本检查与强制刷新
- 新增 `apps/web/components/BuildWatcher.tsx`，在 `apps/web/app/layout.tsx` 的 body 中挂载。组件不渲染任何 UI，不引入额外布局。
- 检查时机：首次挂载、`visibilitychange` 变为可见、`focus`、`pageshow` 的 bfcache 恢复、每 30 秒一次；后台标签页不发起请求。
- 请求 `/api/version` 时使用 `cache: 'no-store'`。版本一致则什么都不做，请求失败则静默等待下一轮，不影响游戏。
- 版本不一致时：
  - 用 `sessionStorage` 记录 `{ id, at }`，同一版本 10 秒内只允许刷新一次，防止旧 HTML 反复被缓存导致死循环；
  - 通过 `location.replace` 跳转到带 `__v=<id>` 参数的当前地址，强制产生一次新的文档请求；
  - 新页面加载到新版本后，不再触发刷新。
- 新增 `apps/web/lib/build-version.ts`，沉淀 `shouldReloadForVersion`、`markReloaded`、`reloadUrl`、`requestBuildCheck` 等纯函数，并补 Bun 单测。
- 在 `apps/web/lib/game/session.ts` 的 `onClose` 中调用 `requestBuildCheck()`：部署会重启游戏服，Socket 断开时立即校验版本，避免玩家带着旧地图重连后撞空气墙。
- 如果页面在后台，断线事件只记录，不立即刷新；等用户切回前台时由 `visibilitychange` 完成检查。

### 3. 缓存策略
- `deploy/production/nginx/niuma-site.conf.template`：
  - 在模板顶部、`server` 之外增加 `map $uri $niuma_cache_control`：`/api/version` 映射为 `no-store, max-age=0`，其余动态响应映射为 `no-cache, must-revalidate`。
  - `location /` 中先 `proxy_hide_header Cache-Control`，再 `add_header Cache-Control $niuma_cache_control always`。
  - `location /` 内一旦使用 `add_header`，server 级的 `Strict-Transport-Security`、`X-Content-Type-Options`、`Referrer-Policy` 不会自动继承，必须在该 location 内重复声明。
  - `/sprites/manifest.json` 从 `no-cache` 改为 `no-store`。
  - `/sprites/` 从 `max-age=604800` 改为 `no-cache`，保留现有 `limit_rate`、`limit_conn` 与 `access_log off`。
  - `/_next/static/` 保持 `immutable` 长缓存不变，因为文件名带内容哈希。
- 模板变更需要同步到服务器并执行 `nginx -t` 与 reload，之后的应用部署才会生效。
- 选择“精灵图 no-cache”而不是立刻改内容哈希：不动现有资源管线，304 校验成本低；后续可演进为带哈希的文件名以恢复长缓存。

### 4. 碰撞体修正
- 在 `packages/shared-types/src/world/collision.ts` 增加脚底锚点辅助函数 `footCircle(x, y, r)`，返回圆心为 `y - r + 1` 的圆，让碰撞圆底边贴在物体脚底，而不是向下多出 12px。
- 树木与花箱统一使用该辅助函数注册 blocker。
- 不改变 `TREE_TRUNK_RADIUS` 与 `PLANTER_RADIUS`，避免同时改变阻挡宽度、寻路网格与玩家体感；本次只修正圆心。
- 在 `packages/shared-types/src/__tests__/collision.test.ts` 增加回归断言：
  - `isBlocked(tree.x, tree.y, 0)` 为 true；
  - `isBlocked(tree.x, tree.y + 10, 0)` 为 false；
  - 花箱同理。
- 该测试在当前实现下应失败，修正后通过，确保“脚底下方隐形墙”被真正消除。

### 5. 方案取舍
- 版本检测选轮询而不是 Service Worker：项目当前没有 Service Worker，引入它会增加缓存层与更新生命周期的复杂度；轮询只请求一个极小的 JSON。
- HTML 缓存放在 Nginx 而不是 Next headers：Nginx 覆盖所有页面、RSC 请求与代理响应，部署层统一控制；代价是需要注意 `add_header` 的继承规则。
- 碰撞修正选“上移圆心”而不是“缩小半径”：不会改变树干阻挡宽度与既有寻路结果，回归面最小。
- 不修改 WebSocket 协议加入构建号：协议改动需要双端同批发布，风险高于收益；断线触发 HTTP 版本检查已经能覆盖部署重启窗口。

## 架构设计
```mermaid
flowchart LR
    A[构建时生成 BUILD_ID] --> B[Next 内联到服务端与客户端]
    B --> C[页面加载 BuildWatcher]
    D[/api/version 返回最新 ID] --> C
    C -->|版本一致| E[继续运行]
    C -->|版本不一致| F[sessionStorage 防循环]
    F --> G[location.replace 带 __v]
    G --> H[新 HTML + 新 JS + 新地图]
    I[游戏服重启 Socket 断开] --> C
```

## 目录结构
```
niuma/
├── apps/web/
│   ├── next.config.ts                                  [MODIFY] 注入 NEXT_PUBLIC_BUILD_ID，设置 env 与 generateBuildId
│   ├── app/
│   │   ├── layout.tsx                                  [MODIFY] 在 body 中挂载 BuildWatcher
│   │   └── api/version/route.ts                        [NEW] 返回 { id }，强制动态渲染与 no-store
│   ├── components/BuildWatcher.tsx                     [NEW] 客户端版本轮询、断线检查与强制重载
│   └── lib/
│       ├── build-id.ts                                 [NEW] 构建期内联的 BUILD_ID 常量
│       ├── build-version.ts                            [NEW] 版本比较、防循环、重载 URL、检查事件
│       ├── __tests__/build-version.test.ts             [NEW] 纯函数单测，覆盖同版本、升级、防循环
│       └── game/session.ts                             [MODIFY] onClose 触发 requestBuildCheck
├── packages/shared-types/
│   ├── src/world/collision.ts                          [MODIFY] 新增 footCircle，修正树与花箱圆心
│   └── src/__tests__/collision.test.ts                 [MODIFY] 补脚底下方无隐形墙回归测试
├── turbo.json                                          [MODIFY] build.env 增加 NEXT_PUBLIC_BUILD_ID
├── deploy/
│   ├── jenkins-deploy.sh                               [MODIFY] 构建前注入版本号，探活后校验 /api/version
│   └── production/nginx/niuma-site.conf.template       [MODIFY] HTML/version/manifest/sprites 缓存策略
└── docs/adr/0050-build-version-and-forced-refresh.md   [NEW] 记录版本一致性与强制刷新决策
```

## 实施注意
- `BUILD_ID=dontKillMe` 是 Jenkins 防止杀进程的变量，不能作为应用版本号；版本号必须单独注入。
- Turbo 的 `build.env` 不包含新变量时会过滤环境变量并复用旧缓存，导致线上版本号不变，必须同步修改 `turbo.json`。
- Nginx `location /` 中的 `add_header` 会覆盖 server 级安全头，必须重复声明 HSTS、nosniff 与 Referrer-Policy。
- `/api/community/qr` 也会落入 `location /` 并被统一设为 no-cache；若后续需要保留其长缓存，可为其增加独立 location。
- 首次上线 BuildWatcher 时，仍停留在旧页面的用户手里没有新组件，需要手动刷新一次；从下一次部署开始才会全自动生效。
- 旧版本的 `_next/static` chunk 只保留一轮部署，强制刷新也能避免旧页面懒加载已删除的 chunk 时出现 404。
- `BuildWatcher` 不产生 React 状态更新，不参与渲染，不会造成帧循环或布局抖动。
- 版本号是公开信息，不包含密钥或用户数据；`/api/version` 不读取 Cookie，不涉及权限。

## 性能与可靠性
- 30 秒轮询一次极小 JSON，200 个可见客户端约 6.7 请求/秒，对 Nginx 与 Next 可忽略；后台标签页不发请求。
- 精灵图改为 no-cache 后依靠 ETag 返回 304，只在图集首次加载时发生，`/_next/static` 仍保持 immutable 长缓存。
- 碰撞修正不改变网格索引与 `resolveMotionInto` 的热路径复杂度，仍为常数级邻近桶查询。
- 刷新失败不会影响游戏：版本接口异常时静默重试，不阻塞移动、聊天或 WebSocket 重连。
- 防循环窗口只拦截同一版本的短时间重复刷新，不会阻止后续新版本再次触发。

## 验证清单
- 先运行新增碰撞测试，确认当前实现在 `y + 10` 处被挡；修正后测试通过。
- 运行 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`。
- 启动本地生产构建，确认 `/api/version` 返回构建版本且响应头为 no-store。
- 用两个不同 `NEXT_PUBLIC_BUILD_ID` 分别构建并重启，确认已打开页面在 30 秒内或切回前台时自动重载到新版本。
- 执行 `nginx -t`，并用 `curl -I` 核对：
  - 首页为 `Cache-Control: no-cache, must-revalidate`；
  - `/api/version` 为 `no-store, max-age=0`；
  - `/sprites/manifest.json` 为 `no-store`；
  - `/sprites/` 下图片为 `no-cache`；
  - `/_next/static/` 仍为 `public, max-age=31536000, immutable`。


## Agent Extensions
### Skill
- **test-driven-development**
  - Purpose: 先为树木与花箱脚底下方空气墙写失败测试，再修改碰撞圆心，确保修正可验证。
  - Expected outcome: 新增回归测试在修改前失败、修改后通过，且不影响既有出生点、寻路与座位断言。
- **verification-before-completion**
  - Purpose: 在声称完成前运行类型检查、全量测试、生产构建与缓存头核对。
  - Expected outcome: 所有命令输出通过，版本接口、Nginx 缓存头与碰撞回归均有实际证据。
