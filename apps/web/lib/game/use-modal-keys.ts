'use client';

import { useEffect } from 'react';
import { GAME_KEYS } from './game-keys';

/**
 * 弹窗打开期间吞掉游戏键：面板背后的 Z/X/C/E/F/Space 与 WASD 不该穿透到画布。
 *
 * 背景：`KeyboardInput` 在 window 的 bubble 阶段无条件监听（input-keyboard.ts:92），
 * 它不读任何「模态是否打开」的状态，只判断焦点是否在可编辑元素里。因此每个模态
 * 都得自己挂一道 capture 闸门——此前只有工牌档案 / 榜单 / 告示板 / 骰桌做了，
 * 茶台商店 / 豪宅 / 观战投选三个热区弹窗漏掉，玩家按 F 开面板后角色仍在背后走位、起身。
 *
 * 这个 hook 就是那道闸门的唯一实现：调用方一行 `useModalKeys(enabled, onClose)`，
 * 不必知道 GAME_KEYS 集合、capture 阶段、IME 组合态与「焦点在按钮上要放行」的细节。
 * 纯 UI 层，零协议、零存档改动，删掉 hook 调用即可逐个回滚。
 *
 * 行为与 BulletinModal.tsx:73-113 完全对齐：
 * - Esc 关闭面板（调用方提供 onClose）；
 * - 游戏键 stopPropagation 拦住 bubble 监听，非交互元素上再 preventDefault 阻止滚动 / 空格翻页；
 * - 焦点在 button / input 等交互元素时只拦传播、不夺走浏览器默认动作；
 * - 输入法组合态（isComposing / keyCode 229）整段跳过，选词不误触。
 */
export function useModalKeys(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const interactive =
        target instanceof HTMLElement &&
        Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'));

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      // 输入法选词态：这一串 keydown 不属于游戏动作
      if (event.isComposing || event.keyCode === 229) return;
      if (GAME_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
        if (!interactive) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, onClose]);
}
