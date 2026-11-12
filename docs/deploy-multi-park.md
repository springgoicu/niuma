# 多园区部署：Web 单源 + 1…N 座独立园区

园区不是分片，是**并列的独立世界**：一座园区 = 一个 game-server 进程，之间没有任何连接。
这条能成立是因为服务端零持久化（ADR-0004）——没有需要同步的状态，也就没有分片协议、
路由表或一致性窗口。加一座园区只是再加一个进程和一条配置，不是一次架构变更。

本文覆盖 **1 台、2 台、N 台**三种规模。只有一台机器时，绝大部分章节可以跳过。

决策背景与被拒方案见 [`adr/0043-multi-park-deployment.md`](adr/0043-multi-park-deployment.md)。

> **先看这里。** 本文是手写的操作手册，讲清每一步为什么这么配。如果你只是要把站点装到一台
> 新机器上，不用照着本文抄命令——[`../deploy/production/README.md`](../deploy/production/README.md)
> 里的 `install.sh` 已经把这些步骤（依赖、内核参数、nginx、证书、Webhook、首次发版）全部
> 脚本化，一条命令跑完。本文保留下来是为了解释取值理由与多机扩展。

## 0. 我要部署几座

| 规模 | 需要几台机器 | `GAME_PARKS` | `/enter` 的表现 | 园内「切换园区」 |
|---|---|---|---|---|
| **1 座** | 1 台（主站机器，同时跑 Web 与这座园区） | 不配，或只配 1 项 | 不出现，直接 307 到 `/play` | 不显示 |
| **2 座** | 2 台 | 2 项 | 两张卡片 | 显示 |
| **N 座** | 1 + (N−1) 台 | N 项 | N 张卡片，宽屏三列自动换行 | 显示 |

单座园区是**零配置的默认形态**：不配 `GAME_PARKS` 时 `loadParks()` 合成
`{ id:'main', name:'主园区', ws:'/ws', health:'/health' }`，玩家看到的入口、工牌、
存档行为与多园区改造之前完全一致。后续要扩容，不用改代码，只加机器与配置。

主站机器也可以只跑 Web 不承载园区（`DEPLOY_ROLE=web`），把 `GAME_PARKS` 全部指向
其它机器——但那样 Web 就纯粹是外壳，少一台机器可用。

## 1. 拓扑与角色

```
                        浏览器
                          │
       ┌──────────────────┼───────────────────┐
       │ HTTPS            │ wss               │ wss
       ▼                  ▼                   ▼
┌──────────────────┐  ┌────────────────┐  ┌────────────────┐
│ 主站机器          │  │ 游戏服机器 #1  │  │ 游戏服机器 #N  │
│ nginx            │  │ nginx          │  │ nginx          │
│  ├ Next.js :3000 │  │  └ game :3001  │  │  └ game :3001  │
│  └ /ws 反代 ─────┼─▶│ 园区 1         │  │ 园区 N         │
│ 园区 1（可选）    │  └────────────────┘  └────────────────┘
└──────────────────┘
```

| 角色 | 数量 | 跑什么 | `DEPLOY_ROLE` |
|---|---|---|---|
| **主站机器** | 恰好 1 台 | nginx + `niuma-web`，通常再搭一座园区 | `all`（含园区）/ `web`（不含） |
| **游戏服机器** | N − 1 台 | nginx + `niuma-game`，一台一座园区 | `game` |

**Web 必须只有一份。** `niuma:profile:v2`、`niuma:park:v1` 都存在 localStorage 里，
按域名隔离；两份 Web 用两个域名，玩家在 A 域捏的牛到 B 域就是陌生人。

**每台游戏服机器各用一个独立子域名让浏览器直连**（`wss://<park-domain>/ws`）。
不能把它们挂在主站的 nginx 下做路径反代：那样游戏流量会全部穿过主站的公网出口，
出口带宽没解除，等于没扩容、还双倍占用主站带宽。

### 机型怎么选

结论只有一句：**瓶颈是出口带宽，不是 CPU。**

| 场景 | Tick p95 | 预算 | 占用 |
|---|---|---|---|
| 60 人在线 | 2.03 ms | 25 ms | 8% |
| 200 人全同屏 | 6.49 ms | 25 ms | 26% |

一个游戏服用不到 0.3 核，所以：

- 两台时，**2 核那台正好承载两个单线程事件循环**（Node 一个、Bun 一个），一进程一核；
- 游戏服机器多出来的核**用不上**：在上面多开一座园区不会增加一个玩家（出口共享），
  跑第二份 Web 只会带来双份部署成本。留白即可。
- Web 与一座园区同机时，用 nginx `limit_rate` 把 Web 的最坏占用钉死（见 §4.1），
  把剩余带宽全留给游戏流量。

## 2. 环境变量

每台机器只认与自己角色相关的那几项。

### 主站机器

```bash
DEPLOY_ROLE=all                # 只跑 Web 不承载园区时用 web
APP_BASE=/var/jenkins_home/app/niuma

# 园区列表：唯一真相。改完重启 Web 生效，不需要重新构建。
# 数组可以有两项以上，顺序即选园页卡片的顺序。
GAME_PARKS=[{"id":"a","name":"一号园区","ws":"/ws","health":"/health"},{"id":"b","name":"二号园区","ws":"wss://<park-b-domain>/ws","health":"https://<park-b-domain>/health"}]

# 本机游戏服的身份，必须与 GAME_PARKS 里的 id 逐字一致（只跑 Web 时不需要）
GAME_PARK_ID=a
GAME_PARK_NAME=一号园区

GAME_SERVER_HOST=127.0.0.1     # 只允许本机 nginx 反代，不暴露游戏端口
GAME_SERVER_PORT=3001
GAME_MAX_EGRESS_KBPS=400       # 按 §5.1 的公式算
GAME_MAX_ONLINE=90             # 故意高于带宽可承载人数，见 §5.2
GAME_TICK_BUDGET_MS=25

WEB_PORT=3000
WEB_HOST=127.0.0.1
WEB_HEAP_MB=512                # 4G 机型；2G 机型必须压到 512 以内
NEXT_PUBLIC_GAME_WS_URL=       # 留空：浏览器走同源 /ws
```

### 每一台游戏服机器

```bash
DEPLOY_ROLE=game
APP_BASE=/var/jenkins_home/app/niuma

GAME_PARK_ID=b                 # 这台机器承载的园区 id，必须出现在 GAME_PARKS 里
GAME_PARK_NAME=二号园区

GAME_SERVER_HOST=127.0.0.1
GAME_SERVER_PORT=3001
GAME_MAX_EGRESS_KBPS=300       # 按 §5.1 的公式算
GAME_MAX_ONLINE=70
GAME_TICK_BUDGET_MS=25
```

游戏服机器**不需要** `GAME_PARKS`、`NEXT_PUBLIC_GAME_WS_URL`、`WEB_*`：
它不构建也不运行 Web。

`GAME_PARK_ID` 与 `GAME_PARKS[].id` 必须一致。对不上时选园页会显示「身份不符」
并给出服务端自述的名字——这是部署错位最直接的暴露方式，比排查日志快得多。

## 3. 新增一台游戏服机器

任何一步都不会影响已经在线的园区。

```bash
# ① 运行环境
curl -fsSL https://bun.sh/install | bash
sudo apt install -y nginx certbot python3-certbot-nginx
npm i -g pm2

# ② 部署（跳过 Next 构建与 Web 目录切换）
cd <jenkins 工作区>
DEPLOY_ROLE=game \
GAME_PARK_ID=c GAME_PARK_NAME=三号园区 \
GAME_SERVER_HOST=127.0.0.1 \
GAME_MAX_EGRESS_KBPS=<按公式算> GAME_MAX_ONLINE=70 \
bash deploy/jenkins-deploy.sh

# ③ DNS：<park-c-domain> → 这台机器的公网 IP

# ④ 证书
sudo certbot --nginx -d <park-c-domain>

# ⑤ nginx 站点（§4.2），reload
sudo nginx -t && sudo systemctl reload nginx
```

然后回到主站机器，往 `GAME_PARKS` 里追加一项并重启 Web：

```bash
pm2 restart niuma-web --update-env
```

回调顺序不能反：先让新园区能应答 `/health`，再加进列表。否则选园页会先出现一张
点不动的卡片。

探活一下：

```bash
curl -s https://<park-c-domain>/health | jq '{parkId,parkName,online}'
# 期望 {"parkId":"c","parkName":"三号园区","online":0}
```

## 4. nginx

### 4.1 主站机器

```nginx
# 静态资源预压缩（部署脚本已生成 .gz）
gzip_static on;

# Web 静态资源限速：把 Web 的最坏带宽钉死，剩余全部留给本机游戏服
location ~ ^/(sprites|_next/static)/ {
    limit_rate 200k;
    limit_conn addr 6;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# 本机园区（同源 WebSocket）；只跑 Web 时删掉这一段
location /ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;   # WS 空闲不能被 60s 默认超时掐断
    proxy_buffering off;        # 实时帧不要过缓冲
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`limit_rate 200k` 让首访约 4 秒打开，游戏侧最多被挤 4 秒。不设限速时 Web 会与
WebSocket 按 TCP 公平竞争，最坏可持续十几秒——而且游戏侧的出口水位计只统计
游戏进程自己发出的字节，**它看不到 nginx 转发 Web 的流量**，被挤时不会自动关闸。

### 4.2 每一台游戏服机器

`map` 必须放在 `http` 上下文（`conf.d/*.conf` 顶层），不能放进 `server`：

```nginx
map $http_origin $park_origin_ok {
    default                    0;
    "https://<主站域名>"        1;
    "https://www.<主站域名>"    1;
}

server {
    listen 443 ssl http2;
    server_name <park-domain>;

    ssl_certificate     /etc/letsencrypt/live/<park-domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<park-domain>/privkey.pem;

    # 探活接口：只有它放开 CORS，不要把 * 扩散到全站
    location = /health {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-store" always;
        proxy_pass http://127.0.0.1:3001;
    }

    # 游戏服 WebSocket：只放行主站来源
    location /ws {
        if ($park_origin_ok = 0) { return 403; }
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_socket_keepalive on;
    }

    # 其余路径一律不对外
    location / { return 404; }
}
```

**必须用 `wss://`。** 主站是 HTTPS，浏览器不允许从 HTTPS 页面连 `ws://`。
`game-server` 本身不校验 Origin，这一层白名单是唯一的来源限制。

## 5. 容量与阈值

### 5.1 出口预算公式

```
GAME_MAX_EGRESS_KBPS = 物理带宽(KB/s) × 0.9(扣 TCP/TLS 开销) − 同机其它流量
```

同机其它流量只算会长期占用的：与游戏服同机的 Web（按 `limit_rate` 估）、
以及 nginx/系统的小额底噪。单跑游戏服的机器通常留 20 KB/s 足够。

| 标称带宽 | KB/s | ×0.9 可用载荷 | 典型分配 |
|---|---|---|---|
| 3 Mbps | 375 | ≈ 340 | 游戏服 300 |
| 5 Mbps | 625 | ≈ 560 | Web 同机时：游戏 400 + Web 160 |
| 10 Mbps | 1250 | ≈ 1125 | 游戏服 1000，或拆成两座各 550 |

这是准入闸门的水位基线：实测出口超过它的 85% 就关闸，回落到 65% 才重开。

### 5.2 `GAME_MAX_ONLINE`

**故意设得比带宽能承载的多。** 人均下行取决于 AOI 视野里有多少人（稀疏时 1–3 KB/s，
同屏拥挤时 8 KB/s 以上），按「带宽 ÷ 人均」硬算等于猜。带宽水位会先触发 AIMD 收缩，
人数维度只是二次保险。设高一点，让园区在稀疏分布时也能吃满带宽。

一座园区的可承载人数 ≈ `GAME_MAX_EGRESS_KBPS ÷ 5…8`，全部园区求和就是整站容量。
按 §5.1 的两台示例（400 + 300）约为 90–115 人。

### 5.3 压测

在机器本机跑，别跨公网：

```bash
GAME_MAX_ONLINE=250 GAME_SPAWN_RADIUS=3000 BENCH_BOTS=120 BENCH_MS=15000 pnpm bench
curl -s http://127.0.0.1:3001/health | jq '{parkId, online, egressKbps, admission}'
```

看 `egressKbps` 与 `admission.utilizationPermille`，不要看 `tickMs.max`
（机器人客户端与服务器同机抢 CPU，长帧是假象）。

## 6. 部署顺序

1. **先把游戏服机器全部起好**：`DEPLOY_ROLE=game` → DNS → 证书 → nginx → 逐台
   `curl /health` 确认 `parkId` 正确。
2. **再动主站机器**：配好 `GAME_PARKS` 与游戏预算 → `DEPLOY_ROLE=all` 部署 → Web 限速与 `/ws` 反代。
3. 打开 `/enter` 逐卡确认在线人数与延迟。

先起服再改列表，选园页就永远不会出现「配置里有、实际连不上」的卡片。

## 7. 验收清单

### 单园区（1 台）

- [ ] 不配 `GAME_PARKS` → 访问 `/enter` 直接 307 到 `/play?park=main`。
- [ ] 园内右上角**没有**「切换园区」按钮。
- [ ] 工牌只显示区域名（如「工作区」），不带「主园区 · 」前缀，与多园区改造前一致。
- [ ] 首页回访直达 `/play`，不经过 `/enter`。
- [ ] 捏人 →「保存并上岗」→ 直接进园区。

### 多园区（2 座 / 3 座）

- [ ] `/enter` 上每座园区都有在线人数与延迟；2 座为两列，3 座在宽屏为三列且没有孤行。
- [ ] 选第二座 → 工牌显示 `<园区名> · <区域>`。
- [ ] 关掉浏览器重开域名 → 直接进上次那座，不再经过 `/enter`。
- [ ] 园内「切换园区」→ 回到 `/enter`，「上次」标记在正确的那一张上。
- [ ] 切换后角色从新园区中央广场出生，**没有**回到在原地坐的工位。
- [ ] 停掉其中一台的 `niuma-game` → 只有那一张卡片变「暂不可达」并禁止点击，其余仍可进；
      若当前偏好正是它，刷新时会自动落到另一座并提示。
- [ ] 把某一台的 `GAME_PARK_ID` 改成错的 → 那张卡片显示「身份不符」，仍可进入。

## 8. 回滚

**只回滚配置，不回滚代码。** 缩小规模就是把 `GAME_PARKS` 删到只剩想要的那几项：

```bash
# 主站机器
GAME_PARKS=[{"id":"a","name":"一号园区","ws":"/ws","health":"/health"}]
pm2 restart niuma-web --update-env
```

只留一项时 `/enter` 会自动 307，与单园区部署完全等价；连一项都不留时
`loadParks()` 合成 `main`，回到零配置形态。

被移出列表的机器可以留着跑（只是没人连得到），也可以 `pm2 delete niuma-game` 停掉。

## 9. 故障排查

| 现象 | 常见原因 | 处理 |
|---|---|---|
| 某张卡片「暂不可达」 | 进程没起 / 证书过期 / 安全组没放 443 / nginx 没 reload | `pm2 ls`、`curl -s https://<park-domain>/health`、`journalctl -u nginx` |
| 状态停在「探活中」不结束 | `/health` 的 CORS 头没加上，浏览器读到的是网络错误 | 确认只有 `/health` 那个 location 有 `Access-Control-Allow-Origin` |
| 「身份不符」 | `GAME_PARK_ID` 与 `GAME_PARKS[].id` 不一致 | 两边改成同一个 id，重启对应进程 |
| 延迟明显偏高 | 玩家到该机房的物理距离 / 走了 TLS 全握手 | 开 `ssl_session_cache`、`http2`；按地域再加一座园区 |
| 能进但一直「正在重连」 | `/ws` 反代缺 `Upgrade`/`Connection` 头，或 `Host` 没设 | 抄 §4 的 `location /ws` |
| 只排队进不去 | 出口水位真的超了 | 看 `/health` 的 `admission.dominant`：`bandwidth` 就调低 `GAME_MAX_ONLINE` 或加机器 |
| 一到新访客就卡 | Web 静态资源没限速，突发吃满物理带宽 | 加 §4.1 的 `limit_rate` |
| 加了一座却看不到 | 主站 `GAME_PARKS` 没改 / 没重启 Web | 改配置后 `pm2 restart niuma-web --update-env` |
| 第二次打开又回到 `/enter` | `niuma:park:v1` 被清（隐私模式 / 手动清） | 预期行为：读不到偏好就让人重选一次 |

## 10. 已知边界

- **Web 是单点**：Web 挂掉时所有园区都进不去。这是既有风险，本次不解决。
- **各园区互不可见**：没有跨园区好友、私聊、邀请，也没有跨园区的在线人数汇总。
- **不能在园内无缝迁移**：切换园区是整页导航，角色从新园区门口开始。
- **昵称不唯一**：零持久化下，同一个人可以在不同园区同名，也可能与别人同名。
- **园区列表是静态配置**：不自动发现、不自动摘除，新增或下线必须改 `GAME_PARKS` 并重启 Web。
