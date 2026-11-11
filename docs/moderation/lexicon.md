# 词库维护

内容审核的匹配规则见 [ADR-0028](../adr/0028-content-moderation.md)。这里只讲**词库怎么填、怎么发、怎么验**。

## 两类词、两种处置

| 类别 | 键名 | 命中后 |
|---|---|---|
| 政治敏感 | `political` | 整条拒绝：聊天不广播、昵称不允许上岗 |
| 污言秽语 | `profanity` | 打码为 `*` 后照常发出 |

同时命中两类时按政治类处理。

## 内置表 vs 外置文件

- **内置表**在 `packages/shared-types/src/moderation/lexicon.ts`，随前后端制品一起发布，客户端即时预检用的就是它。
  - 政治类只放了中性占位条目（`示例敏感词甲` 之类）。**真实词条不要写进仓库**，来源必须可审计。
  - 污言秽语放了一份起步表，按线上误报再调。
- **外置文件**由服务端在启动时读取，只影响服务端权威裁决：

  ```bash
  GAME_MODERATION_LEXICON=/etc/niuma/lexicon.json
  ```

  客户端拿不到这份文件，因此可能出现「客户端放行、服务端拒绝」——服务端会回一条
  `S2C_CHAT_REJECTED`，界面显示「这句话里有不能发的词」。

## 文件格式

```json
{
  "political": ["词条一", "词条二"],
  "profanity": { "mode": "append", "words": ["额外的词"] }
}
```

- **数组**：整类替换内置表。
- **`{"mode": "append", "words": [...]}`**：在内置表后追加。
- **`{"mode": "replace", "words": [...]}`**：显式替换（与数组等价，写法更啰嗦，便于生成器输出）。
- **没写的类别**继续用内置表。
- 单类最多 20000 条，单条最多 32 个码点；非字符串、空串、控制字符会被剔除并在启动日志里记一行。

词条写**正常写法**即可，不要手写变体：

```
✅ 敏感词
❌ 敏 感 词
❌ 敏*感*词
❌ 敏敏感感词
```

规范化（NFKC、去噪、叠字折叠、数字替字）在匹配前统一做，手写变体只会让词库膨胀。

## 开源词库来源

仓库**不内置**这些词条，也不在运行时下载：需要时自行 clone，用导入脚本转成本项目的 JSON。
选择前先看许可证——这是唯一会进入分发物的合规风险点。

| 项目 | 许可证 | 覆盖 | 备注 |
|---|---|---|---|
| [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon) | MIT | 数万条，按领域分目录，纯文本 | 仍在维护；主词库是混合表，需按文件显式指定类别 |
| [bchaoqun/sensitive-stop-words](https://github.com/bchaoqun/sensitive-stop-words) | Apache-2.0 | 政治 / 色情 / 广告 / 涉枪涉爆 / 违规网址 + 停止词 | 逗号分隔，文件较老（2015 前后），适合当补充集 |
| [Mc9420/ChineseSensitiveVocabulary](https://github.com/Mc9420/ChineseSensitiveVocabulary) | 见仓库 LICENSE | 暴恐违禁 / 文本色情 / 政治敏感 / 恶意推广 / 低俗辱骂，按目录分 | 分类最接近本项目两类，导入前先确认许可证 |
| [cjh0613/tencent-sensitive-words](https://github.com/cjh0613/tencent-sensitive-words) | AGPL-3.0 | 腾讯离线词库 | **已归档**；AGPL 有传染性，闭源分发不要直接并入 |

注意事项：

- 开源词库是**候选集**，不是合规结论。政治类词条必须经你们法务/合规复核后才能上线。
- 词库会过期，也会误伤（人名、地名、正常短语）。上线后盯误报，把误伤词从外置文件里摘掉即可，不必发版。
- 不要为了「覆盖面」把色情、广告、网址类词表塞进 `political`：本项目的政治类是整条拒绝，
  塞错类会把正常聊天全拦掉。

### 导入

```bash
# ① 拉取词库（任选其一，放到仓库外）
git clone --depth 1 https://github.com/konsheng/Sensitive-lexicon.git /tmp/sensitive-lexicon

# ② 按目录导入：文件名含「政治/时政/暴恐/违禁/涉枪/涉爆」→ political，
#    含「辱骂/低俗/脏话/谩骂/不文明」→ profanity，其余会列成 skip
pnpm --filter @niuma/game-server lexicon:import -- \
  --dir /tmp/sensitive-lexicon/Vocabulary \
  --out lexicon.json

# ③ 判不出类别的文件，用显式参数再导一次（同一类别会自动去重）
pnpm --filter @niuma/game-server lexicon:import -- \
  --political /tmp/sensitive-lexicon/政治类型.txt \
  --out lexicon.json
```

脚本特性：每行一词与整表逗号分隔都认；去 BOM、跳注释；单条超过 32 码点或含控制字符的词条会被剔除；
疑似 GBK 编码会告警（先转 UTF-8 再导）。

## 上线流程

1. 合规方确认词条清单（可以直接基于上面的开源词库，经法务复核后裁剪）。
2. 本地自检：

   ```bash
   pnpm --filter @niuma/game-server lexicon:check /path/to/lexicon.json
   ```

   输出各类条数；有任何格式问题以非 0 退出，CI 与上线前都应跑一次。

3. 把文件放到服务端并设置 `GAME_MODERATION_LEXICON`，重启游戏服。
4. 看启动日志确认实际生效的条数：

   ```
   [moderation] lexicon source=file political=… profanity=… issues=0
   ```

   出现 `fallback to builtin` 说明文件不可用，此时**只走内置表**，等于没开政治审核。

## 已知边界

- 形近汉字（日/曰）、拼音、谐音替换、缺字省略（`f*ck`）不在 v1 覆盖范围。
- 外置词库不会同步给客户端；两端的差异由服务端回执兜底。
- 词库只影响昵称与聊天，不影响静态文案与地图内容。
