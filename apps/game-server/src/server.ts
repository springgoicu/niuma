import type { ServerWebSocket } from 'bun';
import {
  ACTION,
  MAX_PACKET_BYTES,
  OpCode,
  POSE,
  TICK_MS,
  decodeAction,
  decodeChatSend,
  decodeHello,
  decodeMove,
  decodePing,
  decodeSetAppearance,
  encodeAppearanceBroadcast,
  encodePong,
  encodeWelcome,
  findFreePoint,
  quantizeCoord,
  readOpCode,
  WORLD_CENTER,
} from '@niuma/shared-types';
import type { ServerConfig } from './config';
import { RingSampler } from './metrics';
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
  let nextWsId = 1;
  let tickCount = 0;

  const transport: Transport = {
    send(wsId, data) {
      const socket = sockets.get(wsId);
      if (!socket || socket.readyState !== 1) return;
      socket.send(data);
    },
  };

  function handleHello(ws: ServerWebSocket<SocketData>, data: Uint8Array): void {
    if (ws.data.playerId !== 0) return;
    const hello = decodeHello(data);
    const point = spawnPoint(config.spawnRadius);
    const player = world.create(hello.name, hello.appearance, ws.data.wsId, point.x, point.y);
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
    for (const socket of sockets.values()) {
      if (socket.data.playerId === 0 && now - socket.data.openedAt > config.helloTimeoutMs) {
        socket.close(1008, 'hello timeout');
      }
    }
    const result = runTick(world, grid, transport, tickCount);
    tickSampler.push(result.duration);
  }, TICK_MS);

  const stop = (): void => {
    clearInterval(timer);
    server.stop(true);
  };

  return { server, stop, world, grid, stats: () => ({ tickSampler, moveSampler }) };
}
