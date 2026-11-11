import { describe, expect, it } from 'bun:test';
import { POSE, WORLD_LAYOUT, type PropKind } from '@niuma/shared-types';
import {
  INTERACT_RANGE,
  SNORE_FIRST_MS,
  SNORE_INTERVAL_MS,
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
