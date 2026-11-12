import type { CharacterAppearance, NavTargetId, ResumeState } from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import type { SessionCallbacks } from '../session';
import type { SessionProfile } from '../runtime/engine-env';
import type { ActionKey } from '../input';

/**
 * 外壳与游戏循环之间唯一的接口。
 *
 * 两种实现（Worker / 主线程回退）暴露同一组方法，React 组件不需要知道
 * 引擎跑在哪个线程——`?render=main` 切换时没有任何调用点要改。
 */
export interface GameClient {
  /** 在 host 里建画布并启动引擎；画布由 client 持有，卸载时一起销毁 */
  start(host: HTMLElement, profile: SessionProfile, resume?: ResumeState): Promise<void>;
  /**
   * 小地图挂载点：把一块 **由宿主自己创建** 的画布塞进这个容器。
   *
   * 不在 React 里直接放 `<canvas>` 是因为 `transferControlToOffscreen()` 一次性：
   * StrictMode 的二次挂载必须换一块新画布，而 React 会复用同一个 DOM 节点。
   */
  attachMinimap(host: HTMLElement): void;
  stop(): void;
  setMoveVector(x: number, y: number): void;
  /** 动作（坐 / 躺 / 挥手 / 叫唤 / 跳 / 互动 / 咀嚼）：桌面动作条与触屏动作盘共用 */
  perform(action: ActionKey): void;
  /** 收回移动控制权：打开聊天、点画布空白处时调用 */
  clearMovement(): void;
  sendChat(text: string): void;
  requestHistory(beforeMsgId: number): void;
  setStatus(status: string): void;
  setAppearance(appearance: CharacterAppearance): void;
  navigateTo(id: NavTargetId): void;
  cancelNavigation(): void;
  /** 舞台局部坐标 → 命中角色的 netId（经 `options.onPick` 回调） */
  pick(stageX: number, stageY: number): void;
  /** 订阅某人的工牌：null 表示退订，之后不再产生任何推送 */
  subscribeBadge(id: number | null, onChange: (badge: PlayerBadge | null) => void): void;
  retry(): void;
}

export interface GameClientOptions {
  /** 已按园区白名单解析好的端点，一次会话内不变 */
  wsUrl: string;
  /** 落点快照按园区分区，换园区时不沿用上一座的座位 */
  parkId: string;
  /** 主线程的 `location.search`：`?zoom/?flat/?light/?season` 等灰度开关原样转给渲染线程 */
  search: string;
  callbacks: SessionCallbacks;
  /** Enter 打开聊天：键盘监听留在主线程，这条路径不经过渲染线程 */
  onRequestChat(): void;
  /** 点选结果：null 表示点空或点到自己 */
  onPick(id: number | null): void;
}
