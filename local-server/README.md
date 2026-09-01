# Sovereign AI OS — Local Middleware (Node.js + PostgreSQL)

Bare-metal middleware for the Mac Studio Ultra. No third-party cloud.
Frontend resolves this service deterministically: LAN clients use **`http://<current-host>:3005`**, loopback uses **`http://127.0.0.1:3005`**.

## Stack

- Node.js 20+ (works on Apple Silicon natively)
- `express` HTTP server
- `pg` (node-postgres) — direct connection to your local PostgreSQL
- SSE for chat streaming
- Async persistence so streaming TPS is never blocked by DB writes

## Setup

**Tek komutla tüm kale (önerilen):**

```bash
bash scripts/setup-fortress.sh                # standart
bash scripts/setup-fortress.sh --with-worker  # + Python MLX worker
```

**Manuel (yalnızca middleware):**

```bash
cd local-server
cp .env.example .env       # DB kimlik bilgilerini düzenle
bun install --frozen-lockfile --ignore-scripts
psql "$DATABASE_URL" -f schema.sql
bun run start              # :3005
```

> **BUN-only mühür:** Bu proje yalnızca `bun` ile kurulur. `npm install` /
> `yarn` / `pnpm` kök `preinstall` guard tarafından reddedilir. Sebep:
> tedarik-zinciri saldırı yüzeyini daraltmak ve `--ignore-scripts` ile
> postinstall hook'larını mühürlemek. Playwright Chromium ayrı adımdır:
> `bunx playwright install chromium`.

## Frontend wiring

No manual API URL is required. Open the frontend from the Mac IP, for example `http://192.168.x.x:8080`, and the browser will call `http://192.168.x.x:3005`.

## Endpoints

| Method | Path                              | Purpose                                  |
|-------:|-----------------------------------|------------------------------------------|
| GET    | `/api/health`                     | DB + uptime probe                        |
| GET    | `/api/threads`                    | List chat threads                        |
| POST   | `/api/threads`                    | Create thread `{title}`                  |
| DELETE | `/api/threads/:id`                | Delete thread + cascade messages         |
| GET    | `/api/threads/:id/messages`       | List messages in thread                  |
| POST   | `/api/messages`                   | Persist a message (called async by UI)   |
| POST   | `/api/chat/stream`                | **SSE** stream assistant response        |
| POST   | `/api/logs`                       | Push agent log line                      |
| GET    | `/api/logs?thread_id=&limit=`     | Read agent logs                          |

### Streaming contract

`POST /api/chat/stream` body:

```json
{ "thread_id": "uuid", "model": "qwen-72b",
  "messages": [{ "role": "user", "content": "hi" }] }
```

Response is `text/event-stream`:

```
data: {"delta":"Hel"}

data: {"delta":"lo"}

data: [DONE]
```

Wire the `messages` array to your local Legacy HTTP / MLX / vLLM runtime
inside `server.mjs` (see `streamFromLocalLLM`). Default impl streams
a stub so you can verify the pipe end-to-end.

## Async persistence

The middleware writes user/assistant messages with `INSERT … RETURNING id`
on a separate microtask — the SSE socket is flushed first, the DB write
happens after. Streaming throughput stays bound by the model, never by `pg`.
