import type { ServerWebSocket } from 'bun';
import {
  ACTION,
  MAX_PACKET_BYTES,
  OpCode,
  POSE,
  QUEUE_REJECT_REASON,
  TICK_MS,
  decodeAction,
  decodeChatSend,
  decodeHello,
  decodeMove,
  decodePing,
  decodeSetAppearance,
  encodeAppearanceBroadcast,
  encodePong,
  encodeQueueRejected,
  encodeQueueStatus,
  encodeWelcome,
  findFreePoint,
  quantizeCoord,
  readOpCode,
  WORLD_CENTER,
} from '@niuma/shared-types';
import { AdmissionController, type HelloPayload } from './admission/controller';
import type { ServerConfig } from './config';
import { EgressMeter, RingSampler } from './metrics';
import { SpatialGrid } from './spatial/grid';
import { handleChat } from './sim/chat';
import { applyMove } from './sim/movement';
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

/** 出生点在广场内散布；落进花坛/水面时由 findFreePoint 就近挪到空地 */
function spawnPoint(radius: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radius;
  const x = WORLD_CENTER.x + Math.cos(angle) * distance;
  const y = WORLD_CENTER.y + Math.sin(angle) * distance;
  return findFreePoint(x, y);
}

export function startGameServer(config: ServerConfig) {
  const world = new World();
  const grid = new SpatialGrid();
  const sockets = new Map<number, ServerWebSocket<SocketData>>();
  const tickSampler = new RingSampler(1200);
  const moveSampler = new RingSampler(1200);
  const egress = new EgressMeter();
  const admission = new AdmissionController(config.admission);
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

  /** 真正入场：建实体、回 WELCOME、结算首帧视野。排队者放行时复用的就是这条路径 */
  function admit(ws: ServerWebSocket<SocketData>, payload: HelloPayload): void {
    if (ws.data.playerId !== 0) return;
    const point = spawnPoint(config.spawnRadius);
    const player = world.create(payload.name, payload.appearance, ws.data.wsId, point.x, point.y);
    if (!player) {
      ws.close(1013, 'server full');
      return;
    }
    ws.data.playerId = player.id;
    grid.insert(player.id, player.x, player.y);
    ws.send(
      encodeWelcome({
        entityId: player.id,
        tick: tickCount,
        x: quantizeCoord(player.x),
        y: quantizeCoord(player.y),
      }),
    );
    refreshView(player, world, grid, transport);
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
    const payload: HelloPayload = { name: hello.name, appearance: hello.appearance };
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
      const result = applyMove(player, packet, now);
      if (!result.accepted) return;
      if (result.clamped) moveSampler.push(1);
      if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      return;
    }

    if (op === OpCode.C2S_ACTION) {
      const { action } = decodeAction(data);
      const pose = action === ACTION.Sit ? POSE.Sit : action === ACTION.Lie ? POSE.Lie : POSE.Emote;
      player.applyState(player.direction, pose, false);
      player.dirty = true;
      return;
    }

    if (op === OpCode.C2S_CHAT) {
      handleChat(player, decodeChatSend(data), now, world, transport);
      return;
    }

    if (op === OpCode.C2S_SET_APPEARANCE) {
      player.appearance = decodeSetAppearance(data);
      player.dirty = true;
      const packet = encodeAppearanceBroadcast(player.id, player.appearance);
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
