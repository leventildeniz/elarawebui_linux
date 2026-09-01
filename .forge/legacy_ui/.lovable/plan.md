## Sorun

Turn1: Backend `forge_plan` üretti + text delta gönderdi (`answer_chars=231`), ama chat balonu boş kaldı. Chat refresh sonrası DB'den yüklendiğinde göründü. Yani **delta UI state'ine düşmedi** — placeholder id / persisted id swap arasında bir race var.

## Şüpheli (kod okumasıyla)

`_app.chat.tsx` içinde:
- `flushSync` ile placeholder commit ediliyor (`initialAssistantId`)
- `persisted` phase geldiğinde `assistantIdRef.current = persistedId` yapılıyor + `setMessages` içinde id swap ediliyor
- `flushDeltaBuffer` closure'da `initialAssistantId` yakalıyor; `pendingPersistedIdRef` mantığı sadece "swap başarısızsa" devreye giriyor
- Meta-Forge lane'i `agent_dispatch` üstünden koştuğu için delta frame'leri farklı zamanlamayla düşüyor olabilir; ayrıca `phases` içinde `streaming` YOK — deltalar tek shot gelmiş olabilir

Bu üçlünün kombinasyonunda delta buffer flush edildiğinde ne eski id'de ne de yeni id'de eşleşme olmayıp buf düşüyor olabilir.

## Adımlar

### 1) Ölçüm (kör atış yapmamak için)
`_app.chat.tsx` içine sadece **development-mode breadcrumb log**'ları ekle:
- `onDelta` içinde ilk chunk geldiğinde: `[chat/delta] first { targetId, initialId, pendingId, chars }`
- `flushDeltaBuffer` içinde: hangi id ile map edildi, kaç mesaj matched
- `persisted` phase: `oldId → persistedId, swapped=?`

Bu sayede aynı senaryoyu bir kez daha koştuğunda log'dan hangi adımda delta kayboluyor kesin görünecek.

### 2) Görünürlük bandajı (fallback)
`phase === "forge_plan"` handler'ında (line 1759+): hedef balonun `content`'i boş ise `content = "🔨 Meta-Forge otomatik planladı — kart aşağıda."` yaz. Böylece delta hiç düşmese bile kullanıcı boş balon görmez.

Aynısını `forge_plan_partial` için de: content boşsa `"🔨 Meta-Forge planlıyor…"`.

### 3) Race sertleştirme
`flushDeltaBuffer` içinde eşleşme yoksa **son assistant mesajına** fallback yaz (aynen `forge_plan` handler'ındaki gibi). Buffer asla yere düşmesin.

## Sıra ve doğrulama

Adım 1 → deploy → kullanıcı 1 tur atsın → console log'u paylaşsın → gerçek kök nedeni gördükten sonra 2 + 3'ü doğru targetla uygula. 

Alternatif: kullanıcı ölçüm turunu atlamak isterse doğrudan 2 + 3'ü basıp ampirik doğrulamaya geçebiliriz (bandajlı ama hızlı).

## Kapsam dışı (bu turda YOK)
- Bekletme/latency (kullanıcı erteledi)
- Backend idempotency (aynı prompt iki forge açması — ayrı tur)
- Halu %75 telemetrisi