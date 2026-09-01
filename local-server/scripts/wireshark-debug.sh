#!/usr/bin/env bash
# wireshark-debug.sh — Wireshark fetch'in neden 0 chunk ürettiğini teşhis et.
#
# B-bloğu önceki turda H1/H2/H4'ü eledi: text/html 200, 4996 char visible text,
# noindex yok. Kalan: H3 (noindex per-page), H5 (robots.txt) veya başka bir
# crawler-içi filtre. A-bloğu SQL cast hatası vardı, bu sürümde düzeltildi.

set -euo pipefail
PSQL="psql ${DATABASE_URL:-}"
URL_ROOT="https://www.wireshark.org/docs/"
SAMPLE_URL="https://www.wireshark.org/docs/wsug_html_chunked/ChapterIntroduction.html"

echo "############################################"
echo "# A — DB cross-check (parent_id text vs id uuid — cast'li)"
echo "############################################"
$PSQL <<SQL
-- parent_id is text, id is uuid → cast id to text on the right side
WITH parent AS (
  SELECT id::text AS pid FROM knowledge_sources WHERE url='${URL_ROOT}'
)
SELECT 'parent_exists' AS k, (SELECT COUNT(*)::int FROM parent) AS n
UNION ALL
SELECT 'children_sources',
       (SELECT COUNT(*)::int FROM knowledge_sources s WHERE s.parent_id IN (SELECT pid FROM parent))
UNION ALL
SELECT 'chunks_via_join',
       (SELECT COUNT(*)::int FROM knowledge_chunks k
          JOIN knowledge_sources s ON k.file_id = s.id::text
         WHERE s.parent_id IN (SELECT pid FROM parent))
UNION ALL
SELECT 'chunks_via_path',  (SELECT COUNT(*)::int FROM knowledge_chunks WHERE path ILIKE '%wireshark%')
UNION ALL
SELECT 'chunks_via_brand', (SELECT COUNT(*)::int FROM knowledge_chunks WHERE brand ILIKE '%wireshark%');

-- sample children + their real chunk count
SELECT s.url,
       s.chunks AS source_chunks_col,
       (SELECT COUNT(*) FROM knowledge_chunks WHERE file_id = s.id::text) AS real_chunks
  FROM knowledge_sources s
 WHERE s.parent_id = (SELECT id::text FROM knowledge_sources WHERE url='${URL_ROOT}')
 ORDER BY s.created_at DESC
 LIMIT 8;

-- crawl_config for the parent (preset, depth, includePattern, etc.)
SELECT id, name, url, crawl_config
  FROM knowledge_sources
 WHERE url='${URL_ROOT}';
SQL

echo
echo "############################################"
echo "# B — Canlı HTML probe (sample URL)"
echo "############################################"
echo "URL: ${SAMPLE_URL}"
echo
echo "-- HEAD (content-type, size) --"
curl -sIL "${SAMPLE_URL}" | grep -iE "^(HTTP|content-type|content-length)" || true

echo
echo "-- BODY size + noindex meta --"
TMP=$(mktemp)
curl -sL -o "$TMP" "${SAMPLE_URL}"
echo "bytes: $(wc -c < "$TMP")"
echo -n "noindex meta: "; grep -ciE 'noindex|<meta[^>]+name=["'"'"']robots' "$TMP" || true

echo
echo "-- visible text length (strip tags) --"
TEXT_LEN=$(python3 -c "
import re
html=open('$TMP').read()
html=re.sub(r'<(script|style)[^>]*>.*?</\1>','',html,flags=re.I|re.S)
text=re.sub(r'<[^>]+>',' ',html)
text=re.sub(r'\s+',' ',text).strip()
print(len(text))
")
echo "stripped text chars: $TEXT_LEN  (threshold: 50)"
rm -f "$TMP"

echo
echo "############################################"
echo "# C — robots.txt (H5)"
echo "############################################"
curl -sL https://www.wireshark.org/robots.txt | head -60 || true

echo
echo "############################################"
echo "# D — sitemap.xml (crawler tohumu)"
echo "############################################"
echo "-- /sitemap.xml HEAD --"
curl -sIL https://www.wireshark.org/sitemap.xml | head -5
echo
echo "-- robots.txt → Sitemap: directive --"
curl -sL https://www.wireshark.org/robots.txt | grep -i '^sitemap:' || echo "(no Sitemap: directive in robots.txt)"

echo
echo "############################################"
echo "# E — Server log son crawl izi"
echo "############################################"
echo "-- macOS unified log (last 6h, com.elara.middleware) --"
log show --predicate 'process == "bun" OR process == "node"' --last 6h 2>/dev/null \
  | grep -iE 'crawl|wireshark|non-html|ingest fail' | tail -40 \
  || echo "(no matching lines or log access denied)"

echo
echo "-- stderr file (if any) --"
for f in ~/Library/Logs/com.elara.middleware.err.log \
         ~/Library/Logs/com.elara.middleware.out.log \
         /tmp/com.elara.middleware.err.log; do
  if [[ -f "$f" ]]; then
    echo "## $f (last 200 lines, filtered)"
    tail -200 "$f" | grep -iE 'crawl|wireshark|non-html|ingest fail' || echo "(no matches in $f)"
  fi
done

echo
echo "## Sonuç:"
echo "  A: DB cross-check sayıları → sources var mı, chunks gerçekten 0 mı?"
echo "  C: robots.txt /docs/ disallow var mı? (H5)"
echo "  D: sitemap erişilebilir mi? (crawler seed)"
echo "  E: log'da [crawl] ingest fail / non-html / skip reason?"
echo "  Çıktıyı yapıştır, hipotezi netleştirelim."
