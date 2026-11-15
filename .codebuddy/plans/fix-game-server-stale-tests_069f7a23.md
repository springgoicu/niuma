---
name: fix-game-server-stale-tests
overview: 修正 game-server 中 8 条过时测试断言（擂台已改为红蓝 1v1、P2P 奖池抽 5% 税），并清理相关旧注释，使 pnpm test / typecheck 全绿、CI 可正常部署；顺带追加版本工报并提交。
todos:
  - id: fix-ring-tests
    content: 改写 ring.test.ts 五条用例为 1v1 口径：第三人 full、名次前二、台阶传送、快照 2 人
    status: completed
  - id: fix-bus-tests
    content: 改写 bus.test.ts 两条用例：税后派彩 118，用 duelPort.hit 打死对手，掉线判负同样 118
    status: completed
  - id: clean-ring-comments
    content: 清理 sim/ring.ts 中「三人擂台」「第 3 人补入」「≤3 个成员」过时注释，不动逻辑
    status: completed
  - id: verify-tests
    content: 运行 game-server 测试与 pnpm typecheck、pnpm test，确认 331 pass 且 4/4 全绿
    status: completed
    dependencies:
      - fix-ring-tests
      - fix-bus-tests
      - clean-ring-comments
  - id: verify-startup
    content: 用 bun 打包 game-server 单文件并以临时端口启动，curl /health 探活通过后关闭
    status: completed
    dependencies:
      - verify-tests
  - id: changelog-commit
    content: 在 release-notes.json 追加「内部整理」记录，跑 pnpm changelog:check 后 git commit
    status: completed
    dependencies:
      - verify-startup
---

## 用户需求
CI/CD（Jenkins）部署在质量门禁阶段失败：`@niuma/web` 测试通过，但 `@niuma/game-server#test` 退出码 1，导致后续构建、pm2 启动、探活全未执行。要求排查所有问题，保证部署可以正常跑通并正常启动。

## 产品概述
不改玩法、不改视觉。目标是把「部署第一道硬门槛」修绿：`pnpm typecheck` 已经全绿，唯一的红灯是 game-server 里 8 条跟不上新规则的旧断言（擂台已从三人局改为红蓝 1v1，P2P 奖池改为抽 5% 园区税）。按已确认口径：以实现为准修测试，保留 1v1 与 5% 税；改完追加版本工报并提交。

## 核心功能
- 修正擂台相关 5 条旧用例：容量为 2，第三人报名一律 `full`；名次只取前二并传送到对应台阶；快照最多 2 人，`remainingMs` 照常递减。
- 修正 P2P 经济 2 条旧用例：奖池按 95% 派彩（双方各押 20 时赢家 80→118），切磋靠剩余血量决胜、不挨打即平局退款。
- 清理运行时代码中与新规则矛盾的「三人擂台」注释，避免下一个人继续按旧口径写代码。
- 验证链路走通：`typecheck`、game-server 测试、全量 `test`、单文件打包与实际启动探活。
- 追加一条版本工报并通过 `changelog:check`，与代码同一次提交。


## 技术栈
- 运行时与测试：Bun 1.4.4（`bun test`，来自根 `devDependencies` 的 `node_modules/.bin/bun`）+ TypeScript 5.7
- 仓库形态：pnpm 10.33 workspace + Turborepo（`turbo run typecheck / test / build`）
- 部署门禁：`deploy/jenkins-deploy.sh` → `pnpm install --frozen-lockfile` → `pnpm run typecheck` → `pnpm run test` → `pnpm run build` + `bun build src/index.ts --target=bun` → pm2 + `/health` 探活

## 根因（已复现并在源码核实）
`pnpm test` 本地结果与 Jenkins 完全一致：4 个任务里 `@niuma/game-server#test` 唯一失败，`bun test` 报 `323 pass / 8 fail`；`pnpm typecheck` 4/4 成功，说明只有测试断言过时，不是编译或启动问题。

提交 `a482ef9` 把擂台改成红蓝 1v1 并接入押注与 5% 税，但两个测试文件没跟着改：

| 契约（现状、正确） | 旧断言（错误） |
|---|---|
| `RING_CAPACITY = 2`，`RING_START_SLOTS` 只有 2 个，`protocol.ts` 的 `encodeRing` 超 2 人直接抛错 | 期望第 3 人可中途补入、快照 3 人、三名次上台 |
| `RING_SIDE = { Red: 0, Blue: 1 }`，先报名红方 | 期望「三人局先倒一人不结束」 |
| `rankByHp`：血量降序 → 站立优先 → 先倒优先 → `enteredAt` 小优先 | 期望「同分站立者优先」（1v1 等血时该分支不可达） |
| `bus.payoutOf()` 按 `handler.payoutBps` 折 9500；`duel.payoutBps = 10000 - P2P_TAX_BPS` | 期望赢家拿满 40（120），实际 `floor(40*9500/10000)=38` → 118 |
| 切磋 100 HP、每下 12 伤害、`onTick` 到点按剩余血量裁决、同分判平退款 | 注释「random 固定偏向 a 赢」已失效，不挨打即平局退全款 → 100 |

## 实现方案
策略：**以运行时代码与线协议为唯一契约，逐条把旧用例改写成 1v1 等价语义（不删除覆盖），并同步修正运行时的过时注释；不触碰任何生产逻辑、共享常量、协议编码与 ADR。** 这样只让「测试文件 + 注释」产生 blast radius，零玩法与性能影响。

### 改写清单（apps/game-server/src/sim/ring.test.ts）
1. 「第 3 人可在倒计时中途补入」→ 改为「开赛后第三人报名被判满员」：`enter(p0)`、`enter(p1)` 后断言 `canEnter(p2) === { ok: false, reason: 'full' }`、`enter(p2, T0+30000)` 同样返回 `full`、`ring.count === 2`、快照 `slot` 为 `[0, 1]`（注意 `canEnter` 判定顺序为 already → award → full → far，`full` 早于 `far`，所以不必移动玩家）。
2. 「满员、重复与远处都拒绝报名」：保留先把 `far` 放在无人进场前验证的写法，删掉第 3 次 `enter`，改成两人进场后断言 `p2` 为 `full`、`p0` 为 `already`。
3. 「三人局先倒一人不结束」→ 改为「一方倒下立刻结算名次」：两人才进场，`p0` 连打 `p1` 10 下打空（`RING_DAMAGE=1`、`RING_MAX_HP=10`），`tick` 后断言 `phase === Award`、`rank(p0)=1`、`rank(p1)=2`、`p1` 被传送到 `RING_PODIUM_SLOTS[1]`。
4. 「按剩余血量排前三」→ 改为「按剩余血量排前二」：`p0` 满血 10、`p1` 挨 1 下 9，`tick(ring.endsAt)` 后断言名次 1/2，并逐个校验坐标等于 `RING_PODIUM_SLOTS[rank-1]`。
5. 「同分时站立者优先，其次先入场者优先」→ 改为「同分时先入场者优先」：先 `enter(players[1], T0)` 再 `enter(players[0], T0+1000)`，双方各挨 1 下（都 9 血），`enteredAt` 小的 `players[1]` 取第一。
6. 「擂台快照 / running 下 remainingMs」：删除第 3 次 `enter`，把断言改为 `members` 长度为 2，其余 `remainingMs` 递减与结算清零断言保留。

### 改写清单（apps/game-server/src/challenge/bus.test.ts）
7. 「接受后冻结双方赌注，赢家拿走两份」→ 改名「赢家拿走税后奖池」：`respond(accept)` 后双方 80；用 `bus.duelPort.hit(a, b, now)` 连打 9 下（100 HP / 每下 12）打死 `b`，断言 `a.busyMatchId === 0`、`a.coins === 118`（80 + 38）、`b.coins === 80`，并把注释改为「切磋靠剩余血量决胜，奖池抽 5% 园区税」。不要再依赖 `tick(endsAt)`（同血即平局，会走全额退款拿回 100）。
8. 「对局中掉线按对手获胜结算」：期望值从 120 改为 118，`a.coins === 80`，注释说明 5% 税。

### 注释修正（apps/game-server/src/sim/ring.ts，不改逻辑）
- 第 75 行「三人擂台状态机」→ 红蓝 1v1 状态机
- 第 125 行「第 3 人可在 running 中途补入」→ 满员即 `full`，开赛后不再补位
- 第 303–307 行「判定本身只扫 ≤3 个成员」→ 扫 ≤2 个成员
（`RING_PODIUM_SLOTS` 保留 3 个是历史遗留，1v1 只用前两个，不改共享常量以免影响前端与协议。）

## 验证方案
1. `pnpm --filter @niuma/game-server test`：目标 `331 pass / 0 fail`（原 323 + 8）。
2. `pnpm typecheck`：保持 4/4 成功。
3. `pnpm test`：目标 `4 successful, 4 total`，与 Jenkins `Tasks` 口径一致。
4. 启动验证（等价复刻部署第 2、3 步）：`cd apps/game-server && bun build src/index.ts --target=bun --outfile=dist/index.mjs`，再用非占用端口 `GAME_SERVER_PORT=3999` 起 `bun dist/index.mjs` 并 `curl http://127.0.0.1:3999/health` 拿到 200 后关闭；如时间允许补跑 `pnpm build` 确认 Next 构建不因本次改动回退。
5. `pnpm changelog:check` 通过后提交。

## 性能与可靠性
本次只改测试与注释，生产路径零改动，无运行时开销变化。测试改写后仍保留原有覆盖维度（容量、距离、重复报名、提前结算、名次、台阶传送、快照倒计时、押注托管、掉线判负），只是对齐到 1v1 口径。

