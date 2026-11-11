# ADR-0035：头顶常驻状态——工牌上的第二行，随 HELLO / SPAWN 与独立广播同步

- 状态：已采纳
- 日期：2026-11-11
- 关联：ADR-0004（服务端零持久化）、ADR-0028（内容审核）、ADR-0034（会话快照）

## 背景

昵称只解决「你是谁」，不解决「你现在在干嘛」。园区里的高频信息是「开会中 / 摸鱼中 / 请勿打扰」，
写在聊天里会被刷掉，写在昵称里会吃掉 16 显示宽的预算，也不该每改一次就换名字。

需求是：玩家能输入一段固定长度的文字 + emoji，设置后常驻显示在头顶昵称周围，视野内其他人可见，
重新进园区仍然保留。

## 决策

### 1. 状态是展示型字段，生命周期与昵称完全一致

- 服务端仍然零持久化：`Player.status` 只在进程内存里，断开即回收（ADR-0004）。
- 浏览器把它放进 `niuma:profile:v2`：`Profile.status` 是普通字符串，旧存档缺这个字段时按空串恢复，
  不清空昵称与外观，因此不需要新的存档版本号。
- 换设备、换浏览器仍是全新角色——状态与昵称、外观一起丢。

### 2. 三条同步路径，零额外往返

```
C2S_HELLO (0x10) v3
[op u8][nameLen u8][name nB][appearance 32B][resume? 8B][status? 2+nB]

status = [magic u8 = 0xff][len u8][utf8]

S2C_ENTITY_SPAWN (0x05) v2
[op u8][id u16][x u16][y u16][state u8][nameLen u8][name nB][appearance 32B][statusLen u8][status nB]

C2S_SET_STATUS (0x1b)
[op u8][len u16][utf8]

S2C_STATUS (0x1c)
[op u8][entityId u16][len u16][utf8]
```

1. **入场**：状态随 `C2S_HELLO` 上报，排队期间跟着 `HelloPayload` 一起等，放行时与玩家一起落地，
   不会出现「排队者丢状态」。
2. **首次可见**：`S2C_ENTITY_SPAWN` 的尾部带上状态，新进入视野的人一包拿全，不依赖后续增量包。
3. **运行时修改**：`C2S_SET_STATUS` → 服务端改字段 + `markSpawnDirty()` → `S2C_STATUS` 广播给自己与
   `player.known`，范围与换装完全一致。

### 3. 向后兼容只靠「尾部追加 + 魔数」

- HELLO 的状态段以 `0xff` 开头。`RESUME_VERSION` 恒为 1，永不撞车，旧解码器读到 0xff 会按
  「未知版本」整段忽略，出生点回落到随机——这正是它对新字段的既有语义。
- SPAWN 的状态段追加在 appearance 之后。旧 `decodeSpawn` 读完外观不校验尾部剩余字节，天然忽略；
  新解码器在剩余字节不足时回退空串。**空状态不写任何字节**，没设状态的人包长与上一版逐字节相同。
- 新解码器先排除 0xff 再读 resume，避免把状态字节误读成落点。
- 长度字段超出实际负载（截断包 / 伪造包）时整段丢弃，不猜半个字符，也不越界读取。

### 4. 长度与审核：三重尺子 + 同一套词库

- 16 显示宽（8 汉字 / 8 emoji）、16 码点、48 字节，三者同时生效；空串表示「没有状态」。
  不补省略号——头顶空间按显示宽算，省略号白占一个身位。
- 客户端输入框只提示不阻塞（超限转 amber），保存时截断；服务端 `moderation.inspect` 权威兜底：
  政治类清空并打 warn（只记 verdict 与 wsId，不打印原文），脏话用打码结果继续展示。
- `C2S_SET_STATUS` 有 200ms 节流：广播发给视野内所有人，没有下限的话一条伪造包循环就能把
  AOI 变成广播放大器。只有状态真的变化才 `markSpawnDirty()`。

### 5. 显示在昵称上方，独立一行

- 昵称紧贴头顶（`nameBottomY`），再往头顶方向塞字会压住帽檐，所以状态行在昵称**上方**：
  `statusBottomY = nameBottom - nameHeight - 2`。
- 字号 7、薄荷绿、同款暖褐描边，视觉上让位给名字；气泡整体再上移「状态高度 + 间隙」，
  `bubbleTopY` 新增的 `stackHeight` 默认 0，旧行为逐像素不变。
- 字体栈挂系统彩色 emoji 回退：`JetBrains Mono` 与 `Noto Sans SC` 都没有 emoji 字形，
  缺了 fallback 会渲染成豆腐块。
- 状态 Text 惰性创建：没设状态的人零额外纹理与 draw call；DPR 变化时与昵称一起重设分辨率。

### 6. 入口在工牌卡，面板像从工牌下方抽出的表单

- 左上角工牌卡在名字下方新增一行状态，未设置显示「设置状态…」，点击展开编辑面板（不是弹窗：
  状态是随手改的东西，弹窗抢焦点还会遮画面）。
- 保存 / Esc / 点击画布空白处都收起并失焦，WASD 立刻可用；聊天与状态面板互斥展开，不叠在同一个角落。
- 顺手修了输入层的三个缺口：`NumpadEnter` 与 `Enter` 同效、输入法组合态
  （`isComposing` / `keyCode 229`）不触发游戏动作、`contentEditable` 计入输入域。

## 备选方案与反向成本

| 方案 | 形态 | 收益 | 代价 / 不做的理由 |
|---|---|---|---|
| A（采用）HELLO + SPAWN + 独立广播 | 两条已有包各追加一段，新增一个 opcode | 入场即完整，零握手往返，新入场者一包拿全 | 两处协议追加，需要向后兼容测试 |
| B 入场后单独补发 | 协议零改动，连上后再发一次 SET_STATUS | 改动最小 | 排队放行时 SET_STATUS 会早于建号被丢弃；还得加重试握手，首帧仍是空状态 |
| C 复用聊天广播 | 状态当作一条特殊聊天 | 省一个 opcode | 会落进聊天记录、受聊天限速影响，新入场者拿不到 |

反向成本（不做 / 晚做）：状态只能靠改昵称表达，每次改都要动 16 显示宽的名字预算，
且 16 字的名字已经会在头顶被截断——这是把两个诉求挤进一个字段的典型症状。

## 后果

- 正面：入场、首次可见、运行时修改三条路径都是单包，无轮询、无额外往返；
  服务端仍不落库，部署与数据合规成本不变；没设状态的玩家在协议与渲染上都零开销。
- 负面：
  - 协议破兼容（HELLO 变长、SPAWN 变长、新增两个 opcode），客户端与服务端必须同版本发布。
  - 头顶信息密度上升：状态行会再占一行高度，同屏人多时视觉更拥挤，靠 16 显示宽与更小字号压住。
  - `localStorage` 多了一个字段；同一浏览器多标签页仍会互相覆盖（与 ADR-0034 同一限制）。
- 回滚成本：低。协议是纯追加——撤掉双端的新 opcode 分支与 SPAWN 尾部字段即可，不动既有字段偏移；
  旧版 `sanitizeProfile` 会丢弃多出来的 `status`，无需迁移脚本。

## 基线

```text
BASELINE | packages/shared-types（协议） | expected: 契约层只做类型与编解码，不依赖运行时 | observed: 状态常量、三重钳制、HELLO/SPAWN 尾部段与 SET_STATUS/STATUS 编解码都在此，零外部依赖 | fit: align | patterns: [P-Adapter] | violations: [] | suggestion: 保持「尾部追加 + 魔数」作为后续字段的唯一扩展方式
BASELINE | apps/game-server（Player/Admission） | expected: 内存为唯一真相，不落盘；客户端输入一律重新裁决 | observed: Player.status 随 reset 清空，spawnBody 缓存含状态并在变更时失效，审核与节流在 dispatch 收口 | fit: align | patterns: [P-Policy, G-Strategy] | violations: [] | suggestion: 限速策略若继续增长，抽到基于 wsId 的令牌桶
BASELINE | apps/web（渲染与 HUD） | expected: 几何纯函数与渲染分离，UI 不直接碰网络协议 | observed: 状态行几何在 nameplate.ts（纯函数 + 单测），EntityView 惰性建 Text，HUD 通过 session.setStatus 下发 | fit: align | patterns: [P-Ports-Adapters] | violations: [] | suggestion: 若再增加第三行文本，把「头顶堆叠」整体收敛成一个 stack 描述而不是继续加参数
```

## 复核信号

出现以下任意一条时重新评估：

- 需要在服务端按状态做筛选 / 分房 / 统计（此时状态要进真相层，而不只是展示层）；
- 头顶文本再增加第三种（比如头衔、公会），`bubbleTopY` 的参数会开始失控，应改为显式的堆叠模型；
- 状态需要「限时过期」或「随场景自动切换」——当前是纯手动字段，加自动过期会引入服务端计时与 Tick 成本。
