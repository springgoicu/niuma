---
name: interior-art-meeting-dorm-restroom-refresh
overview: 在 apps/web/lib/game/interior-art.ts 中为会议室补齐高精度室内陈设，并重制宿舍区与卫生间的像素内饰；所有新增摆件保持贴墙、无碰撞、按 Y 轴排序，沿用 1px 描边与单档几何投影。
todos:
  - id: meeting-layout
    content: 调整 campus.ts：移除会议室旧白板，追加两把端椅并保持既有 seat id
    status: completed
  - id: chair-bed-art
    content: 升级 chair-art.ts 与 props.ts：高背滚轮椅、翘角被褥与床底快递箱
    status: completed
  - id: meeting-room-art
    content: 在 interior-art.ts 绘制会议室：深灰地毯、反光长桌、冷蓝投屏、白板与墙角陈设
    status: completed
    dependencies:
      - meeting-layout
      - chair-bed-art
  - id: dormitory-art
    content: 在 interior-art.ts 重制宿舍区：北窗月光、暖光胡桃木、圆毯、挂衣架与热水杯
    status: completed
    dependencies:
      - chair-bed-art
      - meeting-room-art
  - id: restroom-art
    content: 在 interior-art.ts 重制卫生间：薄荷马赛克、连体洗手台、宽镜、红锁与绿萝
    status: completed
    dependencies:
      - meeting-room-art
      - dormitory-art
  - id: verify-interiors
    content: 运行 typecheck 与双包测试，手动巡检三室动线与 Y 轴遮挡
    status: completed
    dependencies:
      - meeting-room-art
      - dormitory-art
      - restroom-art
---

## Product Overview
对《牛马 NIOMA》的三间室内场景做一次美术与陈设升级，保持现有世界坐标、碰撞与座位语义不变：会议室呈现冷峻高压的商务风，宿舍区呈现温暖疲惫的生活感，卫生间成为薄荷绿的私密避难所。所有新增陈设均无碰撞、贴墙或贴角布置，中心动线与门口保持通畅，角色经过时按脚底 Y 正确遮挡。

## Core Features
- **会议室**：深灰降噪地毯；深胡桃木反光长桌与冷白高光；围绕长桌的 8 把带滚轮高背椅（坐姿）；北墙超宽冷蓝投屏，绘制上升折线与模糊的 OKR / 闭环 / 赋能字样；西墙思维导图白板立架；桌面散落发光笔记本、半杯冰美式与草稿纸；西北角发财树、东南角静音双温饮水机、东墙一摞备用折叠椅。
- **宿舍区**：北墙雪窗与浅蓝月光矩形遮罩；暖黄壁灯、深胡桃木家具；圆形毛绒编织地毯；上下铺床垫翘角、凌乱被褥、羽绒枕褶皱、床头防噪耳机与垂落充电线、床底半露快递箱；挂衣架（工服与安全帽）、离职倒计时软木板、床脚拖鞋、暖气片烤橘子、床头几枸杞热水杯与白汽。
- **卫生间**：浅薄荷绿与冷白马赛克拼花地砖、半透明水渍反光、深灰地漏；连体白瓷洗手台、宽幅 45 度反光镜、压泵洗手液、抽出一半的纸巾、水龙头下 1 滴微弱水滴；木隔间门留 2px 缝隙并挂红色使用中锁；节水禁超时提示牌、除臭香薰竹签与顽强生长的绿萝。
- **工程约束**：新增摆件全部在 interior-art.ts 内以纯函数绘制；1px 描边、单档几何投影、不使用柔化滤镜；立式物件按 Y 轴自动排序；不新增碰撞，不改变 seatPose 语义。

## Tech Stack
- 语言与渲染：TypeScript 5.7 + PixiJS 8.6；沿用 `bake()` 构造期生成纹理、nearest 采样的像素管线。
- 共享布局：`@niuma/shared-types` 的 `WORLD_LAYOUT`（buildings / solids / seats / props）。
- 测试：shared-types 用 Vitest，web 用 `bun test`；不新增依赖。

## Implementation Approach
- 保持 `InteriorArt` 为深模块：新增 `decorateMeeting / furnishMeeting`，扩展现有 `decorateLounge / decorateRestroom`；所有绘制函数为纯函数，只在构造期烘焙一次。
- **平面层与深度层分离**：地毯、桌面、北墙投屏、镜面、软木板、月光与水渍、桌面小物写入 `flat` Graphics（始终在角色下方）；立式家具通过 `place()` 进入 `DepthSink`，按脚底 y 与角色混排。
- **几何只读共享源**：房间用 `roomOf(name)`；会议桌用 `WORLD_LAYOUT.solids` 中 200×90 的 `fixture` 反查；会议椅、床等用 `WORLD_LAYOUT.seats` 过滤；不复制坐标常量。
- **旧白板与投屏冲突**：从 `MEETING_PROPS` 移除北墙 `board`（仅删无碰撞展示道具），新白板立架画进 `interior-art.ts` 并贴西墙；投屏保留北墙居中。
- **围绕会议桌一圈**：新增两把端椅，追加到 `CAMPUS_SEATS` 末尾（`MEETING_END_SEATS`），避免既有 seat id 整体后移；`kind: 'chair'`、`desk: -1`，`seatPose` 仍为 sit。
- **高背老板椅**：只在 `chair-art.ts` 的 26×30 帧内加高靠背盒子，并在 `props.ts` 的 `drawChair` 增加头枕分区、扶手与两个滚轮小点；不改 frame、seat.y、contactY，避免 `seatLift` 与既有测试回归。
- **床铺升级**：4 张 bed 全在宿舍区，直接升级 `props.ts` 的 `drawBed`；保持 `BED_SPRITE 64×42` 与 sink 16，确保座位贴合不变。
- **视觉规范**：继续使用 1px 深靛描边与单档 alpha 椭圆投影；会议室用深灰、冷蓝、深胡桃木，宿舍区用暖黄、胡桃木、奶油与浅蓝月光，卫生间用薄荷绿、冷白与深灰。禁止 blur、渐变与非整数缩放。

## Implementation Notes
- 纹理缓存：沿用 `place(key, draw, size)` 的 key 复用；新增 key 保持唯一，`destroy()` 统一释放，避免重复烘焙与显存泄漏。
- 性能：flat 只增加一个 Graphics；新增约 9 张小纹理，全部在构造期完成，无帧循环开销，不引入逐帧 `generateTexture` 或对象分配。
- 兼容性：不改协议与服务端逻辑；共享布局只删一条 board、追加 2 个 seat，无持久化，双端同版本发布即可。
- 失败兜底：`roomOf` 或 fixture 反查失败时跳过对应绘制，不抛错；新摆件不写 `WORLD_LAYOUT.solids`。
- 文字：屏幕上的 OKR 与软木板上的 365 用 3×5 像素字形；中文“闭环 / 赋能 / 节约用水 · 严禁超时”用 1px 点阵/模糊字块表达，避免在 1px 尺度画汉字。
- Y 排序：白板、发财树、饮水机、折叠椅、挂衣架、热水杯、水滴、香薰、绿萝全部走 `place()`；不要塞进 flat 层。
- 测试：运行 `pnpm --filter @niuma/shared-types test`、`pnpm --filter @niuma/web test`、`pnpm --filter @niuma/web typecheck`；手动巡检三室动线与遮挡。

## Architecture Design
数据流保持单向：

```text
WORLD_LAYOUT（rooms / solids / seats）
        ↓
InteriorArt.build(depth, base, renderer)
        ├── flat Graphics → props.base（地板、墙饰、桌面、屏幕、镜面）
        └── place() → DepthSink → sortLayer（立式陈设按脚底 y 排序）
                                  ↓
                            角色 / 家具 / 陈设统一遮挡
```

模块职责：
- `interior-art.ts`：室内陈设的绘制、纹理烘焙与摆放；新增会议室补完，重制宿舍与卫生间。
- `props.ts`：座位家具与基础地板/墙体的既有渲染；只升级椅子与床的贴图细节。
- `chair-art.ts`：椅子四向几何；只调整靠背盒子，不改帧与座面契约。
- `campus.ts`：世界布局；只移除一条展示 board、追加两把端椅。
- `renderer.ts`：无需改动，现有 `InteriorArt.build` 调用顺序已经保证 flat 在角色下方、depth 进入排序层。

## Directory Structure
```text
apps/web/lib/game/
├── interior-art.ts   # [MODIFY] 主改造文件。新增会议室 decorateMeeting/furnishMeeting；
│                     #   重制 decorateLounge/decorateRestroom；扩展 COLOR 调色板与
│                     #   fixtureOf/seatsOf 几何辅助；新增白板立架、发财树、双温饮水机、
│                     #   折叠椅、挂衣架、热水杯、水滴、香薰、绿萝等纯绘制函数；
│                     #   所有立式摆件走 place()，平面装饰写入 flat。
├── props.ts          # [MODIFY] drawChair 增加头枕、扶手与滚轮；drawBed 增加翘角床垫、
│                     #   凌乱被褥、羽绒枕褶皱、防噪耳机、垂落充电线与床底快递箱。
│                     #   保持 BED_SPRITE 64×42 与椅子接触契约不变。
└── chair-art.ts      # [MODIFY] 在 26×30 帧内加高四向 back 盒子，必要时将朝北 base 上移
                      #   1px 给滚轮留位；SEAT_TOP、frame、seat 保持不变。

packages/shared-types/src/world/
└── campus.ts         # [MODIFY] 删除 MEETING_PROPS 的 board；新增 MEETING_END_SEATS
                      #   （x+124 朝右、x+356 朝左），追加到 CAMPUS_SEATS 末尾以稳定
                      #   既有 seat id；同步更新座位数量注释。

packages/shared-types/src/__tests__/
└── seats.test.ts     # [MODIFY] 仅更新“会议 6 把”的注释为 8 把；断言不改。
```

## 房间级实现要点
- **会议室**：flat 层按内墙矩形铺深灰降噪地毯（约 `#3C414B`，1px 浅灰噪点与深色接缝），反查 200×90 fixture 重绘深胡桃木桌面（`#4A3226`，2px 冷白顶边高光与 1px 木纹）；北墙居中约 200×56 投屏，深蓝底、青色阶梯折线、3×5 “OKR” 与点阵字块，外围 1px 冷蓝光晕与地面 alpha 光斑；桌面画 2–3 台发光笔记本、半杯冰美式、3–4 团草稿纸。depth 层：西墙白板立架约 46×50（红蓝箭头、黄色便利贴、板擦痕），西北发财树约 30×46，东南双温饮水机约 24×40，东墙折叠椅约 30×36。
- **宿舍区**：北墙门洞两侧布置雪窗，窗下向室内投出阶梯边缘的浅蓝 alpha 光斑；南墙保留暖气片并加橘子皮，北墙重排壁灯与挂钟；圆形编织地毯用同心环与 1px 流苏；衣柜、书架、行李架换成深胡桃木色。新增东墙挂衣架约 24×46（工服与安全帽）、南墙软木倒计时板约 60×18（3×5 “365” 与日历格）、床脚拖鞋、床头几热水杯约 10×12（白汽与枸杞点）。床铺细节在 `drawBed` 内完成。
- **卫生间**：内墙矩形铺 10px 马赛克（薄荷/冷白/浅蓝灰交错），砖缝处加 alpha 水渍与 1px 反光，中央深灰地漏；保留两个 sink prop，在 flat 层补连续白瓷台面（约 x+166..294、y+326..350）、宽幅镜面（约 96×20，45 度阶梯亮白斜条）、压泵洗手液与抽半张纸巾的纸盒；水龙头下用 3×5 depth 精灵画 1 滴微弱水滴。6px 隔断重绘为木色，门扇与隔断留 2px 缝并加红色小锁；北墙右侧加提示牌，西北角香薰竹签，东北角绿萝，烘手机保留。
