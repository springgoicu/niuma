#!/usr/bin/env bash
# 游戏服机器（DEPLOY_ROLE=game）一键安装
#
# 目标：让一台新机器只承载一座园区，对外只暴露 /ws 与 /health，
# 流量不经过主站——这条路的前提是它有自己的子域名（浏览器直连 wss）。
#
# 与 install.sh 的区别：不装 Web、不装 Webhook、不碰全局 nginx.conf 与 sysctl。
# 这台机器上可能已经跑着 Jenkins / 1Panel / 别的站点，任何全局改动都是在赌它们不受影响。
#
# 用法：
#   sudo DOMAIN=b.example.com MAIN_DOMAIN=example.com \
#        GIT_USER=xxx GIT_PASS=yyy bash deploy/production/setup-game-node.sh
#
# 重复执行是安全的：已装的跳过、代码快进、配置重渲染、证书只在过期时才续。
set -euo pipefail

DOMAIN="${DOMAIN:-b.bangying.top}"
MAIN_DOMAIN="${MAIN_DOMAIN:-bangying.top}"
PARK_ID="${PARK_ID:-b}"
PARK_NAME="${PARK_NAME:-B 服务器}"
GAME_PORT="${GAME_PORT:-3011}"
MAX_EGRESS_KBPS="${MAX_EGRESS_KBPS:-300}"
MAX_ONLINE="${MAX_ONLINE:-70}"

APP_BASE="${APP_BASE:-/srv/niuma/app}"
SRC_DIR="${SRC_DIR:-/srv/niuma/src}"
REPO="${REPO:-https://gitee.com/mySia/niuma.git}"
BRANCH="${BRANCH:-master}"
AS_USER="${AS_USER:-ubuntu}"
ACME_ROOT="${ACME_ROOT:-/var/www/letsencrypt}"
GIT_USER="${GIT_USER:-}"
GIT_PASS="${GIT_PASS:-}"

NODE_MAJOR=22
PNPM_VERSION=10.33.0
NPM_REGISTRY=https://registry.npmmirror.com
NODE_MIRROR=https://registry.npmmirror.com/-/binary/node

NGINX_CONF="/etc/nginx/conf.d/niuma-park-${PARK_ID}.conf"
GAME_DIR="$APP_BASE/game"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()   { printf '\033[32m   ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m   ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 sudo 运行"
id "$AS_USER" >/dev/null 2>&1 || die "用户 $AS_USER 不存在"

echo "园区      $PARK_ID / $PARK_NAME"
echo "域名      https://$DOMAIN （只放行 https://$MAIN_DOMAIN 的 WS 来源）"
echo "游戏端口  127.0.0.1:$GAME_PORT"
echo "代码      $REPO @ $BRANCH → $SRC_DIR"

# ==================== 1. 系统依赖 ====================
step "1. 系统依赖"
export DEBIAN_FRONTEND=noninteractive
command -v nginx >/dev/null || apt-get install -y -qq nginx
command -v certbot >/dev/null || apt-get install -y -qq certbot
command -v git >/dev/null || apt-get install -y -qq git
command -v curl >/dev/null || apt-get install -y -qq curl
command -v jq >/dev/null || apt-get install -y -qq jq
ok "nginx $(nginx -v 2>&1 | awk -F/ '{print $2}') | certbot $(certbot --version 2>&1 | awk '{print $2}')"

# 端口占用检查：Jenkins/1Panel 这类机器上 3000/3001 很可能已被 docker-proxy 占住，
# 撞端口会让 pm2 反复重启而日志里只有 EADDRINUSE，不如提前拦下来。
# 但「自己上一版正占着」是更新流程的正常状态（重复执行即更新），不能拦。
if ss -Hltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$GAME_PORT$"; then
  own=0
  if command -v pm2 >/dev/null 2>&1; then
    sudo -u "$AS_USER" -H env PATH="/usr/local/bin:$PATH" pm2 describe niuma-game >/dev/null 2>&1 && own=1
  fi
  if [ "$own" != "1" ]; then
    holder="$(ss -Hltnp 2>/dev/null | grep -E "[:.]$GAME_PORT " | head -1)"
    die "端口 $GAME_PORT 已被其它进程占用：$holder
     换一个端口重跑，例如 GAME_PORT=3011"
  fi
fi

# ==================== 2. 运行时 ====================
step "2. 运行时（Node / pnpm / pm2 / Bun）"
case "$(uname -m)" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) die "不支持的架构 $(uname -m)" ;;
esac

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v\([0-9]*\).*/\1/')" -lt 20 ]; then
  NODE_VER="$(curl -fsSL -m 30 "$NODE_MIRROR/index.json" \
    | jq -r --arg m "v$NODE_MAJOR." '[.[] | select(.version | startswith($m))][0].version')"
  [ -n "$NODE_VER" ] && [ "$NODE_VER" != "null" ] || die "取不到 Node $NODE_MAJOR 的版本号"
  echo "   安装 Node $NODE_VER"
  curl -fsSL -m 600 -o /tmp/niuma-node.tar.xz \
    "$NODE_MIRROR/$NODE_VER/node-$NODE_VER-linux-$NODE_ARCH.tar.xz" || die "下载 Node 失败"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf /tmp/niuma-node.tar.xz -C /usr/local/lib/nodejs
  for b in node npm npx; do
    ln -sf "/usr/local/lib/nodejs/node-$NODE_VER-linux-$NODE_ARCH/bin/$b" "/usr/local/bin/$b"
  done
  rm -f /tmp/niuma-node.tar.xz
fi

npm config set registry "$NPM_REGISTRY" >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null 2>&1 || ! command -v pm2 >/dev/null 2>&1 || ! command -v bun >/dev/null 2>&1; then
  npm i -g "pnpm@$PNPM_VERSION" pm2 bun >/tmp/niuma-npm.log 2>&1 || die "npm 全局安装失败，见 /tmp/niuma-npm.log"
fi
NODE_PREFIX="$(npm root -g | sed 's#/lib/node_modules##')"
for b in pnpm pnpx pm2 pm2-dev pm2-runtime bun bunx; do
  [ -e "$NODE_PREFIX/bin/$b" ] && ln -sf "$NODE_PREFIX/bin/$b" "/usr/local/bin/$b"
done
hash -r
ok "node $(node -v) | pnpm $(pnpm -v) | pm2 $(pm2 -v 2>/dev/null | tail -1) | bun $(bun --version)"

# ==================== 3. 代码 ====================
step "3. 拉取代码"
if [ -n "$GIT_USER" ] && [ -n "$GIT_PASS" ]; then
  ENC_PASS="$(printf '%s' "$GIT_PASS" | sed -e 's/@/%40/g' -e 's/#/%23/g' -e 's#/#%2F#g')"
  printf 'https://%s:%s@gitee.com\n' "$GIT_USER" "$ENC_PASS" > "/home/$AS_USER/.git-credentials"
  chown "$AS_USER:$AS_USER" "/home/$AS_USER/.git-credentials"
  chmod 600 "/home/$AS_USER/.git-credentials"
  sudo -u "$AS_USER" -H git config --global credential.helper store
fi

mkdir -p "$(dirname "$SRC_DIR")" "$APP_BASE"
chown -R "$AS_USER:$AS_USER" "$(dirname "$SRC_DIR")" "$APP_BASE"

if [ -d "$SRC_DIR/.git" ]; then
  sudo -u "$AS_USER" -H git -C "$SRC_DIR" fetch --prune origin "$BRANCH"
  sudo -u "$AS_USER" -H git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
else
  sudo -u "$AS_USER" -H git clone --branch "$BRANCH" "$REPO" "$SRC_DIR"
fi
ok "代码 $(sudo -u "$AS_USER" -H git -C "$SRC_DIR" rev-parse --short HEAD)"

# ==================== 4. 构建 ====================
step "4. 安装依赖并构建游戏服"
# 只装 game-server 及其 workspace 依赖：这台机器不跑 Web，装 Next 那一套纯属浪费内存
# 这台机器可能同时在跑 Jenkins，把并发压到 1 避免 OOM
sudo -u "$AS_USER" -H bash -lc "
  cd '$SRC_DIR'
  NODE_OPTIONS=--max-old-space-size=1024 \
  pnpm install --filter @niuma/game-server... --frozen-lockfile \
    --child-concurrency=1 --network-concurrency=2
" || die "依赖安装失败"

sudo -u "$AS_USER" -H bash -lc "
  cd '$SRC_DIR/apps/game-server'
  rm -rf dist
  bun build src/index.ts --target=bun --outfile=dist/index.mjs
" || die "游戏服打包失败"
[ -f "$SRC_DIR/apps/game-server/dist/index.mjs" ] || die "打包产物不存在"
ok "构建完成 $(du -h "$SRC_DIR/apps/game-server/dist/index.mjs" | cut -f1)"

# ==================== 5. 启动 ====================
step "5. 启动游戏服（127.0.0.1:$GAME_PORT）"
mkdir -p "$GAME_DIR/dist" "$GAME_DIR/logs"
cp -a "$SRC_DIR/apps/game-server/dist/index.mjs" "$GAME_DIR/dist/"
chown -R "$AS_USER:$AS_USER" "$GAME_DIR"

# 世界只在内存里，没法热升级：先停再起，玩家会被踢下线重连（这是设计内的行为）
sudo -u "$AS_USER" -H env PATH="/usr/local/bin:$PATH" pm2 delete niuma-game >/dev/null 2>&1 || true

BUN_BIN="$(command -v bun)"
sudo -u "$AS_USER" -H env \
  PATH="/usr/local/bin:$PATH" \
  HOME="/home/$AS_USER" \
  GAME_SERVER_PORT="$GAME_PORT" \
  GAME_SERVER_HOST=127.0.0.1 \
  GAME_PARK_ID="$PARK_ID" \
  GAME_PARK_NAME="$PARK_NAME" \
  GAME_MAX_EGRESS_KBPS="$MAX_EGRESS_KBPS" \
  GAME_MAX_ONLINE="$MAX_ONLINE" \
  pm2 start "$GAME_DIR/dist/index.mjs" \
    --name niuma-game \
    --interpreter "$BUN_BIN" \
    --cwd "$GAME_DIR" \
    --time --max-memory-restart 600M \
    --output "$GAME_DIR/logs/out.log" \
    --error "$GAME_DIR/logs/error.log" \
    --update-env >/dev/null || die "pm2 启动失败"

joined=0
for i in $(seq 1 20); do
  if code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$GAME_PORT/health" 2>/dev/null)" && [ "$code" = "200" ]; then
    joined=1; break
  fi
  sleep 1
done
if [ "$joined" != "1" ]; then
  echo "--- 最近日志 ---"
  tail -n 30 "$GAME_DIR/logs/error.log" 2>/dev/null || true
  tail -n 30 "$GAME_DIR/logs/out.log" 2>/dev/null || true
  die "游戏服探活失败"
fi

actual_id="$(curl -s -m 3 "http://127.0.0.1:$GAME_PORT/health" | jq -r '.parkId // "?"')"
[ "$actual_id" = "$PARK_ID" ] || warn "服务端自述 parkId=$actual_id，与配置 $PARK_ID 不一致"
ok "在线 $(curl -s -m 3 "http://127.0.0.1:$GAME_PORT/health" | jq -r '.online') / $(curl -s -m 3 "http://127.0.0.1:$GAME_PORT/health" | jq -r '.admission.capacity')，parkId=$actual_id"

# ==================== 6. nginx（先 80，签完证书再上 443）====================
step "6. nginx 站点"
mkdir -p "$ACME_ROOT"

write_http_only() {
  cat > "$NGINX_CONF" <<EOF
# $DOMAIN —— 园区 $PARK_ID / $PARK_NAME（DEPLOY_ROLE=game）
#
# 这台机器只对外提供 /ws 与 /health，其余路径一律 404：
# 它没有 Web，也不该被当成第二个站点用。
# 由 deploy/production/setup-game-node.sh 生成，手改会在下次执行时被覆盖。
upstream niuma_park_${PARK_ID} {
    server 127.0.0.1:${GAME_PORT} max_fails=3 fail_timeout=5s;
    keepalive 32;
}

# 只认主站来源：game-server 自己不校验 Origin，这层是唯一限制
map \$http_origin \$niuma_park_${PARK_ID}_origin_ok {
    default                            0;
    "https://${MAIN_DOMAIN}"           1;
    "https://www.${MAIN_DOMAIN}"       1;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
}

write_full() {
  cat > "$NGINX_CONF" <<EOF
# $DOMAIN —— 园区 $PARK_ID / $PARK_NAME（DEPLOY_ROLE=game）
upstream niuma_park_${PARK_ID} {
    server 127.0.0.1:${GAME_PORT} max_fails=3 fail_timeout=5s;
    keepalive 32;
}

# 单 IP 并发 WS 与握手频率。这台机器只服务一座园区，容量 ${MAX_ONLINE} 人，
# 一个玩家 1~2 条连接，6 条已覆盖多标签页；不设上限时一条 IP 开上千条
# 会把内存与广播队列吃空，而出口水位只看字节数，看不出连接数爆炸。
limit_conn_zone \$binary_remote_addr zone=niuma_park_${PARK_ID}_ws:10m;
limit_req_zone  \$binary_remote_addr zone=niuma_park_${PARK_ID}_req:10m rate=15r/s;

# 只认主站来源：game-server 自己不校验 Origin，这层是唯一限制
map \$http_origin \$niuma_park_${PARK_ID}_origin_ok {
    default                            0;
    "https://${MAIN_DOMAIN}"           1;
    "https://www.${MAIN_DOMAIN}"       1;
}

# 探活接口的 CORS 只回主站域名，不再用 *：在线人数不必对全网公开
map \$http_origin \$niuma_park_${PARK_ID}_cors {
    default                            "";
    "https://${MAIN_DOMAIN}"           "https://${MAIN_DOMAIN}";
    "https://www.${MAIN_DOMAIN}"       "https://www.${MAIN_DOMAIN}";
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
    }

    location = /health {
        limit_req zone=niuma_park_${PARK_ID}_req burst=20 nodelay;
        proxy_pass http://niuma_park_${PARK_ID}/health;
        # game-server 自己也发 ACAO: *，不掐掉就会出现两条
        # Access-Control-Allow-Origin，浏览器直接判为非法、探活全失败
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_set_header Host \$host;
        add_header Access-Control-Allow-Origin \$niuma_park_${PARK_ID}_cors always;
        add_header Cache-Control "no-store" always;
        access_log off;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    # 主站在另一台机器，这里不需要 COOP/COEP：本机没有页面，
    # 只有 WS 与健康检查，跨源隔离头加在这里毫无作用。
    add_header X-Content-Type-Options "nosniff" always;
    # slowloris：正常的 WS 握手与探活在毫秒级完成，60s 的默认值只会被用来占连接
    client_header_timeout 10s;
    client_body_timeout   10s;

    location = /health {
        limit_req zone=niuma_park_${PARK_ID}_req burst=20 nodelay;
        proxy_pass http://niuma_park_${PARK_ID}/health;
        # game-server 自己也发 ACAO: *，不掐掉就会出现两条
        # Access-Control-Allow-Origin，浏览器直接判为非法、探活全失败
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_set_header Host \$host;
        # 选园页从主站域名跨域探活；ACAO 只回主站，不再用 *
        add_header Access-Control-Allow-Origin \$niuma_park_${PARK_ID}_cors always;
        add_header Cache-Control "no-store" always;
        proxy_connect_timeout 2s;
        proxy_read_timeout 2s;
        access_log off;
    }

    location /ws {
        if (\$niuma_park_${PARK_ID}_origin_ok = 0) { return 403; }
        # 单 IP 最多 12 条并发 WS；握手超过 15r/s 直接拒（断线重连远低于此）。
        # 12 而不是 6：校园网/公司出口共用一个 IP 时，6 条会误伤同网的其他人。
        limit_conn niuma_park_${PARK_ID}_ws 12;
        limit_req zone=niuma_park_${PARK_ID}_req burst=10 nodelay;
        proxy_pass http://niuma_park_${PARK_ID};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_connect_timeout 5s;
        proxy_buffering off;
        proxy_socket_keepalive on;
        tcp_nodelay on;
        access_log off;
    }

    location / { return 404; }
}
EOF
}

CERT_FILE="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [ -f "$CERT_FILE" ]; then
  write_full
else
  write_http_only
fi
nginx -t || die "nginx 配置校验失败（$NGINX_CONF）"
systemctl reload nginx
ok "站点已加载：$NGINX_CONF"

# ==================== 7. 证书 ====================
step "7. HTTPS 证书"
if [ -f "$CERT_FILE" ]; then
  ok "证书已存在，跳过签发（到期前 30 天 certbot 会自动续）"
else
  certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring || die "证书签发失败：确认 $DOMAIN 的 A 记录已指向本机，且 80 端口放行"
  write_full
  nginx -t || die "写入 443 配置后校验失败"
  systemctl reload nginx
  ok "证书已签发"
fi

# ==================== 8. 公网验证 ====================
step "8. 公网验证"
health="$(curl -fsS -m 8 "https://$DOMAIN/health" 2>/dev/null || true)"
if [ -z "$health" ]; then
  warn "https://$DOMAIN/health 不可达：检查云安全组是否放行 80/443"
else
  ok "health: $(printf '%s' "$health" | jq -c '{parkId,parkName,online}')"
fi
code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Origin: https://$MAIN_DOMAIN" "https://$DOMAIN/ws" 2>/dev/null || true)"
ok "wss 握手（带主站 Origin）: $code  （期望 101）"
code_bad="$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Origin: https://evil.example" "https://$DOMAIN/ws" 2>/dev/null || true)"
ok "wss 握手（伪造 Origin）: $code_bad  （期望 403）"

cat <<EOF

=========================================================================
游戏服已就绪：$PARK_ID / $PARK_NAME  https://$DOMAIN

最后一步在主站机器上做（顺序不能反，先能应答再加进列表）：

  sudo sed -i 's#^GAME_PARKS=.*#GAME_PARKS=[{"id":"main","name":"A 服务器","ws":"/ws","health":"/health"},{"id":"${PARK_ID}","name":"${PARK_NAME}","ws":"wss://${DOMAIN}/ws","health":"https://${DOMAIN}/health"}]#' /etc/niuma/niuma.env
  pm2 restart niuma-web --update-env

然后打开 /enter 应该看到两张卡片，默认选中第一张（A）。
=========================================================================
EOF
