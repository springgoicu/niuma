'use client';

const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);
const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/**
 * 可编辑元素：键按下去属于输入，不属于游戏。
 * 除了输入框与文本域，下拉框与 contenteditable 同样会消费字母键。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export type ActionKey = 'sit' | 'lie' | 'emote' | 'jump' | 'wave' | 'interact';

export class InputController {
  private readonly pressed = new Set<string>();
  private touchX = 0;
  private touchY = 0;
  /** 每帧都要读一次方向，输出槽复用以避免每帧一个字面量 */
  private readonly out = { x: 0, y: 0 };
  private detachFns: Array<() => void> = [];

  attach(onAction: (action: ActionKey) => void, onChat: () => void): void {
    const onKeyDown = (event: KeyboardEvent) => {
      // 输入法组合态：C / Z / X / 空格的 keydown 属于选词，不是游戏动作。
      // 不同浏览器分别报 isComposing 与 keyCode 229，两个都要判。
      if (event.isComposing || event.keyCode === 229) return;
      const inField = isEditableTarget(event.target);
      // 小键盘 Enter 与主键盘 Enter 同效，否则外接全尺寸键盘按了没反应
      if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !inField) {
        event.preventDefault();
        // 打开聊天前清空仍按住的移动键：面板接管键盘后角色不该继续滑行（ADR-0023 §6）
        this.pressed.clear();
        onChat();
        return;
      }
      if (inField) return;
      if (BLOCKED.has(event.code)) event.preventDefault();
      // Ctrl/Cmd/Alt 组合交给浏览器（撤销、搜索等），不当动作键
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // pressed 必须维护：长按移动靠它，重复 keydown 只是不能重复派发动作，
      // 否则按住 Z 会来回坐/起，按住 C 会把叫唤无限重播
      this.pressed.add(event.code);
      if (event.repeat) return;

      if (event.code === 'KeyZ') onAction('sit');
      else if (event.code === 'KeyX') onAction('lie');
      else if (event.code === 'KeyC') onAction('emote');
      // E 贴着 WASD，且不在页面快捷键里：抬手打招呼
      else if (event.code === 'KeyE') onAction('wave');
      // F 贴着 WASD 另一侧：取饮料 / 接水 / 打咖啡
      else if (event.code === 'KeyF') onAction('interact');
      // 空格本来就在 BLOCKED 里（防止页面滚动），正好拿来当跳跃键
      else if (event.code === 'Space') onAction('jump');
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

  /** 返回的是复用槽位：只在当帧有效，调用方不要保存引用 */
  vector(): Readonly<{ x: number; y: number }> {
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
    // 触屏摇杆与键盘叠加：合成后长度钳到 1，避免双输入时比键盘跑得更快
    x += this.touchX;
    y += this.touchY;
    const length = Math.sqrt(x * x + y * y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.out.x = x;
    this.out.y = y;
    return this.out;
  }

  /** 触屏摇杆的方向，取值范围 -1..1（屏幕坐标，y 向下为正） */
  setTouchVector(x: number, y: number): void {
    this.touchX = x;
    this.touchY = y;
  }

  clear(): void {
    this.pressed.clear();
  }
}
