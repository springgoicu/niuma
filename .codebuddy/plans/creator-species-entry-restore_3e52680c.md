---
name: creator-species-entry-restore
overview: 让入口显式选择的物种（牛/马）一路带到捏人页：/create 支持 ?species= 深链、首页物种卡片与入职登记「先去捏人」带上当前选择、捏人页按「URL 参数 > 本地存档 > 上次显式选择 > 牛」的优先级落库，并补单元测试覆盖这条链路。
todos:
  - id: seed-module
    content: 用 [skill:codebase-design] 定义 creator-seed 纯模块接口，并用 [skill:test-driven-development] 先写单测
    status: completed
  - id: create-param
    content: 改造 /create 解析 species 参数，CreatorShell 用 seed 初始化 store
    status: completed
    dependencies:
      - seed-module
  - id: entry-links
    content: 首页物种卡片、入职登记、选园返回链接统一携带 species 参数并恢复初始物种
    status: completed
    dependencies:
      - create-param
  - id: species-memory
    content: profile.ts 增加物种记忆键读写，CreatorShell 订阅落盘并补测试
    status: completed
    dependencies:
      - create-param
  - id: verify
    content: 运行 bun test lib 与 pnpm typecheck，手工回归四条进入链路
    status: completed
    dependencies:
      - entry-links
      - species-memory
---

## 用户需求
- 现象：在入口处选择「马」，进入捏人页却仍显示「牛」；再次进入时，之前的选择丢失。
- 排查范围（已确认）：入口传参链路与存档恢复链路一并修复，不局限于单点。

## 产品概述
捏人工作台必须忠实继承用户在入口处做出的物种选择；已保存的工牌外观（含物种）在回访时应原样还原；未保存但明确选过的物种，也不应在再次进入时被重置为牛。视觉样式与交互结构保持不变。

## 核心功能
- 入口携带物种：`/create` 支持 `species` 参数；首页两张物种卡片（「以马的身份入职」「以牛的身份入职」）与游戏内入职登记的「先去捏人」都按当前选择传参。
- 捏人页按优先级落库：URL 参数、本地存档、上次显式选择、牛；URL 与存档物种冲突时按切物种规则处理，并标记「草稿未保存」。
- 记忆上次在捏人页出现过的物种（仅物种，不含其余草稿），无存档时作为兜底；入职登记页的初始物种也随之恢复。
- 不改整份草稿的自动保存语义，不动线协议、服务端与任何视觉表现。

## 技术栈
- 框架：Next.js 15 App Router（Server Component + Client Component）、React 19、TypeScript strict。
- 状态：沿用 zustand 5 + subscribeWithSelector 的 `apps/web/lib/creator-store.ts`，不引入新状态库。
- 存储：复用 `apps/web/lib/storage.ts` 收口（`browserStorage` / `readJson` / `writeJson`），localStorage 键沿用 `niuma:` 前缀。
- 校验：`bun:test`（apps/web 的 `test` 脚本为 `bun test lib`）+ 根目录 `pnpm typecheck`（turbo）。

## 实现思路
1. 新增纯模块 `apps/web/lib/creator-seed.ts`，仿 `lib/park.ts` 的「服务端也能 import」约定：不带 `'use client'`、不碰 window，只用 `import type` 引 `Profile`。职责只有三件事：解析物种参数、切物种外观、按优先级合成 seed。
2. `/create` 改为 async Server Component，await `searchParams` 解析 `species`，把 `initialSpecies` 传给 `CreatorShell`，与 `/play` 现有做法一致（客户端不读 `window.location`）。
3. `CreatorShell` 挂载时一次性 `loadProfile()` + `loadCreatorSpecies()` + `resolveCreatorSeed()`，用 `hydrate(seed)` 写入 store；`hydrate` 改为接收 seed（当前唯一调用方）。
4. `lib/profile.ts`（已带存储收口）新增物种记忆键读写；`CreatorShell` 在 seed 落库后写入一次，并订阅 `appearance.species` 变化持续落盘。
5. 入口链接统一带 `?species=`；`JoinGate` 初始物种从记忆键恢复；`GameViewport` 深链解析复用同一把尺子。

## 关键决策与权衡
- **服务端解析优于客户端读 location**：与 `/play` 的既有约定一致，参数可单测；代价是 `/create` 由静态转为按请求渲染。该页只是客户端工作台的空壳，无数据 I/O，代价可接受。
- **优先级只实现一次**：`requested ?? 存档物种 ?? 记忆键 ?? 'cow'`；仅当最终物种与存档物种不同才 `dirty=true`（顶部显示「草稿未保存」）。
- **切物种复用现有语义**：抽 `switchSpeciesAppearance(appearance, species)`，`setSpecies` 与 seed 共用；保留 11 个色槽、其余取新物种默认值，避免「URL 切物种」与「页内点物种」两套观感。
- **只记物种、不做整份草稿自动保存**：不改变「草稿未保存 / 已同步到本地」的既有语义与 ADR 约定，改动面最小。
- **副作用位置**：存储读写在客户端 effect 内（SSR 不碰 localStorage）；store action 保持纯函数，落盘由 `CreatorShell` 订阅完成（与 `PreviewStage` 的 subscribe 模式一致）。

## 实现注意
- 服务端页面只能 import `creator-seed` 的纯函数；不得从带 `'use client'` 的 `profile.ts` 取运行期值，否则 RSC 会拿到 client reference。
- `CreatorShell` 用 `useState(initialSpecies)` 在挂载时冻结入口参数，effect 依赖稳定，避免同页内 searchParams 变化触发二次 hydrate 冲掉用户编辑。
- 记忆键值只接受 `'cow' | 'horse'`，坏数据/隐私模式/配额满一律当没有；键名集中定义，避免散落。
- 不改 `SaveBar`、`PreviewStage`、`NamePlate`、`ColorConsole` 结构与样式；不改 `niuma:profile:v2` 的既有字段与协议。
- `GameViewport` 的深链解析替换为 `parseSpeciesParam`，保证「服务端认、客户端也认」同一套合法值。

## 架构设计
请求链路：入口链接 → `/create`（Server Component 解析 species）→ `CreatorShell`（seed 合成）→ `creator-store` → `PartRail` / `PreviewStage`。

纯函数层 `creator-seed` 同时被 Server Component 与客户端组件调用，作为物种语义的唯一尺子；存储层仍由 `profile.ts` + `storage.ts` 收口，不新增分层。

## 目录结构
```
apps/web/
├── app/create/page.tsx                  # [MODIFY] 改 async，await searchParams，用 parseSpeciesParam 解析 species，传 initialSpecies 给 CreatorShell；保留 metadata；注释说明页面因此按请求渲染（与 /play 一致）
├── lib/creator-seed.ts                  # [NEW] 无 'use client' 纯模块。导出 parseSpeciesParam（string | string[] | undefined → Species | null）、switchSpeciesAppearance（保色切物种）、resolveCreatorSeed（profile/requested/remembered → seed）、CreatorSeed 类型
├── lib/creator-store.ts                 # [MODIFY] hydrate 改为接收 seed（name/appearance/dirty，忽略 status）；setSpecies 改用 switchSpeciesAppearance，与 seed 共用实现
├── lib/profile.ts                       # [MODIFY] 新增 CREATOR_SPECIES_KEY 与 loadCreatorSpecies / saveCreatorSpecies（复用 browserStorage/readJson/writeJson，注入 StorageLike 便于测试）
├── components/creator/CreatorShell.tsx  # [MODIFY] 新增 initialSpecies prop；挂载时合成 seed 并 hydrate，写入一次记忆键；订阅 appearance.species 落盘；hydrated 标记保持现有防闪烁逻辑
├── components/site/Sections.tsx         # [MODIFY] 物种卡片链接改为 /create?species=物种键
├── components/game/JoinGate.tsx         # [MODIFY] 「先去捏人」带当前所选物种；挂载时若有记忆键则用它作为初始物种
├── components/game/GameViewport.tsx     # [MODIFY] 深链 species 解析改用 parseSpeciesParam，替换手写三元判断
├── components/park/ParkPicker.tsx       # [MODIFY] 非 fromPlay 的 backHref 在已有 profile 时带上存档物种
├── lib/__tests__/creator-seed.test.ts   # [NEW] 覆盖参数解析、优先级矩阵、保色切物种、dirty 判定、非法输入
├── lib/__tests__/profile.test.ts        # [MODIFY] 补记忆键读写、坏值、存储不可用用例
README.md                                # [MODIFY] 深链说明补一行 /create?species=horse
```

## 关键结构
```ts
export interface CreatorSeed {
  name: string;
  appearance: CharacterAppearance;
  status: string;
  dirty: boolean;
}

export function parseSpeciesParam(raw: string | string[] | null | undefined): Species | null;
export function switchSpeciesAppearance(appearance: CharacterAppearance, species: Species): CharacterAppearance;
export function resolveCreatorSeed(
  profile: Profile | null,
  requested: Species | null,
  remembered: Species | null,
): CreatorSeed;
```

## Agent Extensions
### Skill
- **codebase-design**
  - Purpose: 用深模块词汇定义 `creator-seed` 的接口与 seam，确保解析、切物种、优先级只暴露一个入口，调用方不感知存储细节。
  - Expected outcome: `creator-seed` 仅暴露三个纯函数与一个 seed 类型，`setSpecies` 与页面初始化共用同一实现。
- **test-driven-development**
  - Purpose: 先写 `creator-seed` 与物种记忆键的单测，再补实现，锁定优先级与 dirty 行为。
  - Expected outcome: `bun test lib` 全绿，优先级矩阵与坏数据分支均有断言。
