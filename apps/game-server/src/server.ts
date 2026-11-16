import type { ServerWebSocket } from 'bun';
import {
  ACTION,
  BOARD_METRIC_ALL,
  BOARD_METRIC_LIST,
  BOSS_MAX_HP,
  CAREER_UPDATE_INTERVAL_MS,
  CHAT_HISTORY_FLAG,
  CHAT_HISTORY_REQUEST_INTERVAL_MS,
  EMPTY_CAREER,
  ECONOMY_REWARD,
  FALLBACK_NICKNAME,
  MAX_PACKET_BYTES,
  OpCode,
  QUEUE_REJECT_REASON,
  TICK_MS,
  clampSessionCarry,
  decodeAction,
  decodeBoardRequest,
  decodeCareerReport,
  decodeChatHistoryRequest,
  decodeChatSend,
  decodeHello,
  decodeLikeRequest,
  decodeMove,
  decodeEventClaim,
  decodeP2PAction,
  decodeP2PInvite,
  decodeP2PRespond,
  decodePing,
  decodeQuestClaim,
  decodeWorkClaim,
  decodeSetAppearance,
  decodeSetName,
  decodeSetStatus,
  decodeShopBuy,
  decodeShout,
  decodeTipRequest,
  decodeUseItem,
  encodeAppearanceBroadcast,
  encodeBoard,
  encodeCareerBroadcast,
  encodeBoss,
  encodeChatHistory,
  encodeNameBroadcast,
  encodePong,
  encodeQueueRejected,
  encodeQueueStatus,
  encodeRing,
  encodeSeatState,
  encodeStatusBroadcast,
  encodeTipBroadcast,
  encodeWelcome,
  encodeWorkResult,
  encodeVillaState,
  encodeInteractReject,
  encodeArenaPool,
  encodeDiceState,
  encodeApartmentPeek,
  encodeLoudspeaker,
  encodeSystemNotice,
  formatSystemNotice,
  SYSTEM_NOTICE_KIND,
  decodeApartmentRequest,
  decodeArenaBet,
  decodeDiceBet,
  decodeVillaRequest,
  quantizeCoord,
  SHOP_KIND,
  sanitizeCareer,
  SYNC_FORMAT_LEGACY,
  isAdLikeNickname,
  MAX_LIKES,
  readOpCode,
  WALLET_REASON,
  BOSS_REWARD,
  QUEST_ID,
  bossHitCoins,
  APARTMENT_ACTION,
  DICE_PHASE,
  INTERACT_ACTION,
  INTERACT_REASON,
  RING_FEE,
  RING_SIDE,
  RING_STREAK_TARGET,
  VILLA_ACTION,
  VILLA_PRICE,
  HOTSPOT_SERVER_SLACK,
  RING_PHASE,
  apartmentDoorSlotAt,
  hotspotById,
  isWithinHotspot,
  RING_BENCH_SEAT_GROUP,
  seatInGroup,
  seatMatchesHotspot,
  setDynamicSolids,
  type CareerSummary,
  type SeatStateEntry,
} from '@niuma/shared-types';
import { AdmissionController, type HelloPayload } from './admission/controller';
import { createGameClock, serverHourOf } from './clock';
import type { ServerConfig } from './config';
import { ChallengeBus, P2P_PACKET_INTERVAL_MS } from './challenge/bus';
import { diceHandler } from './challenge/handlers/dice';
import { duelHandler } from './challenge/handlers/duel';
import { rpsHandler } from './challenge/handlers/rps';
import { EconomyService } from './economy/service';
import { openWorldStateStore } from './persist/world-state';
import { WalletBook } from './persist/wallets';
import { BossRuntime } from './sim/boss';
import { BossShockRuntime } from './sim/boss-shock';
import { DailyQuestRuntime } from './sim/quests';
import { WorldEventScheduler } from './sim/world-events';
import { resolveWorkClaim } from './sim/work';
import { EgressMeter, RingSampler } from './metrics';
import { PACKET_MALFORMED, PACKET_UNKNOWN, checkPacket } from './net/guard';
import { createOriginGuard } from './net/origin';
import { SpatialGrid } from './spatial/grid';
import { buildBoardSnapshot, canQueryBoard } from './sim/board';
import { pruneBuffs } from './sim/buffs';
import { handleChat } from './sim/chat';
import { useItem } from './sim/items';
import { handleLike } from './sim/like';
import { handleShout } from './sim/shout';
import { ChatHistory, type ChatPage } from './sim/history';
import { loadModerationFilter } from './sim/moderation';
import { resolveRename } from './sim/name';
import { createNpcDirector, warmEscortGrid } from './npc';
import { AmbulanceManager } from './sim/clinic';
import { Detention } from './sim/detention';
import { announceEnter, announceLeave } from './sim/notice';
import { applyMove } from './sim/movement';
import {
  broadcastRing,
  RingRuntime,
  ringBetKey,
  ringFeeKey,
  type RingEnterFailure,
  type RingSettleEntry,
} from './sim/ring';
import { broadcastDice, DiceHallRuntime } from './sim/dice-hall';
import { VillaRuntime } from './sim/villas';
import { ApartmentRuntime } from './sim/apartment';
import { resolveSpawn } from './sim/resume';
import { SeatRegistry } from './sim/seats';
import { runTick } from './sim/tick';
import { broadcastBoss } from './sim/boss';
import { resolveVents } from './sim/vent';
import { broadcastDespawn, refreshView, type Transport } from './sim/view';
import { World, type Player } from './sim/world';

interface SocketData {
  wsId: number;
  playerId: number;
  openedAt: number;
  msgWindowStart: number;
  msgCount: number;
  /** 移动包的独立 1 秒窗口：总量窗口挡不住「20Hz 合法包 + 999Hz 移动包」 */
  moveWindowStart: number;
  moveCount: number;
}

const MOVE_SCRATCH = { id: 0, x: 0, y: 0, state: 0 };
/**
 * 状态广播的节流窗口。状态变更会发给视野内所有人，
 * 没有下限的话一条伪造包循环就能把整片 AOI 变成广播放大器。
 */
const STATUS_THROTTLE_MS = 200;
/**
 * 改名广播的节流窗口。改名比状态更罕用，1 秒足够挡住伪造包，
 * 又不会误伤「照着新想的名字反复改两次」的正常操作。
 */
const RENAME_THROTTLE_MS = 1000;

export function startGameServer(config: ServerConfig) {
  // 园区唯一时钟（ADR-0081）：时区在启动时定死，运行中途不再读宿主机时区
  const clock = createGameClock(config.tzOffsetMin);
  // 打点先于世界：快照的 collect 拿到的是「落盘那一刻」的老板与擂台，而不是 boot 时的
  let world: World;
  const state = openWorldStateStore({
    path: config.state.path,
    saveDelayMs: config.state.saveDelayMs,
    profileCapacity: config.state.maxProfiles,
    tzOffsetMin: clock.tzOffsetMin,
    now: () => clock.now(),
    collect: () => ({
      boss: world.boss.snapshot(),
      ring: world.ring.snapshotForSave(),
      villas: villas.snapshotForSave(),
      wallets: wallets.toJSON(),
    }),
  });
  const saved = state?.load() ?? null;
  /**
   * 钱包账本（ADR-0104）：按匿名设备号保存余额、四维、背包、装扮与分 key 托管。
   *
   * 没有 `world-state.json`（GAME_STATE_PATH 为空）时退回临时钱包：
   * 否则重启会丢掉内存里的账本，比「浏览器永久层」更糟。
   */
  const wallets = new WalletBook({
    capacity: config.state.maxWallets,
    importMax: config.state.walletImportMax,
    persist: config.state.walletPersist && state !== null,
    now: () => clock.now(),
    onChange: () => state?.markDirty(),
    warn: (message) => console.warn(message),
  });
  wallets.restore(saved?.wallets);
  // 上次进程留下的托管（赌注 / 报名费）原路退回：进行中的局不会跨重启复活
  const refundedEscrow = wallets.refundAllEscrow();
  if (refundedEscrow > 0) {
    console.log(`[wallet] 启动退回残留托管 ${refundedEscrow} 币`);
    state?.markDirty();
  }
  /**
   * 擂台名次入账（ADR-0081 / ADR-0104）：冠亚季军记进匿名档案，重启后工牌口碑接着算。
   * 只认前三名与带设备号的玩家，与 `rankByHp` 的裁决同源；离线冠军也要入账。
   */
  const ring = new RingRuntime((entries) => {
    if (state) {
      for (const entry of entries) {
        if (entry.rank >= 1 && entry.rank <= 3) {
          state.profiles.addRingMedal(entry.deviceId, entry.rank, clock.now());
        }
      }
      state.markDirty();
    }
    // 擂台奖金（ADR-0082）：settle 只回调一次，名次天然幂等；只发前三名
    const reward: Record<number, number> = {
      1: ECONOMY_REWARD.RingGold,
      2: ECONOMY_REWARD.RingSilver,
      3: ECONOMY_REWARD.RingBronze,
    };
    /**
     * 在线实体优先，但必须和结算时的设备号对得上：会话 id 会在断线后被回收，
     * 只按 id 找可能把离线冠军的奖金发给刚进园的新人。
     */
    const playerOf = (entry: RingSettleEntry): Player | undefined => {
      if (entry.id === 0) return undefined;
      const player = world.get(entry.id);
      if (!player) return undefined;
      if (entry.deviceId && player.deviceId && player.deviceId !== entry.deviceId) return undefined;
      return player;
    };
    // 报名费：全部成员的 ring 托管合成彩池，冠军拿走（平台不抽水）
    let feePot = 0;
    for (const entry of entries) {
      const wallet = playerOf(entry)?.wallet ?? wallets.get(entry.deviceId);
      feePot += wallet?.takeEscrow(ringFeeKey(entry.playerId)) ?? 0;
    }
    const champion = entries.find((entry) => entry.rank === 1);
    for (const entry of entries) {
      const amount = reward[entry.rank];
      if (!amount) continue;
      const player = playerOf(entry);
      if (player) {
        economy.grantCoins(player, amount, WALLET_REASON.RingReward);
      } else if (entry.deviceId) {
        // 夺冠瞬间断线：按设备号补进账本，下次登录看到钱与奖牌
        wallets.credit(entry.deviceId, amount);
      }
    }
    if (champion && feePot > 0) {
      const player = playerOf(champion);
      if (player) economy.grantCoins(player, feePot, WALLET_REASON.ArenaWin);
      else if (champion.deviceId) wallets.credit(champion.deviceId, feePot);
    }
    // 观战押注彩池：押中一侧按注额比例分走全池，0 抽水；没人押中则全额退还
    const pool = ring.lastPool;
    if (pool) {
      for (const entry of pool.payouts) {
        const player = world.get(entry.id);
        if (player) economy.payoutFromPool(player, ringBetKey(entry.id), entry.amount, WALLET_REASON.ArenaBetWin);
      }
      for (const id of pool.refunds) {
        const player = world.get(id);
        if (player) economy.refundEscrow(player, ringBetKey(id));
      }
      // 押错的人必须在结算时清账：否则托管会一直挂在钱包里，
      // 下次重启 refundAllEscrow 会把已经输掉的注额退回，等于造币。
      for (const id of pool.losers) {
        const player = world.get(id);
        if (player) economy.clearEscrow(player, ringBetKey(id));
      }
      ring.lastPool = null;
    }
    state?.markDirty();
    // 擂主连胜 ≥3：全服横幅（走大喇叭通道，客户端已有金色置顶样式）
    if (ring.streak >= RING_STREAK_TARGET && champion) {
      broadcastLoud(`绩效八角笼：${champion.name} 已连胜 ${ring.streak} 场！`);
    }
  });
  const boss = new BossRuntime(clock.now(), clock.tzOffsetMin);
  world = new World(boss, ring);
  // 恢复顺序：先档案，再老板与擂台；坏档已在 load 里隔离，这里只会是干净数据
  if (state) {
    state.hydrateProfiles(saved);
    if (saved) {
      boss.restore(saved.boss, clock.now());
      ring.restore(saved.ring);
    }
    console.log(
      `[state] path=${state.path} restored=${saved ? 'yes' : 'no'} boss=${boss.hp}/${BOSS_MAX_HP} match=${ring.matchId} profiles=${state.profiles.size} wallets=${wallets.size}`,
    );
  } else {
    console.log('[state] 持久化关闭（GAME_STATE_PATH 为空）：重启后共享运行态清零');
  }

  const grid = new SpatialGrid();
  const seats = new SeatRegistry();
  const sockets = new Map<number, ServerWebSocket<SocketData>>();
  const tickSampler = new RingSampler(1200);
  const moveSampler = new RingSampler(1200);
  const egress = new EgressMeter();
  const admission = new AdmissionController(config.admission);
  // 词表加载与 trie 构建只发生在这里一次，聊天路径只做走查
  const moderation = loadModerationFilter(config.moderation.lexiconPath);
  // 频道历史只活在进程内（ADR-0039）：跟着世界一起启动、一起丢弃
  const chatHistory = new ChatHistory(config.chatHistory.capacity, config.chatHistory.ttlMs);
  let nextWsId = 1;
  let tickCount = 0;
  let lastSampleAt = 0;
  /** 落盘用的变更指纹：只在老板血量 / 擂台阶段真的变了才打脏标记 */
  let lastBossHp = world.boss.hp;
  let lastRingRevision = world.ring.revision;
  /** 赌桌快照的心跳节流：状态变化即刻发，否则 1Hz */
  let lastDiceBroadcastAt = 0;
  /** 豪宅快照的心跳节流：锁状态与可收币数每秒对齐一次 */
  let lastVillaBroadcastAt = 0;
  /** 钱包容量淘汰的低频节拍：在线与托管中的记录受保护 */
  let lastWalletPruneAt = 0;
  /**
   * 进程启动时刻：会话续算的硬上限（ADR-0060）。
   * 重启后世界与玩家都已消失，凭旧值虚增的在线时长必须一并失效。
   */
  const bootedAt = clock.now();

  /**
   * WS 握手的第二道来源校验。nginx 那层还能被绕过（改站点、暴露端口、
   * 内嵌 WebView 直连），这一层才是「谁接连接谁负责」。
   */
  const originAllowed = createOriginGuard(config.security.allowedOrigins);

  /**
   * 畸形包与频率攻击的日志必须限流。
   *
   * 正常玩家永远不会走到这里，所以这几条日志的唯一来源就是攻击流量。
   * 逐包打一条带堆栈的 error，等于把磁盘 IO 交给攻击者控制 —— 只汇总计数，
   * 每 5 秒最多吐一行。
   */
  let abuseLogAt = 0;
  let abuseDropped = 0;
  let abuseClosed = 0;
  function logAbuse(kind: string): void {
    const now = clock.now();
    if (now - abuseLogAt < 5000) return;
    console.warn(`[guard] ${kind} dropped=${abuseDropped} closed=${abuseClosed} (5s window)`);
    abuseLogAt = now;
    abuseDropped = 0;
    abuseClosed = 0;
  }

  const transport: Transport = {
    send(wsId, data) {
      const socket = sockets.get(wsId);
      if (!socket || socket.readyState !== 1) return;
      // 出口计量必须落在唯一收口处：用水位判断带宽时不能靠人数估算
      egress.record(data.byteLength);
      socket.send(data);
    },
  };

  /**
   * 牛马币统一入口（ADR-0082）：所有发币 / 扣币 / 升级 / 背包变动都从这里走，
   * 注入 transport.send 后，每次变动只向本人推一条完整钱包快照。
   */
  const economy = new EconomyService(
    (wsId, packet) => transport.send(wsId, packet),
    // 任何钱包变动都打脏标记：落盘窗口 1 秒防抖，不在 Tick 里同步写
    () => state?.markDirty(),
  );

  /** 全服横幅：复用大喇叭通道，不新增下行包 */
  function broadcastLoud(text: string): void {
    const packet = encodeLoudspeaker({ fromId: 0, text });
    for (const player of world.players.values()) {
      if (player.wsId !== 0) transport.send(player.wsId, packet);
    }
  }

  /**
   * 每日悬赏（ADR-0088）：进度只在服务端累计，客户端只负责展示与领取。
   *
   * 与经济服务共用同一个 `transport.send`：领奖时先发钱包快照、再发悬赏状态，
   * 前端收到两条包后的顺序与「先加钱、再打勾」一致。
   */
  const quests = new DailyQuestRuntime(
    economy,
    (wsId, packet) => transport.send(wsId, packet),
    clock.tzOffsetMin,
  );

  /** 画饼冲击波：预警与结算都挂在主 Tick，不另开计时器 */
  const bossShock = new BossShockRuntime(world, transport, grid);

  /** 全局随机事件：红包雨 / 突击查岗，10 分钟一场 */
  const worldEvents = new WorldEventScheduler({
    world,
    transport,
    economy,
    now: clock.now(),
  });

  /** 热区距离门：交互包必须落在热区半径 + 240ms 延迟余量的范围内 */
  function nearHotspot(id: string, player: Player): boolean {
    const hotspot = hotspotById(id);
    return hotspot !== undefined && isWithinHotspot(hotspot, player.x, player.y, HOTSPOT_SERVER_SLACK);
  }

  /**
   * 脚下是哪栋楼的门口（ADR-0098）：探头要出现在这栋楼上，所以按最近的那扇门取
   * slot，离所有门都太远返回 -1（伪造包直接丢掉）。
   */
  function apartmentDoorSlotNear(player: Player): number {
    return apartmentDoorSlotAt(player.x, player.y, HOTSPOT_SERVER_SLACK);
  }

  /** 锁门状态变成碰撞体：服务端移动裁决读它，客户端在同一条包到达时同步 */
  function applyVillaLocks(): void {
    setDynamicSolids(villas.lockedSolids());
  }

  function broadcastVilla(): void {
    for (const player of world.players.values()) {
      if (player.wsId === 0) continue;
      transport.send(player.wsId, encodeVillaState(villas.snapshotFor(player, clock.now())));
    }
  }

  function broadcastArenaPool(): void {
    const pools = world.ring.pools();
    for (const player of world.players.values()) {
      if (player.wsId === 0) continue;
      const bet = world.ring.betOf(player.id);
      transport.send(
        player.wsId,
        encodeArenaPool({
          matchId: world.ring.matchId,
          redPool: pools.red,
          bluePool: pools.blue,
          phase: world.ring.phase,
          mySide: bet ? bet.side : -1,
          myBet: bet ? bet.amount : 0,
        }),
      );
    }
  }

  /** 互动被拒：只回给本人，3 字节，客户端按编号映射中文 */
  function sendInteractReject(player: Player, action: number, reason: number): void {
    if (player.wsId === 0) return;
    transport.send(player.wsId, encodeInteractReject({ action, reason }));
  }

  function ringEnterReason(reason: RingEnterFailure): number {
    switch (reason) {
      case 'full':
        return INTERACT_REASON.Full;
      case 'phase':
        return INTERACT_REASON.Phase;
      case 'far':
        return INTERACT_REASON.TooFar;
      case 'already':
        return INTERACT_REASON.Already;
      default:
        return INTERACT_REASON.Unknown;
    }
  }

  /**
   * 窗口占用全量快照：谁在哪栋哪个窗口探头（ADR-0098）。
   *
   * 只在进楼 / 出楼 / 断线 / 入场各发一次，不进 20Hz Tick；稳态零额外流量。
   */
  function broadcastApartmentPeek(): void {
    const packet = encodeApartmentPeek({ entries: apartment.snapshot() });
    for (const player of world.players.values()) {
      if (player.wsId === 0) continue;
      transport.send(player.wsId, packet);
    }
  }

  /** 摸鱼大赌场：两张桌各自独立跑公共局，彩池结算全部经经济端口 */
  const dice = new DiceHallRuntime(
    {
      freeze: (player, key, amount) => economy.freezeEscrow(player, key, amount),
      clear: (player, key) => economy.clearEscrow(player, key),
      payout: (player, key, amount, reason) => {
        economy.payoutFromPool(player, key, amount, reason);
      },
      refund: (player, key) => {
        economy.refundEscrow(player, key);
      },
    },
    clock.now(),
  );

  /** 豪宅小院：本运行周期冠名权、锁门与摇钱树 */
  const villas = new VillaRuntime({
    spend: (player, amount, reason) => economy.trySpendCoins(player, amount, reason),
    grant: (player, amount, reason) => {
      economy.grantCoins(player, amount, reason);
    },
  });

  /** 牛马公寓：只记「谁在哪栋哪个窗口探头」，没有房间频道也没有室内 */
  const apartment = new ApartmentRuntime();

  // 豪宅冠名权随共享运行态一起恢复：恢复必须在 `villas` 构造之后
  if (state) {
    villas.restore(saved?.villas);
    applyVillaLocks();
  }

  /**
   * P2P 互动总线（ADR-0083）：本阶段只注册 `gameType = 1` 的占位玩法。
   * 未来玩法只需实现 ChallengeHandler 并在这里多一行 register。
   */
  const challenge = new ChallengeBus({
    send: (player, packet) => transport.send(player.wsId, packet),
    economy,
    findPlayer: (id) => world.get(id),
    // 每日悬赏「赢一局对局」：骰子 / 猜拳 / 切磋共用同一条结算回调
    onSettled: (winner, _loser, _gameType, now) => {
      if (!winner || winner.wsId === 0) return;
      quests.note(winner, QUEST_ID.MatchWin, 1, now);
    },
  });
  challenge.register(diceHandler);
  challenge.register(rpsHandler);
  challenge.register(duelHandler);

  /**
   * 园区同事：服务端权威 NPC。
   *
   * 与真人共用实体通道，因此 AOI、去脏广播、地形碰撞与工牌渲染全部复用；
   * 人数容量、排队与榜单只读 `world.humans`，NPC 永远不占真人的名额。
   * `GAME_NPC_COUNT=0` 是完整回滚开关：不生成、不广播。
   */
  const npcs = createNpcDirector({
    world,
    grid,
    transport,
    config: config.npc,
  });
  const npcSampler = new RingSampler(1200);
  npcs.spawn();
  if (npcs.count > 0) {
    console.log(
      `[npc] count=${npcs.count} guards=${npcs.guardCount} seed=${config.npc.seed}`,
    );
  }

  /**
   * 小黑屋执法：只在有保安时启用；没有保安就没有人能押送，判定只会永远排队。
   * 没有任何计时器——押到反省点就放人，屋子保留为普通空房。
   */
  const detention =
    config.jail.enabled && npcs.guardCount > 0
      ? new Detention({
          world,
          grid,
          transport,
          escort: { dispatch: npcs.dispatchEscort, cancel: npcs.cancelEscort },
          releaseSeat: (player) => broadcastSeats(seats.release(player)),
        })
      : null;
  npcs.setEscortListener((event) => detention?.handleEscort(event));

  /**
   * 急救调度器（ADR-0084）：两辆救护车、两名固定护士与两张病床。
   *
   * 与执法共用发泄命中端口：`resolveVents` 一次出招只回调一次，
   * 两个观察者各自决定要不要计入自己的状态机。
   */
  const clinic = new AmbulanceManager({
    world,
    grid,
    transport,
    seats,
    broadcastSeats,
    now: clock.now(),
  });
  // 急救链只认识实体（ADR-0106）：NPC 的归位与任务续接通过窄端口交还 npc 层
  clinic.setNpcRecovery({ restore: (playerId, spot, now) => npcs.restore(playerId, spot, now) });
  const ventObserver = {
    onVentHit(attacker: Parameters<typeof clinic.observeHit>[0], target: Parameters<typeof clinic.observeHit>[1], now: number): void {
      detention?.onVentHit(attacker, target, now);
      clinic.observeHit(attacker, target, now);
    },
    onKnockdown(attacker: Parameters<typeof clinic.observeHit>[0], target: Parameters<typeof clinic.observeHit>[1]): void {
      // 只奖励真人：NPC 互殴不该往任何人的钱包里记钱
      if (attacker.wsId === 0 || target.id === attacker.id) return;
      economy.grantCoins(attacker, ECONOMY_REWARD.Knockdown, WALLET_REASON.KnockdownReward);
    },
    onBossHit(
      attacker: Parameters<typeof clinic.observeHit>[0],
      now: number,
      info: { crit: boolean; hp: number; justDied: boolean; shock: boolean },
    ): void {
      if (attacker.wsId === 0) return;
      // 每次真实命中都掉钱：2~5 币，暴击翻倍（ADR-0088）
      const coins = bossHitCoins(Math.random(), info.crit);
      economy.grantCoins(attacker, coins, WALLET_REASON.BossHit);
      // 悬赏「踢老板 10 脚」只数真实命中，空挥不进
      quests.note(attacker, QUEST_ID.BossHits, 1, now);
      // 跨过 25% 血线：全服 2 秒预警，未起跳的人被震趴
      if (info.shock) bossShock.arm(now);
    },
    onBossKill(attacker: Parameters<typeof clinic.observeHit>[0], now: number): void {
      if (attacker.wsId === 0) return;
      // boss.hit 只有 justDied 那一次会回调到这里，一局最多一笔
      economy.grantCoins(attacker, BOSS_REWARD.Blade, WALLET_REASON.BossReward);
      // 全服高光弹幕：与道具大喇叭同一个下行包，官方播报 fromId = 0
      broadcastLoud(`尾刀！${attacker.name} 一脚把老板踢进了年度总结计划书，+${BOSS_REWARD.Blade} 币`);
      quests.note(attacker, QUEST_ID.BossHits, 1, now);
    },
  };
  if (detention) {
    // 28k 格一次建好，别把第一次执法的寻路开销塞进某个 50ms Tick
    warmEscortGrid();
    console.log(`[jail] enabled guards=${npcs.guardCount}`);
  }

  /**
   * 历史页只发给本人：补发与上翻都不走 `handleChat`，
   * 既不占 5s/3 条的发送窗口，也不会触发头顶气泡。
   * 空页照发——客户端靠 `Replace` 清掉上一个会话残留的消息。
   */
  function sendHistoryPage(wsId: number, page: ChatPage, now: number, replace: boolean): void {
    const entries = page.lines.map((line) => ({
      msgId: line.msgId,
      entityId: line.entityId,
      // 距今秒数而不是时间戳：客户端按自己的时钟还原，两端时钟不一致也不会倒流
      ageSec: Math.max(0, Math.floor((now - line.at) / 1000)),
      name: line.name,
      text: line.text,
    }));
    let flags = page.hasMore ? CHAT_HISTORY_FLAG.HasMore : 0;
    if (replace) flags |= CHAT_HISTORY_FLAG.Replace;
    transport.send(wsId, encodeChatHistory({ flags, entries }));
  }

  /** 座位变化广播给全园：占用变动很少，一包带多条即可 */
  function broadcastSeats(changes: readonly SeatStateEntry[]): void {
    if (changes.length === 0) return;
    const packet = encodeSeatState(changes);
    for (const other of world.players.values()) transport.send(other.wsId, packet);
  }

  /**
   * 摘要只用于展示：先做结构钳制，再对唯一的自由文本（省份）走与昵称/状态同一套审核。
   * 政治类清空，脏话用打码结果继续展示；日志只打 wsId 与命中数，不打印完整载荷。
   */
  function sanitizeIncomingCareer(raw: CareerSummary | undefined, wsId: number): CareerSummary {
    const safe = sanitizeCareer(raw);
    if (!safe.province) return safe;
    const verdict = moderation.inspect(safe.province);
    if (verdict.verdict === 'reject') {
      console.warn(`[career] province reject ws=${wsId} hits=${verdict.hits}`);
      return { ...safe, province: '' };
    }
    return { ...safe, province: verdict.text };
  }

  /** 真正入场：建实体、回 WELCOME、结算首帧视野。排队者放行时复用的就是这条路径 */
  function admit(ws: ServerWebSocket<SocketData>, payload: HelloPayload): void {
    if (ws.data.playerId !== 0) return;
    const now = clock.now();
    // 续算：把入场时刻往前挪，在岗时长跨重连接着算（ADR-0060）。
    // 已在 HELLO 里按「一天 / 进程运行时长」钳过，这里只做区间计算。
    const sessionSec = payload.sessionSec ?? 0;
    // resume 是不可信输入：坐标重新过地形判据，座位重新查权威占用表（见 resolveSpawn）
    const spawn = resolveSpawn(payload.resume, (seatId) => seats.isFree(seatId), config.spawnRadius);
    const player = world.create(
      payload.name,
      payload.appearance,
      ws.data.wsId,
      spawn.x,
      spawn.y,
      payload.status,
      // 入场时刻即在线时长的起点：与座位占用共用同一个 now，避免同一次入场出现两个口径
      now - sessionSec * 1000,
      payload.deviceId,
    );
    if (!player) {
      ws.close(1013, 'server full');
      return;
    }
    ws.data.playerId = player.id;
    // 匿名档案预置（ADR-0081）：同一台浏览器换会话后，工牌口碑接着往上走。
    // touch 顺带刷新 lastSeenAt，所以这里必须打脏标记，让档案不会被 90 天清理误删。
    if (state && payload.deviceId) {
      const profile = state.profiles.touch(payload.deviceId, player.name, now);
      if (profile) player.likes = Math.min(MAX_LIKES, profile.likes);
      state.markDirty();
    }
    // 必须在 refreshView 之前：入场首帧的视野同步就该按协商好的格式编码
    player.syncFormat = payload.syncFormat ?? SYNC_FORMAT_LEGACY;
    // 摘要同样要在 refreshView 之前落位：先进入视野的人会立刻收到带 career 的入场包
    player.career = payload.career ?? { ...EMPTY_CAREER };
    // 钱包同理：进场第一帧的工牌/互动菜单就该读到正确余额，而不是先看到 0 再被纠正。
    // ADR-0104：有服务端账本就用账本，只有这样才允许从 HELLO 经济段导入一次。
    if (wallets.persist && payload.deviceId) {
      const acquired = wallets.acquire(payload.deviceId, player.name, now);
      if (acquired.created) {
        acquired.wallet.importProfile(payload.economy, wallets.importMax, now);
        state?.markDirty();
      }
      player.bindWallet(acquired.wallet);
    } else {
      player.applyEconomy(payload.economy);
    }
    // 放行第一条补报：客户端拿到 geo 后会立刻补一次省份，不能被入场限频吃掉
    player.lastCareerAt = now - CAREER_UPDATE_INTERVAL_MS;
    // 先落姿态再占座：occupy 会用座位锚点与座位姿态覆盖一次，顺序反了会把地面姿态写丢
    player.applyState(spawn.direction, spawn.pose, false);
    if (spawn.seat) {
      const changes: SeatStateEntry[] = [];
      seats.occupy(player, spawn.seat, now, changes);
      broadcastSeats(changes);
    }
    // 座位吸附会改坐标，空间索引必须用最终位置
    grid.insert(player.id, player.x, player.y);
    ws.send(
      encodeWelcome({
        entityId: player.id,
        tick: tickCount,
        x: quantizeCoord(player.x),
        y: quantizeCoord(player.y),
        state: player.state,
        // 条目格式由服务端说了算：客户端据此用对应的长度解析同步包
        syncFormat: player.syncFormat,
        // 回显服务端实际采信的会话秒数：客户端拿它当走秒基准，重连后不再归零
        sessionSec,
      }),
    );
    // 回一条 init 钱包快照：客户端把本地乐观值换成服务端权威值后落盘
    economy.syncOnJoin(player);
    // 悬赏状态与当前事件横幅的入场补发：晚进来的人也要看到今天的进度与正在进行的活动
    quests.push(player, now);
    worldEvents.sendTo(player, now);
    // 热区建筑的入场补发：赌桌公共局、豪宅牌匾、锁门动态碰撞、八角笼彩池
    transport.send(player.wsId, encodeDiceState({ tables: dice.snapshot(player, now) }));
    transport.send(player.wsId, encodeVillaState(villas.snapshotFor(player, now)));
    applyVillaLocks();
    transport.send(
      player.wsId,
      encodeArenaPool({
        matchId: world.ring.matchId,
        redPool: world.ring.pools().red,
        bluePool: world.ring.pools().blue,
        phase: world.ring.phase,
        mySide: -1,
        myBet: 0,
      }),
    );
    // 入场补发老板当前血量：新玩家不必等到下一次有人出招才知道血条位置。
    // 这里不调 syncDay，跨日重置只由 Tick 广播，避免入场者把 reset 事件吞掉。
    ws.send(encodeBoss({ hp: world.boss.hp, attackerId: 0, died: false, reset: false }));
    // 入场补发擂台当前快照：中途加入/围观的人不必等下一次 1Hz 心跳
    ws.send(encodeRing(world.ring.snapshot(now, world)));
    // 救护车停靠时不发冗余包，入场必须单独补一次位置；在途伤员状态也一并补
    clinic.sendSnapshot(ws.data.wsId, now);
    // 入场补发窗口占用：远处楼里的头不必等下一次有人进出才出现
    ws.send(encodeApartmentPeek({ entries: apartment.snapshot() }));
    const occupied = seats.snapshot();
    if (occupied.length > 0) ws.send(encodeSeatState(occupied));
    // 历史必须早于 refreshView：known 一旦建立，实时聊天才可能到达这个 socket；
    // 先发快照才能保证 REPLACE 不会抹掉刚到的实时消息
    sendHistoryPage(
      player.wsId,
      chatHistory.latestPage(config.chatHistory.pageSize, now),
      now,
      true,
    );
    refreshView(player, world, grid, transport);
    // 必须在 refreshView 之后：这时双方的 known 才补齐，播报才发得到「看得见他的人」
    announceEnter(player, world, transport);
    console.log(`[game] + ${player.name}#${player.id} online=${world.humans}`);
  }

  function rejectWaiter(ws: ServerWebSocket<SocketData>, reason: number): void {
    const socket = ws;
    socket.send(encodeQueueRejected(reason));
    socket.close(1013, reason === QUEUE_REJECT_REASON.QueueFull ? 'queue full' : 'queue timeout');
  }

  function handleHello(ws: ServerWebSocket<SocketData>, data: Uint8Array): void {
    if (ws.data.playerId !== 0) return;
    const hello = decodeHello(data);
    // 昵称由客户端预检先挡一道，这里只是权威兜底：伪造 HELLO 也进不来违规名字
    const nameVerdict = moderation.inspect(hello.name);
    // 域名/邮箱形态：词库看不到标点（normalize 会剔除），只能按原文判
    const adLikeName = isAdLikeNickname(hello.name);
    if (adLikeName || nameVerdict.verdict !== 'allow') {
      console.warn(
        `[moderation] name ${adLikeName ? 'ad-shape' : nameVerdict.verdict} ws=${ws.data.wsId} hits=${nameVerdict.hits}`,
      );
    }
    // 状态与昵称同一套审核：政治类清空（不能上屏），脏话用打码结果继续展示
    const statusVerdict = hello.status.length > 0 ? moderation.inspect(hello.status) : null;
    if (statusVerdict && statusVerdict.verdict !== 'allow') {
      console.warn(
        `[moderation] status ${statusVerdict.verdict} ws=${ws.data.wsId} hits=${statusVerdict.hits}`,
      );
    }
    // 会话续算（ADR-0060）：只采信客户端上报的「断线前在线秒数」，
    // 且按「客户端值 / 一天 / 进程已运行秒数」三方取最小，防止伪造把在岗榜刷爆。
    const sessionSec = clampSessionCarry(hello.sessionSec, (clock.now() - bootedAt) / 1000);
    // 摘要只保留今日字段：客户端自报的今日值原样钳制，不再写任何服务端会话基线。
    const career = sanitizeIncomingCareer(hello.career, ws.data.wsId);
    const payload: HelloPayload = {
      name: adLikeName || nameVerdict.verdict === 'reject' ? FALLBACK_NICKNAME : nameVerdict.text,
      appearance: hello.appearance,
      status: statusVerdict && statusVerdict.verdict !== 'reject' ? statusVerdict.text : '',
      // 排队期间跟着 payload 一起等；放行时才由 admit 重新校验
      resume: hello.resume,
      // 能力协商结果同样要跟着排队走：放行时才知道该给这个连接编 6 还是 7 字节
      syncFormat: hello.syncFormat,
      career,
      // 排队时间不计入在岗：续算秒数在 HELLO 那一刻就定住了
      sessionSec,
      // 匿名设备号只做点赞/战绩聚合；decodeHello 已按 hex 校验，非法值就是空串
      deviceId: hello.deviceId,
      // 经济摘要已过协议层的上下限清洗；落位后园内一切以内存为准（ADR-0082）
      economy: hello.economy,
    };
    const alreadyQueued = admission.isQueued(ws.data.wsId);
    // 准入只看真人：NPC 是氛围实体，不该让真人少一个名额或排更久的队
    const decision = admission.decide(ws.data.wsId, payload, world.humans, clock.now());

    if (decision.kind === 'admit') {
      admit(ws, payload);
      return;
    }
    if (decision.kind === 'queued') {
      ws.send(encodeQueueStatus(decision.status));
      if (!alreadyQueued) {
        console.log(
          `[queue] ws=${ws.data.wsId} ticket=${decision.status.ticket} pos=${decision.status.position}/${decision.status.length}`,
        );
      }
      return;
    }
    rejectWaiter(ws, decision.reason);
  }

  function dispatch(ws: ServerWebSocket<SocketData>, data: Uint8Array, now: number): void {
    const op = readOpCode(data);
    if (op === OpCode.C2S_HELLO) {
      handleHello(ws, data);
      return;
    }
    if (op === OpCode.C2S_PING) {
      // 心跳同时是对时样本（ADR-0081）：客户端拿 serverSec + 时区偏移校准显示口径
      ws.send(
        encodePong(decodePing(data), {
          serverSec: clock.serverSec(),
          tzOffsetMin: clock.tzOffsetMin,
        }),
      );
      return;
    }

    const player = world.get(ws.data.playerId);
    if (!player) return;

    if (op === OpCode.C2S_MOVE) {
      // ---- 移动包独立频率窗口 ----
      // 总量窗口（maxMessagesPerSecond=120）挡不住「19 个 ping + 999 个 move」，
      // 而 move 是唯一每个包都改世界状态的指令，必须单独计量。
      // 软上限内照常处理（正常客户端 20Hz）；软到硬之间丢弃；过硬直接踢。
      if (now - ws.data.moveWindowStart > 1000) {
        ws.data.moveWindowStart = now;
        ws.data.moveCount = 0;
      }
      ws.data.moveCount += 1;
      if (ws.data.moveCount > config.security.moveHardLimit) {
        abuseClosed += 1;
        logAbuse('move-flood');
        ws.close(1008, 'move rate limit');
        return;
      }
      if (ws.data.moveCount > config.security.moveSoftLimit) {
        abuseDropped += 1;
        return;
      }
      const packet = decodeMove(data, MOVE_SCRATCH);
      const result = applyMove(player, packet, now, seats, world.ring);
      if (result.released.length > 0) broadcastSeats(result.released);
      if (!result.accepted) return;
      if (result.clamped) moveSampler.push(1);
      if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      return;
    }

    if (op === OpCode.C2S_ACTION) {
      // 人在公寓窗口里（ADR-0098）：坐 / 躺 / 起身一概不受理，按 F 才出门
      if (player.roomId !== 0) return;
      // 被押送时的输入硬直：坐 / 躺 / 起身全部拒绝，聊天仍走下面的频道
      if (now < player.stunUntil) return;
      // 昏迷 / 被救护车拖拽 / 病床治疗期间，座位动作全部由急救管理器接管
      if (player.incapacitated) return;
      const { action } = decodeAction(data);
      // 只有坐 / 躺 / 起身走这个包：发泄与跳随 20Hz 的 move 包上行（见 ADR-0051）
      if (action === ACTION.Stand) {
        broadcastSeats(seats.stand(player));
        return;
      }
      if (action === ACTION.Sit) {
        // 入座可能吸附位置：先改坐标，再通知空间索引与视野
        broadcastSeats(seats.sit(player, now));
        if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
        return;
      }
      if (action !== ACTION.Lie) return;
      // 座位上不能再躺第二次：先起身（床位已经是躺姿）
      if (player.seat !== 0) return;
      // 上床可能吸附位置：与 ACTION.Sit 同一条路径，先广播座位再刷空间索引；
      // 附近没有空床则退化为原来的地面躺。切姿势会中断叠加动作，由 applyState 一并清位。
      const changes = seats.lie(player, now);
      if (changes.length > 0) {
        broadcastSeats(changes);
        if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      }
      return;
    }

    if (op === OpCode.C2S_CHAT) {
      handleChat(
        player,
        decodeChatSend(data),
        now,
        world,
        transport,
        moderation,
        chatHistory,
        config.security.chatCooldownMs,
      );
      return;
    }

    if (op === OpCode.C2S_CHAT_HISTORY) {
      // 上翻节流：滚动抖动不该把服务端刷穿，窗口内的重复请求直接丢弃
      if (now - player.lastHistoryAt < CHAT_HISTORY_REQUEST_INTERVAL_MS) return;
      player.lastHistoryAt = now;
      const request = decodeChatHistoryRequest(data);
      // 页长以服务端配置为准：客户端传小值按小的发，传大值也不许放大下行预算
      const limit = Math.min(
        request.limit > 0 ? request.limit : config.chatHistory.pageSize,
        config.chatHistory.pageSize,
      );
      const page =
        request.beforeMsgId > 0
          ? chatHistory.before(request.beforeMsgId, limit, now)
          : chatHistory.latestPage(limit, now);
      sendHistoryPage(player.wsId, page, now, request.beforeMsgId === 0);
      return;
    }

    if (op === OpCode.C2S_SET_APPEARANCE) {
      player.appearance = decodeSetAppearance(data);
      player.dirty = true;
      // 换装会让缓存的入场资料失效：不失效的话，之后进入他视野的人会看到旧的帽子与配色
      player.markSpawnDirty();
      const packet = encodeAppearanceBroadcast(player.id, player.appearance);
      transport.send(player.wsId, packet);
      for (const id of player.known) {
        const other = world.get(id);
        if (other) transport.send(other.wsId, packet);
      }
      return;
    }

    if (op === OpCode.C2S_SET_STATUS) {
      // 节流只挡高频伪造包：正常用户在界面上改状态的间隔远大于 200ms
      if (now - player.lastStatusAt < STATUS_THROTTLE_MS) return;
      player.lastStatusAt = now;
      const text = decodeSetStatus(data);
      const verdict = text.length > 0 ? moderation.inspect(text) : null;
      if (verdict && verdict.verdict === 'reject') {
        console.warn(`[moderation] status reject ws=${player.wsId} hits=${verdict.hits}`);
      }
      // 与 HELLO 同一套规则：政治类清空，打码结果照常展示
      const next = verdict && verdict.verdict !== 'reject' ? verdict.text : '';
      if (next !== player.status) {
        player.status = next;
        // 状态进了入场资料的不变部分：不失效缓存，之后进入视野的人会看到旧状态
        player.markSpawnDirty();
      }
      // 即便没变化也回给自己：客户端据此把本地乐观值对齐成服务端裁决后的文本
      const packet = encodeStatusBroadcast(player.id, player.status);
      transport.send(player.wsId, packet);
      for (const id of player.known) {
        const other = world.get(id);
        if (other) transport.send(other.wsId, packet);
      }
      return;
    }

    if (op === OpCode.C2S_SET_NAME) {
      // 与状态同一条通道：只挡高频伪造包，正常用户在界面上改名的间隔远大于 1s
      if (now - player.lastRenameAt < RENAME_THROTTLE_MS) return;
      player.lastRenameAt = now;
      const result = resolveRename(player.name, decodeSetName(data), moderation);
      if (result.verdict === 'reject') {
        console.warn(`[moderation] name reject ws=${player.wsId} hits=${result.hits}`);
      }
      if (result.changed) {
        player.name = result.name;
        // 名字进了入场资料的不变部分：不失效缓存，之后进入视野的人会看到旧名字
        player.markSpawnDirty();
      }
      // 即便没变化也回给自己：客户端据此把本地乐观值对齐成服务端裁决后的名字
      const packet = encodeNameBroadcast(player.id, player.name);
      transport.send(player.wsId, packet);
      for (const id of player.known) {
        const other = world.get(id);
        if (other) transport.send(other.wsId, packet);
      }
      return;
    }

    if (op === OpCode.C2S_CAREER) {
      // 摘要是展示数据：限频只挡伪造包把视野广播当放大器，正常客户端 20s 才报一次
      if (now - player.lastCareerAt < CAREER_UPDATE_INTERVAL_MS) return;
      const incoming = decodeCareerReport(data);
      if (!incoming) return;
      player.lastCareerAt = now;
      const next = sanitizeIncomingCareer(incoming, player.wsId);
      player.career = next;
      // 入场包里的摘要段与 spawnBody 同一套缓存：补报后必须失效
      player.markCareerDirty();
      const packet = encodeCareerBroadcast({ entityId: player.id, career: next });
      for (const id of player.known) {
        const other = world.get(id);
        if (other) transport.send(other.wsId, packet);
      }
      return;
    }

    if (op === OpCode.C2S_RING_ENTER) {
      // 容量/阶段/靠近先做一次只读裁决，避免“站起来了却报不上名”
      const verdict = world.ring.canEnter(player);
      if (verdict !== true) {
        sendInteractReject(
          player,
          INTERACT_ACTION.RingEnter,
          verdict.ok ? INTERACT_REASON.Already : ringEnterReason(verdict.reason),
        );
        return;
      }
      // 报名费先冻结：扣不动就上不去，扣完进不去再原路退回
      if (!economy.freezeEscrow(player, ringFeeKey(player.id), RING_FEE)) {
        sendInteractReject(player, INTERACT_ACTION.RingEnter, INTERACT_REASON.NotEnoughCoins);
        return;
      }
      broadcastSeats(seats.stand(player));
      const result = world.ring.enter(player, now, RING_FEE);
      if (!result.ok) {
        economy.refundEscrow(player, ringFeeKey(player.id));
        sendInteractReject(player, INTERACT_ACTION.RingEnter, ringEnterReason(result.reason));
        return;
      }
      grid.update(player.id, player.x, player.y);
      player.needsViewRefresh = true;
      // 开赛/中途补入都由同一个快照包收口，客户端不需要推导阶段
      broadcastRing(world, transport, now);
      if (result.started) broadcastArenaPool();
      return;
    }

    if (op === OpCode.C2S_RING_LEAVE) {
      const leave = world.ring.leave(player, now);
      if (!leave.ok) {
        sendInteractReject(player, INTERACT_ACTION.RingLeave, INTERACT_REASON.Phase);
        return;
      }
      // 只有等待期离场才退报名费；颁奖期名次已结算，退费就是凭空造币
      if (leave.refundFee) economy.refundEscrow(player, ringFeeKey(player.id));
      // 离场顺手撤注（观战押注是另一个 key，不会误伤报名费）
      const dropped = world.ring.dropBet(player.id);
      if (dropped > 0) economy.refundEscrow(player, ringBetKey(player.id));
      grid.update(player.id, player.x, player.y);
      player.needsViewRefresh = true;
      broadcastRing(world, transport, now);
      broadcastArenaPool();
      return;
    }

    if (op === OpCode.C2S_BOARD) {
      // 按需查询：距离门 + 限频都收在 sim/board，dispatch 只负责解码与发送
      if (!canQueryBoard(player, now)) return;
      const requested = decodeBoardRequest(data);
      if (requested === undefined) return;
      player.lastBoardAt = now;
      const metrics = requested === BOARD_METRIC_ALL ? BOARD_METRIC_LIST : [requested];
      for (const metric of metrics) {
        transport.send(player.wsId, encodeBoard(buildBoardSnapshot(world.players.values(), metric, player.id)));
      }
      return;
    }

    if (op === OpCode.C2S_LIKE) {
      // 点赞裁决收在 sim/like：可见性、自赞、重复与限频都不进 Tick
      const targetId = decodeLikeRequest(data);
      if (targetId === undefined) return;
      handleLike(player, targetId, now, world, transport, (target) => {
        // 落盘口径以档案为准：目标在本会话的初始值也是从档案预置的，两边不会打架。
        // `addLike` 只在「没有这个档案」时返回 0，此时保留 like.ts 算出的会话计数，
        // 不要把它写成 0（否则一眼看过去像被清空）。
        if (!state || !target.deviceId) return;
        const counted = state.profiles.addLike(target.deviceId, now);
        if (counted > 0) target.likes = Math.min(MAX_LIKES, counted);
        state.markDirty();
      });
      return;
    }

    // ---- 打工产出 / 世界事件 / 每日悬赏（ADR-0088）----
    if (op === OpCode.C2S_WORK_CLAIM) {
      // 只消费一个展示用的连击数：金额一律由服务端按坐姿、间隔、工效与夜班算
      decodeWorkClaim(data);
      const hour = serverHourOf(now, clock.tzOffsetMin);
      const result = resolveWorkClaim(player, now, hour, Math.random());
      if (!result.ok) {
        const reason =
          result.reason === 'notSeated'
            ? INTERACT_REASON.NotSeated
            : result.reason === 'cooldown'
              ? INTERACT_REASON.Cooldown
              : result.reason === 'far'
                ? INTERACT_REASON.TooFar
                : result.reason === 'busy'
                  ? INTERACT_REASON.Busy
                  : INTERACT_REASON.Unknown;
        sendInteractReject(player, INTERACT_ACTION.WorkClaim, reason);
        return;
      }
      const outcome = result.outcome;
      economy.grantCoins(player, outcome.amount, WALLET_REASON.WorkPay);
      transport.send(
        player.wsId,
        encodeWorkResult({ amount: outcome.amount, mult: outcome.mult, night: outcome.night }),
      );
      // 悬赏「搬砖 2 轮」：只有真的结算成功才计
      quests.note(player, QUEST_ID.WorkRounds, 1, now);
      return;
    }

    if (op === OpCode.C2S_QUEST_CLAIM) {
      // 领取与商店共用同一道互动闸门：1 秒内重复点只算一次
      if (now - player.lastP2PAt < P2P_PACKET_INTERVAL_MS) {
        sendInteractReject(player, INTERACT_ACTION.QuestClaim, INTERACT_REASON.Cooldown);
        return;
      }
      player.lastP2PAt = now;
      const verdict = quests.claim(player, decodeQuestClaim(data), now);
      if (verdict !== 'ok') {
        sendInteractReject(
          player,
          INTERACT_ACTION.QuestClaim,
          verdict === 'claimed'
            ? INTERACT_REASON.Already
            : verdict === 'notReady'
              ? INTERACT_REASON.Phase
              : INTERACT_REASON.NoTarget,
        );
      }
      return;
    }

    if (op === OpCode.C2S_EVENT_CLAIM) {
      // 25 个人抢同一个池：闸门只挡连点，抢没抢到由调度器判
      if (now - player.lastP2PAt < P2P_PACKET_INTERVAL_MS) {
        sendInteractReject(player, INTERACT_ACTION.EventClaim, INTERACT_REASON.Cooldown);
        return;
      }
      player.lastP2PAt = now;
      if (!worldEvents.claim(player, decodeEventClaim(data), now)) {
        sendInteractReject(player, INTERACT_ACTION.EventClaim, INTERACT_REASON.Unknown);
      }
      return;
    }

    // ---- 牛马币互动（ADR-0082 / ADR-0083）----
    // 邀请 / 打赏 / 道具 / 购买共用同一道限频闸门：正常操作远慢于 500ms
    const interactive =
      op === OpCode.C2S_P2P_INVITE ||
      op === OpCode.C2S_P2P_ACTION ||
      op === OpCode.C2S_TIP ||
      op === OpCode.C2S_USE_ITEM ||
      op === OpCode.C2S_SHOP_BUY ||
      op === OpCode.C2S_SHOUT ||
      // 热区建筑（ADR-0087）：下注 / 押注 / 买院 / 房间操作同样共用这道闸门
      op === OpCode.C2S_DICE_BET ||
      op === OpCode.C2S_ARENA_BET ||
      op === OpCode.C2S_VILLA ||
      op === OpCode.C2S_APARTMENT;
    if (interactive && now - player.lastP2PAt < P2P_PACKET_INTERVAL_MS) {
      // 热区互动被限频时也要回执；P2P / 打赏 / 道具各有自己的拒绝包，这里只补热区玩法
      if (op === OpCode.C2S_DICE_BET) {
        sendInteractReject(player, INTERACT_ACTION.DiceBet, INTERACT_REASON.Cooldown);
      } else if (op === OpCode.C2S_ARENA_BET) {
        sendInteractReject(player, INTERACT_ACTION.ArenaBet, INTERACT_REASON.Cooldown);
      } else if (op === OpCode.C2S_VILLA) {
        sendInteractReject(player, INTERACT_ACTION.VillaBuy, INTERACT_REASON.Cooldown);
      } else if (op === OpCode.C2S_APARTMENT) {
        sendInteractReject(player, INTERACT_ACTION.Apartment, INTERACT_REASON.Cooldown);
      }
      return;
    }

    if (op === OpCode.C2S_P2P_INVITE) {
      player.lastP2PAt = now;
      challenge.invite(player, decodeP2PInvite(data), now);
      return;
    }

    if (op === OpCode.C2S_P2P_RESPOND) {
      challenge.respond(player, decodeP2PRespond(data), now);
      return;
    }

    if (op === OpCode.C2S_P2P_ACTION) {
      player.lastP2PAt = now;
      challenge.action(player, decodeP2PAction(data), now);
      return;
    }

    if (op === OpCode.C2S_TIP) {
      player.lastP2PAt = now;
      const request = decodeTipRequest(data);
      const target = world.get(request.targetId);
      // 打赏只发生在真人之间：NPC 没有可落盘的钱包，也不该成为洗币通道
      if (!target || target.wsId === 0 || target.id === player.id) return;
      if (!economy.trySpendCoins(player, request.amount, WALLET_REASON.TipOut)) return;
      economy.grantCoins(target, request.amount, WALLET_REASON.TipIn);
      // 两条广播各带一个「我是不是收钱方」的标志，前端据此写飘字文案
      transport.send(
        player.wsId,
        encodeTipBroadcast({
          fromId: player.id,
          toId: target.id,
          amount: request.amount,
          received: false,
        }),
      );
      transport.send(
        target.wsId,
        encodeTipBroadcast({
          fromId: player.id,
          toId: target.id,
          amount: request.amount,
          received: true,
        }),
      );
      return;
    }

    if (op === OpCode.C2S_USE_ITEM) {
      player.lastP2PAt = now;
      const request = decodeUseItem(data);
      // 目标校验、库存扣减、护盾与整蛊保护全部收在 sim/items（ADR-0085）
      useItem({ world, transport, economy, npcs }, player, request.targetId, request.itemId, now);
      return;
    }

    if (op === OpCode.C2S_SHOUT) {
      player.lastP2PAt = now;
      handleShout({ world, transport, economy, moderation }, player, decodeShout(data), now);
      return;
    }

    if (op === OpCode.C2S_SHOP_BUY) {
      player.lastP2PAt = now;
      const request = decodeShopBuy(data);
      if (request.kind === SHOP_KIND.Stat) {
        // 属性升级一次一级：价格由服务端按当前等级算，客户端报价只用于展示
        economy.upgradeStat(player, request.id);
      } else if (request.kind === SHOP_KIND.Item) {
        economy.buyItem(player, request.id, request.count <= 0 ? 1 : request.count);
      } else if (request.kind === SHOP_KIND.Cosmetic) {
        // 装扮货架：只认共享表里的 id，重复购买不扣钱
        economy.buyCosmetic(player, request.id);
      }
      return;
    }

    // ---- 热区建筑（ADR-0087）：赌桌 / 八角笼押注 / 豪宅 / 公寓 ----

    if (op === OpCode.C2S_DICE_BET) {
      player.lastP2PAt = now;
      const request = decodeDiceBet(data);
      // 入座门（ADR-0093）：必须坐在这一桌自己的圆凳上；站着只回一条拒绝包
      const hotspot = hotspotById(`dice-table-${request.table}`);
      if (!hotspot || !seatMatchesHotspot(hotspot, player.seat)) {
        sendInteractReject(player, INTERACT_ACTION.DiceBet, INTERACT_REASON.NotSeated);
        return;
      }
      if (!nearHotspot(`dice-table-${request.table}`, player)) {
        sendInteractReject(player, INTERACT_ACTION.DiceBet, INTERACT_REASON.TooFar);
        return;
      }
      if (dice.placeBet(player, request.table, request.side, request.amount, now)) {
        broadcastDice(dice, world, transport, now);
      } else {
        // placeBet 内部已按阶段 / 注额 / 重复下注 / 余额逐条判过；
        // 这里只补一条最可能的可读原因，客户端至少不会「点了没反应」
        const table = dice.table(request.table);
        const reason =
          !table || table.phase !== DICE_PHASE.Betting
            ? INTERACT_REASON.Phase
            : table.bets.has(player.id)
              ? INTERACT_REASON.Already
              : player.coins < Math.floor(request.amount)
                ? INTERACT_REASON.NotEnoughCoins
                : INTERACT_REASON.BadAmount;
        sendInteractReject(player, INTERACT_ACTION.DiceBet, reason);
      }
      return;
    }

    if (op === OpCode.C2S_ARENA_BET) {
      player.lastP2PAt = now;
      const request = decodeArenaBet(data);
      // 押注资格：必须坐在观战长椅上（ADR-0093 统一座位组判定），且比赛中、本局没押过
      if (!seatInGroup(player.seat, RING_BENCH_SEAT_GROUP)) {
        sendInteractReject(player, INTERACT_ACTION.ArenaBet, INTERACT_REASON.NotSeated);
        return;
      }
      const verdict = world.ring.betVerdict(player, request.side, request.amount, now);
      if (verdict !== 'ok') {
        sendInteractReject(
          player,
          INTERACT_ACTION.ArenaBet,
          verdict === 'phase'
            ? INTERACT_REASON.Phase
            : verdict === 'placed'
              ? INTERACT_REASON.Already
              : verdict === 'member'
                ? INTERACT_REASON.Already
                : INTERACT_REASON.BadAmount,
        );
        return;
      }
      if (!economy.freezeEscrow(player, ringBetKey(player.id), request.amount)) {
        sendInteractReject(player, INTERACT_ACTION.ArenaBet, INTERACT_REASON.NotEnoughCoins);
        return;
      }
      if (!world.ring.placeBet(player, request.side, request.amount, now)) {
        economy.refundEscrow(player, ringBetKey(player.id));
        sendInteractReject(player, INTERACT_ACTION.ArenaBet, INTERACT_REASON.Already);
        return;
      }
      broadcastArenaPool();
      return;
    }

    if (op === OpCode.C2S_VILLA) {
      player.lastP2PAt = now;
      const request = decodeVillaRequest(data);
      if (request.action === VILLA_ACTION.Buy) {
        if (!nearHotspot(`villa-${request.villa}-gate`, player)) {
          sendInteractReject(player, INTERACT_ACTION.VillaBuy, INTERACT_REASON.TooFar);
          return;
        }
        if (villas.record(request.villa)) {
          sendInteractReject(player, INTERACT_ACTION.VillaBuy, INTERACT_REASON.Sold);
          return;
        }
        if (player.coins < VILLA_PRICE) {
          sendInteractReject(player, INTERACT_ACTION.VillaBuy, INTERACT_REASON.NotEnoughCoins);
          return;
        }
        if (!villas.buy(player, request.villa, now)) {
          sendInteractReject(player, INTERACT_ACTION.VillaBuy, INTERACT_REASON.Sold);
          return;
        }
        applyVillaLocks();
        broadcastVilla();
        state?.markDirty();
        return;
      }
      if (request.action === VILLA_ACTION.ToggleLock) {
        if (!nearHotspot(`villa-${request.villa}-gate`, player)) {
          sendInteractReject(player, INTERACT_ACTION.VillaLock, INTERACT_REASON.TooFar);
          return;
        }
        const record = villas.record(request.villa);
        if (!record) {
          sendInteractReject(player, INTERACT_ACTION.VillaLock, INTERACT_REASON.NoTarget);
          return;
        }
        if (record.ownerDeviceId !== player.deviceId) {
          sendInteractReject(player, INTERACT_ACTION.VillaLock, INTERACT_REASON.OwnerOnly);
          return;
        }
        if (!villas.toggleLock(player, request.villa)) {
          sendInteractReject(player, INTERACT_ACTION.VillaLock, INTERACT_REASON.OwnerOnly);
          return;
        }
        applyVillaLocks();
        broadcastVilla();
        state?.markDirty();
        return;
      }
      if (request.action === VILLA_ACTION.Collect) {
        if (!nearHotspot(`villa-${request.villa}-tree`, player)) {
          sendInteractReject(player, INTERACT_ACTION.VillaCollect, INTERACT_REASON.TooFar);
          return;
        }
        const record = villas.record(request.villa);
        if (!record) {
          sendInteractReject(player, INTERACT_ACTION.VillaCollect, INTERACT_REASON.NoTarget);
          return;
        }
        if (record.ownerDeviceId !== player.deviceId) {
          sendInteractReject(player, INTERACT_ACTION.VillaCollect, INTERACT_REASON.OwnerOnly);
          return;
        }
        if (villas.collect(player, request.villa, now) > 0) broadcastVilla();
        else sendInteractReject(player, INTERACT_ACTION.VillaCollect, INTERACT_REASON.NoIncome);
        return;
      }
      sendInteractReject(player, INTERACT_ACTION.Unknown, INTERACT_REASON.NoTarget);
      return;
    }

    if (op === OpCode.C2S_APARTMENT) {
      player.lastP2PAt = now;
      const request = decodeApartmentRequest(data);
      if (request.action === APARTMENT_ACTION.Enter) {
        // 只认脚下这扇门：探头要出现在你站着的那栋楼上
        const slot = apartmentDoorSlotNear(player);
        if (slot < 0) {
          sendInteractReject(player, INTERACT_ACTION.Apartment, INTERACT_REASON.TooFar);
          return;
        }
        broadcastSeats(seats.stand(player));
        if (!apartment.enter(player, slot)) {
          // 20 个窗口都满了：只提示本人，不进楼
          const text = formatSystemNotice(SYSTEM_NOTICE_KIND.ApartmentFull);
          if (text && player.wsId !== 0) {
            transport.send(
              player.wsId,
              encodeSystemNotice({
                kind: SYSTEM_NOTICE_KIND.ApartmentFull,
                entityId: player.id,
                text,
              }),
            );
          }
          return;
        }
        grid.update(player.id, player.x, player.y);
        player.needsViewRefresh = true;
        broadcastApartmentPeek();
        return;
      }
      if (request.action === APARTMENT_ACTION.Exit) {
        // 人在窗口里：任意时刻按 F 都回门口台阶
        if (!apartment.exit(player)) {
          sendInteractReject(player, INTERACT_ACTION.Apartment, INTERACT_REASON.Phase);
          return;
        }
        grid.update(player.id, player.x, player.y);
        player.needsViewRefresh = true;
        broadcastApartmentPeek();
        return;
      }
      sendInteractReject(player, INTERACT_ACTION.Apartment, INTERACT_REASON.NoTarget);
      return;
    }
  }

  function handleClose(ws: ServerWebSocket<SocketData>): void {
    sockets.delete(ws.data.wsId);
    // 出队必须发生在世界清理之前：排队者的 playerId 还是 0，早退会把位次永久占住
    if (admission.drop(ws.data.wsId)) {
      console.log(`[queue] leave ws=${ws.data.wsId} remaining=${admission.queueLength}`);
    }
    const player = world.get(ws.data.playerId);
    if (!player) return;
    const label = `${player.name}#${player.id}`;
    // 先退赌注再清理世界：对局/邀请都按 player.id 引用，晚一步就成了悬空引用
    challenge.onDisconnect(player, clock.now());
    // 急救清理必须早于座位释放：在途救护车要立刻放空返航，队列 / 护盾也要移除
    clinic.onDisconnect(player.id, clock.now());
    // 盯梢中的保安立刻收工，别对着一个已经消失的目标原地打转
    npcs.cancelFollow(player.id);
    broadcastSeats(seats.release(player));
    // 擂台断线清理：先移除名单再广播，剩下的人继续计时，走空则回 idle
    const ringRemoval = world.ring.removePlayer(player.id, clock.now());
    if (ringRemoval.removed) {
      // 等待期断线：这一局没开打，报名费原路退回
      if (ringRemoval.refundFee) player.wallet.refundEscrow(ringFeeKey(player.id));
      // 两人都走了：把这局所有人的报名费一起退回，别让钱包永久少一笔。
      // 没有设备号的匿名会话没有可找回的账本，不能把别人的费用退到当前玩家身上。
      for (const fee of ringRemoval.abandonedFees) {
        if (!fee.deviceId) continue;
        wallets.get(fee.deviceId)?.refundEscrow(ringFeeKey(fee.playerId));
      }
      broadcastRing(world, transport, clock.now());
      state?.markDirty();
    }
    // 观战押注与赌桌注额原路退回；窗口释放，让后来的人能探头
    const droppedBet = world.ring.dropBet(player.id);
    if (droppedBet > 0) economy.refundEscrow(player, ringBetKey(player.id));
    dice.onDisconnect(player.id, world);
    const releasedWindow = apartment.leave(player.id);
    player.roomId = 0;
    if (releasedWindow) broadcastApartmentPeek();
    broadcastVilla();
    // 钱包记录离开时刻，容量淘汰按它排序；同时把最后一次变动带进落盘窗口
    wallets.touch(player.wallet, clock.now());
    state?.markDirty();
    // 必须在 broadcastDespawn 之前：它内部会清空 known，之后再播报就没人收了
    announceLeave(player, world, transport);
    broadcastDespawn(player, world, transport);
    grid.remove(player.id);
    world.destroy(player.id);
    console.log(`[game] - ${label} online=${world.humans}`);
  }

  const server = Bun.serve<SocketData>({
    port: config.port,
    hostname: config.hostname,
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        // 必须在 upgrade 之前拒绝：升级完成后再 close 已经算一次「连接成功」，
        // 攻击者能据此确认服务端活着，也白占了一个 wsId 与一条 socket。
        if (!originAllowed(req.headers.get('origin'))) {
          abuseClosed += 1;
          logAbuse('ws-origin');
          return new Response('forbidden origin', { status: 403 });
        }
        const wsId = nextWsId;
        nextWsId += 1;
        const now = clock.now();
        const upgraded = bunServer.upgrade(req, {
          data: {
            wsId,
            playerId: 0,
            openedAt: now,
            msgWindowStart: now,
            msgCount: 0,
            moveWindowStart: now,
            moveCount: 0,
          },
        });
        return upgraded ? undefined : new Response('websocket upgrade failed', { status: 400 });
      }
      if (url.pathname === '/health') {
        return Response.json(
          {
            ok: true,
            // 园区自述身份：选园页用它确认「连的确实是这一座」
            parkId: config.parkId,
            parkName: config.parkName,
            // online 只算真人：NPC 数量单独放在 npcs，口径永不合并
            online: world.humans,
            npcs: world.npcCount,
            npc: {
              count: npcs.count,
              guards: npcs.guardCount,
              // 只展示同事自身的推进耗时；tickMs 仍是包含它的真实总耗时
              updateMs: {
                avg: Number(npcSampler.average().toFixed(3)),
                p95: Number(npcSampler.percentile(0.95).toFixed(3)),
              },
            },
            tick: tickCount,
            tickMs: {
              avg: Number(tickSampler.average().toFixed(3)),
              p50: Number(tickSampler.percentile(0.5).toFixed(3)),
              p95: Number(tickSampler.percentile(0.95).toFixed(3)),
              max: Number(tickSampler.max().toFixed(3)),
            },
            egressKbps: Number(egress.kbps().toFixed(2)),
            admission: admission.snapshot(world.humans),
            clampedMoves: moveSampler.count,
            gridBuckets: grid.bucketCount,
            uptimeSec: Math.round(process.uptime()),
          },
          { headers: { 'access-control-allow-origin': '*' } },
        );
      }
      return new Response('niuma game server\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' },
      });
    },
    websocket: {
      maxPayloadLength: MAX_PACKET_BYTES,
      perMessageDeflate: false,
      open(ws) {
        sockets.set(ws.data.wsId, ws);
      },
      message(ws, message) {
        const now = clock.now();
        if (now - ws.data.msgWindowStart > 1000) {
          ws.data.msgWindowStart = now;
          ws.data.msgCount = 0;
        }
        ws.data.msgCount += 1;
        if (ws.data.msgCount > config.maxMessagesPerSecond) return;
        if (typeof message === 'string') return;
        const data = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
        if (data.byteLength === 0) return;

        // ---- 长度闸门：一次数组索引，判定「这个包配不配进 dispatch」----
        const verdict = checkPacket(data[0]!, data);
        if (verdict === PACKET_UNKNOWN) {
          // 不认识的 opcode 只丢不断：可能是新旧客户端混跑时的未来包
          abuseDropped += 1;
          return;
        }
        if (verdict === PACKET_MALFORMED) {
          // 截断包/长度不自洽：不抛异常、不进 try/catch、不打堆栈，直接断开。
          // 这种包正常客户端一个字节都不会发，发它的只可能是扫描器或外挂。
          abuseDropped += 1;
          abuseClosed += 1;
          logAbuse('malformed');
          ws.close(1008, 'malformed_packet');
          return;
        }

        try {
          dispatch(ws, data, now);
        } catch (error) {
          // 兜底：闸门放行但 decoder 仍抛了（说明闸门和协议的假设不一致）。
          // 同样只计数不打堆栈，否则攻击者可以让这里变成日志放大器。
          abuseDropped += 1;
          logAbuse('dispatch-error');
          if (process.env.GAME_DEBUG_PACKETS === '1') {
            console.error('[game] dropped malformed packet', error);
          }
        }
      },
      close(ws) {
        handleClose(ws);
      },
    },
  });

  const timer = setInterval(() => {
    tickCount += 1;
    const now = clock.now();

    // 没入场又不在队列里的连接才算「HELLO 超时」；排队者是在队列里等，不是掉线
    for (const socket of sockets.values()) {
      if (socket.data.playerId !== 0) continue;
      if (admission.isQueued(socket.data.wsId)) continue;
      if (now - socket.data.openedAt > config.helloTimeoutMs) {
        socket.close(1008, 'hello timeout');
      }
    }

    // 采样是 O(n log n)，按 sampleIntervalMs 限流，绝不进 20Hz 路径
    if (now - lastSampleAt >= config.admission.sampleIntervalMs) {
      lastSampleAt = now;
      const event = admission.observe(now, {
        egressKbps: egress.kbps(now),
        online: world.humans,
        tickP95Ms: tickSampler.percentile(0.95),
      });
      if (event) {
        console.log(
          `[gate] ${event.kind} capacity=${event.capacity} utilization=${event.utilization.toFixed(3)} queue=${admission.queueLength}`,
        );
      }
    }

    const { admitted, expired } = admission.drain(now, world.humans);
    for (const entry of expired) {
      const socket = sockets.get(entry.wsId);
      if (!socket) continue;
      console.log(`[queue] expire ws=${entry.wsId} waited=${Math.round(entry.waitedMs / 1000)}s`);
      rejectWaiter(socket, QUEUE_REJECT_REASON.WaitTimeout);
    }
    for (const entry of admitted) {
      const socket = sockets.get(entry.wsId);
      if (!socket || socket.readyState !== 1) continue;
      admit(socket, entry.payload);
    }

    // 排队位次每秒推一次，排队者除此之外不产生任何流量
    for (const { wsId, status } of admission.statuses(now, world.humans)) {
      const socket = sockets.get(wsId);
      if (socket && socket.readyState === 1) socket.send(encodeQueueStatus(status));
    }

    // 跨日重置必须先于发泄裁决：否则零点后的第一脚会先扣在昨日的 0 上，
    // 客户端要等下一 Tick 才看到回满。重置只广播一条 6 字节快照。
    if (world.boss.syncDay(now)) {
      broadcastBoss(world, transport, {
        hp: world.boss.hp,
        attackerId: 0,
        died: false,
        reset: true,
      });
      // 回满点推进了，即使血量本来就是满的也要落盘，否则重启会把旧回满点带回来
      state?.markDirty();
    }

    // 擂台计时/结算先于发泄：到点后 phase=award，后续出招会被冻结；
    // 领奖台传送产生的 moved 列表在同一 Tick 里补空间索引与视野刷新。
    const ringTick = world.ring.tick(now, world);
    for (const movedPlayer of ringTick.moved) {
      if (grid.update(movedPlayer.id, movedPlayer.x, movedPlayer.y)) {
        movedPlayer.needsViewRefresh = true;
      }
    }
    if (ringTick.changed) {
      broadcastRing(world, transport, now);
      broadcastArenaPool();
    }

    // 赌桌公共局：状态机每 Tick 推进；亮牌期的倒计时靠 1Hz 心跳刷新 HUD
    const diceChanged = dice.tick(now, world);
    if (diceChanged || now - lastDiceBroadcastAt >= 1000) {
      lastDiceBroadcastAt = now;
      broadcastDice(dice, world, transport, now);
    }

    // 豪宅：房主改名 / 上线要让牌匾跟着换字；每秒对齐一次可收币数
    if (villas.refreshOwners(world.players.values())) {
      broadcastVilla();
      state?.markDirty();
    } else if (now - lastVillaBroadcastAt >= 1000) {
      lastVillaBroadcastAt = now;
      broadcastVilla();
    }

    // 钱包容量淘汰：每分钟一次，在线与托管中的记录不淘汰
    if (now - lastWalletPruneAt >= 60_000) {
      lastWalletPruneAt = now;
      const onlineDevices = new Set<string>();
      for (const player of world.players.values()) {
        if (player.deviceId) onlineDevices.add(player.deviceId);
      }
      wallets.prune((id) => onlineDevices.has(id), now);
    }

    // 发泄结算必须跑在 runTick 之前：受害者被推开的坐标与躺姿要赶在同一 Tick 的
    // dirty 广播里发出去。放到 runTick 之后会晚 50ms，旁观者先看到站着、再看到倒下。
    // 入座者免伤（ADR-0065），因此这里不再产生座位释放条目。
    // 命中观察者与执法模块是同一个实例：没有保安 / 关闭执法时不存在，攻击自然不计数
    resolveVents(world, grid, transport, now, ventObserver, challenge.duelPort);

    // 冲击波在憋气结束后结算；调度器推进事件阶段。两者都是「一次数值比较」的早退，
    // 空闲时对 50ms 帧没有任何开销。
    bossShock.tick(now);
    worldEvents.tick(now);

    // 邀请超时与占位对局裁决都挂在同一个 Tick：内部有空表早退，稳态零开销
    challenge.tick(now);

    // 先看姿态边沿再派单：保安本 Tick 就能起步，抓取 / 拖行也在同一帧生效
    detention?.observe(now);

    // 同事的行为要跑在 runTick 之前：新坐标与朝向赶在同一 Tick 的 dirty 广播里发出去
    npcs.update(now);
    npcSampler.push(npcs.updateMs);

    // 押送事件已在本 Tick 回传；这里处理排队重试与断线 / 超时兜底
    detention?.update(now);

    // 救护车 / 病床治疗先于同步包结算：伤员的新坐标与姿态要在本 Tick 的 dirty 里发出去
    clinic.update(now, tickCount);

    // Buff 到期清理（ADR-0085）：条目上限 5，单遍扫描；只有真的过期才重算乘子
    for (const player of world.players.values()) pruneBuffs(player, now);

    const result = runTick(world, grid, transport, tickCount);
    tickSampler.push(result.duration);

    // 共享运行态落盘（ADR-0081）：只在指纹变化时打脏标记，
    // 写盘本身被 store 的 debounce 合并，绝不进 50ms 帧路径
    if (state) {
      if (world.ring.revision !== lastRingRevision) {
        lastRingRevision = world.ring.revision;
        state.markDirty();
      }
      if (world.boss.hp !== lastBossHp) {
        lastBossHp = world.boss.hp;
        state.markDirty();
      }
    }
  }, TICK_MS);

  const stop = (): void => {
    clearInterval(timer);
    detention?.dispose();
    // 退出路径必须同步落盘：共享运行态不能等下一次 debounce 窗口
    state?.flushSync();
    state?.dispose();
    server.stop(true);
  };

  return { server, stop, world, grid, admission, stats: () => ({ tickSampler, moveSampler }) };
}
