import type { ServerWebSocket } from 'bun';
import {
  ACTION,
  CHAT_HISTORY_FLAG,
  CHAT_HISTORY_REQUEST_INTERVAL_MS,
  FALLBACK_NICKNAME,
  GRAZE_COOLDOWN_MS,
  MAX_PACKET_BYTES,
  OpCode,
  QUEUE_REJECT_REASON,
  TICK_MS,
  decodeAction,
  decodeChatHistoryRequest,
  decodeChatSend,
  decodeHello,
  decodeMove,
  decodePing,
  decodeSetAppearance,
  decodeSetStatus,
  encodeAppearanceBroadcast,
  encodeChatHistory,
  encodeGraze,
  encodePong,
  encodeQueueRejected,
  encodeQueueStatus,
  encodeSeatState,
  encodeStatusBroadcast,
  encodeWelcome,
  quantizeCoord,
  SYNC_FORMAT_LEGACY,
  readOpCode,
  type SeatStateEntry,
} from '@niuma/shared-types';
import { AdmissionController, type HelloPayload } from './admission/controller';
import type { ServerConfig } from './config';
import { EgressMeter, RingSampler } from './metrics';
import { SpatialGrid } from './spatial/grid';
import { handleChat } from './sim/chat';
import { ChatHistory, type ChatPage } from './sim/history';
import { loadModerationFilter } from './sim/moderation';
import { announceEnter, announceLeave } from './sim/notice';
import { applyMove } from './sim/movement';
import { resolveSpawn } from './sim/resume';
import { SeatRegistry } from './sim/seats';
import { runTick } from './sim/tick';
import { broadcastDespawn, refreshView, type Transport } from './sim/view';
import { World } from './sim/world';

interface SocketData {
  wsId: number;
  playerId: number;
  openedAt: number;
  msgWindowStart: number;
  msgCount: number;
}

const MOVE_SCRATCH = { id: 0, x: 0, y: 0, state: 0 };
/**
 * 状态广播的节流窗口。状态变更会发给视野内所有人，
 * 没有下限的话一条伪造包循环就能把整片 AOI 变成广播放大器。
 */
const STATUS_THROTTLE_MS = 200;

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

  /** 真正入场：建实体、回 WELCOME、结算首帧视野。排队者放行时复用的就是这条路径 */
  function admit(ws: ServerWebSocket<SocketData>, payload: HelloPayload): void {
    if (ws.data.playerId !== 0) return;
    const now = Date.now();
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
      now,
    );
    if (!player) {
      ws.close(1013, 'server full');
      return;
    }
    ws.data.playerId = player.id;
    // 必须在 refreshView 之前：入场首帧的视野同步就该按协商好的格式编码
    player.syncFormat = payload.syncFormat ?? SYNC_FORMAT_LEGACY;
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
      }),
    );
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
    console.log(`[game] + ${player.name}#${player.id} online=${world.size}`);
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
    if (nameVerdict.verdict !== 'allow') {
      console.warn(
        `[moderation] name ${nameVerdict.verdict} ws=${ws.data.wsId} hits=${nameVerdict.hits}`,
      );
    }
    // 状态与昵称同一套审核：政治类清空（不能上屏），脏话用打码结果继续展示
    const statusVerdict = hello.status.length > 0 ? moderation.inspect(hello.status) : null;
    if (statusVerdict && statusVerdict.verdict !== 'allow') {
      console.warn(
        `[moderation] status ${statusVerdict.verdict} ws=${ws.data.wsId} hits=${statusVerdict.hits}`,
      );
    }
    const payload: HelloPayload = {
      name: nameVerdict.verdict === 'reject' ? FALLBACK_NICKNAME : nameVerdict.text,
      appearance: hello.appearance,
      status: statusVerdict && statusVerdict.verdict !== 'reject' ? statusVerdict.text : '',
      // 排队期间跟着 payload 一起等；放行时才由 admit 重新校验
      resume: hello.resume,
      // 能力协商结果同样要跟着排队走：放行时才知道该给这个连接编 6 还是 7 字节
      syncFormat: hello.syncFormat,
    };
    const alreadyQueued = admission.isQueued(ws.data.wsId);
    const decision = admission.decide(ws.data.wsId, payload, world.size, Date.now());

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
      const packet = decodeMove(data, MOVE_SCRATCH);
      const result = applyMove(player, packet, now, seats);
      if (result.released.length > 0) broadcastSeats(result.released);
      if (!result.accepted) return;
      if (result.clamped) moveSampler.push(1);
      if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      return;
    }

    if (op === OpCode.C2S_ACTION) {
      const { action } = decodeAction(data);
      // 咀嚼是一次性事件：state 字节已满，不能挤进同步条目，限频后按视野定向广播（ADR-0048）
      if (action === ACTION.Graze) {
        if (now - player.lastGrazeAt < GRAZE_COOLDOWN_MS) return;
        player.lastGrazeAt = now;
        const packet = encodeGraze(player.id);
        // player.known 是「看得见我的人」：不含自己，本地已经即时发声
        for (const id of player.known) {
          const other = world.get(id);
          if (other) transport.send(other.wsId, packet);
        }
        return;
      }
      // 只有坐 / 躺 / 起身走这个包：叫唤与跳随 20Hz 的 move 包上行（见 ADR-0018）
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
      handleChat(player, decodeChatSend(data), now, world, transport, moderation, chatHistory);
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
    // 必须在 broadcastDespawn 之前：它内部会清空 known，之后再播报就没人收了
    announceLeave(player, world, transport);
    broadcastDespawn(player, world, transport);
    grid.remove(player.id);
    world.destroy(player.id);
    console.log(`[game] - ${label} online=${world.size}`);
  }

  const server = Bun.serve<SocketData>({
    port: config.port,
    hostname: config.hostname,
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        const wsId = nextWsId;
        nextWsId += 1;
        const upgraded = bunServer.upgrade(req, {
          data: {
            wsId,
            playerId: 0,
            openedAt: Date.now(),
            msgWindowStart: Date.now(),
            msgCount: 0,
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
            online: world.size,
            tick: tickCount,
            tickMs: {
              avg: Number(tickSampler.average().toFixed(3)),
              p50: Number(tickSampler.percentile(0.5).toFixed(3)),
              p95: Number(tickSampler.percentile(0.95).toFixed(3)),
              max: Number(tickSampler.max().toFixed(3)),
            },
            egressKbps: Number(egress.kbps().toFixed(2)),
            admission: admission.snapshot(world.size),
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
        if (data.byteLength === 0 || data.byteLength > MAX_PACKET_BYTES) return;
        try {
          dispatch(ws, data, now);
        } catch (error) {
          console.error('[game] dropped malformed packet', error);
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
        online: world.size,
        tickP95Ms: tickSampler.percentile(0.95),
      });
      if (event) {
        console.log(
          `[gate] ${event.kind} capacity=${event.capacity} utilization=${event.utilization.toFixed(3)} queue=${admission.queueLength}`,
        );
      }
    }

    const { admitted, expired } = admission.drain(now, world.size);
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
    for (const { wsId, status } of admission.statuses(now, world.size)) {
      const socket = sockets.get(wsId);
      if (socket && socket.readyState === 1) socket.send(encodeQueueStatus(status));
    }

    const result = runTick(world, grid, transport, tickCount);
    tickSampler.push(result.duration);
  }, TICK_MS);

  const stop = (): void => {
    clearInterval(timer);
    server.stop(true);
  };

  return { server, stop, world, grid, admission, stats: () => ({ tickSampler, moveSampler }) };
}
