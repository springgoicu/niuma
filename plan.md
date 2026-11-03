# P2：客户端移动发送时钟独立化 - 实现计划

## 概述
将网络发送与渲染帧率解耦，确保低帧率设备下的移动体验和一致性。

## 具体实现步骤

### Phase 1: 扩展网络协议（packages/shared-types）
- [ ] `src/types.ts`: 扩展 `MovePacket` 接口添加：
  - `clientSequence: number` - 单调递增序号（防重复）
  - `clientTimestampMs: number` - 客户端时间戳（延迟估计）

### Phase 2: 客户端改动 (apps/web/lib/game/session.ts)
- [ ] 在 `GameSession` 类中添加字段：
  - `private movementSendTime = 0` - 发送计时器累积值
  - `private clientMoveSequence = 0` - 移动序号计数器
  - `private readonly MOVEMENT_SEND_INTERVAL = 50` - 固定 50ms 间隔

- [ ] 修改 `tick()` 方法：
  - 保留现有的本地预测逻辑（使用 dt，帧率无关）
  - 将发送逻辑从时间戳比较改为累积计时器
  - 添加序号和时间戳到发送包

### Phase 3: 网络协议编解码更新 (packages/shared-types/src/protocol.ts)
- [ ] 更新 `encodeMove()` 函数以序列化新字段
- [ ] 更新 `decodeMove()` 函数以反序列化新字段
- [ ] 更新编码格式：添加 2 字节序号 + 4 字节时间戳

### Phase 4: 网络客户端改动 (apps/web/lib/net/client.ts)
- [ ] 修改 `sendMove()` 方法签名，接收序号和时间戳
- [ ] 传递给 `encodeMove()` 

### Phase 5: 服务端改动（可选，但建议）(apps/game-server/src/sim/movement.ts)
- [ ] 更新 `applyMove()` 函数签名以处理新字段
- [ ] 实现序号检验：丢弃低于上次已处理的序号
- [ ] 实现时间戳校准（可选）

### Phase 6: 向后兼容性
- [ ] 确保新协议格式是可扩展的
- [ ] 旧客户端连接时不发送序号/时间戳
- [ ] 服务端应有默认处理新字段的逻辑

### Phase 7: 测试与验证
- [ ] 编译无 TypeScript 错误
- [ ] 运行现有测试 (pnpm test)
- [ ] 验证移动发送频率稳定在 ~20 Hz
- [ ] 低帧率场景下测试响应延迟

## 文件修改清单
1. `packages/shared-types/src/types.ts` - MovePacket 扩展
2. `packages/shared-types/src/protocol.ts` - encodeMove/decodeMove 更新
3. `apps/web/lib/game/session.ts` - 客户端时钟与序号逻辑
4. `apps/web/lib/net/client.ts` - sendMove 签名调整
5. `apps/game-server/src/sim/movement.ts` - 服务端序号检验
6. `packages/shared-types/src/__tests__/protocol.test.ts` - 协议测试更新

## 关键考虑
- 保留 50ms 默认间隔（行业标准）
- 本地预测继续使用渲染 dt（不受网络影响）
- 客户端序号仅用于防重复，服务端可选实现
- 与现有逻辑兼容，不破坏其他功能

## 验收条件
- ✅ 编译通过（0 TS 错误）
- ✅ 所有现有测试通过
- ✅ 移动包发送频率 ~20 Hz（±5%）
- ✅ 低帧率设备无明显延迟增加
- ✅ 协议向后兼容
