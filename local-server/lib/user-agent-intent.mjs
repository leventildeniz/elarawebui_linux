// local-server/lib/user-agent-intent.mjs
// Pre-LLM user → agent intent detector.
//
// Amaç: kullanıcı "firewall ajanına sor", "@[script.py]" gibi açık bir
// niyetle ajan çağırdığında MLX/RAG hattına hiç girmeden doğrudan agent-bridge
// üzerinden spawn et. Böylece RAG sistem prompt'undaki "ajan tetikleme YOK"
// (kural #9) modeli susturduğunda bile ajan cevabı kullanıcıya ulaşır.
//
// Pure & stateless: chat-stream + chat-orchestrate aynı detector'ı çağırır.
// DB lookup'ı çağıran tarafa bırakırız (zaten pool elimizde).
//
// Davranış:
//   - `@[name.py]` veya `@[name]` direkt match → en yüksek güven.
//   - Trigger sözcük (ajan/ajanı/ajanına/ajandan/agent + "ask the X agent")
//     + ajan tanıtıcısı (script base / name / meta.display_name / meta.role)
//     en az 3 karakter, kelime-sınırı eşleşmesi → match.
//   - Kullanıcı sorusu = ham metin (trigger frazını çıkarırız ama yedek olarak
//     ham metni de döneriz; query boş kalmasın).

const TRIGGER_RE = /\b(ajan(?:ı|ın|ına|ına|dan|a|ı?n[ıi]?z[ıi]?)?|agent[s]?|ask\s+the|sor\b)/iu;
const MENTION_RE = /@\[([A-Za-z0-9_\-./]{2,80}?)(?:\.py)?\]/;

function _norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o");
}

// TR ek toleransı: "fortigate" tokenı "fortigatede / fortigateden / fortigatenin"
// gibi çekimli formları da yakalar. Suffix = 0..6 a-z karakteri.
// Kelime sınırı: hem önce hem sonra ASCII alfa-num OLMAMALI (boşluk normalize edildi).
function _escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function _matchTokenWithTrSuffix(normPaddedText, token) {
  if (!token) return false;
  const re = new RegExp("(^| )" + _escRe(token) + "[a-z]{0,6}( |$)");
  return re.test(normPaddedText);
}

function _scriptBaseFromRow(row) {
  const meta = (row && row.meta && typeof row.meta === "object") ? row.meta : {};
  const cand = String(meta.script || row.agent_path || "").trim();
  if (!cand) return null;
  return cand.includes("/") ? cand.slice(cand.lastIndexOf("/") + 1) : cand;
}

function _identifiersForRow(row) {
  const ids = new Set();
  const scriptBase = _scriptBaseFromRow(row);
  if (scriptBase) {
    ids.add(_norm(scriptBase));
    ids.add(_norm(scriptBase.replace(/\.py$/i, "")));
    // split by _ to allow "firewall oracle" → "firewall" "oracle" matchers
    for (const seg of scriptBase.replace(/\.py$/i, "").split(/[_\-]/)) {
      if (seg && seg.length >= 4) ids.add(_norm(seg));
    }
  }
  const name = String(row?.name || "").trim();
  if (name && name.length >= 3) ids.add(_norm(name));
  const meta = (row?.meta && typeof row.meta === "object") ? row.meta : {};
  for (const k of ["display_name", "role", "alias"]) {
    const v = String(meta[k] || "").trim();
    if (v && v.length >= 3) ids.add(_norm(v));
  }
  if (Array.isArray(meta.aliases)) {
    for (const a of meta.aliases) {
      const v = String(a || "").trim();
      if (v && v.length >= 3) ids.add(_norm(v));
    }
  }
  return [...ids].filter((s) => s && s.length >= 3);
}

/**
 * @param {string} userText
 * @param {Array<{id:string,name:string,agent_path:string,meta:object}>} agentRows
 * @returns {{ row: object, script: string, query: string, matchKind: string, matchedToken: string }|null}
 */
export function detectUserAgentMention(userText, agentRows) {
  const text = String(userText || "").trim();
  if (!text || !Array.isArray(agentRows) || !agentRows.length) return null;

  // 1) Direct @[script.py] mention
  const m = MENTION_RE.exec(text);
  if (m) {
    const wanted = _norm(m[1]);
    for (const row of agentRows) {
      const sb = _scriptBaseFromRow(row);
      if (!sb) continue;
      const sbN = _norm(sb);
      if (sbN === wanted || sbN.replace(/\.py$/i, "") === wanted) {
        const script = (row.meta?.script || row.agent_path || sb);
        const query = text.replace(MENTION_RE, "").trim() || text;
        return { row, script, query, matchKind: "mention", matchedToken: m[0] };
      }
    }
  }

  // 2) Trigger word + identifier
  if (!TRIGGER_RE.test(text)) return null;
  const normText = " " + _norm(text).replace(/[^a-z0-9]+/g, " ") + " ";

  let best = null;
  for (const row of agentRows) {
    const ids = _identifiersForRow(row);
    for (const id of ids) {
      const token = id.replace(/[^a-z0-9]+/g, " ").trim();
      if (!token || token.length < 3) continue;
      if (_matchTokenWithTrSuffix(normText, token)) {
        const score = token.length;
        if (!best || score > best.score) {
          best = { row, score, matchedToken: token };
        }
      }
    }
  }
  if (!best) return null;
  const sb = _scriptBaseFromRow(best.row);
  if (!sb || !/\.py$/i.test(sb)) return null;
  const script = (best.row.meta?.script || best.row.agent_path || sb);
  return {
    row: best.row,
    script,
    query: text,
    matchKind: "trigger",
    matchedToken: best.matchedToken,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// pickAgentForQuery — Auto-routing (Elara → ilgili ajan).
//
// Skor sinyalleri (kelime sınırı, normalize edilmiş):
//   - meta.rag.brands[]        → her eşleşme +3
//   - meta.rag.keywords[]      → her eşleşme +2
//   - meta.tags[]              → her eşleşme +1
//   - meta.description token   → her eşleşme +1 (≥4 char tokenler)
//   - script base / role / display_name → her eşleşme +2
//
// `minScore` altı → null döner (Elara cevaplar). `minScore` üstü en yüksek
// skorlu ajan döner. Eşitlikte: en uzun matchedToken kazanır.
//
// Hardcoded brand listesi YOK — agents.meta.rag.brands UI'dan doldurulur.
//
// @param {string} userText
// @param {Array<object>} agentRows
// @param {{minScore?: number}} opts
// @returns {{ row, script, query, matchKind, matchedToken, score, hits }|null}
export function pickAgentForQuery(userText, agentRows, opts = {}) {
  const minScore = Math.max(1, Number(opts.minScore || 2));
  const text = String(userText || "").trim();
  if (!text || !Array.isArray(agentRows) || !agentRows.length) return null;
  const normText = " " + _norm(text).replace(/[^a-z0-9]+/g, " ") + " ";

  const tokenHit = (tok) => {
    const t = _norm(String(tok || "")).replace(/[^a-z0-9]+/g, " ").trim();
    return t && t.length >= 3 && _matchTokenWithTrSuffix(normText, t) ? t : null;
  };

  let best = null;
  for (const row of agentRows) {
    const sb = _scriptBaseFromRow(row);
    if (!sb || !/\.py$/i.test(sb)) continue;
    const meta = (row?.meta && typeof row.meta === "object") ? row.meta : {};
    const rag  = (meta.rag && typeof meta.rag === "object") ? meta.rag : {};

    let score = 0;
    let hits  = [];
    let topToken = "";

    const bump = (token, weight, kind) => {
      const t = tokenHit(token);
      if (!t) return;
      score += weight;
      hits.push({ kind, token: t, weight });
      if (t.length > topToken.length) topToken = t;
    };

    if (Array.isArray(rag.brands))   for (const b of rag.brands)   bump(b, 3, "brand");
    if (Array.isArray(rag.keywords)) for (const k of rag.keywords) bump(k, 2, "keyword");
    if (Array.isArray(meta.tags))    for (const t of meta.tags)    bump(t, 1, "tag");
    for (const f of ["display_name","role","alias"]) bump(meta[f], 2, f);
    bump(sb.replace(/\.py$/i,""), 2, "script");
    bump(row?.name, 2, "name");
    // description token bag (≥4 char, distinct)
    const desc = String(meta.description || meta.role_description || "").toLowerCase();
    if (desc) {
      const seen = new Set();
      for (const w of desc.split(/[^a-z0-9]+/i)) {
        if (w.length < 4 || seen.has(w)) continue;
        seen.add(w);
        bump(w, 1, "desc");
      }
    }

    if (score < minScore) continue;
    if (!best || score > best.score || (score === best.score && topToken.length > best.topToken.length)) {
      best = { row, score, topToken, hits };
    }
  }
  if (!best) return null;
  const sb = _scriptBaseFromRow(best.row);
  const script = (best.row.meta?.script || best.row.agent_path || sb);
  return {
    row: best.row,
    script,
    query: text,
    matchKind: "auto",
    matchedToken: best.topToken,
    score: best.score,
    hits: best.hits,
  };
}
