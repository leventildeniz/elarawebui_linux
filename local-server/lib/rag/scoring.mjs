// Pure RAG scoring + token utilities (Tur 1a, 2026-05-30).
// Extracted from server.mjs without behaviour change. No DI (pure), except
// makeThinkStripper which takes ragSettings at call time.

export const RAG_STOP = new Set([
  "the","a","an","and","or","but","of","for","to","in","on","at","by","with",
  "is","are","was","were","be","been","being","this","that","these","those",
  "it","its","as","from","into","about","than","then","so","if","do","does",
  "did","not","no","yes","i","you","he","she","we","they","me","him","her",
  "them","my","your","our","their","what","which","who","whom","how","why",
  "when","where","can","could","should","would","will","just","also","very",
  "ne","nasıl","nedir","mı","mi","mu","mü","ve","veya","ile","için","bu","şu",
  "selam","merhaba","naber","sağol","teşekkür","teşekkürler","tamam","evet",
  "hayır","peki","oldu","günaydın","iyi","kötü","hello","hi","hey","thanks",
  "thank","ok","okay","please","sure","good","bad","cool","nice",
  "elara","bana","bize","sana","size","lütfen","rica","ederim","acaba",
  "çok","kısa","uzun","biraz","tane","adet","hızlı","yavaş",
  "yazar","yazarmısın","yazarmisin","yazabilir","yazabilirmisin","yaz","yazsan",
  "söyler","söylermisin","anlatır","anlatırmısın","gösterir","gösterirmisin",
  "yapar","yaparmısın","verir","verirmisin","olur","olurmu","mısın","misin",
]);

export const RAG_STOP_ASCII = new Set(
  [...RAG_STOP].map(s => s
    .replace(/ç/g,"c").replace(/ı/g,"i").replace(/ş/g,"s")
    .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ö/g,"o"))
);

export const TR_SUFFIXES = [
  "lerin","ların","leri","ları","deki","daki","teki","taki",
  "den","dan","ten","tan","nin","nın","nun","nün","ler","lar",
  "in","ın","un","ün","de","da","te","ta","ye","ya","yi","yı",
  "yu","yü","e","a","i","ı","u","ü",
];

export function stripTurkishSuffix(tok) {
  if (!tok || tok.length < 6) return null;
  for (const s of TR_SUFFIXES) {
    if (tok.length - s.length >= 4 && tok.endsWith(s)) return tok.slice(0, -s.length);
  }
  return null;
}

export function extractQueryTerms(query) {
  const raw = String(query || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .split(/\s+/);
  const out = new Set();
  for (const t of raw) {
    if (!t || t.length < 2) continue;
    const ascii = t.replace(/ç/g,"c").replace(/ı/g,"i").replace(/ş/g,"s")
                   .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ö/g,"o");
    if (RAG_STOP.has(t) || RAG_STOP_ASCII.has(ascii)) continue;
    out.add(t);
    const stem = stripTurkishSuffix(t);
    if (stem && stem.length >= 4 && !RAG_STOP.has(stem)) {
      if (process.env.RAG_DEBUG_STEM === "1") console.debug(`[STEM] ${t} → ${stem}`);
      out.add(stem);
    }
  }
  return [...out];
}

export function metaTokenSet(row) {
  const pathTail = String(row.path || "").split("/").filter(Boolean).slice(-2).join(" ");
  const raw = `${row.brand || ""} ${pathTail}`.toLowerCase();
  const set = new Set();
  for (const t of raw.split(/[^a-z0-9.]+/).filter(Boolean)) {
    if (t.length >= 2) set.add(t);
  }
  return set;
}

export function vendorBoost(row, qTerms) {
  if (!qTerms || !qTerms.length) return 1;
  const meta = metaTokenSet(row);
  if (meta.size === 0) return 1;
  let hits = 0;
  for (const t of qTerms) {
    if (t.length < 2) continue;
    if (meta.has(t)) hits++;
  }
  return 1 + Math.min(0.30, hits * 0.10);
}

export function rrfFuse(legs, { k = 60, query = "" } = {}) {
  const qTerms = extractQueryTerms(query);
  const totalTerms = qTerms.length || 1;
  function coverageOf(row) {
    if (!qTerms.length) return 0;
    const contentHay = String(row.content || "").toLowerCase();
    const metaTokens = metaTokenSet(row);
    let contentHits = 0;
    let metaHits = 0;
    for (const t of qTerms) {
      if (contentHay.includes(t)) { contentHits++; continue; }
      if (metaTokens.has(t)) metaHits++;
    }
    const contentCov = contentHits / totalTerms;
    const metaCov = (metaHits / totalTerms) * 0.5;
    return Math.max(contentCov, metaCov);
  }
  const scoreMap = new Map();
  for (const leg of legs) {
    leg.rows.forEach((row, idx) => {
      const id = row.id;
      if (id == null) return;
      const add = 1 / (k + idx + 1);
      const cur = scoreMap.get(id);
      if (cur) { cur.rrf += add; }
      else     { scoreMap.set(id, { row, rrf: add }); }
    });
  }
  return [...scoreMap.values()]
    .map(({ row, rrf }) => {
      const coverage = coverageOf(row);
      const vb = vendorBoost(row, qTerms);
      const fused = rrf * (0.5 + 0.5 * coverage) * vb;
      return {
        ...row,
        score: row.score ?? rrf,
        rrf,
        coverage: Number(coverage.toFixed(3)),
        vendor_boost: Number(vb.toFixed(3)),
        fused: Number(fused.toFixed(6)),
        queryTerms: qTerms.length,
      };
    })
    .sort((a, b) => b.fused - a.fused);
}

export function computeConfidence({ top1, top4, sourceCount }) {
  const t1 = Math.max(0, Math.min(1, Number(top1) || 0));
  const t4 = Math.max(0, Math.min(1, Number(top4) || 0));
  const gap = Math.max(0, t1 - t4);
  const sc  = Math.max(0, Number(sourceCount) || 0);
  const score = Math.round(100 * (0.5 * t1 + 0.3 * Math.min(gap * 5, 1) + 0.2 * Math.min(sc / 3, 1)));
  const label = score >= 70 ? "high" : (score >= 40 ? "mid" : "low");
  return { score, label, signals: { topScore: Number(t1.toFixed(3)), topGap: Number(gap.toFixed(3)), sourceCount: sc } };
}

// makeThinkStripper depends on ragSettings.stripThinkBlocks at create-time.
// Call once per request after RAG_SETTINGS is resolved.
export function makeThinkStripper(ragSettings) {
  if (ragSettings?.stripThinkBlocks === false) return (d) => d;
  let inside = false;
  let gemmaThought = false;
  let carry = "";
  const OPEN = "<think>"; const CLOSE = "</think>";
  const G_CH_OPEN = "<|channel>";
  const G_THOUGHT = "<|channel>thought";
  const G_CH_CLOSE = "<channel|>";
  const PARTIALS = [OPEN, G_CH_OPEN, G_CH_CLOSE];
  const splitCarry = (tail) => {
    for (let k = Math.min(32, tail.length); k >= 1; k -= 1) {
      const suffix = tail.slice(tail.length - k);
      if (PARTIALS.some((p) => p.startsWith(suffix))) return [tail.slice(0, tail.length - k), suffix];
    }
    return [tail, ""];
  };
  return (delta) => {
    if (!delta) return "";
    let s = carry + String(delta); carry = "";
    let out = ""; let i = 0;
    while (i < s.length) {
      if (inside) {
        const idx = s.indexOf(CLOSE, i);
        if (idx === -1) {
          const tail = s.slice(i);
          let cut = tail.length;
          for (let k = 1; k <= Math.min(CLOSE.length - 1, tail.length); k++) {
            if (CLOSE.startsWith(tail.slice(tail.length - k))) { cut = tail.length - k; break; }
          }
          carry = tail.slice(cut); return out;
        }
        i = idx + CLOSE.length; inside = false;
        continue;
      }
      if (gemmaThought) {
        const idx = s.indexOf(G_CH_CLOSE, i);
        if (idx === -1) {
          const tail = s.slice(i);
          let cut = tail.length;
          for (let k = 1; k <= Math.min(G_CH_CLOSE.length - 1, tail.length); k++) {
            if (G_CH_CLOSE.startsWith(tail.slice(tail.length - k))) { cut = tail.length - k; break; }
          }
          carry = tail.slice(cut); return out;
        }
        i = idx + G_CH_CLOSE.length; gemmaThought = false;
        continue;
      }
      if (s.startsWith(OPEN, i)) { i += OPEN.length; inside = true; continue; }
      if (s.startsWith(G_THOUGHT, i)) {
        const nl = s.indexOf("\n", i + G_THOUGHT.length);
        if (nl === -1) { carry = s.slice(i); return out; }
        i = nl + 1; gemmaThought = true; continue;
      }
      if (s.startsWith(G_CH_OPEN, i)) {
        const nl = s.indexOf("\n", i + G_CH_OPEN.length);
        if (nl === -1) { carry = s.slice(i); return out; }
        i = nl + 1; continue;
      }
      if (s.startsWith(G_CH_CLOSE, i)) { i += G_CH_CLOSE.length; continue; }
      const nextOpen = s.indexOf(OPEN, i);
      const nextChan = s.indexOf(G_CH_OPEN, i);
      const nextClose = s.indexOf(G_CH_CLOSE, i);
      const nexts = [nextOpen, nextChan, nextClose].filter((x) => x >= 0);
      const nextIdx = nexts.length ? Math.min(...nexts) : -1;
      if (nextIdx >= 0) {
        out += s.slice(i, nextIdx);
        i = nextIdx;
        continue;
      }
      const [emit, keep] = splitCarry(s.slice(i));
      out += emit; carry = keep; return out;
      }
    return out;
  };
}
