# TESLİM PAKETİ — Chat Orkestrasyon + Kalıcılık + Vision

> Bu dosya **iki konunun tek giriş kapısıdır**. Canlı uygulamayı düzenleyen AI'a
> **önce bunu** verin; hangi dosyayı hangi sırayla göndereceği, her dosyanın
> canlı koda **eklenecek mi / değiştirilecek mi** olduğu ve SQL'in ne olduğu
> burada yazılı.
>
> **Konu 1 — Orkestrasyon:** sohbet sırasında agent'ın kendi kararıyla
> skill / tool / MCP çalıştırması, SSE ile canlı kartlar, yüksek riskli araçta
> onay kartı.
> **Konu 2 — Kalıcılık:** sohbet geçmişinin API'ye bağlanması, "Files in Chat"
> panelinin beslenmesi, resim/ses/PDF'in modele **Vision (array) formatında**
> gitmesi.

---

## 0. Altın kural — copy-paste yok, dosya bazlı taşıma var

Canlı kodun üstüne tam sayfa yapıştırma **yapılmayacak**. Taşıma üç kutuya ayrılır:

| Kutu | Ne yapılır | Risk |
| --- | --- | --- |
| **A · YENİ DOSYA** | Olduğu gibi kopyala, hiçbir şeye dokunma | Sıfır |
| **B · CERRAHİ EK** | Var olan dosyaya **sadece işaretli bloklar** eklenir | Düşük — anchor'lar aşağıda |
| **C · BACKEND** | SQL + REST uçları, frontend'e dokunmaz | Ayrı iş |

A kutusundaki 5 dosya kendi başına hiçbir şeyi bozmaz — import edilmedikçe ölü
koddur. Bu yüzden **önce A gider, uygulama build edilir, sonra B uygulanır.**

---

## 1. AI'a göndereceğin dosya listesi (sıralı)

### Adım 1 — Dokümanlar (bağlam)

```
docs/HANDOFF-CHAT-ORCHESTRATION.md          ← bu dosya (önce bu)
docs/MULTI-TURN-ORCHESTRATION-WIRING.md     ← Konu 1 detay + SSE sözleşmesi
docs/CHAT-PERSISTENCE-AND-VISION-WIRING.md  ← Konu 2 detay + REST sözleşmesi
```

### Adım 2 — Kutu A · YENİ DOSYALAR (5 adet, olduğu gibi kopyalanır)

| Dosya | Satır | Konu | Sorumluluk |
| --- | --- | --- | --- |
| `src/lib/orchestrate-stream.ts` | 263 | 1 | SSE sözleşmesi: `parseOrchestrateFrame`, `reduceActivity`, `streamOrchestrate`, `buildCapabilities`, `simulateOrchestrate` |
| `src/components/sovereign/tool-activity.tsx` | 152 | 1 | Araç çalıştırma şeridi (glassmorphic, jewel durum noktaları, staggered) |
| `src/components/sovereign/tool-approval-card.tsx` | 37 | 1 | Yüksek riskli araç için insan onay kartı |
| `src/lib/attachment-encode.ts` | 126 | 2 | `encodeAttachments`, `buildUserContent`, `buildWireMessages` (Vision array) |
| `src/lib/chat-api.ts` | 110 | 2 | `/api/chat/threads` REST istemcisi + DTO dönüşümü |

Bu beşi bağımsızdır, birbirini import etmez (tek istisna: `orchestrate-stream.ts`
sadece **type** olarak `WireMessage`'ı `attachment-encode.ts`'ten alır → ikisi
birlikte gitmeli).

### Adım 3 — Kutu B · CERRAHİ EK (2 dosya, tam kopya YASAK)

| Dosya | Satır | Ne değişecek |
| --- | --- | --- |
| `src/lib/chat-store.ts` | 308 | `pull` / `push` eklenir, `commit` sync parametresi alır |
| `src/routes/index.tsx` | 1232 | 6 anchor — aşağıdaki §3'te tek tek |

Bu ikisini **referans olarak** gönder ("çalışan sürüm böyle görünüyor") ama
canlıda uygulanacak şey §3'teki bloklardır.

### Adım 4 — Kutu C · BACKEND

```
db/chat_orchestration_schema.sql   ← her iki konunun TÜM tabloları, tek dosya
```

### Göndermeyeceklerin

`src/components/sovereign/composer.tsx`, `files-in-chat.tsx`, `shell.tsx`,
`src/lib/chat-store.ts`'in tamamı, tema/stil dosyaları — bunlarda **sözleşme
değişikliği yok**, canlıdaki sürümleri korunmalı.

---

## 2. Bağımlılık haritası (neyin neye ihtiyacı var)

```text
                    ┌──────────────────────────┐
   Konu 2 ──────────│ attachment-encode.ts (A) │───► WireMessage tipi
                    └────────────┬─────────────┘        │
                                 │                      ▼
                    ┌────────────▼─────────────┐  ┌──────────────────────┐
                    │ chat-api.ts (A)          │  │ orchestrate-stream.ts│ (A)
                    └────────────┬─────────────┘  └──────────┬───────────┘
                                 │                            │
                    ┌────────────▼─────────────┐   ┌──────────▼───────────┐
   Konu 2 ──────────│ chat-store.ts (B)        │   │ tool-activity.tsx (A)│
                    └────────────┬─────────────┘   │ tool-approval… (A)   │
                                 │                 └──────────┬───────────┘
                                 └───────────┬────────────────┘
                                             ▼
                                  ┌──────────────────────┐
                                  │ routes/index.tsx (B) │  ← tek entegrasyon noktası
                                  └──────────────────────┘
```

**Sonuç:** riskin %100'ü `src/routes/index.tsx` içindeki 6 anchor'da. Geri kalan
her şey yeni dosya.

---

## 3. `src/routes/index.tsx` — 6 anchor, tam olarak ne eklenecek

Aşağıdaki satır numaraları **bu repodaki çalışan sürüme** aittir; canlıda
farklı olacaktır, bu yüzden her anchor **arama metniyle** tarif edilmiştir.

### Anchor 1 — import'lar (satır 52-63 civarı)

```tsx
import { ToolActivityBlock } from "@/components/sovereign/tool-activity";
import { ToolApprovalCard } from "@/components/sovereign/tool-approval-card";
import {
  buildCapabilities,
  emptyActivity,
  hasCapabilities,
  reduceActivity,
  simulateOrchestrate,   // canlıda: streamOrchestrate
  type Capabilities,
  type ToolActivity,
} from "@/lib/orchestrate-stream";
import { buildWireMessages, encodeAttachments } from "@/lib/attachment-encode";
```

### Anchor 2 — mesaj tipine iki alan

`type Msg = { … }` bul, şunları ekle:

```tsx
  activity?: ToolActivity;
  approval?: { invocationId: string; toolName: string; reason: string; decided?: "approve" | "reject" };
```

Her ikisi de opsiyonel → eski mesajlar bozulmaz.

### Anchor 3 — `orchestrateBody` (yeni fonksiyon, satır ~431)

Component içine, `dispatch`'ten önce:

```tsx
  const orchestrateBody = (
    base: Msg[], agent: Agent | undefined, query: string, caps: Capabilities,
  ): OrchestrateRequest => ({
    message: query,
    messages: buildWireMessages(base, active?.context),  // ← Vision array burada üretilir
    capabilities: caps,
    threadId: active?.id,
    context: active?.context,
    agentId: agent?.id,
  });
```

### Anchor 4 — `runOrchestration` (yeni fonksiyon, satır ~445)

SSE olaylarını son agent mesajının `activity` alanına indirger. Mock'tan canlıya
geçiş **tek satır**:

```tsx
// ŞİMDİ (mock):
orchCancel.current = simulateOrchestrate(caps, onEvent, { approvalFor });

// CANLI:
const ac = new AbortController();
orchCancel.current = () => ac.abort();
void streamOrchestrate(orchestrateBody(base, agent, query, caps), onEvent, ac.signal);
```

`onEvent` gövdesi **değişmez** — mock ile canlı birebir aynı frame'leri üretir.

### Anchor 5 — `decideApproval` (yeni fonksiyon, satır ~483)

`POST /api/chat/approve` çağırır, kararı mesaja işler, onaylandıysa
`resumeInvocationId` ile akışı sürdürür.

### Anchor 6 — `dispatch` **async** olur (satır ~518)

Tek gerçek davranış değişikliği burada:

```tsx
-  const dispatch = (text: string, atts: Attachment[], mentions: Mention[] = []) => {
+  const dispatch = async (text: string, atts: Attachment[], mentions: Mention[] = []) => {
     const t = text.trim();
     if (!t && !atts.length) return;
+    // blob: URL reload'da ölür ve tarayıcıdan çıkamaz → base64 data URL
+    const encoded = atts.length ? await encodeAttachments(atts) : [];
-    const base: Msg[] = [...messages, { role: "user", text: t, files: atts }];
+    const base: Msg[] = [...messages, { role: "user", text: t, files: encoded }];
+    if (encoded.length) setFiles([...files, ...encoded]);   // ← Files in Chat rail
     setMessages(base);
+    const caps = buildCapabilities(mentions);
+    if (hasCapabilities(caps)) runOrchestration(base, agent, t, caps);
   };
```

> `dispatch` artık Promise döndürüyor. Çağıran taraf (`<Composer onSend=…>`)
> `void dispatch(…)` veya `onSend={(t,a,m) => { void dispatch(t,a,m); }}`
> şeklinde çağırmalı — aksi halde lint "floating promise" verir.

### Anchor 7 — render (satır ~1041)

Agent balonunun içine, thinking bloğunun **altına**:

```tsx
{m.activity && <ToolActivityBlock activity={m.activity} />}
{m.approval && !m.approval.decided && (
  <ToolApprovalCard approval={m.approval} onDecision={(d) => decideApproval(i, d)} />
)}
```

---

## 4. `src/lib/chat-store.ts` — cerrahi ek

Tek mimari kural: **desk (localStorage) = cache, API = otorite.**

```text
hydrate()  → localStorage'dan anında boya (UI hiç beklemez)
   └─ pull() → GET /api/chat/threads
        ├─ 200  → remote = true;  uzak satırlar üste yazılır,
        │          offline açılmış thread'ler POST ile yukarı itilir
        └─ hata → remote = false; desk otorite kalır → uygulama aynen çalışır
```

Eklenecek üç şey:

1. `let remote = false;` modül seviyesinde bayrak.
2. `async function pull()` ve `function push(t, sync)` — `chat-api.ts` çağırır.
3. `commit(next, sync?)` — mevcut `commit`'e ikinci parametre; **önce** desk'e
   yazar (anlık UI), sonra `remote` ise `push` eder. Ateşle-unut, `await` yok.

Mutasyon → uç eşlemesi:

| Store aksiyonu | sync | HTTP |
| --- | --- | --- |
| `newChat()`, `branch()` | `create` | `POST /api/chat/threads` |
| `setMessages()` | `messages` | `PUT /api/chat/threads/:id/messages` |
| `setFiles()` | `files` | `PUT /api/chat/threads/:id/files` |
| `rename()`, `autoTitle()`, `setContext()`, `togglePin()`, `setColor()` | `patch` | `PATCH /api/chat/threads/:id` |
| `remove()` | `delete` | `DELETE /api/chat/threads/:id` |

**Geri dönüş garantisi:** backend hiç yoksa `remote` daima `false` kalır ve tek
bir istek bile atılmaz → bugünkü davranış birebir korunur.

---

## 5. Backend'in sağlaması gereken uçlar

### Konu 2 — Kalıcılık (REST/JSON)

```http
GET    /api/chat/threads                 → { threads: ThreadDTO[] }
POST   /api/chat/threads                 → ThreadDTO           (201)
PATCH  /api/chat/threads/:id             → ThreadDTO
PUT    /api/chat/threads/:id/messages    ← { messages: [...] }
PUT    /api/chat/threads/:id/files       ← { files: [...] }
DELETE /api/chat/threads/:id             → 204
```

### Konu 1 — Orkestrasyon (SSE + onay)

```http
POST /api/chat/orchestrate    Accept: text/event-stream
POST /api/chat/approve        ← { invocationId, decision: "approve"|"reject" }
```

SSE frame'leri (`data: {json}\n\n`, `parseOrchestrateFrame` bunları okur):

```jsonc
{ "type": "tool_execution",  "tools": [{ "name": "vuln.scan", "kind": "tool" }] }
{ "type": "tool_status",     "name": "vuln.scan", "status": "running" }
{ "type": "tool_status",     "name": "vuln.scan", "status": "completed", "durationMs": 1840 }
{ "type": "agent_loop",      "iteration": 2 }
{ "type": "approval_required","invocationId": "inv_9f2a", "toolName": "fleet.reboot",
  "reason": "High-risk tool requires human approval." }
{ "type": "token",           "delta": "…" }        // opsiyonel metin akışı
{ "type": "error",           "message": "…" }
```

Kurallar: her 15 sn `: heartbeat\n\n`, kapanışta `data: [DONE]`,
`status` ∈ `pending|running|completed|failed|denied`.

### Vision gövdesi — `/api/chat/orchestrate` içindeki `messages`

Ek yoksa `content` düz string. **Bir tane bile ek varsa** tipli blok dizisi:

```jsonc
{ "role": "user", "content": [
  { "type": "text", "text": "Bu logda ne görüyorsun?" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBOR…" } }
]}
```

| Ek türü | Blok |
| --- | --- |
| `image` | `image_url.url` = `data:image/…;base64,…` veya **auth'suz erişilebilir** HTTPS link |
| `audio` | `input_audio.data` = **prefix'siz** ham base64, `format` = `webm\|m4a\|mp3\|wav` |
| `file` | `file.filename` + `file.file_data` = `data:application/pdf;base64,…` |

---

## 6. SQL

Tek dosya: **`db/chat_orchestration_schema.sql`** — iki konunun tüm tabloları,
enum'lar, index'ler, GRANT ve RLS politikaları, migration sırası dahil.

| Konu | Tablolar |
| --- | --- |
| 2 · Kalıcılık | `chat_thread`, `chat_message`, `chat_file` |
| 1 · Orkestrasyon | `orchestration_run`, `tool_invocation`, `tool_approval`, `tool_risk_policy` |

Kritik nokta — **her `create table` sonrası GRANT şart**, yoksa RLS doğru olsa
bile PostgREST izin hatası döner. Dosyada hepsi yazılı.

`owner_id` **daima oturumdan** alınır, asla request body'sinden. Sayfa guard'ı
`/api/*` uçlarını korumaz; her handler kimliği kendisi doğrular.

---

## 7. Uygulama sırası (AI'a bu sırayı dayat)

1. **Kutu A'daki 5 yeni dosyayı ekle. Başka hiçbir şeye dokunma. Build al.**
   → Build yeşilse ölü kod eklenmiş demektir, risk sıfır.
2. `chat-store.ts`'e §4'teki `pull`/`push`/`commit` ekini uygula. Build al.
   → Backend yokken uygulama **birebir eskisi gibi** çalışmalı. Doğrula.
3. `routes/index.tsx`'e Anchor 1 → 7'yi sırayla uygula. Her anchor'dan sonra build.
4. `db/chat_orchestration_schema.sql`'i migration olarak çalıştır.
5. REST uçlarını aç → sidebar geçmişi backend'den gelmeli (`remote = true`).
6. En son: `simulateOrchestrate` → `streamOrchestrate` tek satır değişimi.

Her adım geri alınabilir. 1-3 arası backend olmadan da güvenle canlıya çıkar.

---

## 8. Kabul kriterleri

**Konu 1**
- [ ] `#araç` mention'lı mesajda araç şeridi beliriyor, noktalar
      pending → running → completed geçiyor.
- [ ] `agent_loop` gelince iterasyon rozeti artıyor.
- [ ] Yüksek riskli araçta akış duruyor, onay kartı çıkıyor; REJECT'te araç
      `denied`, APPROVE'da `resumeInvocationId` ile devam ediyor.
- [ ] Sayfa değişince akış iptal oluyor (abort), sızıntı yok.

**Konu 2**
- [ ] `GET /api/chat/threads` 200 → geçmiş backend'den geliyor (tek istek).
- [ ] Backend kapalıyken uygulama çalışıyor — regresyon yok.
- [ ] Resim gönder → "Files in Chat" panelinde görünüyor, **reload sonrası da**.
- [ ] Orchestrate gövdesinde son user turu `content: [...]` dizisi ve
      `image_url.url` `data:image/…;base64,` ile başlıyor.
- [ ] 8 MB üstü dosya inline edilmiyor → storage yoluna düşüyor.
- [ ] Başka principal'in thread'i hiçbir uçtan okunamıyor (RLS + handler auth).
