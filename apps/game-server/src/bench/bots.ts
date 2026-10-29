import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  OpCode,
  POSE,
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
}

const bots: Bot[] = [];
const timers: Array<ReturnType<typeof setInterval>> = [];
let connected = 0;
let totalBytes = 0;
let totalPackets = 0;
let chatPackets = 0;
let spawnPackets = 0;

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
      if (bot.entityId === 0 && view[0] === OpCode.S2C_WELCOME) {
        bot.entityId = decodeWelcome(view).entityId;
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
  const perBot = connected > 0 ? (totalBytes / connected / seconds / 1024).toFixed(2) : '0';
  console.log(
    `[bench] online=${connected}/${TOTAL} packets=${totalPackets} down=${(totalBytes / 1024 / 1024).toFixed(2)}MB (${perBot}KB/s per bot)`,
  );
}, 5000);

setTimeout(async () => {
  clearInterval(report);
  for (const timer of timers) clearInterval(timer);
  for (const bot of bots) bot.socket.close();

  const seconds = DURATION_MS / 1000;
  console.log('\n[bench] ===== summary =====');
  console.log(`bots          : ${bots.length} (connected ${connected})`);
  console.log(`duration      : ${seconds}s`);
  console.log(`packets       : ${totalPackets} (${(totalPackets / seconds).toFixed(0)}/s)`);
  console.log(`downstream    : ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`per bot       : ${connected > 0 ? (totalBytes / connected / seconds / 1024).toFixed(2) : '0'} KB/s`);
  console.log(`spawn packets : ${spawnPackets}`);
  console.log(`chat packets  : ${chatPackets}`);

  const health = await fetch(HEALTH_URL).then((res) => res.json());
  console.log('[bench] server health:', JSON.stringify(health));
  process.exit(0);
}, DURATION_MS);
