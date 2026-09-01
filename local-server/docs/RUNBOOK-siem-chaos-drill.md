# Runbook — SIEM Chaos / Durability Drill (Faz 14.4)

SIEM forwarder'ın at-least-once garantisini saha şartlarında doğrular:
süreç ölse, network kopsa, hedef SIEM kapalı olsa bile event'ler kaybolmaz.

## Beklenen davranış

1. SIEM hedefi erişilemezse → event in-memory queue'dan `siem_outbox`
   tablosuna persist edilir.
2. Outbox satırı her başarısız denemede `next_attempt_at = now() + 2^attempts s`
   (jitter ±25%, cap 5dk) ile geri planlanır.
3. `attempts >= 10` olursa `siem_outbox_dead` tablosuna taşınır, poison event
   sonsuz retry yapılmaz.
4. Middleware crash/restart sonrası, outbox tablosundan kaldığı yerden devam
   eder — at-least-once.

## Drill adımları

> Üretim DB'sini etkilemez, sadece bir test event üretir ve siem_outbox/dead
> sayaçlarını okur.

### 0) Önkoşul — admin SID

```bash
curl -sS -c /tmp/cookies.txt -X POST http://127.0.0.1:3005/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<pw>","provider":"local","device":"chaos"}'
SID=$(jq -r .sessionId < /tmp/.last)  # ya da yukarıdaki cevaptan kopyala
```

### 1) SIEM'i kasıtlı yanlış host'a yönelt (config snapshot al, sonra geri yükle)

```bash
# mevcut config'i sakla
curl -sS -H "x-session-id: $SID" http://127.0.0.1:3005/api/siem/config \
  | tee /tmp/siem-config.before.json | jq .config

# unreachable host'a yönelt
curl -sS -H "x-session-id: $SID" -H 'content-type: application/json' \
  -X PUT http://127.0.0.1:3005/api/siem/config \
  -d '{"enabled":true,"host":"127.0.0.1","port":1,"protocol":"tcp","format":"CEF","facility":"local0"}'
```

### 2) Event üret — başarısız olmalı, outbox'a düşmeli

```bash
# Vault üzerinde yazma → audit event → siem forwarder enqueue
curl -sS -H "x-session-id: $SID" -H 'content-type: application/json' \
  -X POST http://127.0.0.1:3005/api/vault \
  -d '{"scope":"chaos","name":"drill1","value":"x"}'

# 2sn bekle → /api/siem/config status: outboxDepth >= 1
sleep 2
curl -sS -H "x-session-id: $SID" http://127.0.0.1:3005/api/siem/config | jq .status
# beklenen: { ... outboxDepth: >=1, lastError: "connect ECONNREFUSED ..." }
```

### 3) Middleware'i SIGKILL ile çökert ve yeniden başlat

```bash
bash local-server/scripts/middleware-restart.sh

# Boot sonrası outbox aynı yerden devam etmeli (kayıp yok)
sleep 5
curl -sS -H "x-session-id: $SID" http://127.0.0.1:3005/api/siem/config | jq .status
# beklenen: outboxDepth yine >= 1, satır kaybolmadı
```

### 4) SIEM hedefini düzelt → outbox drain olmalı

```bash
# config'i eski haline döndür (veya gerçek SIEM'e yönelt)
curl -sS -H "x-session-id: $SID" -H 'content-type: application/json' \
  -X PUT http://127.0.0.1:3005/api/siem/config \
  -d "$(jq -c '.config | .enabled=false' /tmp/siem-config.before.json)"
# (test için disabled bırakmak yerine gerçek hedefe yönelt — drain için)

# 5sn fast-drain timer her tick'te flush dener
sleep 10
curl -sS -H "x-session-id: $SID" http://127.0.0.1:3005/api/siem/config | jq .status
# beklenen: outboxDepth → 0 (veya azalıyor), sent counter arttı
```

### 5) Dead-letter testi (opsiyonel, 10 retry × ~5dk ≈ saatlerce sürer)

Hızlı simülasyon için DB'de manuel `UPDATE siem_outbox SET attempts=9` yap →
bir sonraki başarısız flush dead-letter'a taşır:

```bash
psql -h 127.0.0.1 -U sovereign -d elara_db -c \
  "UPDATE siem_outbox SET attempts=9 WHERE id IN (SELECT id FROM siem_outbox LIMIT 1);"

# sonra unreachable hedefe yönelt, flush tetikle
sleep 10
psql -h 127.0.0.1 -U sovereign -d elara_db -c \
  "SELECT count(*) FROM siem_outbox_dead;"
# beklenen: count >= 1
```

## Kabul kriterleri

- [ ] Adım 2'de `outboxDepth` artıyor + `lastError` set.
- [ ] Adım 3'te restart sonrası `outboxDepth` korunuyor (kayıp yok).
- [ ] Adım 4'te hedef düzeldiğinde `outboxDepth` → 0 + `sent` artıyor.
- [ ] Adım 5'te poison event `siem_outbox_dead`'e taşındı, asıl outbox'ta yok.

## Geri alma

```bash
# Orijinal SIEM config'i yükle
curl -sS -H "x-session-id: $SID" -H 'content-type: application/json' \
  -X PUT http://127.0.0.1:3005/api/siem/config \
  -d "$(jq -c '.config' /tmp/siem-config.before.json)"

# Chaos kaynaklı kayıtları temizle
psql -h 127.0.0.1 -U sovereign -d elara_db -c \
  "DELETE FROM vault_secrets WHERE scope='chaos';
   DELETE FROM siem_outbox WHERE payload->>'name' LIKE 'vault.%' AND payload->'meta'->>'scope'='chaos';
   DELETE FROM siem_outbox_dead WHERE payload->'meta'->>'scope'='chaos';"
```

## Otomasyon notu

Bu drill manuel — operatör onayı gerektirir. CI'da koşmaz çünkü middleware'i
SIGKILL ediyor (production-like ortam beklenir). Üç ayda bir koşulması
önerilir (DR drill takvimi ile birlikte).
