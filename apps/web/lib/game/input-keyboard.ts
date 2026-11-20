import { ACTION_CODE, keyBit, type ActionKey } from './input';
import { KEY_BIT, type ControlWriter } from './runtime/control-channel';

/** 页面滚动键：浏览器默认行为会让画面跳一下，按下就吞掉 */
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/**
 * 可编辑元素：键按下去属于输入，不属于游戏。
 * 除了输入框与文本域，下拉框与 contenteditable 同样会消费字母键。
 *
 * 这一层留在主线程是刻意的：输入法组合态只有 DOM 事件里能看到
 * （`isComposing` / `keyCode 229`），Worker 拿到掩码时这个信息已经丢了。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** 动作键 → 语义：字母键只在非编辑态、非自动重复时派发一次 */
function actionForKey(code: string): ActionKey | null {
  switch (code) {
    case 'KeyZ':
      return 'sit';
    case 'KeyX':
      return 'lie';
    case 'KeyC':
      return 'wave';
    case 'KeyE':
      return 'vent';
    case 'KeyF':
      return 'interact';
    case 'KeyQ':
      return 'vehicle';
    case 'KeyH':
      return 'cpr';
    case 'KeyG':
      return 'gig';
    case 'Space':
      return 'jump';
    default:
      return null;
  }
}

function movementOrSprintBit(code: string): number {
  if (code === 'ShiftLeft' || code === 'ShiftRight') return KEY_BIT.sprint;
  return keyBit(code);
}

/**
 * 主线程键盘 / 触屏摇杆输入源。
 *
 * 只做三件事：判语义、维护掩码、把掩码与动作码写进控制块。它不知道渲染、
 * 不知道游戏规则，也不知道对面是 Worker 还是同一个线程——
 * 这正是「输入在主线程、循环在渲染线程」这条边界的落点。
 */
export class KeyboardInput {
  /** 方向键掩码，与 `KEY_BIT` 对齐；只在变化时写控制块 */
  private mask = 0;
  private detachFns: Array<() => void> = [];

  constructor(
    private readonly writer: ControlWriter,
    private readonly onChat: () => void,
  ) {}

  attach(): void {
    const onKeyDown = (event: KeyboardEvent) => {
      // 输入法组合态：Z / X / C / E / 空格的 keydown 属于选词，不是游戏动作。
      // 不同浏览器分别报 isComposing 与 keyCode 229，两个都要判。
      if (event.isComposing || event.keyCode === 229) return;
      const inField = isEditableTarget(event.target);
      // 小键盘 Enter 与主键盘 Enter 同效，否则外接全尺寸键盘按了没反应
      if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !inField) {
        event.preventDefault();
        // 打开聊天前清空仍按住的移动键：面板接管键盘后角色不该继续滑行（ADR-0023 §6）
        this.clear();
        this.onChat();
        return;
      }
      if (inField) return;
      if (BLOCKED.has(event.code)) event.preventDefault();
      // Ctrl/Cmd/Alt 组合交给浏览器（撤销、搜索等），不当动作键
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const bit = movementOrSprintBit(event.code);
      if (bit !== 0) this.setMask(this.mask | bit);
      // 重复 keydown 只维护掩码，不重复派发动作：按住 E 不应该无限重播发泄
      if (event.repeat) return;
      const action = actionForKey(event.code);
      if (action) this.writer.pushAction(ACTION_CODE[action]);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const bit = movementOrSprintBit(event.code);
      if (bit !== 0) this.setMask(this.mask & ~bit);
    };

    // 失焦（切标签页、点到浏览器地址栏）后按键的 keyup 收不到：不清会一直往前走
    const onBlur = () => this.clear();

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
    this.mask = 0;
  }

  /** 触屏摇杆方向，取值 -1..1（屏幕坐标，y 向下为正） */
  setMoveVector(x: number, y: number): void {
    this.writer.writeTouch(x, y);
  }

  /** 收回控制权：聊天面板接管键盘、或点击画布空白处时调用 */
  clear(): void {
    this.setMask(0);
  }

  private setMask(mask: number): void {
    if (mask === this.mask) return;
    this.mask = mask;
    this.writer.writeKeys(mask);
  }
}
