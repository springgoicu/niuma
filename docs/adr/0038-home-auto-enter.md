# ADR-0038：有本地存档的回访者打开域名直达园区

- 状态：已采纳
- 日期：2026-11-11
- 关联：ADR-0034（浏览器会话快照）

## 背景

ADR-0034 之后，关掉浏览器再打开仍站在自己的工位上。但入口还是营销首页：回访者每次都要先看一遍产品介绍，
再手动点「打卡上班」或「直接进入园区」。他已经捏过人，这一步纯属摩擦，需求是打开域名直接开工。

## 决策

### 1. 内联同步脚本，在解析阶段完成跳转

首页仍是 Server Component、仍静态预渲染，只在返回树最前面插入一段 `<script>`
（脚本源码收口在 `apps/web/lib/auto-enter.ts`）。浏览器解析到它时同步执行
`location.replace('/play')`，此时任何可见内容都还没绘制，所以不存在「首页闪一下」。

不用 `useEffect` + `router.replace`：那必然先绘制首页。不用 `next/script` 的
afterInteractive / lazyOnload：同样在首屏之后执行。不用 middleware + cookie：回访标记
必须写进 cookie 才能被服务端读到，这会把纯静态首页拖成依赖请求头的动态页，
也与 ADR-0004 的取向相悖。

### 2. 三条守卫，任一不满足就留在首页

判定顺序（短路）：

```
sessionStorage['niuma:home-visited:v1'] 已为 '1'   → 留首页（本次会话已处理过首页）
                 ↓ 否则先写入标记
localStorage['niuma:profile:v2'] 不存在             → 留首页
JSON.parse 失败 / 解析结果不是对象                   → 留首页（坏数据交给 /play 的 loadProfile 清）
document.referrer 非空且以 location.origin 开头      → 留首页（同源 = 站内导航）
                 ↓
location.replace('/play')
```

- **先写标记再判定**：`sessionStorage` 关浏览器即清，正好对齐「重新打开」的语义；
  先写保证同一会话内之后任何形式回到首页都不再自动跳，站内点 Logo、打卡下班、
  刷新首页都正常展示首页。
- **同源 referrer 放行**：`/play → /` 的客户端路由本就不会重新执行脚本，
  但整页加载、从 `/create` 硬回首页这类路径仍需兜底。
- **`document.readyState !== 'loading'` 直接返回**：React 在客户端导航到 `/` 时会
  新建这个 `script` 元素并插入，内联脚本会被执行一次。此时文档已不是 `loading`，
  这条守卫保证「站内导航回首页」永远不会被弹回园区。
- **`location.replace` 而非 `assign`**：不新增历史条目，用户按返回不会回到首页又被弹走。
- 存储访问与 JSON 解析全部 try/catch，异常一律不跳：隐私模式、配额满、坏数据
  都只损失一次便捷，不让首页白屏或抛错。

### 3. 存档 key 只有一处语义来源

脚本需要读 `niuma:profile:v2`，但 `apps/web/lib/profile.ts` 带 `'use client'`，
Server Component 不能从它取常量。`auto-enter.ts` 里另写一份，并由
`lib/__tests__/auto-enter.test.ts` 断言脚本包含 `PROFILE_KEY`，防止两处漂移。

## 后果

- 正面：回访者的最短路径从「首页 → 点按钮 → 园区」变成「打开即园区」，且没有闪烁。
- 正面：首页继续静态预渲染，客户端 bundle 不增加；无 `localStorage` 时输出与之前完全一致，
  SEO、爬虫、禁用 JS 的环境都不受影响。
- 负面：`niuma:profile:v2` 从单纯的「身份存档」变成兼作「导航信号」，
  清掉存档也会连带失去直达。
- 负面：多了一个会话级 key `niuma:home-visited:v1`。
- 回滚成本：极低。删掉 `app/page.tsx` 里的那行 `<script>` 即回到旧行为，不动任何存档。

## 复核信号

- 出现「首次访问也要直接进园区」或「按设备 / 账号记忆入口偏好」的需求时，
  重新评估 cookie 或服务端路由。
- 首页转化明显下降（回访者不再浏览营销内容）时，反过来评估是否只在二次以上访问才直达。
