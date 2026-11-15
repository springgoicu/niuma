import { loadConfig } from './config';
import { startGameServer } from './server';

const config = loadConfig();
const { server, stop } = startGameServer(config);

console.log(`[game] http://localhost:${config.port}  ws://localhost:${config.port}/ws`);
console.log(
  config.state.path.trim() === ''
    ? '[game] 共享运行态未持久化：重启后擂台与老板清零'
    : `[game] 共享运行态写入 ${config.state.path}（其余仍在内存）`,
);

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
