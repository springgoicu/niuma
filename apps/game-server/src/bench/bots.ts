import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  OpCode,
  POSE,
  decodeQueueRejected,
  decodeQueueStatus,
  decodeWelcome,
  encodeChatSend,
  encodeHello,
  encodeMove,
  packState,
  quantizeCoord,
} from '@niuma/shared-types';

const URL = process.env.BENCH_URL ?? 'ws://127.0.0.1:3001/ws';
const HEALTH_URL = process.env.BENCH_HEALTH ?? 'http://127.0.0.1:3001/health';
const TOTAL = Number(process.env.BENCH_BOTS ?? 200);
const DURATION_MS = Number(process.env.BENCH_MS ?? 20000);
/** 出生散布半径：600 = 全员同屏的最坏情况，3000 = 广场级稀疏分布 */
const SPREAD = Number(process.env.BENCH_SPREAD ?? 600);

interface Bot {
  socket: WebSocket;
  entityId: number;
  x: number;
  y: number;
  bytes: number;
  packets: number;
  /** 首次收到排队快照的时刻，用于统计真实等待时长 */
  queuedAt: number;
  /** 排队期间见过的最大位次 */
  peakPosition: number;
}

const bots: Bot[] = [];
const timers: Array<ReturnType<typeof setInterval>> = [];
let connected = 0;
/** 真正拿到 WELCOME 的机器人数；排队中的人不算在线 */
let admitted = 0;
let totalBytes = 0;
let totalPackets = 0;
let chatPackets = 0;
let spawnPackets = 0;

/** 排队探针：只在 BENCH_QUEUE_PROBE=1 时汇总，验证闸门真的按水位闭合 */
const PROBE = process.env.BENCH_QUEUE_PROBE === '1';
const startedAt = Date.now();
let queuedNow = 0;
let peakQueued = 0;
let rejected = 0;
let firstAdmitAfterQueueMs = 0;
const waitSamples: number[] = [];
const positionSamples: number[] = [];
const rejectReasons: Record<number, number> = {};

function spawnBot(index: number): void {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * SPREAD;
  const bot: Bot = {
    socket: new WebSocket(URL),
    entityId: 0,
    x: 4096 + Math.cos(angle) * radius,
    y: 4096 + Math.sin(angle) * radius,
    bytes: 0,
    packets: 0,
    queuedAt: 0,
    peakPosition: 0,
  };
  bot.socket.binaryType = 'arraybuffer';
  bots.push(bot);

  bot.socket.addEventListener('open', () => {
    connected += 1;
    bot.socket.send(encodeHello(`bot-${index}`, DEFAULT_APPEARANCE.cow));
    const timer = setInterval(() => {
      if (bot.entityId === 0) return;
      bot.x += (Math.random() - 0.5) * 7;
      bot.y += (Math.random() - 0.5) * 7;
      const direction = Math.random() > 0.5 ? DIRECTION.Right : DIRECTION.Left;
      bot.socket.send(
        encodeMove({
          id: bot.entityId,
          x: quantizeCoord(bot.x),
          y: quantizeCoord(bot.y),
          state: packState(direction, POSE.Walk, true),
        }),
      );
    }, 50);
    timers.push(timer);
  });

  bot.socket.addEventListener('message', (event) => {
    const data = event.data;
    const size = typeof data === 'string' ? data.length : (data as ArrayBuffer).byteLength;
    bot.bytes += size;
    bot.packets += 1;
    totalBytes += size;
    totalPackets += 1;
    if (size > 0 && data instanceof ArrayBuffer) {
      const view = new Uint8Array(data);
      if (view[0] === OpCode.S2C_CHAT_BROADCAST) chatPackets += 1;
      else if (view[0] === OpCode.S2C_ENTITY_SPAWN) spawnPackets += 1;

      if (view[0] === OpCode.S2C_QUEUE_STATUS) {
        const status = decodeQueueStatus(view);
        if (bot.queuedAt === 0) {
          bot.queuedAt = Date.now();
          queuedNow += 1;
          peakQueued = Math.max(peakQueued, queuedNow);
        }
        bot.peakPosition = Math.max(bot.peakPosition, status.position);
        positionSamples.push(status.position);
      } else if (view[0] === OpCode.S2C_QUEUE_REJECTED) {
        const { reason } = decodeQueueRejected(view);
        rejected += 1;
        rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1;
      } else if (bot.entityId === 0 && view[0] === OpCode.S2C_WELCOME) {
        bot.entityId = decodeWelcome(view).entityId;
        admitted += 1;
        if (bot.queuedAt > 0) {
          waitSamples.push(Date.now() - bot.queuedAt);
          if (firstAdmitAfterQueueMs === 0) firstAdmitAfterQueueMs = Date.now() - startedAt;
          queuedNow = Math.max(0, queuedNow - 1);
          bot.queuedAt = 0;
        }
      }
    }
  });

  bot.socket.addEventListener('error', () => {
    console.error(`[bench] bot-${index} socket error`);
  });
}

for (let i = 0; i < TOTAL; i += 1) spawnBot(i);

// 只让 1 号机器人说话，避免打满聊天限流
const chatter = setInterval(() => {
  const bot = bots[0];
  if (!bot || bot.entityId === 0) return;
  bot.socket.send(encodeChatSend('摸鱼中，勿扰'));
}, 1500);
timers.push(chatter);

const report = setInterval(() => {
  const seconds = DURATION_MS / 1000;
  const perBot = admitted > 0 ? (totalBytes / admitted / seconds / 1024).toFixed(2) : '0';
  console.log(
    `[bench] online=${admitted}/${TOTAL}${PROBE ? ` queued=${queuedNow}` : ''} packets=${totalPackets} down=${(totalBytes / 1024 / 1024).toFixed(2)}MB (${perBot}KB/s per bot)`,
  );
}, 5000);

setTimeout(async () => {
  clearInterval(report);
  for (const timer of timers) clearInterval(timer);
  for (const bot of bots) bot.socket.close();

  const seconds = DURATION_MS / 1000;
  console.log('\n[bench] ===== summary =====');
  console.log(`bots          : ${bots.length} (connected ${connected}, admitted ${admitted})`);
  console.log(`duration      : ${seconds}s`);
  console.log(`packets       : ${totalPackets} (${(totalPackets / seconds).toFixed(0)}/s)`);
  console.log(`downstream    : ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`per bot       : ${admitted > 0 ? (totalBytes / admitted / seconds / 1024).toFixed(2) : '0'} KB/s`);
  console.log(`spawn packets : ${spawnPackets}`);
  console.log(`chat packets  : ${chatPackets}`);

  if (PROBE) {
    const avgWait = waitSamples.length > 0 ? waitSamples.reduce((sum, ms) => sum + ms, 0) / waitSamples.length : 0;
    console.log('[bench] ===== queue probe =====');
    console.log(`peak queued   : ${peakQueued}`);
    console.log(`still queued  : ${queuedNow}`);
    console.log(`rejected      : ${rejected} ${JSON.stringify(rejectReasons)}`);
    console.log(`first admit   : ${(firstAdmitAfterQueueMs / 1000).toFixed(1)}s after start`);
    console.log(`avg wait      : ${(avgWait / 1000).toFixed(1)}s over ${waitSamples.length} admitted bots`);
    console.log(`max position  : ${Math.max(0, ...positionSamples)}`);
  }

  const health = await fetch(HEALTH_URL).then((res) => res.json());
  console.log('[bench] server health:', JSON.stringify(health));
  process.exit(0);
}, DURATION_MS);
