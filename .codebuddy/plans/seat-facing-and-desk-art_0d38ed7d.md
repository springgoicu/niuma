---
name: seat-facing-and-desk-art
overview: 让入座后的朝向始终「正对家具」：为工位桌补画朝北（显示器背面）/朝东/朝西三套贴图并给 DeskInstance 增加 facing，使广场四面环绕工位都读作正对显示器；凳子改为面朝南侧茶几，床位锁定「头在枕头一侧」，并补布局不变量与服务端朝向不可改写的测试。
todos:
  - id: desk-facing-data
    content: 为 DeskInstance 增加 facing，新增 workstation() 反推椅位，更新四面工位与凳子朝向
    status: completed
  - id: desk-art-four-way
    content: 新增 desk-art.ts 四向显示器几何，drawDesk 按朝向绘制并按 facing 烘焙 8 张贴图
    status: completed
    dependencies:
      - desk-facing-data
  - id: seat-facing-tests
    content: 使用 [skill:test-driven-development] 补工位朝向、床位枕头、凳子茶几与四向桌几何测试
    status: completed
    dependencies:
      - desk-facing-data
      - desk-art-four-way
  - id: adr-0027
    content: 使用 [skill:domain-modeling] 新增 ADR-0027 记录座位朝向权威与四向桌贴图决策
    status: completed
    dependencies:
      - desk-art-four-way
  - id: verify-all
    content: 使用 [skill:verification-before-completion] 运行 typecheck 与全部测试并目视四个朝向
    status: completed
    dependencies:
      - seat-facing-tests
      - adr-0027
---

## 产品概述
角色入座后必须始终「正对」该座位服务的家具，不能出现侧坐或正面朝镜头（背对家具）的观感。保留现有南北东西四面环绕的工位布局，通过为工位桌补齐另外三个朝向的贴图来解决，而不是挪动工位。

## 核心功能
- 工位：坐上任何一张工位椅，角色始终面朝该工位的显示器，四排工位（北排、南排、东列、西列）观感一致。
- 桌子贴图随朝向变化：北排维持现状（看到屏幕与角色背影）；南排改为看到显示器背面（素色背壳与支架）；东西两列改为侧视显示器（竖窄轮廓）。
- 屏幕点亮行为不变：只有被占座的那张工位桌亮屏，未坐人的桌子保持暗屏。
- 凳子：休息室两张凳子由「朝向随机」改为面朝南侧茶几。
- 床位：躺下后头始终在枕头一侧，不出现横躺错位。
- 入座朝向不可被其它操作改写：入座后按方向键、发移动包都不会让角色转向。

## 视觉与约束
- 视觉上只调整工位桌的显示器画法与凳子朝向，桌子本体、桌面陈设、工位位置、碰撞范围与入座规则全部不变。
- 显示器永远位于「桌子背对椅子的那一条边」，屏幕朝向椅子；点亮状态在正/背/侧三种视角下都能一眼看出。
- 不改变座位吸附、起身与占座提示的交互流程。

## 技术栈
沿用现有仓库：pnpm + turborepo 单仓、TypeScript 严格模式、Next 15 + Pixi v8（运行时 Graphics 烘焙纹理）、shared-types 纯数据包、vitest（shared-types）与 bun test（web / server）。

## 实现方案

### 1. 朝向成为工位桌的一等数据（单一真相）
- `packages/shared-types/src/world/campus.ts` 的 `DeskInstance` 增加 `facing: Direction`，语义定义为「屏幕朝向 = 入座者面朝方向」。
- 新增 `workstation(x, y, facing)` 工厂：desk 带朝向，椅子锚点由「桌心 − 朝向单位向量 ×（桌半宽/半高 + CHAIR_GAP）」反推。当前四个偏移量 40 / 64 是手写的，两处各写一份必然漂移；由朝向反推后，「椅子永远在屏幕背面一侧」成为构造性质，而不是靠人记得。
- `layout.ts` 的 `officeWorkstations()` 改为 `workstation(cx, y, DIRECTION.Up / Down / Left / Right)` 四次调用；`campus.ts` 的 `WORKSTATIONS`（工作区六工位）改为 `workstation(x, y, DIRECTION.Up)`。
- 休息室两张凳子 `facing` 由 Up 改为 Down，注释写明面向南侧 `sideTable`；三张床保持 Right（与 `drawBed` 枕头在右端一致）。

### 2. 桌子贴图四向化（重点）
- 新增纯函数模块 `apps/web/lib/game/desk-art.ts`：`deskArtFor(facing)` 只回答「显示器在这张 96×66 帧里的哪条边、屏幕朝哪、桌面陈设要不要镜像」，不 import pixi，可直接单测。
- `props.ts` 的 `drawDesk(g, lit)` 改为 `drawDesk(g, lit, art)`：
  - facing Up（人坐桌南，现状）：显示器在桌北远边，屏幕朝镜头，保留现有代码与发光晕；
  - facing Down（人坐桌北）：显示器移到桌面近边（帧底部），画背面——素色背壳、底部支架，点亮时只沿外框泛暖光，不出现屏幕像素与代码行；
  - facing Left / Right：显示器改为靠左/靠右的窄竖条侧视轮廓，点亮时仅在屏幕一侧留 2px 亮边。左右两个朝向用绘制期镜像坐标实现。
- `PropsView.build()`：按四个朝向各烘焙 idle / lit 两张（共 8 张 96×66，约 200KB 显存），`this.desks` 按 `desk.facing` 取自己那一对；`setSeatOccupied()` 仍按 `seat.desk` 切 idle / lit，逻辑不变。
- 关键约束：不使用 `sprite.scale.x = -1` 做镜像（ADR-0005：负缩放会把 1px 描边拉成半像素），镜像必须在烘焙时按坐标绘制。

### 3. 朝向权威保持不变，只补回归保护
- 客户端 `session.ts` `sitAt()` 已写 `Motion.direction[eid] = seat.facing`；服务端 `SeatRegistry.occupy()` 已写 `applyState(seat.facing, ...)`；`applyMove()` 在座位上已忽略上报的 direction。本次不改这条链路，只补测试锁死。

### 4. 测试不变量
- shared-types：每张工位桌 `desk.facing === seat.facing`；椅子相对桌心的偏移严格等于「−朝向向量 ×（半宽/半高 + 20）」，垂直方向偏移为 0；所有床朝向一致且为水平朝向（对应枕头位置）；每张凳子朝向 Down 且南侧 80px 内有茶几。
- web（bun）：`deskArtFor` 四个朝向返回互不相同的显示器矩形，且矩形中心分别落在桌子对应的远边（Up 在北、Down 在南、Left 在西、Right 在东）。
- server：`movePacket` 辅助函数加 direction 参数，新增「坐姿时上报其它朝向，`player.direction` 仍等于 `seat.facing`」。

## 性能与可靠性
- 初始化烘焙从 2 张变 8 张，一次性成本可忽略；帧循环不新增分支、不新增分配，每张桌子仍是一个 Sprite 一次贴图切换。
- 沿用 `desk.y + DESK_H / 2` 的深度排序与既有裁剪 pad，四向贴图同尺寸，排序与剔除行为不变。
- 数据层新增必填字段会让漏改的构造点直接编译失败，避免运行期静默退化为「四向贴图全一样」。

## 架构与目录（只列受影响文件）

```
niuma/
├── packages/shared-types/src/world/
│   ├── campus.ts        # [MODIFY] DeskInstance 加 facing；新增 workstation()；WORKSTATIONS 与 LOUNGE_SEATS 凳子朝向
│   └── layout.ts        # [MODIFY] officeWorkstations() 改用 workstation()，四排工位各自带朝向
├── packages/shared-types/src/__tests__/
│   └── seats.test.ts    # [MODIFY] 工位桌/椅朝向一致性、椅子偏移、床位枕头、凳子朝向茶几
├── apps/web/lib/game/
│   ├── desk-art.ts      # [NEW] 四向显示器几何纯函数，不依赖 pixi，可单测
│   ├── props.ts         # [MODIFY] drawDesk 按朝向绘制；build() 按 facing 烘焙 8 张贴图并分派
│   └── __tests__/desk-art.test.ts  # [NEW] 四向几何断言：显示器贴住背对椅子的那条边
├── apps/game-server/src/sim/
│   └── seats.test.ts    # [MODIFY] 座位上报其它朝向不改写朝向
└── docs/adr/
    └── 0027-seat-facing-and-desk-art.md  # [NEW] 座位朝向权威 + 四向桌贴图决策、回滚方式
```

## 关键结构

```ts
/** 工位桌：facing = 屏幕朝向 = 入座者面朝方向，椅子永远在相反一侧 */
export interface DeskInstance {
  x: number;
  y: number;
  facing: Direction;
}

export function workstation(
  x: number,
  y: number,
  facing: Direction,
): { desk: DeskInstance; seat: { x: number; y: number; facing: Direction } };
```

```ts
export type DeskScreenSide = 'front' | 'back' | 'left' | 'right';

export interface DeskArt {
  /** 显示器在本帧内的矩形（左上角 + 宽高），必须贴住桌子背对椅子的那条边 */
  monitor: { x: number; y: number; w: number; h: number };
  /** front = 朝镜头（现状）、back = 看到背壳、left/right = 侧视 */
  screen: DeskScreenSide;
}

export function deskArtFor(facing: Direction): DeskArt;
```

## Agent Extensions

### Skill
- **domain-modeling**
  - Purpose: 按项目既有 ADR 格式撰写 0027，记录「座位朝向是服务端权威 + 工位桌四向贴图」的决策、权衡与回滚路径。
  - Expected outcome: `docs/adr/0027-seat-facing-and-desk-art.md`，编号连续、不改写历史 ADR。

- **test-driven-development**
  - Purpose: 先写工位桌/椅朝向、椅子偏移、床位枕头、凳子茶几与四向桌几何的失败测试，再改数据与绘制代码。
  - Expected outcome: 新增不变量测试先红后绿，防止后续布局或美术改动重新引入「侧坐 / 正面朝镜头」。

- **verification-before-completion**
  - Purpose: 交付前实际运行 `pnpm typecheck` 与 `pnpm test`，并核对四个朝向的工位观感，禁止无证据声称完成。
  - Expected outcome: 类型检查与全部测试通过的真实输出，以及四向工位、凳子与床位的目视确认结论。
