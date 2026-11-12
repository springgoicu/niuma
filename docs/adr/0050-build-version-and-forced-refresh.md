# ADR-0050：空气墙修正与部署后强制换图

- 状态：已采纳
- 日期：2026-11-12

## 背景

地图与碰撞同源，都来自 `packages/shared-types` 并编译进浏览器 bundle。部署新地图后，
仍然打开着的标签页继续用旧代码渲染、旧碰撞做本地预测，而服务端已经换成新布局：
玩家会看到「前面没东西却走不过去」，或者被服务端反复拉回原位。这类现象与碰撞数据本身
无关，而是客户端与服务端跑了不同版本的地图。

另外，树与花箱的精灵锚点在脚底中心，碰撞圆却以同一个点为圆心、半径 12，
圆的南侧一半落在地面以下，形成约 12px 的隐形阻挡。

## 问题

1. 碰撞圆怎么对齐脚底锚点，才能既消除南侧空气墙、又不留下可穿的缝？
2. 部署后如何让已经打开页面的用户自动换到新版本，而不是等手动清缓存？
3. 版本号从哪来，如何保证浏览器、Next 服务端与部署脚本看到的是同一个值？
4. HTML、图集清单与固定文件名的图集 PNG 分别该用什么缓存策略？
5. 强制刷新会不会把用户的标签页刷成死循环？

## 决策

1. **碰撞圆心抬到脚底上方**
   - `collision.ts` 新增 `footCircle(x, y, r)`，圆心为 `(x, y - r + 1)`。
   - 树与花箱统一用它注册 blocker；半径保持 12，不改阻挡宽度与寻路结果。
   - `+1` 让脚底点仍落在圆内：`y + 2` 起即可通过，不会在物体底部留下可穿的缝。

2. **构建版本号贯穿构建期与运行期**
   - Jenkins 构建前注入 `NEXT_PUBLIC_BUILD_ID = git sha + 构建号`；
     不能复用 `BUILD_ID=dontKillMe`（那是 Jenkins 保活变量）。
   - `next.config.ts` 过滤非法字符后同时设置 `env.NEXT_PUBLIC_BUILD_ID` 与
     `generateBuildId`，保证 `.next/BUILD_ID`、服务端与客户端读到同一个值。
   - `turbo.json` 的 `build.env` 必须包含该变量；否则 Turbo 会过滤环境变量并复用旧缓存，
     线上版本号将永远不变。
   - 新增 `GET /api/version` 返回 `{ id }`，响应头 `Cache-Control: no-store, max-age=0`。

3. **客户端主动检查并强制重载**
   - 新增 `BuildWatcher`，在根布局挂载，不渲染 UI。
   - 检查时机：首次挂载、`visibilitychange` 可见、`focus`、`pageshow` bfcache 恢复、
     每 30 秒；后台标签页不发请求。
   - 游戏服 Socket `onClose` 只派发 `requestBuildCheck` 事件，由 `BuildWatcher` 统一处理；
     部署必然重启游戏服，断线是发现新版本的最早时机。
   - 版本不一致时用 `location.replace` 跳到带 `__v=<id>` 的当前地址，强制产生新文档请求。
   - `sessionStorage` 记录同版本的尝试次数：10 秒冷却、最多 3 次；换版本立即重置。
     这样即使 HTML 缓存配错，也只会重试有限次，不会无限刷新。

4. **缓存策略**
   - `/_next/static/` 文件名带内容哈希，保持 `immutable` 长缓存。
   - `/sprites/manifest.json` 改为 `no-store`。
   - `/sprites/` 文件名固定、内容随版本变，改为 `no-cache, must-revalidate`，靠 ETag 走 304。
     后续若改成内容哈希文件名，可恢复长缓存。
   - `location /` 先 `proxy_hide_header Cache-Control`，再用 `map` 统一发：
     页面 `no-cache, must-revalidate`，`/api/version` 单独 `no-store`。
   - `location /` 内使用 `add_header` 后不再继承 server 级安全头，必须重复声明
     HSTS、nosniff 与 Referrer-Policy。

5. **部署自检**
   - Web 探活增加 `/api/version` 校验：返回值必须等于本次注入的版本号，否则按部署失败回滚。
   - 修改 Nginx 模板后必须 `nginx -t && systemctl reload nginx`，否则新缓存头不生效。

## 后果

- 正面：树与花箱南侧不再有隐形墙；部署后已打开页面在 30 秒内或切回前台时自动换图；
  旧页面不会带着旧碰撞去连新服务端；HTML 与图集缓存策略不再互相打架。
- 负面：每次部署都会产生新的构建版本号，Turbo 构建缓存命中率下降；
  强制刷新会丢失当前页面状态，但部署时游戏世界本来就会重置，代价可接受。
- 回滚成本：低。移除 `footCircle` 恢复圆心即可回到旧碰撞；删除 `BuildWatcher` 与
  `/api/version` 并恢复 Nginx 缓存头即可回到纯手动刷新。
- 首次上线限制：仍停留在旧页面的用户手里没有 `BuildWatcher`，需要手动刷新一次；
  从下一次部署开始才会全自动生效。

## 复核信号

- 用户仍反馈「部署后地图没变」：先查 `curl -I https://<域名>/` 是否带 `no-cache`，
  再查 `curl https://<域名>/api/version` 是否等于部署日志里的版本号。
- 标签页出现周期性重载：检查 `/api/version` 是否被中间层缓存，或页面版本是否来自旧 HTML；
  防循环计数最多允许 3 次，不应持续刷新。
- 树根附近仍觉得挡人：确认 `TREE_TRUNK_RADIUS` 是否被调大，或精灵锚点是否从底边中心改成了中心。
- 想恢复图集长缓存：把 PNG 改成内容哈希文件名，并同步修改图集加载处的 URL 生成。
