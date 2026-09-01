# ELARA Agents — Operator Reçetesi

Bu klasör Elara'nın ajan dosyalarını tutar. Her ajan tek bir `.py` (veya `.sh / .js / .mjs / .ts`) script'idir; Elara middleware'i diski tarar, DB'ye upsert eder ve chat'ten `@ajanadı` ile veya auto-route ile tetikler.

## Yarın 2 yeni ajan eklersem ne yapmalıyım?

### 1) Script dosyasını yaz

`agents/<ajan_adı>.py` — örnek iskelet:

```python
#!/usr/bin/env python3
# @description: FortiGate UTM + IPS politika analizcisi. Türkçe rapor verir.
# @brands: fortinet, fortigate
# @keywords: utm, ips, ssl-inspection, antivirus, web-filter
# @tags: netsec, perimeter
# @tools: -                # tool yok; "- copy_smith, echo" ile bağla
# @priority: 5             # 1=en yüksek, 9=en düşük; tie-break için
# @icon: shield-half
# @color: amber

from agents._shared.config_center import effective_system_prompt
from agents._shared.dispatch import call_tool  # tool çağıracaksan

# Sorgu STDIN'den gelir; sonuç STDOUT'a yazılır (Elara stream eder).
import sys
question = sys.stdin.read().strip()

system = effective_system_prompt()
# … MLX / OpenAI çağrısı …
print("…analiz raporu…")
```

Header satırları (`# @description`, `# @brands`, vb.) **operatör seviyesinde sözleşme** — DB'ye `meta.description`, `meta.rag.brands`, `meta.rag.keywords`, `meta.tags` olarak yazılır. UI'da elden de değiştirilebilir, ama header tek doğruluk kaynağıdır (`Scan Agents` her bastığında üzerine yazar).

### 2) Disk → DB upsert (Scan)

İki yol:

- **UI:** `/system-engine → Agents → Scan Agents` butonu.
- **Loopback API:** `curl -X POST http://127.0.0.1:3005/api/agents/scan-disk`

Her iki yol da `local-server/lib/agents-scan.mjs` içindeki `scanAgentsDir`'ı çağırır; `app_agents` + `agents` tablolarına upsert eder. Manifest header değişmediği sürece scan no-op'tur.

### 3) RAG binding + system_prompt ince ayar

`/system-engine → Agents` editöründe:

- **General** sekmesi → System Prompt (DB'deki `meta.systemPrompt`; header'daki değil; UI tek mercii).
- **Knowledge / RAG** sekmesi → `ragEnabled` switch + Brand chip seçimi + Keywords/alias listesi.
  - Brand'lar `knowledge_sources.brand` üzerinden DB'den gelir; chip ile çoklu seçim.
  - Keywords boşsa tüm scope; doluysa retrieval bu terimlerle daraltılır.

Tüm bu alanlar **UI tek mercii** — manuel SQL YASAK.

### 4) Chat smoke

- **Manuel:** chat'te `@[ajan_adı.py]` Modu ile (composer prefix `@`); ajan stream'lenir, telemetri Think + RAG + Total ms görünür.
- **Auto-route:** RAG paneli → **Agent Auto-Route** ON ise picker non-smalltalk sorular için en uygun ajanı seçer. Scoring (mem'de sabit):

  | Sinyal | Puan |
  |---|---|
  | brand match (`meta.rag.brands`) | +3 her marka |
  | keyword match (`meta.rag.keywords`) | +2 her terim |
  | tag match (`meta.tags`) | +1 her etiket |
  | description token match (`meta.description`) | +1 |
  | script/name token | +2 |

  Eşik = `agentAutoRouteMinScore` (UI knob, default 2). Altı: Elara doğrudan cevaplar.

### 5) Tool bağlama (opsiyonel)

Ajanın tool çağırması için:

- Header: `# @tools: echo, http_probe, dns_lookup`  (slug'lar `tools/` veya `action_library` ile eşleşmeli)
- Python: `from agents._shared.dispatch import call_tool` + `result = call_tool("echo", {"text": "hi"})`
- Loopback dispatch: `POST /api/agents/tool-call` (manifest gate'li).
- LLM tetikleme: model çıktısında `!slug({json})` satırı varsa `streamToolParse` knob'u açıksa parser otomatik çalıştırır.

Tool listesi ajanın system_prompt'una otomatik enjekte EDİLMEZ (varsayılan). UI'da operator manifesti elden yazar veya `RAG_SETTINGS.injectAgentToolsManifest` switch'i ile eski davranışı aç. Çerçeve metni `RAG Panel → Advanced · System Prompts → Agent · Tool Manifest Frame` üzerinden değiştirilebilir; placeholder `{TOOLS}` bulleted listeyi kabul eder.

## Prompt Katmanları (config_center.py)

Ajan çalıştığında `effective_system_prompt()` şu sırayla birleştirir:

```
[REALTIME CONTEXT]               (server now + user tz)
---
ELARA_AGENT_PACK_PROMPT           (capability_pack overlay, varsa)
---
meta.systemPrompt                 (UI'daki agent system prompt)
---
ELARA_AGENT_TOOLS → manifest      (tool listesi varsa; UI'dan frame override)
---
ELARA_AGENT_RAG_CONTEXT → hits    (RAG enabled + hits varsa; UI'dan with-hits directive override)
                       → no-hits  (RAG enabled + hits=0 ise; UI'dan no-hits directive override)
```

**UI tek mercii kuralı:** Hardcoded prompt katmanı YOK. RAG paneli "Advanced · System Prompts" accordion'undan 8 katmanın da metnini override edebilirsin (inspectorDirective, inspectorBrandLock, extractorSystemPrompt, hydeSystemPrompt, **plannerSystemPrompt**, agentRagWithHitsDirective, agentRagNoHitsDirective, agentToolsManifestFrame). Engine Hints altındaki **thinkOffPrefix** ile Qwen `/no_think` ön-ekini kontrol edersin. Boş bırakırsan kod-içi default devreye girer.

## Tool manifest UI'dan elden yazılır (Tur 2)

Backend'in `ELARA_AGENT_TOOLS` enjeksiyonu **default OFF** — operatör tool listesini agent system_prompt'una elden yazar. Açmak için:

1. RAG paneli → `Inject agent tools manifest` knob ON.
2. RAG paneli → "Agent · Tool Manifest Frame" PromptRow'a istediğin başlık + sözleşme metnini yaz. `{TOOLS}` placeholder'ı ajanın bağlı `# @tools: ...` listesi ile dolar; placeholder yazmazsan liste metnin sonuna eklenir.
3. Smalltalk turlarında otomatik bastırılması için `Suppress tool manifest on smalltalk` ON kalsın.

## Per-model Inspector Directive override (Tur 2)

`/models` editörü → "Inspector Directive (RAG override)" Textarea. Boş ise global RAG paneli `inspectorDirective` knob'u (boşsa kod-içi default) kullanılır. Modele özel cevap tonu/format yazmak istersen buraya yaz; `{BRAND_LOCK}` ve `{SOURCES}` placeholder'ları aynen çalışır. Hot-swap, restart YOK.

## Yaygın Hatalar

- **"Ajan timeout verdi":** `RAG Panel → Agent Exec Timeout` (default 180s). Slider 30s-300s. Bu süre dolarsa child process SIGKILL'lenir.
- **"Kaynak ismi vermiyor":** Ajanın `meta.rag.brands` ve/veya `meta.rag.keywords` listesi boş → retrieval scope yok → 0 hits → no-hits dalına düşer. Editör'den binding ekle.
- **"Think: --ms":** Telemetri ilk token gelmeden hesaplanamaz — agent_chunk akmadan kalırsa --. Stream'leniyorsa ilk chunk anında set olur.
- **"Hangi ajanlar var?":** `/system-engine → Agents` veya `curl http://127.0.0.1:3005/api/agents` (`app_agents` tablosu).

## Mem referansları

- `mem://decisions/agent-tool-awareness-2026-05-28.md` — tool manifest enjeksiyonu
- `mem://decisions/ui-only-tool-manifest-2026-06-03.md` — UI = tek mercii (tool manifest)
- `mem://decisions/system-prompts-ui-2026-06-03.md` — 4 hardcoded prompt UI'ya taşıma
- `mem://preference/no-hidden-backend-prompts.md` — backend gömülü prompt YASAĞI
- `mem://session/2026-06-03-agent-rag-timeout-sources-checkpoint.md` — agentExecTimeoutMs + minSupportSources=6
