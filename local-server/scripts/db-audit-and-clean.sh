#!/usr/bin/env bash
# db-audit-and-clean.sh — Knowledge DB audit + safe cleanup
#
# Modes:
#   --audit   : read-only report (counts, brand/type dist, orphans, stale)
#   --clean   : interactive cleanup (prompts before each DELETE)
#   --smoke   : post-cleanup verification + sweep idempotency check
#
# Default: --audit. Nothing is deleted unless --clean is passed AND user confirms.

set -euo pipefail

DB="${DB_NAME:-elara_db}"
MODE="${1:---audit}"

psql_q() { psql -d "$DB" -At -c "$1"; }
psql_p() { psql -d "$DB" -c "$1"; }

hr() { printf '%s\n' "------------------------------------------------------------"; }
section() { echo; hr; echo "==> $1"; hr; }

# Returns 0 if <table>.<column> exists in the current DB, 1 otherwise.
has_col() {
  local table="$1" col="$2"
  local out
  out=$(psql_q "SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${col}' LIMIT 1") || return 1
  [ "$out" = "1" ]
}

# ============================================================================
# AUDIT (read-only)
# ============================================================================
run_audit() {
  section "1. Source / chunk counts"
  psql_p "
    SELECT
      (SELECT COUNT(*) FROM knowledge_sources)::int AS sources,
      (SELECT COUNT(*) FROM knowledge_chunks)::int  AS chunks,
      (SELECT COUNT(*) FROM knowledge_files)::int   AS files;
  "

  section "2. Sources by type"
  psql_p "SELECT type, COUNT(*)::int AS n FROM knowledge_sources GROUP BY type ORDER BY n DESC;"

  section "3. Sources by brand"
  if has_col knowledge_sources brand; then
    psql_p "SELECT COALESCE(brand,'(null)') AS brand, COUNT(*)::int AS n FROM knowledge_sources GROUP BY brand ORDER BY n DESC LIMIT 30;"
  elif has_col knowledge_chunks brand; then
    echo "(knowledge_sources.brand absent — deriving from knowledge_chunks)"
    psql_p "
      SELECT COALESCE(c.brand,'(null)') AS brand, COUNT(DISTINCT s.id)::int AS sources
        FROM knowledge_sources s
        JOIN knowledge_chunks c ON c.file_id = s.id::text
       GROUP BY c.brand ORDER BY sources DESC LIMIT 30;
    "
  else
    echo "(no brand column on knowledge_sources or knowledge_chunks — skipped)"
  fi

  section "4. Chunks by brand"
  if has_col knowledge_chunks brand; then
    psql_p "SELECT COALESCE(brand,'(null)') AS brand, COUNT(*)::int AS n FROM knowledge_chunks GROUP BY brand ORDER BY n DESC LIMIT 30;"
  else
    echo "(knowledge_chunks.brand absent — skipped)"
  fi

  section "5. Embedding status"
  psql_p "
    SELECT COALESCE(embedding_status,'(null)') AS status,
           COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_vector
      FROM knowledge_chunks GROUP BY embedding_status ORDER BY n DESC;
  "

  section "6. Orphan chunks (BOTH guards: no file AND no source)"
  psql_p "
    SELECT COUNT(*)::int AS true_orphans FROM knowledge_chunks c
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_files   f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path))
       AND NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id);
  "

  section "7. Chunks linked ONLY via knowledge_sources (URL chunks etc.)"
  psql_p "
    SELECT COUNT(*)::int AS source_only_chunks FROM knowledge_chunks c
     WHERE EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id)
       AND NOT EXISTS (SELECT 1 FROM knowledge_files f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path));
  "

  section "8. Chunks linked ONLY via knowledge_files (PDF/local etc.)"
  psql_p "
    SELECT COUNT(*)::int AS file_only_chunks FROM knowledge_chunks c
     WHERE EXISTS (SELECT 1 FROM knowledge_files f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path))
       AND NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id);
  "

  section "9. Empty sources (no chunks, no content)"
  psql_p "
    SELECT COUNT(*)::int AS empty_sources FROM knowledge_sources s
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.file_id = s.id::text)
       AND (s.content IS NULL OR length(s.content) < 50);
  "

  section "10. Stuck embeddings (pending/processing older than 30 min)"
  if psql_q "SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_chunks' AND column_name='updated_at'" | grep -q 1; then
    psql_p "
      SELECT embedding_status, COUNT(*)::int AS n
        FROM knowledge_chunks
       WHERE embedding_status IN ('pending','processing')
         AND updated_at < now() - interval '30 minutes'
       GROUP BY embedding_status;
    "
  else
    echo "(updated_at column not present — skipping stuck-embedding check)"
  fi

  section "11. Disk inventory (library folder)"
  if [ -d "$HOME/ELARA_PROJECT/library" ]; then
    du -sh "$HOME/ELARA_PROJECT/library"/* 2>/dev/null | head -30
  else
    echo "(no library folder at $HOME/ELARA_PROJECT/library)"
  fi

  section "AUDIT DONE"
  echo "Run with --clean to interactively remove orphans/empty/stuck rows."
  echo "Run with --smoke to verify a clean state + sweep idempotency."
}

# ============================================================================
# CLEAN (interactive, atomic, with confirmation)
# ============================================================================
confirm() {
  local prompt="$1"
  echo
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" =~ ^[yY]$ ]]
}

run_clean() {
  section "Pre-clean snapshot"
  run_audit

  section "STEP 1 — Delete TRUE orphan chunks (no file AND no source)"
  local n
  n=$(psql_q "
    SELECT COUNT(*) FROM knowledge_chunks c
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_files   f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path))
       AND NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id);
  ")
  echo "True orphan chunks: $n"
  if [ "$n" -gt 0 ] && confirm "Delete $n true orphan chunks?"; then
    psql_p "
      BEGIN;
      DELETE FROM knowledge_chunks c
       WHERE NOT EXISTS (SELECT 1 FROM knowledge_files   f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path))
         AND NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id);
      COMMIT;
    "
  fi

  section "STEP 2 — Delete empty sources (no chunks AND tiny/null content)"
  n=$(psql_q "
    SELECT COUNT(*) FROM knowledge_sources s
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.file_id = s.id::text)
       AND (s.content IS NULL OR length(s.content) < 50);
  ")
  echo "Empty sources: $n"
  if [ "$n" -gt 0 ] && confirm "Delete $n empty sources?"; then
    psql_p "
      BEGIN;
      DELETE FROM knowledge_sources s
       WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks c WHERE c.file_id = s.id::text)
         AND (s.content IS NULL OR length(s.content) < 50);
      COMMIT;
    "
  fi

  section "STEP 3 — Reset stuck embeddings to pending"
  if psql_q "SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_chunks' AND column_name='updated_at'" | grep -q 1; then
    n=$(psql_q "
      SELECT COUNT(*) FROM knowledge_chunks
       WHERE embedding_status='processing'
         AND updated_at < now() - interval '30 minutes';
    ")
    echo "Stuck 'processing' rows: $n"
    if [ "$n" -gt 0 ] && confirm "Reset $n stuck rows to 'pending'?"; then
      psql_p "
        UPDATE knowledge_chunks
           SET embedding_status='pending'
         WHERE embedding_status='processing'
           AND updated_at < now() - interval '30 minutes';
      "
    fi
  else
    echo "(updated_at not present — skipped)"
  fi

  section "STEP 4 — VACUUM ANALYZE knowledge tables"
  if confirm "Run VACUUM ANALYZE on knowledge_chunks + knowledge_sources?"; then
    psql_p "VACUUM ANALYZE knowledge_chunks;"
    psql_p "VACUUM ANALYZE knowledge_sources;"
  fi

  section "Post-clean snapshot"
  run_audit
}

# ============================================================================
# SMOKE — verify zero orphans + sweep idempotency
# ============================================================================
run_smoke() {
  section "SMOKE 1 — Orphan counts (should be 0)"
  psql_p "
    SELECT 'true_orphans' AS metric, COUNT(*)::int AS n FROM knowledge_chunks c
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_files   f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path))
       AND NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id);
  "

  section "SMOKE 2 — Sweep idempotency (production sweep SQL, dry-run via SELECT)"
  echo "If this returns 0, the cleanupKnowledgeGhosts sweep will NOT delete anything."
  psql_p "
    SELECT COUNT(*)::int AS would_delete FROM knowledge_chunks c
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_files   f WHERE f.id=c.file_id OR (f.root=c.root AND f.path=c.path))
       AND NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id::text=c.file_id);
  "

  section "SMOKE 3 — /api/knowledge/cleanup endpoint (live sweep, should remove 0)"
  if curl -fsS http://127.0.0.1:8787/api/knowledge/cleanup -X POST -H 'Content-Type: application/json' -d '{"staleOnly":false}' 2>/dev/null; then
    echo
  else
    echo "(endpoint not reachable on :8787 — start middleware first)"
  fi

  section "SMOKE DONE"
}

case "$MODE" in
  --audit) run_audit ;;
  --clean) run_clean ;;
  --smoke) run_smoke ;;
  *) echo "Usage: $0 [--audit|--clean|--smoke]"; exit 1 ;;
esac
