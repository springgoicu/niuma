export interface ServerConfig {
  port: number;
  hostname: string;
  /** 单连接每秒最多处理的消息数，超出直接丢弃，防止单客户端打满 Tick */
  maxMessagesPerSecond: number;
  helloTimeoutMs: number;
  /** 出生点散布半径（像素），压测时放大可模拟稀疏分布 */
  spawnRadius: number;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    port: readInt(process.env.GAME_SERVER_PORT, 3001),
    hostname: process.env.GAME_SERVER_HOST ?? '0.0.0.0',
    maxMessagesPerSecond: readInt(process.env.GAME_SERVER_MAX_MPS, 120),
    helloTimeoutMs: 5000,
    spawnRadius: readInt(process.env.GAME_SPAWN_RADIUS, 240),
  };
}
