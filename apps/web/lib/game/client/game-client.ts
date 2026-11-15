import type {
  BoardMetric,
  CareerSummary,
  CharacterAppearance,
  ChatSendPacket,
  FurniturePlacement,
  NavTargetId,
  ResumeState,
} from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import type { DanmakuPrefs } from '../danmaku-prefs';
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
  /** 动作（坐 / 躺 / 挥手 / 叫唤 / 跳 / 互动）：桌面动作条与触屏动作盘共用 */
  perform(action: ActionKey): void;
  /** 收回移动控制权：打开聊天、点画布空白处时调用 */
  clearMovement(): void;
  /** 发言：弹幕外观随包上行，服务端复核后广播 */
  sendChat(packet: ChatSendPacket): void;
  /** 弹幕设置（开关 / 不透明度 / 覆盖区域 + 发送侧偏好） */
  setDanmakuPrefs(prefs: DanmakuPrefs): void;
  requestHistory(beforeMsgId: number): void;
  setStatus(status: string): void;
  /** 改工牌名：本机乐观上屏，服务端回执再对齐 */
  setName(name: string): void;
  setAppearance(appearance: CharacterAppearance): void;
  /** 补报考勤摘要：入场后、geo 就绪后与 60 秒心跳各调用一次 */
  updateCareer(career: CareerSummary): void;
  /** 拉取牛马榜：默认 `0` 一次拉全部指标，页签切换不再往返 */
  requestBoard(metric?: BoardMetric | 0): void;
  /** 给看得见的人点个赞（ADR-0057）：服务端裁决，重复请求是幂等的 */
  like(targetId: number): void;
  /** 发起 1v1 邀请（ADR-0083）：服务端裁决视距 / 忙碌 / 余额 */
  invite(targetId: number, gameType: number, wager: number): void;
  /** 回应邀请：接受后赌注冻结并开始对局 */
  respond(inviteId: number, accept: boolean): void;
  /** 猜拳出拳：action 见 P2P_ACTION，合法性由服务端复核 */
  p2pAction(matchId: number, action: number): void;
  /** 打赏目标牛马币（ADR-0082） */
  tip(targetId: number, amount: number): void;
  /** 对目标使用背包道具：库存由服务端扣减 */
  useItem(targetId: number, itemId: number): void;
  /** 商店购买：kind 见 SHOP_KIND，属性升级或补货 */
  buyShop(kind: number, id: number, count?: number): void;
  /** 全服大喇叭：文案由服务端审核，通过才扣道具（ADR-0085） */
  shout(text: string): void;
  // ---- 热区建筑（ADR-0087）：上行只带意图，裁决在服务端 ----
  /** 赌桌下注：side 见 DICE_SIDE，注额由服务端夹到上下限 */
  diceBet(table: number, side: number, amount: number): void;
  /** 豪宅：买院 / 锁门 / 收摇钱树，action 见 VILLA_ACTION */
  villaAction(villa: number, action: number): void;
  /** 八角笼观战押注：必须坐在观战长椅上，服务端复核座位组 */
  arenaBet(side: number, amount: number): void;
  /** 公寓：0 进屋 / 1 出屋 / 2 升级户型 */
  apartmentAction(action: number): void;
  /** 邀请朋友来串门 */
  apartmentInvite(targetId: number): void;
  /** 上传家具布局（件数与格子由服务端按户型档位校验） */
  saveRoomLayout(placements: FurniturePlacement[]): void;
  // ---- 打工产出与随机事件（ADR-0088）----
  /** 完成一轮搬砖：只报连击数，金额由服务端按坐姿 / 间隔 / 工效 / 夜班算 */
  claimWork(combo: number): void;
  /** 领取每日悬赏：达标且当日未领才发钱 */
  claimQuest(questId: number): void;
  /** 手动抢红包（自动拾取走会话层） */
  claimEvent(index: number): void;
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
  /** 弹幕偏好初值：宿主读盘后注入，Worker 模式随 init 带进渲染线程 */
  danmakuPrefs: DanmakuPrefs;
  callbacks: SessionCallbacks;
  /** Enter 打开聊天：键盘监听留在主线程，这条路径不经过渲染线程 */
  onRequestChat(): void;
  /** 点选结果：null 表示点空或点到自己；`badge` 是首帧工牌，避免弹窗先空白 */
  onPick(id: number | null, badge?: PlayerBadge | null): void;
}
