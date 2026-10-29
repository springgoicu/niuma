import { loadConfig } from './config';
import { startGameServer } from './server';

const config = loadConfig();
const { server, stop } = startGameServer(config);

console.log(`[game] http://localhost:${config.port}  ws://localhost:${config.port}/ws`);
console.log(`[game] world is in-memory only: nothing is persisted, restart wipes the plaza`);

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
