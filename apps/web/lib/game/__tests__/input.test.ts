import { describe, expect, it } from 'bun:test';
import { ACTION_BY_CODE, ACTION_CODE, directionFromMask, keyBit, type ActionKey } from '../input';
import { KEY_BIT } from '../runtime/control-channel';

function move(mask: number, touchX = 0, touchY = 0): { x: number; y: number } {
  return directionFromMask(mask, touchX, touchY, { x: 0, y: 0 });
}

describe('方向解算', () => {
  it('四个方向各自是单位向量', () => {
    expect(move(KEY_BIT.up)).toEqual({ x: 0, y: -1 });
    expect(move(KEY_BIT.down)).toEqual({ x: 0, y: 1 });
    expect(move(KEY_BIT.left)).toEqual({ x: -1, y: 0 });
    expect(move(KEY_BIT.right)).toEqual({ x: 1, y: 0 });
  });

  it('相反方向互相抵消', () => {
    expect(move(KEY_BIT.up | KEY_BIT.down)).toEqual({ x: 0, y: 0 });
    expect(move(KEY_BIT.left | KEY_BIT.right)).toEqual({ x: 0, y: 0 });
  });

  it('斜向归一化：长度仍是 1，不比直线快', () => {
    const diagonal = move(KEY_BIT.up | KEY_BIT.right);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 9);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(diagonal.y).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('摇杆叠加后长度钳到 1', () => {
    const combined = move(KEY_BIT.right, 1, 0.4);
    expect(Math.hypot(combined.x, combined.y)).toBeCloseTo(1, 9);
    expect(combined.x).toBeGreaterThan(0.9);
  });

  it('纯摇杆原样输出（未越界时不缩放）', () => {
    const stick = move(0, 0.3, -0.4);
    expect(stick.x).toBeCloseTo(0.3, 9);
    expect(stick.y).toBeCloseTo(-0.4, 9);
  });

  it('输出写进调用方给的槽位，不产生新对象', () => {
    const slot = { x: 9, y: 9 };
    const result = directionFromMask(KEY_BIT.down, 0, 0, slot);
    expect(result).toBe(slot);
    expect(slot).toEqual({ x: 0, y: 1 });
  });
});

describe('键盘映射', () => {
  it('WASD 与方向键等价，非移动键返回 0', () => {
    expect(keyBit('KeyW')).toBe(keyBit('ArrowUp'));
    expect(keyBit('KeyA')).toBe(keyBit('ArrowLeft'));
    expect(keyBit('KeyS')).toBe(keyBit('ArrowDown'));
    expect(keyBit('KeyD')).toBe(keyBit('ArrowRight'));
    expect(keyBit('KeyE')).toBe(0);
    expect(keyBit('Enter')).toBe(0);
  });
});

describe('动作码', () => {
  it('每个动作都有唯一数字编号，并能反查回同一个动作', () => {
    const seen = new Set<number>();
    for (const key of Object.keys(ACTION_CODE) as ActionKey[]) {
      const code = ACTION_CODE[key];
      expect(seen.has(code)).toBe(false);
      seen.add(code);
      expect(ACTION_BY_CODE[code]).toBe(key);
    }
    // 动作环用 0 表示「没有动作」，编号必须避开它
    expect(seen.has(0)).toBe(false);
  });
});
