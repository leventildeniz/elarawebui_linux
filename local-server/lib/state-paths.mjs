// state-paths.mjs — Code-sync'ten izole runtime state yolları.
// Lovable code-pull / repo restore `local-server/data/*` dosyalarını ezebiliyor.
// UI'dan yönetilen state'i HOME altına alıp dokunulmaz hale getiriyoruz.
//
// Override: ELARA_STATE_DIR env (default: ~/.elara/state)
// Tek tek dosya override'ları: ELARA_BRAND_ALIASES_PATH

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function getStateDir() {
  const fromEnv = process.env.ELARA_STATE_DIR && process.env.ELARA_STATE_DIR.trim();
  const dir = fromEnv || path.join(os.homedir(), ".elara", "state");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

export function getBrandAliasesPath() {
  const override = process.env.ELARA_BRAND_ALIASES_PATH && process.env.ELARA_BRAND_ALIASES_PATH.trim();
  return override || path.join(getStateDir(), "brand-aliases.json");
}

export function getRagSettingsPath() {
  const override = process.env.ELARA_RAG_SETTINGS_PATH && process.env.ELARA_RAG_SETTINGS_PATH.trim();
  return override || path.join(getStateDir(), "rag-settings.json");
}

// Capability Gap Detector — manifest embedding cache.
// Boot'ta bir kez inşa edilir, capability CRUD sonrası invalidate.
// {version, model, dims, builtAt, capabilities:[{id,slug,kind,name,text,embedding:[...]}]}
export function getCapabilityManifestEmbedPath() {
  const override = process.env.ELARA_CAPABILITY_MANIFEST_EMBED_PATH && process.env.ELARA_CAPABILITY_MANIFEST_EMBED_PATH.trim();
  return override || path.join(getStateDir(), "capability-manifest-embed.json");
}

// Migration: brand-aliases ile aynı pattern. UI'dan kaydedilen runtime ayarı
// repo içi `local-server/data/rag-settings.json` veya legacy `local-server/.rag-settings.json`
// konumundaysa, code-sync risk altında. HOME altına taşı (en dolu / en yeni dosyayı seç).
// Eski dosyalara dokunmuyoruz — sadece okuyup HOME'a kopyalıyoruz.
export function migrateRagSettingsIfNeeded(legacyPaths = []) {
  try {
    const newPath = getRagSettingsPath();
    function _stats(p) {
      try {
        if (!p || !fs.existsSync(p)) return null;
        const st = fs.statSync(p);
        const raw = fs.readFileSync(p, "utf8");
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
        return { filePath: p, raw, mtimeMs: st.mtimeMs, keyCount: Object.keys(obj).length };
      } catch { return null; }
    }
    const current = _stats(newPath);
    if (current && current.keyCount > 0) return { migrated: false, reason: "new_path_has_settings", newPath, keyCount: current.keyCount };
    const candidates = legacyPaths.map(_stats).filter(Boolean);
    const best = candidates
      .filter((c) => c.keyCount > 0)
      .sort((a, b) => (b.keyCount - a.keyCount) || (b.mtimeMs - a.mtimeMs))[0];
    if (best && best.filePath !== newPath) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.writeFileSync(newPath, best.raw, "utf8");
      return { migrated: true, keyCount: best.keyCount, from: best.filePath, to: newPath, reason: current ? "recovered_empty_state" : "recovered_missing_state" };
    }
    if (!current) {
      try { fs.writeFileSync(newPath, "{}\n", "utf8"); } catch { /* ignore */ }
      return { migrated: false, reason: "no_legacy", newPath };
    }
    return { migrated: false, reason: "new_path_exists_empty", newPath };
  } catch (e) {
    return { migrated: false, reason: "error", error: String(e?.message || e) };
  }
}

function _aliasStats(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    let aliasCount = 0;
    for (const entry of Object.values(obj)) {
      if (Array.isArray(entry?.aliases)) aliasCount += entry.aliases.filter(Boolean).length;
    }
    return { filePath, raw, mtimeMs: st.mtimeMs, brandCount: Object.keys(obj).length, aliasCount };
  } catch {
    return null;
  }
}

function _aliasCandidates(newPath, legacyPath) {
  const files = new Set([newPath, legacyPath].filter(Boolean));
  for (const p of [newPath, legacyPath].filter(Boolean)) {
    try {
      const dir = path.dirname(p);
      const base = path.basename(p);
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(base + ".") && name.endsWith(".bak")) files.add(path.join(dir, name));
      }
    } catch { /* ignore */ }
  }
  return [...files].map(_aliasStats).filter(Boolean);
}

// One-shot migration: eğer yeni path yoksa ve eski (repo içi) dosya
// non-empty ise kopyala. Eski dosyaya dokunmuyoruz — code-sync ezse de
// yeni path HOME altında güvende.
export function migrateBrandAliasesIfNeeded(legacyPath) {
  try {
    const newPath = getBrandAliasesPath();
    const current = _aliasStats(newPath);
    if (current && current.aliasCount > 0) return { migrated: false, reason: "new_path_has_aliases", newPath };
    const best = _aliasCandidates(newPath, legacyPath)
      .filter((c) => c.aliasCount > 0)
      .sort((a, b) => (b.aliasCount - a.aliasCount) || (b.brandCount - a.brandCount) || (b.mtimeMs - a.mtimeMs))[0];
    if (best && best.filePath !== newPath) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.writeFileSync(newPath, best.raw, "utf8");
      return { migrated: true, brandCount: best.brandCount, aliasCount: best.aliasCount, from: best.filePath, to: newPath, reason: current ? "recovered_empty_state" : "recovered_missing_state" };
    }
    if (current) return { migrated: false, reason: "new_path_exists_empty", newPath };
    if (!legacyPath || !fs.existsSync(legacyPath)) {
      // İlk açılış — boş dosya oluştur ki audit log MISSING demesin.
      try { fs.writeFileSync(newPath, "{}\n", "utf8"); } catch { /* ignore */ }
      return { migrated: false, reason: "no_legacy", newPath };
    }
    const raw = fs.readFileSync(legacyPath, "utf8");
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const brandCount = parsed && typeof parsed === "object" ? Object.keys(parsed).length : 0;
    if (brandCount === 0) {
      try { fs.writeFileSync(newPath, "{}\n", "utf8"); } catch { /* ignore */ }
      return { migrated: false, reason: "legacy_empty", newPath };
    }
    fs.writeFileSync(newPath, raw, "utf8");
    return { migrated: true, brandCount, from: legacyPath, to: newPath };
  } catch (e) {
    return { migrated: false, reason: "error", error: String(e?.message || e) };
  }
}
