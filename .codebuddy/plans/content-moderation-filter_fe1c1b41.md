---
name: content-moderation-filter
overview: 为「牛马」增加同构内容审核层：昵称与聊天在客户端即时预校验、服务端权威拦截；政治类直接拒绝、污言秽语打码放行；内置词库随包发布，服务端可用环境变量指向外部文件覆盖。
todos:
  - id: moderation-core
    content: 用 [skill:test-driven-development] 与 [skill:codebase-design] 在 shared-types 实现 moderation 引擎：规范化映射、trie 匹配、分类裁决、打码，并补 vitest 单测
    status: completed
  - id: protocol-receipt
    content: 新增 S2C_CHAT_REJECTED(0x1a)、CHAT_REJECT_REASON 与编解码，补协议单测，客户端 net 层分发
    status: completed
    dependencies:
      - moderation-core
  - id: server-pipeline
    content: 服务端接入外部词库加载（覆盖/追加/回退/上限）与聊天、昵称审核及回执，补 bun:test 与词库自检脚本
    status: completed
    dependencies:
      - moderation-core
      - protocol-receipt
  - id: web-entry
    content: 用 [skill:impeccable] 统一 resolveProfileName 并接入 JoinGate、SaveBar、深链；ChatDock 提交前预检、打码发送、回执提示
    status: completed
    dependencies:
      - moderation-core
      - protocol-receipt
  - id: docs-adr
    content: 用 [skill:principal-software-architect] 写 ADR-0028 与 docs/moderation/lexicon.md，补 README 环境变量与内容审核小节
    status: completed
    dependencies:
      - moderation-core
      - server-pipeline
  - id: verify
    content: 用 [skill:impeccable] 验收界面状态，跑 typecheck 与全量测试，手工验证绕过样例与外部词库覆盖生效
    status: completed
    dependencies:
      - server-pipeline
      - web-entry
      - docs-adr
---

## 产品概述
给园区加一道「发言守门人」：玩家取工牌名、在园区频道说话时，系统先检查内容。触碰政治类红线的直接拦下，说脏话的自动打码后照常发出。

## 核心功能
- **工牌名校验**：入场页与捏人页保存时检查昵称。命中政治类则不允许上岗，就地提示换一个；命中污言秽语自动打码后允许进入。
- **聊天校验**：频道发言先过检。政治类不发出、不广播，并即时提示；污言秽语以 `*` 覆盖后正常广播给附近玩家。
- **双端同源**：客户端输入即提示，服务端复核兜底。伪造客户端也无法把违规内容送到别人屏幕上。
- **容错识别**：中间插空格、标点、零宽字符，全角半角混写、大小写混写、重复叠字、常见数字字母替代，都不能绕过。
- **词库可维护**：内置词库随版本发布；运维可用外部词表文件按类别覆盖或追加，改词不必重新构建前端。
- **无痕**：只做即时校验，不保存、不落盘任何发言内容。

## 视觉呈现
沿用现有像素风控件，只新增两处状态：工牌名输入框下方的琥珀色提示与红色边框（不可上岗时）；聊天输入框下方的单行提示（被拦下或已打码）。不新增弹窗、不引入新字体与配色。


## 技术栈
沿用现有栈，不引入任何新依赖：TypeScript 5 strict monorepo（pnpm + Turborepo）、`packages/shared-types` 同构契约、Bun WebSocket 服务端、Next.js 15 + React 19 客户端。单测沿用既有分工：`shared-types` 用 vitest，`game-server` 用 `bun:test`。

## 实现思路

### 1. 引擎放在共享契约里（唯一实现）
项目已有硬约束「客户端与服务端共用 `packages/shared-types`，不允许各自实现一份」。过滤引擎与内置词库因此落在 `packages/shared-types/src/moderation/`，客户端用它做即时预校验，服务端用它做权威裁决，行为天然一致。

对外只暴露一个深接口，调用方不感知规范化、trie 与打码细节：

```ts
export type ModerationCategory = 'political' | 'profanity';
export type ModerationVerdict = 'allow' | 'mask' | 'reject';

export interface ModerationResult {
  verdict: ModerationVerdict;
  /** 命中类别；allow 时为 null */
  category: ModerationCategory | null;
  /** mask 时为打码后的文本，其余情况等于入参 */
  text: string;
  /** 命中区间数，仅用于日志与统计，不携带命中内容 */
  hits: number;
}

/** 客户端与内置词库场景 */
export function inspectText(text: string): ModerationResult;
/** 服务端加载外部词库后构建独立实例 */
export function createModerationFilter(
  lexicon: Readonly<Record<ModerationCategory, readonly string[]>>,
): { inspect(text: string): ModerationResult };
```

### 2. 绕不过去的规范化（带原文下标映射）
`normalize.ts` 把输入压成一条审核用串，同时记录每个规范化字符对应的原文 `[start, end)`，保证命中后能精确回写打码：

1. 逐码点 `normalize('NFKC')`（全角转半角、兼容字形），一个原文码点展开成多个时共用同一原文区间；
2. 小写化；
3. 丢弃空白、标点、符号、零宽字符与不可见字符（`\p{P}` / `\p{S}` / `\u200b-\u200f` / `\ufeff` / `\u00ad` / 控制符）；
4. 折叠连续重复字符（「敏敏感感词」→「敏感词」）；
5. 折叠数字/字母替代（`0→o`、`1→l`、`3→e`、`4→a`、`5→s`、`7→t`）——只做拉丁与数字，形近汉字不入 v1，避免「日/曰」这类误杀；映射表单独一个常量，便于按线上误报调。

### 3. 匹配与裁决
`matcher.ts` 用一次构建的 trie 扫描规范化串，复杂度 `O(n · L)`（n ≤ 160 码点，L 为最长词条，建议上限 16），聊天每秒最坏 3 条、昵称每次输入 16 码点，量级在微秒，不进帧循环、不产生持续分配。命中区间合并后按**政治优先**裁决：任一政治命中即 `reject`（返回原文，调用方不发送）；否则脏话命中即 `mask`（每个被覆盖的原文码点替换为 `*`，未命中部分原样保留）。模块加载期构建 trie，运行时只走查。

### 4. 词库：内置 + 服务端外部覆盖
- `lexicon.ts` 导出两类内置表。**政治类只放中性占位条目**（如「示例敏感词甲」）并写明：正式词条必须由合规清单提供，仓库内条目仅供联调与自检；污言秽语放一小份通用起步词（约 10–20 条），文档标注可扩充。
- 服务端 `sim/moderation.ts` 在进程启动时读取 `GAME_MODERATION_LEXICON` 指向的 JSON：某类别写成数组即**替换**该类别内置表，写成 `{ "mode": "append", "words": [...] }` 即**追加**；文件里未出现的类别继续用内置。校验词条非空、去重、单条 ≤ 32 码点、总数 ≤ 20000；文件缺失或 JSON 非法时打印告警并退回内置，**不阻断启动**。启动日志只打类别条数与来源，不打词条。

### 5. 服务端拦截与回执
- `handleChat` 增加过滤器参数，顺序为：截断 → 非空 → 超长 → 限速窗口计数 → 审核 → 广播。政治命中时向发送者回 `S2C_CHAT_REJECTED`，不广播；脏话命中时广播打码后的文本（发送者自己看到的也是同一条回包，双端一致）；限速也回执，方便界面解释。被拦消息照常计入限速窗口，避免用被拦请求刷回执。
- 协议只增不改：`OpCode.S2C_CHAT_REJECTED = 0x1a`，载荷 `[op][reason u8]`，与既有 `S2C_QUEUE_REJECTED` 同构；新增 `CHAT_REJECT_REASON = { Political: 1, RateLimited: 2 }` 与 `CHAT_REJECT_BYTES = 2`。旧客户端落到既有 `switch` 的默认分支忽略该包。
- `handleHello` 兜底：服务端解码后再判一次昵称，政治命中改写成「无名牛马」、脏话命中改写为打码文本，只打印类别与命中数。

### 6. 客户端反馈
- `lib/profile.ts` 增加 `resolveProfileName(raw)`：`truncateName` → `inspectText` → 政治命中回退「无名牛马」，否则返回打码文本；`saveProfile` / `loadProfile` / 深链 `?name=` 全部走它，形成唯一入口。
- `JoinGate` / `SaveBar`：渲染期对 `truncateName(name.trim())` 预检，政治命中时输入框转琥珀色边框、下方给出「换个名字」提示、「上岗 / 保存并上岗」置灰；脏话命中时提示「提交后会自动打码」。
- `ChatDock`：`submit()` 先 `inspectText`。`reject` 时保留草稿、不发包、输入框下方出一行琥珀提示；`mask` 时发送打码文本并短暂提示「部分词已打码」；`allow` 直接发。提示随输入变化自动清除。
- 服务端回执映射到既有 `onHint`（其注释本就是「动作被拦下的瞬时提示」），由 `GameSession` 私有 `showHint` 下发 1.6s，不新增 store 字段、不新增组件。

### 7. 性能、可靠性与兼容
- 词表加载与 trie 构建只发生在模块导入 / 进程启动，请求路径只做有限状态走查。
- 词库外部化时客户端可能放行、服务端拒绝，这正是回执通道存在的理由；文案避免暴露具体词条。
- 不触碰零持久化约束：不写库、不落盘、日志不含原文。
- 内置政治表为空占位，默认行为与上线前一致（不误杀）；只有运维配置外部文件后才真正生效。

### 8. 已知限制（写进 ADR）
- `S2C_WELCOME` 不含昵称，服务端改写后本地角色卡仍显示原名；正常路径被客户端预检挡在门外，仅伪造包会触发，作为可接受降级记录。
- 形近汉字、拼音、谐音替换 v1 不覆盖，`FOLD_MAP` 留好扩展点。
- 打码用半角 `*`，中日韩字符打码后视觉变窄，属已知取舍。

## 目录结构

```
packages/shared-types/src/
├── moderation/
│   ├── types.ts            # [NEW] ModerationCategory / Verdict / Result 与原因常量
│   ├── normalize.ts        # [NEW] NFKC + 去噪 + 折叠 + 原文下标映射
│   ├── lexicon.ts          # [NEW] 内置词库（政治类仅中性占位）+ Lexicon 类型
│   ├── matcher.ts          # [NEW] trie 构建、区间合并、分类裁决、打码、createModerationFilter
│   └── index.ts            # [NEW] 对外导出 inspectText / createModerationFilter
├── __tests__/
│   ├── moderation.test.ts  # [NEW] 直出/夹字/全角/叠字/替代/打码区间/优先级/空输入
│   └── protocol.test.ts    # [MODIFY] 补 chat rejected 编解码往返
├── types.ts                # [MODIFY] OpCode 增 0x1a；CHAT_REJECT_REASON
├── constants.ts            # [MODIFY] CHAT_REJECT_BYTES = 2
├── protocol.ts             # [MODIFY] encode/decodeChatRejected
└── index.ts                # [MODIFY] export * from './moderation'

apps/game-server/
├── src/
│   ├── sim/moderation.ts   # [NEW] 外部词库加载、格式校验、覆盖/追加、失败回退、启动日志
│   ├── sim/chat.ts         # [MODIFY] handleChat 接入过滤器、回执、打码广播
│   ├── server.ts           # [MODIFY] 构建过滤器并注入；handleHello 昵称兜底
│   ├── config.ts           # [MODIFY] moderation.lexiconPath ← GAME_MODERATION_LEXICON
│   ├── moderation.test.ts  # [NEW] 覆盖/追加/非法 JSON 回退/上限校验
│   └── sim/chat.test.ts    # [NEW] 政治不广播 + 回执；脏话打码广播；限速
├── scripts/check-lexicon.ts# [NEW] 词库自检 CLI（条数、重复、超长、非法字符）
└── package.json            # [MODIFY] 增 lexicon:check 脚本

apps/web/
├── lib/profile.ts                    # [MODIFY] resolveProfileName 唯一入口
├── lib/net/client.ts                 # [MODIFY] onChatRejected 分发
├── lib/game/session.ts               # [MODIFY] 回执映射到 showHint
├── components/game/JoinGate.tsx      # [MODIFY] 昵称预检、禁用态、内联提示
├── components/creator/SaveBar.tsx    # [MODIFY] 同上
├── components/game/ChatDock.tsx      # [MODIFY] 提交前预检、打码发送、内联提示
└── components/game/GameViewport.tsx  # [MODIFY] 深链 name 走 resolveProfileName

docs/adr/0028-content-moderation.md   # [NEW] 背景/备选方案表/决策/后果/已知限制
docs/moderation/lexicon.md            # [NEW] 词库格式、维护流程、自检用法
README.md                             # [MODIFY] 环境变量表 + 内容审核小节
.env.example                          # [MODIFY] GAME_MODERATION_LEXICON 样例
```


## Agent Extensions
### Skill
- **test-driven-development**
  - Purpose: 先写规范化、匹配区间、打码、分类优先级的失败用例，再实现 `moderation` 引擎
  - Expected outcome: `moderation.test.ts` 覆盖直出、夹字、全角、叠字、数字替代与打码区间，且全绿
- **codebase-design**
  - Purpose: 把 `inspectText` / `createModerationFilter` 定成深模块接口，让调用方完全不感知 trie 与规范化细节
  - Expected outcome: 一个接口同时满足客户端预检与服务端外部词库注入，无需暴露内部类型
- **principal-software-architect**
  - Purpose: 按项目既有 ADR 格式产出 `0028-content-moderation.md`，给出至少两个备选方案与回滚路径
  - Expected outcome: 决策记录含权衡表、已知限制（welcome 不含昵称、形近字未覆盖）与 30 天回滚方式
- **impeccable**
  - Purpose: 让昵称与聊天两处新增状态贴合现有像素风控件，不引入新字体、新配色、新弹窗
  - Expected outcome: 复用 `text-amber-400` / `border-amber-400` 等既有 token，错误态与既有的「头顶截断」提示同一视觉语言
