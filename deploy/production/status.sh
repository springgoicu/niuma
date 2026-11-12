#!/usr/bin/env bash
# niuma 运行状态速查
#
# 设计前提：这条命令玩家随时可能在线跑着，它自己不能成为负担。
#   · 全部只读：不写日志、不碰 pm2 进程、不 reload、不落缓存文件
#   · /proc 与 ss 采样合计约 0.5s，不做 du/find 这类扫盘
#   · 任一数据源失败只显示 n/a，不让整条命令挂掉
#
# 用法：
#   bash deploy/production/status.sh       # 人看一次
#   WATCH=1 bash .../status.sh             # 每 2 秒重绘（Ctrl-C 退出）
set -uo pipefail

GAME_HEALTH="${GAME_HEALTH:-http://127.0.0.1:3001/health}"
WEB_PROBE="${WEB_PROBE:-http://127.0.0.1:3000/api/version}"
SRC_DIR="${SRC_DIR:-/srv/niuma/src}"
DISK_PATH="${DISK_PATH:-/srv/niuma}"
DEPLOY_LOG="${DEPLOY_LOG:-/var/log/niuma/deploy.log}"

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_0=$'\033[0m'
[ -t 1 ] || { C_OK=""; C_WARN=""; C_BAD=""; C_DIM=""; C_0=""; }

WARNINGS=()
row() { printf ' %s：%s\n' "$1" "$2"; }

human_duration() {
  local s="${1:-0}"
  [[ "$s" =~ ^[0-9]+$ ]] || { echo "n/a"; return; }
  local d=$((s / 86400)) h=$(((s % 86400) / 3600)) m=$(((s % 3600) / 60))
  if [ "$d" -gt 0 ]; then echo "${d}d ${h}h ${m}m"
  elif [ "$h" -gt 0 ]; then echo "${h}h ${m}m"
  else echo "${m}m"; fi
}

human_rate() {
  local k="${1:-0}"
  if [[ "$k" =~ ^[0-9]+$ ]] && [ "$k" -ge 1024 ]; then
    awk -v k="$k" 'BEGIN{printf "%.1fMB/s", k/1024}'
  else
    printf '%sKB/s' "$k"
  fi
}

# ---------- 园区与游戏服 ----------
# /health 已经把在线数、准入判定、帧耗时都算好了，直接用，不在本地重复推导。
collect_park() {
  local raw tsv name online cap qlen qcap gate brk mode tick avg p95 max up
  raw="$(curl -fsS -m 3 "$GAME_HEALTH" 2>/dev/null || true)"
  if [ -z "$raw" ]; then
    row "园区" "${C_BAD}游戏服 /health 无响应${C_0}"
    WARNINGS+=("游戏服 /health 不可达，现有玩家可能已经掉线")
    return
  fi

  tsv="$(printf '%s' "$raw" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)

def num(v, fmt="%s"):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return "?"
    return fmt % v

adm = d.get("admission") if isinstance(d.get("admission"), dict) else {}
tm = d.get("tickMs") if isinstance(d.get("tickMs"), dict) else {}
print("\t".join([
    "%s (%s)" % (d.get("parkName", "?"), d.get("parkId", "?")),
    num(d.get("online")),
    num(adm.get("capacity")),
    num(adm.get("queueLength")),
    num(adm.get("queueCapacity")),
    "OPEN" if adm.get("gateOpen") else "CLOSED",
    "TRIPPED" if adm.get("breakerTripped") else "ok",
    str(adm.get("mode", "?")),
    num(d.get("tick")),
    num(tm.get("avg"), "%.2f"),
    num(tm.get("p95"), "%.2f"),
    num(tm.get("max"), "%.2f"),
    num(d.get("uptimeSec")),
]))
' 2>/dev/null || true)"

  if [ -z "$tsv" ]; then
    row "园区" "${C_BAD}/health 返回无法解析${C_0}"
    WARNINGS+=("/health 响应不是合法 JSON")
    return
  fi
  IFS=$'\t' read -r name online cap qlen qcap gate brk mode tick avg p95 max up <<<"$tsv"

  local pct="?"
  if [[ "$online" =~ ^[0-9]+$ ]] && [[ "$cap" =~ ^[0-9]+$ ]] && [ "$cap" -gt 0 ]; then
    pct="$(awk -v a="$online" -v b="$cap" 'BEGIN{printf "%.0f", a*100/b}')"
  fi

  local gate_txt="${C_OK}OPEN${C_0}" brk_txt="正常"
  [ "$gate" = "CLOSED" ] && gate_txt="${C_BAD}CLOSED${C_0}"
  [ "$brk" = "TRIPPED" ] && brk_txt="${C_BAD}已熔断${C_0}"

  row "园区" "$name"
  row "在线" "${online} / ${cap}  (${pct}%)    排队 ${qlen} / ${qcap}"
  row "准入" "闸门 ${gate_txt}    熔断 ${brk_txt}    模式 ${mode}"
  row "TICK" "${tick} 次    avg ${avg}ms   p95 ${p95}ms   max ${max}ms"
  row "运行" "$(human_duration "$up")"

  [ "$gate" = "CLOSED" ] && WARNINGS+=("准入闸门已关闭，新玩家在排队")
  [ "$brk" = "TRIPPED" ] && WARNINGS+=("准入熔断已触发，服务器在主动限流")
  if [[ "$p95" =~ ^[0-9.]+$ ]] && awk -v v="$p95" 'BEGIN{exit !(v > 8)}'; then
    WARNINGS+=("帧耗时 p95 ${p95}ms 超过 8ms，主循环被拖慢")
  fi
  if [[ "$pct" =~ ^[0-9]+$ ]] && [ "$pct" -ge 85 ]; then
    WARNINGS+=("在线人数已达容量 ${pct}%")
  fi
}

# ---------- pm2 进程 ----------
collect_pm2() {
  command -v pm2 >/dev/null 2>&1 || { row "进程" "pm2 未安装"; return; }
  local out
  out="$(pm2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    procs = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for p in procs:
    env = p.get("pm2_env", {})
    mon = p.get("monit", {})
    print("%s\t%s\t%s\t%s\t%s\t%s" % (
        p.get("name", "?"),
        env.get("status", "?"),
        env.get("pm_uptime") or 0,
        env.get("restart_time", 0),
        mon.get("cpu", 0),
        mon.get("memory", 0),
    ))
' 2>/dev/null || true)"

  if [ -z "$out" ]; then row "进程" "${C_BAD}pm2 无数据${C_0}"; return; fi

  local first=1 now
  # pm_uptime 是「启动时刻的毫秒时间戳」，不是时长；本机 date 不支持 %3N 截断，
  # 统一退到秒级比较，避免算出几百万天这种笑话。
  now="$(date +%s)"
  while IFS=$'\t' read -r name status up restarts cpu mem; do
    local up_txt="n/a" mem_mb="?"
    if [[ "$up" =~ ^[0-9]+$ ]] && [ "$up" -gt 1000000000 ]; then
      up_txt="$(human_duration $(( now - up / 1000 )))"
    fi
    [[ "$mem" =~ ^[0-9]+$ ]] && mem_mb="$(awk -v b="$mem" 'BEGIN{printf "%.0f", b/1048576}')MB"
    local status_txt="${C_OK}${status}${C_0}"
    [ "$status" != "online" ] && status_txt="${C_BAD}${status}${C_0}"
    local line
    line="$(printf '%-12s %-16s 运行 %-8s 重启 %-4s cpu %-5s mem %s' \
      "$name" "$status_txt" "$up_txt" "$restarts" "${cpu}%" "$mem_mb")"
    if [ "$first" = "1" ]; then row "进程" "$line"; first=0; else printf '        %s\n' "$line"; fi
    [ "$status" != "online" ] && WARNINGS+=("进程 $name 状态为 $status")
  done <<<"$out"
}

# ---------- 主机 ----------
collect_host() {
  local cores load1 load5 load15
  cores="$(nproc 2>/dev/null || echo 1)"
  read -r load1 load5 load15 _ < /proc/loadavg 2>/dev/null || load1="?"

  local iface cpu1 cpu2 net1 net2
  iface="$(ip route show default 2>/dev/null | awk '/default/{print $5; exit}')"
  iface="${iface:-eth0}"
  cpu1="$(awk '/^cpu /{print $2+$3+$4, $5+$6+$7+$8}' /proc/stat)"
  net1="$(awk -v i="$iface" 'index($0, i":"){print $2, $10}' /proc/net/dev)"
  sleep 0.5
  cpu2="$(awk '/^cpu /{print $2+$3+$4, $5+$6+$7+$8}' /proc/stat)"
  net2="$(awk -v i="$iface" 'index($0, i":"){print $2, $10}' /proc/net/dev)"

  local cpu_pct
  cpu_pct="$(awk -v a="$cpu1" -v b="$cpu2" 'BEGIN{
    split(a, x, " "); split(b, y, " ");
    du = (y[1]-x[1]); di = (y[2]-x[2]); t = du + di;
    printf "%.1f", (t > 0 ? du*100/t : 0)
  }')"

  local down up
  down="$(awk -v a="$net1" -v b="$net2" 'BEGIN{split(a,x," ");split(b,y," ");d=(y[1]-x[1])/0.5/1024;if(d<0)d=0;printf "%.0f",d}')"
  up="$(awk -v a="$net1" -v b="$net2" 'BEGIN{split(a,x," ");split(b,y," ");d=(y[2]-x[2])/0.5/1024;if(d<0)d=0;printf "%.0f",d}')"

  local mem_total mem_avail mem_pct mem_used_g mem_total_g
  read -r mem_total mem_avail < <(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)
  mem_pct="$(awk -v t="$mem_total" -v a="$mem_avail" 'BEGIN{printf "%.1f", (t>0 ? (t-a)*100/t : 0)}')"
  mem_used_g="$(awk -v t="$mem_total" -v a="$mem_avail" 'BEGIN{printf "%.1f", (t-a)/1048576}')"
  mem_total_g="$(awk -v t="$mem_total" 'BEGIN{printf "%.1f", t/1048576}')"

  local disk_kb disk_pct disk_size_kb
  read -r disk_kb disk_pct disk_size_kb < <(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2{gsub("%","",$5); print $3, $5, $2}')

  row "CPU" "${cpu_pct}%  (${cores} 核)    load ${load1} / ${load5} / ${load15}"
  row "内存" "${mem_pct}%  (${mem_used_g}G / ${mem_total_g}G)"
  row "磁盘" "${disk_pct:-?}%  ($(awk -v k="${disk_kb:-0}" 'BEGIN{printf "%.1f", k/1048576}')G / $(awk -v k="${disk_size_kb:-0}" 'BEGIN{printf "%.1f", k/1048576}')G)"
  row "网卡" "${iface}  ↓ $(human_rate "$down")   ↑ $(human_rate "$up")"

  awk -v v="$cpu_pct" 'BEGIN{exit !(v > 80)}' && WARNINGS+=("CPU ${cpu_pct}% 偏高")
  awk -v v="$mem_pct" 'BEGIN{exit !(v > 85)}' && WARNINGS+=("内存 ${mem_pct}% 偏高")
  if [[ "${disk_pct:-}" =~ ^[0-9]+$ ]] && [ "$disk_pct" -ge 85 ]; then
    WARNINGS+=("磁盘占用 ${disk_pct}% 接近上限")
  fi
  awk -v l="$load1" -v c="$cores" 'BEGIN{exit !(l > c)}' && WARNINGS+=("load ${load1} 超过核数 ${cores}")
}

# ---------- 站点与连接 ----------
collect_conn() {
  local https to_game ver
  https="$(ss -Htn state established '( sport = :443 )' 2>/dev/null | wc -l | tr -d ' ')"
  to_game="$(ss -Htn state established '( sport = :3001 )' 2>/dev/null | wc -l | tr -d ' ')"
  ver="$(curl -fsS -m 2 "$WEB_PROBE" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
  if [ -z "$ver" ]; then
    row "站点" "${C_BAD}web :3000 无响应${C_0}"
    WARNINGS+=("Next 进程 :3000 不响应，页面会 502")
  else
    row "站点" "web 正常    版本 ${ver}"
  fi
  row "连接" "HTTPS 活跃 ${https}    到游戏服 ${to_game}"
}

collect_deploy() {
  local rev ts
  rev="$(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null || echo "?")"
  ts="$(grep -a "部署完成：" "$DEPLOY_LOG" 2>/dev/null | tail -1 | sed -E 's/.*\[([^]]+)\].*/\1/' || true)"
  row "部署" "${rev}    最近 ${ts:-未知}"
}

render() {
  printf '\n%s\n' "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
  printf ' niuma 状态  %s\n' "$(date '+%F %T')"
  printf '%s\n' "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
  collect_park
  echo
  collect_pm2
  echo
  collect_host
  echo
  collect_conn
  collect_deploy
  echo
  if [ "${#WARNINGS[@]}" -gt 0 ]; then
    local w
    for w in "${WARNINGS[@]}"; do printf ' %s %s\n' "${C_WARN}⚠${C_0}" "$w"; done
  else
    printf ' %s 各项指标正常\n' "${C_OK}✔${C_0}"
  fi
  printf '%s\n' "${C_DIM}────────────────────────────────────────────────────────────${C_0}"
}

if [ "${WATCH:-0}" = "1" ]; then
  while :; do clear; WARNINGS=(); render; sleep "${WATCH_INTERVAL:-2}"; done
else
  render
fi
