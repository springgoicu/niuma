import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);
const WEB_PORT = Number(process.env.WEB_INTERNAL_PORT ?? 3002);
const GAME_PORT = Number(process.env.GAME_SERVER_PORT ?? 3001);
const GAME_HOST = '127.0.0.1';
const WEB_HOST = '127.0.0.1';

const mode = process.argv.includes('--prod') ? 'start' : 'dev';

const manifestPath = path.join(rootDir, 'apps/web/public/sprites/manifest.json');
const brandLogoPath = path.join(rootDir, 'apps/web/public/brand/logo-48.png');
if (!fs.existsSync(manifestPath) || !fs.existsSync(brandLogoPath)) {
  console.log('[niuma] generating pixel assets...');
  const res = spawnSync('npm', ['run', 'assets'], { cwd: rootDir, stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const gameProc = spawn(
  'npm',
  ['run', mode === 'start' ? 'start' : 'dev', '--workspace=apps/game-server'],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      GAME_SERVER_HOST: GAME_HOST,
      GAME_SERVER_PORT: String(GAME_PORT),
    },
  },
);

const webArgs =
  mode === 'start'
    ? ['exec', '--workspace=apps/web', '--', 'next', 'start', '-p', String(WEB_PORT), '-H', WEB_HOST]
    : ['exec', '--workspace=apps/web', '--', 'next', 'dev', '-p', String(WEB_PORT), '-H', WEB_HOST];

const webProc = spawn('npm', webArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(WEB_PORT),
  },
});

function pickTarget(urlPath = '/') {
  if (urlPath === '/ws' || urlPath.startsWith('/ws?') || urlPath === '/health' || urlPath.startsWith('/health?')) {
    return { host: GAME_HOST, port: GAME_PORT };
  }
  return { host: WEB_HOST, port: WEB_PORT };
}

const proxyServer = http.createServer((req, res) => {
  const target = pickTarget(req.url ?? '/');
  const upstream = http.request(
    {
      hostname: target.host,
      port: target.port,
      path: req.url ?? '/',
      method: req.method,
      headers: {
        ...req.headers,
        'x-forwarded-host': req.headers.host ?? '',
        'x-forwarded-proto': 'http',
      },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '1' });
    }
    res.end('Service starting, please refresh in a moment.');
  });

  req.pipe(upstream);
});

proxyServer.on('upgrade', (req, clientSocket, head) => {
  const target = pickTarget(req.url ?? '/');
  const upstreamSocket = net.connect(target.port, target.host, () => {
    const headerLines = [`${req.method} ${req.url ?? '/'} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstreamSocket.write(`${headerLines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstreamSocket.destroy());
});

proxyServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[niuma] gateway listening on http://0.0.0.0:${PORT} (web:${WEB_PORT}, game:${GAME_PORT})`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  proxyServer.close();
  gameProc.kill(signal);
  webProc.kill(signal);
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

gameProc.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[niuma] game-server exited with code ${code}`);
    shutdown('SIGTERM');
  }
});

webProc.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[niuma] web exited with code ${code}`);
    shutdown('SIGTERM');
  }
});
