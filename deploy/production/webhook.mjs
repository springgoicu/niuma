#!/usr/bin/env node
/**
 * Gitee Webhook → 部署触发器。
 *
 * 只做三件事：验签、判断分支、拉起 deploy.sh。构建与回滚由 deploy.sh 负责，
 * 这里绝不碰业务逻辑，挂了也不影响线上（最坏是这次 push 没自动发版）。
 *
 * 监听 127.0.0.1:9100，不直接对公网：nginx 用一条随机路径反代进来，
 * 路径本身是第一层密钥，X-Gitee-Token 是第二层。
 *
 * 环境变量（/etc/niuma/webhook.env）：
 *   HOOK_TOKEN      Gitee 仓库设置里填的「WebHook 密码」
 *   DEPLOY_SCRIPT   默认 /srv/niuma/src/deploy/production/deploy.sh
 *   DEPLOY_BRANCH   默认 master
 *   PORT            默认 9100
 *   LOG_FILE        默认 /var/log/niuma/webhook.log
 */
import { spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 9100);
const TOKEN = process.env.HOOK_TOKEN ?? '';
const BRANCH = process.env.DEPLOY_BRANCH ?? 'master';
const DEPLOY_SCRIPT = process.env.DEPLOY_SCRIPT ?? '/srv/niuma/src/deploy/production/deploy.sh';
const LOG_FILE = process.env.LOG_FILE ?? '/var/log/niuma/webhook.log';

mkdirSync(dirname(LOG_FILE), { recursive: true });

/** 免得一次 push 把硬盘写满 */
const MAX_BODY = 1 << 20;

/** 上一次部署的状态，供 /status 查看；pending 是构建期间被合并的下一次推送 */
let state = { running: false, startedAt: null, lastExit: null, lastRev: null, lastAt: null, pending: null };

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(text);
  try {
    appendFileSync(LOG_FILE, text);
  } catch {
    /* 日志写不进去也不能让 hook 挂掉 */
  }
}

function tokenOk(header) {
  if (!TOKEN) return false;
  const given = Buffer.from(String(header ?? ''));
  const want = Buffer.from(TOKEN);
  // 长度不同时 timingSafeEqual 会抛，先比长度
  return given.length === want.length && timingSafeEqual(given, want);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runDeploy(reason) {
  state.running = true;
  state.startedAt = new Date().toISOString();
  const out = createWriteStream(LOG_FILE, { flags: 'a' });
  out.write(`\n[${new Date().toISOString()}] ===== 触发部署：${reason} =====\n`);

  // LOG_FILE 是本进程的日志，不能漏给 deploy.sh：它会读同名变量做自己的 tee，
  // 结果两份日志串到一起，每行还会出现两遍（tee 一份、父进程 pipe 一份）
  const childEnv = { ...process.env, FORCE: '0' };
  delete childEnv.LOG_FILE;

  const child = spawn('bash', [DEPLOY_SCRIPT], {
    cwd: dirname(DEPLOY_SCRIPT),
    env: childEnv,
    detached: false,
  });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on('close', (code) => {
    state.running = false;
    state.lastExit = code;
    state.lastAt = new Date().toISOString();
    out.write(`[${new Date().toISOString()}] ===== 部署结束，退出码 ${code} =====\n`);
    out.end();
    log(`部署结束，退出码 ${code}`);

    // 构建期间到达的推送不能丢：旧版直接返回 202 就忘了，最后一次提交会永远
    // 停在 gitee 上（线上依旧跑上一版）。等当前部署彻底收尾后再补跑一次，
    // 仍然保持「同一时刻只有一个构建」——2 vCPU 上并行构建会把游戏 Tick 拖垮。
    if (state.pending) {
      const next = state.pending;
      state.pending = null;
      log(`补发：构建期间又收到推送（${next}）`);
      setTimeout(() => runDeploy(next), 1000);
    }
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (url.pathname !== '/deploy') {
    res.writeHead(404).end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' }).end();
    return;
  }

  if (!tokenOk(req.headers['x-gitee-token'])) {
    log(`拒绝：token 不匹配（来源 ${req.socket.remoteAddress}）`);
    res.writeHead(403).end('forbidden');
    return;
  }

  // 只认 push 事件。Gitee 的 WebHook 可以同时勾选 Issue / PR / Tag 等多种事件，
  // 那些载荷没有 ref/after，走后面的分支判断会「看起来像一次无 ref 的推送」而触发发版。
  // 头缺失时放行：自建的 curl 冒烟脚本不发这个头，路径 + token 已经是两层密钥。
  const event = String(req.headers['x-gitee-event'] ?? '');
  if (event && !/push/i.test(event)) {
    log(`忽略：事件类型 ${event}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ skipped: true, event }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    res.writeHead(400).end('bad payload');
    return;
  }

  // Gitee push 载荷的 ref 形如 refs/heads/master
  const ref = String(payload?.ref ?? '');
  const rev = String(payload?.after ?? payload?.checkout_sha ?? '').slice(0, 8);
  if (ref && ref !== `refs/heads/${BRANCH}`) {
    log(`忽略：分支 ${ref} 不是 refs/heads/${BRANCH}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ skipped: true, ref }));
    return;
  }

  if (state.running) {
    // 后来的推送覆盖 pending：deploy.sh 每次都拉 origin/master 最新，
    // 只要最后补发一次就能把期间所有提交一起发上线，不必逐个排队。
    const reason = `${ref || 'manual'} ${rev}`;
    state.pending = reason;
    state.lastRev = rev || state.lastRev;
    log(`排队：已有部署在跑，记下 ${reason}，结束后补发`);
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ queued: true, pending: reason }));
    return;
  }

  state.lastRev = rev || null;
  log(`接受：${ref || '(no ref)'} ${rev}`);
  runDeploy(`${ref || 'manual'} ${rev}`);

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, rev }));
});

server.listen(PORT, '127.0.0.1', () => log(`webhook 监听 127.0.0.1:${PORT}，分支 ${BRANCH}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
