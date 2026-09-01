# NetSec Squad — Vault-First Devreye Alma Rehberi (Tur-2)

Komutan, **Tur-2** ile secret yönetimi tamamen vault'a taşındı: `.env` ve launchd plist'te **artık tek bir credential yok**. Tüm parolalar, API key'ler, SSH bilgileri **AES-256-GCM şifreli** `vault_secrets` tablosunda yaşıyor; ajan runtime'a sadece child process belleğinde, **diske düşmeden** enjekte ediliyor.

> **Ön koşul:** `git pull` ile bu commit'i çek. Yeni dosyalar:
> - `local-server/lib/vault.mjs` (vault helper: encrypt/decrypt/audit/getSecretsForScope)
> - `local-server/lib/agent-env.mjs` (vault'tan secret çekip env'e enjekte eder)
> - `local-server/scripts/env-to-vault-migrate.mjs` (eski `.env` secret'larını vault'a taşıma scripti)
> - `agents/_shared/transports/{ssh,https,checkpoint_smc,creds}.py` (bağlantı adapter'ları)

---

## 1) `.env` ve plist'te ne kalır?

**Sadece altyapı.** Aşağıdaki tablo dışında her şey vault'a gider:

| Anahtar | Yer | Neden |
|---|---|---|
| `DATABASE_URL`, `PG*` | .env / plist | DB connection — chicken-and-egg, vault DB'den okur |
| `VAULT_PASSPHRASE` | .env / plist | Vault'u açan kök key (rotation: `vault-rotate-drill.sh`) |
| `ELARA_AGENTS_DIR`, `ELARA_AGENTS_ALLOWED` | .env / plist | Discovery + allowlist (path config, secret değil) |
| `ELARA_WORKER_*`, `ELARA_LOG_*`, `ELARA_EMBED_*` | plist | Worker cap'leri (`launchctl bootout`+`bootstrap` ile reload) |
| `NODE_ENV`, `PORT`, `HOST`, `PATH`, `HOME`, `LANG`, `LC_*`, `TZ` | .env / plist | Runtime config |

**Vault'a gider:** `GEMINI_API_KEY`, `TAVILY_API_KEY`, `FORTI_USER/PASS`, `SMC_USER/PASS`, SSH parolaları, tüm API token'ları, DB application secret'ları.

`ELARA_AGENTS_*` yine göreli yol formatında — Tur-1.5'te yapıldı, değişmedi:

```bash
ELARA_AGENTS_DIR=/Users/levent/ELARA_PROJECT/Elara_WebUi/agents
ELARA_AGENTS_ALLOWED=NetSec/orchestrator.py,NetSec/researcher.py,...
```

---

## 2) Mevcut `.env` secret'larını vault'a taşı (tek komut)

Migration script'i kullan. **Önce dry-run**, sonra `--apply`, sonra `--purge-env`:

```bash
cd /Users/levent/ELARA_PROJECT/Elara_WebUi

# 1) Ne taşınacak gör (hiçbir şey yazılmaz):
node local-server/scripts/env-to-vault-migrate.mjs --file local-server/.env --scope global

# 2) Onayla → vault'a yaz (PG env vars zorunlu):
node local-server/scripts/env-to-vault-migrate.mjs --file local-server/.env --scope global --apply

# 3) .env'den temizle (orijinal .env.bak.<timestamp> olarak yedeklenir):
node local-server/scripts/env-to-vault-migrate.mjs --file local-server/.env --scope global --apply --purge-env
```

Script **otomatik olarak** şu key'lere dokunmaz: `DATABASE_URL`, `PG*`, `VAULT_PASSPHRASE`, `ELARA_AGENTS_*`, `ELARA_WORKER_*`, `ELARA_LOG_*`, `ELARA_EMBED_*`, `NODE_ENV`, `PORT`, `HOST`, `PATH`, `HOME`, `LANG`, `LC_*`, `TZ`. Diğer her şey `scope=global`'e taşınır.

**Belirli bir ajana özel secret** (örn. firewall_oracle'ın FORTI bilgileri) → `--scope agent:firewall_oracle`:

```bash
node local-server/scripts/env-to-vault-migrate.mjs --file local-server/forti-creds.env \
  --scope agent:firewall_oracle --apply --purge-env
```

---

## 3) plist temizliği

```bash
PLIST=~/Library/LaunchAgents/com.elara.middleware.plist
cp "$PLIST" "$PLIST.bak.$(date +%Y%m%d-%H%M%S)"

# Aşağıdaki key'leri EnvironmentVariables sözlüğünden el ile sil:
#   GEMINI_API_KEY, TAVILY_API_KEY, FORTI_*, SMC_*, OPENAI_API_KEY, vs.
# Sadece şunlar kalır: PG*, VAULT_PASSPHRASE, ELARA_AGENTS_*, ELARA_WORKER_*, ELARA_LOG_*, PATH, HOME, LANG.

# Reload (cap reload için bootout+bootstrap ŞART):
launchctl bootout gui/$(id -u)/com.elara.middleware 2>/dev/null
sleep 2
launchctl bootstrap gui/$(id -u) "$PLIST"
sleep 3
launchctl print gui/$(id -u)/com.elara.middleware | grep -E "state|pid" | head -3
```

---

## 4) Vault'a manuel secret yazma (UI veya curl)

UI: **Agents** sayfasında her ajan kartının **Vault** sekmesi (Add/Rotate/Delete).

curl:

```bash
# Global scope (tüm ajanlar erişir):
curl -X POST http://127.0.0.1:3005/api/vault \
  -H "Content-Type: application/json" \
  -b session.cookie \
  -d '{"scope":"global","name":"GEMINI_API_KEY","value":"AIza..."}'

# Ajana özel scope:
curl -X POST http://127.0.0.1:3005/api/vault \
  -H "Content-Type: application/json" \
  -b session.cookie \
  -d '{"scope":"agent:firewall_oracle","name":"FORTI_PASS","value":"hunter2"}'
```

> Vault yazma/okuma `requireSession({roles:["admin"]})` ile korumalı. Her erişim `vault_audit` tablosuna hash-zincirli olarak düşer; plaintext **asla loglanmaz**.

---

## 5) Runtime davranışı — bir ajan çağrıldığında ne olur?

1. `/api/agents/:id/run` çağrılır.
2. `buildAgentEnv(a)` ajan satırının `systemPrompt`, `model`, `inference` ayarlarını env'e koyar.
3. `getSecretsForScope(pool, "agent:<id>")` vault'tan o ajanın tüm secret'larını decrypt eder.
4. Her secret iki isimle env'e girer: `ELARA_SECRET_<NAME>` ve `<NAME>` (ajan script'i kolay okusun).
5. `vault_audit`'e `action='read-bulk', actor='agent-runtime'` kaydı düşer (isimler logged, değer yok).
6. Eğer `req.body.ephemeralCredentials = {NAME: value}` varsa → **vault'a yazılmadan** env'e bindirilir (vault'u override eder). `vault_audit`'e `action='ephemeral-inject', actor='chat-ephemeral'` düşer.
7. `runLocalAgent` Python child process'i spawn eder; secret'lar sadece o process'in env'inde yaşar.

---

## 6) Ad-hoc bağlantı (chat'ten "şu cihaza şu parola ile bağlan")

Endpoint zaten hazır — chat composer body'de `ephemeralCredentials` gönderirse vault'a hiç dokunulmaz:

```bash
curl -X POST http://127.0.0.1:3005/api/agents/firewall_oracle/run \
  -H "Content-Type: application/json" \
  -d '{
    "text": "10.0.0.5 cihazinda show version cek",
    "ephemeralCredentials": {
      "SSH_HOST": "10.0.0.5",
      "SSH_USER": "admin",
      "SSH_PASSWORD": "hunter2"
    }
  }'
```

Ajan içindeki `from agents._shared.transports.ssh import ssh_run` → `await ssh_run(host=os.environ["SSH_HOST"], user=os.environ["SSH_USER"], cmd="show version")` — `SSH_PASSWORD` env'den otomatik çekilir.

Chat composer önyüzü için: `/creds HOST=10.0.0.5 USER=admin PASS=hunter2 ...` parser frontend tarafında parse edip body'ye koyar (gelecek mini PR).

---

## 7) Transport adapter'ları — kullanım örnekleri

### SSH

```python
from agents._shared.transports.ssh import ssh_run

res = await ssh_run(
    host="10.0.0.5", user="admin", cmd="show version",
    # password=None → ELARA_SECRET_SSH_PASSWORD env'den çekilir
    timeout=20,
)
print(res["stdout"], res["exit_code"])
```

Host key politikası: **TOFU** (`~/.elara/known_hosts`). İlk bağlantı otomatik kabul + cache; sonraki bağlantıda key değişirse `KeyMismatchError` → kullanıcı onayı.

### HTTPS / REST

```python
from agents._shared.transports.https import request

r = await request(
    method="GET", url="https://10.0.0.1/api/status",
    auth_mode="bearer", auth_token_name="GW_TOKEN",  # vault key adı
    tls_insecure=True,   # self-signed lab cihazları için
    timeout=30,
)
print(r["status"], r["body_json"])
```

### Checkpoint Smart Management

```python
from agents._shared.transports.checkpoint_smc import SmcSession

async with SmcSession(
    host="10.0.0.1",
    user_name="SMC_USER",         # vault key adı
    password_name="SMC_PASSWORD",
    tls_insecure=True,
    read_only=True,                # default — destructive op'lar requires_approval döner
) as smc:
    res = await smc.call("show-access-rulebase", {"name": "Network", "limit": 50})
    print(res["data"])
```

Write op (örn. `add-access-rule`, `publish`, `install-policy`) `read_only=True` modda otomatik olarak `{requires_approval: True}` döner — kullanıcı onayı alındıktan sonra `read_only=False` ile yeni session aç.

---

## 8) Smoke test

```bash
# Vault'ta secret var mı?
curl -s http://127.0.0.1:3005/api/vault -b session.cookie | jq '.[] | select(.scope|startswith("agent:") or .scope=="global") | "\(.scope)::\(.name)"'

# Allowlist hala doğru mu?
curl -s http://127.0.0.1:3005/api/agents/discover | jq '.allowed | length'

# Bir ajanı çağır (vault secret'ları otomatik enjekte edilir):
curl -X POST http://127.0.0.1:3005/api/agents/researcher/run \
  -H "Content-Type: application/json" \
  -d '{"text":"Quick health check"}' | jq '.ok, .latencyMs'

# Audit zinciri sağlam mı?
curl -s http://127.0.0.1:3005/api/vault-audit/verify -b session.cookie | jq
```

---

## 9) Bağımlılıklar

Python tarafında transport adapter'ları için:

```bash
pip install 'asyncssh>=2.14' 'httpx>=0.27'
```

Adapter'lar lazy-import: SSH adapter çağrılmadıkça `asyncssh` yüklenmez.

---

## 10) Geri alma (rollback)

Migration script otomatik yedek bırakır: `local-server/.env.bak.<timestamp>`.
Vault'tan secret silmek için: `DELETE /api/vault/:scope/:name` (admin auth, audit yazılır).
Plist yedeği: `~/Library/LaunchAgents/com.elara.middleware.plist.bak.<timestamp>`.
