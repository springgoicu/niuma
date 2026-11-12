#!/usr/bin/env bash
# niuma 一键安装：裸 Ubuntu/Debian → https://<域名> 可访问，并带上自动发版
#
#   sudo bash deploy/production/install.sh
#
# 参数按「环境变量 > deploy/production/install.env > 内置默认」的优先级读取，
# 所以最短的用法是：
#
#   sudo DOMAIN=bangying.top GIT_USER=xxx GIT_PASS=xxx bash deploy/production/install.sh
#
# 脚本幂等：装到一半失败，改完环境重跑即可；已经在跑的机器重跑不会打断服务。
#
# 它负责：
#   1. 系统依赖（nginx / certbot / git / jq / openssl）
#   2. 运行时（Node 22 / pnpm / pm2 / Bun），全部走国内镜像
#   3. 内核参数（BBR、somaxconn、WebSocket 友好的 TCP 栈）与文件句柄上限
#   4. 拉代码（私有仓库用 ~/.git-credentials，600）
#   5. /etc/niuma 的运行时配置与 Webhook token
#   6. nginx 站点（静态资源直发、HTTP/2、gzip_static、静态限速）
#   7. Let's Encrypt 证书 + 自动续期钩子
#   8. Webhook 服务（systemd）与 pm2 开机自启
#   9. 首次部署，然后从公网复验
#
# 它不负责（也不该假装能负责）：域名解析、云厂商安全组、Gitee 仓库里的 WebHook 条目。
# 前两项决定证书能不能签下来，脚本会检查并给出明确提示。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ==================== 0. 参数 ====================
if [ -f "$HERE/install.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HERE/install.env"
  set +a
fi

DOMAIN="${DOMAIN:-bangying.top}"
WWW="${WWW:-www.$DOMAIN}"
CONTACT_EMAIL="${CONTACT_EMAIL:-}"
REPO="${REPO:-https://gitee.com/mySia/niuma.git}"
BRANCH="${BRANCH:-master}"
GIT_USER="${GIT_USER:-}"
GIT_PASS="${GIT_PASS:-}"
APP_BASE="${APP_BASE:-/srv/niuma/app}"
SRC_DIR="${SRC_DIR:-/srv/niuma/src}"
ACME_ROOT="${ACME_ROOT:-/var/www/acme}"
AS_USER="${AS_USER:-ubuntu}"
SKIP_CERT="${SKIP_CERT:-0}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PNPM_VERSION="${PNPM_VERSION:-10.33.0}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
NODE_MIRROR="${NODE_MIRROR:-https://registry.npmmirror.com/-/binary/node}"
HOOK_PORT="${HOOK_PORT:-9100}"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[33m   ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 sudo 运行"
[ "$AS_USER" != "root" ] || die "AS_USER 不能是 root：pm2 与 webhook 都以普通用户运行"
id "$AS_USER" >/dev/null 2>&1 || die "用户 $AS_USER 不存在，用 AS_USER=xxx 指定一个非 root 用户"

echo "站点      https://$DOMAIN （$WWW 跳主域）"
echo "代码      $REPO @ $BRANCH → $SRC_DIR"
echo "产物      $APP_BASE"
echo "运行用户  $AS_USER"

# ==================== 1. 系统依赖 ====================
step "1. 系统依赖"
command -v apt-get >/dev/null || die "只支持 Debian/Ubuntu（没有 apt-get）"

export DEBIAN_FRONTEND=noninteractive
if [ ! -f /var/lib/apt/lists/lock ] || [ -z "$(ls -A /var/lib/apt/lists 2>/dev/null | head -1)" ]; then
  apt-get update -qq
fi
# 已经装过的不会重复下载；certbot 换了名字也能兜住
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git jq openssl rsync gzip \
  nginx certbot python3-certbot-nginx \
  >/tmp/niuma-apt.log 2>&1 || die "apt 安装失败，见 /tmp/niuma-apt.log"
echo "   nginx $(nginx -v 2>&1 | awk -F/ '{print $2}') | certbot $(certbot --version 2>&1 | awk '{print $2}')"

# ==================== 2. 代码 ====================
step "2. 代码"
mkdir -p "$(dirname "$SRC_DIR")"

# 私有仓库：凭据写进部署用户的 ~/.git-credentials（600），不留在 URL 或命令行里
if [ -n "$GIT_USER" ] && [ -n "$GIT_PASS" ]; then
  HOME_DIR="$(getent passwd "$AS_USER" | cut -d: -f6)"
  ENC_PASS="$(printf '%s' "$GIT_PASS" | sed -e 's/@/%40/g' -e 's/#/%23/g' -e 's#/#%2F#g')"
  install -d -m 700 -o "$AS_USER" -g "$AS_USER" "$HOME_DIR"
  printf 'https://%s:%s@gitee.com\n' "$GIT_USER" "$ENC_PASS" > "$HOME_DIR/.git-credentials"
  chown "$AS_USER:$AS_USER" "$HOME_DIR/.git-credentials"
  chmod 600 "$HOME_DIR/.git-credentials"
  sudo -u "$AS_USER" git config --global credential.helper "store --file=$HOME_DIR/.git-credentials"
  echo "   已写入 $HOME_DIR/.git-credentials"
fi

export GIT_TERMINAL_PROMPT=0
if [ -d "$SRC_DIR/.git" ]; then
  if sudo -u "$AS_USER" git -C "$SRC_DIR" fetch --prune origin "$BRANCH"; then
    sudo -u "$AS_USER" git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
  else
    warn "git fetch 失败（凭据或网络），继续用当前 HEAD"
  fi
else
  sudo -u "$AS_USER" git clone --branch "$BRANCH" "$REPO" "$SRC_DIR" \
    || die "克隆失败：私有仓库需要 GIT_USER/GIT_PASS，或先配好部署公钥"
fi
sudo -u "$AS_USER" git -C "$SRC_DIR" log --oneline -1 | sed 's/^/   /'

# 后续所有模板都取「被部署的那份代码」，而不是脚本所在位置
TPL_DIR="$SRC_DIR/deploy/production"
[ -d "$TPL_DIR/nginx" ] || die "$TPL_DIR 缺少 nginx 模板，仓库不完整？"

# ==================== 3. 运行时 ====================
step "3. 运行时（Node / pnpm / pm2 / Bun）"
case "$(uname -m)" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) die "不支持的架构 $(uname -m)" ;;
esac

need_node=1
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  [ "$CUR_MAJOR" -ge 20 ] && need_node=0
fi

if [ "$need_node" = "1" ]; then
  NODE_VER="$(curl -fsSL -m 30 "$NODE_MIRROR/index.json" \
    | jq -r --arg m "v$NODE_MAJOR." '[.[] | select(.version | startswith($m))][0].version')"
  [ -n "$NODE_VER" ] && [ "$NODE_VER" != "null" ] || die "取不到 Node $NODE_MAJOR 的版本号"
  echo "   安装 Node $NODE_VER ($NODE_ARCH)"
  curl -fsSL -m 600 -o /tmp/niuma-node.tar.xz \
    "$NODE_MIRROR/$NODE_VER/node-$NODE_VER-linux-$NODE_ARCH.tar.xz" || die "下载 Node 失败"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf /tmp/niuma-node.tar.xz -C /usr/local/lib/nodejs
  for b in node npm npx; do
    ln -sf "/usr/local/lib/nodejs/node-$NODE_VER-linux-$NODE_ARCH/bin/$b" "/usr/local/bin/$b"
  done
  rm -f /tmp/niuma-node.tar.xz
fi
echo "   node $(node -v)"

npm config set registry "$NPM_REGISTRY" >/dev/null 2>&1 || true

# 三个都在就跳过：重跑 install.sh 时没必要再等一次全局安装
if command -v pnpm >/dev/null 2>&1 && command -v pm2 >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  echo "   pnpm / pm2 / bun 已就绪，跳过全局安装"
else
  npm i -g "pnpm@$PNPM_VERSION" pm2 bun >/tmp/niuma-npm.log 2>&1 || die "npm 全局安装失败，见 /tmp/niuma-npm.log"
fi

# npm 会把 bin 放进 node 自己的目录（不在 PATH 里），统一软链到 /usr/local/bin
NODE_PREFIX="$(npm root -g | sed 's#/lib/node_modules##')"
for b in pnpm pnpx pm2 pm2-dev pm2-runtime corepack bun bunx; do
  [ -e "$NODE_PREFIX/bin/$b" ] && ln -sf "$NODE_PREFIX/bin/$b" "/usr/local/bin/$b"
done
hash -r
echo "   pnpm $(pnpm -v) | pm2 $(pm2 -v 2>/dev/null | tail -1) | bun $(bun --version)"

# ==================== 4. 内核与句柄 ====================
step "4. 内核参数与文件句柄"
install -m 644 "$TPL_DIR/system/99-niuma-sysctl.conf" /etc/sysctl.d/99-niuma.conf
install -m 644 "$TPL_DIR/system/limits-niuma.conf" /etc/security/limits.d/99-niuma.conf

# /etc/sysctl.conf 在 sysctl --system 里永远是最后一个被读的文件，云厂商镜像常常在里面
# 预置 somaxconn=4096 之类的值，会把 /etc/sysctl.d/ 里的配置整体盖掉（开机也一样）。
# 凡是我们要管的键，在 /etc/sysctl.conf 里统一注释掉，配置只留一份真相。
SYSCTL_CONF="$(readlink -f /etc/sysctl.conf)"
if [ -f "$SYSCTL_CONF" ]; then
  cp -a "$SYSCTL_CONF" "${SYSCTL_CONF}.niuma-backup" 2>/dev/null || true
  for key in $(grep -oE '^[a-z][a-z0-9_.]*' "$TPL_DIR/system/99-niuma-sysctl.conf" | sort -u); do
    sed -i "s#^[[:space:]]*${key}[[:space:]]*=#\# ${key} 统一由 /etc/sysctl.d/99-niuma.conf 配置#" "$SYSCTL_CONF"
  done
fi

sysctl --system >/dev/null 2>&1 || warn "部分内核参数未能应用（容器环境常见），不影响运行"
# --system 走完后我们的文件可能不是最后生效的，再显式应用一次兜底
sysctl -q -p /etc/sysctl.d/99-niuma.conf 2>/dev/null || true
echo "   congestion=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo '?') qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null || echo '?') somaxconn=$(sysctl -n net.core.somaxconn 2>/dev/null || echo '?') swappiness=$(sysctl -n vm.swappiness 2>/dev/null || echo '?')"

# ==================== 5. 目录与运行时配置 ====================
step "5. 目录与配置"
mkdir -p "$APP_BASE" /etc/niuma /var/log/niuma "$ACME_ROOT" /opt/niuma
chown -R "$AS_USER:$AS_USER" "$APP_BASE" /var/log/niuma
# /opt/niuma 归部署用户：deploy.sh 才能在发版时同步 webhook.mjs，不必每次 sudo
chown "$AS_USER:$AS_USER" /opt/niuma
chown -R www-data:www-data "$ACME_ROOT"

if [ ! -f /etc/niuma/niuma.env ]; then
  install -m 640 -o "$AS_USER" -g "$AS_USER" "$TPL_DIR/niuma.env.example" /etc/niuma/niuma.env
  sed -i "s#^APP_BASE=.*#APP_BASE=$APP_BASE#" /etc/niuma/niuma.env
  sed -i "s#^PUBLIC_HOST=.*#PUBLIC_HOST=$DOMAIN#" /etc/niuma/niuma.env
  echo "   已生成 /etc/niuma/niuma.env"
else
  echo "   /etc/niuma/niuma.env 已存在，保留原配置"
fi

# 老机器的配置里可能缺后来新增的键：缺什么补什么，已有值一律不动
ensure_env() {
  grep -q "^$1=" /etc/niuma/niuma.env || printf '%s=%s\n' "$1" "$2" >> /etc/niuma/niuma.env
}
ensure_env APP_BASE "$APP_BASE"
ensure_env PUBLIC_HOST "$DOMAIN"

if [ ! -f /etc/niuma/webhook.env ]; then
  HOOK_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
  HOOK_PATH="hook-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  install -m 640 -o "$AS_USER" -g "$AS_USER" "$TPL_DIR/webhook.env.example" /etc/niuma/webhook.env
  sed -i "s#^HOOK_TOKEN=.*#HOOK_TOKEN=$HOOK_TOKEN#" /etc/niuma/webhook.env
  sed -i "s#^PORT=.*#PORT=$HOOK_PORT#" /etc/niuma/webhook.env
  sed -i "s#^DEPLOY_SCRIPT=.*#DEPLOY_SCRIPT=$TPL_DIR/deploy.sh#" /etc/niuma/webhook.env
  printf '%s' "$HOOK_PATH" > /etc/niuma/hook_path
  chown "$AS_USER:$AS_USER" /etc/niuma/hook_path
  echo "   已生成 /etc/niuma/webhook.env（token 与随机路径）"
else
  echo "   /etc/niuma/webhook.env 已存在，保留原 token"
fi
HOOK_PATH="$(cat /etc/niuma/hook_path)"

# ==================== 6. nginx ====================
step "6. nginx"
# 发行版 nginx.conf 已经声明了 gzip / ssl_protocols / server_tokens 等，
# 重复声明会让 nginx -t 直接报 duplicate 并拒绝启动，这里只做增量与覆盖
sed -i 's/^[[:space:]]*gzip on;.*/# gzip on; 交给 conf.d\/00-niuma-http.conf 统一配置/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*worker_connections[[:space:]].*;/    worker_connections 16384;/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*# multi_accept on;/    multi_accept on;/' /etc/nginx/nginx.conf
sed -i 's/^[[:space:]]*server_tokens[[:space:]].*;/	server_tokens off;/' /etc/nginx/nginx.conf

sed "s#@APP_BASE@#$APP_BASE#g" "$TPL_DIR/nginx/00-niuma-http.conf.template" \
  > /etc/nginx/conf.d/00-niuma-http.conf

# 静态资源实际落点：monorepo 的 standalone 会保留 apps/web 层级，首次安装时先按经验值写
WEB_ROOT="$APP_BASE/web"
if [ -f "$APP_BASE/web/apps/web/.next/BUILD_ID" ]; then
  WEB_ROOT="$APP_BASE/web/apps/web"
elif [ -f "$APP_BASE/web/.next/BUILD_ID" ]; then
  WEB_ROOT="$APP_BASE/web"
else
  WEB_ROOT="$APP_BASE/web/apps/web"
fi

# 证书还没有时先用两天期自签占位：让 nginx -t 通过、站点能起来；
# 标记文件保证 certbot 之后会把它整个换掉，不会误删真实证书
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "   尚无证书，生成自签占位"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=$DOMAIN" \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" 2>/dev/null
  cp "$CERT_DIR/fullchain.pem" "$CERT_DIR/chain.pem"
  touch "$CERT_DIR/.niuma-placeholder"
fi

render_site() {
  sed -e "s#@DOMAIN@#$DOMAIN#g" \
      -e "s#@WWW@#$WWW#g" \
      -e "s#@WEB_ROOT@#$1#g" \
      -e "s#@HOOK_PATH@#$HOOK_PATH#g" \
      "$TPL_DIR/nginx/niuma-site.conf.template" > /etc/nginx/sites-available/niuma
}
render_site "$WEB_ROOT"
ln -sf /etc/nginx/sites-available/niuma /etc/nginx/sites-enabled/niuma
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "nginx 配置校验失败"
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx
echo "   站点已加载，静态根目录 $WEB_ROOT"

# ==================== 7. 证书 ====================
step "7. HTTPS 证书"

# 证书签发前提：域名必须解析到本机。先自己查一遍，省得 certbot 报一堆看不懂的话
detect_public_ip() {
  curl -fsS -m 3 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null ||
  curl -fsS -m 5 https://api.ipify.org 2>/dev/null ||
  true
}
PUBLIC_IP="$(detect_public_ip || true)"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"

NEED_CERT=0
if [ "$SKIP_CERT" = "1" ]; then
  warn "SKIP_CERT=1：443 目前用的是自签占位证书"
elif [ -f "$CERT_DIR/fullchain.pem" ] && [ ! -f "$CERT_DIR/.niuma-placeholder" ]; then
  # 真实证书已经在位。这里必须显式记住「不需要签发」：
  # Let's Encrypt 同一组域名一周只允许 5 张重复证书，重跑安装绝不能无脑重签
  echo "   证书已存在（到期 $(openssl x509 -enddate -noout -in "$CERT_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2)），跳过签发"
  NEED_CERT=0
else
  if [ -n "$DOMAIN_IP" ] && [ -n "$PUBLIC_IP" ] && [ "$DOMAIN_IP" != "$PUBLIC_IP" ]; then
    warn "$DOMAIN 解析到 $DOMAIN_IP，本机公网是 $PUBLIC_IP —— 证书签不下来"
    warn "把 A 记录指到本机后重跑本脚本即可，站点现在用自签证书可用"
    SKIP_CERT=1
  elif [ -z "$DOMAIN_IP" ]; then
    warn "$DOMAIN 还没有解析记录，跳过证书签发"
    SKIP_CERT=1
  else
    NEED_CERT=1
  fi
fi

if [ "$NEED_CERT" = "1" ]; then
  [ -n "$CONTACT_EMAIL" ] || die "签发证书需要 CONTACT_EMAIL"
  rm -rf "/etc/letsencrypt/live/$DOMAIN" "/etc/letsencrypt/archive/$DOMAIN" "/etc/letsencrypt/renewal/$DOMAIN.conf"
  if certbot certonly --webroot -w "$ACME_ROOT" \
      -d "$DOMAIN" -d "$WWW" \
      --key-type ecdsa --agree-tos -m "$CONTACT_EMAIL" \
      --non-interactive --keep-until-expiring; then
    echo "   签发完成（ECDSA P-256）"
  else
    warn "证书签发失败：确认安全组放通 80、域名解析已生效"
    warn "站点仍可通过自签证书访问；修好后重跑本脚本，或执行 sudo certbot certonly ... 补签"
    SKIP_CERT=1
  fi
fi

if [ -f "$CERT_DIR/fullchain.pem" ] && [ ! -f "$CERT_DIR/.niuma-placeholder" ]; then
  # 续期后自动 reload：certbot.timer 每次续期都会跑这个钩子
  if [ ! -f /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh ]; then
    install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    echo "   已安装续期钩子（reload nginx）"
  fi
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
fi

# ==================== 8. 免密 sudo ====================
step "8. 部署用户的免密权限"
NGINX_BIN="$(command -v nginx)"
SYSTEMCTL_BIN="$(command -v systemctl)"
CERTBOT_BIN="$(command -v certbot)"
cat > /etc/sudoers.d/niuma <<EOF
$AS_USER ALL=(root) NOPASSWD: $SYSTEMCTL_BIN reload nginx, $SYSTEMCTL_BIN restart nginx, $SYSTEMCTL_BIN restart niuma-webhook, $SYSTEMCTL_BIN restart certbot.timer, $NGINX_BIN -t, $CERTBOT_BIN renew
EOF
chmod 440 /etc/sudoers.d/niuma
visudo -cf /etc/sudoers.d/niuma >/dev/null || die "/etc/sudoers.d/niuma 语法错误"
echo "   只放开部署需要的 6 条命令"

# ==================== 9. Webhook 服务 ====================
step "9. 自动发版 Webhook"
install -m 755 "$TPL_DIR/webhook.mjs" /opt/niuma/webhook.mjs
install -m 644 "$TPL_DIR/niuma-webhook.service" /etc/systemd/system/niuma-webhook.service
systemctl daemon-reload
systemctl enable niuma-webhook >/dev/null 2>&1 || true
systemctl restart niuma-webhook
sleep 1
systemctl is-active --quiet niuma-webhook || die "niuma-webhook 启动失败：journalctl -u niuma-webhook"
echo "   监听 127.0.0.1:$HOOK_PORT"

# ==================== 10. pm2 开机自启 ====================
step "10. pm2 开机自启"
if systemctl is-enabled --quiet "pm2-$AS_USER" 2>/dev/null; then
  echo "   pm2-$AS_USER.service 已存在"
else
  # pm2 startup 在已经装过时会以非零码退出，这里不该因此中断
  sudo -u "$AS_USER" env PATH="$PATH" pm2 startup systemd -u "$AS_USER" --hp "$(getent passwd "$AS_USER" | cut -d: -f6)" >/dev/null 2>&1 || true
  echo "   已安装 pm2-$AS_USER.service"
fi

# ==================== 11. 首次部署 ====================
step "11. 首次部署"
if [ "$SKIP_DEPLOY" = "1" ]; then
  warn "SKIP_DEPLOY=1：跳过构建。环境已就绪，之后执行 deploy.sh 即可"
else
  # deploy.sh 自己会 source /etc/niuma/niuma.env 并把它 export 给 pm2 --update-env，
  # 这里不需要（也不应该）替它传环境变量
  # 证书没签下来时公网复验必然失败（自签证书 curl 过不去），这里不让它把安装判死
  if [ "$SKIP_CERT" = "1" ]; then SKIP_PUBLIC_CHECK=1; else SKIP_PUBLIC_CHECK=0; fi
  # FORCE=1 是必须的：刚 clone 下来 HEAD 就等于 origin/master，deploy.sh 会按
  # 「无更新」直接跳过，产物永远构建不出来
  sudo -u "$AS_USER" \
    env PATH="$PATH" FORCE=1 SKIP_PUBLIC_CHECK="$SKIP_PUBLIC_CHECK" \
    bash "$TPL_DIR/deploy.sh" || die "首次部署失败，见 /var/log/niuma/deploy.log"
fi

# ==================== 12. 校正静态根目录 ====================
step "12. 校正静态根目录"
REAL_WEB_ROOT="$APP_BASE/web"
if [ -f "$APP_BASE/web/apps/web/.next/BUILD_ID" ]; then
  REAL_WEB_ROOT="$APP_BASE/web/apps/web"
elif [ -f "$APP_BASE/web/.next/BUILD_ID" ]; then
  REAL_WEB_ROOT="$APP_BASE/web"
fi
if [ "$REAL_WEB_ROOT" != "$WEB_ROOT" ]; then
  render_site "$REAL_WEB_ROOT"
  nginx -t && systemctl reload nginx
  echo "   已校正为 $REAL_WEB_ROOT"
else
  echo "   已正确：$REAL_WEB_ROOT"
fi

# ==================== 13. 收尾 ====================
step "13. 完成"
HOOK_TOKEN_SHOW="$(grep '^HOOK_TOKEN=' /etc/niuma/webhook.env | cut -d= -f2)"
cat <<EOF

  站点        https://$DOMAIN
  健康检查    https://$DOMAIN/health
  发版命令    sudo -u $AS_USER bash $TPL_DIR/deploy.sh
  部署日志    /var/log/niuma/deploy.log
  Webhook     https://$DOMAIN/$HOOK_PATH/deploy
  Webhook 密码 $HOOK_TOKEN_SHOW

  还差一步（只能人工做）：
    在 Gitee 仓库 → 管理 → WebHooks 里填上面的 URL 与密码，勾选 Push。
    填完之后 push 到 $BRANCH 就会自动发版。

EOF

if [ "$SKIP_CERT" = "1" ]; then
  cat <<EOF
  注意：证书还没签下来，当前 443 用的是自签证书。
    1. 域名 A 记录指向本机（当前解析：${DOMAIN_IP:-无}）
    2. 云厂商安全组放通 TCP 80 / 443
    3. 重跑：sudo bash $HERE/install.sh

EOF
fi
