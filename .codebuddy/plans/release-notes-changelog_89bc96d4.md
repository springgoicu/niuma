---
name: release-notes-changelog
overview: 新增持久化的版本更新记录（静态 JSON），约定 AI 每次提交前总结本次改动并写入，配套敏感信息与结构校验脚本；在首页技术底牌与工位守则之间新增「版本更新」区块，展示最新 3 条并可展开历史。
design:
  architecture:
    framework: react
  styleKeywords:
    - 像素工牌
    - 终端票据
    - 2px 硬边框
    - 暖褐墨色
    - 薄荷高亮
    - 克制动效
  fontSystem:
    fontFamily: Oswald / PingFang SC / JetBrains Mono
    heading:
      size: 40px
      weight: 700
    subheading:
      size: 20px
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
      - "#857463"
    functional:
      - "#F2C879"
      - "#6FB6C9"
      - "#CFE08A"
      - "#E06A5A"
todos:
  - id: release-notes-data
    content: 建立 release-notes.json 与 lib/release-notes.ts，含类型、容错、倒序、取最新与单元测试
    status: completed
  - id: changelog-validator
    content: 新增零依赖校验脚本，校验结构与敏感信息，接入 changelog:check 命令
    status: completed
    dependencies:
      - release-notes-data
  - id: changelog-ui
    content: 用 [skill:impeccable] 实现首页版本工报区块与折叠历史，接入页面、导航并顺延工位守则编号
    status: completed
    dependencies:
      - release-notes-data
  - id: commit-rule
    content: 新建 AGENTS.md 提交约定，更新 README，并写入首条版本记录
    status: completed
    dependencies:
      - release-notes-data
      - changelog-validator
  - id: verify-release-notes
    content: 运行 changelog:check、typecheck 与测试，检查桌面和移动端展示
    status: completed
    dependencies:
      - changelog-ui
      - changelog-validator
      - commit-rule
---

## 用户需求

在项目中新增一份持久化的版本更新记录，并让 AI 在每次提交前总结本次修改、写入一条面向玩家的更新内容；内容不得涉及敏感信息，最后在网站首页合适位置展示最新版本改了什么。

## 产品概述

园区首页在「技术底牌」与「工位守则」之间新增一块「版本工报」：直接展示最新 3 次更新，更早的记录可展开查看。更新记录随代码一起发布，不进入服务端存储，保持项目「服务端零持久化」的约束。

## 核心功能

- **持久化版本记录**：一份版本更新清单文件随仓库维护，最新条目在最前，包含日期、标题与若干条改动说明。
- **提交时 AI 总结**：项目规则约定每次提交前读取本次改动，用玩家能感知的中文描述写入条目；一条提交对应一条记录，最多 6 条改动说明。
- **敏感信息防护**：只写功能与行为变化，不写文件名、类名、环境变量、内网 IP / 域名、邮箱、密钥、绝对路径与个人信息；提供校验命令，格式或敏感内容不合格即报错。
- **首页展示**：新增「版本工报」区块，最新 3 条直接展开，历史记录折叠；同日多次提交以序号区分。
- **容错与空态**：数据缺失或条目字段不合法时跳过该条；完全没有记录时整块不渲染，不影响首页。


## 技术栈

- 沿用现有技术栈：Next.js 15 App Router + React 19 服务端组件 + TypeScript strict + Tailwind CSS v4。
- 数据以构建期静态 JSON 保存，通过 `resolveJsonModule` 直接 import；校验脚本使用 Node ESM 内置模块，不新增任何依赖。
- 不使用数据库、不写入运行时文件、不读 diff 原文，符合项目「服务端零持久化」约束。

## 实现方案

### 核心策略

`apps/web/data/release-notes.json` 作为唯一事实源，由 AI 在提交前维护；`lib/release-notes.ts` 负责解析、容错、倒序与取最新 N 条；首页用服务端组件直接渲染，历史折叠使用原生 `<details>`，不引入客户端状态与 JS。

### 关键决策与权衡

- **静态 JSON 而非数据库/运行时存储**：更新日志属于随版本发布的静态内容，构建期读取零运行时成本，也不破坏零持久化架构。代价是更新记录必须与代码同一次发布，符合「每次提交」的语义。
- **AI 手写而非 git hook 规则生成**：提交信息存在「提交代码」这类无效描述，规则引擎难以生成可读文案；由 AI 读暂存区 diff 归纳质量更高。代价是依赖 AI 参与提交，通过 `AGENTS.md` 固化流程降低遗漏。
- **只做记录过滤而非替换脱敏**：从生成端就只提取功能描述，天然不落 diff 原文；校验脚本作为最后一道闸门，命中明显敏感模式直接失败，避免「先写进去再替换」的泄漏窗口。
- **原生 `<details>` 而非客户端组件**：历史展开无需 React 状态，首屏零额外 JS，键盘与屏幕阅读器天然可用。

### 性能与可靠性

- JSON 体量上限 50 条、单条约 8 行，构建期 import，服务端渲染 O(n)，无运行时 I/O、无客户端包增量。
- 读取函数对未知字段、非法枚举、缺失日期做丢弃式容错，绝不抛错影响首页。
- 校验脚本线性扫描，命中即非零退出并打印条目序号与字段位置；成功时打印条目数与最新日期。
- 区块只在有有效条目时渲染，避免空数据产生空白版块。

### 可回滚性

删除 `page.tsx` 中的区块引用即可下线展示；JSON 与脚本可独立保留，不影响构建与游戏服务。

## 架构设计

数据流单向且无副作用：

```
release-notes.json → lib/release-notes.ts（解析/排序/截断） → ChangelogSection（RSC） → 首页
                                        ↑
                    scripts/check-release-notes.mjs（结构与敏感信息校验）
```

- **数据层**：`apps/web/data/release-notes.json`，只存展示型文案。
- **领域层**：`apps/web/lib/release-notes.ts`，纯函数、可单测，不依赖 React 与文件系统。
- **展示层**：`apps/web/components/site/Changelog.tsx`，服务端组件，只消费已解析数据。
- **工具层**：`apps/web/scripts/check-release-notes.mjs`，CI / 本地提交前校验。
- **流程层**：根 `AGENTS.md` 定义提交前更新与校验的约定。

## 数据结构

```ts
export type ReleaseNoteKind = 'feat' | 'fix' | 'perf' | 'ui' | 'docs' | 'chore';

export interface ReleaseNoteChange {
  kind: ReleaseNoteKind;
  text: string;
}

export interface ReleaseNoteEntry {
  id: string;        // 2026-11-12-1，日期 + 当日序号
  date: string;      // YYYY-MM-DD
  title: string;     // 一句话版本标题
  changes: ReleaseNoteChange[];
}
```

JSON 顶层为 `{ "entries": ReleaseNoteEntry[] }`，数组按日期倒序存放，最新在前。条目 id 唯一，日期必须为合法日历日期，`changes` 为 1 至 8 条。

## 实施要点

- `readReleaseNotes(raw: unknown)` 接收 `unknown` 并逐条校验，返回合法条目；`latestReleaseNotes(entries, count = 3)` 返回最新 N 条与其余历史。
- 同日多条时，展示日期后追加 `#2`、`#3`；序号从 id 末段解析，解析失败按 1 处理。
- 区块编号调整为 `// 03 · release notes`，`RulesSection` 顺延为 `// 04 · rules`；`NAV` 增加 `{ href: '#changelog', label: '版本更新' }`，移动端复用同一数组。
- 校验脚本检查：根结构、条目数量上限、id 唯一、日期合法且不倒序、标题长度、kind 枚举、文案长度与换行；敏感扫描覆盖四段 IPv4、`http(s)://` / `ws(s)://`、邮箱、常见密钥前缀（`sk-`、`ghp_`、`xoxb-` 等）、`password|secret|token|api_key` 的赋值形态、私钥头、Windows / Unix 绝对路径、`.internal|.local|.corp|.lan` 内网域名。
- 根 `package.json` 增加 `changelog:check`，转发到 `apps/web` 同名脚本；`build` 不强制依赖校验，避免部署被文案问题硬阻断。
- `AGENTS.md` 写明：提交前读暂存区 diff；一条提交一条记录；每条改动用玩家可感知的中文；禁止文件名、类名、路径、IP、域名、密钥与个人信息；纯内部改动合并为一条「内部整理」；写完执行 `pnpm changelog:check`；记录与代码同一次提交。
- 初始预填一条本次改动自身的记录，确保区块首次上线即可见。
- README 的「常用脚本」表补充 `pnpm changelog:check`，「目录」说明补充版本记录位置。

## 目录结构

```
niuma/
├── AGENTS.md                                      # [NEW] 项目协作规则：提交前更新版本记录、内容红线与校验命令
├── package.json                                   # [MODIFY] 新增 changelog:check 脚本入口
├── README.md                                      # [MODIFY] 常用脚本表与目录说明补充版本记录
└── apps/web/
    ├── data/
    │   └── release-notes.json                     # [NEW] 持久化版本记录，顶层 entries 倒序；预填首条记录
    ├── lib/
    │   ├── release-notes.ts                       # [NEW] 类型、unknown 解析容错、倒序、取最新 N 条、日期与序号格式化
    │   └── __tests__/
    │       └── release-notes.test.ts              # [NEW] bun:test 覆盖非法字段丢弃、排序、截断、同日序号
    ├── components/site/
    │   ├── Changelog.tsx                          # [NEW] 版本工报区块：最新 3 条 + details 折叠历史 + 空态返回 null
    │   ├── Sections.tsx                           # [MODIFY] RulesSection 编号 03 顺延为 04
    │   └── Chrome.tsx                             # [MODIFY] NAV 增加 #changelog 锚点
    ├── app/
    │   └── page.tsx                               # [MODIFY] 在 TechSection 与 RulesSection 之间插入 ChangelogSection
    ├── scripts/
    │   └── check-release-notes.mjs                # [NEW] 零依赖结构校验 + 敏感信息扫描，失败非零退出
    └── package.json                               # [MODIFY] 新增 changelog:check 脚本
```

## 验证方式

- `pnpm changelog:check`：合法数据通过；手工注入 IP、邮箱、密钥前缀时失败并定位到条目。
- `pnpm --filter @niuma/web typecheck`：strict 通过。
- `pnpm --filter @niuma/web test`：新增纯函数单测通过。
- 首页桌面与移动端检查：最新 3 条可见、历史可展开、无横向溢出、键盘可操作。



## 设计方向

这是现有暗色像素园区首页中的一块新内容，不重做视觉体系。延续暖褐墨色底、2px 硬边框、等宽小标签与克制的薄荷高亮，把版本记录做成「工牌票据 / 终端档案」的观感，而不是通用卡片列表。

## 区块布局

- 区块 id 为 `changelog`，上下沿用 `border-b-2 border-ink-700` 与 `py-20 lg:py-28` 的节奏。
- 桌面端两栏：左栏约 0.8 份，放 `// 03 · release notes`、标题「这版又改了什么」、一段说明与「最新版本」印章；右栏 1.2 份为版本票据列表。移动端单列，标题在前。
- 右栏用有序列表承载版本，每条是一张 `panel` 票据：顶部一行日期、序号与「最新」印章，下面是一句话标题，再往下是 kind 标签加中文改动说明。
- 最新一条给 `border-mint-400/60` 与左侧 2px 薄荷竖线；历史条目边框降为 `ink-600`，悬停时边框转薄荷。
- 超过 3 条时，在列表底部放原生 `<details>`，summary 用等宽小字显示「展开更早的 N 个版本」，箭头用 CSS 旋转，展开后同样式续排。

## 视觉与动效

- kind 标签沿用 `tag` 的等宽小字与 2px 边框：feat 薄荷、fix 琥珀、perf 天蓝、ui 青柠、docs / chore 灰褐；同一条内标签宽度自适应，不撑破行。
- 日期与编号用 JetBrains Mono，标题用 Oswald，正文用 PingFang SC；正文行高 1.7，保持可读。
- 交互只做 150ms 的边框与颜色过渡，不做位移、弹跳或渐变扫光；焦点沿用全局 `:focus-visible` 薄荷描边。
- 空数据时整块返回 null；单条字段缺失时由数据层丢弃，不出现「undefined」占位。

## 响应式与可访问性

- 移动端日期与标签允许换行，标签不压缩正文；窄屏隐藏左侧装饰线，避免挤压。
- 版本列表使用 `<ol>`，日期使用 `<time dateTime>`，印章文字对屏幕阅读器可读；`details` 的 summary 保留原生键盘行为。
- 正文对比度不低于 AA：mist-300 用于说明，mist-100 用于标题，强调色只用于标签与边框。


## Agent Extensions

### Skill

- **impeccable**
  - Purpose: 在实现首页版本工报区块前加载项目视觉上下文，按现有设计世界完成版式、层级、响应式与细节打磨。
  - Expected outcome: 新块与现有首页风格一致，桌面与移动端无溢出，焦点态与折叠交互可用，细节达到可发布水准。
