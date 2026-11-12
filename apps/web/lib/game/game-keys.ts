import type { TabNavKey } from './tab-keyboard';

/**
 * 弹窗打开期间要吞掉的游戏键：不清掉的话角色会顶着面板继续走。
 *
 * 工牌档案与牛马榜两块模态共用这一份；新增动作键时只改这里，
 * 避免第二个面板漏掉某个键，出现「看着榜单还在走位」的穿透。
 */
export const GAME_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyZ',
  'KeyX',
  'KeyC',
  'KeyE',
  'KeyF',
  'KeyG',
]);

/** 页签内建键盘导航键：与 `nextTabIndex` 同一套语义 */
export const TAB_KEYS: ReadonlySet<TabNavKey> = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
