# Chat Persistence + Files in Chat + Vision (Multimodal) — Wiring Kılavuzu

Bu doküman üç işi kapsar:

1. **Sohbet geçmişinin API'ye bağlanması** (`localStorage` → `GET/POST /api/chat/threads`)
2. **"Files in Chat" panelinin beslenmesi** (attachment → thread state)
3. **Vision desteği** — resim/dosyanın `/api/chat/orchestrate` gövdesine
   **OpenAI multimodal array** formatında gitmesi

Multi-turn araç çalıştırma (tool/skill/MCP + approval) sözleşmesi ayrı dosyada:
`docs/MULTI-TURN-ORCHESTRATION-WIRING.md`.

---

## 0. Ne değişti (bu turda uygulanan kod)

| Dosya | Durum | Sorumluluk |
| --- | --- | --- |
| `src/lib/attachment-encode.ts` | **yeni** | Blob → base64 data URL, `buildUserContent`, `buildWireMessages` |
| `src/lib/chat-api.ts` | **yeni** | `/api/chat/threads` REST istemcisi, DTO dönüşümleri, soft-fail |
| `src/lib/chat-store.ts` | güncellendi | Desk (localStorage) artık **cache**; API cevap verirse otorite backend |
| `src/routes/index.tsx` | güncellendi | `dispatch` async — attachment'ları encode eder, `thread.files` + `message.files` besler, `orchestrateBody` ile vision payload üretir |
| `src/lib/orchestrate-stream.ts` | güncellendi | `OrchestrateRequest.messages: WireMessage[]` + `resumeInvocationId` |

---

## 1. Sohbet geçmişi (Threads & Messages)

### 1.1 Mimari: desk = cache, API = otorite

```text
useChats()
  └─ hydrate()                     ← senkron, localStorage'dan anında boyar
        └─ pull()  (async)         ← GET /api/chat/threads
              ├─ 200 → remote = true; uzak satırlar desk'in üstüne yazılır
              │        offline yazılmış local-only thread'ler POST ile yukarı itilir
              └─ hata/404 → remote = false; desk otorite kalır (uygulama çalışmaya devam eder)
```

Her mutasyon `commit(next, sync)` üzerinden geçer. `commit` **önce** desk'e yazar
(anlık UI), sonra `push()` ile backend'i aynalar. `remote === false` iken hiçbir
istek atılmaz — yani backend yokken uygulama bugünkü davranışını korur.

`Sync` tipleri ve karşılık gelen uçlar:

| Store aksiyonu | Sync | HTTP |
| --- | --- | --- |
| `newChat()`, `branch()` | `create` | `POST /api/chat/threads` |
| `setMessages()` | `messages` | `PUT /api/chat/threads/:id/messages` |
| `setFiles()` | `files` | `PUT /api/chat/threads/:id/files` |
| `rename()`, `autoTitle()`, `setContext()`, `togglePin()`, `setColor()` | `patch` | `PATCH /api/chat/threads/:id` |
| `remove()` | `delete` | `DELETE /api/chat/threads/:id` |

### 1.2 REST sözleşmesi

Tüm uçlar oturum çerezini/bearer'ı kullanır ve **yalnızca** çağıran principal'in
satırlarını döndürür.

```http
GET /api/chat/threads
200 { "threads": [ ThreadDTO, … ] }        # veya düz dizi — istemci ikisini de kabul eder
```

```jsonc
// ThreadDTO
{
  "id": "chat_1756200000000",
  "title": "Fleet rebalance · atlas",
  "pinned": false,
  "color": "sapphire",              // none|sapphire|emerald|amethyst|topaz|ruby
  "createdAt": 1756200000000,       // epoch ms
  "context": "thread-level system context",
  "branchedFrom": "chat_175619…",
  "titleLocked": true,
  "files": [ ChatFile, … ],
  "messages": [ ChatMessage, … ]
}
```

```http
POST   /api/chat/threads                    body: ThreadDTO            → 201 ThreadDTO
PATCH  /api/chat/threads/:id                body: Partial<ThreadDTO>   → 200 ThreadDTO
PUT    /api/chat/threads/:id/messages       body: { messages: [...] }  → 200 { ok: true }
PUT    /api/chat/threads/:id/files          body: { files: [...] }     → 200 { ok: true }
DELETE /api/chat/threads/:id                                           → 204
```

`ChatMessage` alanları (`src/lib/chat-store.ts`): `role` (`user|agent`), `text`,
`files[]`, `thinking`, `telemetry`, `activity`, `retrieval`, `compaction`,
`proposals`, `approval`. Backend bunları **olduğu gibi** `jsonb` saklayabilir;
zorunlu olanlar yalnızca `role` ve `text`.

`ChatFile`: `{ id, name, size, kind: "image"|"file"|"audio", mime, url }` —
`url` bir `data:` URL (küçük dosya) veya storage'daki kalıcı bir URL'dir.

### 1.3 Bu repoda sunuluyorsa (TanStack server routes)

```text
src/routes/api/chat/threads.ts                    GET, POST
src/routes/api/chat/threads.$id.ts                PATCH, DELETE
src/routes/api/chat/threads.$id.messages.ts       PUT
src/routes/api/chat/threads.$id.files.ts          PUT
src/routes/api/chat/orchestrate.ts                POST (SSE)
src/routes/api/chat/approve.ts                    POST
```

Kalıp:

```ts
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/threads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await requireUser(request);        // route guard değil, gerçek auth
        return Response.json({ threads: await listThreads(userId) });
      },
      POST: async ({ request }) => {
        const userId = await requireUser(request);
        const dto = await request.json();
        return Response.json(await upsertThread(userId, dto), { status: 201 });
      },
    },
  },
});
```

> Uyarı: sayfa guard'ı `/api/*` uçlarını korumaz. Her handler kimliği kendisi
> doğrulamalı. `owner_id`'yi **body'den değil**, oturumdan alın.

### 1.4 Payload büyüklüğü

Resimler `data:` URL olarak mesajın içinde durur. Bir thread'in tüm transkriptini
her turda `PUT` etmek büyük gövdeler üretir. Üretimde iki iyileştirme:

- Dosyaları object storage'a yükleyip `ChatFile.url`'i **kalıcı/signed URL** yapın
  (`INLINE_LIMIT_BYTES = 8 MB` üstü zaten inline edilmiyor).
- `PUT …/messages` yerine `POST …/messages` ile **append** semantiği kullanın;
  istemci tarafında `setMessages` çağrısına son mesajı göndermek yeterlidir.

---

## 2. "Files in Chat" paneli

### 2.1 Sorun neydi

`useComposerAttachments` her dosya için `URL.createObjectURL(file)` üretiyordu.
Bu `blob:` URL'i:

- `JSON.stringify` ile desk'e yazılınca **ölü bir string** olur (reload'da 404),
- backend'e gönderilemez (tarayıcı bellek referansı),
- panel bir sonraki açılışta boş görünür.

### 2.2 Çözüm

`dispatch` artık **async** ve gönderimden önce her attachment'ı base64'e bakar:

```tsx
const dispatch = async (text: string, atts: Attachment[], mentions: Mention[] = []) => {
  const t = text.trim();
  if (!t && !atts.length) return;

  // Blob URL'ler reload'da ölür ve tarayıcıdan çıkamaz → data URL'e çevir
  const encoded = atts.length ? await encodeAttachments(atts) : [];

  const base: Msg[] = [...messages, { role: "user", text: t, files: encoded }];
  if (encoded.length) setFiles([...files, ...encoded]);   // ← Files in Chat rail
  setMessages(base);                                       // ← mesaj balonundaki ekler
  …
};
```

`setFiles` → `chat-store.setFiles` → `PUT /api/chat/threads/:id/files`.
Panel (`files-in-chat.tsx`) `active.files` okuduğu için artık hem anında dolar
hem de reload/oturum sonrası kalıcıdır.

`encodeAttachments` (`src/lib/attachment-encode.ts`):

- `data:` ile başlayan URL'leri tekrar kodlamaz (idempotent),
- `> 8 MB` dosyaları inline etmez (object URL'iyle bırakır — storage'a yüklenmeli),
- okuma hatasında dosyayı düşürmez, orijinal kaydı korur.

---

## 3. Vision / multimodal format

### 3.1 Kural

Bir turda **hiç ek yoksa** `content` düz string kalır (en ucuz şekil).
**Bir tane bile ek varsa** `content` tipli blok dizisine döner:

```jsonc
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Bu resimde ne görüyorsun?" },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/4AAQ…" } }
  ]
}
```

Blok eşlemesi (`buildUserContent`):

| Attachment `kind` | Üretilen blok |
| --- | --- |
| `image` | `{ "type": "image_url", "image_url": { "url": "data:image/…;base64,…" } }` |
| `audio` | `{ "type": "input_audio", "input_audio": { "data": "<base64>", "format": "webm\|mp3\|wav\|m4a" } }` — **prefix'siz** ham base64 |
| `file` (pdf/doc/…) | `{ "type": "file", "file": { "filename": "rapor.pdf", "file_data": "data:application/pdf;base64,…" } }` |

Güvenlik ağı: dizi asla metinsiz kalmaz — kullanıcı yalnızca dosya attıysa
`"Analyse the attached file(s)."` metin bloğu başa eklenir (modeller içeriksiz
turu reddeder).

### 3.2 Gönderilen gövde

`src/routes/index.tsx` içindeki `orchestrateBody`:

```tsx
const orchestrateBody = (base, agent, query, caps): OrchestrateRequest => ({
  message: query,                                   // düz metin kolaylık kopyası
  messages: buildWireMessages(base, active?.context), // TAM transkript, multimodal
  capabilities: caps,
  threadId: active?.id,
  context: active?.context,
  agentId: agent?.id,
});
```

`buildWireMessages`:
- `thread.context` doluysa başa `{ role: "system", content: … }` koyar,
- `role: "agent"` → `role: "assistant"` çevirir,
- her user turunu `buildUserContent(text, files)` ile kodlar.

Canlıya alırken `runOrchestration` içindeki tek satır:

```tsx
orchCancel.current = simulateOrchestrate(caps, onEvent, …);
// →
const ac = new AbortController();
orchCancel.current = () => ac.abort();
void streamOrchestrate(orchestrateBody(base, agent, query, caps), onEvent, ac.signal);
```

### 3.3 Backend tarafı beklentisi

- `req.body.messages` doğrudan model sağlayıcısına iletilebilir (OpenAI-uyumlu).
- Yalnızca modelin desteklediği modaliteyi geçirin; desteklenmeyen blok 400 döner.
- `image_url.url` bir HTTPS linki de olabilir; ama link **auth'suz erişilebilir**
  olmalıdır. Kendi storage'ınızdaki dosya için signed URL üretin, aksi halde
  base64 inline gönderin.
- Bir istekte çok sayıda **link** taşımayın (sağlayıcı limiti düşüktür); çoklu
  görselde base64 inline tercih edin.
- Ses: `input_audio.data` **base64 gövdesi**, `data:` prefix'i olmadan; `format`
  container'dır (`MediaRecorder` Chrome/Firefox → `webm`, Safari → `m4a`).

---

## 4. SQL şeması

```sql
-- =====================================================================
-- Chat persistence · schema v1
-- =====================================================================

create type chat_color as enum ('none','sapphire','emerald','amethyst','topaz','ruby');
create type chat_role  as enum ('user','agent','system');
create type chat_file_kind as enum ('image','file','audio');

-- Thread ---------------------------------------------------------------
create table public.chat_thread (
  id            text primary key,                 -- istemci üretir: chat_<epoch>
  owner_id      uuid not null,                    -- auth.users(id)
  title         text not null default 'New chat',
  title_locked  boolean not null default false,
  pinned        boolean not null default false,
  color         chat_color not null default 'none',
  context       text,                             -- thread-level pinned system context
  branched_from text references public.chat_thread(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index chat_thread_owner_idx on public.chat_thread (owner_id, pinned desc, created_at desc);

-- Message --------------------------------------------------------------
create table public.chat_message (
  id          uuid primary key default gen_random_uuid(),
  thread_id   text not null references public.chat_thread(id) on delete cascade,
  seq         int  not null,                      -- transkript sırası (0..n)
  role        chat_role not null,
  text        text not null default '',
  -- UI zenginlikleri: thinking, telemetry, activity, retrieval, compaction,
  -- proposals, approval — şema kilitlemeden saklanır
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (thread_id, seq)
);
create index chat_message_thread_idx on public.chat_message (thread_id, seq);

-- Dosyalar (hem thread rail'i hem mesaj ekleri) -------------------------
create table public.chat_file (
  id          text primary key,                   -- istemci attachment id
  thread_id   text not null references public.chat_thread(id) on delete cascade,
  message_id  uuid references public.chat_message(id) on delete cascade,  -- null = sadece rail
  name        text not null,
  size_bytes  bigint not null default 0,
  kind        chat_file_kind not null,
  mime        text,
  storage_key text,                               -- object storage yolu (tercih edilen)
  data_url    text,                               -- küçük dosyalar için inline base64
  sha256      text,
  created_at  timestamptz not null default now()
);
create index chat_file_thread_idx  on public.chat_file (thread_id, created_at desc);
create index chat_file_message_idx on public.chat_file (message_id);

-- updated_at tetikleyicisi ---------------------------------------------
create or replace function public.touch_chat_thread() returns trigger
language plpgsql as $$
begin
  update public.chat_thread set updated_at = now() where id = new.thread_id;
  return new;
end $$;

create trigger chat_message_touch after insert or update on public.chat_message
  for each row execute function public.touch_chat_thread();
```

### 4.1 Grant + RLS

```sql
grant select, insert, update, delete on public.chat_thread  to authenticated;
grant select, insert, update, delete on public.chat_message to authenticated;
grant select, insert, update, delete on public.chat_file    to authenticated;
grant all on public.chat_thread, public.chat_message, public.chat_file to service_role;

alter table public.chat_thread  enable row level security;
alter table public.chat_message enable row level security;
alter table public.chat_file    enable row level security;

create policy "own threads" on public.chat_thread
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "own messages" on public.chat_message
  for all to authenticated
  using (exists (select 1 from public.chat_thread t
                 where t.id = chat_message.thread_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.chat_thread t
                 where t.id = chat_message.thread_id and t.owner_id = auth.uid()));

create policy "own files" on public.chat_file
  for all to authenticated
  using (exists (select 1 from public.chat_thread t
                 where t.id = chat_file.thread_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.chat_thread t
                 where t.id = chat_file.thread_id and t.owner_id = auth.uid()));
```

Ownership Plane (`src/lib/ownership.ts`) ile hizalı: thread'ler daima `private`;
paylaşım isteniyorsa `chat_thread`'e `visibility` + `shared_with uuid[]` eklenip
policy `or shared_with && array(select group_id …)` ile genişletilir.

### 4.2 `PUT …/messages` sunucu tarafı (idempotent replace)

```sql
begin;
delete from public.chat_message where thread_id = $1;
insert into public.chat_message (thread_id, seq, role, text, meta)
select $1, ord - 1, (m->>'role')::chat_role, coalesce(m->>'text',''),
       (m - 'role' - 'text')
from jsonb_array_elements($2::jsonb) with ordinality as t(m, ord);
commit;
```

Append semantiğine geçilirse `seq = (select coalesce(max(seq)+1,0) …)` yeterlidir.

---

## 5. Kontrol listesi

- [ ] `GET /api/chat/threads` 200 dönüyor → sidebar geçmişi backend'den geliyor
      (DevTools > Network'te tek istek, `remote = true`).
- [ ] Backend kapalıyken uygulama hâlâ çalışıyor (desk fallback) — regresyon yok.
- [ ] Yeni chat → `POST /threads`; mesaj → `PUT /threads/:id/messages`;
      pin/renk/başlık → `PATCH`; silme → `DELETE`.
- [ ] Offline açılmış bir thread, API geri geldiğinde `pull()` ile yukarı itiliyor.
- [ ] Resim atıp gönder → "Files in Chat" panelinde görünüyor, **reload sonrası
      da** görünüyor (data URL veya storage URL).
- [ ] `/api/chat/orchestrate` gövdesinde son user turu `content: [...]` dizisi;
      `image_url.url` `data:image/...;base64,` ile başlıyor.
- [ ] 8 MB üstü dosya inline edilmiyor → storage yükleme yolu devrede.
- [ ] `owner_id` oturumdan alınıyor, body'den değil; başka principal'in thread'i
      hiçbir uçtan okunamıyor (RLS + handler auth ikisi birden).
