import { describe, expect, it } from 'vitest';
import { propSolid } from '../world/campus';
import { isBlocked } from '../world/collision';
import {
  BULLETIN_BOARD,
  BULLETIN_BOARD_SOLID,
  PLANTER_RADIUS,
  SPAWN_CENTER,
  SPAWN_RADIUS,
  WELCOME_LANDMARKS,
  WORLD_CENTER,
  WORLD_LAYOUT,
  isOnPlaza,
  regionAt,
} from '../world/layout';

/**
 * 放假告示板不变量（ADR-0059）：
 *
 * 牌面 80×48、底座 80×20；出生点抬头即见但不挡北向主路；
 * 只挡底座，玩家能从上方、左侧、右侧贴近读跑马灯；
 * 坐标与碰撞单点定义，不允许出现第二份道具尺寸表。
 */

const FACE = {
  x: BULLETIN_BOARD.x - BULLETIN_BOARD.width / 2,
  y: BULLETIN_BOARD.y - BULLETIN_BOARD.height,
  w: BULLETIN_BOARD.width,
  h: BULLETIN_BOARD.height,
};

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('牛马放假告示板（ADR-0059）', () => {
  it('80×48 牌面与贴地 80×20 底座是同一条常量派生的', () => {
    expect(BULLETIN_BOARD).toEqual({ x: 4232, y: 3832, width: 80, height: 48 });
    expect(BULLETIN_BOARD_SOLID).toEqual({ x: 4192, y: 3812, w: 80, h: 20 });
    // 底座贴住牌面底边，宽度与牌面一致
    expect(BULLETIN_BOARD_SOLID.x + BULLETIN_BOARD_SOLID.w).toBe(FACE.x + FACE.w);
    expect(BULLETIN_BOARD_SOLID.y + BULLETIN_BOARD_SOLID.h).toBe(BULLETIN_BOARD.y);
  });

  it('只挡底座：上方、左侧、右侧都能贴近', () => {
    // 底座内部挡人
    expect(isBlocked(BULLETIN_BOARD.x, BULLETIN_BOARD.y - 8, 0)).toBe(true);
    // 牌面本体不挡人（只有精灵）
    expect(isBlocked(BULLETIN_BOARD.x, BULLETIN_BOARD.y - 30, 0)).toBe(false);
    // 左右两侧各留出贴身位置
    expect(isBlocked(BULLETIN_BOARD_SOLID.x - 12, BULLETIN_BOARD.y - 8, 0)).toBe(false);
    expect(isBlocked(BULLETIN_BOARD_SOLID.x + BULLETIN_BOARD_SOLID.w + 12, BULLETIN_BOARD.y - 8, 0)).toBe(false);
    // 正上方绕到板后
    expect(isBlocked(BULLETIN_BOARD.x, FACE.y - 10, 0)).toBe(false);
  });

  it('立在广场北缘，出生点一眼可见且不侵入 56px 出生圈', () => {
    expect(isOnPlaza(BULLETIN_BOARD.x, BULLETIN_BOARD.y - 24)).toBe(true);
    expect(regionAt(BULLETIN_BOARD.x, BULLETIN_BOARD.y - 24)).toBe('中央迎宾广场');
    // 与出生点同在北侧，但不是贴脸：至少留出生圈 + 100px
    for (const corner of [
      [FACE.x, FACE.y],
      [FACE.x + FACE.w, FACE.y],
      [FACE.x, BULLETIN_BOARD.y],
      [FACE.x + FACE.w, BULLETIN_BOARD.y],
    ] as const) {
      expect(Math.hypot(corner[0] - SPAWN_CENTER.x, corner[1] - SPAWN_CENTER.y)).toBeGreaterThan(SPAWN_RADIUS + 100);
    }
  });

  it('牌面四角不出广场圆，也不压北向主路', () => {
    expect(WORLD_CENTER).toEqual({ x: 4096, y: 4096 });
    for (const [x, y] of [
      [FACE.x, FACE.y],
      [FACE.x + FACE.w, FACE.y],
      [FACE.x, FACE.y + FACE.h],
      [FACE.x + FACE.w, FACE.y + FACE.h],
    ] as const) {
      expect(isOnPlaza(x, y)).toBe(true);
    }
    // 北向主路通道 4040–4152（112px）：从广场北缘一路到广场外都必须是空的
    for (let y = WORLD_CENTER.y - 360; y <= BULLETIN_BOARD.y; y += 8) {
      for (const x of [4040, 4096, 4152]) {
        expect(isBlocked(x, y, 0)).toBe(false);
      }
    }
  });

  it('与牛马榜、花箱及其他碰撞盒都不重叠', () => {
    const rankBoardSolid = {
      x: WELCOME_LANDMARKS.rankBoard.x - 60,
      y: WELCOME_LANDMARKS.rankBoard.y - 18,
      w: 120,
      h: 18,
    };
    expect(overlaps(BULLETIN_BOARD_SOLID, rankBoardSolid)).toBe(false);

    let selfCount = 0;
    for (const solid of WORLD_LAYOUT.solids) {
      const self =
        solid.x === BULLETIN_BOARD_SOLID.x &&
        solid.y === BULLETIN_BOARD_SOLID.y &&
        solid.w === BULLETIN_BOARD_SOLID.w &&
        solid.h === BULLETIN_BOARD_SOLID.h;
      if (self) {
        selfCount += 1;
        expect(solid.kind).toBe('prop');
        continue;
      }
      expect(overlaps(BULLETIN_BOARD_SOLID, solid)).toBe(false);
    }
    expect(selfCount).toBe(1);

    for (const planter of WORLD_LAYOUT.planters) {
      const nx = Math.max(BULLETIN_BOARD_SOLID.x, Math.min(planter.x, BULLETIN_BOARD_SOLID.x + BULLETIN_BOARD_SOLID.w));
      const ny = Math.max(BULLETIN_BOARD_SOLID.y, Math.min(planter.y, BULLETIN_BOARD_SOLID.y + BULLETIN_BOARD_SOLID.h));
      expect(Math.hypot(planter.x - nx, planter.y - ny)).toBeGreaterThan(PLANTER_RADIUS);
    }
  });

  it('道具只登记一块，尺寸不再抄进 PROP_FOOTPRINT', () => {
    const boards = WORLD_LAYOUT.props.filter((prop) => prop.kind === 'bulletin');
    expect(boards).toHaveLength(1);
    expect(boards[0]).toEqual({ kind: 'bulletin', x: BULLETIN_BOARD.x, y: BULLETIN_BOARD.y });
    // 底座碰撞来自 layout 的显式登记，不由道具尺寸推导
    expect(propSolid(boards[0]!)).toBeUndefined();
  });
});
