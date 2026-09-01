# local-server scripts

Operatör smoke ve debug araçları.

## meta-forge-debug.sh
Meta-Forge lane regression aracı. Aynı prompt'u orchestrate + stream hatlarına 2 tur atar, SSE frame'lerini ayrıştırır, forge_plan / rag / meta metadata çıkarır, `/api/debug/chat/$key?format=text` üzerinden backend trace çeker.

```bash
ELARA_USERNAME=admin ELARA_PASSWORD='***' bash local-server/scripts/meta-forge-debug.sh "phishing triage skill yaz"
```

Çıktı `/tmp/meta-forge-debug-YYYYMMDD-HHMMSS/summary.txt`. `turn1 forge_plan=false / turn2=true` görülürse eşleşen `*.trace.txt` ve `*.sse` dosyalarına bakılır.

## meta-forge-debug.sh env
- `ELARA_USERNAME` / `ELARA_PASSWORD` — yoksa interaktif sorar
- `ELARA_BASE_URL` — varsayılan `http://127.0.0.1:3005`
- `ELARA_MODEL_ID` — varsayılan `elara-72b-mlx`

## Diğer smoke/debug script'leri
Repoda başka smoke script'leri (mlx-transport, tur-6 dispatch, db-audit, worker-restart) mevcut — hepsi ölçüm/regression için, üretim akışına dokunmaz.
