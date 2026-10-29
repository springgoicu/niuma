'use client';

const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export type ActionKey = 'sit' | 'lie' | 'emote';

export class InputController {
  private readonly pressed = new Set<string>();
  private detachFns: Array<() => void> = [];

  attach(onAction: (action: ActionKey) => void, onChat: () => void): void {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (event.code === 'Enter' && !inField) {
        event.preventDefault();
        onChat();
        return;
      }
      if (inField) return;
      if (BLOCKED.has(event.code)) event.preventDefault();
      this.pressed.add(event.code);

      if (event.code === 'KeyZ') onAction('sit');
      else if (event.code === 'KeyX') onAction('lie');
      else if (event.code === 'KeyC') onAction('emote');
    };

    const onKeyUp = (event: KeyboardEvent) => {
      this.pressed.delete(event.code);
    };

    const onBlur = () => this.pressed.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.detachFns = [
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    ];
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
    this.pressed.clear();
  }

  vector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      if (UP_KEYS.has(code)) y -= 1;
      else if (DOWN_KEYS.has(code)) y += 1;
      else if (LEFT_KEYS.has(code)) x -= 1;
      else if (RIGHT_KEYS.has(code)) x += 1;
    }
    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  clear(): void {
    this.pressed.clear();
  }
}
