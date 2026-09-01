#!/usr/bin/env bash
# wireshark-orphan-cleanup.sh — Wireshark parent UI'dan silindi, 376 child source orphan.
# Default: DRY-RUN (sadece sayım). --apply ile transaction içinde siler.
set -euo pipefail

if [[ -f "$(dirname "$0")/../.env" ]]; then
  set -a; . "$(dirname "$0")/../.env"; set +a
fi
PSQL="psql ${DATABASE_URL:-postgres://sovereign:sovereign@127.0.0.1:5432/elara_db}"

MODE="${1:-dry-run}"
FILTER="url ILIKE '%wireshark%' OR name ILIKE '%wireshark%'"

echo "############################################"
echo "# Wireshark orphan cleanup — mode: ${MODE}"
echo "############################################"

echo
echo "-- DRY-RUN sayım --"
$PSQL <<SQL
SELECT 'sources_to_delete' AS k, COUNT(*)::int AS n
  FROM knowledge_sources
  WHERE ${FILTER}
UNION ALL SELECT 'chunks_to_delete', COUNT(*)::int
  FROM knowledge_chunks
  WHERE file_id IN (
    SELECT id::text FROM knowledge_sources WHERE ${FILTER}
  );
SQL

if [[ "$MODE" != "--apply" ]]; then
  echo
  echo ">> DRY-RUN bitti. Silmek için: $0 --apply"
  exit 0
fi

echo
echo "-- APPLY: tek transaction içinde silme --"
$PSQL <<SQL
BEGIN;
DELETE FROM knowledge_chunks
  WHERE file_id IN (
    SELECT id::text FROM knowledge_sources WHERE ${FILTER}
  );
DELETE FROM knowledge_sources WHERE ${FILTER};
COMMIT;
SQL

echo
echo "-- Post-delete kontrol --"
$PSQL <<SQL
SELECT 'sources_remaining' AS k, COUNT(*)::int AS n
  FROM knowledge_sources WHERE ${FILTER}
UNION ALL SELECT 'chunks_remaining', COUNT(*)::int
  FROM knowledge_chunks WHERE path ILIKE '%wireshark%' OR brand ILIKE '%wireshark%';
SQL
