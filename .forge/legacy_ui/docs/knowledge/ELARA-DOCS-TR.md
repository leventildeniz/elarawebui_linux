# ELARA — Proje Dokümantasyonu (Türkçe)

> Sürüm: 2026-07-06 · Sahip: Levent · Ortak: Cano (Lovable AI)
> Kod adı: **ELARA** — kişisel, yerel-öncelikli, AI destekli operasyon platformu.

---

## 1. Biz Bu Projede Ne Yaptık? (Vizyon, Yolculuk, Bugünkü Durum)

### 1.1 Amaç
ELARA, kullanıcının **manuel tool/agent/skill yazmadan**, doğal dilde iş tarif ettiği; sistemin gerekli **bileşik planı** (tool + skill + agent + capability pack) önerdiği, **kullanıcı onayıyla** forge edip çalıştırdığı bir platformdur. Kullanıcı **kod yazan değil onaycı**dır.

Kuzey Yıldızı örnekleri:
- "iPhone fiyatlarını karşılaştır" → `web_search + price_scrape + compare_table`
- "xxx.com güvenlik taraması" → `nmap + nikto + sslyze + vuln_report`
- "Bu FW'a bağlan konfig at" → `ssh_connect + fw_config_push + fw_operator ajanı`
- "Insta trendlerini çıkar" → `insta_fetch + trend_analyze + report skill`

### 1.2 Nasıl İlerledik (Kronoloji — özet)
1. **Temel altyapı**: TanStack Start + Bun middleware (`local-server/`) + PostgreSQL + MLX (Apple Silicon lokal LLM) + embed worker (Python).
2. **RAG boru hattı**: bge-m3 dense + FTS hybrid + bge-reranker-v2-m3 (multilingual) + Anthropic-tarzı **contextual enrichment** (her chunk brand+versiyon+title preamble).
3. **Ajan katmanı**: `agents/` disk-first Python ajanlar (NetSec 15, SocialMedia 10, Meta/forge_master). `_shared/mlx_runner.py` ortak koşucu.
4. **Tool/Skill katmanı**: `tools/` disk (allowlist, stdin/stdout JSON), `skills/` DB-first (LLM prompt gövdesi).
5. **Capability Registry**: `/system-engine` altında tek mercii — skill/tool/agent'ları capability slug'larıyla index'ler.
6. **UI = Tek Mercii kuralı**: Tüm promptlar, sampling knob'ları RAG panelinden yönetilir; backend'de gizli sözlük/regex YASAK.
7. **MCP (Model Context Protocol)**: Server (dışarı tool aç) + Client (dış MCP'yi ajana bağla) tamamlandı, badge'lerle UI'a işaretlendi.
8. **Meta-Forge**: Elara'nın kendi tool/agent/skill'ini üretmesi. Turn-1 cold-classifier bug'ı kapatıldı (semantic anchor retry + orchestrate safety-net).
9. **Approval katmanı**: Meta-Forge planları `/system-engine → Meta-Forge` sayfasında listelenir; admin onay/reject/rollback.

### 1.3 Nerede Kaldık (2026-07-06)
- ✅ Meta-Forge **tek capability** forge edip apply ediyor.
- ✅ Approval UI, rollback butonu, `forge_preview` + `forge_run_prompt` iki katmanlı onay.
- ✅ Ölü `capability/*` proposal hattı komple silindi (backend + UI).
- ✅ Delta race hardening (chat placeholder boş kalma bugu).
- ✅ İdempotency gate iki Meta-Forge yolunda (orchestrate + stream) hash bazlı.
- ❌ **Compound proposal** (bileşik plan — asıl kuzey yıldızı).
- ❌ **Auto-execute after approval**.
- ❌ **Internet-native execution helper** (`tools/_shared/http.py`).
- ❌ **Workflow / Chain builder** (DAG canvas).

### 1.4 Onaylı Yol Haritası
- **Faz A — Compound + Auto-Run** (3 mini-tur)
  - A1: Planner'a compound intent modu + JSON şeması (`{needs, missing, reuse}`)
  - A2: Approval UI'da "Approve & Run" — onay + otomatik execute + chat'e stream
  - A3: `tools/_shared/http.py` (requests + playwright fallback, Mac native ağ) + smoke
- **Faz B — Workflow / Chain Builder**
  - DAG üretimi (koşul/retry/paralel), `/workflows` canvas, tetikler (manuel/cron/webhook)
- **Faz C — İdempotency & dedup temizliği** (mimari değişince kalan artık)

---

## 2. Topoloji ve Mimari (Detaylı)

### 2.1 Fiziksel Topoloji
```
┌────────────────────────────────────────────────────────────┐
│ Mac (M5 Max, 128GB unified memory)                          │
│                                                              │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────────┐   │
│  │ Vite dev     │  │ Bun Middleware  │  │ PostgreSQL    │   │
│  │ (UI, TanStack│◄─┤ local-server/   │◄─┤ pgvector      │   │
│  │  Start)      │  │ port 3005       │  │ port 5432     │   │
│  └──────▲───────┘  └───────▲─────────┘  └───────────────┘   │
│         │                  │                                 │
│         │            ┌─────┴─────────┐   ┌────────────────┐  │
│         │            │ MLX Server    │   │ Embed Worker   │  │
│         │            │ (Python)      │   │ (Python, bge-m3│  │
│         │            │ port 8001     │   │  + reranker)   │  │
│         │            │ 72B/32B/27B   │   │ port 3006      │  │
│         │            └───────────────┘   └────────────────┘  │
│         │                                                    │
│         │   ┌──────────────────────────────────────────┐    │
│         └───┤ launchd (com.elara.middleware/vite/pg)   │    │
│             └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
        │
        │  (Mac native ağ — proxy/gateway YOK)
        ▼
   Internet (web fetch, MCP dış server'lar, external API)
```

### 2.2 Katmanlı Mantıksal Mimari
```
┌────────────────────────────────────────────────────────────┐
│  UI (React 19 + TanStack Start + Tailwind v4)               │
│   /chat  /knowledge  /system-engine  /meta-forge  /workflows│
├────────────────────────────────────────────────────────────┤
│  Middleware (Bun, server.mjs → lib/routes/*)                │
│   • Auth (session gate)  • RBAC  • Mutation guard           │
│   • Chat orchestrate + stream (SSE)                         │
│   • RAG orchestration (probe → rewrite → retrieve → rerank) │
│   • Agent bridge (spawn Python ajanı)                       │
│   • Meta-Forge (plan → apply → refresh capabilities)        │
│   • MCP server/client, Capability registry                  │
├────────────────────────────────────────────────────────────┤
│  Backends (child processes)                                 │
│   • MLX (chat completions / embeddings model host)          │
│   • Embed worker (bge-m3 embed + bge-reranker-v2-m3)        │
│   • Python ajanları (spawn-on-demand, stdout SSE bridged)   │
├────────────────────────────────────────────────────────────┤
│  Storage                                                    │
│   • Postgres: knowledge_chunks (pgvector) + agents/tools/   │
│     skills/capabilities/forge_plans/audit_chain/mcp_*       │
│   • Disk: agents/ tools/ skills/ knowledge sources          │
│   • ~/.elara/state/*.json (brand-aliases, runtime state)    │
└────────────────────────────────────────────────────────────┘
```

### 2.3 Sohbetin Uçtan Uca Akışı
```
Kullanıcı prompt
   ▼
UI /chat → POST /api/chat/orchestrate (SSE)
   ▼
[1] Intent classifier (semantic anchors + LLM adjudicator)
    → smalltalk | rag | meta | meta_forge | agent_manifest
   ▼
[2] Lane seçimi
    ├── smalltalk → doğrudan MLX (free-answer)
    ├── rag       → probe → denoise → HyDE expand → vector+FTS →
    │               rerank (bge-reranker-v2-m3) → inspector directive
    │               → MLX stream
    ├── agent     → agent-bridge → spawn python agent → stdout SSE
    ├── meta_forge→ Meta/forge_master.py → ForgePlan JSON →
    │               idempotency gate → apply → refresh caps → onay
    └── meta      → agents-manifest tanıtım
   ▼
SSE frames: delta / rag.hit / forge_plan / forge_preview /
            tool_call / agent_done / rag.fallback / done
   ▼
UI render (chat.tsx delta buffer + inline kartlar)
```

---

## 3. Dosya Haritası (High-Level + Low-Level)

### 3.1 High-Level (klasörler)
| Yol | Amaç |
|---|---|
| `src/routes/` | UI route'ları (TanStack file-based) |
| `src/components/` | Yeniden kullanılabilir UI parçaları |
| `src/lib/` | Client store'lar, yardımcılar |
| `local-server/server.mjs` | Bun middleware boot |
| `local-server/lib/routes/` | HTTP endpoint'ler (modüler) |
| `local-server/lib/rag/` | RAG boru hattı |
| `local-server/lib/meta-forge/` | Elara self-authoring |
| `local-server/lib/mcp/` | MCP server + client |
| `local-server/lib/agents/` | Ajan spawn, env, RAG bridge |
| `local-server/migrations/` | SQL migration'lar |
| `local-server/scripts/` | CLI smoke/debug/kickstart |
| `agents/` | Python ajanları (NetSec, SocialMedia, Meta) |
| `tools/` | Python tool implementasyonları |
| `skills/` | Rezerv (skill body DB'de) |
| `mem/` | Kalıcı proje hafızası (rules) |

### 3.2 Low-Level (kritik dosyalar)

**UI**
- `src/routes/__root.tsx` — kök layout, head metadata
- `src/routes/_app.tsx` — auth layout (sidebar + top-bar)
- `src/routes/_app.chat.tsx` — ana sohbet arayüzü (SSE consumer, delta buffer, inline forge/tool kartları)
- `src/routes/_app.knowledge.tsx` — kütüphane + RAG paneli (tüm knob'lar)
- `src/routes/_app.system-engine.tsx` — Capabilities, Agents, Runtime Safety, Meta-Forge log
- `src/routes/_app.meta-forge.tsx` — Meta-Forge plan listesi + approve/reject/rollback
- `src/routes/_app.tools.tsx` / `.skills.tsx` / `.agents.tsx` — CRUD editörleri
- `src/routes/_app.mcp.tsx` — MCP server exposures + client server'lar
- `src/routes/_app.workflows.tsx` — Faz B için kabuk (canvas henüz yok)
- `src/routes/_app.forge.tsx` — Action Library editörü (klasik forge; meta-forge ile karışmasın)

**Middleware — Chat/RAG**
- `local-server/server.mjs` — express app, boot, migrate, launch child processes
- `local-server/lib/routes/chat-orchestrate.mjs` — ana orchestrate lane
- `local-server/lib/routes/chat-stream.mjs` — pure stream lane
- `local-server/lib/rag/intent-classifier.mjs` — semantic + LLM adjudicator
- `local-server/lib/rag/*.mjs` — probe, rewrite, retrieve, rerank, defaults
- `local-server/lib/mlx-transport.mjs` — MLX'e tek transport (state machine, self-heal, invariants)
- `local-server/lib/mlx-queue.mjs` — single-flight queue (slot leak fix)

**Middleware — Meta-Forge**
- `local-server/lib/meta-forge/planner.mjs` — plan şeması + inventory
- `local-server/lib/meta-forge/apply.mjs` — plan → disk+DB
- `local-server/lib/meta-forge/refresh.mjs` — capabilities re-sync
- `local-server/lib/meta-forge/idempotency.mjs` — hash gate
- `local-server/lib/routes/meta-forge.mjs` — HTTP endpoint'leri

**Middleware — MCP**
- `local-server/lib/mcp/*.mjs` — JSON-RPC 2.0 çekirdeği
- `local-server/lib/mcp/client.mjs` — dış MCP server'lara istemci
- `local-server/lib/routes/mcp.mjs` — `/mcp` + admin API

**Middleware — Ajan hattı**
- `local-server/lib/agent-bridge.mjs` — spawn + stdout SSE
- `local-server/lib/agent-env.mjs` — `ELARA_AGENT_TOOLS` manifest inject
- `local-server/lib/agent-rag.mjs` — ajan-tarafı RAG fetch (dilsiz)
- `local-server/lib/agents-manifest.mjs` — dinamik agent tanıtım

**Python**
- `agents/_shared/mlx_runner.py` — ortak koşucu (chat template, streaming)
- `agents/_shared/dispatch.py` — `call_tool()` loopback dispatch
- `agents/_shared/config_center.py` — env → tools/sources block
- `agents/Meta/forge_master.py` — Meta-Forge planlayıcı ajan
- `agents/NetSec/*.py` — 15 ağ güvenliği uzmanı
- `agents/SocialMedia/*.py` — 10 sosyal medya rolü

**DB**
- `local-server/schema.sql` — kök şema
- `local-server/migrations/*.sql` — sıralı migration'lar
- Boot DDL self-heal `lib/db.mjs` + `lib/migrate.mjs` içinde

---

## 4. Tasarım Detayı: RAG, Ajanlar, Workflow

### 4.1 RAG Topolojisi
```
Sorgu
  ▼
[Intent classifier] → smalltalk ise RAG atlanır
  ▼
[Pre-RAG deadline gate] (default 6s, timeout → free-answer)
  ▼
[Probe] — bge-m3 dense embedding, HNSW top-k
  │   • perSourceCap=3 (aynı dosyadan max 3 chunk)
  │   • perBrandCap=6  (aynı brand'den max 6 chunk)
  │   • diversityPool=200 aday
  │   • minChunkChars=100 (küçük fragman filtresi)
  ▼
[Karar] probe.top1 vs injectThreshold
  ├── < threshold  → strict gate: FTS-only ve reranker BOTH kapalı
  └── ≥ threshold  → devam
  ▼
[Denoise + Rewrite] LLM ile query temizleme (typo, smalltalk kalıntısı)
  ▼
[HyDE Expand] konu genişletme (vendor-agnostik)
  ▼
[Retrieve] vector + FTS hybrid, RRF fusion
  │   coverage = max(content_hits, 0.5*metadata_hits)
  ▼
[Rerank] bge-reranker-v2-m3 (multilingual XLM-R, MPS)
  ▼
[Confidence gate] rerankSafe OR coverageSafe OR brandSafe → inject
  ▼
[Dominant Brand Lock] rows ≥70% tek satıcı → prompt'a Rule 6 eklenir
  ▼
[Inspector directive] system prompt'a satırlar + kaynak referansları
  ▼
MLX stream
```

**Contextual Enrichment (Anthropic pattern)**: `enrich-structured-chunks.mjs` HER chunk'a `Brand + Version + Title` preamble prepend eder. Böylece embed vektörü versiyon/marka token'ını doğal taşır — statik regex/whitelist gerekmez.

**Free-answer library-aware**: RAG hit yoksa iki ton:
- `in-library miss` (matched brand var, context yok) → "kütüphanemde X var ama bağlam yok"
- `out-of-library` (top-5 scope) → "kütüphane scope'u: A,B,C; kendi bilginle cevap ver"

### 4.2 Ajan Mimarisi
```
Kullanıcı → Chat → intent=agent → agent-bridge
  ▼
spawn python <agent.py>   (env: ELARA_AGENT_MODEL, ELARA_AGENT_TOOLS,
                                 ELARA_AGENT_SOURCES, PROMPT)
  ▼
agents/_shared/mlx_runner.py
  ├── chat template (qwen2.5 / chatml / llama3 / gemma4)
  ├── streaming stdout → SSE proxy
  └── !<tool_slug>({json})  parser (post-stream)
       ▼
       POST /api/agents/tool-call (loopback, manifest gate)
         ▼
         tools/<slug>.py stdin JSON → stdout JSON
         ▼
       SSE tool_call event → UI ToolTrace kartı
```

**Squad orkestrasyon** (`agents/*/orchestrator.py`): squad-içi koordinasyon; audit-chain otomatik yazılır.

**Meta ajanı (Meta/forge_master.py)**: Elara kendi capability'sini üretir. Inventory çeker → LLM plan üretir → `POST /api/meta-forge/plans` → admin apply.

### 4.3 Workflow (Faz B — henüz kod yok)
Tasarım:
- `workflow_defs` tablosu (nodes + edges JSON DAG)
- Node tipleri: `tool.call`, `agent.spawn`, `skill.render`, `branch`, `parallel`, `retry`
- Tetikleyiciler: manuel / cron (pg_cron) / webhook (`/api/public/webhook/*`)
- Canvas: `/workflows` (React Flow benzeri lib düşünülüyor)

### 4.4 Tool / Skill / Capability
- **Tool** — disk-first (`tools/<slug>.py`), stdin/stdout JSON, allowlist gates, contract JSON `local-server/tools/contracts/`.
- **Skill** — DB-first (`skills` tablosu), body = LLM system prompt fragment. `skills/` klasörü rezerv.
- **Capability** — slug ile bağlanır. `capability_packs` sektörel tema (NetSec pack, SocialMedia pack).
- **Registry UI** — `/system-engine → Capabilities` tab. Admin-only. Re-sync from sources butonu.

---

## 5. Roadmap ve Son Karşılaşılan Sorunlar

### 5.1 Roadmap (Onaylı)
| Faz | İş | Durum |
|-----|-----|-------|
| A1 | Compound proposal JSON şeması + planner mod | Bekliyor |
| A2 | Approval UI "Approve & Run" + auto-execute | Bekliyor |
| A3 | `tools/_shared/http.py` (Mac native web) + smoke | Bekliyor |
| B  | Workflow/Chain builder (DAG + canvas) | Bekliyor |
| C  | İdempotency temizlik artıkları | Ertelendi (A+B sonrası) |

### 5.2 Son Karşılaşılan Sorunlar (Kronolojik)
1. **Turn-1 Meta-Forge açılmıyordu** (cold-classifier + `assistant_meta_text` bypass).
   - Fix: `hasCreationVerb` guard'ı ("yap/oluştur/create/build") → meta bypass'ı iptal.
   - Fix: Anchor embed retry (budget 3.5s, 250ms adım).
   - Fix: orchestrate safety-net retry (`intentClassifyReason` cold set'inde).
2. **Chat delta race** — placeholder boş kalıyordu, refresh sonrası geliyordu.
   - Fix: `assistantIdRef` swap + `flushSync` + boş-bubble fallback text.
3. **İdempotency gate ateşlemiyordu** — aynı prompt 3 yeni plan üretti.
   - Sebep: gate sadece orchestrate lane'de vardı, agent-bridge Meta-Forge yolu bypass ediyordu.
   - Fix: her iki lane (orchestrate + stream) + apply.mjs `intent_hash` stamp uyumlu.
4. **Ölü capability/* proposal hattı** — Meta-Forge devraldıktan sonra dead code kaldı.
   - Fix: 11 dosya sildik, wiring temizledik, drop migration.
5. **Latency 43-52s** — kabul edildi (memory-bandwidth limited, GPU %99). Model DEĞİŞMEZ.

### 5.3 Şu Anki Açık Konular
- Compound proposal (mimari sıçrama — Faz A).
- Auto-execute after approval.
- Internet-native tool helper.
- Workflow DAG builder.

---

## 6. Menü Rehberi (Hangi Sayfa Ne İşe Yarar?)

| Menü | Route | Amaç |
|------|-------|------|
| **Dashboard** | `/dashboard` | Sistem sağlığı, son çalıştırmalar, kısayollar |
| **Chat** | `/chat` | Ana sohbet arayüzü. Prefix: `@`=agent, `!`=skill, `/`=tool |
| **Knowledge** | `/knowledge` | Kütüphane yönetimi + **RAG paneli** (tüm knob'ların tek mercii) |
| **Knowledge → Aliases** | `/knowledge/aliases` | Brand alias'ları (UI-managed, JSON edit YASAK) |
| **Capabilities** | `/capabilities` | Kayıtlı capability slug'ları, tag'ler |
| **Agents** | `/agents` | Python ajan CRUD (disk-first), header sidecar |
| **Tools** | `/tools` | Tool contract editörü, brain picker per-tool |
| **Skills** | `/skills` | Skill body editörü (LLM prompt), DB-first |
| **Forge** | `/forge` | Klasik Action Library editörü (meta-forge ile karıştırma) |
| **Meta-Forge** | `/meta-forge` | Elara'nın önerdiği plan listesi + approve/reject/rollback |
| **MCP** | `/mcp` | Server exposures + Client (dış MCP) yapılandırma |
| **Workflows** | `/workflows` | Faz B kabuğu (DAG canvas gelecek) |
| **Orchestration** | `/orchestration` | Squad koordinasyon görünümü |
| **Planner** | `/planner` | LLM planlayıcı yardımı (test aracı) |
| **Approvals** | `/approvals` | Bekleyen onaylar merkezi |
| **Models** | `/models` | Model registry (MLX + cloud transport'lar) |
| **Adapters** | `/adapters` | Vendor adapter dictionary'ler (RADIUS vb.) |
| **Middleware** | `/middleware` | Middleware/worker durumu, restart butonları |
| **System-Engine** | `/system-engine` | Capabilities re-sync, Runtime Safety, Meta-Forge log, Agents scan |
| **Policies** | `/policies` | RBAC + execution policy'leri |
| **Users** | `/users` | Kullanıcı yönetimi (Admin) |
| **Security** | `/security` | Güvenlik denetim/scan görünümü |
| **CVE** | `/cve` | CVE watcher listesi |
| **Reports** | `/reports` | PDF rapor generator |
| **Templates** | `/templates` | Prompt/template yönetimi |
| **Targets** | `/targets` | Hedef envanteri (FW, host vb.) |
| **Live Call** | `/live-call` | Canlı ses/WS test aracı |
| **Python** | `/python` | Python interpreter registry |
| **Telemetry** | `/telemetry` | Anlık telemetri (TTFT, tok/s, RAG ms) |
| **Debug** | `/debug` | Debug live stream (SSE audit ticker) |
| **Settings** | `/settings` | Genel ayarlar |

---

## Ek — Kritik Kurallar (Değişmez)
1. **UI = Tek Mercii**: Tüm prompt/sampling/knob → RAG paneli. Backend'de gizli sözlük/regex YASAK.
2. **Her şey dinamik**: Statik whitelist/seed JSON/kafadan brand listesi YASAK.
3. **Plan-first**: Onaysız kod basılmaz.
4. **Mac native ağ**: Proxy/API-gateway wrapper YASAK — Mac zaten internete bağlı.
5. **Kullanıcı = onaycı**, kod yazan DEĞİL.
6. **AI = takım arkadaşı**: itiraz meşru, aşırı uysallık yasak.

_Son güncelleme: 2026-07-06 · `mem://roadmap/elara-north-star-2026-07-06.md` kaynak._
