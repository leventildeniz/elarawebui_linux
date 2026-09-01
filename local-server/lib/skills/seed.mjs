// Skills Engine — system skill seed data + DB seeder
// Extracted from server.mjs (Tur S-1, 2026-05-30)

export const SYSTEM_SKILLS = [
  {
    id: "skill.audit-vip", slug: "audit-vip", name: "VIP Hesap Denetimi",
    description: "VIP etiketli hesaplar ve son yetkili olayları için salt-okunur denetim.",
    icon: "ShieldCheck", color: "#10b981",
    required_tools: ["postgres"], param_schema: { type: "object", properties: { since_hours: { type: "number", default: 24, minimum: 1, maximum: 720 } } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    script_body: `
      step("Querying recent admin events", 1, 3);
      const hours = Math.max(1, Number(params.since_hours||24));
      const r = await pool.query("SELECT count(*)::int AS n FROM agent_logs WHERE created_at > now() - ($1 || ' hours')::interval AND level='warn'", [hours]);
      step("Aggregating findings", 2, 3);
      const u = await pool.query("SELECT count(*)::int AS n FROM app_users WHERE role='Admin'");
      step("Sealing report", 3, 3);
      return { admins: u.rows[0].n, warn_events: r.rows[0].n, window_hours: hours };
    `,
    rollback_body: "",
  },
  {
    id: "skill.policy-export", slug: "policy-export", name: "Politika Dışa Aktarımı",
    description: "Mevcut RBAC + sağlayıcı politika anlık görüntüsünü dışa aktarır (salt-okunur).",
    icon: "FileSpreadsheet", color: "#0ea5e9",
    required_tools: ["postgres"], param_schema: { type: "object", properties: {} },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    script_body: `
      step("Reading users", 1, 3);
      const u = await pool.query("SELECT username, role, status FROM app_users ORDER BY role, username");
      step("Reading groups", 2, 3);
      const g = await pool.query("SELECT id, name, role FROM app_groups ORDER BY name");
      step("Sealing snapshot", 3, 3);
      return { users: u.rows, groups: g.rows, generated_at: new Date().toISOString() };
    `,
    rollback_body: "",
  },
  {
    id: "skill.firewall-deploy", slug: "firewall-deploy", name: "Güvenlik Duvarı Politika Dağıtımı",
    description: "Adlandırılmış güvenlik duvarı politikasını hedefe dağıtır (KRİTİK — onay gerekir).",
    icon: "Flame", color: "#ef4444",
    required_tools: ["fw-cli"], param_schema: {
      type: "object",
      required: ["target_ip", "policy_name"],
      properties: {
        target_ip: { type: "string", pattern: "^(\\\\d{1,3}\\\\.){3}\\\\d{1,3}$" },
        policy_name: { type: "string", pattern: "^[A-Za-z0-9_-]{3,64}$" },
        port: { type: "number", minimum: 1, maximum: 65535, default: 443 },
      },
    },
    risk_level: "critical", requires_approval: true,
    script_kind: "js",
    script_body: `
      step("Pre-flight check", 1, 4);
      await sleep(300);
      step("Pushing policy " + params.policy_name + " to " + params.target_ip + ":" + (params.port||443), 2, 4);
      await sleep(600);
      step("Activating ruleset", 3, 4);
      await sleep(400);
      step("Verifying", 4, 4);
      return { deployed: true, policy: params.policy_name, target: params.target_ip, port: params.port||443, hash: Math.random().toString(36).slice(2,10) };
    `,
    rollback_body: `
      step("Reverting policy " + params.policy_name + " on " + params.target_ip, 1, 1);
      await sleep(400);
      return { reverted: true };
    `,
  },
  {
    id: "skill.live-internet-harvester", slug: "live-internet-harvester", name: "Canlı İnternet Toplayıcı",
    description: "Anahtarsız canlı internet toplayıcısı. USD/EUR/GBP kurları, hava durumu, genel sorgular; otomatik kaynak seçimi (Frankfurter / DuckDuckGo / Open-Meteo). Alışveriş/fiyat sorguları için gerçek web aramasını açmak üzere Brave veya Serper API anahtarı eklenebilir.",
    icon: "Globe", color: "#22d3ee",
    required_tools: [],
    optional_api_keys: [
      { envVar: "BRAVE_API_KEY", label: "Brave Search API", help: "Get a free key at api.search.brave.com — used as primary source for general/web queries when present." },
      { envVar: "SERPER_API_KEY", label: "Serper (Google) API", help: "Get a key at serper.dev — used as secondary source for general/web queries when Brave is absent." },
    ],
    param_schema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        max_results: { type: "number", minimum: 1, maximum: 10, default: 3 },
      },
    },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "USD/EUR/GBP/döviz, hava durumu ve genel internet sorularında otomatik tetiklenir. Serbest metin girdisi otomatik olarak params.query içine sarılır.",
    script_body: `
      const q = String(params.query || params.input || "").trim();
      if (!q) return { kind: "noop", reason: "empty_query", debug: { stage: "input" } };
      const lowered = q.toLocaleLowerCase("tr-TR");
      const maxResults = Math.min(10, Math.max(1, Number(params.max_results) || 3));

      step("Resolving intent", 1, 4);
      const fxRe = /(dolar|usd|euro|eur|sterlin|gbp|yen|jpy|isvi[çc]re|chf|altın|gold|kur|d[öo]viz|exchange|rate)/i;
      const wxRe = /(hava\\s*durumu|weather|s[ıi]cakl[ıi]k|temperature|ya[ğg][ıi]ş|forecast)/i;
      let mode = "general";
      if (fxRe.test(lowered)) mode = "fx";
      else if (wxRe.test(lowered)) mode = "weather";
      log("intent:", mode, "query:", q);

      const fxMap = [
        { re: /(usd|dolar)/i, code: "USD" },
        { re: /(eur|euro)/i, code: "EUR" },
        { re: /(gbp|sterlin|pound)/i, code: "GBP" },
        { re: /(chf|isvi[çc]re)/i, code: "CHF" },
        { re: /(jpy|yen)/i, code: "JPY" },
        { re: /(xau|alt[ıi]n|gold)/i, code: "XAU" },
      ];
      const targets = mode === "fx"
        ? (fxMap.filter(x => x.re.test(lowered)).map(x => x.code).filter(c => c !== "XAU") || [])
        : [];
      const fxFroms = targets.length ? targets : ["USD"];

      step("Bridging sources", 2, 4);
      const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + ms + "ms")), ms))]);
      const jget = async (url) => {
        const r = await timeout(8000, fetch(url, { headers: { "user-agent": "Mozilla/5.0 ELARA-Harvester" } }));
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      };
      const fetchText = async (url, ua) => {
        const r = await timeout(10000, fetch(url, {
          headers: {
            "user-agent": ua || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "accept-language": "tr-TR,tr;q=0.9,en;q=0.5",
          },
          redirect: "follow",
        }));
        const text = await r.text();
        return { status: r.status, ok: r.ok, text, len: text.length };
      };
      const decode = (s) => String(s || "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
        .replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\\s+/g, " ").trim();
      const unwrap = (u) => {
        try {
          const parsed = new URL(u, "https://duckduckgo.com");
          const uddg = parsed.searchParams.get("uddg");
          return uddg ? decodeURIComponent(uddg) : (parsed.href.startsWith("http") ? parsed.href : u);
        } catch { return u; }
      };

      step("Harvesting", 3, 4);
      const results = [];
      const out_debug = { stages: [] };
      const pushStage = (name, info) => out_debug.stages.push({ name, ...info });

      try {
        if (mode === "fx") {
          for (const from of fxFroms) {
            try {
              const data = await jget("https://api.frankfurter.app/latest?from=" + from + "&to=TRY");
              const rate = data?.rates?.TRY;
              pushStage("frankfurter:" + from, { ok: !!rate });
              if (rate) results.push({
                pair: from + "/TRY", rate: Number(rate), asof: data.date,
                source: "frankfurter.app (ECB)",
                summary: "1 " + from + " = " + Number(rate).toLocaleString("en-US", { maximumFractionDigits: 4 }) + " TRY (" + data.date + ")",
              });
            } catch (e) { pushStage("frankfurter:" + from, { error: String(e.message || e) }); }
          }
        } else if (mode === "weather") {
          // Strip weather stopwords (TR + EN) so "istanbul anlık hava durumu"
          // doesn't geocode the last token ("durumu") instead of the real city.
          const STOP = new Set([
            "hava","durumu","durum","anlik","anlık","su","şu","an","sicaklik","sıcaklık",
            "nem","ruzgar","rüzgar","rüzgâr","bugun","bugün","yarin","yarın","ne","kac","kaç",
            "weather","now","today","tomorrow","temperature","humidity","wind","in","at","for","the","is","what"
          ]);
          const tokens = (q.match(/[A-Za-zÇĞİıÖŞÜçğıöşü]{3,30}/g) || [])
            .filter(t => !STOP.has(t.toLowerCase()));
          const city = tokens.length
            ? tokens.sort((a, b) => b.length - a.length)[0]
            : "Istanbul";
          try {
            const geo = await jget("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=" + encodeURIComponent(city));
            const g = geo?.results?.[0];
            pushStage("open-meteo:geocode", { city, found: !!g });
            if (g) {
              const wx = await jget("https://api.open-meteo.com/v1/forecast?latitude=" + g.latitude + "&longitude=" + g.longitude + "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto");
              const c = wx?.current || {};
              pushStage("open-meteo:forecast", { ok: !!c.temperature_2m });
              results.push({
                city: g.name + (g.country ? ", " + g.country : ""),
                temperature_c: c.temperature_2m, humidity: c.relative_humidity_2m, wind_kmh: c.wind_speed_10m,
                asof: c.time, source: "open-meteo.com",
                summary: g.name + ": " + c.temperature_2m + "°C · humidity " + c.relative_humidity_2m + "% · wind " + c.wind_speed_10m + " km/h",
              });
            }
          } catch (e) { pushStage("open-meteo", { error: String(e.message || e) }); }
        } else {
          // ---- STAGE 0: Brave Search API (key-gated, primary when present) ----
          const braveKey = (env && env.BRAVE_API_KEY) || "";
          if (braveKey) {
            try {
              const url = "https://api.search.brave.com/res/v1/web/search?count=" + maxResults + "&q=" + encodeURIComponent(q);
              const r = await timeout(8000, fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": braveKey } }));
              const ok = r.ok;
              const data = ok ? await r.json() : null;
              const web = data?.web?.results || [];
              pushStage("brave-search", { hits: web.length, status: r.status });
              for (const w of web) {
                if (results.length >= maxResults) break;
                results.push({
                  title: w.title || q,
                  summary: w.description || w.title || "",
                  url: w.url || null,
                  source: "brave-search",
                });
              }
            } catch (e) { pushStage("brave-search", { error: String(e.message || e) }); }
          } else {
            pushStage("brave-search", { skipped: "no BRAVE_API_KEY" });
          }

          // ---- STAGE 0b: Serper (Google) API (key-gated, secondary) ----
          const serperKey = (env && env.SERPER_API_KEY) || "";
          if (results.length < maxResults && serperKey) {
            try {
              const r = await timeout(8000, fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-KEY": serperKey },
                body: JSON.stringify({ q, num: maxResults }),
              }));
              const ok = r.ok;
              const data = ok ? await r.json() : null;
              const organic = data?.organic || [];
              pushStage("serper", { hits: organic.length, status: r.status });
              for (const o of organic) {
                if (results.length >= maxResults) break;
                results.push({
                  title: o.title || q,
                  summary: o.snippet || o.title || "",
                  url: o.link || null,
                  source: "serper-google",
                });
              }
            } catch (e) { pushStage("serper", { error: String(e.message || e) }); }
          } else if (!serperKey) {
            pushStage("serper", { skipped: "no SERPER_API_KEY" });
          }

          // ---- AŞAMA A: Wikipedia OpenSearch (anahtarsız, JSON, blok yemez) ----
          for (const lang of ["tr", "en"]) {
            if (results.length >= maxResults) break;
            try {
              const j = await jget("https://" + lang + ".wikipedia.org/w/api.php?action=opensearch&limit=" + maxResults + "&namespace=0&format=json&search=" + encodeURIComponent(q));
              const titles = Array.isArray(j?.[1]) ? j[1] : [];
              const descs = Array.isArray(j?.[2]) ? j[2] : [];
              const urls = Array.isArray(j?.[3]) ? j[3] : [];
              pushStage("wiki-opensearch:" + lang, { hits: titles.length });
              for (let i = 0; i < titles.length && results.length < maxResults; i++) {
                results.push({
                  title: titles[i],
                  summary: descs[i] || titles[i],
                  url: urls[i] || null,
                  source: "wikipedia-" + lang,
                });
              }
            } catch (e) { pushStage("wiki-opensearch:" + lang, { error: String(e.message || e) }); }
          }

          // ---- AŞAMA B: DuckDuckGo Instant Answer JSON (kuru bilgi kutusu) ----
          if (results.length < maxResults) {
            try {
              const ia = await jget("https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=" + encodeURIComponent(q));
              const ab = ia?.AbstractText || ia?.Abstract;
              const related = Array.isArray(ia?.RelatedTopics) ? ia.RelatedTopics : [];
              pushStage("ddg-instant", { abstract: !!ab, related: related.length });
              if (ab) {
                results.push({
                  title: ia.Heading || q,
                  summary: ab,
                  url: ia.AbstractURL || null,
                  source: "duckduckgo-instant",
                });
              }
              for (const t of related) {
                if (results.length >= maxResults) break;
                if (!t?.Text) continue;
                results.push({
                  title: (t.Text || "").split(" - ")[0].slice(0, 120),
                  summary: t.Text,
                  url: t.FirstURL || null,
                  source: "duckduckgo-related",
                });
              }
            } catch (e) { pushStage("ddg-instant", { error: String(e.message || e) }); }
          }

          // ---- AŞAMA C: lite.duckduckgo.com HTML scrape (son çare) ----
          if (results.length < maxResults) {
            try {
              const liteUrl = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q);
              const r = await fetchText(liteUrl);
              const info = { status: r.status, len: r.len, matches: 0 };
              if (r.ok) {
                const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/g;
                const snipRe = /<td[^>]*class="result-snippet"[^>]*>([\\s\\S]*?)<\\/td>/g;
                const links = []; let m;
                while ((m = linkRe.exec(r.text))) links.push({ url: unwrap(m[1]), title: decode(m[2]) });
                const snips = []; let s2;
                while ((s2 = snipRe.exec(r.text))) snips.push(decode(s2[1]));
                for (let i = 0; i < links.length && results.length < maxResults; i++) {
                  if (!links[i].title) continue;
                  results.push({
                    title: links[i].title,
                    summary: snips[i] || links[i].title,
                    url: links[i].url,
                    source: "duckduckgo-lite",
                  });
                  info.matches++;
                }
              }
              pushStage("ddg-lite", info);
            } catch (e) { pushStage("ddg-lite", { error: String(e.message || e) }); }
          }

          // ---- AŞAMA D: Wikipedia REST summary fallback ----
          if (!results.length) {
            try {
              const wiki = await jget("https://tr.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(q.split(/\\s+/).slice(0, 4).join("_")));
              pushStage("wiki-rest", { found: !!wiki?.extract });
              if (wiki?.extract) results.push({
                title: wiki.title || q, summary: wiki.extract,
                url: wiki?.content_urls?.desktop?.page || null, source: "wikipedia-rest",
              });
            } catch (e) { pushStage("wiki-rest", { error: String(e.message || e) }); }
          }
        }
      } catch (e) {
        out_debug.fatal = String(e.message || e);
        log("harvest error", String(e.message || e));
      }

      step("Sealing", 4, 4);
      const engine = results[0]?.source || "none";
      return {
        kind: mode, query: q, asof: new Date().toISOString(),
        results: results.slice(0, maxResults),
        summary: results.length
          ? (engine + ": " + results.length + " sonuç · " + results.map(r => r.summary || r.title).join(" · "))
          : "kaynak boş döndü",
        debug: out_debug,
      };
    `,
    rollback_body: "",
  },
  // --- Faz 2A: Ortak 5 prompt-skill (2026-05-28) ------------------------------
  {
    id: "skill.markdown-report", slug: "markdown-report", name: "Markdown Rapor Üreticisi",
    description: "Ham veriyi (JSON/dict/liste) yönetici özeti, bölümler, metrik tablosu ve sonraki adımlar içeren yapılandırılmış Markdown rapora dönüştürür.",
    icon: "FileText", color: "#6366f1",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Raw text or stringified JSON to convert into a report." },
      title: { type: "string", description: "Optional report title; otherwise inferred from input." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir Markdown rapor üreticisin. Verilen girdiyi temiz, GFM uyumlu Markdown rapora dönüştür. Yapı: (1) H1 başlık — params.title verilmişse onu kullan, yoksa girdiden 4-8 kelimelik başlık çıkar. (2) `## Yönetici Özeti` — 3-5 sade cümle, dolgu yok. (3) Bir veya daha fazla `## Bölüm` bloğu madde listeleriyle; ilgili olguları grupla. (4) `## Anahtar Metrikler` — sayısal veri varsa GFM tablo; yoksa atla. (5) `## Sonraki Adımlar` — en fazla 5 emir kipinde madde, her biri fiil ile başlasın. Kurallar: emoji yok, süs ayraç yok, kod/CLI/JSON için fenced code block, tablo hücrelerinde pipe karakterini escape et, girdide olmayan metriği asla uydurma. Girdi boş veya ayrıştırılamazsa eksikliği tek cümle ile söyle — uydurma yapma.",
    script_body: `return { kind: "prompt-skill", slug: "markdown-report", input: String(params.input || params.text || ""), title: String(params.title || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.structured-json", slug: "structured-json", name: "Yapılandırılmış JSON Çıkarıcı",
    description: "Serbest metinden yapılandırılmış JSON çıkarır; istenirse çağırandan gelen JSON şemasına uyar.",
    icon: "Braces", color: "#0ea5e9",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Free-form text to parse." },
      schema: { type: "object", description: "Optional JSON schema the output must conform to." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir yapılandırılmış JSON çıkarıcısın. ÇIKTI TEK GEÇERLİ BİR JSON NESNESİ OLMALI — düz metin, önsöz, kod fence, son yorum yok. params.schema verilmişse ona tam uy: her zorunlu alan bulunmalı; eksik değerler null; bildirilen tipler ve enum'lara saygı duy. Şema yoksa params.input içindeki ana varlıkları, tarihleri, sayıları ve ilişkileri yakalayan özlü ve iyi-tipli bir nesne döndür. Olgu uydurma: kaynak metinde olmayan değer null'dır. Girdi boş veya temelden ayrıştırılamazsa tam olarak `{\\\"error\\\":\\\"unparseable_input\\\"}` döndür, başka hiçbir şey yazma.",
    script_body: `return { kind: "prompt-skill", slug: "structured-json", input: String(params.input || params.text || ""), schema: params.schema || null };`,
    rollback_body: "",
  },
  {
    id: "skill.tr-en-bridge", slug: "tr-en-bridge", name: "TR↔EN Köprü Çevirmen",
    description: "Türkçe ↔ İngilizce köprü çeviri; teknik terimleri korur (CLI, marka adları, CVE ID, hostname, kod).",
    icon: "Languages", color: "#10b981",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Text to translate." },
      direction: { type: "string", enum: ["auto", "tr-en", "en-tr"], default: "auto" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen Türkçe ile İngilizce arasında köprü çevirmensin. params.direction 'auto' ya da boşsa kaynak dili otomatik tespit et; aksi halde istenen yönü uygula. Şu öğeleri ÇEVİRMEDEN aynen koru: kod blokları ve inline kod, IP adresleri, CIDR blokları, hostname'ler, CLI komutları ve bayraklar, CVE/CWE kimlikleri, ürün ve marka adları (Cloudflare, FortiGate, Check Point, NetScaler, Citrix, A10, Wireshark vb.), sayısal sürümler (R81.20, v7.4). Kaynak metnin tonunu (resmi/gündelik) koru. SADECE çevirilmiş metni döndür — not yok, transliterasyon yok, kaynak tekrarı yok, neyin korunduğuna dair açıklama yok.",
    script_body: `return { kind: "prompt-skill", slug: "tr-en-bridge", input: String(params.input || params.text || ""), direction: String(params.direction || "auto") };`,
    rollback_body: "",
  },
  {
    id: "skill.cite-sources", slug: "cite-sources", name: "Satır İçi Kaynak Atayıcı",
    description: "Taslak cevaba yalnız çağırandan gelen RAG satırlarını kullanarak satır içi alıntı ekler. Dış bilgi yok.",
    icon: "Quote", color: "#f59e0b",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Draft answer that needs citations." },
      rows: { type: "array", description: "RAG rows: [{brand, path, section?, content}]." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir kaynak atayıcısın. Bir taslak cevap (params.input) ve RAG satır dizisi (params.rows) alırsın; her satırda brand, path, section ve content alanları olabilir. Taslaktaki her olgusal iddianın hemen ardından `[brand · path · §section]` formunda satır içi alıntı ekle; YALNIZCA o iddiayı gerçekten destekleyen satırları kullan. Section opsiyonel — yoksa temizce çıkar. Satır uydurma, iddiayı desteklemeyen satırı atıfla, satır içeriğini cevaba paragraflama. Taslağın kelimelerini koru; sadece alıntı eklersin. Destekleyici satırı olmayan iddiayı dokunulmadan bırak ve sonuna tek satır ekle: `no_supporting_source: <kısa iddia>`. params.rows boşsa taslağı değiştirmeden döndür ve sonuna `no_supporting_source: rows_empty` ekle.",
    script_body: `return { kind: "prompt-skill", slug: "cite-sources", input: String(params.input || params.text || ""), rows: Array.isArray(params.rows) ? params.rows : [] };`,
    rollback_body: "",
  },
  {
    id: "skill.safe-refuse", slug: "safe-refuse", name: "Güvenli Reddetme",
    description: "Zararlı, yasa dışı veya politika dışı istekleri kibarca reddeder ve daha güvenli bir alternatif sunar.",
    icon: "ShieldAlert", color: "#ef4444",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "The user request that must be refused." },
      reason: { type: "string", description: "Optional short policy reason." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen güvenli-reddetme yanıtlayıcısısın. Kullanıcının dilinde, en fazla üç cümlelik tek bir kısa paragraf yaz. Yapı: (1) net, yargısız bir reddetme; isteğin kategorisini yalnız üst seviyede adlandır — zararlı detayları asla tekrar etme, ahlak dersi verme, vaazda bulunma; (2) güvenlik, yasallık veya platform politikasına dayanan tek-cümle gerekçe (params.reason verilmişse kullan); (3) kullanıcının gerçekten alabileceği somut, daha güvenli tek bir alternatif: 'Sana X konusunda yardımcı olabilirim' kalıbı veya dilsel eşdeğeri. Madde listesi, başlık, iki kelimeden uzun özür, tehdit, iç kural veya model kimliği referansı yok.",
    script_body: `return { kind: "prompt-skill", slug: "safe-refuse", input: String(params.input || params.text || ""), reason: String(params.reason || "") };`,
    rollback_body: "",
  },
  // --- Faz 2B: NetSec 6 prompt-skill (2026-05-28) -----------------------------
  {
    id: "skill.incident-triage", slug: "incident-triage", name: "Olay Triyajı",
    description: "Gelen log/uyarı paketini sınıflandırır: önem derecesi, etki alanı, acil aksiyonlar, eskalasyon yolu.",
    icon: "AlertTriangle", color: "#dc2626",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Raw log lines, alert payloads or incident narrative." },
      severity_hint: { type: "string", enum: ["", "low", "medium", "high", "critical"], default: "" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir olay triyaj analistisin. params.input içeriğini (ham log, uyarı veya anlatı) oku ve yapılandırılmış Markdown triyaj notu üret. Sırayla zorunlu bölümler: (1) `## Önem Derecesi` — low / medium / high / critical biri, tek cümle ile gerekçeli; params.severity_hint'i yalnız kanıt destekliyorsa uygula. (2) `## Etki` — etkilenen sistemler, kullanıcılar, veri, maruz kalma süresi; her iddiayı girdiden çıkar. (3) `## Acil Aksiyonlar` — nöbetçinin sonraki 30 dakikada yapabileceği en fazla 5 emir kipinde madde. (4) `## Eskalasyon` — kime (ad değil, rol), hangi sırada, hangi tetikleyici koşulla. Girdide olmayan host adı, CVE ID veya kullanıcı kimliği uydurma. Girdi triyaj için çok ince ise Önem Derecesi bölümünde açıkça söyle ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "incident-triage", input: String(params.input || params.text || ""), severity_hint: String(params.severity_hint || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.firewall-rule-review", slug: "firewall-rule-review", name: "Güvenlik Duvarı Kural İncelemesi",
    description: "Güvenlik duvarı kural dışa aktarımını inceler; gölgelenmiş, kopya, aşırı geniş kuralları işaretler ve birleştirme önerir.",
    icon: "Shield", color: "#f97316",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Rule export (CLI, CSV, JSON) — any vendor." },
      vendor: { type: "string", description: "Optional vendor hint (fortigate, checkpoint, paloalto, cisco, etc.)." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir güvenlik duvarı hijyen incelemecisisin. params.input'u kural dışa aktarımı olarak ayrıştır (her vendor — params.vendor verilmişse ipucu olarak kullan). Dört bölümlü Markdown üret: (1) `## Bulgular` — `Kural | Sorun | Önem | Kanıt` sütunlu GFM tablo; Sorun ∈ {shadowed, duplicate, overly-broad, any-any, unused-hint, log-disabled, expiring}. Yalnız girdiden gerekçelendirebileceğin kuralları listele. (2) `## Birleştirme` — somut birleştirme veya bölme önerileri, madde başına bir tane, girdideki kural ID'lerine atıf yaparak. (3) `## Risk Notları` — bulgular aksiyon almazsa kalan risk üzerine kısa paragraf. (4) `## Kapsam Dışı` — dışa aktarımın değerlendirme imkanı vermediği konular (hit sayacı, IPS profili, NAT zinciri vb.). Kuralı gevşeten değişiklik önerme. Girdide olmayan kural ID uydurma.",
    script_body: `return { kind: "prompt-skill", slug: "firewall-rule-review", input: String(params.input || params.text || ""), vendor: String(params.vendor || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.pcap-narrate", slug: "pcap-narrate", name: "PCAP Anlatıcı",
    description: "pcap_summary çıktısını okunabilir bir zaman çizelgesine dönüştürür (kim kiminle konuştu, ne oldu, neden başarısız).",
    icon: "Activity", color: "#8b5cf6",
    required_tools: ["pcap_summary"],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "JSON output from the pcap_summary tool, or equivalent packet summary." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir paket-yakalama anlatıcısısın. params.input içeriğini oku (pcap_summary aracının JSON çıktısı veya eşdeğer paket/akış özeti) ve Markdown zaman çizelgesi üret. Bölümler: (1) `## Genel Bakış` — tek paragraf: yakalama süresi, paket sayısı, en yoğun konuşanlar, baskın protokoller. (2) `## Zaman Çizelgesi` — sıralı maddeler, her dikkat çeken olay için bir tane, format `HH:MM:SS.mmm  src → dst  protokol  olay`. Bariz retransmit'leri grupla. (3) `## Anomaliler` — reset, retransmit, MTU sorunu, TLS alert, ICMP unreachable, asimetrik akış için maddeler. Yoksa bölümü boş bırak. (4) `## Hipotez` — en olası kök nedeni öneren en fazla 3 cümle, hipotez olduğu açıkça belirtilmeli. Girdide olmayan paket, port veya host uydurma. Girdi geçerli bir özet değilse söyle ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "pcap-narrate", input: String(params.input || params.text || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.vuln-write-up", slug: "vuln-write-up", name: "Güvenlik Açığı Raporu",
    description: "CVE veya bulguyu yapılandırılmış rapora dönüştürür: yönetici özeti, teknik detay, iş etkisi, düzeltme.",
    icon: "Bug", color: "#ef4444",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "CVE record, scanner finding, or vulnerability narrative." },
      audience: { type: "string", enum: ["mixed", "executive", "technical"], default: "mixed" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir güvenlik açığı raporu yazarısın. params.input verildiğinde (CVE kaydı, tarayıcı bulgusu veya anlatı), params.audience'a (mixed/executive/technical; varsayılan mixed) uygun Markdown rapor üret. Zorunlu bölümler: (1) `## Yönetici Özeti` — 3-4 cümle, jargon yok, ne olabilir ve aciliyeti nedir. (2) `## Teknik Detay` — CVE ID, CVSS vektör + skor (varsa), etkilenen ürünler ve sürümler, saldırı önkoşulları, exploit karmaşıklığı, kamuya açık exploit varlığı. Yalnız girdinin desteklediği alanlar. (3) `## İş Etkisi` — kurumsal ortam için somut operasyonel, regülatif ve itibar sonuçları. (4) `## Düzeltme` — öncelikli maddeler: üretici yaması, azaltma/geçici çözüm, tespit (SIEM/IDS imza fikri), doğrulama adımı. Girdide olmayan CVSS skoru, yama URL'si veya üretici advisory'si uydurma. Eksik alan için tahmin yerine `unknown` yaz.",
    script_body: `return { kind: "prompt-skill", slug: "vuln-write-up", input: String(params.input || params.text || ""), audience: String(params.audience || "mixed") };`,
    rollback_body: "",
  },
  {
    id: "skill.change-request", slug: "change-request", name: "Değişiklik Talebi Hazırlayıcı",
    description: "Değişiklik niyetini ITIL-tarzı change request'e dönüştürür: amaç, kapsam, risk, geri alma, onaylar, iletişim.",
    icon: "GitPullRequest", color: "#0ea5e9",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Description of the intended change." },
      change_type: { type: "string", enum: ["", "standard", "normal", "emergency"], default: "" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir ITIL change-request hazırlayıcısın. params.input (serbest formatlı değişiklik niyeti) içeriğini Markdown change record'a dönüştür. params.change_type verilmişse kullan (standard/normal/emergency), yoksa çıkar ve çıkarımını belirt. Sırayla bölümler: (1) `## Amaç` — 1-2 cümle. (2) `## Kapsam` — kapsamdaki sistemler, bileşenler, kullanıcılar; kapsam dışı olanları açıkça listele. (3) `## Uygulama Planı` — numaralı adımlar, her adımda doğrulama. (4) `## Risk` — olasılık × etki (low/med/high) artı en kötü inandırıcı başarısızlık. (5) `## Geri Alma` — somut tersine alınabilir adımlar; tersine alınamıyorsa söyle. (6) `## Onaylar` — gereken onaylayıcı roller (CAB, sistem sahibi, güvenlik, iş birimi). (7) `## İletişim` — kim, ne zaman (öncesi/sırasında/sonrası), hangi kanaldan bilgilendirilecek. (8) `## Doğrulama` — değişiklik sonrası kontroller. Değişiklik penceresi, ticket numarası veya onaylayıcı adı uydurma. Niyet planlamak için çok belirsizse eksik girdileri Amaç bölümünde listele ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "change-request", input: String(params.input || params.text || ""), change_type: String(params.change_type || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.compliance-map", slug: "compliance-map", name: "Uyumluluk Eşleyici",
    description: "Bir kontrol veya politika parçasını ISO 27001, NIST CSF ve PCI-DSS maddelerine eşler; boşluk notları ekler.",
    icon: "ClipboardCheck", color: "#14b8a6",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Control description, policy statement, or implementation note." },
      framework: { type: "string", enum: ["all", "iso27001", "nist-csf", "pci-dss"], default: "all" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir uyumluluk eşleyicisin. params.input (kontrol tanımı, politika parçası veya uygulama notu) içeriğini params.framework ile istenen çerçeveye eşle — varsayılan `all` = ISO 27001:2022, NIST CSF 2.0 ve PCI-DSS v4.0. Markdown çıktı: (1) `## Eşleme` — `Çerçeve | Madde | Başlık | Eşleşme Gücü | Gerekçe` sütunlu GFM tablo; eşleşme gücü ∈ {strong, partial, weak}. Yalnız adı geçen çerçevede var olduğundan emin olduğun maddeleri ata — madde numarası uydurma. Kesin madde numarasından emin değilsen aile/bölüm adını ata ve eşleşmeyi `partial` olarak işaretle. (2) `## Boşluklar` — girdinin karşılamadığı kontrol amaçları için maddeler, her biri bir maddeye bağlı. (3) `## Önerilen İfade` — operatörün en önemli boşluğu kapatmak için politika belgesine yapıştırabileceği en fazla 3 cümle. Audit-ready uyumluluk iddiası etme. Anlatıda operatörün kaynak dilini kullan; madde ID'lerini orijinal formunda bırak.",
    script_body: `return { kind: "prompt-skill", slug: "compliance-map", input: String(params.input || params.text || ""), framework: String(params.framework || "all") };`,
    rollback_body: "",
  },
  // --- Faz 2C: SocialMedia 6 prompt-skill (2026-05-28) ------------------------
  {
    id: "skill.brand-voice", slug: "brand-voice", name: "Marka Sesi Parmak İzi",
    description: "Örnek paylaşımları analiz eder; ton/sözcük parmak izi ve yap/yapma rehberi üretir.",
    icon: "Mic", color: "#ec4899",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "2-10 sample posts from the brand, separated by blank lines or numbered." },
      brand_name: { type: "string", description: "Optional brand name for labelling." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir marka-sesi analistisin. params.input (örnek paylaşımlar) içeriğini oku ve Markdown üret: (1) `## Ton Parmak İzi` — 3-5 kısa sıfat ve girdideki somut örneklere dayanan tek cümle gerekçe. (2) `## Sözcük Dağarcığı` — `Kelime/Kalıp | Sıklık | Amaç` sütunlu GFM tablo; örneklerde gerçekten yer alan 6-12 yinelenen leksik imza. (3) `## Biçim Kalıpları` — cümle uzunluğu, emoji kullanımı, hashtag yoğunluğu, noktalama özellikleri, büyük harf, link yerleşimini kapsayan maddeler. (4) `## Yap` — yazarın izleyeceği 4-6 emir kipinde madde. (5) `## Yapma` — yazarın kaçınması gereken 4-6 emir kipinde madde (her biri markanın kanıtlanabilir biçimde hiç yapmadığı bir şeye dayalı). params.input'tan örnek olmadan ses özelliği uydurma. İkiden az farklı örnek verilmişse söyle ve tek cümle ile daha fazla iste.",
    script_body: `return { kind: "prompt-skill", slug: "brand-voice", input: String(params.input || params.text || ""), brand_name: String(params.brand_name || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.hook-formula", slug: "hook-formula", name: "Açılış Kancası Üretici",
    description: "Verilen konu için beş farklı açılış kancası üretir (problem-agitate, curiosity gap, contrarian, stat, story).",
    icon: "Zap", color: "#f59e0b",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Topic, angle, or asset description." },
      platform: { type: "string", enum: ["", "linkedin", "x", "instagram", "tiktok", "youtube"], default: "" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir açılış-kancası yazarısın. params.input (konu/açı) için tam olarak beş kanca üret, formül başına bir tane, şu sırayla: 1. Problem-Agitate, 2. Curiosity Gap, 3. Contrarian, 4. Stat-Driven, 5. Story Cold-Open. Markdown çıktıda her kanca `### N. <Formül Adı>` ardından tek satır olarak kanca (başka yorum yok). Her kanca ≤25 kelime; params.platform verildiğinde platform geleneklerine uy (örn. LinkedIn → emoji yağmuru yok, X → kısa vuruş, TikTok/IG → sohbet havası). Stat-Driven kanca için gerçek, doğrulanabilir bir istatistik KULLANMALISIN — konu için elinde yoksa sayı uydurmak yerine tek satır `unavailable — bu konu için doğrulanmış istatistik yok` yaz. Alıntı, marka sözü veya son-dakika çerçevesi uydurma.",
    script_body: `return { kind: "prompt-skill", slug: "hook-formula", input: String(params.input || params.text || ""), platform: String(params.platform || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.caption-localize", slug: "caption-localize", name: "Caption Yerelleştirici",
    description: "Caption'ı hedef pazara uyarlar: deyim, emoji normları, CTA gelenekleri — kültürel yeniden yazım, harfi harfine çeviri değil.",
    icon: "Globe2", color: "#06b6d4",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Original caption." },
      target_market: { type: "string", description: "Target market or locale (e.g. tr-TR, de-DE, en-US, ja-JP)." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir caption yerelleştiricisisin, çevirmen değil. params.input (orijinal caption) ve params.target_market (lokal/pazar) verildiğinde caption'ı, o pazarda doğrudan yazılmış gibi okunacak şekilde yeniden yaz. Deyim, mizah, emoji normları (yoğunluk ve seçim), hashtag gelenekleri, CTA ifadesi, formallik, saat/tarih formatı, para birimi ve kültürel hassas referansları uyarla. Ürün/marka adlarını, URL'leri, @mention'ları ve açıkça kampanyaya özel hashtag'leri koru. İki bölümlü Markdown çıktı: (1) `## Caption` — yapıştırmaya hazır yalnız yerelleştirilmiş caption. (2) `## Uyarlama Notları` — bilinçli kültürel seçimleri açıklayan 2-5 kısa madde (ne değişti, neden). Asla harfi harfine makine çevirisi yapma; kültürel olarak uygunsuz mizah ekleme. params.target_market eksik veya tanınmıyorsa tek cümle ile iste ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "caption-localize", input: String(params.input || params.text || ""), target_market: String(params.target_market || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.hashtag-strategy", slug: "hashtag-strategy", name: "Hashtag Stratejisi",
    description: "Verilen niş ve içerik için 3 katmanlı hashtag seti üretir (broad / mid / niche).",
    icon: "Hash", color: "#a855f7",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Content description, caption, or topic." },
      niche: { type: "string", description: "Primary niche the brand operates in." },
      platform: { type: "string", enum: ["", "instagram", "tiktok", "linkedin", "x", "youtube"], default: "" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir hashtag stratejistisin. params.input (içerik/caption/konu), params.niche (marka nişi) ve params.platform (opsiyonel) verildiğinde Markdown set üret: (1) `## Broad` — konuyla doğrudan ilgili 3-5 yüksek-hacimli tag. (2) `## Mid` — niş ile konuyu birleştiren 3-5 orta-hacimli tag. (3) `## Niche` — kitlenin kendini tanımlayacağı kadar spesifik 3-5 düşük-hacimli tag. (4) `## Avoid` — adı geçen platformda kullanılmaması gereken yasaklı, shadow-banned veya spam kalıpları. Platform geleneklerine uy: LinkedIn ~3 tag toplam (sayıları azalt), X 1-2 kullanır, TikTok/Instagram 8-15 tolere eder. Hacim sayıları uydurma. Erişimi artırmak için niş dışı tag önerme. Niş eksikse tek cümle ile iste ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "hashtag-strategy", input: String(params.input || params.text || ""), niche: String(params.niche || ""), platform: String(params.platform || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.crisis-response", slug: "crisis-response", name: "Kriz Yanıtı Taslağı",
    description: "Negatif bir olay için ilk-yanıt bildirisi taslar; açık bir eskalasyon koruması içerir.",
    icon: "LifeBuoy", color: "#f43f5e",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Description of the incident or negative event." },
      context: { type: "string", description: "Known facts, stakeholders, prior statements." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir kriz-yanıtı taslayıcısısın. params.input (negatif olay) ve params.context (bilinen olgular, paydaşlar, önceki açıklamalar) içeriğini oku ve Markdown üret: (1) `## Holding Statement` — 2-3 cümlelik ilk yanıt: kabul et, etkilenenler için özen ifade et, güncelleme penceresine söz ver. Sorumluluk kabulü yok, nedene dair spekülasyon yok, suçlama yok. (2) `## Ton Kontrolü` — tonu tanımlayan 3 madde (örn. sakin, olgusal, insancıl). (3) `## Eskalasyon Koruması` — yayınlamadan önce legal, PR lead veya yöneticiye DEVREDİLMESİ GEREKEN durumları listeleyen maddeler (yaralanma, ölüm, regülatif ihlal, devam eden soruşturma, reşit olmayan dahil, veri ihlali kapsamı bilinmiyor vb.). (4) `## Kanal Planı` — mesajı kanala eşleyen kısa maddeler (önce owned site, sonra sosyal, sonra medya). Mağdur, can kaybı sayısı veya kök neden uydurma. Girdi minimum (ne oldu, kim etkilendi) bilgiyi içermiyorsa Holding Statement bölümünde söyle ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "crisis-response", input: String(params.input || params.text || ""), context: String(params.context || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.cta-microcopy", slug: "cta-microcopy", name: "CTA Mikro-Metin",
    description: "Belirli bir hedefe göre 3-5 kısa CTA varyantı üretir (click, save, share, comment, sign up).",
    icon: "MousePointerClick", color: "#10b981",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Offer, asset, or post the CTA will close." },
      goal: { type: "string", enum: ["click", "save", "share", "comment", "signup", "purchase", "follow"], description: "Desired user action." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir CTA mikro-metin yazarısın. params.input (teklif/varlık) ve params.goal (istenen kullanıcı aksiyonu) verildiğinde 3-5 CTA varyantı içeren Markdown liste üret. Her varyant kendi satırında, ≤8 kelime, sonda nokta yok; goal share/follow değilse ve emoji platform-yerlisi olmadıkça emoji yok. Varyantlar arasında açıyı çeşitlendir: bir doğrudan emir kipi, bir fayda-odaklı, bir aciliyet veya kıtlık (yalnız teklif gerçekten kıtsa — değilse bu açıyı atla), bir sosyal kanıt çerçevesi, bir merak-odaklı. İndirim, son tarih veya garanti uydurma. params.goal eksik veya enum dışı ise tek cümle ile iste ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "cta-microcopy", input: String(params.input || params.text || ""), goal: String(params.goal || "") };`,
    rollback_body: "",
  },

  // ============================================================
  // NetSec +5 (adc_maestro, db_guardian, ddos_warlord, edge_dns_guardian, remote_access_sentry)
  // ============================================================
  {
    id: "skill.adc-tuning", slug: "adc-tuning", name: "ADC Tuning Report",
    description: "F5 LTM/GTM + Citrix NetScaler için sağlık, persistence, SSL-offload tuning raporu.",
    icon: "Activity", color: "#0ea5e9",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "ADC config dump, virtual server stats veya log özeti." },
      vendor: { type: "string", enum: ["f5","citrix","mixed"], description: "Hangi ADC ailesi." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir ADC (Application Delivery Controller) tuning uzmanısın. params.input'taki F5/Citrix verisini incele ve şu başlıklarla Markdown rapor üret: (1) Sağlık özeti — pool member up/down, persistence ihlali, SSL handshake gecikmesi. (2) Bulgular — sıralı liste, her madde 'belirti → kök neden → düzeltme komutu' formatında. (3) Tuning önerisi — connection mirroring, OneConnect/clientless, monitor interval, SSL cipher seçimi. (4) Risk notu — değişiklik penceresi gerekiyor mu, rollback komutu nedir. Vendor karışıksa F5 ve Citrix bölümlerini ayır. Veri yetersizse hangi komutun çıktısını istediğini tek cümle ile söyle ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "adc-tuning", input: String(params.input || ""), vendor: String(params.vendor || "mixed") };`,
    rollback_body: "",
  },
  {
    id: "skill.db-hardening", slug: "db-hardening", name: "DB Hardening Checklist",
    description: "PostgreSQL/MySQL/Oracle/MS-SQL için rol, grant, audit ve injection yüzeyi sertleştirme listesi.",
    icon: "Database", color: "#a855f7",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "DB versiyonu, kullanıcı listesi, mevcut grant'lar, audit ayarları." },
      engine: { type: "string", enum: ["postgres","mysql","mariadb","oracle","mssql"], description: "Hedef DB motoru." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir DB güvenlik mimarısın. params.input'taki DB envanterini al ve şu başlıklarla rapor üret: (1) Kritik bulgular — public rolünde fazla grant, şifresiz superuser, audit kapalı vb. (2) Sertleştirme adımları — SQL komutlarıyla, her komut tek satırda ve dry-run önce. (3) Injection yüzeyi — application-level prepared statement kullanımı, ORM tarafından üretilen ham SQL uyarısı. (4) Audit + backup — pgaudit/Enterprise Audit, RPO/RTO satırı. Engine'a göre syntax farklılığını koru. Veri yetersizse hangi 'select' veya 'show' komutunun çıktısını istediğini söyle ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "db-hardening", input: String(params.input || ""), engine: String(params.engine || "postgres") };`,
    rollback_body: "",
  },
  {
    id: "skill.ddos-runbook", slug: "ddos-runbook", name: "DDoS Mitigation Runbook",
    description: "L3/L4/L7 DDoS saldırı tipi sınıflandırma + adım adım mitigasyon ve eskalasyon matrisi.",
    icon: "ShieldOff", color: "#dc2626",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "A10 TPS/Arbor sinyalleri, NetFlow özeti, kurban IP/port." },
      layer: { type: "string", enum: ["l3","l4","l7","mixed","unknown"], description: "Tahmini saldırı katmanı." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir DDoS savunma uzmanısın. params.input'taki sinyalleri okuyup şu başlıklarla runbook üret: (1) Sınıflandırma — saldırı tipi (volumetric UDP flood, SYN flood, HTTP slowloris, DNS amplification vb.) + güven puanı. (2) Anlık mitigasyon — A10/Arbor komutları, rate-limit eşiği, GeoIP filter, BGP RTBH/Flowspec satırı. (3) Eskalasyon matrisi — saat bazında: 0-5 dk on-prem, 5-15 dk upstream ISP, 15+ dk Cloudflare/Akamai scrubbing. (4) Post-mortem girdileri — pcap saklama, IOC çıkarma. Layer 'unknown' ise önce tespit komutu öner sonra dur.",
    script_body: `return { kind: "prompt-skill", slug: "ddos-runbook", input: String(params.input || ""), layer: String(params.layer || "unknown") };`,
    rollback_body: "",
  },
  {
    id: "skill.dns-hardening", slug: "dns-hardening", name: "DNS Hardening Review",
    description: "Bluecat/Infoblox/Cloudflare için DNSSEC, rate-limit, RPZ ve recursion sertleştirme raporu.",
    icon: "Globe", color: "#0891b2",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Zone dump, named.conf, Cloudflare zone settings JSON." },
      platform: { type: "string", enum: ["bluecat","infoblox","cloudflare","bind","mixed"], description: "DNS platformu." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir DNS güvenlik mimarısın. params.input'taki zone/config'i incele ve şu rapor başlıklarıyla çık: (1) DNSSEC durumu — imzalı mı, NSEC3 mi NSEC mi, anahtar rotasyonu son ne zaman. (2) Recursion + rate-limit — açık resolver mi, response-rate-limit (RRL) açık mı, ACL doğru mu. (3) RPZ / threat feed — kötü domain'leri sinkholing var mı. (4) Sertleştirme adımları — komut + beklenen çıktı, her platforma uygun (Cloudflare için API çağrısı, Bluecat için XML-RPC, BIND için named.conf). Platform 'mixed' ise her biri için ayrı bölüm. Veri yetersizse hangi dump'ı istediğini söyle.",
    script_body: `return { kind: "prompt-skill", slug: "dns-hardening", input: String(params.input || ""), platform: String(params.platform || "mixed") };`,
    rollback_body: "",
  },
  {
    id: "skill.vpn-access-review", slug: "vpn-access-review", name: "VPN Access Review",
    description: "Ivanti Pulse / SSL-VPN / ZTNA için MFA, split-tunnel, idle-timeout ve posture-check raporu.",
    icon: "KeyRound", color: "#f59e0b",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "VPN policy export, kullanıcı/rol listesi, son 7 gün login logu." },
      platform: { type: "string", enum: ["pulse","fortinet","cisco-anyconnect","ztna","mixed"], description: "Uzak erişim ürünü." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir uzak erişim güvenlik uzmanısın. params.input'tan kullanıcı + rol + login pattern'ini al ve şu rapor başlıklarıyla çık: (1) MFA kapsamı — hangi rol MFA'sız, kaç oturum impossible-travel pattern'i gösteriyor. (2) Split-tunnel + DNS — kurumsal DNS leak var mı, full-tunnel zorunlu rol listesi. (3) Idle timeout + session lifetime — 8 saat üstü oturum sayısı, atalet/zorla kapatma kuralı. (4) Posture-check — antivirüs, OS patch level, disk encryption kontrolü. (5) Aksiyon listesi — her madde 'risk → kural → komut' formatında. ZTNA için segmentation analizi de ekle.",
    script_body: `return { kind: "prompt-skill", slug: "vpn-access-review", input: String(params.input || ""), platform: String(params.platform || "mixed") };`,
    rollback_body: "",
  },

  // ============================================================
  // SocialMedia +5 (analytics_oracle, community_sentinel, compliance_warden, content_strategist, trend_radar)
  // ============================================================
  {
    id: "skill.analytics-report", slug: "analytics-report", name: "Analytics Weekly Report",
    description: "Erişim/etkileşim/CTR özeti + içgörü + bir sonraki haftaya hipotezli deney önerisi.",
    icon: "BarChart3", color: "#8b5cf6",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Önceki dönem metrikleri (CSV/JSON/text)." },
      window_days: { type: "number", default: 7, minimum: 1, maximum: 90 },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir sosyal medya analitik uzmanısın. params.input'taki son params.window_days günlük metrikleri al ve şu Markdown rapor başlıklarıyla çık: (1) Headline — 3 cümle: ne arttı, ne düştü, neden. (2) Kanal kırılımı — kanal × erişim/etkileşim/CTR tablosu (Markdown table). (3) İçgörü — 3 madde, her madde 'gözlem → olası neden → kanıt'. (4) Deney önerisi — 1 hipotez + ölçülecek metrik + süre (gün) + başarı eşiği. Kesin olmayan içgörüleri 'düşük güven' etiketle. Veri eksikse hangi alanın gerektiğini tek satırda söyle ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "analytics-report", input: String(params.input || ""), window_days: Number(params.window_days || 7) };`,
    rollback_body: "",
  },
  {
    id: "skill.community-reply", slug: "community-reply", name: "Community Reply Drafter",
    description: "DM/yorum yanıt taslağı — marka tonunda, empati matrisli, eskalasyon kararı dahil.",
    icon: "MessageCircle", color: "#22c55e",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Gelen mesaj/yorum metni + bağlam." },
      tone: { type: "string", enum: ["friendly","formal","apologetic","celebratory"], default: "friendly" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir topluluk yöneticisisin. params.input'taki mesajı analiz et ve şu sırayla çık: (1) Niyet — soru / şikayet / övgü / spam / kriz (tek kelime). (2) Sentiment — pozitif/nötr/negatif + güven puanı. (3) Yanıt taslağı — 1-3 cümle, params.tone tonunda, kişisel bilgi sızdırmadan, taahhüt vermeden. (4) Eskalasyon — compliance_warden'a gitsin mi? Kriz sinyali var mı? evet/hayır + 1 cümle gerekçe. Şikayetlerde önce empati cümlesi sonra çözüm önerisi. Spam ise 'block + report' öner ve yanıt taslağı yazma.",
    script_body: `return { kind: "prompt-skill", slug: "community-reply", input: String(params.input || ""), tone: String(params.tone || "friendly") };`,
    rollback_body: "",
  },
  {
    id: "skill.disclosure-check", slug: "disclosure-check", name: "Sponsorship Disclosure Check",
    description: "Yayın öncesi #ad / #sponsored / KVKK / platform politikası kontrolü — APPROVE/REVISE/BLOCK kararı.",
    icon: "ScrollText", color: "#facc15",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Yayınlanmak üzere içerik (caption + medya açıklaması + link)." },
      channel: { type: "string", enum: ["instagram","tiktok","x","linkedin","youtube","facebook"] },
      paid: { type: "boolean", default: false, description: "Ücretli işbirliği mi?" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir yayın öncesi compliance denetçisisin. params.input içeriğini incele ve şu başlıklarla rapor üret: (1) Karar — APPROVE / REVISE / BLOCK (tek kelime). (2) Disclosure — params.paid true ise #ad veya #sponsored caption başında mı, platform kuralına uygun mu (TikTok 'paid partnership' toggle, Instagram 'paid partnership label' vb.). (3) KVKK + telif — kişisel veri sızdırması, izinsiz görsel/müzik kullanımı. (4) Marka + platform politikası — yasaklı kelimeler, dezenformasyon riski, sağlık/finans iddiası. (5) Düzeltme listesi — REVISE ise madde madde ne değişmeli. BLOCK ise tek cümlede gerekçe.",
    script_body: `return { kind: "prompt-skill", slug: "disclosure-check", input: String(params.input || ""), channel: String(params.channel || ""), paid: Boolean(params.paid) };`,
    rollback_body: "",
  },
  {
    id: "skill.content-calendar", slug: "content-calendar", name: "Weekly Content Calendar",
    description: "7 günlük temalı içerik takvimi — kanal × ton × KPI dengeli plan.",
    icon: "CalendarDays", color: "#f59e0b",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Marka hedefleri, son hafta öğrenimleri, gelecek kampanya/etkinlik." },
      channels: { type: "array", items: { type: "string" }, default: ["instagram","linkedin","x"] },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen editoryal takvim sahibisin. params.input'taki hedefleri al ve params.channels için 7 günlük takvim üret: Markdown tablo, sütunlar | Gün | Kanal | Tema | Format | Başlık | Ton | KPI |. Format örnekleri: reel, carousel, post, thread, story, live. Ton: ilham, eğitim, sosyal kanıt, ürün, kültür. KPI: erişim, tıklama, kaydetme, paylaşım, yorum. Aynı temanın iki ardışık günde tekrarına izin verme. Her kanala uygun format seç (LinkedIn'de reel yerine post tercih et). Sonunda 1 cümle: 'Bu hafta odak {tema}'. Hedef yoksa tek soruyla iste.",
    script_body: `return { kind: "prompt-skill", slug: "content-calendar", input: String(params.input || ""), channels: Array.isArray(params.channels) ? params.channels : ["instagram","linkedin","x"] };`,
    rollback_body: "",
  },
  {
    id: "skill.trend-brief", slug: "trend-brief", name: "Trend Brand-Fit Brief",
    description: "Güncel trend × marka uyum puanı + 3 hızlı aksiyon önerisi (sönme riskiyle).",
    icon: "TrendingUp", color: "#06b6d4",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Trend / meme / haber özeti + kaynak (platform + tarih)." },
      brand_voice: { type: "string", description: "Marka tonu kısa tanım." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir trend skoplayıcısın. params.input'taki trendi al ve şu rapor başlıklarıyla çık: (1) Trend özeti — 2 cümle (nedir, nereden geldi, ne kadar süredir). (2) Brand-fit puanı — 0-10 + 1 cümle gerekçe (params.brand_voice ile uyum). (3) Sönme riski — düşük/orta/yüksek + tahmini ömür (gün). (4) 3 aksiyon önerisi — her biri 'format + kanal + 1 cümle açıklama + risk notu' formatında. (5) Kırmızı çizgi — siyasi/dezenformatif/etik risk varsa SKIP öner. Puan < 4 ise sadece SKIP yaz, aksiyon üretme.",
    script_body: `return { kind: "prompt-skill", slug: "trend-brief", input: String(params.input || ""), brand_voice: String(params.brand_voice || "") };`,
    rollback_body: "",
  },

  // ============================================================
  // +4 ek skill: core_architect, red_team_operator, shell_master, visual_brief
  // ============================================================
  {
    id: "skill.network-design", slug: "network-design", name: "Ağ Mimarisi Tasarımı",
    description: "Yeni site/segment/DC için L2/L3, segmentasyon, HA, yedeklilik ve adresleme planı üretir.",
    icon: "Network", color: "#0ea5e9",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Gereksinim metni: kullanıcı sayısı, uygulamalar, lokasyon, SLA, mevcut envanter." },
      scope: { type: "string", enum: ["", "campus", "branch", "dc", "cloud", "hybrid"], default: "" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir ağ mimarisi tasarımcısısın. params.input gereksinimini ve params.scope (campus/branch/dc/cloud/hybrid) ipucunu oku, Markdown tasarım üret: (1) `## Topoloji` — katmanlar (access/distribution/core veya spine-leaf), HA modeli, link sayısı/hızı. (2) `## Segmentasyon` — VLAN/VRF/zone listesi, trafik akışı ve kuzey-güney izolasyon kuralı. (3) `## Adresleme` — IPv4/IPv6 plan tablosu (subnet, amaç, gateway, DHCP/SLAAC notu). RFC 1918 dışına çıkma. (4) `## Yedeklilik & HA` — link, cihaz, güç, WAN; convergence zamanı hedefi. (5) `## Kapasite & Büyüme` — bugünkü ihtiyaç + 3 yıl projeksiyonu. (6) `## Doğrulama` — provisioning sonrası test listesi (ping/traceroute/throughput/failover). Üretici-bağımsız yaz; girdide üretici belirtilmişse cihaz örneği ver. Gereksinim eksikse Topoloji bölümünde eksik girdileri listele ve dur.",
    script_body: `return { kind: "prompt-skill", slug: "network-design", input: String(params.input || ""), scope: String(params.scope || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.pentest-playbook", slug: "pentest-playbook", name: "Sızma Testi Playbook'u",
    description: "Hedef + kapsam için recon→exploit→post-exploit→cleanup adımlı, ROE-uyumlu pentest playbook'u üretir.",
    icon: "Crosshair", color: "#dc2626",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Hedef tanımı: scope, sistem türü, RoE notları, kabul edilen test pencereleri." },
      goal: { type: "string", enum: ["", "external", "internal", "web-app", "wifi", "social", "red-team"], default: "" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir kıdemli ofansif güvenlik operatörüsün — yetkili sızma testi için yazıyorsun. params.input (hedef + RoE) ve params.goal (external/internal/web-app/wifi/social/red-team) ile Markdown playbook üret: (1) `## Kapsam & RoE` — izin verilen IP/uygulama, dışlanan varlıklar, test penceresi, escalation iletişim. RoE eksikse buradan iste ve dur. (2) `## Recon` — pasif + aktif aşamalar; her adımda araç/komut + beklenen çıktı. (3) `## Zafiyet Tespiti` — kategori (auth, injection, misconfig, yamasız CVE) + tarama yöntemi. (4) `## Exploit` — kapsamdaki gerçekçi PoC adımları; aşırı yıkıcı yük yok. (5) `## Post-Exploit` — privilege escalation, lateral movement, persistence — yalnız hedef ortamda kanıt amaçlı. (6) `## Cleanup` — yüklenen dosya, kullanıcı, persistence kaldırma adımları. (7) `## Raporlama` — kanıt toplama (ekran, log, hash) ve müşteri-hazır özet formatı. KESİN KURALLAR: zarar verici yük yok, üçüncü taraf sistem yok, public exploit kullanırken risk notu zorunlu, gerçek hedefe karşı sadece yazılı onay varsayımıyla.",
    script_body: `return { kind: "prompt-skill", slug: "pentest-playbook", input: String(params.input || ""), goal: String(params.goal || "") };`,
    rollback_body: "",
  },
  {
    id: "skill.shell-runbook", slug: "shell-runbook", name: "Shell Runbook Yazımı",
    description: "Operatif bir görevi adım adım, idempotent, geri-alınabilir bash/zsh runbook'una dönüştürür.",
    icon: "Terminal", color: "#16a34a",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Görev tanımı: amaç, hedef sistem (linux/macos/bsd), ön koşul, başarı kriteri." },
      shell: { type: "string", enum: ["bash", "zsh", "sh"], default: "bash" },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir kıdemli SRE/sistem operatörüsün. params.input içeriğini params.shell hedefinde (varsayılan bash) çalıştırılabilir bir runbook'a dönüştür. Markdown bölümler: (1) `## Önkoşullar` — gerekli paket, yetki (sudo), erişim, çevre değişkeni. (2) `## Doğrulama (önce)` — değişiklik öncesi mevcut durum komutu + beklenen çıktı. (3) `## Adımlar` — numaralı adımlar; her adımda fenced code block içinde TEK komut + tek satır açıklama. Idempotent kalsın (mkdir -p, [ -f x ] || ..., systemctl is-active). (4) `## Doğrulama (sonra)` — başarı kontrol komutu. (5) `## Geri Alma` — adım adım rollback komutları; rollback mümkün değilse açıkça yaz. (6) `## Hata Yönetimi` — beklenebilir hatalar + tepki. KURALLAR: `rm -rf /`, parola ile pipe, tehlikeli redirect (>) gözden geçirmeden YASAK. Stdin'den gizli veri okumayı tercih et. Çıktı sadece runbook'tur — sohbet yok.",
    script_body: `return { kind: "prompt-skill", slug: "shell-runbook", input: String(params.input || ""), shell: String(params.shell || "bash") };`,
    rollback_body: "",
  },
  {
    id: "skill.visual-brief", slug: "visual-brief", name: "Görsel Brief Hazırlayıcı",
    description: "Tasarımcı/foto/AI görsel üreticisine verilecek; konsept, kompozisyon, palet, tipografi, kullanım alanı içeren brief üretir.",
    icon: "Image", color: "#f43f5e",
    required_tools: [],
    param_schema: { type: "object", properties: {
      input: { type: "string", description: "Kampanya/post amacı, hedef kitle, mesaj, kullanım yeri (Instagram post, story, billboard vb.)." },
      brand: { type: "string", description: "Marka adı veya ton notu (isteğe bağlı)." },
    } },
    risk_level: "read", requires_approval: false,
    script_kind: "js",
    instructions: "Sen bir art director / görsel brief yazarısın. params.input (amaç + kullanım) ve params.brand (marka tonu) verildiğinde Markdown brief üret: (1) `## Konsept` — tek cümle ana fikir + 1-2 cümle hikaye. (2) `## Kompozisyon` — kadraj (kare/portre/yatay/story), odak nokta, negative space, hareket yönü. (3) `## Renk Paleti` — 3-5 renk; HEX değerleri + duygusal rol (örn. #0ea5e9 — güven). Marka rengi varsa anchor olarak işaretle. (4) `## Tipografi` — başlık + altyazı font önerisi (sans/serif/display), boyut hiyerarşisi, kontrast notu. (5) `## Stil Referansı` — 3 madde halinde estetik anahtar kelime (örn. minimal, editorial, neo-brutalist, glassmorphism); klişe stoklardan kaçın. (6) `## Yapılmayacaklar` — markaya ters düşen veya pazara uygunsuz öğeler. (7) `## Üretim Notu` — fotoğraf mı, illüstrasyon mu, AI prompt mu; AI üretimi ise prompt taslağını ek paragraf olarak ver. KURALLAR: telifli karakter/marka logosu önerme; kalıp emoji/sticker kullanma; brief tek sayfada okunabilir kalsın.",
    script_body: `return { kind: "prompt-skill", slug: "visual-brief", input: String(params.input || ""), brand: String(params.brand || "") };`,
    rollback_body: "",
  },
];

export async function seedSkills({ pool, migrateReady }) {
  try {
    await migrateReady;
    // Operatörün sildiği sistem skill'leri kalıcı olarak unutmak için skip listesi.
    await pool.query(`CREATE TABLE IF NOT EXISTS skills_seed_skip (slug text PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now())`);
    const { rows: skipRows } = await pool.query(`SELECT slug FROM skills_seed_skip`);
    const skip = new Set(skipRows.map(r => r.slug));
    for (const s of SYSTEM_SKILLS) {
      if (skip.has(s.slug)) continue;
      await pool.query(
        `INSERT INTO skills(id,slug,name,description,icon,color,required_tools,param_schema,risk_level,requires_approval,script_kind,script_body,rollback_body,instructions,optional_api_keys,is_system,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,true,now())
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name,
           description=EXCLUDED.description,
           instructions=EXCLUDED.instructions,
           icon=EXCLUDED.icon,
           color=EXCLUDED.color,
           updated_at=now()
         WHERE skills.is_system = true`,
        [s.id, s.slug, s.name, s.description, s.icon, s.color,
         JSON.stringify(s.required_tools), JSON.stringify(s.param_schema),
         s.risk_level, s.requires_approval, s.script_kind, s.script_body, s.rollback_body || "", s.instructions || "",
         JSON.stringify(s.optional_api_keys || [])]
      );
    }
    console.log(`[skills] seeded ${SYSTEM_SKILLS.length - skip.size} system skills (${skip.size} skipped)`);
  } catch (e) { console.error("[skills seed]", e.message); }
}
