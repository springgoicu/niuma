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
LOCK_FILE="${LOCK_FILE:-/run/niuma-deploy.lock}"
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
bash deploy/jenkins-deploy.sh

# nginx 缓存的是文件的 inode/mtime：换版本后必须 reload，否则可能继续吐旧 chunk
log "reload nginx"
sudo -n systemctl reload nginx

# 公网复验：本机探活过了不代表 TLS/反代/安全组也是通的
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

log "✔ 部署完成：${REMOTE_REV:0:8}"
pm2 ls || true
