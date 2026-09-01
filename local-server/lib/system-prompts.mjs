// lib/system-prompts.mjs — UI = tek mercii (2026-06-03).
// Hardcoded LLM system prompts → RAG_SETTINGS textarea overrides.
// User'ın 2026-06-03 kuralı: "böyle arka tarafta birşeyler saklarsak problem
// çıkınca çözemeyiz ve UI kullanmamızın anlamı olmaz."
//
// 4 knob:
//   - inspectorDirective       (RAG cevap formatı — placeholders: {BRAND_LOCK}, {SOURCES})
//   - inspectorBrandLock       (dominant brand'e kilitle — placeholder: {BRAND})
//   - extractorSystemPrompt    (extract.mjs: technical-core denoise)
//   - hydeSystemPrompt         (server.mjs: HyDE hypothetical passage)
//
// Tasarım: Default'lar burada export edilir (kod-içi truth). RAG_SETTINGS
// boş ("") veya null ise default'a düşer. UI textarea dolu ise UI kazanır.
// Hot-swap (restart yok), `.rag-settings.json` persist.

export const DEFAULT_INSPECTOR_DIRECTIVE =
  "TALİMAT (cevap formatı):\n" +
  "• Yukarıdaki kaynak bloklarını DİKKATLE oku ve cevabı SADECE oradaki bilgilerle kur.\n" +
  "• KAYNAK-SORU UYUM KONTROLÜ: Aynı satıcının ürün ailesi tek satıcı sayılır — Fortinet: FortiGate/FortiOS/FortiManager/FortiAnalyzer/FortiSwitch/FortiAP/FortiClient; Cisco: ASA/Firepower/IOS/NX-OS/Nexus; Check Point: SmartConsole/Gaia/R8x; Palo Alto: PAN-OS/Panorama; Citrix: NetScaler/ADC. Yalnızca soru ile kaynaklar TAMAMEN FARKLI satıcılara aitse (örn. soru 'Cisco ASA' ama kaynaklar yalnız Fortinet/Check Point) uydurma — açıkça şunu yaz: 'Kütüphanede bu konu için doğrudan kaynak yok; kendi bilgimle özetliyorum:' ve sonra kendi bilginle cevapla. Aynı satıcının farklı ürün/sürümleri arasında bu satırı YAZMA — kaynakları normal kullan.\n" +
  "• Her ana noktayı kaynaktan çıkarılan SOMUT ayrıntıyla destekle — parametre adı, komut, değer, prosedür adımı, sayı, sürüm; jenerik özet yazma.\n" +
  "• Açıklamayı kısa madde başlarıyla geç — her madde 2-3 cümle teknik detay içersin; iki-üç yerde [Kaynak N] etiketi ile satır içi atıf yap.\n" +
  "{BRAND_LOCK}" +
  "• Cevabın EN SONUNA tek satır olarak şunu ekle (aynen, başka metin olmadan); kaynak-soru uyumsuzluğu varsa bu satırı YAZMA:\n" +
  "Kaynaklar: {SOURCES}";

export const DEFAULT_INSPECTOR_BRAND_LOCK =
  "• Yalnızca {BRAND} terminolojisini kullan; başka satıcının ürün adlarını karıştırma.\n";

// 2026-06-03 Tur 2: `/no_think` prefix UI knob (RAG_SETTINGS.thinkOffPrefix)
// olarak çekildi. Default extractor/HyDE metni saf sistem talimatı — Qwen
// `/no_think` prefix'i call-site'te ayrı bir knob ile eklenir.
export const DEFAULT_EXTRACTOR_SYSTEM_PROMPT =
  "You extract the technical search core from user messages. Output exactly one short line — the technical question only, no greetings, no filler, no names, no thinking, no preface, no tags. " +
  "Fix obvious vendor name typos (e.g. 'checkpointtte'->'checkpoint', 'fortigatte'->'fortigate', 'paloalto'->'palo alto', 'cisocoo'->'cisco'). " +
  "Preserve version tokens exactly (R81.20, v7.4, FortiOS 7.6).";

export const DEFAULT_HYDE_SYSTEM_PROMPT =
  "You write a short hypothetical technical passage that a real document would contain to answer the question. Output the passage only — no preface, no quotes, no list, no thinking, no tags. " +
  "";

// 2026-06-03 Tur 2 — Planner system prompt (plan-and-execute LLM).
// Placeholder: {MAX_TOOLS} → integer. UI override knob: plannerSystemPrompt.
export const DEFAULT_PLANNER_SYSTEM_PROMPT =
  "Sen bir araç planlayıcısın. Kullanıcının sorusunu okuyup, MEVCUT araçlar listesinden hangilerinin sırayla çağrılması gerektiğini belirleyeceksin.\n" +
  "\n" +
  "Kurallar:\n" +
  "1. Sadece listedeki araçları kullan. Olmayan bir slug uydurma.\n" +
  "2. Hiç araç gerekmiyorsa boş steps döndür (RAG ve modelin kendi bilgisi yeterli olabilir).\n" +
  "3. En fazla {MAX_TOOLS} adım planla.\n" +
  "4. Cevabını SADECE şu JSON şemasında ver, başka hiçbir şey yazma:\n" +
  "{\n" +
  '  "reasoning": "kısa Türkçe gerekçe (1-2 cümle)",\n' +
  '  "steps": [\n' +
  '    { "slug": "araç-slug", "args": { } }\n' +
  "  ]\n" +
  "}";

// 2026-07-05 — Auto-Creator hattı. Elara'nın outer chat LLM'ine "eksik
// capability sezersen `@[meta-forge-master]` çağır" direktifi enjekte edilir.
// RAG_SETTINGS.capabilityGapDirective boşsa bu default kullanılır; knob
// `autoForgeRouting` (bool) ile hattın kendisi açılıp kapanır.
export const DEFAULT_CAPABILITY_GAP_DIRECTIVE =
  "META-FORGE ROUTING:\n" +
  "• Kullanıcının isteği mevcut tool/skill/agent ile karşılanamıyorsa, cevabının EN BAŞINDA (başka hiçbir metin olmadan) tek satır olarak `@[meta-forge-master]` yaz.\n" +
  "• Aynı satıra kısa bir Türkçe niyet açıklaması ekleyebilirsin (örn: `@[meta-forge-master] linkedin profilinden özet rapor üreten tool gerek`).\n" +
  "• Niyet güvenini 0-1 arası `confidence:0.85` biçiminde ekle; typo veya belirsizlik varsa niyeti sen düzelt.\n" +
  "• Mevcut bir capability karşılıyorsa çağırma — kendi cevabını ver.\n" +
  "• `@[meta-forge-master]` çağrısını sadece YARATMA talepleri için kullan; bilgi/anlatım turlarında kullanma.";

export const PROMPT_DEFAULTS = {
  inspectorDirective:       DEFAULT_INSPECTOR_DIRECTIVE,
  inspectorBrandLock:       DEFAULT_INSPECTOR_BRAND_LOCK,
  extractorSystemPrompt:    DEFAULT_EXTRACTOR_SYSTEM_PROMPT,
  hydeSystemPrompt:         DEFAULT_HYDE_SYSTEM_PROMPT,
  plannerSystemPrompt:      DEFAULT_PLANNER_SYSTEM_PROMPT,
  capabilityGapDirective:   DEFAULT_CAPABILITY_GAP_DIRECTIVE,
};

// Resolve a prompt by key. Settings value (if non-empty trimmed string) wins;
// otherwise falls back to the in-code default. Substitutes {KEY}→value
// from `vars` object; missing vars resolve to empty string (so optional
// blocks like {BRAND_LOCK} silently disappear when not applicable).
export function resolvePrompt(settings, key, vars = {}) {
  const raw = settings && typeof settings[key] === "string" ? settings[key].trim() : "";
  const tpl = raw.length > 0 ? raw : (PROMPT_DEFAULTS[key] || "");
  return tpl.replace(/\{([A-Z_]+)\}/g, (_m, name) => {
    const v = vars[name];
    return v == null ? "" : String(v);
  });
}

// Render the RAG inspector directive with brand-lock + source-list substitution.
// `dominantBrand` is null/string; when string, brand-lock line is rendered
// (from inspectorBrandLock template) and substituted into {BRAND_LOCK}.
export function renderInspectorDirective(settings, { dominantBrand, sourceList }) {
  const brandLockLine = dominantBrand
    ? resolvePrompt(settings, "inspectorBrandLock", { BRAND: dominantBrand })
    : "";
  return resolvePrompt(settings, "inspectorDirective", {
    BRAND_LOCK: brandLockLine,
    SOURCES: String(sourceList || ""),
  });
}
