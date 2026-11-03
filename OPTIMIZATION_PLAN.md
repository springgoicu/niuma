# P1: 可见性筛选和裁剪优化

## 概述
通过减少每帧遍历和渲染的实体数量，改进多人场景性能。

## 实现步骤

### 1. 在 GameRenderer 中添加相机状态缓存
**文件**: `apps/web/lib/game/renderer.ts`

添加字段来保存当前相机的可见范围：
- `private cameraBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;`
- 在 `updateCamera` 中计算并保存相机视口（含裁剪余量 CULL_PAD）

### 2. 在 GameRenderer 中添加可见性判定方法
**文件**: `apps/web/lib/game/renderer.ts`

添加 `isEntityVisible(x: number, y: number): boolean` 方法：
- 检查实体是否在当前相机的可见范围内
- 使用简单的 AABB 碰撞测试
- 可见范围 = 视口矩形 + CULL_PAD

### 3. 优化 syncOccluders 方法
**文件**: `apps/web/lib/game/renderer.ts` (行 372-385)

改为只处理可见实体：
- 遍历前检查相机边界是否已初始化
- 对每个实体调用 `isEntityVisible` 检查
- 只将可见实体写入 occluders 数组

### 4. 在 Session 中优化实体更新循环
**文件**: `apps/web/lib/game/session.ts` (行 350-368)

对实体更新进行优化：
- 获取当前相机状态（从 renderer 中读取）
- 只对可见实体执行 setPose、setMotion 等操作
- 远处实体可选：降低更新频率（延迟实现）

### 5. 添加 getter 方法供 Session 查询
**文件**: `apps/web/lib/game/renderer.ts`

添加 public getter 导出相机边界信息：
- `getCameraBounds()` 返回当前相机的可见范围

## 验收条件
- ✅ 编译通过，无 TypeScript 错误
- ✅ 现有测试全部通过
- ✅ 可见性判定逻辑正确
- ✅ 性能可观测提升（100+ 人场景下 FPS 改善）

## 关键考虑
- 保留现有动画系统和容器层级
- 不修改 Pixi Canvas 尺寸或基本配置
- 可见性检查只影响更新频率，不影响最终渲染结果
- 提交前验证所有现有功能仍正常工作
