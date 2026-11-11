#!/usr/bin/env bash
# 服务器一次性初始化（幂等，可重复执行）
#
#   sudo DOMAIN=bangying.top bash deploy/production/bootstrap.sh
#
# 它做的事：克隆仓库、写运行时配置、装 nginx 站点、签证书、装 webhook 服务、
# 让 pm2 开机自启、最后跑第一次部署。之后日常发版只需要 deploy.sh。
set -euo pipefail

DOMAIN="${DOMAIN:-bangying.top}"
WWW="${WWW:-www.$DOMAIN}"
REPO="${REPO:-git@gitee.com:mySia/niuma.git}"
BRANCH="${BRANCH:-master}"
CONTACT_EMAIL="${CONTACT_EMAIL:-springgo_icu@163.com}"
SRC_DIR="${SRC_DIR:-/srv/niuma/src}"
APP_BASE="${APP_BASE:-/srv/niuma/app}"
ACME_ROOT="/var/www/acme"
SKIP_CERT="${SKIP_CERT:-0}"
SKIP_DEPLOY="${SKIP_DEPLOY:-0}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AS_USER="ubuntu"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die()  { echo "✖ $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 sudo 运行"

step "0. 依赖检查"
for bin in git node pnpm pm2 bun nginx curl jq; do
  command -v "$bin" >/dev/null || die "缺少 $bin"
done
echo "   node $(node -v) | pnpm $(pnpm -v) | bun $(bun --version) | nginx $(nginx -v 2>&1 | awk -F/ '{print $2}')"

step "1. 目录"
mkdir -p "$APP_BASE" /etc/niuma /var/log/niuma "$ACME_ROOT" /opt/niuma
chown -R "$AS_USER:$AS_USER" "$APP_BASE" /var/log/niuma
chown -R www-data:www-data "$ACME_ROOT"

step "2. 代码"
if [ -d "$SRC_DIR/.git" ]; then
  sudo -u "$AS_USER" git -C "$SRC_DIR" fetch --prune origin "$BRANCH"
  sudo -u "$AS_USER" git -C "$SRC_DIR" reset --hard "origin/$BRANCH"
else
  sudo -u "$AS_USER" git clone --branch "$BRANCH" "$REPO" "$SRC_DIR"
fi
echo "   $(sudo -u "$AS_USER" git -C "$SRC_DIR" log --oneline -1)"

step "3. 运行时配置 /etc/niuma/"
if [ ! -f /etc/niuma/niuma.env ]; then
  cp "$SRC_DIR/deploy/production/niuma.env.example" /etc/niuma/niuma.env
  sed -i "s#^APP_BASE=.*#APP_BASE=$APP_BASE#" /etc/niuma/niuma.env
  echo "   已生成 niuma.env"
else
  echo "   niuma.env 已存在，跳过"
fi

if [ ! -f /etc/niuma/webhook.env ]; then
  TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
  HOOK_PATH="hook-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cp "$SRC_DIR/deploy/production/webhook.env.example" /etc/niuma/webhook.env
  sed -i "s#^HOOK_TOKEN=.*#HOOK_TOKEN=$TOKEN#" /etc/niuma/webhook.env
  echo "$HOOK_PATH" > /etc/niuma/hook_path
  echo "   已生成 webhook.env（token 见文件）"
else
  echo "   webhook.env 已存在，跳过"
fi
HOOK_PATH="$(cat /etc/niuma/hook_path)"
chmod 600 /etc/niuma/*.env
chown "$AS_USER:$AS_USER" /etc/niuma/hook_path

step "4. nginx"
# 上游与 gzip/缓存参数（http 上下文）
sed "s#@APP_BASE@#$APP_BASE#g" "$HERE/nginx/00-niuma-http.conf.template" \
  > /etc/nginx/conf.d/00-niuma-http.conf

# 静态资源实际落点：monorepo standalone 会保留 apps/web 层级
WEB_ROOT="$APP_BASE/web"
if [ -f "$APP_BASE/web/apps/web/.next/BUILD_ID" ]; then
  WEB_ROOT="$APP_BASE/web/apps/web"
elif [ -f "$APP_BASE/web/.next/BUILD_ID" ]; then
  WEB_ROOT="$APP_BASE/web"
else
  WEB_ROOT="$APP_BASE/web/apps/web"   # 首次部署前先按经验值写，部署完再校正
fi

sed -e "s#@DOMAIN@#$DOMAIN#g" \
    -e "s#@WWW@#$WWW#g" \
    -e "s#@WEB_ROOT@#$WEB_ROOT#g" \
    -e "s#@HOOK_PATH@#$HOOK_PATH#g" \
    "$HERE/nginx/niuma-site.conf.template" > /etc/nginx/sites-available/niuma
ln -sf /etc/nginx/sites-available/niuma /etc/nginx/sites-enabled/niuma
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
systemctl reload nginx
echo "   静态根目录 $WEB_ROOT"

step "5. HTTPS 证书（Let's Encrypt / webroot）"
if [ "$SKIP_CERT" = "1" ]; then
  echo "   跳过（SKIP_CERT=1）"
elif [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  echo "   证书已存在"
else
  # 证书签发要求域名已经解析到本机；没解析时这里会失败，改好 DNS 再重跑本脚本即可
  certbot certonly --webroot -w "$ACME_ROOT" \
    -d "$DOMAIN" -d "$WWW" \
    --key-type ecdsa --agree-tos -m "$CONTACT_EMAIL" \
    --non-interactive --keep-until-expiring \
    || die "证书签发失败：确认 $DOMAIN 已解析到本机公网 IP、安全组放通 80"
  echo "   签发完成（ECDSA P-256）"
fi

if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  # 续期后自动 reload：放在 hooks 目录里，certbot.timer 每次续期都会跑
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  nginx -t && systemctl reload nginx
  echo "   续期钩子已安装（certbot.timer）"
fi

step "6. 免密 sudo（只放开部署需要的三条）"
NGINX_BIN="$(command -v nginx)"
SYSTEMCTL_BIN="$(command -v systemctl)"
CERTBOT_BIN="$(command -v certbot)"
cat > /etc/sudoers.d/niuma <<EOF
$AS_USER ALL=(root) NOPASSWD: $SYSTEMCTL_BIN reload nginx, $SYSTEMCTL_BIN restart nginx, $SYSTEMCTL_BIN restart niuma-webhook, $NGINX_BIN -t, $CERTBOT_BIN renew
EOF
chmod 440 /etc/sudoers.d/niuma
visudo -cf /etc/sudoers.d/niuma >/dev/null
echo "   已写入 /etc/sudoers.d/niuma"

step "7. Webhook 服务"
install -m 644 "$HERE/niuma-webhook.service" /etc/systemd/system/niuma-webhook.service
install -m 755 "$HERE/webhook.mjs" /opt/niuma/webhook.mjs
systemctl daemon-reload
systemctl enable --now niuma-webhook
sleep 1
systemctl is-active --quiet niuma-webhook && echo "   niuma-webhook 运行中"

step "8. pm2 开机自启"
sudo -u "$AS_USER" env PATH="$PATH" pm2 startup systemd -u "$AS_USER" --hp "/home/$AS_USER" >/dev/null
echo "   已安装 pm2-$AS_USER.service"

step "9. 首次部署"
if [ "$SKIP_DEPLOY" = "1" ]; then
  echo "   跳过（SKIP_DEPLOY=1）"
else
  # 用部署用户跑，环境与 webhook 触发时完全一致
  set -a; . /etc/niuma/niuma.env; set +a
  sudo -u "$AS_USER" --preserve-env=PATH,DEPLOY_ROLE,APP_BASE,GAME_PARK_ID,GAME_PARK_NAME \
    bash "$SRC_DIR/deploy/production/deploy.sh" || die "首次部署失败，见 /var/log/niuma/deploy.log"
fi

step "10. 校正静态根目录"
if [ -f "$APP_BASE/web/apps/web/.next/BUILD_ID" ]; then
  WEB_ROOT="$APP_BASE/web/apps/web"
elif [ -f "$APP_BASE/web/.next/BUILD_ID" ]; then
  WEB_ROOT="$APP_BASE/web"
fi
if ! grep -q "alias $WEB_ROOT/.next/static/" /etc/nginx/sites-available/niuma; then
  sed -i "s#alias .*/\.next/static/;#alias $WEB_ROOT/.next/static/;#" /etc/nginx/sites-available/niuma
  sed -i "s#alias .*/public/sprites/;#alias $WEB_ROOT/public/sprites/;#" /etc/nginx/sites-available/niuma
  sed -i "s#alias .*/public/sprites/manifest.json;#alias $WEB_ROOT/public/sprites/manifest.json;#" /etc/nginx/sites-available/niuma
  sed -i "s#alias .*/public/favicon.ico;#alias $WEB_ROOT/public/favicon.ico;#" /etc/nginx/sites-available/niuma
  sed -i "s#alias .*/public/brand/;#alias $WEB_ROOT/public/brand/;#" /etc/nginx/sites-available/niuma
  nginx -t && systemctl reload nginx
  echo "   已校正为 $WEB_ROOT"
fi

step "完成"
cat <<EOF
  站点        https://$DOMAIN
  Webhook     https://$DOMAIN/$HOOK_PATH/deploy
  Webhook 密码 $(grep '^HOOK_TOKEN=' /etc/niuma/webhook.env | cut -d= -f2)
  日志        /var/log/niuma/deploy.log  /var/log/niuma/webhook.log
  下一步      在 Gitee 仓库 → 管理 → WebHooks 里填上面的 URL 与密码
EOF
