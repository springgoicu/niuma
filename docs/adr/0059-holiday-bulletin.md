# ADR-0059：中央广场「牛马放假告示板」，世界空间跑马灯与本地黄历

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** 用户（需求与三个产品取舍授权）、客户端渲染、交互层、工牌系统
- **Tags:** world-layout, rendering, pure-client, zero-persistence, ui
- **Supersedes / superseded by:** 无；继续遵守 ADR-0004（零持久化）、ADR-0047（中央枢纽）、ADR-0049（渲染线程拆分）、ADR-0054（公告栏交互范式）

## Context

需求是在中央迎宾广场加一块常驻的「牛马放假告示板」：世界空间就能看到放假倒计时跑马灯，走近按 F 展开软木看板，里面有本周下班倒计时、最近三个法定假日、当日黄历，以及一个敲满 20 下解锁工牌成就的赛博木鱼。

现状约束：

1. **服务端零持久化**（ADR-0004）：状态只活在进程内存与浏览器 `localStorage`，不做账号、不做数据库。
2. **广场坐标已经排满**：圆心与出生点都是 `(4096, 4096)`，半径 360；北向主路 x=4096、半宽 56（通道 4040–4152）；西侧已有牛马榜公告栏 `(3960, 3832)`。用户给的推荐坐标 `(1900, 2020)` 在当前地图上落在海里（岛域 x 2146–5951 / y 1956–6168），不能直接采用。
3. **渲染在 Dedicated Worker**（ADR-0049）：世界空间文本只能用 Pixi `Text`，主线程的 React 状态进不去；反过来 Worker 也读不到 `localStorage`。
4. **既有范式**：`welcome.ts` 已证明「烘焙 Graphics + Pixi Text + 按脚底 y 进 SortLayer」可行；`props.ts` 的道具管线负责贴图复用、视锥裁剪与植栽避让。
5. 节假日没有任何服务端数据源，也不该由服务端决定：玩家在哪个时区，「今天」就是哪一天。

## Quality scenarios and invariants

```text
QUALITY | 一眼可见 | source: 玩家 | stimulus: 从出生点向北走 | environment: 广场中心 | artifact: 世界跑马灯 | response: 不打开弹窗就能看到倒计时在滚 | measure: 出生点静态画面内可读 = 是 | priority: 高
QUALITY | 通行不堵 | source: 玩家 | stimulus: 从出生点出北门 | environment: 任何时刻 | artifact: BULLETIN_BOARD_SOLID | response: 112px 主路保持通畅 | measure: x∈[4040,4152] 全段 isBlocked=false | priority: 高
QUALITY | 同服同黄历 | source: 两名玩家 | stimulus: 同一天打开看板 | environment: 不同时区/设备 | artifact: dailyAlmanac | response: 宜忌与评语完全一致 | measure: 同一日期键输出逐字相同 | priority: 高
QUALITY | 零网络 | source: 服务端 | stimulus: 玩家反复敲木鱼 / 开看板 | environment: 60 人在线 | artifact: 网络包 | response: 不新增任何上下行数据 | measure: 新增 opcode = 0；服务端 CPU 增量 = 0 | priority: 高
QUALITY | 输入法安全 | source: 中文输入法用户 | stimulus: 组合态按空格选词 | environment: 中文 IME | artifact: 木鱼 | response: 不触发敲击、不吃掉选词 | measure: 组合态 strike 次数 = 0 | priority: 高
QUALITY | 帧预算 | source: 渲染线程 | stimulus: 跑马灯常驻 | environment: 60fps | artifact: BulletinView.update | response: 每帧只写 x，文案每秒一次 | measure: 新增每帧分配 = 0；文本重排 ≤1Hz | priority: 中
```

不变量：

- 服务端不写盘、不接数据库、不新增协议；进程重启不影响任何功能。
- 世界坐标与碰撞只在 `BULLETIN_BOARD` / `BULLETIN_BOARD_SOLID` 定义一次，渲染、交互、测试全部派生。
- 底座只挡 80×20：牌面在头顶，玩家能从上方、左右贴近读跑马灯。
- 农历节日只认 2026–2028 对照表；表外年份显示「日期待更新」，不猜日期。
- 木鱼账本只写本机 `localStorage`，不参与排名、奖励、准入等任何权威判定。
- 主戳印 `getStampTitle` 的优先级一字不改；成就单独成区。

## Decision

采用 **纯客户端引擎 + 道具管线渲染 + 独立文本层 + 本地账本**：

1. **地标与碰撞（shared-types）**：`BULLETIN_BOARD = { x: 4232, y: 3832, width: 80, height: 48 }`（底边中心锚点），与西侧牛马榜同高、左右对称；`BULLETIN_BOARD_SOLID = { x: 4192, y: 3812, w: 80, h: 20 }` 只挡底座。牌面四角都在广场圆内，x 4192–4272 距主路东缘 40px，出生点距离约 300px。
2. **展板走道具管线**：`PropKind` 增加 `'bulletin'`，`PROP_SIZE.bulletin` 直接取 `BULLETIN_BOARD` 的宽高，`drawProp` 画双木柱、斜切木纹、软木板、铜钉、红布横幅。碰撞**不进** `PROP_FOOTPRINT`，而是在 `HUB_SOLIDS` 用 `BULLETIN_BOARD_SOLID` 单独登记——否则 80×48 与 80×20 会在两个包各存一份。
3. **文本独立成层**（`bulletin.ts`）：横幅中文与跑马灯要逐帧/逐秒变化，不能进烘焙纹理。`BulletinView` 构造期建 `Text`，按 `BULLETIN_BOARD.y + 1` 进 SortLayer；跑马灯是 92×12 的遮罩窗口，三句轮播（周五倒计时 → 春节 → 元旦）、每 6 秒一句，easeInOutCubic 从右滑到左，两端都在遮罩外，切换瞬间看不到跳变。每帧只写 `x`；文案每秒重算一次（`Date.now()`）。
4. **引擎纯函数**（`holiday-calendar.ts` + `local-date.ts`）：周一 09:00 → 周五 18:00 记 105 小时工时窗；周末态由「本周五窗口」与「上周五窗口」双判定（周一 00:00–09:00 仍算周末）。节假日池 = 元旦 / 劳动 / 国庆（固定日期）+ 春节 / 清明 / 端午 / 中秋（2026–2028 对照表），过滤过期、按时间升序取前 3。黄历按 `YYYY-MM-DD` 做 djb2，宜忌各抽 2 项且互不重复，评语取哈希高位。日期一律本地时区，禁用 `toISOString()`。
5. **交互最短链路**：`isNearBulletin`（64px）、`facesBulletin`（朝向点积 > 0.35）、`isBulletinHit`（牌面矩形）。环境提示要求「在范围内且面朝板面」；F 键与点击只判距离——站在板侧读字的人不该因为朝向差一格按不出面板。点击命中牌面但人在 64px 外时提示「走近一点再看」。跨线程只追加一条 `{ t: 'bulletinOpen' }`，纯 UI 事件，服务端零感知。
6. **弹窗与输入边界**：软木看板用木框 + 软木面 + 三张钉住的便签；打开时 `activeElement.blur()` 并聚焦面板，关闭后焦点还给 `[aria-label="游戏视口"] canvas`；Esc / 遮罩关闭；capture 阶段吞 `GAME_KEYS`；组合态（`isComposing` / `keyCode 229`）直接放行给输入法；空格长按不连击，焦点在按钮上时代理一次原生 `click()`。
7. **成就只在本机**：`niuma:almanac:v1 = { day, knocks, unlockedOn }`，当天第 20 下解锁「急急急放假人」，跨日清零计数但保留解锁。工牌 `BadgeArchive.achievements` 加一栏「已解锁成就」；他人档案恒为空数组，避免把本地状态冒充他人事实。

### 世界坐标

```text
BULLETIN_BOARD       x=4232  y=3832  w=80  h=48   （底边中心锚点）
BULLETIN_BOARD_SOLID x=4192  y=3812  w=80  h=20   （贴地底座）
北向主路通道          4040–4152（牌面东移 40px 让开）
牛马榜 rankBoard      x=3960  y=3832  w=128 h=96  （左右对称）
```

## Options considered

### Option A — 道具管线 + 独立文本层 + 纯前端引擎（chosen）

- Shape：`shared-types` 定坐标与碰撞 → `props.ts` 画板 → `bulletin.ts` 叠文本/跑马灯 → `holiday-calendar.ts` 算一切 → React 弹窗只做展示。
- Pros：贴图复用、裁剪、植栽避让全部免费；坐标单点；Worker 与主线程共用同一套纯函数；零协议、零请求。
- Cons：静态世界改动必须双端同版本（本次服务端无改动）；跑马灯在 Worker 里的 emoji 字形依赖系统字体；农历表只覆盖三年。
- Reverse cost：低。删掉 PropKind、`BulletinView`、弹窗与 `almanac-store`，撤回地标与底座碰撞即可，无数据迁移。

### Option B — 全部塞进 `welcome.ts`（rejected）

- Pros：不新增文件。
- Cons：`welcome.ts` 已经负责拱门 / 导览牌 / 牛马榜三块地标，再塞一块带动态文本的板子会变成第二个 `props.ts`；且拿不到道具管线的视锥裁剪与植栽避让。
- Reverse cost：低，但职责会持续膨胀。

### Option C — 把 80×20 底座写进 `PROP_FOOTPRINT`（rejected）

- Pros：碰撞自动从道具派生，少一行装配。
- Cons：`PROP_SIZE`（80×48）与 `PROP_FOOTPRINT`（80×20）会在两个包里各存一份尺寸；改牌面大小必须同时改两处，正是本仓库一直在避免的坐标分叉。
- Reverse cost：低；但错误成本高（碰撞与贴图错位）。

### Option D — 服务端下发节假日 / 黄历（rejected）

- Pros：一处计算，客户端零逻辑。
- Cons：推翻零持久化；服务端不知道玩家本地时区；节假日数据仍需外部来源；为一块看板引入请求与缓存不值得。
- Reverse cost：高（需要新的数据源与协议）。

### Option E — 引入农历库（rejected）

- Pros：支持任意年份。
- Cons：为一个装饰性倒计时增加依赖与体积；三年对照表已覆盖当前与下一次春节，表外年份诚实显示「待更新」。
- Reverse cost：低。

反向成本（不做 / 晚做）：广场北缘只有一块「牛马榜」，玩家想知道「还有几天放假」只能自己算；世界空间少了一处会动的信息锚点；工牌少了一枚可以炫耀的成就章。

## Consequences

### Positive

- 出生点抬头就能看到还在滚的倒计时，不需要打开任何面板。
- 所有日期计算集中在一个纯函数模块：Worker、React、测试三方同源，不会出现「跑马灯说 3 天、弹窗说 4 天」。
- 底座只挡 20px，广场通行与拍照位都不受影响；两块牌子左右对称，广场北缘有了成对的空间锚点。
- 敲木鱼完全离线：不发包、不进服务端，断网也能敲。

### Negative / risks

- 农历表外年份只能显示「日期待更新」；春节倒计时在 2029 年后会退化为占位文案，需要维护对照表。
- Worker 内的彩色 emoji 依赖系统字体：缺字形时会退化成单色或豆腐块，正文仍可读，但不保证三端一致。
- 静态世界内容需双端同版本发布；本次服务端无改动，风险仅限旧客户端看不到新地标。
- `localStorage` 可被玩家清空或手改，成就因此丢失/伪造；它只用于自嘲展示，不参与任何权威判定。
- 弹窗在 capture 阶段吞游戏键，屏读用户按空格时只会敲木鱼；按钮改用 Enter 激活。

### Neutral

- 牛马榜与放假告示板互不复用面板：一个是服务端聚合榜，一个是纯本地日历，共享的只有「模态 + 焦点」这套行为约定。
- 小地图不单独画告示板：它属于广场家具尺度，不改变地形判读。

## Revisit triggers

We will reopen this ADR if:

- [ ] 需要 2029 年及以后的春节 / 端午 / 中秋倒计时 → 补对照表或引入可信的农历数据源。
- [ ] 玩家反馈「看不到跑马灯」集中在某类设备 → 检查 Worker 字体栈或改为纹理化数字。
- [ ] 出现「公告板挡路 / 卡人」投诉 → 复核底座 20px 与 64px 感应区的关系。
- [ ] 成就需要跨设备同步 → 必须先推翻 ADR-0004，不能偷偷加账号。
- [ ] 弹窗需要承载真实公告文本 → 必须走审核与截断，不能复用纯本地黄历通道。

## Delivery and validation

- **First reversible slice**：`shared-types` 地标与底座碰撞 + 布局不变量测试 → 纯函数引擎与单测 → 道具贴图 → 世界文本层 → 交互链路 → 弹窗 → 成就。
- **Compatibility / migration**：世界坐标属静态内容，需前后端同版本；协议零改动（仅 Worker 内部追加一条 UI 消息）。无数据迁移。
- **Rollback**：撤回 `PropKind 'bulletin'`、`BulletinView`、`BulletinModal`、`almanac-store` 与地标/碰撞；30 天内可回滚。
- **Tests / fitness functions**：
  - `pnpm --filter @niuma/shared-types test`（263，含 `bulletin-board.test.ts` 6 条布局不变量）
  - `pnpm --filter @niuma/web test`（588，含引擎 21 条、跑马灯 5 条、账本 5 条、交互 4 条、弹窗静态渲染 4 条）
  - `pnpm typecheck`（4 包）
  - 手工：出生点向北看跑马灯 → 走近按 F → 秒级时钟 / 三张假日卡 / 宜忌 → 空格敲 20 下看成就 → Esc 后 WASD 立刻可走 → 中文输入法下空格选词不敲木鱼。
- **Security / reliability / data / ownership**：不新增持久化、不新增自由文本、不新增外部依赖、不新增网络包；本地账本带字段校验，坏数据整条丢弃；日期计算对 NaN / 非有限值全部返回安全默认。

## Baselines

```text
BASELINE | packages/shared-types（世界真相） | expected: 静态布局只做类型与常量，坐标单点，不依赖 Pixi/DOM | observed: BULLETIN_BOARD / BULLETIN_BOARD_SOLID 单点定义，props 由地标派生，底座在 HUB_SOLIDS 登记，PROP_FOOTPRINT 不复制尺寸 | fit: align | patterns: [P-Single-Source] | violations: [] | suggestion: 后续改牌面尺寸只动 BULLETIN_BOARD，再跑布局测试
BASELINE | apps/web/lib/game（纯计算） | expected: 日期与黄历不依赖 React/Pixi/store，本地时区，表外不猜 | observed: local-date + holiday-calendar 只有原生 Date；Worker 与 React 共用；表外年份 scheduled=false | fit: align | patterns: [G-Strategy] | violations: [] | suggestion: 2029 年补表时只改 LUNAR_TABLE，不动调用方
BASELINE | apps/web/lib/game（渲染层） | expected: 构造期烘焙，帧循环零分配，DPR 变化重建位图 | observed: 展板走 PropsView 贴图复用；BulletinView 每帧只写 x，每秒重算文案，setTextResolution/destroy 与 welcome 同范式 | fit: align | patterns: [G-Composite] | violations: [] | suggestion: emoji 缺字形时再考虑把符号换成绘制的像素图标
BASELINE | 弹窗 / 成就（apps/web） | expected: UI 不解析二进制、不碰世界坐标；本地存储带 guard；焦点可还 | observed: BulletinModal 只读纯函数结果；almanac-store 过 parseAlmanac；打开 blur、关闭还给 canvas；IME 组合态放行 | fit: align | patterns: [P-Ports-Adapters] | violations: [] | suggestion: 新增成就时只扩展 unlockedAchievements 的返回列表
```

```text
VALIDATION | agents: [ARCH-PRIMARY, ARCH-ADVERSARY, ARCH-SYNTH] | agreement: high | unresolved: 0 | ready: yes
```

对抗审查摘要：

- ARCH-PRIMARY：在「零持久化 + 静态世界单点真相 + Worker 渲染」三条约束下，道具管线 + 独立文本层 + 纯函数引擎是唯一不引入第二份坐标与第二套日期逻辑的落法。
- ARCH-ADVERSARY：用户推荐坐标落在海里；牌面会堵死 112px 北向主路；80×20 底座若写进 PROP_FOOTPRINT 会分叉尺寸；Worker 里 `Date.now()` 与主线程时区不一致会算错日期；`localStorage` 脏数据会让敲击计数变 NaN；中文输入法空格会误触木鱼；跑马灯每帧改 `text` 会拖垮帧预算。处置：改为东侧对称 (4232,3832) 并加通道断言、碰撞留在 HUB_SOLIDS、日期全部本地时区且纯函数共用、`parseAlmanac` 整条丢弃坏数据、`isComposing || 229` 放行、文案 1Hz + 只写 x。
- ARCH-SYNTH：保留方案 A；把「2029 年后农历表」「跨设备成就」写入复核信号；明确世界坐标双端同发版。

## References

- Code: `packages/shared-types/src/world/layout.ts`、`packages/shared-types/src/world/campus.ts`
- Code: `apps/web/lib/game/holiday-calendar.ts`、`local-date.ts`、`bulletin.ts`、`bulletin-ticker.ts`、`almanac-store.ts`、`woodfish-audio.ts`、`interactions.ts`、`props.ts`、`renderer.ts`
- Code: `apps/web/components/BulletinModal.tsx`、`components/bulletin/CorkboardPieces.tsx`、`components/bulletin/FishDrum.tsx`、`components/game/GameViewport.tsx`
- Related ADRs: ADR-0004（零持久化）、ADR-0047（中央枢纽）、ADR-0049（渲染线程拆分）、ADR-0054（公告栏交互范式）
- User requirement: 2026-11-12《牛马放假倒计时常驻公告板与赛博黄历系统》
