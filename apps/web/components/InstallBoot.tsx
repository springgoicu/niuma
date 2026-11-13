'use client';

import { useEffect } from 'react';
import { initInstallPrompt } from '@/lib/install-prompt';

/**
 * 根级安装引导：挂载即接管 `beforeinstallprompt` 并注册 SW。
 *
 * 事件每次页面加载只发一次，而它常常在首页就发完了。若只在 `/play` 里监听，
 * 玩家从首页客户端跳到园区时事件已经错过，`canPrompt` 会永远是 false ——
 * 面板只能退化成手动引导，「装到桌面」看起来就是坏的。
 *
 * 挂在这里之后，任何入口页面（首页 / 捏人 / 选园 / 园区）首次加载都立即接管；
 * 组件不渲染任何东西，也不持有状态。
 */
export function InstallBoot() {
  useEffect(() => {
    initInstallPrompt();
  }, []);

  return null;
}
