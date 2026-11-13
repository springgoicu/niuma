import { describe, expect, it } from 'bun:test';
import {
  BULLETIN_BOARD,
  DIRECTION,
  PARK_SLIDE,
  POSE,
  SLIDE_INTERACT_RANGE,
  WELCOME_LANDMARKS,
  WORLD_LAYOUT,
  type PropKind,
} from '@niuma/shared-types';
import {
  BULLETIN_INTERACT_RANGE,
  BOARD_INTERACT_RANGE,
  INTERACT_RANGE,
  SNORE_FIRST_MS,
  SNORE_INTERVAL_MS,
  facesBulletin,
  isBulletinHit,
  isNearBulletin,
  isNearRankBoard,
  isNearSlide,
  isSlideHit,
  nearestInteractiveProp,
  pickLine,
  snoreDue,
} from '../interactions';

function propOf(kind: PropKind) {
  const prop = WORLD_LAYOUT.props.find((item) => item.kind === kind);
  if (!prop) throw new Error(`布局里没有 ${kind}`);
  return prop;
}

describe('可互动设施', () => {
  it('站在售货机旁能找到它', () => {
    const vending = propOf('vending');
    expect(nearestInteractiveProp(vending.x, vending.y + 20)?.kind).toBe('vending');
  });

  it('超出互动半径返回 null', () => {
    const vending = propOf('vending');
    expect(nearestInteractiveProp(vending.x + INTERACT_RANGE + 12, vending.y)).toBeNull();
  });

  it('工作区的饮水机与咖啡机同样可互动', () => {
    const cooler = propOf('cooler');
    const coffee = propOf('coffee');
    expect(nearestInteractiveProp(cooler.x, cooler.y)?.kind).toBe('cooler');
    expect(nearestInteractiveProp(coffee.x, coffee.y)?.kind).toBe('coffee');
  });

  it('非有限坐标不返回设施', () => {
    expect(nearestInteractiveProp(Number.NaN, 0)).toBeNull();
  });

  it('台词按次数轮转，且同一次数永远同一句', () => {
    expect(pickLine('vending', 0)).toBe(pickLine('vending', 0));
    expect(pickLine('vending', 0)).not.toBe(pickLine('vending', 1));
    expect(pickLine('vending', -3)).toBe(pickLine('vending', 3));
  });
});

describe('牛马榜公告栏', () => {
  it('站在牌面正前与两侧 96px 内都能按 F', () => {
    const board = WELCOME_LANDMARKS.rankBoard;
    expect(isNearRankBoard(board.x, board.y)).toBe(true);
    expect(isNearRankBoard(board.x, board.y + BOARD_INTERACT_RANGE)).toBe(true);
    expect(isNearRankBoard(board.x - 60, board.y + 40)).toBe(true);
    expect(isNearRankBoard(board.x + 60, board.y + 40)).toBe(true);
  });

  it('离开牌面超过半径就收不到提示', () => {
    const board = WELCOME_LANDMARKS.rankBoard;
    expect(isNearRankBoard(board.x, board.y + BOARD_INTERACT_RANGE + 1)).toBe(false);
    expect(isNearRankBoard(Number.NaN, board.y)).toBe(false);
    expect(isNearRankBoard(board.x, board.y, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('放假告示板（ADR-0059）', () => {
  const foot = { x: BULLETIN_BOARD.x, y: BULLETIN_BOARD.y };
  const face = { x: foot.x, y: BULLETIN_BOARD.y - BULLETIN_BOARD.height / 2 };

  it('64px 内才算站在板前，边缘多 1px 就失效', () => {
    expect(BULLETIN_INTERACT_RANGE).toBe(64);
    expect(isNearBulletin(foot.x, foot.y)).toBe(true);
    expect(isNearBulletin(foot.x, foot.y + BULLETIN_INTERACT_RANGE)).toBe(true);
    expect(isNearBulletin(foot.x, foot.y + BULLETIN_INTERACT_RANGE + 1)).toBe(false);
    expect(isNearBulletin(foot.x - 40, foot.y - 40)).toBe(true);
    expect(isNearBulletin(Number.NaN, foot.y)).toBe(false);
    expect(isNearBulletin(foot.x, foot.y, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('面朝板面才提示：从南边要朝上，从北边要朝下，背对不算', () => {
    // 站在南侧（脚底 y 更大）朝北
    expect(facesBulletin(face.x, foot.y + 40, DIRECTION.Up)).toBe(true);
    expect(facesBulletin(face.x, foot.y + 40, DIRECTION.Down)).toBe(false);
    // 站在北侧朝南
    expect(facesBulletin(face.x, BULLETIN_BOARD.y - 70, DIRECTION.Down)).toBe(true);
    // 站在西侧朝东，斜一格也认
    expect(facesBulletin(foot.x - 50, face.y + 10, DIRECTION.Right)).toBe(true);
    expect(facesBulletin(foot.x - 50, face.y + 10, DIRECTION.Left)).toBe(false);
    // 站在牌面正中：视为面对面
    expect(facesBulletin(face.x, face.y, DIRECTION.Up)).toBe(true);
  });

  it('点击命中整块牌面，底座以下与牌面之外都不算', () => {
    const left = foot.x - BULLETIN_BOARD.width / 2;
    const top = BULLETIN_BOARD.y - BULLETIN_BOARD.height;
    expect(isBulletinHit(foot.x, foot.y - 10)).toBe(true);
    expect(isBulletinHit(left, top)).toBe(true);
    expect(isBulletinHit(left + BULLETIN_BOARD.width, top)).toBe(true);
    expect(isBulletinHit(left - 1, top)).toBe(false);
    expect(isBulletinHit(foot.x, top - 1)).toBe(false);
    expect(isBulletinHit(foot.x, foot.y + 1)).toBe(false);
    expect(isBulletinHit(Number.NaN, foot.y)).toBe(false);
  });

  it('与牛马榜的感应区不重叠：两块牌子各认各的', () => {
    expect(isNearBulletin(WELCOME_LANDMARKS.rankBoard.x, WELCOME_LANDMARKS.rankBoard.y)).toBe(false);
    expect(isNearRankBoard(foot.x, foot.y)).toBe(false);
  });
});

describe('游乐园入口滑梯', () => {
  it('点击命中整块滑梯精灵（塔楼 + 滑道），矩形之外不算', () => {
    const { x, y, w, h } = PARK_SLIDE.hit;
    expect(isSlideHit(x + w / 2, y + h / 2)).toBe(true);
    expect(isSlideHit(x, y)).toBe(true);
    expect(isSlideHit(x + w, y + h)).toBe(true);
    expect(isSlideHit(x - 1, y + h / 2)).toBe(false);
    expect(isSlideHit(x + w / 2, y + h + 1)).toBe(false);
    expect(isSlideHit(Number.NaN, y)).toBe(false);
  });

  it('感应区只认落地点：站在缓冲区旁才滑，站远一格只提示', () => {
    expect(isNearSlide(PARK_SLIDE.landing.x, PARK_SLIDE.landing.y)).toBe(true);
    expect(isNearSlide(PARK_SLIDE.landing.x + SLIDE_INTERACT_RANGE, PARK_SLIDE.landing.y)).toBe(true);
    expect(isNearSlide(PARK_SLIDE.landing.x + SLIDE_INTERACT_RANGE + 1, PARK_SLIDE.landing.y)).toBe(false);
    expect(isNearSlide(PARK_SLIDE.landing.x, PARK_SLIDE.landing.y - 200)).toBe(false);
    expect(isNearSlide(Number.NaN, 0)).toBe(false);
  });

  it('站在落地点、点击滑道中段是唯一合法的组合', () => {
    expect(isNearSlide(PARK_SLIDE.landing.x, PARK_SLIDE.landing.y)).toBe(true);
    expect(isSlideHit(PARK_SLIDE.hit.x + PARK_SLIDE.hit.w / 2, PARK_SLIDE.hit.y + 40)).toBe(true);
  });
});

describe('躺床打呼', () => {
  it('躺下不足 5s 不打呼', () => {
    expect(snoreDue(POSE.Lie, 'bed', SNORE_FIRST_MS - 1, SNORE_INTERVAL_MS)).toBe(false);
  });

  it('躺够 5s 且离上次满 9s 才打呼', () => {
    expect(snoreDue(POSE.Lie, 'bed', SNORE_FIRST_MS, SNORE_INTERVAL_MS)).toBe(true);
    expect(snoreDue(POSE.Lie, 'bed', SNORE_FIRST_MS + 1000, SNORE_INTERVAL_MS - 1)).toBe(false);
  });

  it('只有床位躺姿才打呼：坐姿、凳子与地面躺都不算', () => {
    expect(snoreDue(POSE.Sit, 'stool', SNORE_FIRST_MS * 2, SNORE_INTERVAL_MS * 2)).toBe(false);
    expect(snoreDue(POSE.Lie, 'stool', SNORE_FIRST_MS * 2, SNORE_INTERVAL_MS * 2)).toBe(false);
    expect(snoreDue(POSE.Lie, null, SNORE_FIRST_MS * 2, SNORE_INTERVAL_MS * 2)).toBe(false);
  });
});
