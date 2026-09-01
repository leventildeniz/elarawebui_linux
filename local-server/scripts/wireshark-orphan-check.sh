#!/usr/bin/env bash
# wireshark-orphan-check.sh — Wireshark source UI'dan silindi.
# DB'de orphan chunk/source kalmış mı? Cleanup gerekiyor mu?
set -euo pipefail

if [[ -f "$(dirname "$0")/../.env" ]]; then
  set -a; . "$(dirname "$0")/../.env"; set +a
fi
PSQL="psql ${DATABASE_URL:-postgres://sovereign:sovereign@127.0.0.1:5432/elara_db}"

echo "############################################"
echo "# Wireshark orphan scan"
echo "############################################"
$PSQL <<SQL
SELECT 'sources_wireshark' AS k, COUNT(*)::int AS n
  FROM knowledge_sources
  WHERE url ILIKE '%wireshark%' OR name ILIKE '%wireshark%'
UNION ALL SELECT 'chunks_path_wireshark', COUNT(*)::int
  FROM knowledge_chunks WHERE path ILIKE '%wireshark%'
UNION ALL SELECT 'chunks_brand_wireshark', COUNT(*)::int
  FROM knowledge_chunks WHERE brand ILIKE '%wireshark%';
SQL
