---
name: cleanup-invalid-files-and-stale-md
overview: 删除项目根目录 3 个 0 字节临时文件与 6 个过期性能优化草稿 md，并清理临时验证目录 .tmp-verify 及其多余的 git 跟踪（不改动 IDE 文件、构建缓存、node_modules 与 .codebuddy/plans）。
todos:
  - id: delete-temp-files
    content: 删除根目录 3 个 0 字节临时文件与 .tmp-verify 目录
    status: completed
  - id: delete-stale-md
    content: 删除根目录 6 个过期性能优化草稿 Markdown
    status: completed
  - id: guard-gitignore
    content: 在 .gitignore 追加 _tmp_* 与 .tmp-verify/ 忽略规则
    status: completed
    dependencies:
      - delete-temp-files
  - id: verify-cleanup
    content: 用 [skill:verification-before-completion] 复核引用并运行 typecheck 与测试
    status: completed
    dependencies:
      - delete-temp-files
      - delete-stale-md
      - guard-gitignore
---

## 用户需求
清理项目中的无效文件、缓存文件与无用 Markdown 文档，使仓库保持整洁，仅保留有效资产。

## 产品概述
本项目是 pnpm + Turborepo 的 2D 像素多人在线小游戏 Monorepo（`apps/web`、`apps/game-server`、`packages/shared-types`、`packages/pixel-assets`）。仓库根目录堆积了历史会话遗留的 0 字节临时文件、一次性验证产物，以及已完成的性能优化草稿文档，需要一次性清除。

## 核心功能
### 1. 删除无效文件
- 根目录 3 个 0 字节临时文件：`_tmp_23572_…`、`_tmp_28116_…`、`_tmp_30784_…`
- `.tmp-verify/` 整个目录：5 个一次性编译验证产物（`autotile.js`、`decals.js`、`seeded.js`、`terrain-edge.js`、`terrain-palette.js`）

### 2. 删除无用 Markdown（根目录 6 个草稿）
`plan.md`、`OPTIMIZATION_PLAN.md`、`P1_OPTIMIZATION_SUMMARY.md`、`P1_ACCEPTANCE_CRITERIA.md`、`BUBBLE_PROTECTION_IMPL.md`、`COMPLETION_CHECKLIST.md`，均为 2026-11-03 生成的 P1/P2 性能优化过程稿，结论已沉淀进 `docs/adr/`，全库零引用。

### 3. 明确不动的部分
- IDE：`niuma.iml`、`.idea/`
- 缓存与构建产物：`.turbo/`、`apps/web/.next/`、`tsconfig.tsbuildinfo`、`packages/pixel-assets/.proof/`、`node_modules/`
- 历史计划：`.codebuddy/plans/`（55 篇）
- 有效文档：`README.md`、`docs/adr/*`（45 篇）、`docs/deploy-multi-park.md`、`docs/promo.md`、`docs/moderation/lexicon.md`、`deploy/production/README.md`

### 4. 验收效果
根目录只保留工程配置、依赖清单与有效文档；`git status` 仅显示预期删除；`pnpm typecheck` 与 `pnpm test` 全部通过；开发与构建流程不受影响。


## 技术栈
沿用现有工程：pnpm 10 + Turborepo 2 + TypeScript 5，不引入任何新依赖或构建工具。

## 实施方案
### 策略
按"确认零引用 → 批量删除 → 回归验证"三步执行，全部通过 `git rm` 完成，保证工作区索引与磁盘一致，但不产生 commit。

### 关键决策
1. **只删零引用文件**：已在排除 `.git`/`node_modules`/`.next`/`.turbo` 后全库检索 `BUBBLE_PROTECTION_IMPL|COMPLETION_CHECKLIST|P1_ACCEPTANCE_CRITERIA|P1_OPTIMIZATION_SUMMARY|OPTIMIZATION_PLAN|tmp-verify|_tmp_|plan\.md`，命中 0 处，确认不会破坏 README 链接、package.json 脚本或构建链路。
2. **不碰 `node_modules` 与构建缓存**：`.next`/`.turbo` 可重建，但删除会明显拖慢下次 `pnpm dev`，且属用户明确保留范围。
3. **`.codebuddy/` 一律不动**：属工具项目数据目录，不是临时缓存。
4. **`.tmp-verify` 定性为无效文件**：内容是 `apps/web/lib/game/*.ts` 的一次性编译产物，无构建脚本引用，属历史验证残留。

### 风险与回滚
- 所有目标文件均已被 git 跟踪，可通过 `git restore --source=HEAD --staged --worktree <path>` 完整还原。
- 删除对象不参与 `tsc`/`next build`/`bun` 编译，影响范围仅限文档与孤立目录。

## 实施要点
- 删除前再执行一次引用检索，避免期间新增引用。
- 用 `git rm -r --quiet <paths>` 批量处理；若目录已被手工删除，用 `git rm -r --cached` 同步索引。
- `.gitignore` 追加 `_tmp_*` 与 `.tmp-verify/`，防止同类残留再次入库。
- 删除后用 `git status --porcelain` 核对变更清单，再运行 `pnpm typecheck && pnpm test` 作为回归证据。
- 不执行 `git commit`/`git push`，提交时机交由用户决定。

## 目录结构
```
niuma/
├── .gitignore                                     # [MODIFY] 追加 _tmp_* 与 .tmp-verify/ 规则
├── _tmp_23572_218982a04d15ce92cb133a8c50eec6cc    # [DELETE] 0 字节临时文件
├── _tmp_28116_f459b025817fafa1979d6fb13dc20682    # [DELETE] 0 字节临时文件
├── _tmp_30784_2cd871dc5bf302444d92b6065fa8ed9b    # [DELETE] 0 字节临时文件
├── .tmp-verify/                                   # [DELETE] 一次性编译验证产物目录
│   └── apps/web/lib/game/{autotile,decals,seeded,terrain-edge,terrain-palette}.js
├── plan.md                                        # [DELETE] 过期 P2 计划草稿
├── OPTIMIZATION_PLAN.md                           # [DELETE] 过期 P1 优化草稿
├── P1_OPTIMIZATION_SUMMARY.md                     # [DELETE] 已完成工作总结
├── P1_ACCEPTANCE_CRITERIA.md                      # [DELETE] 已过验收清单
├── BUBBLE_PROTECTION_IMPL.md                      # [DELETE] 已落地实现说明
├── COMPLETION_CHECKLIST.md                        # [DELETE] 已完成检查清单
├── README.md                                      # [KEEP] 项目主文档
├── niuma.iml / .idea/                             # [KEEP] IDE 配置
├── .turbo/ .next/ node_modules/                   # [KEEP] 缓存与依赖
└── .codebuddy/plans/                              # [KEEP] 历史计划数据
```


## Agent Extensions
### Skill
- **verification-before-completion**
  - Purpose: 在声明清理完成前，用可复核的证据（引用检索结果、`git status` 输出、`pnpm typecheck` 与 `pnpm test` 的实际输出）确认删除未破坏任何链路
  - Expected outcome: 得到"变更清单仅含预期删除 + 类型检查与测试全部通过"的明确证据，而非主观判断
