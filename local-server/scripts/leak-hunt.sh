#!/usr/bin/env bash
# leak-hunt.sh — Kademeli servis başlatma + RSS snapshot ile RAM kaçağı teşhisi.
# Komutan ekrana bakmaz; sonunda /tmp/leak-hunt-*.summary.txt suçluyu söyler.
#
# Aşamalar:
#   0: tüm servisler kapalı            (60 sn,   6 snapshot)
#   1: + postgres + qwen72b (MLX)      (180 sn, 18 snapshot)
#   2: + middleware (server.mjs)       (180 sn, 18 snapshot)
#   3: + vite + tls-proxy              (180 sn, 18 snapshot)
#
# Çıkışta servisleri AÇIK bırakır mı? HAYIR — bootout edip temiz çıkar.
# Komutan teşhisi okuyup elle yeniden açar.

set -u
umask 022

UID_NUM="$(id -u)"
TS="$(date +%Y%m%d-%H%M)"
CSV="/tmp/leak-hunt-${TS}.csv"
SUMMARY="/tmp/leak-hunt-${TS}.summary.txt"

ALL_LABELS=(
  com.elara.postgres
  com.elara.qwen72b
  com.elara.middleware
  com.elara.vite
  com.elara.tls-proxy
)

PHASE0_LABELS=()
PHASE1_LABELS=(com.elara.postgres com.elara.qwen72b)
PHASE2_LABELS=(com.elara.middleware)
PHASE3_LABELS=(com.elara.vite com.elara.tls-proxy)

# -------- yardımcılar --------
log()   { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail()  { log "HATA: $*" >&2; exit 1; }

stop_label() {
  local label="$1"
  launchctl bootout "gui/${UID_NUM}/${label}" 2>/dev/null || true
}

start_label() {
  local label="$1"
  local plist="${HOME}/Library/LaunchAgents/${label}.plist"
  if [ ! -f "$plist" ]; then
    log "uyarı: $plist yok, atlanıyor"
    return 0
  fi
  launchctl bootstrap "gui/${UID_NUM}" "$plist" 2>/dev/null || \
    log "uyarı: $label bootstrap başarısız (zaten yüklü olabilir)"
}

stop_all() {
  log "tüm Elara servisleri kapatılıyor..."
  for l in "${ALL_LABELS[@]}"; do stop_label "$l"; done
  # port artıkları
  for p in 3005 3006 8080 10443 8001 8011 5432; do
    pids="$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  done
  sleep 2
}

cleanup() {
  log "temizlik: tüm servisler kapatılıyor"
  stop_all
  log "tamam. özet: $SUMMARY"
}
trap cleanup EXIT INT TERM

# label -> PID listesi (boşluk ayrılmış)
pids_for_label() {
  local label="$1"
  launchctl print "gui/${UID_NUM}/${label}" 2>/dev/null \
    | awk '/pid =/ {print $3; exit}'
}

# tüm aktif Elara PID'lerini bul ve snapshot al
snapshot() {
  local phase="$1"
  local now; now="$(date +%s)"
  for label in "${ALL_LABELS[@]}"; do
    local pid; pid="$(pids_for_label "$label")"
    [ -z "$pid" ] && continue
    # ana PID + çocukları (örn. server.mjs node spawn ederse)
    local tree; tree="$(pgrep -P "$pid" 2>/dev/null) $pid"
    for p in $tree; do
      [ -z "$p" ] && continue
      ps -o pid=,ppid=,lstart=,rss=,command= -p "$p" 2>/dev/null | \
        awk -v t="$now" -v ph="$phase" -v lbl="$label" '{
          pid=$1; ppid=$2;
          # lstart = "Mon May 18 05:28:01 2026" → 5 alan
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
  local phase="$1" duration="$2" interval="$3" desc="$4"
  log "============================================"
  log "Aşama $phase başlıyor: $desc"
  log "süre: ${duration}sn, aralık: ${interval}sn"
  log "============================================"
  local end=$(( $(date +%s) + duration ))
  while [ "$(date +%s)" -lt "$end" ]; do
    snapshot "$phase"
    sleep "$interval"
  done
}

# -------- preflight: worker Python sürümü --------
# v18 — 3.14'teki MLX Metal cache leak'i 3.12'ye geçişle çözüldü.
# leak-hunt'ı çalıştırmadan ÖNCE doğru runtime'ı kullandığımızı doğrula.
preflight_python() {
  log "preflight: worker Python sürümü kontrol ediliyor..."
  local plist="${HOME}/Library/LaunchAgents/com.elara.middleware.plist"
  local pinned=""
  if [ -f "$plist" ]; then
    pinned="$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:PYTHON_BIN' "$plist" 2>/dev/null || true)"
  fi
  local bin="${pinned:-/opt/homebrew/bin/python3}"
  if [ ! -x "$bin" ]; then
    log "  plist PYTHON_BIN: ${pinned:-<yok>}"
    log "  HATA: $bin executable değil"
    return 1
  fi
  local ver; ver="$("$bin" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])' 2>/dev/null || echo "?")"
  local major_minor; major_minor="$("$bin" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "?")"
  log "  plist PYTHON_BIN: ${pinned:-<yok, default kullanılacak>}"
  log "  resolved binary : $bin"
  log "  python version  : $ver"

  # Şu an çalışan worker'ın sürümünü de göster (varsa)
  local running_pid; running_pid="$(pgrep -f 'uvicorn worker:app' 2>/dev/null | head -n1 || true)"
  if [ -n "$running_pid" ]; then
    local running_exe; running_exe="$(ps -o command= -p "$running_pid" 2>/dev/null | awk '{print $1}')"
    log "  şu an koşan PID : $running_pid"
    log "  şu an koşan exe : $running_exe"
  else
    log "  şu an worker koşmuyor (test sırasında middleware başlatınca spawn olur)"
  fi

  case "$major_minor" in
    3.12|3.13)
      log "  ✓ uyumlu sürüm" ;;
    3.14|3.15)
      log "  ⚠️  UYARI: $major_minor MLX Metal cache leak içeriyor (v18 notları)."
      log "      plist'te PYTHON_BIN=<repo>/local-server/.venv/bin/python (3.12) pinli olmalı." ;;
    *)
      log "  ⚠️  test edilmemiş sürüm: $major_minor" ;;
  esac
}
preflight_python || fail "preflight başarısız"

# -------- onay --------
cat <<EOF

================================================================
RAM KAÇAK AVI — Kademeli servis başlatma + RSS izleme
================================================================
- Tüm Elara servisleri kapatılacak (postgres, qwen72b, middleware, vite, tls-proxy)
- Toplam süre: ~13 dakika
- CSV:     $CSV
- Özet:    $SUMMARY
- Bitince servisler KAPALI kalır. Elle yeniden açacaksın.

EOF
printf 'Devam? [y/N] '
read -r ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) log "iptal"; trap - EXIT; exit 0 ;;
esac

# -------- başla --------
echo "timestamp,phase,label,pid,ppid,start,rss_gb,command" > "$CSV"

stop_all
run_phase 0 60  10 "baseline (her şey kapalı)"

for l in "${PHASE1_LABELS[@]}"; do start_label "$l"; done
sleep 10  # model yüklensin
run_phase 1 180 10 "postgres + MLX (qwen72b)"

for l in "${PHASE2_LABELS[@]}"; do start_label "$l"; done
sleep 5
run_phase 2 180 10 "+ middleware (server.mjs)"

for l in "${PHASE3_LABELS[@]}"; do start_label "$l"; done
sleep 5
run_phase 3 180 10 "+ vite + tls-proxy"

# -------- özet --------
log "özet hesaplanıyor..."
python3 - "$CSV" "$SUMMARY" <<'PY'
import csv, sys, collections
csv_path, out_path = sys.argv[1], sys.argv[2]
# (label,pid) -> phase -> [rss_gb...]
data = collections.defaultdict(lambda: collections.defaultdict(list))
cmds = {}
ppids = {}     # (label,pid) -> ppid
starts = {}    # (label,pid) -> start
# label -> ppid -> set(pid) — repeat-spawn dedektörü
spawn_map = collections.defaultdict(lambda: collections.defaultdict(set))
with open(csv_path) as f:
    r = csv.DictReader(f)
    for row in r:
        key = (row['label'], row['pid'])
        data[key][row['phase']].append(float(row['rss_gb']))
        cmds[key] = row['command'][:80]
        ppids[key] = row.get('ppid', '?')
        starts[key] = row.get('start', '?')
        if row.get('ppid'):
            spawn_map[row['label']][row['ppid']].add(row['pid'])

lines = []
lines.append("=" * 72)
lines.append("LEAK-HUNT ÖZET")
lines.append("=" * 72)
lines.append("")
suspects = []
for (label, pid), phases in sorted(data.items()):
    lines.append(f"[{label}] PID {pid} (ppid={ppids.get((label,pid),'?')})  {cmds[(label,pid)]}")
    overall_min = float('inf'); overall_max = 0
    for ph in sorted(phases.keys()):
        vals = phases[ph]
        mn, mx = min(vals), max(vals)
        delta = mx - mn
        marker = "  <-- BÜYÜYOR" if delta >= 1.0 else ""
        lines.append(f"   aşama {ph}: min={mn:6.2f}GB  max={mx:6.2f}GB  Δ={delta:+5.2f}GB{marker}")
        overall_min = min(overall_min, mn)
        overall_max = max(overall_max, mx)
        if delta >= 1.0:
            suspects.append((label, pid, ph, delta, cmds[(label,pid)]))
    lines.append(f"   TOPLAM: {overall_min:.2f} -> {overall_max:.2f}  (Δ={overall_max-overall_min:+.2f}GB)")
    lines.append("")

# Repeat-spawn dedektörü: aynı (label, ppid) altında 3+ farklı PID = respawn loop.
# v18.1 (2026-05-18): postgres her bağlantı için fork eder (connection backend +
# autovacuum worker + checkpointer/walwriter) — bu respawn loop DEĞİL, by-design.
# Aynı şekilde vite dev build sırasında esbuild child'ları spawn eder. Whitelist:
SPAWN_WHITELIST = {"com.elara.postgres", "com.elara.vite"}

# Ek heuristic: cmd "postgres: ... idle" veya "autovacuum" içeriyorsa connection
# backend'dir, gerçek respawn değil. Label whitelist'te değilse bile zararsız.
def _is_benign_child(cmd: str) -> bool:
    c = (cmd or "").lower()
    return any(k in c for k in (
        "postgres:", "autovacuum", "esbuild", "checkpointer",
        "background writer", "walwriter", "logical replication",
    ))

repeat_spawns = []
for label, by_ppid in spawn_map.items():
    if label in SPAWN_WHITELIST:
        continue
    for ppid, pids in by_ppid.items():
        # benign child'ları say-dışı bırak
        real_pids = [p for p in pids if not _is_benign_child(cmds.get((label, p), ""))]
        if len(real_pids) >= 3:
            repeat_spawns.append((label, ppid, sorted(real_pids, key=lambda x: int(x) if x.isdigit() else 0)))

lines.append("=" * 72)
if repeat_spawns:
    lines.append("REPEAT SPAWN (process leak — respawn loop):")
    for label, ppid, pids in repeat_spawns:
        lines.append(f"  !! {label}: parent ppid={ppid} altında {len(pids)} farklı PID:")
        lines.append(f"     {', '.join(pids)}")
    lines.append("")

if suspects:
    lines.append("SUÇLU(LAR) — RSS büyümesi:")
    for label, pid, ph, delta, cmd in sorted(suspects, key=lambda x: -x[3]):
        lines.append(f"  -> {label} PID {pid} aşama {ph}: +{delta:.2f}GB  ({cmd})")
elif not repeat_spawns:
    lines.append("Suçlu yok (hiçbir PID tek aşamada 1GB+ büyümedi, repeat-spawn da yok).")
    lines.append("Daha uzun süre gerekebilir veya leak idle değil, trafikle tetikleniyor.")
lines.append("=" * 72)

open(out_path, 'w').write("\n".join(lines) + "\n")
print("\n".join(lines))
PY

log "tamam. özet: $SUMMARY"
log "CSV:        $CSV"
