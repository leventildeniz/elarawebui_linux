// ===========================================================================
// lib/product-extract.mjs
// ---------------------------------------------------------------------------
// Agnostic Brand-aware product / category / version extractor.
// ===========================================================================

function basenameOf(p) {
  if (!p) return "";
  const s = String(p).replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function stripExt(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

export function extractProduct({ brand, path: rawPath, filename } = {}) {
  const brandKey = brand ? String(brand).toLowerCase() : null;
  const fname = filename || basenameOf(rawPath);
  const base = stripExt(fname);

  let product = brandKey || null;
  let category = null;
  let version = null;

  // Generic version extraction (e.g. v7.4.1, 14.1, R81.20)
  const vMatch = base.match(/(?:v|-|_|^)(R?\d+\.\d+(?:\.\d+)?)/i);
  if (vMatch) version = vMatch[1];

  return {
    product: product ? String(product).toLowerCase() : null,
    category,
    version
  };
}

export default extractProduct;
