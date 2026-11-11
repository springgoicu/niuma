# 生产部署（单机 + Gitee 自动化）

`docs/deploy-multi-park.md` 讲的是**两台机器**的角色划分；本文讲**一辆机器跑完整个站点**时
怎么把它装起来、怎么发版、出事怎么退回去。两者不冲突：单机就是那张拓扑图里机器 1 的
`DEPLOY_ROLE=all`，只是暂时没有机器 2。

## 文件

| 文件 | 作用 |
|---|---|
| `bootstrap.sh` | 一次性初始化：装站点、签证书、装 webhook、首次部署。幂等，可重复跑 |
| `deploy.sh` | **日常发版入口**：拉 master → 构建 → 原子切换 → 探活。也是 Webhook 实际执行的脚本 |
| `webhook.mjs` | Gitee push → 拉起 `deploy.sh`（Node 原生，无依赖） |
| `niuma-webhook.service` | 上面的 systemd 单元 |
| `niuma.env.example` | 运行时配置模板，部署到 `/etc/niuma/niuma.env` |
| `webhook.env.example` | Webhook token 模板，部署到 `/etc/niuma/webhook.env` |
| `nginx/*.template` | nginx 的 http 参数与站点，`bootstrap.sh` 替换占位符后写入 |

## 这台机器的参数

| 项目 | 值 | 依据 |
|---|---|---|
| 规格 | 2 vCPU / 3.6G / 5Mbps | 腾讯云轻量 |
| `DEPLOY_ROLE` | `all` | 同时跑 Web 与游戏服 |
| `GAME_MAX_EGRESS_KBPS` | `400` | 625 KB/s × 0.9 − 160（Web 预留） |
| `GAME_MAX_ONLINE` | `90` | 高于带宽可承载人数，让水位先关闸 |
| `WEB_HEAP_MB` | `512` | 3.6G 下 768M + 600M 进程上限后仍有余量 |
| 静态资源 | nginx 直接从磁盘发 | 不过 Node，省下的事件循环全给游戏 Tick |

## 首次安装

```bash
# 0) 先把服务器公钥加到 Gitee 仓库：设置 → 部署公钥（只读即可）
sudo cat /home/ubuntu/.ssh/id_ed25519_niuma.pub

# 1) 域名 A 记录指向本机，安全组放通 80/443，然后：
sudo DOMAIN=bangying.top bash /srv/niuma/src/deploy/production/bootstrap.sh

# 2) 输出里会打印 Webhook URL 与密码，填进 Gitee：管理 → WebHooks
#    勾选 Push，URL 形如 https://bangying.top/hook-xxxx/deploy
```

## 日常发版

```bash
# push 之后自动：Gitee → Webhook → deploy.sh
# 手动一条命令（等价路径，排查用）：
bash /srv/niuma/src/deploy/production/deploy.sh

# 强制重建（代码没变但想重来）：
FORCE=1 bash /srv/niuma/src/deploy/production/deploy.sh

# 跳过测试的紧急发包：
RUN_TESTS=0 FORCE=1 bash /srv/niuma/src/deploy/production/deploy.sh
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
FORCE=1 bash /srv/niuma/src/deploy/production/deploy.sh   # 变量随 --update-env 带进进程
```

带宽算不准时先看 `/health` 的 `admission.utilizationPermille`：长期贴在 850 以上就是水位
真的到顶了，往下调人数；长期在 300 以下说明还能加。压测必须在本机跑（跨公网测的是你家宽带）：

```bash
GAME_MAX_ONLINE=250 BENCH_BOTS=120 BENCH_MS=15000 pnpm bench
```

## 回滚

**优先回滚配置，不回滚代码**（`docs/deploy-multi-park.md` §9）：把 `GAME_PARKS` 清空重启
Web，选园页就退化成单园区。

真要退代码：Jenkins 风格的双目录已经留了 `.old`，手工换回来即可

```bash
cd /srv/niuma/app && sudo -u ubuntu mv web web.broken && sudo -u ubuntu mv web.old web
pm2 restart niuma-web --update-env
```

## 单机上的取舍

- **Web 是单点**：断了两个园区都进不去。要消除它就得把 `DEPLOY_ROLE=web` 拆到第二台机器，
  见 `docs/deploy-multi-park.md`。
- **构建很吃 CPU**：2 vCPU 上 `next build` 会占满两个线程约 2–4 分钟，这期间游戏 Tick 的
  长帧会增加。挑人少的时间发版；`RUN_TESTS=0` 只能省下测试那一段。
- **只有一处 TLS 终结**：nginx 在本机，证书续期由 `certbot.timer` 自动完成，续期后
  `renewal-hooks/deploy/reload-nginx.sh` 负责 reload，不需要人工介入。
