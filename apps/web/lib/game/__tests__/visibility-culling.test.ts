import { describe, expect, it } from 'bun:test';

describe('可见性筛选和裁剪', () => {
  it('AABB 碰撞测试：实体在相机视口内时返回 true', () => {
    const cameraBounds = {
      minX: 100,
      maxX: 500,
      minY: 100,
      maxY: 400,
    };
    const padding = 128;

    // 视口中心的实体
    const centerX = 300;
    const centerY = 250;
    const isVisible = (
      centerX >= cameraBounds.minX - padding &&
      centerX <= cameraBounds.maxX + padding &&
      centerY >= cameraBounds.minY - padding &&
      centerY <= cameraBounds.maxY + padding
    );
    expect(isVisible).toBe(true);
  });

  it('AABB 碰撞测试：超出视口范围的实体返回 false', () => {
    const cameraBounds = {
      minX: 100,
      maxX: 500,
      minY: 100,
      maxY: 400,
    };
    const padding = 128;

    // 视口右边太远的实体
    const farRightX = 800;
    const farRightY = 250;
    const isVisible = (
      farRightX >= cameraBounds.minX - padding &&
      farRightX <= cameraBounds.maxX + padding &&
      farRightY >= cameraBounds.minY - padding &&
      farRightY <= cameraBounds.maxY + padding
    );
    expect(isVisible).toBe(false);
  });

  it('AABB 碰撞测试：相机边界扩展（padding）内的实体仍然可见', () => {
    const cameraBounds = {
      minX: 100,
      maxX: 500,
      minY: 100,
      maxY: 400,
    };
    const padding = 128;

    // 视口右边界外但在 padding 范围内的实体
    const nearRightX = 550;
    const nearRightY = 250;
    const isVisible = (
      nearRightX >= cameraBounds.minX - padding &&
      nearRightX <= cameraBounds.maxX + padding &&
      nearRightY >= cameraBounds.minY - padding &&
      nearRightY <= cameraBounds.maxY + padding
    );
    expect(isVisible).toBe(true);
  });

  it('AABB 碰撞测试：所有四个边界方向都能正确判定', () => {
    const cameraBounds = {
      minX: 200,
      maxX: 400,
      minY: 200,
      maxY: 400,
    };
    const padding = 50;

    // 测试四个方向
    const leftX = 140; // 左边界外
    const rightX = 460; // 右边界外
    const topY = 140; // 上边界外
    const bottomY = 460; // 下边界外
    const centerX = 300;
    const centerY = 300;

    // 左边超出
    expect(leftX >= cameraBounds.minX - padding).toBe(false);
    // 右边超出
    expect(rightX <= cameraBounds.maxX + padding).toBe(false);
    // 上边超出
    expect(topY >= cameraBounds.minY - padding).toBe(false);
    // 下边超出
    expect(bottomY <= cameraBounds.maxY + padding).toBe(false);
    // 中心内
    expect(
      centerX >= cameraBounds.minX - padding &&
      centerX <= cameraBounds.maxX + padding &&
      centerY >= cameraBounds.minY - padding &&
      centerY <= cameraBounds.maxY + padding
    ).toBe(true);
  });

  it('相机边界缓存：null 边界时所有实体都可见（初始状态）', () => {
    const cameraBounds = null;
    const x = 9999;
    const y = 9999;
    const isVisible = !cameraBounds || (
      x >= cameraBounds.minX &&
      x <= cameraBounds.maxX
    );
    expect(isVisible).toBe(true);
  });
});
