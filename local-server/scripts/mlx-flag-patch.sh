#!/usr/bin/env bash
# mlx-flag-patch.sh — RAM kaçağı kapatma operasyonu (Faz A + Faz B)
#
# Faz A: ~/Library/LaunchAgents/com.elara.qwen72b.plist içinden
#        --prompt-cache-bytes <N>  argümanını çıkartır.
# Faz B: ~/Library/LaunchAgents/com.elara.middleware.plist içine
#        MLX_KEEPWARM_ENABLED=0  ve  MLX_WARMUP_HEARTBEAT_ENABLED=0
#        env'lerini ekler/günceller.
#
# İki dosya da backup'lanır. Çalışan servisler bootout/bootstrap edilir.
# Rollback komutu çıktının sonunda yazar.

set -u
umask 022

UID_NUM="$(id -u)"
TS="$(date +%Y%m%d-%H%M%S)"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
QWEN_PLIST="${AGENTS_DIR}/com.elara.qwen72b.plist"
MW_PLIST="${AGENTS_DIR}/com.elara.middleware.plist"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { log "HATA: $*" >&2; exit 1; }

# --- onay
cat <<EOF

========================================================================
MLX RAM KAÇAĞI PATCH — Faz A + Faz B
========================================================================
A) ${QWEN_PLIST}
   - --prompt-cache-bytes argümanı kaldırılacak (4GB cache havuzu kapanır)
   - qwen72b servisi yeniden başlatılır (~30-60sn model yükleme)

B) ${MW_PLIST}
   - MLX_KEEPWARM_ENABLED=0 eklenecek (45s keep-warm ping kapanır)
   - MLX_WARMUP_HEARTBEAT_ENABLED=0 eklenecek (45s heartbeat kapanır)
   - middleware yeniden başlatılır (~3-5sn)

Tradeoff: ilk mesaj first-token gecikmesi 1-2s → 8-12s (sadece reboot
veya 5dk idle sonrası ilk mesaj). Sonraki mesajlar normal.

Backup'lar oluşturulur, rollback komutu sonda yazar.

EOF
printf 'Devam? [y/N] '
read -r ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) log "iptal"; exit 0 ;;
esac

# --- ön kontroller
command -v plutil >/dev/null || fail "plutil yok (macOS değil mi?)"
command -v launchctl >/dev/null || fail "launchctl yok"
[ -f "$QWEN_PLIST" ] || fail "bulunamadı: $QWEN_PLIST"
[ -f "$MW_PLIST" ]   || fail "bulunamadı: $MW_PLIST"

# --- backup
QWEN_BAK="${QWEN_PLIST}.bak.${TS}"
MW_BAK="${MW_PLIST}.bak.${TS}"
cp "$QWEN_PLIST" "$QWEN_BAK" || fail "qwen backup başarısız"
cp "$MW_PLIST"   "$MW_BAK"   || fail "middleware backup başarısız"
log "backup → $QWEN_BAK"
log "backup → $MW_BAK"

# =============================================================================
# FAZ A — qwen72b.plist: --prompt-cache-bytes ve değerini sök
# =============================================================================
log "Faz A: qwen72b plist'ten --prompt-cache-bytes kaldırılıyor..."

# plutil ile JSON'a çevir, jq ile filtrele, geri yaz.
# jq yoksa python3 ile yapacağız.
PY_SCRIPT=$(cat <<'PYEOF'
import json, sys, plistlib, pathlib
p = pathlib.Path(sys.argv[1])
data = plistlib.loads(p.read_bytes())
args = data.get("ProgramArguments", [])
out = []
skip_next = False
removed = 0
for a in args:
    if skip_next:
        skip_next = False
        removed += 1
        continue
    if a == "--prompt-cache-bytes":
        skip_next = True
        removed += 1
        continue
    out.append(a)
data["ProgramArguments"] = out
p.write_bytes(plistlib.dumps(data))
print(f"removed_tokens={removed}")
PYEOF
)
python3 -c "$PY_SCRIPT" "$QWEN_PLIST" || fail "qwen plist düzenleme başarısız"

# Doğrula
if plutil -p "$QWEN_PLIST" | grep -q -- "--prompt-cache-bytes"; then
  fail "qwen plist'te hâlâ --prompt-cache-bytes var; rollback gerek"
fi
log "Faz A: plist temiz. --prompt-cache-bytes silindi."

# qwen72b restart
log "qwen72b bootout..."
launchctl bootout "gui/${UID_NUM}/com.elara.qwen72b" 2>/dev/null || true
sleep 2
# port 8001 boş mu?
pids="$(lsof -tiTCP:8001 -sTCP:LISTEN 2>/dev/null || true)"
[ -n "$pids" ] && { log "port 8001 zombie pids → kill: $pids"; kill -9 $pids 2>/dev/null || true; }
log "qwen72b bootstrap..."
launchctl bootstrap "gui/${UID_NUM}" "$QWEN_PLIST" \
  || fail "qwen72b bootstrap başarısız (manuel: launchctl bootstrap gui/${UID_NUM} $QWEN_PLIST)"

# =============================================================================
# FAZ B — middleware.plist: env'leri ekle/güncelle
# =============================================================================
log "Faz B: middleware plist'e MLX_KEEPWARM_ENABLED=0 + MLX_WARMUP_HEARTBEAT_ENABLED=0 ekleniyor..."

PY_SCRIPT_B=$(cat <<'PYEOF'
import sys, plistlib, pathlib
p = pathlib.Path(sys.argv[1])
data = plistlib.loads(p.read_bytes())
env = data.setdefault("EnvironmentVariables", {})
env["MLX_KEEPWARM_ENABLED"] = "0"
env["MLX_WARMUP_HEARTBEAT_ENABLED"] = "0"
data["EnvironmentVariables"] = env
p.write_bytes(plistlib.dumps(data))
print("ok: env set")
PYEOF
)
python3 -c "$PY_SCRIPT_B" "$MW_PLIST" || fail "middleware plist düzenleme başarısız"

# Doğrula
plutil -p "$MW_PLIST" | grep -q "MLX_KEEPWARM_ENABLED" || fail "env eklenmemiş"
log "Faz B: env'ler yazıldı."

# middleware restart
log "middleware bootout..."
launchctl bootout "gui/${UID_NUM}/com.elara.middleware" 2>/dev/null || true
sleep 2
for p in 3005 3006; do
  pp="$(lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pp" ] && { log "port $p zombie pids → kill: $pp"; kill -9 $pp 2>/dev/null || true; }
done
log "middleware bootstrap..."
launchctl bootstrap "gui/${UID_NUM}" "$MW_PLIST" \
  || fail "middleware bootstrap başarısız"

# =============================================================================
# Sağlık kontrolü
# =============================================================================
log "sağlık kontrolü (60 sn)..."
ok_mlx=0; ok_mw=0
for i in $(seq 1 30); do
  if [ "$ok_mlx" = 0 ] && lsof -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
    log "  ✓ MLX 8001 dinliyor"
    ok_mlx=1
  fi
  if [ "$ok_mw" = 0 ] && lsof -iTCP:3005 -sTCP:LISTEN >/dev/null 2>&1; then
    log "  ✓ middleware 3005 dinliyor"
    ok_mw=1
  fi
  [ "$ok_mlx" = 1 ] && [ "$ok_mw" = 1 ] && break
  sleep 2
done

[ "$ok_mlx" = 1 ] || log "  ⚠ MLX 8001 henüz dinlemiyor (model yükleme uzayabilir, normal)"
[ "$ok_mw" = 1 ]  || log "  ⚠ middleware 3005 dinlemiyor — log: tail -f /tmp/elara-middleware.err.log"

cat <<EOF

========================================================================
PATCH UYGULANDI
========================================================================
  Qwen plist:        $QWEN_PLIST
  Middleware plist:  $MW_PLIST

  Backup'lar:
    $QWEN_BAK
    $MW_BAK

Doğrulama komutları:
  ps aux | grep mlx_lm.server | grep -v grep
  plutil -p "$MW_PLIST" | grep -E 'KEEPWARM|HEARTBEAT'

Rollback (eğer bir şey ters giderse):
  cp "$QWEN_BAK" "$QWEN_PLIST"
  cp "$MW_BAK"   "$MW_PLIST"
  launchctl bootout   gui/${UID_NUM}/com.elara.qwen72b   2>/dev/null
  launchctl bootout   gui/${UID_NUM}/com.elara.middleware 2>/dev/null
  launchctl bootstrap gui/${UID_NUM} "$QWEN_PLIST"
  launchctl bootstrap gui/${UID_NUM} "$MW_PLIST"

Sıradaki adım: ~5dk sistemin oturmasını bekle, sonra:
  ./local-server/scripts/leak-hunt.sh

İkinci summary.txt'yi paylaş — MLX aşama 2 deltası karşılaştırılacak.
========================================================================
EOF
