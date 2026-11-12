import type {
  BoardMetric,
  BoardPacket,
  CareerSummary,
  CharacterAppearance,
  ChatSendPacket,
  LikePacket,
  NavTargetId,
  Pose,
  QueueStatusPacket,
  ResumeState,
  SeatKind,
} from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import type { DanmakuPrefs } from '../danmaku-prefs';
import type { ChatEntry, SessionStats } from '../session';
import type { ControlMessage, SnapshotPatch } from './control-channel';
import type { AudioEvent, SessionProfile } from './engine-env';

/**
 * 主线程 ↔ 渲染线程的有向消息。
 *
 * 纪律：**高频、每帧都要读最新值的量一律不进这里**——它们走
 * `control-channel.ts` 的定长块。这里只放低频事件（连接状态、聊天、工牌、
 * 姿态提示、导航、音效）与一次性指令（尺寸之外的初始化、暂停、销毁）。
 * 每条消息最多携带一段文本，且都发生在事件驱动路径上，不会卡渲染循环。
 */

export type EngineStatus = 'connecting' | 'queued' | 'online' | 'offline' | 'error';

export type MainToWorker =
  | {
      t: 'init';
      canvas: OffscreenCanvas;
      /** 共享内存可用时非空：输入不再需要任何消息 */
      control: SharedArrayBuffer | null;
      profile: SessionProfile;
      resume: ResumeState | undefined;
      wsUrl: string;
      parkId: string;
      /** 主线程的 location.search，Worker 没有 window 可取 */
      search: string;
      width: number;
      height: number;
      dpr: number;
      /** 弹幕偏好初值：localStorage 只能在主线程读 */
      danmaku: DanmakuPrefs;
    }
  /** 小地图画布：可能晚于 init 到达，Worker 侧只换绘制目标 */
  | { t: 'minimap'; canvas: OffscreenCanvas }
  /** 发言：颜色与模式随包上行，渲染线程不关心 UI 状态 */
  | { t: 'chat'; packet: ChatSendPacket }
  /** 弹幕设置变更：总开关 / 不透明度 / 覆盖区域 */
  | { t: 'danmaku'; prefs: DanmakuPrefs }
  | { t: 'history'; cursor: number }
  | { t: 'status'; text: string }
  | { t: 'appearance'; appearance: CharacterAppearance }
  /** 考勤摘要补报：geo 就绪后与 60 秒心跳各发一次 */
  | { t: 'career'; career: CareerSummary }
  /** 拉取牛马榜：0 表示全部指标 */
  | { t: 'board'; metric: BoardMetric | 0 }
  /** 工牌点赞：服务端裁决，重复请求幂等 */
  | { t: 'like'; id: number }
  | { t: 'navigate'; id: NavTargetId }
  | { t: 'cancelNav' }
  | { t: 'pick'; x: number; y: number }
  /** 订阅 / 退订某人的工牌：`null` 表示收起详情 */
  | { t: 'inspect'; id: number | null }
  | { t: 'retry' }
  | { t: 'pause'; paused: boolean }
  /** 无共享内存时的输入降级通道 */
  | { t: 'control'; message: ControlMessage }
  | { t: 'dispose' };

export type WorkerToMain =
  | { t: 'ready'; backend: string }
  | { t: 'status'; status: EngineStatus; detail: string }
  | { t: 'queue'; queue: QueueStatusPacket | null }
  | { t: 'rejected'; reason: number }
  | { t: 'stats'; stats: SessionStats }
  | { t: 'chat'; entry: ChatEntry }
  | { t: 'history'; entries: ChatEntry[]; replace: boolean; hasMore: boolean }
  | { t: 'hint'; hint: string | null }
  | { t: 'localState'; pose: Pose; seated: boolean; seatKind: SeatKind | null }
  | { t: 'nav'; nav: { id: NavTargetId; name: string } | null }
  | { t: 'picked'; id: number | null; badge?: PlayerBadge | null }
  | { t: 'badge'; id: number; badge: PlayerBadge | null }
  /** 本地被创飞：行为统计只需一个布尔量 */
  | { t: 'ventHit'; local: boolean }
  /** 本地成功击倒他人：击倒数 +1 */
  | { t: 'ventDealt' }
  /** 在公告栏旁按了 F：主线程打开榜单面板并请求快照 */
  | { t: 'boardOpen' }
  /** 牛马榜快照：一个指标一条，主线程按 metric 归并 */
  | { t: 'board'; packet: BoardPacket }
  /** 工牌点赞变化：主线程更新工牌与已赞集合 */
  | { t: 'like'; packet: LikePacket }
  /** 发声请求：`AudioContext` 只能在主线程，所以连听者坐标一起带回来 */
  | { t: 'audio'; event: AudioEvent; listenerX: number; listenerY: number }
  /** 仅在无共享内存时使用：主线程据此落盘 */
  | { t: 'snapshot'; patch: SnapshotPatch }
  /** Worker 遇到断线等情况，请求主线程做一次构建版本检查 */
  | { t: 'build-check' };
