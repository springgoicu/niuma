import { KEY_BIT } from './runtime/control-channel';

/**
 * 动作键的语义编号。跨线程传输用数字（见 `runtime/control-channel.ts` 的动作环），
 * 组件层仍然按字符串识别，两边靠 `ACTION_CODE` / `ACTION_BY_CODE` 互转。
 */
export type ActionKey = 'sit' | 'lie' | 'vent' | 'jump' | 'wave' | 'interact' | 'graze';

export const ACTION_CODE: Readonly<Record<ActionKey, number>> = {
  sit: 1,
  lie: 2,
  // 编号沿用旧「叫唤」的 3：动作环是跨线程共享内存，改编号要两端同时上线
  vent: 3,
  jump: 4,
  wave: 5,
  interact: 6,
  graze: 7,
};

export const ACTION_BY_CODE: Readonly<Record<number, ActionKey>> = {
  1: 'sit',
  2: 'lie',
  3: 'vent',
  4: 'jump',
  5: 'wave',
  6: 'interact',
  7: 'graze',
};

/** 键盘 `event.code` → 方向位；非移动键返回 0 */
export function keyBit(code: string): number {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return KEY_BIT.up;
    case 'ArrowDown':
    case 'KeyS':
      return KEY_BIT.down;
    case 'ArrowLeft':
    case 'KeyA':
      return KEY_BIT.left;
    case 'ArrowRight':
    case 'KeyD':
      return KEY_BIT.right;
    default:
      return 0;
  }
}

export interface MoveVector {
  x: number;
  y: number;
}

/**
 * 按键掩码 + 触屏摇杆 → 归一化移动向量。
 *
 * 纯函数、输出槽复用：渲染线程每帧调用一次，不产生任何对象。
 * 斜向先归一化（避免比直线快 √2 倍），叠加摇杆后再把长度钳到 1，
 * 双输入同时按下时不会比单用键盘跑得更快。
 */
export function directionFromMask(mask: number, touchX: number, touchY: number, out: MoveVector): MoveVector {
  let x = 0;
  let y = 0;
  if ((mask & KEY_BIT.up) !== 0) y -= 1;
  if ((mask & KEY_BIT.down) !== 0) y += 1;
  if ((mask & KEY_BIT.left) !== 0) x -= 1;
  if ((mask & KEY_BIT.right) !== 0) x += 1;
  if (x !== 0 && y !== 0) {
    const inv = Math.SQRT1_2;
    x *= inv;
    y *= inv;
  }
  x += touchX;
  y += touchY;
  const length = Math.sqrt(x * x + y * y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  out.x = x;
  out.y = y;
  return out;
}
