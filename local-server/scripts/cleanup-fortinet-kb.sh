#!/usr/bin/env bash
# cleanup-fortinet-kb.sh — legacy remnant temizliği.
#
# `fortinet_kb` eski bir denemeden kalma — yerel dosyalar boş diye silinmişti
# ama DB'de hâlâ 10 chunk + brand alias var. Bu script DB'den siler.
# JSON (brand-aliases.json) tarafında zaten yok.
#
# Kullanım:
#   ./local-server/scripts/cleanup-fortinet-kb.sh           # önce SELECT (dry-run)
#   ./local-server/scripts/cleanup-fortinet-kb.sh --apply   # DELETE çalıştır

set -euo pipefail
PSQL="psql ${DATABASE_URL:-}"

echo "## fortinet_kb cleanup — pre-check"
$PSQL -c "SELECT 'chunks' AS scope, COUNT(*)::int AS n FROM knowledge_chunks WHERE brand='fortinet_kb'
          UNION ALL
          SELECT 'sources_by_name', COUNT(*)::int FROM knowledge_sources WHERE name ILIKE '%fortinet_kb%'
          UNION ALL
          SELECT 'sources_by_tag',  COUNT(*)::int FROM knowledge_sources WHERE tag ILIKE '%fortinet_kb%';"

if [[ "${1:-}" != "--apply" ]]; then
  echo
  echo "Dry-run done. Re-run with --apply to DELETE."
  exit 0
fi

echo
echo "## Applying DELETE ..."
$PSQL <<'SQL'
BEGIN;
DELETE FROM knowledge_chunks  WHERE brand='fortinet_kb';
DELETE FROM knowledge_sources WHERE name ILIKE '%fortinet_kb%' OR tag ILIKE '%fortinet_kb%';
COMMIT;
SQL

echo
echo "## post-check (should be 0/0/0)"
$PSQL -c "SELECT 'chunks' AS scope, COUNT(*)::int AS n FROM knowledge_chunks WHERE brand='fortinet_kb'
          UNION ALL
          SELECT 'sources_by_name', COUNT(*)::int FROM knowledge_sources WHERE name ILIKE '%fortinet_kb%'
          UNION ALL
          SELECT 'sources_by_tag',  COUNT(*)::int FROM knowledge_sources WHERE tag ILIKE '%fortinet_kb%';"

echo
echo "Done. Brand Aliases panel'i yenileyin — fortinet_kb kaybolmuş olmalı."
