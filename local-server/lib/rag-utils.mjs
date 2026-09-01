import path from "node:path";
import fs from "node:fs";

// --- Liyakat (Role) Hierarchy --------------------------------------------------
// Higher rank = more privilege. A user with rank >= file rank can read it.
export const ROLE_RANK = { Viewer: 1, Security: 2, Operator: 3, Admin: 4 };
export const VALID_ACCESS_LEVELS = new Set(Object.keys(ROLE_RANK));

export function normalizeAccessLevel(level) {
  const v = String(level ?? "Viewer").trim();
  return VALID_ACCESS_LEVELS.has(v) ? v : "Viewer";
}

export function userCanRead(userRole, fileLevel) {
  const u = ROLE_RANK[normalizeAccessLevel(userRole)] ?? 0;
  const f = ROLE_RANK[normalizeAccessLevel(fileLevel)] ?? 99;
  return u >= f;
}

// --- Brand Extraction from URLs ------------------------------------------------
const _PUBLIC_SUFFIX_2 = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go",
]);

export function deriveBrandFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length < 2) return parts[0] || null;
    const last = parts[parts.length - 1];
    const second = parts[parts.length - 2];
    // ccTLD with 2-letter country code AND 2nd-level public suffix
    // (example.co.uk, example.com.tr) -> return parts[-3] if present.
    if (last.length === 2 && _PUBLIC_SUFFIX_2.has(second) && parts.length >= 3) {
      return parts[parts.length - 3];
    }
    return second;
  } catch {
    return null;
  }
}

export function deriveBrandFromKnowledgeSource(source = {}) {
  const type = String(source.type || "").toLowerCase();
  if (type === "url" && source.url) return deriveBrandFromUrl(source.url);
  const explicit = String(source.tag || "").trim();
  if (explicit && !/^(uploaded file|inline text|web source|local directory)$/i.test(explicit)) {
    return explicit.slice(0, 64);
  }
  const rawName = String(source.name || "").trim();
  if (!rawName) return null;
  const clean = rawName.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
  return clean ? clean.slice(0, 64) : null;
}

// --- Library Root Persistence -------------------------------------------------
const LIBRARY_ROOT_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".library-root");

function loadPersistedLibraryRoot() {
  try {
    const raw = fs.readFileSync(LIBRARY_ROOT_FILE, "utf8").trim();
    if (raw) return path.resolve(raw);
  } catch {
    // no override yet
  }
  return null;
}

let _DEFAULT_LIBRARY_ROOT = loadPersistedLibraryRoot();

export function getDefaultLibraryRoot() {
  return _DEFAULT_LIBRARY_ROOT;
}

export function setDefaultLibraryRoot(p) {
  _DEFAULT_LIBRARY_ROOT = p;
}

export function persistLibraryRoot(p) {
  try {
    fs.writeFileSync(LIBRARY_ROOT_FILE, String(p), "utf8");
    return true;
  } catch (e) {
    console.warn("[library:persist]", e.message);
    return false;
  }
}

// --- Directory Normalization & Root Checks -------------------------------------
export function normalizeDirRoot(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "";
  return path.resolve(raw.replace(/^dir:/, "")).replace(/[\\\/]+$/, "");
}

export function isSameOrUnderRoot(parent, candidate) {
  const p = normalizeDirRoot(parent);
  const c = normalizeDirRoot(candidate);
  if (!p || !c) return false;
  if (p === c) return true;
  const rel = path.relative(p, c);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function canonicalizeKnowledgeRoot(value) {
  const requested = normalizeDirRoot(value || _DEFAULT_LIBRARY_ROOT);
  const defaultRoot = normalizeDirRoot(_DEFAULT_LIBRARY_ROOT);
  if (requested && defaultRoot && requested !== defaultRoot && isSameOrUnderRoot(defaultRoot, requested)) {
    return { root: defaultRoot, requested, nested: true };
  }
  return { root: requested, requested, nested: false };
}

export function resolveLibraryRoot(value) {
  const raw = String(value ?? "").trim();
  return path.resolve(raw || _DEFAULT_LIBRARY_ROOT);
}

// --- Brand Matching & Extraction -----------------------------------------------
export function deriveBrand(root, filePath) {
  if (!filePath || !filePath.startsWith(root)) return null;
  const rel = filePath.slice(root.length).replace(/^[\/\\]+/, "");
  const seg = rel.split(/[\\\/]/);
  return seg.length > 1 ? seg[0] : null;
}

export function aliasMatchedBrands(q, knownBrands) {
  const ql = String(q || "").toLowerCase();
  const hits = new Set();
  for (const b of knownBrands || []) {
    if (!b) continue;
    const re = new RegExp("\\\\b" + String(b).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "(?:[a-zçğıöşü]{1,6})?\\\\b", "i");
    if (re.test(ql)) hits.add(b);
  }
  return Array.from(hits);
}

export function aliasMatchedBrand(q, knownBrands) {
  const ql = String(q || "").toLowerCase();
  const sorted = [...(knownBrands || [])].filter(Boolean).sort((a, b) => String(b).length - String(a).length);
  for (const b of sorted) {
    const re = new RegExp("\\\\b" + String(b).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "(?:[a-zçğıöşü]{1,6})?\\\\b", "i");
    if (re.test(ql)) return b;
  }
  return null;
}

// --- Query Expansion & Technical Analysis -------------------------------------
export const SYNONYMS = {
  "öncelik": ["priority", "precedence", "hierarchy"],
  "sıra": ["order", "sequence", "priority"],
  "kural": ["rule", "policy"],
  "kurallar": ["rules", "policies"],
  "politika": ["policy", "rule"],
  "politikalar": ["policies", "rules"],
  "güvenlik": ["security"],
  "ağ": ["network"],
  "yönlendirme": ["routing", "route"],
  "arayüz": ["interface"],
  "sürüm": ["version", "release"],
  "yükseltme": ["upgrade", "update"],
  "yedek": ["backup", "snapshot"],
  "kullanıcı": ["user", "admin"],
  "yetki": ["permission", "privilege", "role"],
  "lisans": ["license", "licence"],
};

export const STOPWORDS = new Set([
  "ve", "veya", "ya", "ile", "de", "da", "ki", "mi", "mı", "mu", "mü", "ne", "ama", "fakat", "ancak",
  "için", "gibi", "kadar", "göre", "sonra", "önce", "şu", "bu", "o", "şey", "bir", "biraz", "çok", "az",
  "her", "hep", "hiç", "ben", "sen", "biz", "siz", "onlar", "bana", "sana", "bize", "size", "onu", "onun",
  "var", "yok", "olan", "olur", "oldu", "olmak", "yapmak", "etmek", "mı", "midir", "değil", "evet", "hayır",
  "lütfen", "tamam", "peki", "acaba", "sanki", "yani", "ise", "eğer", "çünkü", "zaten", "tabii",
  "the", "a", "an", "and", "or", "but", "if", "then", "of", "in", "on", "at", "to", "for", "with", "by",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "our",
  "this", "that", "these", "those", "there", "here", "what", "which", "who", "whom", "why", "how", "when", "where",
  "not", "no", "yes", "please", "ok", "okay", "just", "only", "very", "much", "many", "some", "any", "all",
]);

export function expandQueryTerms(q) {
  const raw = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const cleaned = raw.filter((t) => {
    if (/[\d_.\-]/.test(t)) return true;
    if (t.length >= 8) return true;
    return !STOPWORDS.has(t);
  });
  const base = cleaned.length ? cleaned : raw;
  const out = new Set(base);
  for (const t of base) {
    const syns = SYNONYMS[t];
    if (syns) syns.forEach((s) => out.add(s.toLowerCase()));
  }
  return Array.from(out).slice(0, 20);
}

export function buildOrTsQuery(terms) {
  const lexemes = [];
  for (const term of terms) {
    const parts = String(term || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((p) => p.length >= 2);
    for (const p of parts) lexemes.push(p.replace(/'/g, ""));
  }
  return Array.from(new Set(lexemes)).join(" | ");
}

export function isTechnicalQuery(q, terms = []) {
  const raw = String(q || "");
  const text = `${raw} ${(terms || []).join(" ")}`;
  return (
    /\\b(?:r\\d{2,3}(?:\\.\\d+)?|maestro|forti\\w+|gaia|smartconsole|cpuse|jhf|hotfix|take|pan-os|ios-xe|big-ip|cve-\\d{4}-\\d+)\\b/i.test(text) ||
    /\\b[A-Z]{2,}[A-Z0-9._-]*\\d+[A-Z0-9._-]*\\b/.test(raw) ||
    /\\b[a-z]+\\d{2,}[a-z0-9._-]*\\b/i.test(raw)
  );
}

// --- Math & DB Utils ----------------------------------------------------------
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export async function tableHasColumn(pool, tableName, columnName) {
  const { rows } = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists,
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name=$2 AND column_name=$3
            ) AS has_column`,
    [`public.${tableName}`, tableName, columnName]
  );
  return !!rows[0]?.exists && !!rows[0]?.has_column;
}

export function isTsVectorOverflowError(error) {
  return /string is too long for tsvector/i.test(String(error?.message || error));
}

// --- Directory Audit & Traversal ----------------------------------------------
export async function inspectDirectoryAccess(root, opts = {}) {
  const recursive = opts.recursive !== false;
  const sampleLimit = Math.max(1, Math.min(100, Number(opts.sampleLimit) || 20));
  const audit = {
    root,
    recursive,
    exists: false,
    isDirectory: false,
    readable: false,
    executable: false,
    visitedDirs: 0,
    filesSeen: 0,
    indexableSeen: 0,
    permissionErrors: [],
    errors: [],
    sampleFiles: [],
  };
  try {
    const st = await fs.promises.stat(root);
    audit.exists = true;
    audit.isDirectory = st.isDirectory();
  } catch (e) {
    audit.errors.push({ path: root, code: e.code || "STAT", message: String(e.message || e) });
    return audit;
  }
  try {
    await fs.promises.access(root, fs.constants.R_OK);
    audit.readable = true;
  } catch (e) {
    audit.permissionErrors.push({ path: root, code: e.code || "R_OK", message: String(e.message || e) });
  }
  try {
    await fs.promises.access(root, fs.constants.X_OK);
    audit.executable = true;
  } catch (e) {
    audit.permissionErrors.push({ path: root, code: e.code || "X_OK", message: String(e.message || e) });
  }
  if (!audit.isDirectory || !audit.readable) return audit;
  for await (const file of walkDir(root, recursive, audit)) {
    // Note: INDEXABLE_EXT should be provided or defined globally
    // For now we use a placeholder or leave it to the caller
    audit.filesSeen += 1;
    if (audit.sampleFiles.length < sampleLimit) audit.sampleFiles.push(file);
  }
  return audit;
}

export async function* walkDir(root, recursive, audit = null) {
  const stack = [root];
  const skipRoots = [];
  while (stack.length) {
    const dir = stack.pop();
    if (audit) audit.visitedDirs = (audit.visitedDirs || 0) + 1;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      const item = { path: dir, code: e.code || "READDIR", message: String(e.message || e) };
      if (audit) {
        audit.errors?.push(item);
        if (e.code === "EACCES" || e.code === "EPERM") audit.permissionErrors?.push(item);
      }
      console.warn(`[rag:walk] skip ${dir}: ${item.code} ${item.message}`);
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipRoots.some((r) => isSameOrUnderRoot(r, full))) {
          if (audit) audit.errors?.push({ path: full, code: "EXCLUDED_SUBROOT", message: "nested ghost root excluded from recursive index" });
          continue;
        }
        if (recursive) stack.push(full);
        continue;
      }
      if (e.isFile()) {
        if (audit) audit.filesSeen = (audit.filesSeen || 0) + 1;
        yield full;
      }
    }
  }
}

export function resolveFileAccessLevel(filePath, defaultLevel, folderMap) {
  if (folderMap && typeof folderMap === "object") {
    let best = null;
    for (const folder of Object.keys(folderMap)) {
      if (filePath.startsWith(folder) && (!best || folder.length > best.length)) best = folder;
    }
    if (best) return normalizeAccessLevel(folderMap[best]);
  }
  return normalizeAccessLevel(defaultLevel);
}
