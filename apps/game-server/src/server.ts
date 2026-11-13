import type { ServerWebSocket } from 'bun';
import {
  ACTION,
  BOARD_METRIC_ALL,
  BOARD_METRIC_LIST,
  CAREER_UPDATE_INTERVAL_MS,
  CHAT_HISTORY_FLAG,
  CHAT_HISTORY_REQUEST_INTERVAL_MS,
  EMPTY_CAREER,
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
  decodePing,
  decodeSetAppearance,
  decodeSetName,
  decodeSetStatus,
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
  encodeWelcome,
  quantizeCoord,
  sanitizeCareer,
  SYNC_FORMAT_LEGACY,
  isAdLikeNickname,
  readOpCode,
  type CareerSummary,
  type SeatStateEntry,
} from '@niuma/shared-types';
import { AdmissionController, type HelloPayload } from './admission/controller';
import type { ServerConfig } from './config';
import { EgressMeter, RingSampler } from './metrics';
import { PACKET_MALFORMED, PACKET_UNKNOWN, checkPacket } from './net/guard';
import { createOriginGuard } from './net/origin';
import { SpatialGrid } from './spatial/grid';
import { buildBoardSnapshot, canQueryBoard } from './sim/board';
import { handleChat } from './sim/chat';
import { handleLike } from './sim/like';
import { ChatHistory, type ChatPage } from './sim/history';
import { loadModerationFilter } from './sim/moderation';
import { resolveRename } from './sim/name';
import { createNpcDirector, warmEscortGrid } from './npc';
import { Detention } from './sim/detention';
import { announceEnter, announceLeave } from './sim/notice';
import { applyMove } from './sim/movement';
import { broadcastRing } from './sim/ring';
import { resolveSpawn } from './sim/resume';
import { SeatRegistry } from './sim/seats';
import { runTick } from './sim/tick';
import { broadcastBoss } from './sim/boss';
import { resolveVents } from './sim/vent';
import { broadcastDespawn, refreshView, type Transport } from './sim/view';
import { World } from './sim/world';

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
  const world = new World();
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
  /**
   * 进程启动时刻：会话续算的硬上限（ADR-0060）。
   * 重启后世界与玩家都已消失，凭旧值虚增的在线时长必须一并失效。
   */
  const bootedAt = Date.now();

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
    const now = Date.now();
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
    const now = Date.now();
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
    );
    if (!player) {
      ws.close(1013, 'server full');
      return;
    }
    ws.data.playerId = player.id;
    // 必须在 refreshView 之前：入场首帧的视野同步就该按协商好的格式编码
    player.syncFormat = payload.syncFormat ?? SYNC_FORMAT_LEGACY;
    // 摘要同样要在 refreshView 之前落位：先进入视野的人会立刻收到带 career 的入场包
    player.career = payload.career ?? { ...EMPTY_CAREER };
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
    // 入场补发老板当前血量：新玩家不必等到下一次有人出招才知道血条位置。
    // 这里不调 syncDay，跨日重置只由 Tick 广播，避免入场者把 reset 事件吞掉。
    ws.send(encodeBoss({ hp: world.boss.hp, attackerId: 0, died: false, reset: false }));
    // 入场补发擂台当前快照：中途加入/围观的人不必等下一次 1Hz 心跳
    ws.send(encodeRing(world.ring.snapshot(now, world)));
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
    const sessionSec = clampSessionCarry(hello.sessionSec, (Date.now() - bootedAt) / 1000);
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
    };
    const alreadyQueued = admission.isQueued(ws.data.wsId);
    // 准入只看真人：NPC 是氛围实体，不该让真人少一个名额或排更久的队
    const decision = admission.decide(ws.data.wsId, payload, world.humans, Date.now());

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
      ws.send(encodePong(decodePing(data)));
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
      // 被押送时的输入硬直：坐 / 躺 / 起身全部拒绝，聊天仍走下面的频道
      if (now < player.stunUntil) return;
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
      if (world.ring.canEnter(player) !== true) return;
      broadcastSeats(seats.stand(player));
      const result = world.ring.enter(player, now);
      if (!result.ok) return;
      grid.update(player.id, player.x, player.y);
      player.needsViewRefresh = true;
      // 开赛/中途补入都由同一个快照包收口，客户端不需要推导阶段
      broadcastRing(world, transport, now);
      return;
    }

    if (op === OpCode.C2S_RING_LEAVE) {
      if (!world.ring.leave(player, now)) return;
      grid.update(player.id, player.x, player.y);
      player.needsViewRefresh = true;
      broadcastRing(world, transport, now);
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
      handleLike(player, targetId, now, world, transport);
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
    broadcastSeats(seats.release(player));
    // 擂台断线清理：先移除名单再广播，剩下的人继续计时，走空则回 idle
    if (world.ring.removePlayer(player.id, Date.now())) broadcastRing(world, transport, Date.now());
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
        const now = Date.now();
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
        const now = Date.now();
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
    const now = Date.now();

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
    }

    // 擂台计时/结算先于发泄：到点后 phase=award，后续出招会被冻结；
    // 领奖台传送产生的 moved 列表在同一 Tick 里补空间索引与视野刷新。
    const ringTick = world.ring.tick(now, world);
    for (const movedPlayer of ringTick.moved) {
      if (grid.update(movedPlayer.id, movedPlayer.x, movedPlayer.y)) {
        movedPlayer.needsViewRefresh = true;
      }
    }
    if (ringTick.changed) broadcastRing(world, transport, now);

    // 发泄结算必须跑在 runTick 之前：受害者被推开的坐标与躺姿要赶在同一 Tick 的
    // dirty 广播里发出去。放到 runTick 之后会晚 50ms，旁观者先看到站着、再看到倒下。
    // 入座者免伤（ADR-0065），因此这里不再产生座位释放条目。
    // 命中观察者与执法模块是同一个实例：没有保安 / 关闭执法时不存在，攻击自然不计数
    resolveVents(world, grid, transport, now, detention ?? undefined);

    // 先看姿态边沿再派单：保安本 Tick 就能起步，抓取 / 拖行也在同一帧生效
    detention?.observe(now);

    // 同事的行为要跑在 runTick 之前：新坐标与朝向赶在同一 Tick 的 dirty 广播里发出去
    npcs.update(now);
    npcSampler.push(npcs.updateMs);

    // 押送事件已在本 Tick 回传；这里处理排队重试与断线 / 超时兜底
    detention?.update(now);

    const result = runTick(world, grid, transport, tickCount);
    tickSampler.push(result.duration);
  }, TICK_MS);

  const stop = (): void => {
    clearInterval(timer);
    detention?.dispose();
    server.stop(true);
  };

  return { server, stop, world, grid, admission, stats: () => ({ tickSampler, moveSampler }) };
}
