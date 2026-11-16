import {
  CHAT_HISTORY_CAPACITY,
  CHAT_HISTORY_MAX_PAGE,
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_HISTORY_TTL_MS,
  SPAWN_RADIUS,
} from '@niuma/shared-types';
import type { AdmissionConfig } from './admission/controller';
import { resolveTzOffsetMin } from './clock';
import { loadNpcConfig, type NpcConfig } from './npc/config';

export interface ModerationConfig {
  /** 外部词库 JSON 路径；空串表示只用内置词库 */
  lexiconPath: string;
}

/** 频道历史缓冲（ADR-0039）：全在内存里，进程重启即清空 */
export interface ChatHistoryConfig {
  /** 环形缓冲条数上限 */
  capacity: number;
  /** 超过这个时长的消息不再补发 */
  ttlMs: number;
  /** 首屏补发与上翻每页条数 */
  pageSize: number;
}

/**
 * 反渗透参数。都是「正常客户端碰不到、伪造包立刻撞墙」的阈值，
 * 因此不需要随人数调整，也不必进准入控制器的水位计算。
 */
export interface SecurityConfig {
  /** WS 握手 Origin 白名单，逗号分隔；不含 localhost（那条恒放行） */
  allowedOrigins: string;
  /**
   * 移动包软上限（每秒）：超过只丢弃，不断线。
   * 正常客户端 20Hz，留 5 包余量吸收时钟抖动与重连瞬间的补发。
   */
  moveSoftLimit: number;
  /**
   * 移动包硬上限（每秒）：超过视为外挂注入/发包渗透，直接踢。
   * 与软上限之间留 10 包的缓冲，避免恰好卡在边界的正常玩家被误杀。
   */
  moveHardLimit: number;
  /** 聊天强制冷却（毫秒）。0 = 关闭，只保留 5s/3 条窗口 */
  chatCooldownMs: number;
}

/**
 * 共享运行态快照（ADR-0081）。
 *
 * `path` 留空 = 关闭持久化，回到「重启即空场」的老行为；
 * 其余两项只影响写盘频率与文件体积，不影响帧循环。
 */
export interface StateConfig {
  /** 快照文件路径（相对进程 cwd）；空串表示不落盘 */
  path: string;
  /** 变更合并窗口（毫秒） */
  saveDelayMs: number;
  /** 匿名档案（设备号）容量上限 */
  maxProfiles: number;
  /** 钱包账本容量上限（ADR-0104） */
  maxWallets: number;
  /** 是否把钱包装进服务端账本；0 = 回到 ADR-0082 的浏览器永久层 */
  walletPersist: boolean;
  /** 首次导入的余额上限（防改包一次性填满） */
  walletImportMax: number;
}

export interface ServerConfig {
  port: number;
  hostname: string;
  /**
   * 园区身份：多园区部署时每台游戏服各配一个，`/health` 原样下发。
   * 选园页拿它核对「配置指向的园区」与「实际应答的园区」是不是同一座，
   * 部署错位（把 B 的地址配成了 A）能在页面上直接看出来。
   */
  parkId: string;
  parkName: string;
  /** 单连接每秒最多处理的消息数，超出直接丢弃，防止单客户端打满 Tick */
  maxMessagesPerSecond: number;
  helloTimeoutMs: number;
  /** 出生点散布半径（像素），压测时放大可模拟稀疏分布 */
  spawnRadius: number;
  /** 准入与排队策略；容量、水位、放行速率全部可配 */
  admission: AdmissionConfig;
  /** 内容审核词库；内置表随版本发布，外置文件可覆盖/追加 */
  moderation: ModerationConfig;
  /** 频道历史缓冲；条数、时长与页长都可压测时调小 */
  chatHistory: ChatHistoryConfig;
  /** 园区 NPC：数量、种子、节奏与区域权重；count=0 即完整回滚 */
  npc: NpcConfig;
  /** 小黑屋执法：关闭后不判定、不派单、不发包，屋子仍是普通空房 */
  jail: {
    enabled: boolean;
  };
  /** 反渗透：Origin 白名单、移动包频率、聊天冷却 */
  security: SecurityConfig;
  /** 园区共享运行态快照（擂台 / 老板 / 匿名档案） */
  state: StateConfig;
  /**
   * 园区时区偏移（分钟）：所有「今天」的切日口径。
   * 多园区部署时每台各配一个，不跟着宿主机时区漂。
   */
  tzOffsetMin: number;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === '0' || value === 'false' || value === 'off') return false;
  if (value === '1' || value === 'true' || value === 'on') return true;
  return fallback;
}

/** 与 readInt 的区别：显式允许 0（聊天冷却设 0 表示关闭这一层） */
function readIntWithZero(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * 2C2G / 3Mbps 单机的现实预算：
 * - 320 KB/s 出口 = 3Mbps 理论 375 KB/s 扣掉 TCP/TLS 开销后留 15% 余量
 * - Tick 预算 25ms = 50ms 周期的一半，超过就该关闸
 * - 基准容量 60 人，AIMD 会在稳定期往上探、越界时按 25% 收缩
 * 全部可用环境变量覆盖，便于压测时把阈值调低来观察排队行为。
 */
export function loadConfig(): ServerConfig {
  const admission: AdmissionConfig = {
    enabled: readBool(process.env.GAME_QUEUE_ENABLED, true),
    maxOnline: readInt(process.env.GAME_MAX_ONLINE, 60),
    minCapacity: readInt(process.env.GAME_CAPACITY_MIN, 10),
    highWatermark: readFloat(process.env.GAME_WATERMARK_HIGH, 0.85),
    lowWatermark: readFloat(process.env.GAME_WATERMARK_LOW, 0.65),
    capacityStep: readInt(process.env.GAME_CAPACITY_STEP, 2),
    shrinkRatio: readFloat(process.env.GAME_SHRINK_RATIO, 0.75),
    stableMs: readInt(process.env.GAME_STABLE_MS, 30_000),
    shrinkIntervalMs: readInt(process.env.GAME_SHRINK_INTERVAL_MS, 10_000),
    breakerFactor: readFloat(process.env.GAME_BREAKER_FACTOR, 2),
    breakerStrikes: readInt(process.env.GAME_BREAKER_STRIKES, 3),
    maxEgressKbps: readInt(process.env.GAME_MAX_EGRESS_KBPS, 320),
    tickBudgetMs: readInt(process.env.GAME_TICK_BUDGET_MS, 25),
    admitPerTick: readInt(process.env.GAME_ADMIT_PER_TICK, 2),
    queueRatio: readFloat(process.env.GAME_QUEUE_RATIO, 2),
    queueMin: readInt(process.env.GAME_QUEUE_MIN, 50),
    queueMax: readInt(process.env.GAME_QUEUE_MAX, 1000),
    queueMaxWaitMs: readInt(process.env.GAME_QUEUE_MAX_WAIT_MS, 180_000),
    sampleIntervalMs: readInt(process.env.GAME_ADMISSION_SAMPLE_MS, 500),
  };

  return {
    port: readInt(process.env.GAME_SERVER_PORT, 3001),
    hostname: process.env.GAME_SERVER_HOST ?? '0.0.0.0',
    // 缺省值必须让单机部署看起来和改造之前一样：id 是 main、名字是主园区
    parkId: process.env.GAME_PARK_ID?.trim() || 'main',
    parkName: process.env.GAME_PARK_NAME?.trim() || '主园区',
    maxMessagesPerSecond: readInt(process.env.GAME_SERVER_MAX_MPS, 120),
    helloTimeoutMs: 5000,
    // 直接读 shared-types 的 SPAWN_RADIUS：出生圈收进北门口袋后，这里不再各写一份字面量
    spawnRadius: readInt(process.env.GAME_SPAWN_RADIUS, SPAWN_RADIUS),
    admission,
    moderation: {
      lexiconPath: process.env.GAME_MODERATION_LEXICON ?? '',
    },
    chatHistory: {
      capacity: readInt(process.env.GAME_CHAT_HISTORY_CAPACITY, CHAT_HISTORY_CAPACITY),
      ttlMs: readInt(process.env.GAME_CHAT_HISTORY_TTL_MS, CHAT_HISTORY_TTL_MS),
      // 页长不跟着配置无限放大：单包预算与面板高度都按协议里的上限对齐
      pageSize: Math.min(readInt(process.env.GAME_CHAT_HISTORY_PAGE, CHAT_HISTORY_PAGE_SIZE), CHAT_HISTORY_MAX_PAGE),
    },
    // NPC 的降级与钳制全部收在 npc/config：文件坏了也只告警，不阻断开服
    npc: loadNpcConfig(),
    jail: {
      // 只留一个开关：关闭后退回「没有执法」的园区，不需要迁移任何状态
      enabled: readBool(process.env.GAME_JAIL_ENABLED, true),
    },
    security: {
      // 留空走 guard 里的默认值（主站两个域名），避免配置漏填就变成「谁都能连」
      allowedOrigins: process.env.GAME_ALLOWED_ORIGINS ?? '',
      moveSoftLimit: readInt(process.env.GAME_MOVE_MAX_HZ, 25),
      moveHardLimit: readInt(process.env.GAME_MOVE_HARD_HZ, 35),
      chatCooldownMs: readIntWithZero(process.env.GAME_CHAT_COOLDOWN_MS, 500),
    },
    state: {
      // 缺省就写盘：账号化的点赞/战绩/钱包要靠它续命。显式设空串才退回零持久化
      path: process.env.GAME_STATE_PATH ?? 'data/world-state.json',
      saveDelayMs: readIntWithZero(process.env.GAME_STATE_SAVE_MS, 1000),
      maxProfiles: readInt(process.env.GAME_STATE_MAX_PROFILES, 512),
      maxWallets: readInt(process.env.GAME_STATE_MAX_WALLETS, 1024),
      walletPersist: readBool(process.env.GAME_WALLET_PERSIST, true),
      walletImportMax: readInt(process.env.GAME_WALLET_IMPORT_MAX, 100_000),
    },
    // 显式配置优先；不填就跟宿主机时区（容器跑 UTC 也不会把零点错位）
    tzOffsetMin: resolveTzOffsetMin(process.env.GAME_TZ_OFFSET_MIN),
  };
}
