# Multi-Turn Orchestration — Canlıya Alma Kılavuzu

Bu doküman, sohbet ekranındaki **çoklu tur (multi-turn) araç çalıştırma** katmanının
canlı backend'e bağlanması için gereken her şeyi içerir:

1. Dosya haritası (hangi kod hangi dosyada)
2. Mock → canlı geçişte değişecek tam kod blokları
3. REST / SSE sözleşmesi (istek gövdesi, event tipleri, hata semantiği)
4. SQL şeması (tablolar, indexler, RLS/grant notları)
5. Kabul testleri (canlıya almadan önce doğrulanacak maddeler)

---

## 1. Dosya haritası

| Katman | Dosya | Sorumluluk |
| --- | --- | --- |
| Wire contract | `src/lib/orchestrate-stream.ts` | Capability zarfı, SSE frame parser, activity reducer, `streamOrchestrate` (canlı) + `simulateOrchestrate` (mock) |
| Aktivite UI | `src/components/sovereign/tool-activity.tsx` | Spinner / araç satırları / agent-loop bandı / halted şeridi |
| Onay UI | `src/components/sovereign/tool-approval-card.tsx` | `MetaForgeApprovalCard` sarmalayıcısı (invocationId + toolName + reason) |
| Onay kartı gövdesi | `src/components/sovereign/metaforge-approval-card.tsx` | Antrasit cam, 1px sapphire hairline, emerald APPROVE |
| Chat orkestrasyonu | `src/routes/index.tsx` | `runOrchestration`, `decideApproval`, `dispatch`, mesaj başına `activity` state |
| Composer seçimi | `src/components/sovereign/composer.tsx` | `@agent`, `/tool`, `!skill`, `#mcp` mention'ları üretir |
| Thread kalıcılığı | `src/lib/chat-store.ts` | `ChatMessage` — kalıcı alanlar buradan genişler |

**Tek kural:** UI hiçbir zaman ham SSE görmez. Backend'den gelen her şey
`parseOrchestrateFrame` → `OrchestrateEvent` → `reduceActivity` → `ToolActivity`
zincirinden geçer. Yeni bir event tipi eklenecekse **sadece** bu üç fonksiyon
ve `tool-activity.tsx` değişir.

---

## 2. Mock → canlı geçiş (uygulanacak kod)

### 2.1 `src/routes/index.tsx` — `runOrchestration`

Şu an `simulateOrchestrate` çağrılıyor (satır ~437). Canlıda **tek değişiklik** bu blok:

```tsx
// import satırında simulateOrchestrate yerine:
import {
  buildCapabilities,
  emptyActivity,
  hasCapabilities,
  reduceActivity,
  streamOrchestrate,
  type ToolActivity,
} from "@/lib/orchestrate-stream";

const runOrchestration = (
  base: Msg[],
  agent: StudioAgent | undefined,
  query: string,
  caps: ReturnType<typeof buildCapabilities>,
) => {
  setStreaming(true);
  let act = emptyActivity();
  let answer = "";
  const paint = (streamingNow = true) =>
    setMessages([
      ...base,
      { role: "agent", text: answer, streaming: streamingNow, activity: act },
    ]);
  paint();

  const ac = new AbortController();
  orchCancel.current = () => ac.abort();

  void streamOrchestrate(
    {
      message: query,
      threadId: active?.id,
      capabilities: caps,
      ...(active?.context ? { context: active.context } : {}),
      ...(agent ? { agentId: agent.id } : {}),
    },
    (e) => {
      act = reduceActivity(act, e);
      if (e.kind === "out") {
        answer += e.text;          // asistan metni aynı balonda büyür
        paint();
        return;
      }
      if (e.kind === "approval_required") {
        resume.current = { base, agent, query };
        setStreaming(false);
        paint(false);              // stream burada DURUR
        return;
      }
      if (e.kind === "error") {
        answer += `\n\n_Orchestration error — ${e.message}_`;
        setStreaming(false);
        paint(false);
        return;
      }
      if (e.kind === "done") {
        setStreaming(false);
        paint(false);
        return;
      }
      paint();
    },
    ac.signal,
  );
};
```

> Not: canlıda artık `runAgent(...)` çağrısına gerek yok — asistan metni
> `type: "out"` frame'leriyle aynı stream üzerinden geliyor. `runAgent` yalnızca
> capability seçilmemiş turlar için (`dispatch` içindeki `else` dalı) kalır.

### 2.2 `src/routes/index.tsx` — `decideApproval`

Operatör kararı artık backend'e gitmeli. Mevcut fonksiyonun içine, state
güncellemesinden **önce** şu çağrı eklenir:

```tsx
await fetch("/api/chat/approve", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    invocationId: act.approval.invocationId,
    decision,                     // "approve" | "reject"
    threadId: active?.id,
  }),
});
```

Backend `approve` aldığında **aynı** SSE kanalını sürdürür (kanal açık tutulduysa)
ya da yeni bir `POST /api/chat/orchestrate?resume=<invocationId>` stream'i açar.
Tercih edilen: **resume stream**. O durumda `decideApproval` içindeki
`runAgent(...)` çağrısı şununla değiştirilir:

```tsx
runOrchestration(base, ctx?.agent, ctx?.query ?? "", { tools: [], skills: [] });
// resume modunda capabilities boş gider; orkestratör invocationId'den devam eder
```

ve `streamOrchestrate`'e `resumeInvocationId` alanı eklenir (bkz. 2.3).

### 2.3 `src/lib/orchestrate-stream.ts` — resume alanı

```ts
export type OrchestrateRequest = {
  message: string;
  threadId?: string;
  capabilities: Capabilities;
  context?: string;
  agentId?: string;
  /** Onay sonrası kaldığı yerden devam eden tur. */
  resumeInvocationId?: string;
};
```

Başka değişiklik gerekmez; `streamOrchestrate` gövdeyi olduğu gibi POST eder.

### 2.4 Heartbeat / kopma toleransı

Reader döngüsü `:ping` yorum satırlarını zaten yok sayar (`data:` ile başlamayan
satırlar atlanır). Backend'in **15 saniyede bir** `:\n\n` göndermesi gerekir,
aksi halde proxy idle stream'i düşürür.

---

## 3. Backend sözleşmesi

### 3.1 `POST /api/chat/orchestrate`

İstek gövdesi:

```json
{
  "message": "son sürüm CVE'lerini çek ve özetle",
  "threadId": "chat_1756200000000",
  "agentId": "agent_atlas",
  "context": "thread-level pinned system context",
  "capabilities": {
    "tools": ["mcp.github", "tool_websearch"],
    "skills": ["skill_python_runner"]
  }
}
```

Yanıt: `Content-Type: text/event-stream`, her frame `data: <json>\n\n`.

| Sıra | Frame | UI etkisi |
| --- | --- | --- |
| 1 | `{"phase":"tool_execution","tools":[{"name":"mcp.github"}]}` | "Preparing capabilities…" spinner + pending satırlar |
| 2 | `{"type":"tool_status","name":"mcp.github","status":"running"}` | Satırda dönen sapphire spinner |
| 3 | `{"type":"tool_status","name":"mcp.github","status":"completed","ms":842}` | Emerald tik + süre |
| 3b | `{"type":"tool_status","name":"…","status":"failed","detail":"429 rate limit"}` | Ruby ikon + detay satırı |
| 4 | `{"phase":"agent_loop","iteration":2}` | "Agent reviewing results · turn 2" |
| 5 | `{"type":"out","text":"…"}` (n kez) | Asistan metni akar |
| 6 | `{"type":"done"}` veya `data: [DONE]` | Stream kapanır, blok collapse olur |
| Gate | `{"phase":"approval_required","invocationId":"uuid","toolName":"mcp.server_restart","reason":"…"}` | Stream durur, APPROVE/REJECT kartı çizilir |
| Hata | `{"type":"error","message":"…"}` | Kırmızı satır, streaming kapanır |

**Kabul edilen `status` değerleri:** `pending | running | completed | failed | denied`.
`detail` (string) ve `ms` (number) opsiyoneldir ve UI'da gösterilir.

**Sunucu tarafı zorunlulukları**
- `iteration` her turda artar; **hard cap** (örn. 8) sunucuda uygulanır, aşılırsa
  `{"type":"error","message":"max agent iterations reached"}`.
- Yüksek riskli araçlar sunucuda belirlenir (client'taki regex sadece mock içindir
  ve canlıda `highRisk` yardımcı fonksiyonu **kaldırılabilir**).
- Onaysız hiçbir yüksek riskli araç çalıştırılmaz — gate sunucudadır, UI'da değil.

### 3.2 `POST /api/chat/approve`

```json
{ "invocationId": "uuid-1234", "decision": "approve", "threadId": "chat_…" }
```

Yanıt: `{ "ok": true, "status": "approved" }`. `reject` durumunda orkestratör turu
iptal eder ve `tool_invocation.status = 'denied'` yazar.

### 3.3 TanStack tarafı (bu repo içinde sunulacaksa)

SSE ham `Response` döndürdüğü için **server function değil, server route** kullanılır:

- `src/routes/api/chat/orchestrate.ts` → `createFileRoute("/api/chat/orchestrate")({ server: { handlers: { POST } } })`
- `src/routes/api/chat/approve.ts` → aynı desen, JSON döner

Harici bir orkestratöre proxy'leniyorsa bu iki route yalnızca upstream stream'i
`ReadableStream` olarak geçirir; gövde şeması değişmez.

---

## 4. SQL şeması

```sql
-- =====================================================================
-- Multi-turn orchestration · schema v1
-- =====================================================================

create type orchestration_status as enum ('running','awaiting_approval','completed','failed','cancelled');
create type invocation_status    as enum ('pending','running','completed','failed','denied');
create type approval_decision    as enum ('approve','reject');
create type capability_kind      as enum ('tool','skill','mcp');

-- Bir kullanıcı turu = bir orchestration run -----------------------------
create table public.orchestration_run (
  id               uuid primary key default gen_random_uuid(),
  thread_id        text not null,                  -- chat-store thread id
  owner_id         uuid not null,                  -- auth.users(id)
  agent_id         text,
  user_message     text not null,
  pinned_context   text,
  capabilities     jsonb not null default '{"tools":[],"skills":[]}'::jsonb,
  status           orchestration_status not null default 'running',
  iterations       int  not null default 1,
  answer           text,
  error            text,
  prompt_tokens    int,
  completion_tokens int,
  cost_usd         numeric(12,6),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index orchestration_run_thread_idx on public.orchestration_run (thread_id, started_at desc);
create index orchestration_run_owner_idx  on public.orchestration_run (owner_id, started_at desc);

-- Tek bir araç çağrısı ---------------------------------------------------
create table public.tool_invocation (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.orchestration_run(id) on delete cascade,
  iteration     int  not null default 1,
  seq           int  not null,                     -- tur içindeki sıra
  name          text not null,                     -- "mcp.github", "tool_websearch"
  kind          capability_kind not null,
  input         jsonb,
  output        jsonb,
  status        invocation_status not null default 'pending',
  detail        text,
  duration_ms   int,
  high_risk     boolean not null default false,
  started_at    timestamptz,
  finished_at   timestamptz
);
create index tool_invocation_run_idx on public.tool_invocation (run_id, iteration, seq);
create index tool_invocation_name_idx on public.tool_invocation (name, started_at desc);

-- İnsan onayı kapısı -----------------------------------------------------
create table public.tool_approval (
  id             uuid primary key default gen_random_uuid(),
  invocation_id  uuid not null unique references public.tool_invocation(id) on delete cascade,
  run_id         uuid not null references public.orchestration_run(id) on delete cascade,
  reason         text not null,
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,                             -- auth.users(id)
  decision       approval_decision,
  note           text,
  expires_at     timestamptz                       -- zaman aşımı = otomatik reject
);
create index tool_approval_pending_idx on public.tool_approval (decided_at) where decided_at is null;

-- Hangi aracın onay gerektirdiği (sunucu tarafı politika) ----------------
create table public.tool_risk_policy (
  name         text primary key,                   -- "mcp.server_restart" veya glob "mcp.*_restart"
  kind         capability_kind not null,
  high_risk    boolean not null default true,
  requires_role text,                              -- opsiyonel: sadece bu rol onaylayabilir
  updated_at   timestamptz not null default now()
);

-- Denetim izi (mevcut audit journal ile birleştirilebilir) ---------------
create table public.orchestration_event (
  id         bigserial primary key,
  run_id     uuid not null references public.orchestration_run(id) on delete cascade,
  at         timestamptz not null default now(),
  phase      text not null,                        -- tool_execution | tool_status | agent_loop | approval_required | out | error
  payload    jsonb not null                        -- ham SSE frame'i (replay için)
);
create index orchestration_event_run_idx on public.orchestration_event (run_id, id);
```

### 4.1 Grant + RLS (Supabase/PostgREST kullanılıyorsa)

```sql
grant select, insert, update on public.orchestration_run  to authenticated;
grant select, insert, update on public.tool_invocation    to authenticated;
grant select, insert, update on public.tool_approval      to authenticated;
grant select                 on public.tool_risk_policy   to authenticated;
grant select                 on public.orchestration_event to authenticated;
grant all on public.orchestration_run, public.tool_invocation, public.tool_approval,
             public.tool_risk_policy, public.orchestration_event to service_role;

alter table public.orchestration_run   enable row level security;
alter table public.tool_invocation     enable row level security;
alter table public.tool_approval       enable row level security;
alter table public.tool_risk_policy    enable row level security;
alter table public.orchestration_event enable row level security;

create policy "own runs" on public.orchestration_run
  for select to authenticated using (owner_id = auth.uid());

create policy "own invocations" on public.tool_invocation
  for select to authenticated using (exists (
    select 1 from public.orchestration_run r
    where r.id = tool_invocation.run_id and r.owner_id = auth.uid()));

-- Onayı yalnızca run sahibi ya da approver rolü kapatabilir
create policy "decide approval" on public.tool_approval
  for update to authenticated using (
    public.has_role(auth.uid(), 'admin')
    or exists (select 1 from public.orchestration_run r
               where r.id = tool_approval.run_id and r.owner_id = auth.uid()));
```

> Self-approval yasağı isteniyorsa `decided_by <> r.owner_id` koşulunu policy'ye
> ekleyin — Approval Queue'daki "self-approval" politikasıyla aynı kural.

### 4.2 Yazma sırası (orkestratör worker'ı)

```text
run  insert (status=running)
  └─ her araç için: tool_invocation insert (pending) → update (running) → update (completed|failed)
  └─ yüksek risk: tool_invocation (pending) + tool_approval insert → run.status = awaiting_approval
  └─ onay: tool_approval update (decision, decided_by, decided_at)
           → approve ise invocation running, reject ise denied + run.status = cancelled
  └─ her frame: orchestration_event insert (replay/denetim)
run  update (status=completed, answer, tokens, cost, finished_at)
```

---

## 5. Canlıya alma kontrol listesi

- [ ] `simulateOrchestrate` çağrısı `streamOrchestrate` ile değiştirildi ve
      `simulateOrchestrate` export'u kaldırıldı (mock kod canlıda kalmasın).
- [ ] `highRisk` regex'i client'tan kaldırıldı; risk kararı `tool_risk_policy`'den.
- [ ] `POST /api/chat/approve` uygulandı ve `decideApproval` bu uca yazıyor.
- [ ] SSE 15 sn heartbeat gönderiyor; 60 sn'lik sessizlikte client `error` gösteriyor.
- [ ] `failed` ve `denied` durumları gerçek bir hatada test edildi (429 / timeout).
- [ ] `iteration` hard cap sunucuda çalışıyor (sonsuz döngü yok).
- [ ] Reject sonrası run `cancelled`, hiçbir yan etki oluşmadı (rollback doğrulandı).
- [ ] `orchestration_event` replay ile bir tur birebir yeniden çizilebiliyor.
- [ ] Thread değiştirince akan stream abort ediliyor (`orchCancel.current?.()`).
