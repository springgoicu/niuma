---
name: boss-arena-to-south-yard
overview: 把发泄区（橡胶垫 + 一万血老板）从南侧空地整体迁进研发园（`SOUTH_YARD` 南侧休息庭院）铺装中央：迁移坐标常量、腾挪研发园中央长椅、改两处导览到达点，并同步测试断言与 ADR/README/版本工报。
todos:
  - id: move-boss-constants
    content: 迁移 BOSS_ARENA 与 BOSS 到研发园坐标，更新 boss.ts 位置注释
    status: completed
  - id: reflow-south-yard
    content: 挪研发园中央长椅到东侧，改 southYard 导览点与区域/禁树注释
    status: completed
    dependencies:
      - move-boss-constants
  - id: update-geometry-tests
    content: 用 [skill:test-driven-development] 改写 boss-layout 与 nav-arrival 断言并跑 shared-types 全量
    status: completed
    dependencies:
      - reflow-south-yard
  - id: verify-runtime-tests
    content: 回归 web 寻路/导览/座位/typecheck 与服务端 vent 测试，确认渲染自动跟随
    status: completed
    dependencies:
      - update-geometry-tests
  - id: update-docs-changelog
    content: 更新 ADR 变更记录、README 与版本工报，跑 [skill:verification-before-completion] changelog 校验
    status: completed
    dependencies:
      - verify-runtime-tests
---

## 需求概述
把现有「打老板」玩法（发泄区橡胶垫 + 一万血老板）从当前南侧空地整体**搬进研发园**（`SOUTH_YARD`，校园南侧的休息庭院），不保留第二处、不做多实例血量。

## 目标效果
- 从南向主路走进研发园北门，正对庭院中央 420×320 橡胶垫，200×256 老板背对入口站在垫上，血条、木牌、倒下灰化与「老板倒下」纸板的表现不变。
- 研发园原有灯柱、绿篱、野餐桌、单车、垃圾桶保留；中央那张长椅让位，移到东侧花境旁。
- 站上垫子状态栏显示「发泄区」，垫外仍是「研发园」；导览卡「研发园」指向西侧休息区，「发泄区」指向垫内左下角，两行都能一键走到。
- 原发泄区空出来恢复为普通草地。

## 核心功能
- 坐标迁移后，脚底碰撞、受击区、扇形判定、命中扣 1 点、每日 10000 血与跨零点回满全部沿用。
- 服务端单例血量、`S2C_BOSS` 广播、入场补发、倒下提示与音效不迁移、不重写。
- 研发园内家具只改坐标不增删，长椅 seatId 顺序保持稳定。
- 相关几何断言、导览可达性、版本工报与文档同步更新。

## 技术栈
沿用现有栈：TypeScript（shared-types 单一坐标真相）+ PixiJS 客户端烘焙 + Bun 服务端。无新增依赖、无协议变更、无新美术资源。

## 实施方案
1. **单一真相迁移**：只改 `packages/shared-types/src/world/boss.ts` 的 `BOSS_ARENA` 与 `BOSS`，`BOSS_SOLID`、`BOSS_HIT_RECT`、`bossHitPoint`、`isInBossArena` 全部由常量派生，自动跟随；`apps/web/lib/game/boss.ts`、`boss-art.ts`、服务端 `BossRuntime`、`vent.ts` 与协议层零改动。
2. **落点**：`BOSS_ARENA { x: 3900, y: 5300, w: 420, h: 320 }`，位于研发园铺装中央偏西，距铺装四边 140 / 60 / 524 / 496；`BOSS { x: 4110, y: 5580, width: 200, height: 256 }`，脚底距垫底 40、头顶距垫顶 24，复刻旧垫的站位比例。
3. **家具让位**：`SOUTH_YARD_PROPS` 中央长椅 `(4096,5480)` 移到东侧花境旁 `(4620,5420)`。只改坐标、不删数组项——`BENCH_SEATS` 按 bench 数组顺序派生 seatId，删项会整体前移，破坏 `localStorage` 里的既有座位号。
4. **导览**：`NAV_ARRIVALS.southYard` 由 `(4200,5300)`（新垫北沿）改为西侧休息区 `(3600,5480)`；`bossArena` 公式 `(BOSS_ARENA.x+50, BOSS_ARENA.y+h-20)` 自动变为 `(3950,5600)`，距脚底碰撞左 80、南 20。
5. **区域名**：`REGIONS` 中「发泄区」仍排在「研发园」之前，垫上命中「发泄区」、垫外落到「研发园」，无需改顺序。
6. **测试**：改写 `boss-layout.test.ts` 里旧位置的两条硬数字断言（`BOSS_ARENA.y-4716=84`、`5160-(y+h)=40` 已失效），换成「垫四角落在 `SOUTH_YARD_PAVING` 内且四边余量 ≥40」；其余「不长树、不压 props/solids/paths/lakes」循环断言保留，用它们反向验证新落点。
7. **文档**：`ADR-0070` 只在文末追加「变更记录」说明迁址，不改写历史决策正文；README 改发泄区坐标描述与研发园段落；`release-notes` 新增 `2026-11-13-15`。

## 性能与可靠性
- 纯静态坐标变更，运行时复杂度不变：客户端烘焙尺寸与绘制调用数不变，服务端仍为单例 O(1) 扣血，广播包不变。
- 风险点：旧发泄区从「禁树区」移除后，确定性树生成可能在该空地上长出新树，改变树集合；属预期，需跑树间隙与密度测试确认无回归。
- 回滚路径：只需把两处坐标常量与长椅、`southYard` 到达点改回，无数据迁移、无协议兼容成本。

## 执行注意
- 垫内不得出现任何 `props` 锚点、不得与任何 `solid` 重叠、四角不得落进 `path` 多边形——先把长椅挪走再改常量，否则几何测试必红。
- 不要为「研发园」新增第二块垫或第二个 Boss 实例：血量是进程内单例。
- 渲染端与协议端不做无关重构；`layer-pixel-art`、Pixi 视图、`S2C_BOSS` 均无需触碰。

## 目录结构

```text
packages/shared-types/src/
├── world/
│   ├── boss.ts                  # [MODIFY] BOSS_ARENA 改为研发园铺装中央 {3900,5300,420,320}；BOSS 改为 {4110,5580,200,256}；顶部注释从「南侧空地」改为研发园庭院；BOSS_SOLID/BOSS_HIT_RECT 保持派生
│   ├── campus.ts                # [MODIFY] SOUTH_YARD 注释补「中央为发泄区」；SOUTH_YARD_PROPS 中央长椅 (4096,5480) 移到 (4620,5420)，仅改坐标
│   └── layout.ts                # [MODIFY] NAV_ARRIVALS.southYard 改为 (3600,5480) 并更新注释；REGIONS 发泄区注释改为「垫子优先于研发园」；isPlantable 注释说明旧空地恢复可种树
└── __tests__/
    ├── boss-layout.test.ts      # [MODIFY] 删旧位置硬数字断言；新增垫四角落在 SOUTH_YARD_PAVING 内、四边余量 ≥40、老板身体不压家具锚点、regionAt 仍为「发泄区」
    └── nav-arrival.test.ts      # [MODIFY] 补「bossArena 到达点落在研发园铺装内、可站立」断言，数量仍 12

apps/web/data/release-notes.json # [MODIFY] 新增 2026-11-13-15：发泄区搬进研发园（玩家可感知结果）

docs/adr/0070-venting-boss-arena.md # [MODIFY] 文末追加「变更记录」：位置由南侧空地迁入研发园，其余决策不变

README.md                        # [MODIFY] 发泄区节坐标与「南侧空地」描述改为研发园；研发园段落补「中央发泄区、长椅东移」

apps/web/lib/game/boss.ts        # [UNCHANGED] 只读 BOSS_ARENA/BOSS，自动跟随
apps/game-server/src/sim/*.ts    # [UNCHANGED] 血量与判定全部派生自 shared-types
```

## 关键常量（实施后）

```ts
export const BOSS_ARENA: WorldRect = { x: 3900, y: 5300, w: 420, h: 320 };
export const BOSS = { x: 4110, y: 5580, width: 200, height: 256 } as const;
// 派生：BOSS_SOLID { 4030, 5536, 160, 44 }；BOSS_HIT_RECT { 4035, 5470, 150, 110 }
```

## 验证
- `pnpm --filter @niuma/shared-types test`（几何、导览、座位、树、密度、碰撞）
- `pnpm --filter @niuma/web exec bun test lib` 与 `pnpm --filter @niuma/web run typecheck`
- `pnpm --filter @niuma/game-server exec bun test src/sim/vent.test.ts`
- `pnpm changelog:check`

## Agent Extensions
### Skill
- **test-driven-development**
  - Purpose: 先把 `boss-layout` 的旧位置断言改成研发园断言并跑到红，再迁移常量与长椅，保证落点被几何契约约束。
  - Expected outcome: 新垫子在铺装内、不压家具/路径/湖泊、脚底可站，全套 shared-types 测试转绿。
- **verification-before-completion**
  - Purpose: 交付前逐条跑 shared-types、web、game-server 与 changelog 校验，用真实输出确认无回归。
  - Expected outcome: 五项命令全部通过，无类型错误、无失败用例。
