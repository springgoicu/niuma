/**
 * 帧节拍上限。
 *
 * Pixi 的 `Ticker.maxFPS` 默认是 0（不设上限，跟着 `requestAnimationFrame`
 * 走显示器的刷新率）。120/144Hz 屏幕上这意味着同一套玩法逻辑、同一份深度
 * 排序、同一张光图 RT Pass 每秒被执行两倍以上：CPU 侧是纯浪费，GPU 侧是
 * 白烧一倍填充率。
 *
 * 把上限压到 60 不改变任何时间语义：
 * - `GameSession.tick` 里已经有 `Math.min(ticker.deltaMS, 50)` 钳制；
 * - 远端角色插值按毫秒推进（`RemoteTrack`），不是按帧数；
 * - 网络同步是包驱动的，与帧率无关。
 *
 * 灰度开关 `?fps=`（与 `?light=0` / `?zoom=` 同一套写法）：
 * - 缺省 = 60；
 * - `?fps=0` = 不设上限，与改造前完全等价，用于线上对照；
 * - `?fps=30|120|240` 等 1–240 的整数按原值生效；
 * - 空串、负值、小数、超区间一律回落 60，避免把 `ticker` 配成停摆值。
 */
export const DEFAULT_TARGET_FPS = 60;

/** 合法上限：再高没有意义（`requestAnimationFrame` 本身就是显示器的节拍） */
const MAX_TARGET_FPS = 240;

export function resolveTargetFps(search: string): number {
  const raw = new URLSearchParams(search).get('fps');
  if (raw === null) return DEFAULT_TARGET_FPS;
  const text = raw.trim();
  // 只认十进制整数：`Number('')` 是 0，会把「参数留空」误读成「不设上限」
  if (!/^\d+$/.test(text)) return DEFAULT_TARGET_FPS;
  const value = Number(text);
  if (value > MAX_TARGET_FPS) return DEFAULT_TARGET_FPS;
  return value;
}
