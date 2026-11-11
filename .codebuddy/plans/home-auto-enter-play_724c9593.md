---
name: home-auto-enter-play
overview: 有角色存档的回访用户打开站点根路径时，跳过营销首页直达 /play；站内导航回首页不受影响，跳转在 HTML 解析阶段完成、无闪烁。
todos:
  - id: auto-enter-lib
    content: 新建 lib/auto-enter.ts，实现三层守卫的内联脚本生成与会话 key
    status: completed
  - id: home-inject
    content: Use [skill:vercel-react-best-practices] to inject the inline script as the first node of app/page.tsx without client rendering
    status: completed
    dependencies:
      - auto-enter-lib
  - id: auto-enter-tests
    content: 新增 lib/__tests__/auto-enter.test.ts，用 new Function 覆盖全部判定分支
    status: completed
    dependencies:
      - auto-enter-lib
  - id: docs-sync
    content: 补写 ADR-0038 并在 README 核心约束中说明直达行为
    status: completed
    dependencies:
      - auto-enter-lib
      - home-inject
  - id: verify
    content: 运行 typecheck、bun test 与 next build，按四条路径手动验收
    status: completed
    dependencies:
      - home-inject
      - auto-enter-tests
      - docs-sync
---

## 用户需求
已经捏过角色的人关闭浏览器后再次打开域名，不再进入营销首页，直接进入 `/play` 园区。

## 产品概述
给回访用户一条最短路径：浏览器里已有角色存档时，打开根路径立即进入园区；新访客仍从首页了解产品并开始捏人。站内导航（点 Logo、打卡下班回首页）不受影响，跳转在页面解析阶段完成，用户看不到首页闪现。

## 核心功能
- **有存档直达**：localStorage 存在 `niuma:profile:v2`（已捏过人）时，打开根路径直接进入 `/play`，沿用既有昵称、外观与上次落点。
- **新访客不变**：无存档时正常展示首页，SEO 与首屏内容完全不受影响。
- **仅限重新打开**：站内从 `/play` 点「打卡下班」、从 `/create` 点「返回园区」或点 Logo 回首页，正常展示首页，不会被弹回园区；同一会话内刷新首页也不跳。
- **零闪烁**：HTML 解析阶段同步完成跳转，不出现首页内容闪烁，也不增加一次客户端路由跳转。
- **静默降级**：存储不可用（隐私模式）、存档 JSON 损坏、脚本异常时一律不跳转，首页正常展示。
- **可验证**：跳转判定逻辑有单元测试覆盖，包含同源来源、跨域来源、首次访问、重复访问、坏数据等分支。


## 技术栈
- 复用现有栈：Next.js 15 App Router、React 19 Server Component、TypeScript strict、bun test（`apps/web` 的 `test` 为 `bun test lib`），不新增任何依赖。
- 不使用 middleware / cookie / 服务端状态：项目约束是服务端零持久化，且 middleware 方案需要 cookie 才能判断，会把纯静态首页拖成依赖请求头。

## 实现方案
在首页 HTML 中最靠前的位置输出一段自包含内联脚本，浏览器解析到它时同步执行并 `location.replace('/play')`；由于脚本先于任何可见 DOM 被解析，用户在首屏绘制前就被送到园区，零闪烁。

守卫顺序（严格按此顺序，任一不满足即安静返回）：

1. 读 `sessionStorage['niuma:home-visited:v1']`：已为 `'1'` 说明本次浏览会话已处理过首页，直接返回；否则立即写入标记。标记先写后判，保证同一会话内之后任何形式回到首页都不再自动跳。
2. 读 `localStorage['niuma:profile:v2']`：不存在则返回。
3. `JSON.parse` 后校验为非 null、非数组的对象：否则返回，坏数据交给 `/play` 的 `loadProfile()` 清理。
4. `document.referrer` 非空且以 `location.origin` 开头：说明是同源站内导航，返回。
5. 执行 `location.replace('/play')`：用 `replace` 不新增历史记录，避免用户按返回键回到首页又被弹走。

关键取舍：
- **不用 `useEffect` + `router.replace`**：首页会先绘制再跳转，违反「不能闪烁」，且多一次客户端渲染与路由切换。
- **不把逻辑写死在 JSX 字符串里**：抽到 `apps/web/lib/auto-enter.ts`，用函数生成脚本文本，测试通过 `new Function('window','document','location', script)` 注入假对象真实执行，不引入 jsdom。
- **不引入 `next/script` 的 afterInteractive/lazyOnload**：那些策略都在首屏之后执行，无法保证零闪烁；内联同步脚本体积小于 1KB，无网络请求。

性能与可靠性：
- 脚本 O(1)，两次同步存储读取，无网络、无依赖、不进渲染热路径；首页仍是静态预渲染，客户端 bundle 不增加。
- 所有存储访问与 JSON 解析包在 try/catch，任何异常回落到首页；`sessionStorage` 不可写时按「已访问」处理，宁可少跳也不反复打扰。
- 脚本不引用外部作用域，只注入 `HOME_VISITED_KEY` 与 `PROFILE_KEY` 两个常量；测试断言脚本文本包含 `PROFILE_KEY`，防止与 `lib/profile.ts` 的存档 key 漂移。

## 架构设计
沿用既有分层，不新增架构模式：

- **展示层**：`app/page.tsx`（Server Component）在返回树最前面插入内联 script，不改首页其余结构与样式。
- **纯逻辑层**：`lib/auto-enter.ts` 只负责「生成脚本文本 + 导出会话标记 key」，不依赖 React、不依赖 `profile.ts`（后者带 `'use client'`，不能从 Server Component 调用其函数）。
- **验证层**：`lib/__tests__/auto-enter.test.ts` 用 `bun:test` 与假 storage 执行脚本，覆盖所有守卫分支。
- **数据流**：`localStorage`（长期身份） + `sessionStorage`（本次会话是否已处理首页） + `document.referrer`（是否站内导航） → 判定 → `location.replace('/play')`。

## 目录结构
```
apps/web/
├── app/
│   └── page.tsx                                   # [MODIFY] 首页 Server Component。在最外层返回片段的首个节点插入
│                                                  #   <script dangerouslySetInnerHTML={{ __html: homeAutoEnterScript() }} />，
│                                                  #   不加 async/defer，不改成客户端组件，其余结构不变。
├── lib/
│   ├── auto-enter.ts                              # [NEW] 自动进园收口。导出 HOME_VISITED_KEY = 'niuma:home-visited:v1'
│   │                                              #   与 homeAutoEnterScript(): string。脚本为自包含 IIFE，按「会话标记 →
│   │                                              #   存档存在 → JSON 校验 → 同源 referrer → location.replace」顺序判定，
│   │                                              #   全程 try/catch，异常一律不跳。不得 import profile.ts。
│   └── __tests__/
│       └── auto-enter.test.ts                     # [NEW] bun:test 单测。用 new Function 注入 fake window/document/location，
│                                                  #   覆盖：首次+有存档+空来源跳转、无存档不跳、同源来源不跳、
│                                                  #   跨域来源跳转、已标记不跳、坏 JSON 不跳、localStorage 抛错不跳，
│                                                  #   并断言脚本包含 PROFILE_KEY 常量。
docs/adr/
└── 0038-home-auto-enter.md                        # [NEW] 决策记录。按现有 ADR 格式写背景、决策（三层守卫与 replace 语义）、
                                                   #   替代方案（middleware+cookie、useEffect 跳转）及后果，状态「已采纳」。
README.md                                          # [MODIFY] 在「核心约束」段落补一句：有本地存档时重新打开域名跳过首页直达园区，
                                                   #   站内导航回首页仍正常展示。
```

## 关键代码结构
```ts
// apps/web/lib/auto-enter.ts —— 唯一对外契约
export const HOME_VISITED_KEY = 'niuma:home-visited:v1';

/** 生成可直接注入 <script> 的自包含 IIFE 源码（不引用模块作用域） */
export function homeAutoEnterScript(): string;
```

```ts
// 测试如何真实执行脚本（无 jsdom）
const runScript = new Function('window', 'document', 'location', homeAutoEnterScript());
runScript(fakeWindow, fakeDocument, fakeLocation);
```


## Agent Extensions
### Skill
- **vercel-react-best-practices**
  - Purpose: 校验在 Server Component 中直接输出内联同步脚本不会把首页变成客户端组件、不引入额外客户端 bundle，也不影响静态预渲染与 FCP。
  - Expected outcome: 确认注入口径为 `dangerouslySetInnerHTML` + 无 async/defer，首页仍为静态预渲染，脚本零网络请求。
