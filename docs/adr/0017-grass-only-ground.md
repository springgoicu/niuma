# ADR-0017：地面只剩草与土路，广场降级为路缘

- 状态：已采纳
- 日期：2026-11-03
- 关联：细化 ADR-0013（暖色 pastel 地形）、ADR-0016（双网格边缘与三层地表）；
  取代其中「广场是独立材质」「广场地砖 + `edgeOutset = 10`」的部分，不改写历史 ADR

## 背景

广场是一大片 64×32 的浅奶油色错缝砖（`plazaBase #D8CBB0` / `plazaHighlight #E8DCC4`），
在 3 倍放大后整块读作「白方块」，与「草地才是背景」的 cozy 画面互相打架。
同一批地面纹理里，土路是 40–64 × 24–40 的大矩形色块，水面与海面是横贯整块的 1px 直杠，
都还留着「一块一块」的拼贴感。

需求是：参照草地已经采用的「有机斑块 + 平铺无缝」生成方式，把所有地面材质都改成有机纹理，
不再出现白色方块；广场地面变为纯草地，辨识度交给路缘、围栏与花箱。

## 备选方案

| 方案 | 收益 | 代价 | 不可逆性 |
|---|---|---|---|
| A. 保留广场材质，只把砖缝去掉换成浅色有机纹理 | 改动小，广场仍有「铺装」暗示 | 任何浅色铺装面在 3 倍缩放下仍会被读成白色方块；多一张 256² 纹理、一个 TilingSprite、一个遮罩与一个 EdgeJob | 低 |
| B. 广场不再是材质，地面即草地，仅留路缘（采纳） | 零接缝、零额外填充；删掉一张纹理、一个遮罩与一个 EdgeJob，材质表少一档 | 广场与野地完全同色，只能靠路缘 / 围栏 / 花箱辨认 | 低 |
| C. 所有地面统一成草地（连土路也变草） | 「全草地」最彻底 | 土路承担「往哪里走」的引导，去掉后路口与桥头在视觉上消失 | 中 |

选 B。草地纹理已经是 512px 有机色簇 + 1px 颗粒，只要不再铺广场层，
办公区地面就天然与野地连续，不需要任何过渡补丁。

## 决策

1. **`materialAt` 不再返回 `MATERIAL.plaza`**，优先级收敛为
   桥 > 水（湖/河）> 土路 > 岸沙带 > 草地 > 浅滩 > 海。
   `MaterialId` 由 0..7 收敛为 0..6；它只写进客户端 `Uint8Array` 采样格，
   不落库、不上协议，重排是安全的。`PAINT_ORDER`、`EDGE_DRAW_ORDER`、
   `EDGE_STYLE` 同步删除 plaza 条目。
2. **`TerrainView.addPlaza` 只画路缘**：12px `plazaSeam` 外圈 + 10px `plazaCurb` 面层
   （`alignment: 0` 落在轮廓外侧，整数像素），围栏与花箱不动。
   删除 `makePlazaTexture`、`PLAZA_TILE`、广场 TilingSprite / 遮罩 / EdgeJob；
   `paintRegion` 去掉只为广场存在的 `edgeOutset` 参数。
3. **全部地面纹理共用 `organicBlob`**（由草地的 `grassPatch` 提升，单像素行 +
   `wrappedRect` 跨界补画 + `seeded` 固定种子）：
   - `makeDirtTexture`：暖棕底 + 30 个有机色簇 + 1px 车辙与石子，替换 26 个大矩形；
   - `makeWaterTexture` / `makeSeaTexture`：扁平有机波纹 + 短浪脊 + 1px 泡沫点，
     替换横贯整块的直杠；96px 周期不变（`WATER_TILE` / `SEA_TILE` 的回绕依赖它）。
4. **沙滩保持纯色带**：它没有重复图案、不存在方块感；为颗粒新增贴花种类会打乱
   `BLOOM_KIND_BASE` 与图集帧序，收益不抵风险。
5. **贴花放开广场**：`grassDecorAllowed` 去掉 plaza 矩形排除，广场内外命中率一致
   （仍受 64px 栅格与 12% 命中约束，不新增种类）。
6. **小地图同步**：广场不再填浅色块，只画 1px `plazaCurb` 描边；
   调色板删除 `plazaBase` / `plazaAlt` / `plazaHighlight` / `plazaEdge` 与 `EDGE_TINT.plaza`。
7. **回滚**：本次提交可整体 revert；`?flat=1` / `?edge=0` / `?light=0` 语义不变，
   仍可按层剥离定位观感回归。

## 后果

- 正面：地面只剩「草 + 土路 + 水 + 沙 + 桥」五种面，全是有机纹理；
  广场内部不再有第二条边，草缘只出现在真正的材质交界；少一张 256² 纹理、
  一个 TilingSprite、一个遮罩与一个 EdgeJob。
- 负面：广场与野地同色，新玩家只能靠路缘 / 围栏 / 花箱判断办公区；
  基于旧 `MaterialId` 数值的本地调试缓存会失效（无持久化，可忽略）。
- 回滚成本：低。改动集中在 `terrain-textures.ts`、`terrain.ts`、`terrain-edge.ts`、
  `terrain-palette.ts`、`MiniMap.tsx` 与两份单测。

## 复核信号

- 出现「广场位置仍有一块浅色」：先查是否还有 `paintRegion(MATERIAL.plaza, …)` 残留，
  或浏览器缓存了旧包。
- 出现「路缘压住草缘」：路缘画在 `base` 层、草缘在 `edge` 层，层序反了就是画反了。
- 出现「土路仍有大色块」：确认 `makeDirtTexture` 全部走 `organicBlob` / `wrappedRect`，
  不再有 40px 以上的 `g.rect`。
- 出现「水面每隔几秒跳一下」：检查 `WATER_TILE` / `SEA_TILE` 是否仍等于纹理尺寸 96。
