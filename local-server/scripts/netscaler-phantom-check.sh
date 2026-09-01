#!/usr/bin/env bash
# netscaler-phantom-check.sh — NetScaler parent/children/chunks tutarlılık kontrolü.
# UI'da 31208 chunk görünüyor, brand netscaler_api'de ~30646 → ~562 fark var mı?
set -euo pipefail

# .env'i auto-load (DATABASE_URL için)
if [[ -f "$(dirname "$0")/../.env" ]]; then
  set -a; . "$(dirname "$0")/../.env"; set +a
fi
PSQL="psql ${DATABASE_URL:-postgres://sovereign:sovereign@127.0.0.1:5432/elara_db}"

PARENT_URL="https://docs.netscaler.com/en-us/citrix-adc/current-release/getting-started-with-citrix-adc.html"

echo "############################################"
echo "# A — Parent + children + chunks cross-check"
echo "############################################"
$PSQL <<SQL
WITH parent AS (
  SELECT id::text AS pid FROM knowledge_sources WHERE url='${PARENT_URL}'
)
SELECT 'parent_exists'    AS k, (SELECT COUNT(*) FROM parent)::int AS n
UNION ALL SELECT 'children_sources', COUNT(*)::int
  FROM knowledge_sources s, parent p WHERE s.parent_id = p.pid
UNION ALL SELECT 'chunks_via_join', COUNT(*)::int
  FROM knowledge_chunks c
  JOIN knowledge_sources s ON s.id::text = c.file_id
  JOIN parent p ON s.parent_id = p.pid
UNION ALL SELECT 'chunks_brand_netscaler_api', COUNT(*)::int
  FROM knowledge_chunks WHERE brand='netscaler_api'
UNION ALL SELECT 'chunks_path_netscaler', COUNT(*)::int
  FROM knowledge_chunks WHERE path ILIKE '%netscaler%' OR path ILIKE '%citrix-adc%';
SQL

echo
echo "############################################"
echo "# B — Source counter (UI'da görünen) vs gerçek chunk sayısı"
echo "############################################"
$PSQL <<SQL
WITH parent AS (
  SELECT id::text AS pid FROM knowledge_sources WHERE url='${PARENT_URL}'
),
children AS (
  SELECT s.id, s.url, s.chunks AS counter
  FROM knowledge_sources s, parent p WHERE s.parent_id = p.pid
)
SELECT
  COUNT(*)                              AS children_n,
  COALESCE(SUM(counter),0)::int         AS sum_source_counter,
  (SELECT COUNT(*) FROM knowledge_chunks c
     WHERE c.file_id IN (SELECT id::text FROM children))::int AS real_chunks,
  COALESCE(SUM(counter),0)::int
    - (SELECT COUNT(*) FROM knowledge_chunks c
         WHERE c.file_id IN (SELECT id::text FROM children))::int AS gap
FROM children;
SQL

echo
echo "############################################"
echo "# C — Per-child diff (counter - real) top 20"
echo "############################################"
$PSQL <<SQL
WITH parent AS (
  SELECT id::text AS pid FROM knowledge_sources WHERE url='${PARENT_URL}'
),
children AS (
  SELECT s.id, s.url, s.chunks AS counter
  FROM knowledge_sources s, parent p WHERE s.parent_id = p.pid
),
real AS (
  SELECT c.file_id, COUNT(*)::int AS real_n
  FROM knowledge_chunks c
  WHERE c.file_id IN (SELECT id::text FROM children)
  GROUP BY c.file_id
)
SELECT
  ch.url,
  ch.counter,
  COALESCE(r.real_n,0) AS real_n,
  (ch.counter - COALESCE(r.real_n,0)) AS diff
FROM children ch
LEFT JOIN real r ON r.file_id = ch.id::text
WHERE ch.counter <> COALESCE(r.real_n,0)
ORDER BY diff DESC
LIMIT 20;
SQL
