// Intent classifier — extracted from server.mjs Tur B (2026-05-30).
// Pure module: static imports from sibling lib modules + init({deps}) DI for
// stateful refs (pool, pushLog, RAG_SETTINGS, mlxEmbed, _currentModelRender, cosine).
//
// Exports:
//   RUNTIME_INTENT_CFG, DEFAULT_CLASSIFIER_PROMPT, INTENT_ANCHORS
//   clampThreshold, clampSemanticThreshold
//   ensureAnchorVecs, semanticIntentGate, llmIntentClassify, refineIntentSemantically
//   scoreTechnicalSignal, classifyIntent
//   hydrateIntentConfigFromDb, initIntentClassifier, scheduleIntentHydrate

import { toCompletionBody } from "../chat-prompt.mjs";
import {
  RAG_STOP as _RAG_STOP,
  RAG_STOP_ASCII as _RAG_STOP_ASCII,
  extractQueryTerms,
} from "./scoring.mjs";
import {
  hydrateRuntimeProviderFromDb,
  runtimeIsLocal,
  runtimeUpstreamBase,
  runtimeBase,
  joinRuntimePath,
  normalizeRuntimeBaseUrl,
  runtimeFetchError,
  RUNTIME_PROVIDER_CFG,
  mlxServingId as _mlxServingId,
  isPathLikeModelId as _isPathLikeModelId,
} from "../runtime-registry.mjs";

// ── Static config ─────────────────────────────────────────────────────────
export const DEFAULT_CLASSIFIER_PROMPT =
  "Classify the user message below. If it needs the Library/RAG (technical docs, network, security, " +
  "product/device configuration, error/log analysis, version, CVE, etc.), reply with a single word: RAG. " +
  "If the user is EXPLICITLY REQUESTING the system to create a NEW skill, tool, agent, or capability pack NOW, reply with a single word: FORGE. " +
  "FORGE is only for a direct creation request where the user wants a new artifact produced in this turn. " +
  "Descriptive status updates, future plans, permissions/authority discussions, celebrations, roadmap talk, or general chit-chat that merely mentions skill/tool/agent/pack/create are NOT FORGE — they are CHAT. " +
  "If the user asks about the assistant itself, its agents, team, tools, skills, capabilities, or identity, reply with a single word: META. " +
  "If it is a greeting, social small-talk, personal chit-chat, or a descriptive/declarative statement about capabilities, reply with a single word: CHAT. " +
  "Output only RAG, FORGE, META, or CHAT — nothing else.\n\n" +
  "Examples:\n" +
  "- \"phishing triage skill yaz\" → FORGE\n" +
  "- \"yeni bir tool oluştur, whois sorgulasın\" → FORGE\n" +
  "- \"bunu yapan bir agent tasarla\" → FORGE\n" +
  "- \"DFIR için capability pack öner\" → FORGE\n" +
  "- \"design a tool for pcap analysis\" → FORGE\n" +
  "- \"draft an agent that triages alerts\" → FORGE\n" +
  "- \"bugün artık kendi ajan, tool ve skill'lerini create edebilecek yetkilere kavuştun\" → CHAT\n" +
  "- \"MCP server ve client connectivity sağlayabileceğiz, feature ekledik\" → CHAT\n" +
  "- \"harika, artık kendi tool'larını yazabiliyorsun\" → CHAT\n" +
  "- \"you can now create your own agents\" → CHAT\n" +
  "- \"Sana daha geniş yetkiler vereceğiz, az kaldı bu yazılım oturacak\" → CHAT\n" +
  "- \"yazılımı geliştiriyoruz, sana daha geniş yetkiler vereceğiz\" → CHAT\n" +
  "- \"Firewall 7.4 IPsec site-to-site nasıl kurulur\" → RAG\n" +
  "- \"Checkpoint R81 SmartConsole log analizi\" → RAG\n" +
  "- \"hangi ajanların var\" → META\n" +
  "- \"selam nasılsın\" → CHAT";




const LEGACY_CLASSIFIER_PROMPT_NO_FORGE =
  "Classify the user message below. If it needs the Library/RAG (technical docs, network, security, " +
  "product/device configuration, error/log analysis, version, CVE, etc.), reply with a single word: RAG. " +
  "If the user asks about the assistant itself, its agents, team, tools, skills, capabilities, or identity, reply with a single word: META. " +
  "If it is a greeting, social small-talk, or personal chit-chat, reply with a single word: CHAT. " +
  "Output only RAG, META, or CHAT — nothing else.";

export const RUNTIME_INTENT_CFG = {
  technicalThreshold: Number(process.env.INTENT_TECHNICAL_THRESHOLD ?? 0.5),
  forceRagMode: String(process.env.INTENT_FORCE_RAG_MODE ?? "auto"),
  semanticThreshold: Number(process.env.INTENT_SEMANTIC_THRESHOLD ?? 0.35),
  classifierMode: String(process.env.INTENT_CLASSIFIER_MODE ?? "hybrid"),
  classifierPrompt: String(process.env.INTENT_CLASSIFIER_PROMPT ?? DEFAULT_CLASSIFIER_PROMPT),
};

export const INTENT_ANCHORS = {
  rag: "Teknik döküman, kütüphane sorgusu, network güvenlik cihaz konfigürasyonu, firewall, WAF (Web Application Firewall), CDN, load balancer, ADC, reverse proxy, IDS/IPS, DDoS koruma, VPN, SSL VPN, DNS, authentication, RADIUS, LDAP, syslog, NAT, routing, BGP, OSPF, HA cluster, hotfix, CVE, hata mesajı, log analizi, packet capture, komut çıktısı, CLI, API, REST, kullanıcı yaratma, kural ekleme, policy, troubleshooting. Örnek sorular: 'Firewall HA cluster nasıl kurulur?', 'WAF rule nasıl yazılır?', 'SSL profile konfigürasyonu', 'Threat log troubleshooting'.",
  smalltalk: "Selam, merhaba, naber, nasılsın, ne haber, iyi misin, ne yapıyorsun, günaydın, iyi günler, iyi akşamlar, kolay gelsin, teşekkürler, sağol, görüşürüz, hoşçakal, kısa sosyal sohbet, kişisel selamlaşma, hatır sorma, gündelik chit-chat. Teknik içerik YOK, ürün/cihaz/komut/sürüm/hata sözü geçmez.",
  meta: "Asistanın kendisi, kimliği, yetenekleri, sistemi hakkında soru. Örnekler: 'sen kimsin', 'kendinden bahset', 'sen nesin', 'adın ne', 'hangi modeli kullanıyorsun', 'hangi versiyondasın', 'kim tarafından yapıldın', 'seni kim yarattı', 'ne yapabilirsin', 'yeteneklerin neler', 'neler biliyorsun', 'hangi araçlara sahipsin', 'hangi tool var', 'hangi skill var', 'uzmanlık alanların neler', 'who are you', 'what are you', 'introduce yourself', 'tell me about yourself', 'what can you do', 'which model are you', 'what tools do you have', 'what are your specialties'. Belirli bir teknik konu/cihaz/marka SORULMUYOR, soru asistanın kendisine ya da yeteneklerine yönelik.",
  agent_manifest: "Kullanıcı asistanın ajan/agent kadrosunu, ekibini, squad'ını, takımını görmek/öğrenmek istiyor. Cevap olarak tüm ajanların adı ve görevi tek tek listelenmeli, squad özeti değil. Örnekler: 'ajanlarını tanıt', 'ajanlarını detaylı tanıt', 'ajanlarını detaylı şekilde tanıtabilir misin', 'ajanlarını anlat', 'ajanlarını açıkla', 'ajanlarını listele', 'ajanlarını say', 'ajan ordunu say', 'kaç ajanın var', 'hangi ajanların var', 'ajanların kimler', 'ekibinde kimler var', 'ekibini tanıt', 'ekibini anlat', 'ekibindeki kişileri sırala', 'takımın kim', 'takımını tanıt', 'squad'larını anlat', 'squad'larındaki üyeleri say', 'hangi squad'lar var', 'bana ajanlarını anlat', 'kim ne iş yapıyor', 'her ajan ne yapıyor', 'ajanlarının görev tanımları neler', 'introduce your agents', 'list your agents', 'describe your agents', 'walk me through your agents', 'walk me through your squad', 'who are your agents', 'how many agents do you have', 'tell me about your team', 'give me the full agent roster', 'overview of your agents', 'show me every agent'. Soru asistanın kim olduğunu değil, KADROSUNU sorar; cevap manifest'ten deterministik gelmeli.",
  meta_forge: "Kullanıcı bu turda sisteme YENİ bir artifact ürettirmek istiyor: skill, tool, agent veya capability pack. Odak mevcut yetenekleri konuşmak, gelecekte verilecek izinleri anlatmak, roadmap/statü paylaşmak ya da asistanın neler yapabileceğini sormak değil; doğrudan yeni bir parça oluşturma talebi. Pozitif örnekler: 'phishing triage skill yaz', 'whois sorgulayan bir tool oluştur', 'DFIR incident responder agent tasarla', 'log parser pack üret', 'threat-hunt skill hazırla', 'pcap analiz toolu oluştur', 'CVE lookup skill ekle kadroya', 'MITRE ATT&CK mapping agent tasarla', 'malware sandbox tool draftla', 'SOAR playbook agentı oluştur', 'brute-force detection skill yaz', 'DNS tunneling detection tool üret', 'YARA rule generator skill hazırla', 'threat-intel enrichment pack öner', 'compliance audit agent tasarla', 'firewall rule reviewer skill yaz', 'anomaly detection agent ekle', 'kadroya OSINT recon agent ekle', 'vulnerability scanner tool forge et', 'endpoint response skill üret', 'design a phishing triage skill', 'build me a SIEM detection tool', 'draft a DFIR agent', 'create a log parser pack', 'craft me a capability pack'. Bu anchor yalnızca aday üretir; Meta-Forge açılması için LLM adjudicator ayrıca FORGE demelidir.",
};

function _normMetaText(s) {
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

export function isAssistantMetaQuestion(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const t = ` ${_normMetaText(raw).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (!t.trim()) return false;
  // FORGE-BYPASS 2026-07-06: creation/build verbs are Meta-Forge signals, not
  // meta-questions about the assistant. Without this guard, "Elara, yeni tool
  // yap: X" is short-circuited to smalltalk/semantic-meta and the semantic
  // classifier + LLM adjudicator never see the request. Verbs are aligned
  // with the meta_forge anchor prose above.
  const hasCreationVerb = /\b(?:yap|yapabilir|yapar|olustur|olusturur|yaz|yazar|uret|uretir|ekle|ekler|tasarla|tasarlar|hazirla|hazirlar|draftla|forge|forgele|create|creates|build|builds|design|designs|draft|drafts|craft|crafts|generate|generates|make|makes|add|adds)\b/.test(t);
  if (hasCreationVerb) return false;
  const aboutAssistant = /\b(?:elara|sen|sana|seni|senin|your|you|yourself)\b/.test(t)
    || /\b(?:ajanlarin|ajanlarini|ajanlariniz|ajanlarinizi|ekibin|ekibini|takimin|takimini|yeteneklerin|yeteneklerini)\b/.test(t)
    || /\b(?:your agents|your team|your tools|your skills|your capabilities)\b/.test(t);
  if (!aboutAssistant) return false;
  return /\b(?:ajan|ajanlar|agent|agents|ekip|takim|team|squad|tool|tools|skill|skills|yetenek|capabilities|kendini|listele|anlat|describe|introduce|list|what can you do|about yourself)\b/.test(t)
    || /\b(?:tanit|tanita|tanimla|sirala|say|describe|introduce|list)[a-z]*\b/.test(t)
    || /\b(?:kimsin|nesin|ne yapabilirsin|who are you|what are you|who made you|who created you|who built you)\b/.test(t);
}

// Meta-forge lane detection — semantic confirmation (2026-07-04):
//   (1) Semantic anchor similarity may only mark a Meta-Forge CANDIDATE.
//   (2) The LLM classifier must explicitly return FORGE for that candidate.
//   (3) Timeout / ambiguity / LLM-only FORGE without an anchor candidate fails
//       closed to normal chat/RAG. No regex suppressor, blacklist, or keyword
//       pre-gate participates in the Meta-Forge decision.



export function clampThreshold(v) { v = Number(v); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5; }
export function clampSemanticThreshold(v) { v = Number(v); return Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : 0.35; }

// ── DI ───────────────────────────────────────────────────────────────────
let _pool = null;
let _pushLog = (..._a) => {};
let _mlxEmbed = async () => null;
let _currentModelRender = async () => ({});
let _cosine = (_a, _b) => 0;
let _getRagSettings = () => ({});

export function initIntentClassifier(deps) {
  if (deps?.pool) _pool = deps.pool;
  if (typeof deps?.pushLog === "function") _pushLog = deps.pushLog;
  if (typeof deps?.mlxEmbed === "function") _mlxEmbed = deps.mlxEmbed;
  if (typeof deps?.currentModelRender === "function") _currentModelRender = deps.currentModelRender;
  if (typeof deps?.cosine === "function") _cosine = deps.cosine;
  if (typeof deps?.getRagSettings === "function") _getRagSettings = deps.getRagSettings;
}

// ── Anchor cache ─────────────────────────────────────────────────────────
let _anchorVecs = null;
let _anchorVecsPromise = null;
let _anchorsReady = false; // true once embed worker successfully returned anchor vecs
let _lastClassifySuccessAt = 0; // last time refineIntentSemantically reached a decision
// PROBE-2026-06-03: lastAnchorInitMs is the wall-clock ms spent on the
// one-time anchor embed; reused across decisions. Surfaced via gate result so
// the chat trace can show why a cold turn falls back to length-heuristic.
let _lastAnchorInitMs = 0;

// TELEMETRY-2026-07-03 (Tur 4): rolling counters for cold-classifier
// diagnostics + Meta-Forge lane retry outcomes. Read-only; exposed via
// /api/rag/intent-telemetry and consumed by the RAG panel telemetry chip.
const _tel = {
  decisions: 0,          // total refineIntentSemantically successful decisions
  coldDecisions: 0,      // decisions where classifierWarm === false at gate time
  warmDecisions: 0,      // decisions where classifierWarm === true
  nullDecisions: 0,      // early returns (no anchor / timeout / empty)
  forgeDecisions: 0,     // decisions where subKind === "meta_forge"
  forgeRetryRecovered: 0,// chat-orchestrate cold safety-net retry that flipped null → meta_forge
  forgeRetryNoop: 0,     // retry ran but subKind still empty
  forgeRetryError: 0,    // retry threw
  lastForgeAt: 0,        // ms epoch of the last meta_forge decision (any path)
  lastReason: null,      // last intentClassifyReason (string)
};

export function getIntentClassifierProbe() {
  return {
    anchorsReady: _anchorsReady,
    lastClassifySuccessAt: _lastClassifySuccessAt,
    lastAnchorInitMs: _lastAnchorInitMs,
    telemetry: { ..._tel },
  };
}

// Called from chat-orchestrate.mjs safety-net retry block so counters live
// alongside the classifier state instead of being scattered across routes.
export function recordForgeRetry(kind) {
  if (kind === "recovered") _tel.forgeRetryRecovered += 1;
  else if (kind === "noop") _tel.forgeRetryNoop += 1;
  else if (kind === "error") _tel.forgeRetryError += 1;
  if (kind === "recovered") { _tel.lastForgeAt = Date.now(); _tel.forgeDecisions += 1; }
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureAnchorVecs() {
  if (_anchorVecs) return _anchorVecs;
  if (_anchorVecsPromise) return _anchorVecsPromise;
  _anchorVecsPromise = (async () => {
    const t0 = Date.now();
    const anchorsInput = [
      INTENT_ANCHORS.rag,
      INTENT_ANCHORS.smalltalk,
      INTENT_ANCHORS.meta,
      INTENT_ANCHORS.agent_manifest,
      INTENT_ANCHORS.meta_forge,
    ];
    let vecs = null;
    let lastErr = null;
    try {
      vecs = await _mlxEmbed(anchorsInput).catch((e) => { lastErr = e; return null; });
    } catch (e) {
      lastErr = e;
      vecs = null;
    }
    if (vecs && vecs.length >= anchorsInput.length && anchorsInput.every((_, i) => vecs[i]?.length)) {
      _anchorVecs = {
        rag: vecs[0],
        smalltalk: vecs[1],
        meta: vecs[2],
        agent_manifest: vecs[3],
        meta_forge: vecs[4],
      };
      _anchorsReady = true;
    }
    _lastAnchorInitMs = Date.now() - t0;
    return _anchorVecs;
  })();
  try { return await _anchorVecsPromise; } finally { _anchorVecsPromise = null; }
}

// ── Semantic gate ────────────────────────────────────────────────────────
export async function semanticIntentGate(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const tAnchor0 = Date.now();
  const anchors = await ensureAnchorVecs();
  const anchorWaitMs = Date.now() - tAnchor0;
  if (!anchors) return { _probe: { anchorWaitMs, qEmbedMs: 0, anchorFailed: true } };
  const tEmbed0 = Date.now();
  const qVecArr = await _mlxEmbed([t]).catch(() => null);
  const qEmbedMs = Date.now() - tEmbed0;
  const qv = qVecArr && qVecArr[0];
  if (!qv?.length) return { _probe: { anchorWaitMs, qEmbedMs, queryEmbedFailed: true } };
  const ragSim = _cosine(qv, anchors.rag);
  const smallSim = _cosine(qv, anchors.smalltalk);
  const metaSim = anchors.meta ? _cosine(qv, anchors.meta) : 0;
  const agentManifestSim = anchors.agent_manifest ? _cosine(qv, anchors.agent_manifest) : 0;
  const metaForgeSim = anchors.meta_forge ? _cosine(qv, anchors.meta_forge) : 0;
  return { ragSim, smallSim, metaSim, agentManifestSim, metaForgeSim, _probe: { anchorWaitMs, qEmbedMs } };
}

// ── LLM classifier ───────────────────────────────────────────────────────
export async function llmIntentClassify(text, cfg = RUNTIME_INTENT_CFG) {
  if (!_pool) return null;
  await hydrateRuntimeProviderFromDb({ quiet: true });
  let row = null;
  try {
    const r = await _pool.query("SELECT * FROM models WHERE is_default=true ORDER BY updated_at DESC LIMIT 1");
    row = r.rows[0] ?? null;
  } catch { /* legacy fallback below */ }
  const provider = String(row?.provider ?? RUNTIME_PROVIDER_CFG.provider ?? "");
  const base = normalizeRuntimeBaseUrl(row?.base_url || runtimeBase() || "");
  const mdl = _mlxServingId(row, { assert: false });
  const bound = !!String(row?.runtime_model_id ?? "").trim();
  if (!mdl || (!bound && _isPathLikeModelId(mdl))) return null;
  if (!base || !mdl) return null;
  const prompt = `${cfg.classifierPrompt || DEFAULT_CLASSIFIER_PROMPT}\n\nMesaj: """${String(text).slice(0, 600)}"""\nCevap:`;
  try {
    const isMlx = runtimeIsLocal(base, provider);
    const upstream = runtimeUpstreamBase(base, provider);
    const target = isMlx ? joinRuntimePath(upstream, "/v1/completions") : joinRuntimePath(upstream, "/api/generate");
    const chatBody = { model: mdl, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 4, temperature: 0 };
    const render = await _currentModelRender();
    const body = isMlx
      ? toCompletionBody(chatBody, render)
      : { model: mdl, prompt, stream: false, options: { temperature: 0, num_predict: 4 } };
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3500),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const out = String(
      isMlx ? (j?.choices?.[0]?.text || j?.choices?.[0]?.message?.content || "") : (j?.response || "")
    ).trim().toUpperCase();
    if (out.startsWith("RAG")) return "rag";
    if (out.startsWith("FORGE") || out.startsWith("META_FORGE") || out.startsWith("META-FORGE")) return "meta_forge";
    if (out.startsWith("META")) return "meta";
    if (out.startsWith("SOHBET") || out.startsWith("CHAT") || out.startsWith("SMALL")) return "smalltalk";
    return null;
  } catch (e) {
    _pushLog("server", runtimeFetchError(e, { provider: runtimeIsLocal(base, provider) ? "MLX" : "Legacy HTTP", publicBase: base, upstreamBase: runtimeUpstreamBase(base, provider), model: mdl, phase: "intent" }));
    return null;
  }
}

// ── Decide-once refine ───────────────────────────────────────────────────
export async function refineIntentSemantically(text, base, cfg = RUNTIME_INTENT_CFG) {
  const out = { ...base };
  if (!text || cfg.forceRagMode === "always" || cfg.forceRagMode === "never") return out;
  // Explicit invocation override — @[foo.py] / !slug / /slug.
  if (/(^|\s)@\[[^\]]+\.py\s*\]/i.test(text)
      || /(^|\s)![a-z0-9][a-z0-9_-]{1,}/i.test(text)
      || /(^|\s)\/[a-z0-9][a-z0-9_-]{1,}/i.test(text)) {
    out.kind = "query"; out.useRag = true; out.mode = "explicit-invocation";
    return out;
  }
  if (isAssistantMetaQuestion(text)) {
    out.kind = "smalltalk"; out.useRag = false; out.mode = "semantic-meta";
    out.intentClassifyReason = "assistant_meta_text";
    return out;
  }

  // Fast-path: If input is only conversational greetings/stop words, immediately return smalltalk (0ms)
  const queryTerms = extractQueryTerms(text);
  if (queryTerms.length === 0) {
    out.kind = "smalltalk";
    out.useRag = false;
    out.mode = "fast-greeting";
    out.intentClassifyReason = "greeting_stop_terms";
    return out;
  }
  // Meta-forge deterministic keyword gate REMOVED (Tur 6B, 2026-07-04).
  // Semantic anchor similarity + LLM adjudication + orchestrate safety-net
  // retry combo (see chat-orchestrate.mjs `meta_forge.lane.retry_*`) is now
  // stable across 4/4 cold+warm turns. Rule "HER ŞEY DİNAMİK" respected.




  // Cold-aware elastik budget: embed worker / MLX henüz "warm" değilse
  // sınıflandırıcıya daha uzun süre tanı. Warm hatta bedavası 900ms kalır.
  const RAG_SETTINGS_NOW = _getRagSettings() || {};
  // Warm budget bumped 900→1800ms (C-plan 2026-07-03) so LLM adjudication
  // on rag-classified turns has room to complete without timing out.
  const warmBudgetMs = Math.max(0, Number(process.env.INTENT_ROUTER_BUDGET_MS ?? 1800));
  const coldBudgetMs = Math.max(warmBudgetMs, Number(RAG_SETTINGS_NOW.warmupIntentBudgetMs ?? 3500));
  const classifierWarm = _anchorsReady && (Date.now() - _lastClassifySuccessAt) < 60_000;
  const budgetMs = classifierWarm ? warmBudgetMs : coldBudgetMs;
  const deadline = (p, fallback = null) => budgetMs > 0
    ? Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(fallback), budgetMs))])
    : p;
  const mode = cfg.classifierMode || "hybrid";
  const threshold = clampSemanticThreshold(cfg.semanticThreshold);
  let decision = null;
  let ragSim = null, smallSim = null, metaSim = null, agentManifestSim = null, metaForgeSim = null;
  let reason = "stop_no_match";
  const metaEnabled = RAG_SETTINGS_NOW.intentMetaCategoryEnabled !== false;
  let probeInfo = null;
  if (mode === "embedding" || mode === "hybrid") {
    const sim = await deadline(semanticIntentGate(text), null);
    if (sim && typeof sim.ragSim === "number") {
      ragSim = sim.ragSim; smallSim = sim.smallSim; metaSim = sim.metaSim ?? 0;
      agentManifestSim = typeof sim.agentManifestSim === "number" ? sim.agentManifestSim : 0;
      metaForgeSim = typeof sim.metaForgeSim === "number" ? sim.metaForgeSim : 0;
      probeInfo = sim._probe || null;
      const trimmedLen = (text || "").trim().length;
      const mixedRatio  = Math.min(1, Math.max(0.50, Number(RAG_SETTINGS_NOW?.mixedPromoteRatio  ?? 0.92)));
      const mixedMinLen = Math.max(1, Math.floor(Number(RAG_SETTINGS_NOW?.mixedPromoteMinLen ?? 15)));
      const mixedPromote = sim.ragSim >= sim.smallSim * mixedRatio && trimmedLen >= mixedMinLen;
      // 3-way: meta queries often contain "agent/team/tool" words that can sit
      // close to RAG/tooling space. Keep this lane narrow: only allow a meta
      // promotion when the cheap/base classifier already sees a short chatty
      // turn. Long task/automation requests can otherwise be misread as
      // "assistant capabilities" and get pushed into smalltalk, which sends a
      // huge manifest prompt to MLX instead of the normal query/agent path.
      const metaPromoteRatio = Math.min(1, Math.max(0.50, Number(RAG_SETTINGS_NOW?.metaPromoteRatio ?? 0.90)));
      const baseKind = String(base?.kind || "").toLowerCase();
      const metaEligible = baseKind === "smalltalk" || baseKind === "meta";
      const metaWins = metaEnabled
        && metaEligible
        && metaSim >= threshold
        && metaSim >= sim.ragSim * metaPromoteRatio
        && metaSim >= sim.smallSim * metaPromoteRatio;
      if (metaWins) decision = "meta";
      else if (sim.ragSim < threshold && sim.ragSim < sim.smallSim && !mixedPromote) decision = "smalltalk";
      else if ((sim.ragSim >= threshold && sim.ragSim > sim.smallSim) || mixedPromote) decision = "rag";
      else decision = "smalltalk";
    } else if (sim && sim._probe) {
      // Embed worker ran but no usable vectors — keep probe for telemetry.
      probeInfo = sim._probe;
      reason = sim._probe.anchorFailed ? "anchor_embed_failed" : sim._probe.queryEmbedFailed ? "query_embed_failed" : "embed_empty";
    } else {
      reason = "embed_timeout";
    }
  }
  const forgeProbeFloor = Math.min(1, Math.max(0.20, Number(RAG_SETTINGS_NOW.metaForgeIntentThreshold ?? 0.30)));
  const forgeProbeRatio = Math.min(1, Math.max(0.40, Number(RAG_SETTINGS_NOW.metaForgeIntentRatio ?? 0.55)));
  const forgeVsRagProbeRatio = Math.min(1, Math.max(0.40, Number(RAG_SETTINGS_NOW.metaForgeVsRagRatio ?? 0.50)));
  // C-plan (2026-07-03): absolute floor dropped — LLM adjudicates whenever
  // metaForgeSim is even soft-competitive with ragSim. Clean tech queries
  // (metaForgeSim ≪ ragSim) still skip the LLM call via the ratio guard, so
  // latency for pure RAG turns is preserved. forgeProbeFloor kept as knob for
  // ops but no longer part of the gate.
  void forgeProbeFloor;
  // 2026-07-05 — Model-declare gate: skip forge adjudication entirely when
  // the operator has switched to "model-declare" mode. In that mode the LLM
  // itself emits <forge> tags in its reply and the backend sniffs the stream
  // (see lib/meta-forge/tag-parser.mjs). Legacy "pre-classify" still runs the
  // semantic + LLM adjudicator; "off" disables Meta-Forge entirely.
  const forgeGateMode = String(RAG_SETTINGS_NOW.metaForgeGateMode || "pre-classify").toLowerCase();
  // 2026-07-06 — Adjudicate on BOTH "rag" and "smalltalk" decisions. Short
  // creation requests like "Elara, yeni tool yap: X" land as smalltalk on the
  // embedding gate (short + chatty salutation), so gating the adjudicator on
  // decision==="rag" starved the meta_forge lane. Semantic floor + ratio
  // guards still keep pure chit-chat out of the LLM call.
  const shouldAdjudicateForge = forgeGateMode === "pre-classify"
    && mode === "hybrid"
    && (decision === "rag" || decision === "smalltalk")
    && typeof metaForgeSim === "number"
    && metaForgeSim >= forgeProbeFloor
    && metaForgeSim >= (ragSim ?? 0) * forgeVsRagProbeRatio
    && metaForgeSim >= Math.max(metaSim ?? 0, smallSim ?? 0, agentManifestSim ?? 0) * forgeProbeRatio;

  if ((decision == null || shouldAdjudicateForge) && (mode === "llm" || mode === "hybrid")) {
    const tLlm = Date.now();
    const llm = await deadline(llmIntentClassify(text, cfg), null);
    const llmMs = Date.now() - tLlm;
    if (llm) {
      if (shouldAdjudicateForge) {
        if (llm === "meta_forge") {
          decision = "meta_forge";
          reason = "llm_forge_adjudicated";
        } else {
          reason = `llm_forge_adjudication_rejected:${llm}`;
        }
      } else {
        const llmMapped = llm === "meta_forge" ? "meta_forge" : (llm === "meta" ? "meta" : (llm === "rag" ? "rag" : "smalltalk"));
        // LLM-only FORGE is not enough. Meta-Forge requires a semantic
        // candidate plus LLM confirmation; otherwise fail closed to chat/RAG.
        if (llmMapped === "meta_forge") {
          decision = (ragSim ?? 0) >= (smallSim ?? 0) ? "rag" : "smalltalk";
          reason = "llm_forge_rejected_no_semantic_candidate";
        } else {
          decision = llmMapped;
        }
      }
    } else {
      reason = reason === "embed_timeout" ? "embed+llm_timeout" : (shouldAdjudicateForge ? "llm_forge_adjudication_timeout" : "llm_timeout");
    }
    try { console.log(`[classifier] LLM ${shouldAdjudicateForge ? "forge-adjudication" : "fallback"} ms=${llmMs} status=${llm ? "ok:" + llm : "timeout"} budget=${budgetMs} warm=${classifierWarm ? 1 : 0}`); } catch {}
  }

  // Stop-set fallback (semantic gate fail → pure-greeting tokens → smalltalk).
  if (decision == null) {
    const toks = String(text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(t => t && t.length >= 2);
    if (toks.length > 0 && toks.length <= 6) {
      const allStop = toks.every(t => {
        const ascii = t.replace(/ç/g,"c").replace(/ı/g,"i").replace(/ş/g,"s")
                       .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ö/g,"o");
        return _RAG_STOP.has(t) || _RAG_STOP_ASCII.has(ascii);
      });
      if (allStop) { decision = "smalltalk"; reason = "stop_set_match"; }
    }
  }
  // Deterministic fallback: when anchor embed is unavailable
  let coldFallback = false;
  if (decision == null) {
    const raw = String(text || "").trim();
    const terms = extractQueryTerms(raw);
    if (terms.length === 0) {
      decision = "smalltalk";
      coldFallback = true;
      reason = "fallback_no_terms";
    } else {
      decision = "rag";
      reason = "fallback_technical_terms";
    }
  }
  // PROBE-2026-06-03: surface budget/probe info even on null-decision path so
  // chat trace can show why we fell back to length-heuristic.
  out.intentBudgetMs = budgetMs;
  out.intentClassifierWarm = classifierWarm;
  out.intentClassifyReason = reason;
  if (probeInfo) {
    out.intentAnchorWaitMs = probeInfo.anchorWaitMs;
    out.intentQEmbedMs = probeInfo.qEmbedMs;
  }
  if (decision == null) {
    _tel.nullDecisions += 1;
    _tel.lastReason = reason;
    try { console.log(`[intent] decision=null reason=${reason} budgetMs=${budgetMs} warm=${classifierWarm} anchorWaitMs=${probeInfo?.anchorWaitMs ?? '-'} qEmbedMs=${probeInfo?.qEmbedMs ?? '-'} text="${String(text).slice(0,40).replace(/\n/g," ")}"`); } catch {}
    return out;
  }
  _lastClassifySuccessAt = Date.now();
  _tel.decisions += 1;
  _tel.lastReason = reason;
  if (classifierWarm) _tel.warmDecisions += 1; else _tel.coldDecisions += 1;
  if (decision === "meta_forge") { _tel.forgeDecisions += 1; _tel.lastForgeAt = Date.now(); }
  if (decision === "smalltalk") {
    out.kind = "smalltalk"; out.useRag = false;
    out.mode = coldFallback ? "cold-fallback" : "semantic-bypass";
  } else if (decision === "meta") {
    // Meta = asistanın kendisi hakkında soru. RAG bağlamı YOK,
    // disableThinkOnSmalltalk burada da geçerli olsun diye kind=smalltalk.
    // Mode="semantic-meta" → UI/log ayırt edebilir; agent bridge kapalı kalır.
    out.kind = "smalltalk"; out.useRag = false; out.mode = "semantic-meta";
  } else if (decision === "meta_forge") {
    out.kind = "query"; out.useRag = false; out.mode = "llm-meta-forge"; out.subKind = "meta_forge";
  } else {
    out.kind = "query"; out.useRag = true; out.mode = "semantic-rag";
  }
  if (ragSim != null) { out.ragSim = ragSim; out.smallSim = smallSim; out.metaSim = metaSim; out.semanticThreshold = threshold; }
  if (agentManifestSim != null) out.agentManifestSim = agentManifestSim;
  if (metaForgeSim != null) out.metaForgeSim = metaForgeSim;
  out.classifierWarm = classifierWarm;
  out.classifyReason = reason;
  // Agent-manifest subKind — semantic (embedding-anchor) detection, no regex.
  // Trigger deterministic meta lane when the query is close to the agent-
  // manifest anchor (kadro sorusu) rather than the general meta anchor
  // (asistan kimliği). Threshold configurable via RAG_SETTINGS.
  if (agentManifestSim != null && (decision === "meta" || decision === "smalltalk" || decision === "rag")) {
    const manifestThr = Math.min(1, Math.max(0.30, Number(RAG_SETTINGS_NOW.agentManifestIntentThreshold ?? 0.55)));
    const manifestRatio = Math.min(1, Math.max(0.50, Number(RAG_SETTINGS_NOW.agentManifestIntentRatio ?? 0.95)));
    // Must clear absolute floor AND dominate the other anchors by ratio so a
    // generic "sen kimsin" (high metaSim, low agentManifestSim) does not flip.
    const dominates =
      agentManifestSim >= (metaSim ?? 0) * manifestRatio &&
      agentManifestSim >= (ragSim ?? 0) * manifestRatio &&
      agentManifestSim >= (smallSim ?? 0) * manifestRatio;
    if (agentManifestSim >= manifestThr && dominates) {
      out.subKind = "agent_manifest";
      // Force meta lane regardless of the primary decision — we want the
      // deterministic manifest render, not the LLM's summarization.
      out.kind = "smalltalk"; out.useRag = false; out.mode = "semantic-meta";
      try { console.log(`[intent] agent_manifest subKind · manifestSim=${agentManifestSim.toFixed(3)} metaSim=${(metaSim ?? 0).toFixed(3)} ragSim=${(ragSim ?? 0).toFixed(3)} text="${String(text).slice(0,40).replace(/\n/g," ")}"`); } catch {}
    }
  }
  // Meta-Forge subKind is set only above when a semantic candidate is confirmed
  // by the LLM adjudicator. Do not add semantic-only upgrades here; that path
  // caused normal chat mentioning tools/skills/agents to open the planner.

  if (decision === "meta_forge") {
    try { console.log(`[intent] meta_forge subKind · llm_fallback text="${String(text).slice(0,40).replace(/\n/g," " )}"`); } catch {}
  }

  if (coldFallback) {
    try { console.log(`[intent] cold-fallback → smalltalk · budgetMs=${budgetMs} warm=${classifierWarm} text="${String(text).slice(0,40).replace(/\n/g," ")}"`); } catch {}
  }
  if (decision === "meta") {
    try { console.log(`[intent] meta → smalltalk-lane · metaSim=${metaSim?.toFixed(3)} ragSim=${ragSim?.toFixed(3)} smallSim=${smallSim?.toFixed(3)} text="${String(text).slice(0,40).replace(/\n/g," ")}"`); } catch {}
  }
  return out;
}

// ── Length-heuristic ─────────────────────────────────────────────────────
export function scoreTechnicalSignal(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  let s = 0;
  if (t.length > 60) s += 0.15;
  if (t.length > 160) s += 0.20;
  if (t.length <= 12) s -= 0.25;
  return Math.max(0, Math.min(1, 0.3 + s));
}

export function classifyIntent(q, cfg = RUNTIME_INTENT_CFG) {
  const text = String(q || "").trim();
  if (!text) return { kind: "empty", useRag: false, score: 0, mode: cfg.forceRagMode };
  if (cfg.forceRagMode === "always") return { kind: "query", useRag: true, score: 1, mode: "always" };
  if (cfg.forceRagMode === "never")  return { kind: "smalltalk", useRag: false, score: 0, mode: "never" };
  if (isAssistantMetaQuestion(text)) return { kind: "smalltalk", useRag: false, score: 0, mode: "semantic-meta", classifyReason: "assistant_meta_text" };
  const terms = extractQueryTerms(text);
  if (terms.length === 0) {
    return { kind: "smalltalk", useRag: false, score: 0, mode: "fast-greeting", classifyReason: "no_meaningful_terms" };
  }
  const score = scoreTechnicalSignal(text);
  const threshold = clampThreshold(cfg.technicalThreshold);
  const obviousChitchat = text.length <= 8 && score < threshold * 0.6;
  const kind = obviousChitchat ? "smalltalk" : "query";
  return { kind, useRag: kind === "query", score, mode: "length-heuristic", threshold };
}

// ── Boot hydrate ─────────────────────────────────────────────────────────
export async function hydrateIntentConfigFromDb() {
  if (!_pool) return;
  try {
    const { rows } = await _pool.query("SELECT value FROM app_settings WHERE key='intent.config'");
    const v = rows[0]?.value;
    if (v && typeof v === "object") {
      if (typeof v.technicalThreshold === "number") {
        RUNTIME_INTENT_CFG.technicalThreshold = Math.min(1, Math.max(0, v.technicalThreshold));
      }
      if (typeof v.forceRagMode === "string" && ["auto","always","never"].includes(v.forceRagMode)) {
        RUNTIME_INTENT_CFG.forceRagMode = v.forceRagMode;
      }
      if (typeof v.semanticThreshold === "number") {
        RUNTIME_INTENT_CFG.semanticThreshold = Math.min(1, Math.max(0.05, v.semanticThreshold));
      }
      if (typeof v.classifierMode === "string" && ["embedding","llm","hybrid"].includes(v.classifierMode)) {
        RUNTIME_INTENT_CFG.classifierMode = v.classifierMode;
      }
      if (typeof v.classifierPrompt === "string" && v.classifierPrompt.trim()) {
        RUNTIME_INTENT_CFG.classifierPrompt = v.classifierPrompt.slice(0, 4000);
      }
      try {
        const cur = String(RUNTIME_INTENT_CFG.classifierPrompt || "");
        const isLegacyTr = cur.startsWith("Aşağıdaki kullanıcı mesajını sınıflandır");
        const sentinel = await _pool.query(
          "SELECT value FROM app_settings WHERE key='intent.legacyTrMigratedAt'"
        );
        const isLegacyNoForge = cur === LEGACY_CLASSIFIER_PROMPT_NO_FORGE;
        if ((isLegacyTr && !sentinel.rows[0]) || isLegacyNoForge) {
          RUNTIME_INTENT_CFG.classifierPrompt = DEFAULT_CLASSIFIER_PROMPT;
          await _pool.query(
            `INSERT INTO app_settings(key, value, updated_at) VALUES ('intent.config', $1::jsonb, now())
             ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
            [JSON.stringify({ ...RUNTIME_INTENT_CFG })]
          );
          await _pool.query(
            `INSERT INTO app_settings(key, value, updated_at) VALUES ('intent.legacyTrMigratedAt', $1::jsonb, now())
             ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
            [JSON.stringify({ at: new Date().toISOString() })]
          );
          console.log("[intent] legacy classifier prompt → FORGE-aware DEFAULT (one-shot)");
        }
      } catch (e) { console.warn("[intent] legacy-tr migration skipped:", String(e?.message || e)); }
      console.log(`[intent] hydrated · mode=${RUNTIME_INTENT_CFG.forceRagMode} semThr=${RUNTIME_INTENT_CFG.semanticThreshold} classifier=${RUNTIME_INTENT_CFG.classifierMode}`);
    }
  } catch (e) { console.warn("[intent] hydrate skipped:", String(e?.message || e)); }
}

export function scheduleIntentHydrate(delayMs = 500) {
  setTimeout(() => { void hydrateIntentConfigFromDb(); }, delayMs);
}
