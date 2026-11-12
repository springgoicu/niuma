#!/usr/bin/env bash
# niuma 生产部署：从 gitee 拉取 master → 质量门禁 → 构建 → 原子切换 → 探活
#
# 这是「一条命令上线」的入口，也是 Gitee Webhook 背后实际执行的脚本。
# 真正的构建/切换/回滚逻辑在 deploy/jenkins-deploy.sh，本脚本只负责：
#   1. 加锁，避免两个部署同时跑
#   2. 把工作区同步到 origin/master
#   3. 加载 /etc/niuma/niuma.env 的运行时配置
#   4. 调 jenkins-deploy.sh
#   5. reload nginx（清 open_file_cache，让新静态文件名立刻生效）
#   6. 从公网侧复验一次
#
# 用法：
#   bash deploy/production/deploy.sh            # 有更新才部署
#   FORCE=1 bash deploy/production/deploy.sh    # 强制重建
#   RUN_TESTS=0 ...                             # 跳过测试的紧急发包
set -euo pipefail

SRC_DIR="${SRC_DIR:-/srv/niuma/src}"
ENV_FILE="${ENV_FILE:-/etc/niuma/niuma.env}"
BRANCH="${BRANCH:-master}"
LOG_FILE="${LOG_FILE:-/var/log/niuma/deploy.log}"
# 放在 /tmp：部署用户对 /run 没有写权限，放到那里会因为“锁文件建不出来”直接失败
LOCK_FILE="${LOCK_FILE:-/tmp/niuma-deploy.lock}"
PUBLIC_HOST="${PUBLIC_HOST:-bangying.top}"

mkdir -p "$(dirname "$LOG_FILE")"
# 同时进日志与终端：webhook 抓的是日志，人手执行时也要看得见
exec > >(tee -a "$LOG_FILE") 2>&1

ts() { date '+%F %T'; }
log() { printf '\n[%s] >>> %s\n' "$(ts)" "$*"; }

# 单实例：上一次还没跑完就拒绝（Gitee 连推两次时很常见）
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "已有部署在运行，本次退出"
  exit 0
fi

log "开始部署：$SRC_DIR @ $BRANCH"

if [ ! -d "$SRC_DIR/.git" ]; then
  echo "✖ $SRC_DIR 不是 git 工作区，请先跑 bootstrap.sh" >&2
  exit 1
fi

# 部署用户需要 node/pnpm/pm2 在 PATH 里；非交互 shell 默认没有
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/share/pnpm:$HOME/.bun/bin:$PATH"
export CI=1
export NEXT_TELEMETRY_DISABLED=1

cd "$SRC_DIR"

# 私有仓库走 SSH（部署公钥只读），GIT_TERMINAL_PROMPT=0 让凭据缺失立刻失败而不是卡住
export GIT_TERMINAL_PROMPT=0
git fetch --prune origin "$BRANCH"

LOCAL_REV="$(git rev-parse HEAD)"
REMOTE_REV="$(git rev-parse "origin/$BRANCH")"
if [ "$LOCAL_REV" = "$REMOTE_REV" ] && [ "${FORCE:-0}" != "1" ]; then
  log "已是最新（${LOCAL_REV:0:8}），无需部署。要强制重建请加 FORCE=1"
  exit 0
fi

log "代码：${LOCAL_REV:0:8} → ${REMOTE_REV:0:8}"
git reset --hard "origin/$BRANCH"
# 只清理被跟踪文件之外的产物，不动 node_modules（.gitignore 已覆盖）
git clean -fdq

# 运行时配置：部署角色、园区身份、带宽闸门、端口全部在这里
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  log "已加载 $ENV_FILE"
else
  echo "✖ 缺少 $ENV_FILE，请从 deploy/production/niuma.env.example 复制一份" >&2
  exit 1
fi

log "构建与切换（APP_BASE=${APP_BASE:-/srv/niuma/app}，园区 ${GAME_PARK_ID:-main}）"
# 9>&- 必须加：flock 的锁是靠「持有打开的文件描述符」维持的，而子进程会继承它。
# jenkins-deploy.sh 里会 pm2 start，pm2 会 fork 一个常驻 daemon —— 那个 daemon 拿到
# 这个 fd 之后锁就永远不会释放，下次部署会一直报「已有部署在运行」。
# 关掉子树的 fd 9，锁只留在本进程手里。
bash deploy/jenkins-deploy.sh 9>&-

# nginx 站点配置同样住在仓库里：模板变了就重新渲染。否则「改一行限速还得 ssh 手抄
# 到服务器」这种事迟早重演，而且新机器与老机器的配置会悄悄分叉。
# 渲染后必须 nginx -t：校验不过自动还原，绝不让一次配置笔误把站点带走。
sync_nginx_site() {
  local tpl="$SRC_DIR/deploy/production/nginx/niuma-site.conf.template"
  local live="/etc/nginx/sites-available/niuma"
  local http_tpl="$SRC_DIR/deploy/production/nginx/00-niuma-http.conf.template"
  local http_live="/etc/nginx/conf.d/00-niuma-http.conf"
  local app_base="${APP_BASE:-/srv/niuma/app}"
  local web_root hook_path www staged backup out

  # 只处理 install.sh 已经铺过站点配置的机器；裸机上这一步留给 install.sh
  [ -f "$tpl" ] && [ -f "$live" ] || return 0

  if [ -d "$app_base/web/apps/web/.next" ]; then
    web_root="$app_base/web/apps/web"
  else
    web_root="$app_base/web"
  fi
  hook_path="$(cat /etc/niuma/hook_path 2>/dev/null || true)"
  www="www.$PUBLIC_HOST"
  staged="$(mktemp)"
  backup="$(mktemp)"

  sed -e "s#@DOMAIN@#$PUBLIC_HOST#g" \
      -e "s#@WWW@#$www#g" \
      -e "s#@WEB_ROOT@#$web_root#g" \
      -e "s#@HOOK_PATH@#$hook_path#g" \
      "$tpl" > "$staged"

  # 与线上完全一致就不动，避免每次部署都白白多一次 reload
  if cmp -s "$staged" "$live"; then
    rm -f "$staged" "$backup"
    log "nginx 站点配置无变化"
  else
    sudo -n cp "$live" "$backup"
    if ! sudo -n cp "$staged" "$live" || ! out="$(sudo -n nginx -t 2>&1)"; then
      printf '%s\n' "${out:-}" | sed 's/^/    /'
      sudo -n cp "$backup" "$live"
      rm -f "$staged" "$backup"
      echo "✖ nginx 渲染后校验失败，已还原旧配置" >&2
      return 1
    fi
    rm -f "$staged" "$backup"
    log "nginx 站点配置已更新（WEB_ROOT=$web_root）"
  fi

  # 全局参数（00-niuma-http.conf）也要跟着走：上游指纹、限流 zone、缓冲这些
  # 改动同样只在 install.sh 里做过一次，不加这一段就会「仓库改了、线上没变」。
  [ -f "$http_tpl" ] && [ -f "$http_live" ] || return 0
  staged="$(mktemp)"
  backup="$(mktemp)"
  # 这份模板目前只有 @APP_BASE@ 与 @SERVER_HEADER_FILTER@，但保留与 install.sh
  # 完全一致的替换：两边渲染命令必须一致，否则 cmp 永远不等，每次部署都白 reload。
  local header_filter='# 未安装 libnginx-mod-http-headers-more-filter，Server 头保留为 nginx'
  if [ -f /usr/lib/nginx/modules/ngx_http_headers_more_filter_module.so ]; then
    header_filter='more_clear_headers Server;'
  fi
  sed -e "s#@APP_BASE@#$app_base#g" \
      -e "s#@SERVER_HEADER_FILTER@#$header_filter#g" \
      -e "s#@DOMAIN@#$PUBLIC_HOST#g" \
      -e "s#@WWW@#$www#g" \
      -e "s#@WEB_ROOT@#$web_root#g" \
      -e "s#@HOOK_PATH@#$hook_path#g" \
      "$http_tpl" > "$staged"
  if cmp -s "$staged" "$http_live"; then
    rm -f "$staged" "$backup"
    log "nginx 全局配置无变化"
    return 0
  fi
  sudo -n cp "$http_live" "$backup"
  if ! sudo -n cp "$staged" "$http_live" || ! out="$(sudo -n nginx -t 2>&1)"; then
    printf '%s\n' "${out:-}" | sed 's/^/    /'
    sudo -n cp "$backup" "$http_live"
    rm -f "$staged" "$backup"
    echo "✖ nginx 全局配置校验失败，已还原旧配置" >&2
    return 1
  fi
  rm -f "$staged" "$backup"
  log "nginx 全局配置已更新"
}

sync_nginx_site

# nginx 缓存的是文件的 inode/mtime：换版本后必须 reload，否则可能继续吐旧 chunk
log "reload nginx"
sudo -n systemctl reload nginx

# 公网复验：本机探活过了不代表 TLS/反代/安全组也是通的。
# install.sh 在证书还没签下来时会设 SKIP_PUBLIC_CHECK=1：那时 443 是自签证书，
# 从这里 curl 必然失败，不该把一次成功的安装判成失败。
if [ "${SKIP_PUBLIC_CHECK:-0}" = "1" ]; then
  log "跳过公网复验（SKIP_PUBLIC_CHECK=1）"
else
  log "公网复验 https://$PUBLIC_HOST"
  ok=1
  for path in /health / /sprites/manifest.json; do
    code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "https://$PUBLIC_HOST$path" || true)"
    printf '  %-26s %s\n' "$path" "${code:-000}"
    [ "$code" = "200" ] || ok=0
  done

  if [ "$ok" != "1" ]; then
    log "✖ 公网探活未全部通过，请检查 nginx / 证书 / 安全组"
    exit 1
  fi
fi

log "✔ 部署完成：${REMOTE_REV:0:8}"

# ---- 通知其余游戏服节点各自更新 ----
# 每台机器是一座独立世界，它跟不上不该让主站发版失败：这里只告警，不退出。
# 9>&- 必须加：本进程持有 flock 的 fd 9，ssh 子进程继承后锁不会释放，
# 下一次发版会一直报「已有部署在运行」——这个坑在 pm2 上踩过一次。
if [ -n "${GAME_NODES:-}" ]; then
  for node in $GAME_NODES; do
    log "通知游戏服节点 $node"
    if ssh -i "$HOME/.ssh/niuma_deploy" \
           -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 \
           "$node" "bash /srv/niuma/update-game.sh" 9>&-; then
      log "  ✔ $node 已更新"
    else
      log "  ⚠ $node 更新失败（主站不受影响，可手工重跑 update-game.sh）"
    fi
  done
fi

# 触发器自己也住在仓库里。webhook.mjs 有更新时同步到运行位置，但不在这里重启服务：
# 本进程是 webhook 的子进程，重启会把部署自己杀掉。重启留给 install.sh 重跑或人工一次。
if [ -f /opt/niuma/webhook.mjs ] && ! cmp -s "$SRC_DIR/deploy/production/webhook.mjs" /opt/niuma/webhook.mjs; then
  if cp "$SRC_DIR/deploy/production/webhook.mjs" /opt/niuma/webhook.mjs 2>/dev/null; then
    chmod 755 /opt/niuma/webhook.mjs 2>/dev/null || true
    log "⚠ webhook.mjs 已更新，需重启触发器后生效：sudo systemctl restart niuma-webhook"
  else
    log "⚠ webhook.mjs 有更新但无权写入 /opt/niuma（重跑 install.sh 会自动处理）"
  fi
fi

# 状态脚本同理：运维随时要看的那条命令，不能停在旧版本。
# cmp 在目标不存在时返回非 0，正好把「首次安装」也一并覆盖。
if ! cmp -s "$SRC_DIR/deploy/production/status.sh" /opt/niuma/status.sh 2>/dev/null; then
  if install -m 755 "$SRC_DIR/deploy/production/status.sh" /opt/niuma/status.sh 2>/dev/null; then
    log "状态脚本已更新：/opt/niuma/status.sh（niuma-status）"
  else
    log "⚠ status.sh 有更新但无权写入 /opt/niuma"
  fi
fi

pm2 ls 9>&- || true
