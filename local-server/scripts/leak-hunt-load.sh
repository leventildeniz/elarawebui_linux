#!/usr/bin/env bash
# leak-hunt-load.sh — Trafikli + MLX inference altında RAM kaçağı avı.
# Idle test (leak-hunt.sh) suçlu bulamadıysa bunu çalıştır. Servisler AYAKTA
# kalır; sadece yük üretir ve RSS örnekler. 30 dakika sürer.
#
# Aşamalar:
#   0 — baseline                 ( 2 dk)   yük yok
#   1 — middleware probe loop    ( 8 dk)   sadece HTTP GET
#   2 — MLX inference loop       ( 8 dk)   sadece qwen72b çağrıları
#   3 — ikisi birden             (10 dk)   tam yük
#   4 — cooldown                 ( 2 dk)   yük durdu, RSS düşüyor mu?
#
# Çıktı: /tmp/leak-hunt-load-YYYYMMDD-HHMM.{csv,summary.txt}

set -u
umask 022

UID_NUM="$(id -u)"
TS="$(date +%Y%m%d-%H%M)"
CSV="/tmp/leak-hunt-load-${TS}.csv"
SUMMARY="/tmp/leak-hunt-load-${TS}.summary.txt"
LOAD_LOG="/tmp/leak-hunt-load-${TS}.load.log"

MLX_URL="${MLX_URL:-http://127.0.0.1:8001/v1/chat/completions}"
MW_URL="${MW_URL:-http://127.0.0.1:3005}"

ALL_LABELS=(
  com.elara.postgres
  com.elara.qwen72b
  com.elara.middleware
  com.elara.vite
  com.elara.tls-proxy
)

MW_PATHS=(
  "/health/deep"
  "/api/agents"
  "/api/workflows"
  "/api/skills"
)
# Not: /api/runs auth gerektirir (requireSession), anonim probe 401 alır — yanlış sinyal.
# /api/tools list endpoint'i yok (sadece /api/tools/:id/invoke) — 404 verir, yanlış sinyal.

MLX_PROMPTS=(
  "Tek cümlede: foton nedir?"
  "Liste: 5 prime sayı."
  "Kısa açıkla: TCP vs UDP."
  "Tek satır: REST nedir?"
  "Bir cümle: PostgreSQL ne işe yarar?"
  "Kısa cevap: tensor ne demek?"
)

PROBE_PID=""
MLX_PID=""

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# ---------- yük üreticiler ----------
probe_loop() {
  local i=0
  while :; do
    local path="${MW_PATHS[$((i % ${#MW_PATHS[@]}))]}"
    curl -s -o /dev/null -w "[probe] %{http_code} %{time_total}s ${path}\n" \
      --max-time 10 "${MW_URL}${path}" >> "$LOAD_LOG" 2>&1 || true
    i=$((i+1))
    sleep 2
  done
}

mlx_loop() {
  local i=0
  while :; do
    local prompt="${MLX_PROMPTS[$((i % ${#MLX_PROMPTS[@]}))]}"
    local body
    body=$(printf '{"model":"local","max_tokens":256,"messages":[{"role":"user","content":"%s"}]}' "$prompt")
    curl -s -o /dev/null -w "[mlx] %{http_code} %{time_total}s\n" \
      --max-time 60 -H "Content-Type: application/json" \
      -X POST -d "$body" "$MLX_URL" >> "$LOAD_LOG" 2>&1 || true
    i=$((i+1))
    sleep 1
  done
}

start_probe() {
  [ -n "$PROBE_PID" ] && return 0
  probe_loop &
  PROBE_PID=$!
  log "  probe loop başladı (pid=$PROBE_PID)"
}
stop_probe() {
  [ -z "$PROBE_PID" ] && return 0
  kill "$PROBE_PID" 2>/dev/null || true
  wait "$PROBE_PID" 2>/dev/null || true
  log "  probe loop durdu (pid=$PROBE_PID)"
  PROBE_PID=""
}
start_mlx() {
  [ -n "$MLX_PID" ] && return 0
  mlx_loop &
  MLX_PID=$!
  log "  mlx loop başladı (pid=$MLX_PID)"
}
stop_mlx() {
  [ -z "$MLX_PID" ] && return 0
  kill "$MLX_PID" 2>/dev/null || true
  wait "$MLX_PID" 2>/dev/null || true
  log "  mlx loop durdu (pid=$MLX_PID)"
  MLX_PID=""
}

cleanup() {
  log "temizlik: yük loop'ları durduruluyor"
  stop_probe
  stop_mlx
  log "tamam. özet:  $SUMMARY"
  log "       csv:   $CSV"
  log "       load:  $LOAD_LOG"
}
trap cleanup EXIT INT TERM

# ---------- snapshot (leak-hunt.sh ile aynı format) ----------
pids_for_label() {
  local label="$1"
  launchctl print "gui/${UID_NUM}/${label}" 2>/dev/null \
    | awk '/pid =/ {print $3; exit}'
}

snapshot() {
  local phase="$1"
  local now; now="$(date +%s)"
  for label in "${ALL_LABELS[@]}"; do
    local pid; pid="$(pids_for_label "$label")"
    [ -z "$pid" ] && continue
    local tree; tree="$(pgrep -P "$pid" 2>/dev/null) $pid"
    for p in $tree; do
      [ -z "$p" ] && continue
      ps -o pid=,ppid=,lstart=,rss=,command= -p "$p" 2>/dev/null | \
        awk -v t="$now" -v ph="$phase" -v lbl="$label" '{
          pid=$1; ppid=$2;
          start=$3" "$4" "$5" "$6" "$7;
          rss=$8;
          cmd="";
          for(i=9;i<=NF;i++){ cmd=cmd $i " " }
          gsub(/,/, " ", cmd);
          gsub(/,/, " ", start);
          printf "%s,%s,%s,%s,%s,%s,%.3f,%s\n", t, ph, lbl, pid, ppid, start, rss/1024/1024, cmd
        }' >> "$CSV"
    done
  done
}

run_phase() {
  local phase="$1" duration="$2" desc="$3"
  log "============================================"
  log "Aşama $phase: $desc  (${duration}sn)"
  log "============================================"
  local end=$(( $(date +%s) + duration ))
  while [ "$(date +%s)" -lt "$end" ]; do
    snapshot "$phase"
    sleep 30
  done
}

# ---------- preflight ----------
log "preflight: servisler ayakta mı?"
for l in com.elara.postgres com.elara.qwen72b com.elara.middleware; do
  pid="$(pids_for_label "$l")"
  if [ -z "$pid" ]; then
    log "  HATA: $l koşmuyor. Bu script servisler ayaktayken çalışır."
    exit 1
  fi
  log "  $l pid=$pid ✓"
done
log "  MW_URL=$MW_URL"
log "  MLX_URL=$MLX_URL"

# Hızlı erişim testi
log "preflight: middleware erişilebilir mi?"
mw_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${MW_URL}/health" || echo "000")"
log "  middleware /health: $mw_code"
log "preflight: MLX erişilebilir mi?"
mlx_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:8001/health" || echo "000")"
log "  MLX /health: $mlx_code"

cat <<EOF

================================================================
LEAK-HUNT (LOAD) — Trafik altında RAM izleme
================================================================
- Servisler AYAKTA kalır, sadece yük üretilir
- Süre: 30 dakika  (baseline 2 + probe 8 + mlx 8 + ikisi 10 + cooldown 2)
- CSV:     $CSV
- Özet:    $SUMMARY
- Yük log: $LOAD_LOG

EOF
printf 'Devam? [y/N] '
read -r ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) log "iptal"; trap - EXIT; exit 0 ;;
esac

# ---------- başla ----------
echo "timestamp,phase,label,pid,ppid,start,rss_gb,command" > "$CSV"
: > "$LOAD_LOG"

run_phase 0 120 "baseline (yük yok)"

start_probe
run_phase 1 480 "sadece middleware probe"
stop_probe

start_mlx
run_phase 2 480 "sadece MLX inference"

start_probe
run_phase 3 600 "ikisi birden (tam yük)"
stop_probe
stop_mlx

run_phase 4 120 "cooldown (yük durdu)"

# ---------- özet ----------
log "özet hesaplanıyor..."
python3 - "$CSV" "$SUMMARY" <<'PY'
import csv, sys, collections
csv_path, out_path = sys.argv[1], sys.argv[2]
# (label,pid) -> phase -> [rss_gb...]
data = collections.defaultdict(lambda: collections.defaultdict(list))
cmds, ppids = {}, {}
with open(csv_path) as f:
    for row in csv.DictReader(f):
        key = (row['label'], row['pid'])
        data[key][row['phase']].append(float(row['rss_gb']))
        cmds[key] = row['command'][:80]
        ppids[key] = row.get('ppid', '?')

lines = []
lines.append("=" * 76)
lines.append("LEAK-HUNT LOAD ÖZET")
lines.append("=" * 76)
lines.append("")
PHASE_DESC = {
    '0': 'baseline',
    '1': 'probe-only',
    '2': 'mlx-only',
    '3': 'both',
    '4': 'cooldown',
}
suspects = []
for (label, pid), phases in sorted(data.items()):
    lines.append(f"[{label}] PID {pid} (ppid={ppids.get((label,pid),'?')})  {cmds[(label,pid)]}")
    phase_max = {}
    overall_min = float('inf'); overall_max = 0
    for ph in sorted(phases.keys()):
        vals = phases[ph]
        mn, mx = min(vals), max(vals)
        delta = mx - mn
        marker = "  <-- BÜYÜYOR" if delta >= 1.0 else ""
        desc = PHASE_DESC.get(ph, ph)
        lines.append(f"   aşama {ph} ({desc:9s}): min={mn:6.2f}GB  max={mx:6.2f}GB  Δ={delta:+5.2f}GB{marker}")
        phase_max[ph] = mx
        overall_min = min(overall_min, mn)
        overall_max = max(overall_max, mx)
        if delta >= 1.0:
            suspects.append((label, pid, ph, delta, cmds[(label,pid)]))
    # Yük korelasyonu: aşama 3 max - aşama 0 max (büyüme)
    if '0' in phase_max and '3' in phase_max:
        growth_under_load = phase_max['3'] - phase_max['0']
        if growth_under_load >= 0.5:
            lines.append(f"   ↑ YÜK BÜYÜMESİ: baseline→both  +{growth_under_load:.2f}GB")
    # Cooldown: yük durduktan sonra düştü mü?
    if '3' in phase_max and '4' in phase_max:
        drop = phase_max['3'] - phase_max['4']
        if drop >= 0.3:
            lines.append(f"   ↓ COOLDOWN DÜŞÜŞÜ: both→cooldown -{drop:.2f}GB (RAM serbest bırakıldı)")
        elif phase_max['3'] - phase_max['0'] >= 0.5:
            lines.append(f"   ⚠ COOLDOWN'DA DÜŞMEDİ: yük sonrası RAM tutuluyor — KALICI LEAK ŞÜPHESİ")
    lines.append(f"   TOPLAM: {overall_min:.2f} -> {overall_max:.2f}  (Δ={overall_max-overall_min:+.2f}GB)")
    lines.append("")

lines.append("=" * 76)
if suspects:
    lines.append("SUÇLU(LAR) — tek aşamada 1GB+ büyüme:")
    for label, pid, ph, delta, cmd in sorted(suspects, key=lambda x: -x[3]):
        desc = PHASE_DESC.get(ph, ph)
        lines.append(f"  -> {label} PID {pid}  aşama {ph} ({desc}):  +{delta:.2f}GB")
        lines.append(f"     {cmd}")
else:
    lines.append("Tek aşamada 1GB+ ani büyüme yok.")
    lines.append("Yük altında yavaş ama kalıcı sızıntı varsa yukarıda")
    lines.append("'COOLDOWN'DA DÜŞMEDİ' işaretine bak.")
lines.append("=" * 76)

open(out_path, 'w').write("\n".join(lines) + "\n")
print("\n".join(lines))
PY

log "tamam."
log "  özet:  $SUMMARY"
log "  csv:   $CSV"
log "  load:  $LOAD_LOG"
