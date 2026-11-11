# 生产部署（单机 + Gitee 自动化）

`docs/deploy-multi-park.md` 讲的是**两台机器**的角色划分；本文讲**一辆机器跑完整个站点**时
怎么把它装起来、怎么发版、出事怎么退回去。两者不冲突：单机就是那张拓扑图里机器 1 的
`DEPLOY_ROLE=all`，只是暂时没有机器 2。

## 一架新机器，一条命令

```bash
# 0) 前提（只有这两件必须人工做，API 也替代不了你点控制台）
#    · 域名 A 记录指向这台机器
#    · 云厂商安全组放通 TCP 80 / 443

# 1) 拿到代码（私有仓库需要凭据）
git clone https://gitee.com/mySia/niuma.git && cd niuma

# 2) 装
sudo DOMAIN=bangying.top \
     GIT_USER=<gitee 用户名> \
     GIT_PASS=<gitee 密码或私人令牌> \
     CONTACT_EMAIL=<你的邮箱> \
     bash deploy/production/install.sh
```

跑完会打印站点地址、Webhook URL 与密码。**唯一还要手工做的一步**是把那个 URL 填进
Gitee 仓库 → 管理 → WebHooks（勾 Push）。

想改默认值：`cp deploy/production/install.env.example deploy/production/install.env`
改完直接 `sudo bash deploy/production/install.sh`（`install.env` 已被 gitignore）。

`install.sh` 幂等：装到一半失败，改完环境重跑即可；已经在跑的机器重跑不会打断服务。
它会自动完成：

1. 系统依赖（nginx / certbot / git / jq / openssl）
2. 运行时（Node 22 / pnpm / pm2 / Bun，全走国内镜像）
3. 内核参数（BBR、somaxconn、WebSocket 友好的 TCP 栈）与文件句柄上限
4. 拉代码，把凭据写进部署用户的 `~/.git-credentials`（600）
5. `/etc/niuma/niuma.env`（运行时配置）与 `/etc/niuma/webhook.env`（随机 token）
6. nginx 站点 + 静态资源直发 + HTTP/2 + gzip_static + 静态限速
7. Let's Encrypt 证书（ECDSA）+ 续期后自动 reload 的钩子
8. Webhook 服务（systemd）与 pm2 开机自启
9. 首次构建部署，再从公网复验一遍

## 文件

| 文件 | 作用 |
|---|---|
| `install.sh` | **一键安装**：裸机 → 可访问站点。幂等，可重复跑 |
| `deploy.sh` | **日常发版**：拉 master → 构建 → 原子切换 → 探活。也是 Webhook 执行的脚本 |
| `webhook.mjs` | Gitee push → 拉起 `deploy.sh`（Node 原生，无依赖） |
| `niuma-webhook.service` | 上面的 systemd 单元 |
| `niuma.env.example` | 运行时配置模板 → `/etc/niuma/niuma.env` |
| `webhook.env.example` | Webhook token 模板 → `/etc/niuma/webhook.env` |
| `install.env.example` | 安装参数（域名、仓库、开关） |
| `system/*.conf` | 内核参数与句柄上限 |
| `nginx/*.template` | nginx 的 http 参数与站点 |

## 这台机器的参数

| 项目 | 值 | 依据 |
|---|---|---|
| 规格 | 2 vCPU / 3.6G / 5Mbps | 腾讯云轻量 |
| `DEPLOY_ROLE` | `all` | 同时跑 Web 与游戏服 |
| `GAME_MAX_EGRESS_KBPS` | `400` | 625 KB/s × 0.9 − 160（Web 预留） |
| `GAME_MAX_ONLINE` | `90` | 高于带宽可承载人数，让水位先关闸 |
| `WEB_HEAP_MB` | `512` | 3.6G 下 768M + 600M 进程上限后仍有余量 |
| 静态资源 | nginx 直接从磁盘发 | 不过 Node，省下的事件循环全给游戏 Tick |

## 日常发版

```bash
# push 之后自动：Gitee → Webhook → deploy.sh
# 手动一条命令（等价路径，排查用）：
sudo -u ubuntu bash /srv/niuma/src/deploy/production/deploy.sh

# 强制重建（代码没变但想重来）：
FORCE=1 sudo -u ubuntu bash /srv/niuma/src/deploy/production/deploy.sh

# 跳过测试的紧急发包：
RUN_TESTS=0 FORCE=1 sudo -u ubuntu bash /srv/niuma/src/deploy/production/deploy.sh
```

部署脚本自己会做：`git reset --hard origin/master` → `pnpm install` → 类型检查/测试 →
`next build` + `bun build` → `web`/`game` 目录原子切换 → 本机 200 探活 → 公网复验。
任何一步失败都会把 `web.old` / `game.old` 换回来并返回非零退出码。

## 观测

```bash
pm2 ls                                    # 两个进程的内存与重启次数
curl -s https://bangying.top/health | jq  # 在线人数、出口水体、闸门状态
tail -f /var/log/niuma/deploy.log         # 部署日志
tail -f /var/log/niuma/webhook.log        # 触发记录（谁推的、哪次提交）
systemctl status niuma-webhook            # 触发器本身
```

## 调容量

```bash
sudo vi /etc/niuma/niuma.env     # 改 GAME_MAX_EGRESS_KBPS / GAME_MAX_ONLINE
FORCE=1 sudo -u ubuntu bash /srv/niuma/src/deploy/production/deploy.sh   # 变量随 --update-env 带进进程
```

带宽算不准时先看 `/health` 的 `admission.utilizationPermille`：长期贴在 850 以上就是水位
真的到顶了，往下调人数；长期在 300 以下说明还能加。压测必须在本机跑（跨公网测的是你家宽带）：

```bash
GAME_MAX_ONLINE=250 BENCH_BOTS=120 BENCH_MS=15000 pnpm bench
```

## 回滚

**优先回滚配置，不回滚代码**（`docs/deploy-multi-park.md` §9）：把 `GAME_PARKS` 清空重启
Web，选园页就退化成单园区。

真要退代码：双目录已经留了 `.old`，手工换回来即可

```bash
cd /srv/niuma/app && sudo -u ubuntu mv web web.broken && sudo -u ubuntu mv web.old web
pm2 restart niuma-web --update-env
```

## 单机上的取舍

- **Web 是单点**：断了两个园区都进不去。要消除它就得把 `DEPLOY_ROLE=web` 拆到第二台机器，
  见 `docs/deploy-multi-park.md`。
- **构建很吃 CPU**：2 vCPU 上 `next build` 会占满两个线程约 1 分钟，这期间游戏 Tick 的
  长帧会增加。挑人少的时间发版；`RUN_TESTS=0` 只能省下测试那一段。
- **只有一处 TLS 终结**：nginx 在本机，证书续期由 `certbot.timer` 自动完成，续期后
  `renewal-hooks/deploy/reload-nginx.sh` 负责 reload，不需要人工介入。
- **审核词库默认是空的**：`GAME_MODERATION_LEXICON` 不配就只用内置表，正式对外前必须补，
  见 `docs/moderation/lexicon.md`。

## 踩过的坑（Ubuntu 24.04 / 26.04）

- 发行版 `nginx.conf` 已经声明 `gzip` / `ssl_protocols` / `ssl_prefer_server_ciphers` /
  `server_tokens build`，重复声明会让 `nginx -t` 报 duplicate 并拒绝启动 —— 模板里只保留增量
- `limit_conn addr` 需要先在 http 上下文声明 `limit_conn_zone`，否则启动报
  `zero size shared memory zone "addr"`
- 游戏服自己会带 CORS 头，nginx 再加一条会让 `/health` 出现两个
  `Access-Control-Allow-Origin`，浏览器判为非法（选园页卡在“探活中”）—— 用 `proxy_hide_header`
- Let's Encrypt 已停止提供 OCSP，`ssl_stapling` 只会在每次 reload 时刷警告
- `npm i -g` 在官方二进制 Node 下把 bin 放进 node 自己的目录，不在 PATH 里 —— 需要软链
- 锁文件不能放 `/run`（部署用户无写权限），用 `/tmp`
- `pm2 startup` 重复执行返回非零码，不能让它中断幂等安装
