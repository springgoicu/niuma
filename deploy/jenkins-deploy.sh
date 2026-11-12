#!/bin/bash
# niuma 生产部署：Bun WebSocket 游戏服务器 + Next.js 15 standalone
#
# 目录约定：
#   $APP_BASE/game        线上游戏服务器（dist/index.mjs + logs），${GAME_DIR}.old 为上一版本
#   $APP_BASE/web         线上 Web（Next standalone），${WEB_DIR}.old 为上一版本
#
# 可覆盖的环境变量：
#   DEPLOY_ROLE              all | web | game，默认 all
#                            all = 完整站点（页面 + 游戏服）
#                            game = 只部署游戏服，跳过 Next 构建与 Web 目录切换
#                            web = 只部署 Web，跳过游戏服
#                            多园区部署时：主站机器 all，第二台机器 game
#   GAME_PARK_ID             园区 id，默认 main；/health 原样下发，选园页用它核对身份
#   GAME_PARK_NAME           园区名，默认 主园区；选园页卡片上的大字
#   APP_BASE                 默认 /var/jenkins_home/app/niuma
#   WEB_PORT                 默认 3000
#   GAME_SERVER_PORT         默认 3001
#   GAME_SERVER_HOST         默认 0.0.0.0；nginx 反代 /ws 时改 127.0.0.1
#   WEB_HOST                 默认 0.0.0.0；nginx 反代时改 127.0.0.1
#   NEXT_PUBLIC_GAME_WS_URL  编译期注入，例 ws://bangying.top/ws；留空则浏览器走同源 /ws
#                            （由 nginx 升级到游戏服），本地 next dev 仍自动直连 :3001
#   RUN_TESTS                默认 1；紧急发包可设 0 跳过测试
#   WEB_HEAP_MB              默认 512，Web 进程 --max-old-space-size
#                            2G 机型必须压在 512 以内：游戏服上限 600M + Web 上限 768M
#                            才留得下 nginx/pm2/OS 的余量；1024 会和排队机制抢内存先 OOM
set -euo pipefail

# ==================== 0. 环境与配置 ====================
export BUILD_ID=dontKillMe
export JENKINS_NODE_COOKIE=dontKillMe

# 加载 Node / PNPM 路径
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi
for p in "$HOME/.local/share/pnpm" "/var/jenkins_home/.local/share/pnpm" /usr/local/bin /usr/bin /var/jenkins_home/tools/*/*/bin; do
  if [ -d "$p" ]; then
    export PATH="$PATH:$p"
  fi
done

APP_BASE="${APP_BASE:-/var/jenkins_home/app/niuma}"
WEB_DIR="$APP_BASE/web"
GAME_DIR="$APP_BASE/game"
WEB_NEW="${WEB_DIR}_new"
GAME_NEW="${GAME_DIR}_new"

WEB_PORT="${WEB_PORT:-3000}"
GAME_PORT="${GAME_SERVER_PORT:-3001}"
GAME_HOST="${GAME_SERVER_HOST:-0.0.0.0}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
NEXT_WS_URL="${NEXT_PUBLIC_GAME_WS_URL:-}"
RUN_TESTS="${RUN_TESTS:-1}"
WEB_HEAP_MB="${WEB_HEAP_MB:-512}"

DEPLOY_ROLE="${DEPLOY_ROLE:-all}"
case "$DEPLOY_ROLE" in
  all)  DEPLOY_GAME=1; DEPLOY_WEB=1 ;;
  game) DEPLOY_GAME=1; DEPLOY_WEB=0 ;;
  web)  DEPLOY_GAME=0; DEPLOY_WEB=1 ;;
  *) echo "✖ DEPLOY_ROLE 只能是 all / web / game，当前是 $DEPLOY_ROLE"; exit 1 ;;
esac

# 园区身份：export 之后 pm2 --update-env 会把它带进进程，不必改两处 pm2 调用
export GAME_PARK_ID="${GAME_PARK_ID:-main}"
export GAME_PARK_NAME="${GAME_PARK_NAME:-主园区}"
echo ">>> 部署角色：$DEPLOY_ROLE（game=$DEPLOY_GAME web=$DEPLOY_WEB）园区：$GAME_PARK_ID / $GAME_PARK_NAME"

# 构建版本号：git sha + Jenkins 构建号。同一 commit 重新部署也要产生新版本，
# 否则客户端认为「已是最新」，不会强刷到新地图。
# 不能复用 BUILD_ID=dontKillMe，那是 Jenkins 防止杀进程的变量。
DEPLOY_VERSION="${GIT_COMMIT:-$(date +%s)}"
DEPLOY_VERSION="${DEPLOY_VERSION:0:12}"
if [ -n "${BUILD_NUMBER:-}" ]; then
  DEPLOY_VERSION="${DEPLOY_VERSION}-${BUILD_NUMBER}"
else
  DEPLOY_VERSION="${DEPLOY_VERSION}-$(date +%Y%m%d%H%M%S)"
fi
export NEXT_PUBLIC_BUILD_ID="$DEPLOY_VERSION"
echo ">>> 构建版本：$NEXT_PUBLIC_BUILD_ID"

WS="${WORKSPACE:-$(pwd)}"

log() { printf '\n>>> %s\n' "$*"; }

echo ">>> 系统内存与磁盘："
free -h || true
df -h "$APP_BASE" 2>/dev/null || df -h . || true

command -v pm2 >/dev/null 2>&1 || { echo "✖ 未找到 pm2，请先执行 npm i -g pm2"; exit 1; }

# 强杀占用端口的残留进程（用于本次启动前清场）
kill_port() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -i:"$port" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -9 "$port/tcp" 2>/dev/null || true
  fi
}

# 端口探活：只认 200，最多等 $2 秒
wait_http_200() {
  local url=$1 tries=${2:-30} i code=''
  for i in $(seq 1 "$tries"); do
    code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$url" 2>/dev/null || true)
    if [ "$code" = "200" ]; then
      echo "✔ $url 就绪（${i}s）"
      return 0
    fi
    sleep 1
  done
  echo "✖ $url 探活失败（${tries}s 超时，最后状态码 ${code:-none}）"
  return 1
}

# 版本探针：线上 /api/version 必须等于本次构建注入的版本号。
# 不一致说明 next build 命中了旧缓存或静默回滚，客户端永远不会强刷到新地图。
wait_version() {
  local url=$1 expected=$2 tries=${3:-30} i body=''
  if [ -z "$expected" ]; then
    echo ">>> 未注入 NEXT_PUBLIC_BUILD_ID，跳过版本校验"
    return 0
  fi
  for i in $(seq 1 "$tries"); do
    body=$(curl -fsS -m 2 "$url" 2>/dev/null || true)
    case "$body" in
      *"\"id\":\"$expected\""*)
        echo "✔ $url 版本一致（$expected）"
        return 0
        ;;
    esac
    sleep 1
  done
  echo "✖ $url 版本校验失败：期望 $expected，实际 ${body:-none}"
  return 1
}

# ==================== 1. 依赖与质量门禁 ====================
log "[1/4] 安装依赖 + 质量门禁"
cd "$WS"
# pnpm 由 install.sh / CI 用 npm i -g 装好；corepack 只是兜底。
# 它失败时会往日志里刷一大段 stack，对排查毫无价值，这里静音
corepack enable >/dev/null 2>&1 || true
pnpm config set store-dir "$HOME/.pnpm-store" >/dev/null 2>&1 || true
pnpm install --frozen-lockfile --prefer-offline

pnpm run typecheck

if [ "$RUN_TESTS" = "1" ]; then
  pnpm run test
else
  echo ">>> 已跳过测试（RUN_TESTS=0）"
fi

# ==================== 2. 构建（全部成功后才动线上）====================
log "[2/4] 构建前端 standalone + 游戏服务器单文件"
if [ "$DEPLOY_WEB" = "1" ]; then
  if [ -d "$WS/apps/web/.next" ]; then
    find "$WS/apps/web/.next" -mindepth 1 -maxdepth 1 ! -name 'cache' -exec rm -rf {} +
  fi

  # 根 build = 生成像素图集（写入 apps/web/public/sprites）+ turbo 构建全部包
  NEXT_PUBLIC_GAME_WS_URL="$NEXT_WS_URL" \
  NODE_OPTIONS="--max-old-space-size=2048" \
  pnpm run build

  if [ ! -f "$WS/apps/web/.next/BUILD_ID" ]; then
    echo "✖ 前端构建失败：缺少 .next/BUILD_ID"
    exit 1
  fi
else
  echo ">>> DEPLOY_ROLE=$DEPLOY_ROLE：跳过 Next 构建（这台机器不跑 Web）"
fi

BUN_BIN="$(command -v bun || true)"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$WS/node_modules/.bin/bun"
fi
if [ ! -x "$BUN_BIN" ]; then
  echo "✖ 未找到 bun（应随 pnpm install 安装在 node_modules/.bin/bun）"
  exit 1
fi
echo ">>> bun: $BUN_BIN ($("$BUN_BIN" --version 2>/dev/null || echo unknown))"

# 游戏服务器的 exports 指向 shared-types 的 .ts 源码，必须内联打成单文件
rm -rf "$WS/apps/game-server/dist"
(cd "$WS/apps/game-server" && "$BUN_BIN" build src/index.ts --target=bun --outfile=dist/index.mjs)
if [ ! -f "$WS/apps/game-server/dist/index.mjs" ]; then
  echo "✖ 游戏服务器打包失败"
  exit 1
fi
echo "✔ 构建完成"

mkdir -p "$APP_BASE"

# ==================== 3. 部署游戏服务器 ====================
if [ "$DEPLOY_GAME" = "1" ]; then
log "[3/4] 部署游戏服务器（端口 $GAME_PORT，园区 $GAME_PARK_ID，重启即清空内存世界）"
rm -rf "$GAME_NEW"
mkdir -p "$GAME_NEW/dist" "$GAME_NEW/logs"
cp -a "$WS/apps/game-server/dist/index.mjs" "$GAME_NEW/dist/"

# 世界只存在内存里，无法平滑热升级：先停旧进程再换目录
pm2 delete niuma-game >/dev/null 2>&1 || true
kill_port "$GAME_PORT"

rm -rf "${GAME_DIR}.old"
if [ -d "$GAME_DIR" ]; then
  mv "$GAME_DIR" "${GAME_DIR}.old"
fi
mv "$GAME_NEW" "$GAME_DIR"

GAME_SERVER_PORT="$GAME_PORT" GAME_SERVER_HOST="$GAME_HOST" \
pm2 start "$GAME_DIR/dist/index.mjs" \
  --name niuma-game \
  --interpreter "$BUN_BIN" \
  --cwd "$GAME_DIR" \
  --time --max-memory-restart 600M \
  --output "$GAME_DIR/logs/out.log" \
  --error "$GAME_DIR/logs/error.log" \
  --update-env

if ! wait_http_200 "http://127.0.0.1:$GAME_PORT/health" 20; then
  echo "✖ 游戏服务器探活失败，最近日志："
  tail -n 40 "$GAME_DIR/logs/error.log" 2>/dev/null || true
  tail -n 40 "$GAME_DIR/logs/out.log" 2>/dev/null || true
  pm2 delete niuma-game >/dev/null 2>&1 || true
  if [ -d "${GAME_DIR}.old" ]; then
    echo ">>> 回滚游戏服务器到上一版本"
    rm -rf "$GAME_DIR"
    mv "${GAME_DIR}.old" "$GAME_DIR"
    GAME_SERVER_PORT="$GAME_PORT" GAME_SERVER_HOST="$GAME_HOST" \
    pm2 start "$GAME_DIR/dist/index.mjs" --name niuma-game --interpreter "$BUN_BIN" \
      --cwd "$GAME_DIR" --time --update-env || true
  fi
  exit 1
fi
else
  echo ">>> DEPLOY_ROLE=$DEPLOY_ROLE：跳过游戏服务器部署"
fi

# ==================== 4. 部署 Web (Next standalone) ====================
if [ "$DEPLOY_WEB" = "1" ]; then
log "[4/4] 部署 Web（端口 $WEB_PORT）"
STANDALONE="$WS/apps/web/.next/standalone"
if [ -f "$STANDALONE/server.js" ]; then
  WEB_APP_REL="."
elif [ -f "$STANDALONE/apps/web/server.js" ]; then
  # monorepo 下 standalone 保留仓库层级，node_modules 与 packages 在顶层
  WEB_APP_REL="apps/web"
else
  echo "✖ 未找到 .next/standalone/server.js，请确认 next.config.ts 已设置 output: 'standalone'"
  exit 1
fi
echo ">>> standalone 入口: $WEB_APP_REL/server.js"

rm -rf "$WEB_NEW"
mkdir -p "$WEB_NEW"
cp -a "$STANDALONE/." "$WEB_NEW/"

# Next 不会把 static 与 public 放进 standalone，需手工补齐
rm -rf "$WEB_NEW/$WEB_APP_REL/.next/static" "$WEB_NEW/$WEB_APP_REL/public"
cp -a "$WS/apps/web/.next/static" "$WEB_NEW/$WEB_APP_REL/.next/static"
cp -a "$WS/apps/web/public" "$WEB_NEW/$WEB_APP_REL/public"

# 预压缩静态资源：nginx 用 gzip_static 直接吐 .gz，省掉每次请求的运行时压缩开销
# 只压文本类；woff2/png 本身已压缩，再压只会变大
if command -v gzip >/dev/null 2>&1; then
  find "$WEB_NEW/$WEB_APP_REL/.next/static" "$WEB_NEW/$WEB_APP_REL/public" -type f \
    \( -name '*.js' -o -name '*.css' -o -name '*.json' \
       -o -name '*.svg' -o -name '*.txt' -o -name '*.webmanifest' \) \
    -exec gzip -9 -k -f {} + 2>/dev/null || true
  echo "✔ 静态资源已预压缩（gzip -9，原文件保留）"
fi

rm -rf "${WEB_DIR}.old"
if [ -d "$WEB_DIR" ]; then
  mv "$WEB_DIR" "${WEB_DIR}.old"
fi
mv "$WEB_NEW" "$WEB_DIR"

WEB_ENTRY="$WEB_DIR/$WEB_APP_REL/server.js"
if pm2 describe niuma-web >/dev/null 2>&1; then
  PORT="$WEB_PORT" HOSTNAME="$WEB_HOST" NODE_ENV=production \
  NODE_OPTIONS="--max-old-space-size=$WEB_HEAP_MB" \
  pm2 restart niuma-web --update-env
else
  PORT="$WEB_PORT" HOSTNAME="$WEB_HOST" NODE_ENV=production \
  NODE_OPTIONS="--max-old-space-size=$WEB_HEAP_MB" \
  pm2 start "$WEB_ENTRY" --name niuma-web --cwd "$WEB_DIR/$WEB_APP_REL" --time \
    --max-memory-restart "$((WEB_HEAP_MB + 256))M" --update-env
fi

# 三重探活：图集（验证 public 拷对了）+ 首页（验证服务真的在跑）+ 版本号（验证这次构建真的生效）
if ! wait_http_200 "http://127.0.0.1:$WEB_PORT/sprites/manifest.json" 30 ||
   ! wait_http_200 "http://127.0.0.1:$WEB_PORT/" 30 ||
   ! wait_version "http://127.0.0.1:$WEB_PORT/api/version" "$NEXT_PUBLIC_BUILD_ID" 30; then
  echo "✖ 前端探活失败，PM2 最近日志："
  pm2 logs niuma-web --nostream --lines 40 2>/dev/null || true
  echo ">>> 回滚 Web 到上一版本"
  pm2 delete niuma-web >/dev/null 2>&1 || true
  if [ -d "${WEB_DIR}.old" ]; then
    rm -rf "$WEB_DIR"
    mv "${WEB_DIR}.old" "$WEB_DIR"
    PORT="$WEB_PORT" HOSTNAME="$WEB_HOST" NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=$WEB_HEAP_MB" \
    pm2 start "$WEB_DIR/$WEB_APP_REL/server.js" --name niuma-web \
      --cwd "$WEB_DIR/$WEB_APP_REL" --time --update-env || true
  fi
  exit 1
fi
else
  echo ">>> DEPLOY_ROLE=$DEPLOY_ROLE：跳过 Web 部署"
fi

pm2 save

echo "================================================="
echo "✔ 部署完成（$DEPLOY_ROLE）：web :$WEB_PORT   game :$GAME_PORT   园区 $GAME_PARK_ID / $GAME_PARK_NAME"
pm2 ls
