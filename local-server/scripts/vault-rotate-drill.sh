#!/usr/bin/env bash
# Faz 17.5 — Vault Rotation Drill.
# Senaryo: belirli bir vault secret'ı (scope/name) yeni değerle rotate eder,
# audit hash-chain'i doğrular, eski vs yeni okuma'nın audit'e işlendiğini görür.
# Çalıştırma:
#   bash local-server/scripts/vault-rotate-drill.sh \
#     --admin-user admin --admin-pass <pw> \
#     --scope siem --name shared-secret --new-value "$(openssl rand -hex 24)"
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3005}"
ADMIN_USER=""; ADMIN_PASS=""
SCOPE=""; NAME=""; NEW_VALUE=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)        BASE="$2"; shift 2 ;;
    --admin-user)  ADMIN_USER="$2"; shift 2 ;;
    --admin-pass)  ADMIN_PASS="$2"; shift 2 ;;
    --scope)       SCOPE="$2"; shift 2 ;;
    --name)        NAME="$2"; shift 2 ;;
    --new-value)   NEW_VALUE="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    *) echo "[rotate] bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ] || [ -z "$SCOPE" ] || [ -z "$NAME" ]; then
  cat >&2 <<EOF
[rotate] kullanım:
  --admin-user <u> --admin-pass <p>
  --scope <s> --name <n>
  [--new-value <v>]      yoksa openssl rand üretir
  [--dry-run]            yalnız doğrulama; rotation yapmaz
  [--base $BASE]
EOF
  exit 2
fi

if [ -z "$NEW_VALUE" ] && [ "$DRY_RUN" -eq 0 ]; then
  NEW_VALUE=$(openssl rand -hex 24)
fi

say() { echo "[rotate] $*"; }

# 1) Admin login
say "1/6 admin login → $BASE"
LOGIN=$(curl -sk -X POST "$BASE/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\",\"provider\":\"local\",\"device\":\"vault-rotate\"}")
SID=$(echo "$LOGIN" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')
[ -n "$SID" ] || { echo "[rotate] login başarısız: $LOGIN"; exit 1; }
H=(-H "x-session-id: $SID" -H "content-type: application/json")
say "  sid=${SID:0:14}…"

# 2) Rotation öncesi hash-chain doğrula
say "2/6 ÖNCE audit chain verify"
VERIFY_BEFORE=$(curl -sk "${H[@]}" "$BASE/api/vault-audit/verify?limit=1000")
echo "$VERIFY_BEFORE" | grep -q '"ok":true' || { echo "[rotate] HATA — chain ÖNCE bozuk: $VERIFY_BEFORE"; exit 1; }
say "  ✓ chain ok"

# 3) Mevcut değeri oku (rotation öncesi snapshot)
say "3/6 mevcut secret oku (snapshot)"
BEFORE=$(curl -sk "${H[@]}" "$BASE/api/vault/$SCOPE/$NAME")
echo "$BEFORE" | grep -q '"value"' && say "  ✓ secret mevcut" || say "  (uyarı) secret yok — write yeni kayıt yaratacak"

if [ "$DRY_RUN" -eq 1 ]; then
  say "DRY-RUN — rotation atlandı, sadece chain doğrulandı"
  exit 0
fi

# 4) Yeni değeri yaz
say "4/6 rotation: $SCOPE/$NAME ← (gizli, ${#NEW_VALUE} bytes)"
WRITE=$(curl -sk "${H[@]}" -X POST "$BASE/api/vault" \
  -d "{\"scope\":\"$SCOPE\",\"name\":\"$NAME\",\"value\":\"$NEW_VALUE\"}")
echo "$WRITE" | grep -q '"ok":true' || { echo "[rotate] write FAIL: $WRITE"; exit 1; }
say "  ✓ write ok"

# 5) Okuma doğrula
say "5/6 SONRA değer kontrolü"
AFTER=$(curl -sk "${H[@]}" "$BASE/api/vault/$SCOPE/$NAME")
AFTER_VAL=$(echo "$AFTER" | sed -n 's/.*"value":"\([^"]*\)".*/\1/p')
if [ "$AFTER_VAL" = "$NEW_VALUE" ]; then say "  ✓ secret yeni değer döndü"
else echo "[rotate] HATA — okunan değer beklenenle uyuşmadı"; exit 1; fi

# 6) Hash chain SONRA doğrula
say "6/6 SONRA audit chain verify (rotation kaydı + read kayıtları dahil)"
VERIFY_AFTER=$(curl -sk "${H[@]}" "$BASE/api/vault-audit/verify?limit=1000")
echo "$VERIFY_AFTER" | grep -q '"ok":true' || { echo "[rotate] HATA — chain SONRA bozuk: $VERIFY_AFTER"; exit 1; }
say "  ✓ chain sürekli"

# Son 5 audit satırı
RECENT=$(curl -sk "${H[@]}" "$BASE/api/vault-audit?limit=5")
say "son 5 audit kaydı:"
echo "$RECENT" | sed 's/^/  /'

say "PASS — rotation tamam, audit chain bozulmadı"
