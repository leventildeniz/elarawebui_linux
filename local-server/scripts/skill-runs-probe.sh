#!/usr/bin/env bash
# Skill runs teşhis: DB ↔ HTTP ↔ HTTPS arasında nerede kayıp olduğunu gösterir.
set -u

# Varsayılan DB ayarları (override için ortam değişkenlerini export edin).
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGDATABASE="${PGDATABASE:-elara_db}"
export PGUSER="${PGUSER:-sovereign}"
export PGPASSWORD="${PGPASSWORD:-sovereign}"

bar() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$1"; }
psql_run() { psql -X -v ON_ERROR_STOP=1 "$@" 2>&1; }

bar "DB · bağlantı (${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE})"
psql_run -c "SELECT current_database(), current_user;" || { echo "psql bağlanamadı — PGDATABASE/PGUSER/PGPASSWORD'i kontrol edin."; }

bar "DB · skill_runs özet"
psql_run -A -F$'\t' -c "SELECT count(*) AS total, max(started_at) AS last_run FROM skill_runs;" || echo "psql FAIL"

bar "DB · son 10 kayıt"
psql_run -c "SELECT id, skill_slug, user_id, status, started_at FROM skill_runs ORDER BY started_at DESC LIMIT 10;" || echo "psql FAIL"

bar "DB · skills_seed_skip"
psql_run -c "SELECT * FROM skills_seed_skip;" || echo "tablo yok"

bar "HTTP :3005 /api/skills/runs?limit=10"
curl -sS -o /tmp/skill-runs-http.json -w "status=%{http_code}  bytes=%{size_download}\n" \
  "http://127.0.0.1:3005/api/skills/runs?limit=10" || echo "curl FAIL"
echo "--- body (ilk 800 char) ---"
head -c 800 /tmp/skill-runs-http.json 2>/dev/null; echo

bar "HTTPS :3006 /api/skills/runs?limit=10"
curl -ksS -o /tmp/skill-runs-https.json -w "status=%{http_code}  bytes=%{size_download}\n" \
  "https://127.0.0.1:3006/api/skills/runs?limit=10" || echo "curl FAIL"
echo "--- body (ilk 800 char) ---"
head -c 800 /tmp/skill-runs-https.json 2>/dev/null; echo

bar "HTTP :3005 /api/skills (skill listesi sağlığı)"
curl -sS -o /dev/null -w "status=%{http_code}  bytes=%{size_download}\n" \
  "http://127.0.0.1:3005/api/skills" || echo "curl FAIL"

echo
echo "Bitti. Yukarıdaki üç katmandan hangisinde sayı/sonuç sıfırlanıyorsa kök neden orada."
