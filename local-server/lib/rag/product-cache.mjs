// lib/rag/product-cache.mjs — DB-driven {brand → Set<product>} catalog cache.
// 2026-06-26 — Powers RAG productFilter knob. Pure data layer + token matcher.
// No regex/whitelist — catalog comes from knowledge_chunks DISTINCT.

let _CACHE = { ts: 0, byBrand: null, allProducts: null };

function _norm(s) {
  return String(s || "").toLowerCase().replace(/[_\-].*$/, "").trim();
}
function _tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && t.length <= 40);
}

export function initProductCache({ pool, getRagSettings }) {
  async function getProductCatalog() {
    const ttl = Math.max(30_000, Number(getRagSettings()?.productCacheTtlMs) || 300_000);
    const now = Date.now();
    if (_CACHE.byBrand && now - _CACHE.ts < ttl) return _CACHE;
    try {
      const r = await pool.query(
        `SELECT lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) AS brand,
                lower(product) AS product,
                COUNT(*)::int AS n
           FROM knowledge_chunks
          WHERE product IS NOT NULL AND brand IS NOT NULL
          GROUP BY 1, 2`,
      );
      const byBrand = new Map();
      const allProducts = new Map(); // product → Set<brand>
      for (const row of r.rows) {
        const b = String(row.brand || "").trim();
        const p = String(row.product || "").trim();
        if (!b || !p) continue;
        if (!byBrand.has(b)) byBrand.set(b, new Set());
        byBrand.get(b).add(p);
        if (!allProducts.has(p)) allProducts.set(p, new Set());
        allProducts.get(p).add(b);
      }
      _CACHE = { ts: now, byBrand, allProducts };
      return _CACHE;
    } catch (e) {
      console.warn("[product-cache] refresh failed:", e?.message || e);
      return _CACHE.byBrand ? _CACHE : { ts: now, byBrand: new Map(), allProducts: new Map() };
    }
  }

  // Detect {brand, product} from query tokens, optionally scoped to a brand-lock.
  // Returns null if no confident product match (single brand+product hit).
  async function detectProductFromQuery(q, brandLock = null) {
    const tokens = _tokenize(q);
    if (!tokens.length) return null;
    const brand = brandLock ? _norm(brandLock) : null;
    const t0 = Date.now();
    const client = await pool.connect();
    try {
      await client.query("BEGIN").catch(() => {});
      await client.query(`SET LOCAL statement_timeout = '1800ms'`).catch(() => {});
      const r = await client.query(
        `SELECT lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) AS brand,
                lower(product) AS product,
                COUNT(*)::int AS n
           FROM knowledge_chunks
          WHERE product IS NOT NULL
            AND brand IS NOT NULL
            AND lower(product) = ANY($1::text[])
            AND ($2::text IS NULL OR lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) = $2::text)
          GROUP BY 1, 2
          ORDER BY n DESC
          LIMIT 16`,
        [tokens, brand || null],
      );
      await client.query("COMMIT").catch(() => {});
      const rows = r.rows || [];
      if (brand) {
        const hit = rows[0];
        if (hit?.product) {
          console.log(`[PRODUCT-CACHE] scoped token-hit brand=${hit.brand} product=${hit.product} rows=${rows.length} ms=${Date.now() - t0}`);
          return { brand: String(hit.brand), product: String(hit.product) };
        }
        return null;
      }
      const byProduct = new Map();
      for (const row of rows) {
        const p = String(row.product || "").trim();
        const b = String(row.brand || "").trim();
        if (!p || !b) continue;
        if (!byProduct.has(p)) byProduct.set(p, new Set());
        byProduct.get(p).add(b);
      }
      const matches = rows.filter((row) => byProduct.get(String(row.product || ""))?.size === 1);
      if (matches.length === 1) {
        const hit = matches[0];
        console.log(`[PRODUCT-CACHE] token-hit brand=${hit.brand} product=${hit.product} rows=${rows.length} ms=${Date.now() - t0}`);
        return { brand: String(hit.brand), product: String(hit.product) };
      }
      return null;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      console.warn(`[PRODUCT-CACHE] token-detect skipped: ${e?.message || e}`);
      return null;
    } finally {
      client.release();
    }
  }

  return { getProductCatalog, detectProductFromQuery };
}
