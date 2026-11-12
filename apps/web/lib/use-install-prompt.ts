'use client';

import { useEffect, useState } from 'react';
import { getInstallState, subscribeInstall, type InstallState } from './install-prompt';

/** 与服务端渲染的 HTML 对齐：首帧一律「不可安装、未安装」，挂载后再读单例 */
const INITIAL: InstallState = { canPrompt: false, installed: false };

/**
 * 订阅安装状态（`beforeinstallprompt` / `appinstalled` / 独立窗口判定）。
 *
 * 写法和 `useImmersiveStage` 一致：不引第三种状态库，只在挂载后同步一次，
 * 之后靠单例推送。SSR 阶段读不到 `display-mode`，所以不能在 useState 初值里判。
 */
export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>(INITIAL);

  useEffect(() => {
    const sync = () => setState(getInstallState());
    sync();
    return subscribeInstall(sync);
  }, []);

  return state;
}
