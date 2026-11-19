# 分层与光照

## 三层叠法

场景从上到下只有三层，新装饰必须能明确回答「我属于哪一层」：

| 层 | 容器 | 语义 | 放什么 |
|---|---|---|---|
| 地面族 | `PropsView.base` / `TerrainView` | 永远在角色下方 | 地砖、地毯、铺装、墙体平面、地贴、路面标线 |
| 平面装饰 | `flat`（`interior-art.ts` 内的 Graphics，直接进 `base`） | 永远在角色下方，但不属于地面材质 | 墙贴、地毯花纹、地面污渍、粉笔线、钉子 |
| 立式摆件 | `DepthSink`（`SortLayer`） | 按脚底 y 与角色互相遮挡 | 桌椅、盆栽、灯柱、柜子、招牌、垃圾桶 |

`DepthSink` 接口（`apps/web/lib/game/sort-layer.ts:31`）：

```ts
interface DepthSink {
  add(y: number, child: Container): void;   // 构造期静态物体：按脚底 y 一次性归 band
  remove(child: Container): void;
  update(child: Container, y: number): void; // 会移动的物体才用
}
```

- **静态装饰只用 `add(y, sprite)`**，`y` 传物件脚底（贴墙陈设就是墙面下沿）。
- `SortLayer` 按 256 纹素切 band，band 内 `sortableChildren`。往同一个 band 塞几百个小物件会拖慢排序，**同类小物件请合进一张 Graphics 或一张烘焙纹理**。
- 平面装饰不要走 `DepthSink`——它会在角色走路时上下跳。

## 无碰撞原则

贴墙陈设（挂画、镜子、消防栓、门牌、插座、壁灯）的位置本来就在墙体碰撞盒里，玩家站不进去，因此**不需要补碰撞**，也就不需要动 `PropKind`。

只有「可以被挡住、可以坐、可以按 F」的新家具才需要动 `packages/shared-types`：加 `PropKind` 要在服务端一起发版，还要过 `collision` 单测，代价高。

## 光照

### LightSpec

```ts
interface LightSpec {
  x: number; y: number;
  radius: number;
  color: number;      // 0xRRGGBB
  intensity: number;  // 0..4
  flicker?: number;   // 0..1，烛光 0.16、霓虹 0.02、冷白灯 0
}
```

### 注册链路

1. 视图自己产出光源：`readonly lights: LightSpec[] = []`，在 `build()` 里 push。
2. `renderer.ts` 的 `buildLayers()` 在 `renderer.ts:950-957` 附近把各组光源汇给 `LightmapLayer.register()`。
3. `LightmapLayer.register()` → `LightRegistry.addAll()`；**超过 `MAX_LIGHTS` 的多余光源会被静默丢弃（返回 -1），不会报错**。

### 预算

- `MAX_LIGHTS = 96`（`lighting/light-registry.ts:45`），场所常驻光保持 18–22 盏。新增场所光之前先算总数，并跑 `apps/web/lib/game/__tests__/lighting.test.ts` 的预算断言。
- 单场所只留 **1–2 盏焦点光**，其余靠地面提亮与烘焙暖色块表现。夜景靠对比，不靠堆灯。

### 抖动

- `flickerAt(seed, timeMs)` 是 64 档 LUT（90ms 一档，两条正弦合成），`seed` 由光源 id 派生（`(id * 97) % 1024`），所以同屏的灯不会一起闪。
- `flickerAlpha(intensity, flicker, seed, timeMs)` 直接给出最终 alpha；**纯函数，可单测区间**。
- 静态发光体贴图（灯笼、灯罩）不参与动画，明暗全部交给光图。

## 微动效

- 形态：`(seed: number, nowMs: number) => number` 或 `=> { frame, offset }`，**纯函数、无状态、可复现**。
- 相位：由坐标或 id 哈希派生（参考 `festival-art.ts` 的 `phaseOf(x, y)`），不要用 `Math.random()`。
- 推进：放进 `renderer.ts` 的 `tickBubbles(dtMs)` 统一 `update(nowMs)`，**不新增 ticker**。
- 预算：每屏同时运动的元素不超过三类，周期 2–4 秒；不做整屏抖动、不做浮点缩放的呼吸（沿用角色「只抬高不下沉」的纪律）。
- 零分配：帧循环里不 `new` 对象、不 `generateTexture`，必要时用预分配数组或 LUT。

## 灰度开关

新装饰与新动效必须能被一键关掉，方便线上定位视觉回归：

| 参数 | 语义 | 读取位置 |
|---|---|---|
| `?venue=0` | 关掉场所装饰与微动效层，保留地板与既有视图 | `renderer.ts` 的 `buildLayers(search)`（与 `flat/light/bands` 同批解析 `params`） |
| `?light=0` | 关光图 | `renderer.ts:985` |
| `?flat=1` / `?edge=0` | 关地形起伏 / 边缘 | `renderer.ts:1000-1001` |
| `?festival=0` / `?season=winter` / `?snow=0` | 节日 / 季节 / 飘雪 | `festival-decor.ts:75`、`season.ts:62` |

解析写法照抄现有惯例：`params.get('venue') !== '0'`，**不要在模块顶层读 `location`**。
