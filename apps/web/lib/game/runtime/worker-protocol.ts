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
  RingPacket,
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
      /** 最近一次上香的自然日（ADR-0061）：同样只能主线程读 */
      incenseDay: string;
    }
  /** 小地图画布：可能晚于 init 到达，Worker 侧只换绘制目标 */
  | { t: 'minimap'; canvas: OffscreenCanvas }
  /** 发言：颜色与模式随包上行，渲染线程不关心 UI 状态 */
  | { t: 'chat'; packet: ChatSendPacket }
  /** 弹幕设置变更：总开关 / 不透明度 / 覆盖区域 */
  | { t: 'danmaku'; prefs: DanmakuPrefs }
  | { t: 'history'; cursor: number }
  | { t: 'status'; text: string }
  /** 改工牌名：与状态同一条低速通道 */
  | { t: 'name'; text: string }
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
  /**
   * `code` 是给宿主看的机器可读分类，缺省表示普通状态。
   * `atlas-version`：图集版本与客户端布局不一致，页面已过期，应受控换图。
   */
  | { t: 'status'; status: EngineStatus; detail: string; code?: 'atlas-version' }
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
  /** 老板被打倒：`local` 表示最后一脚是不是自己踢的（ADR-0070） */
  | { t: 'bossDown'; local: boolean }
  /** 跨日老板回满血：主线程收起顶部提示 */
  | { t: 'bossReset' }
  /** 在公告栏旁按了 F：主线程打开榜单面板并请求快照 */
  | { t: 'boardOpen' }
  /** 在放假告示板旁按 F / 点击牌面：主线程展开软木看板（ADR-0059） */
  | { t: 'bulletinOpen' }
  /** 擂台快照：低频事件（阶段变化 / 扣血 / 1Hz 心跳），`receivedAt` 供 HUD 本地递减 */
  | { t: 'ring'; packet: RingPacket | null; receivedAt: number }
  /** 牛马榜快照：一个指标一条，主线程按 metric 归并 */
  | { t: 'board'; packet: BoardPacket }
  /** 工牌点赞变化：主线程更新工牌与已赞集合 */
  | { t: 'like'; packet: LikePacket }
  /** 发声请求：`AudioContext` 只能在主线程，所以连听者坐标一起带回来 */
  | { t: 'audio'; event: AudioEvent; listenerX: number; listenerY: number }
  /** 仅在无共享内存时使用：主线程据此落盘 */
  | { t: 'snapshot'; patch: SnapshotPatch }
  /** 上香后写回本地日期键（ADR-0061）：零服务端状态，只记在本机 */
  | { t: 'incenseDay'; day: string }
  /** Worker 遇到断线等情况，请求主线程做一次构建版本检查 */
  | { t: 'build-check' };
