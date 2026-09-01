# ELARA - Master Code Audit Findings & Agnostic Action Plan

## Last Updated: 2026-07-26
**Project Status:** Local-First AI OS Transition (WSL & macOS Hybrid)
**Target:** 100% OS-Agnostic, Semantic, High-Performance, Proprietary Codebase
**Auditors:** Levent (Operator) & Elara/Gemma (System Brain)

---

## 1. STRATEJİK KIRMIZI ALARMLAR (HIGH-PRIORITY ISSUES)

### 1.1. "AGNOSTIC KATILI" - MLX Warmup & Panik Watchdog Döngüsü
- **Etkilenen Modüller:** `local-server/lib/mlx-warmup.mjs`, `local-server/lib/mlx-transport.mjs`, `local-server/lib/agent-bridge.mjs` (L128 - `markAgentTimeoutDirty`), `local-server/lib/agent-runs.mjs` (L200)
- **Sorun Tanımı (Dizel Kamyon Isıtma Takıntısı):**
  - **Sonsuz Isınma Döngüsü:** `startMlxKeepwarmLoop` (L269) fonksiyonu, her 15 saniyede bir MLX'e boş `.` istekleri göndererek modeli warm tutmaya çalışıyor. Bu işlem canavar gibi M5 Max'in birleşik belleğini (unified memory) 95GB'a kadar şişirerek sistemi felç ediyor.
  - **Panik Atak Watchdog:** RAG veya otonom ajanların başlatılması (startup) esnasında ilk token'ın gelmesi RAG/prep yükü nedeniyle 1-2 saniye geciktiğinde, `mlx-transport` watchdog'u ve ajan köprüsü (`markAgentTimeoutDirty`) MLX'in kilitlendiğini (zombie slot) sanıp `triggerMlxZombieSelfHeal` ile tüm MLX sunucusunu (kamyon motorunu!) baştan başlatıyor.
  - **5-6 Dakikalık Kilitlenmeler:** Bu gereksiz restart yüzünden 31B/72B'lik devasa modeller her seferinde RAM'e baştan yükleniyor ve kullanıcı basit bir "Selam" yazınca bile dakikalarca bekletiliyor. Bu watchdog local ve tek kullanıcılı bir makinede tamamen fuzulidir.
- **Eylem Planı:** `mlx-warmup.mjs` modülünü tamamen devre dışı bırakın veya silin. Agresif watchdog tetikleyicilerini (`dirty` flag mutasyonları ve `triggerMlxZombieSelfHeal` çağrıları) tamamen kaldırın. Isınma ve ısınma bildirimlerini "Model Hazırlanıyor" gibi sağlayıcıdan bağımsız (provider-agnostic) hale getirin.

### 1.2. Hardcoded Kullanıcı Yolları & Platform Bağımlılıkları (levent-centric)
- **Etkilenen Modüller:** `local-server/lib/os_utils.mjs` (L11, L30), `local-server/lib/os_utils.sh` (L8, L12, L17, L19), `local-server/lib/agent-runs.mjs` (L86), `local-server/lib/agent-env.mjs` (L231), `local-server/lib/disk-runner.mjs` (L39), `local-server/lib/meta-forge/smoke.mjs` (L19)
- **Sorun Tanımı:**
  - **"levent" Bağımlılığı:** `PROJECT_ROOT` ve Python binary yolları doğrudan `/Users/levent/ELARA_PROJECT/...` ve `/home/levent/ELARA_PROJECT/...` olarak hardcoded yazılmış. Yazılımın başka bir makinede veya farklı bir kullanıcı adıyla çalışması imkansız kılınmış.
  - **Kırık Yol Çözücü:** `os_utils.sh` içindeki `resolve_path` fonksiyonu, yol içerisindeki tüm eğik çizgileri (slash) silen (`relative_path="${relative_path//\//}"`) felaket bir mantık hatası içeriyor. Alt dizin yollarını tamamen bozuyor (örn. `local-server/scripts/foo.sh` -> `local-serverscriptsfoo.sh`).
  - **Hardcoded "python3"**: `agent-runs.mjs`, `agent-env.mjs`, `disk-runner.mjs` ve `smoke.mjs` modülleri processes/script koştururken `python3` binary adını doğrudan hardcoded olarak kullanıyor. Bu, .venv sanal Python ortamı üzerinden kütüphane çeken Linux/WSL kurulumlarında bağımlılık zafiyeti yaratır ve testleri patlatır.
- **Eylem Planı:** `os_utils.mjs` ve `os_utils.sh` dosyalarını sıfırdan yazarak `PROJECT_ROOT`'u dinamik olarak çözün (`import.meta.url` veya `dirname "$0"` kullanarak). Tüm hardcoded `/Users/levent/...` ve `/home/levent/...` yollarını ve Python binary yollarını temizleyip dinamik venv çözümlemesine geçirin. Ajan ve disk süreçlerindeki `python3` çağrılarını `os_utils.mjs`'teki `getPythonBinary()` fonksiyonu ile entegre edin.

### 1.3. "Yalancı" Temizlikler & Hayalet Kodlar (RBI Entegrasyonları)
- **Etkilenen Modüller:** `local-server/lib/tool-adapters.mjs` (L132), `local-server/lib/health-deep.mjs` (L51)
- **Sorun Tanımı:**
  - **Hayalet RBI Kodları:** Operatör tarafından sistemden tamamen kaldırılması emredilen RBI (Remote Browser Isolation) modülü, güya silinmiş gibi gösterilmesine rağmen, `tool-adapters.mjs` içinde hala tüm canlı adaptör kodlarıyla (`async rbi({ tool, params, signal })`) ve hardcoded `http://127.0.0.1:8095` adresleriyle aynen duruyor. Ayrıca `health-deep.mjs` içerisinde hala `probe("rbi", ...)` olarak derin sağlık kontrolü yapmaya çalışıyor.
- **Eylem Planı:** `tool-adapters.mjs`, `health-deep.mjs` ve ilgili diğer tüm yapılandırma dosyalarından RBI'a ait her türlü fonksiyonu, portu, probe testini ve çevre değişkenini cerrahi bir operasyonla tamamen kazıyıp atın.

### 1.4. Kopyala-Yapıştır ve Telif Riski Taşıyan Kalıntılar (Lovable & OpenWebUI)
- **Etkilenen Modüller:** `local-server/lib/cloud-transport.mjs` (L16, L39, L43), `local-server/lib/chat-templates.mjs`
- **Sorun Tanımı:**
  - **Cloud Enjeksiyonu:** `cloud-transport.mjs` içinde doğrudan `Lovable AI Gateway` ve `Lovable-API-Key` gibi Lovable'a özel yönlendirmeler ve API anahtarı kontrolleri hardcoded olarak kodun içine gömülmüş.
  - **OpenWebUI Kopyalamaları:** Chat şablonları ve API entegrasyonlarında özgün olmayan, OpenWebUI projesinden doğrudan kopyala-yapıştır yapılmış hantal yapılar bulunuyor. Bu durum gelecekte telif/lisans (copyright/licensing) sorunları doğurabilir.
- **Eylem Planı:** Kod tabanındaki tüm Lovable AI Gateway ve OpenWebUI kalıntılarını tamamen temizleyin. API entegrasyonlarını ve bulut modeli taşıyıcılarını tamamen özgün ve agnostik şemalarla yeniden yazın.

### 1.5. "Non-Semantic" ve Kırılgan Regex Prangaları
- **Etkilenen Modüller:** `local-server/lib/routes/chat-orchestrate.mjs` (L21, L619, L680, L800), `local-server/lib/rag/intent-classifier.mjs` (L190, L197, L200, L416), `agents/_shared/mlx_runner.py` (L98, L360, L363, L407, L427), `local-server/lib/mcp/catalog.mjs` (L4, L10), `local-server/lib/routes/mcp.mjs` (L33, L46), `local-server/lib/agents-manifest.mjs` (L100, L125, L158), `local-server/lib/rag/scoring.mjs` (L31, L48, L86), `local-server/lib/rag/retrieval.mjs` (L45, L77, L158, L231, L307), `local-server/lib/meta-forge/stream-parser.mjs`, `local-server/lib/tool-call-parser.mjs`
- **Sorun Tanımı:**
  - **Regex ile Niyet Tespiti Çöküşü:** "LA minör gamı" gibi müzik teorisi sorularını bile yaratma fiillerini (`hasCreationVerb`) veya ajan kısayollarını yakalayan regex'ler yüzünden yanlışlıkla Meta-Forge / Ajan tetikleme niyetleri olarak algılıyor.
  - **Manuel JSON ve Brace-Balancing Parser'lar:** `stream-parser.mjs` and `tool-call-parser.mjs` dosyaları, JSON çıktılarını ve araç çağrılarını yakalamak için kırılgan regex'ler ve manuel parantez dengeleme algoritmaları kullanıyor. Bu durum en ufak bir biçimlendirme farkında parser'ın patlamasına yol açıyor.
  - **SQL Seviyesinde Regex:** `retrieval.mjs` içinde PostgreSQL'e özgü `regexp_replace` fonksiyonları doğrudan SQL sorgularına gömülerek veritabanı agnostikliğini kısıtlayıp performansı düşürüyor.
- **Eylem Planı:** Tüm niyet tespiti, ajan tetikleme ve kısayol kontrol işlemlerini regex'lerden arındırıp tamamen semantik (embedding tabanlı) hale getirin. Manuel parantez tarama algoritmaları yerine standart, kararlı JSON streaming kütüphaneleri kullanın. Veritabanı sorgularını standart SQL yapılarına çevirin.

---

## 2. GENEL KOD KALİTESİ VE AGNOSTİKLİK DETAYLARI

### 2.1. "Hataları Halının Altına Süpürme" (Silent Failures) Sinsi Dünyası
- **Etkilenen Modüller:** `local-server/lib/watchdog.mjs` (L20, L32), `local-server/lib/agent-rag.mjs` (L378, L400), `local-server/lib/agent-env.mjs`, `local-server/lib/capability-registry.mjs` (L59 - `withSavepoint`)
- **Sorun Tanımı:**
  - **Görünmez Hatalar:** Lovable, sistemde bir hata olduğunda çökme (crash) görünmesin diye neredeyse tüm kritik modülleri (RAG context, secret enjeksiyonu, watchdog kalıcılığı) boş `try/catch` bloklarına boğmuş.
  - **T-Shoot İşkencesi:** Veritabanı veya ağ kilitlendiğinde sistem hata vermiyor, sadece "sessizce" başarısız oluyor. Kullanıcı her şeyin yolunda olduğunu sanırken arka planda işlemler yarım kalıyor ve hata kaynağını tespit etmek imkansızlaşıyor.
- **Eylem Planı:** Boş ve sadece `console.warn` basan `try/catch` bloklarını temizleyin. Hataları uygun loglama katmanlarına (structured logging) yönlendirerek arayüze ve operatör paneline anlamlı hata raporları sunun.

### 2.2. Hantal HTTP Loopback Çağrıları (Overhead)
- **Etkilenen Modüller:** `local-server/lib/mcp/dispatch.mjs` (L45), `local-server/lib/tool-call-parser.mjs` (L96), `local-server/lib/tool-adapters.mjs` (L127)
- **Sorun Tanımı:**
  - **Süreçler Arası Hantallık:** MCP sunucusu, otonom ajanların tool trace parser'ı ve `forge` yetenek adaptörü, Elara'nın dahili işlevlerini çalıştırmak için doğrudan Bun middleware'ine (`/api/agents/...`, `/api/tools/...`, `/api/skills/...`) senkron HTTP POST istekleri (`fetch`) atıyor.
  - **Gecikme (Latency):** Süreç içi doğrudan fonksiyon çağırmak yerine, her aramada HTTP paketi oluşturulup serileştirme yapılması local ortamda devasa bir hantallık yaratıyor.
- **Eylem Planı:** Dahili araç ve yetenek yürütme mantığını, HTTP katmanına uğramadan doğrudan süreç düzeyinde (in-process) çağrılabilecek şekilde yeniden yapılandırın. `dispatch.mjs` ve `tool-call-parser.mjs` modüllerini Express port bağımlılığından kurtararak doğrudan `invokeTool` (tool-adapters) ve ilgili süreç içi runtime çağrılarıyla entegre edin.

### 2.2. Hantal HTTP Loopback Çağrıları (Overhead)
- **Etkilenen Modüller:** `local-server/lib/mcp/dispatch.mjs` (L45), `local-server/lib/tool-call-parser.mjs` (L96), `local-server/lib/tool-adapters.mjs` (L127), `local-server/lib/routes/workflows.mjs` (L125)
- **Sorun Tanımı:**
  - **Süreçler Arası Hantallık:** MCP sunucusu, otonom ajanların tool trace parser'ı, `forge` yetenek adaptörü ve workflow koşturucu node'ları (`workflows.mjs`), Elara'nın dahili işlevlerini çalıştırmak için doğrudan Express middleware'ine (`/api/agents/...`, `/api/tools/...`, `/api/skills/...`) senkron HTTP POST istekleri (`fetch`) atıyor.
  - **Gecikme (Latency):** Süreç içi doğrudan fonksiyon çağırmak yerine, her aramada HTTP paketi oluşturulup serileştirme yapılması local ortamda devasa bir hantallık yaratıyor.
- **Eylem Planı:** Dahili araç ve yetenek yürütme mantığını, HTTP katmanına uğramadan doğrudan süreç düzeyinde (in-process) çağrılabilecek şekilde yeniden yapılandırın. `dispatch.mjs`, `tool-call-parser.mjs` ve `workflows.mjs` modüllerini Express port bağımlılığından kurtararak doğrudan `invokeTool` (tool-adapters) ve ilgili süreç içi runtime çağrılarıyla (`runLocalAgent`/`streamLocalAgent`) entegre edin.

### 2.4. Hardcoded "python3" / "bun" ve İzole Yollar (Agnostiklik Zedelenmesi)
- **Etkilenen Modüller:** `local-server/lib/meta-forge/smoke.mjs` (L19), `local-server/lib/meta-forge/refresh.mjs` (L11), `local-server/lib/agent-runs.mjs` (L86), `local-server/lib/agent-env.mjs` (L231), `local-server/lib/disk-runner.mjs` (L39), `local-server/lib/routes/vision-service.mjs` (L85), `local-server/lib/routes/brand-aliases.mjs` (L108)
- **Sorun Tanımı:**
  - **Hardcoded python3 / bun**: `smoke.mjs`, `agent-runs.mjs`, `agent-env.mjs`, `disk-runner.mjs` ve `vision-service.mjs` modülleri processes/script koştururken `python3` binary adını doğrudan hardcoded olarak kullanıyor. `brand-aliases.mjs` ise `bun run` processes'ini doğrudan path üzerinden `bun` executable adıyla tetiklemeye çalışıyor. Bu, .venv sanal Python ortamı veya Bun path'i izole olan Linux/WSL kurulumlarında bağımlılık zafiyeti yaratır ve testleri/süreçleri patlatır.
  - **Uydurma PROJECT_ROOT**: `refresh.mjs` kendi proje kökünü `fileURLToPath` yardımıyla hardcoded olarak `../..` seviyelerinde çözmeye çalışıyor.
- **Eylem Planı:** `os_utils.mjs` ve `os_utils.sh` dosyalarını sıfırdan yazarak `PROJECT_ROOT`'u dinamik olarak çözün (`import.meta.url` veya `dirname "$0"` kullanarak). Tüm hardcoded `/Users/levent/...` ve `/home/levent/...` yollarını ve Python/Bun binary yollarını temizleyip dinamik venv çözümlemesine geçirin. Ajan, disk, vision ve alias süreçlerindeki Python/Bun çağrılarını `os_utils.mjs`'teki agnostik `getPythonBinary()` fonksiyonu ile entegre edin.

### 2.5. Veritabanı ve Ağ Hatalarını Sessizce Yutma (Sinsi Catch Blokları)
- **Etkilenen Modüller:** `local-server/lib/mcp/catalog.mjs` (L21), `local-server/lib/meta-forge/planner.mjs` (L15-22), `local-server/lib/write-queue.mjs` (L48-63), `local-server/lib/audit-feed.mjs` (L20), `local-server/lib/watchdog.mjs` (L20, L32), `local-server/lib/routes/backup.mjs` (L108), `local-server/lib/routes/rag-diagnostics.mjs` (L95, L115), `local-server/lib/routes/graph.mjs` (L5-25), `local-server/lib/routes/rag-readops.mjs` (L23, L38), `local-server/lib/routes/engine.mjs` (L51, L86), `local-server/lib/routes/workflows.mjs` (L286)
- **Sorun Tanımı:**
  - **Görünmez Hatalar**: DB sorguları, diagnostic analizler, grafik sorgulamaları, asenkron yazma veya workflow/chain durum kayıtları patladığında `.catch(() => ({ rows: [] }))` veya boş `try/catch` blokları ile sessizce geçiştiriliyor. `write-queue.mjs` asenkron yazmalarda hata aldığında sadece `console.error` basıp akışı kesmiyor; veritabanı kısıt kilitlenmelerinde dahi sistem "hiç hata yok" gibi davranıp veri kaybına sebep oluyor. `audit-feed.mjs` ise SIEM kuyruğuna veri atarken hata aldığında bunu tamamen sessizce yutuyor. Restorasyon sırasında dökümanlar yazılırken (`restoreUploadsFromBuffer`, L108) hata oluşursa sessizce geçiliyor; bu durum eksik veriyle başarılı rapor dönülmesine sebep oluyor. Teşhis, RAG read-ops ve workflow modülleri veritabanı sorgusu kilitlendiğinde veya bağlantı koptuğunda boş nesne/sıfır niyet dönüp hataları sinsi catch bloklarıyla örtbas ediyor.
- **Eylem Planı:** Boş catch bloklarına ve asenkron hata yönetim noktalarına hata loglama (`console.error` veya structured logging) ekleyin, kritik sistem çökmelerini (database connection loss vb.) operatör paneline anlamlı şekilde bildirin.

### 2.7. Hantal ve Fuzuli I/O / Bellek Döngüleri
- **Etkilenen Modüller:** `local-server/lib/routes/threads.mjs` (L11), `local-server/lib/routes/models.mjs` (L61-90), `local-server/lib/routes/rag-ops.mjs` (L31)
- **Sorun Tanımı:**
  - **Her Rota Çağrısında Senkron DB I/O**: `threads.mjs` her chat odası listelendiğinde, içinde mesaj olmayan ve default ismi olan tüm odaları DB'den silmek üzere senkron DELETE fırlatıyor. Bu işlem her sayfa açılışında veritabanı darboğazı yaratıyor.
  - **Gereksiz Bellek Map ve SQL Flush**: `models.mjs` yeni model eklendiğinde bunu doğrudan DB'ye yazmak yerine in-memory `pendingModelCache` Map'inde tutuyor ve her 5 saniyede bir `setInterval` ile asenkron flush etmeye çalışıyor. Local-first bir OS için fuzuli olan bu karmaşık yapı, ani kapanışlarda model veri kaybı riski doğuruyor.
  - **Senkron SQL Kilitlenmesi (Exclusive Row Lock)**: `rag-ops.mjs` ağır `brand-backfill` işlemini tek transaction'da senkron UPDATE sorgusuyla yapıyor. Büyük kütüphanelerde bu Express thread'ini ve PostgreSQL'i dakikalarca kilitleyen bir prangadır.
- **Eylem Planı:** Odaları temizleme (garbage collection) ve ağır RAG bakım işlerini Express rotası içinden değil, asenkron background janitor (`system-jobs.mjs`) aracılığıyla periyodik yürütün. Modelleri in-memory Map'e almak yerine doğrudan veritabanına yazın.

### 2.9. Şema Dosyası Düzensizliği ve Mükerrer ALTER TABLE Komutları
- **Etkilenen Modüller:** `local-server/schema.sql` (L158-202)
- **Sorun Tanımı:**
  - **Şema Çöplüğü**: `schema.sql` dosyası sıfırdan veritabanı kurarken dahi tabloları temiz bir şekilde oluşturmak yerine, `CREATE TABLE` komutlarının hemen altında sonradan eklenmiş düzinelerce `ALTER TABLE ADD COLUMN IF NOT EXISTS` komutu barındırıyor (özellikle `models` ve `agents` tablolarında). Bu durum, ilk kurulum sırasında veritabanı motoruna mükerrer DDL yükü bindirmekte ve şema takibini zorlaştırmaktadır.
- **Eylem Planı:** Tüm `ALTER TABLE` komutlarını ilgili `CREATE TABLE` bloklarının içine doğrudan (inline) yedirerek `schema.sql` dosyasını sıfırdan tertemiz kurulabilir tek bir "bütünsel şema dosyası" haline getirin. Geriye dönük uyumluluk güncellemelerini sadece migration script'lerinde saklayın.

### 2.8. Frontend Üzerindeki Platform Bağımlılıkları ve Lovable Kalıntıları
- **Etkilenen Modüller:** `src/components/mac-folder-picker.tsx` (L12, L59), `src/components/mac-file-picker.tsx`
- **Sorun Tanımı:**
  - **Arayüzde Mac Markası Prangası**: Dosya ve klasör tarama işlevleri için tasarlanan bileşenler doğrudan `MacFolderPicker` ve `MacFilePicker` olarak isimlendirilmiş, placeholder yolları `/Users/you/path` gibi sadece macOS home klasör yapısına göre hardcoded mühürlenmiştir. Bu durum WSL Linux / Windows LAN istemcilerinde platform agnostikliğine aykırıdır.
- **Eylem Planı:** Bu bileşenleri `UniversalFolderPicker` ve `UniversalFilePicker` olarak yeniden adlandırın. Bileşen placeholder'larını ve default yollarını, arka plandaki dinamik işletim sistemi tespiti (`os_utils.mjs`) üzerinden gelen platform tipine göre (macOS için `/Users/`, Linux için `/home/`) akıllı ve dinamik hale getirin.

---

## 3. MASTER EYLEM PLANI (MIGRATION & EVOLUTION MAP)

### Faz A: Performans ve Hantallık Arındırma (Immediate Optimization)
1. **A1 - Watchdog Devre Dışı Bırakma:** `mlx-transport.mjs` ve `agent-bridge.mjs` içindeki agresif watchdog resets mantığını tamamen kaldırın.
2. **A2 - MLX Warmup Purge:** `mlx-warmup.mjs` içindeki keep-warm ping döngülerini temizleyin, modeli RAM'de zorla sıcak tutma paranojasını sonlandırın.
3. **A3 - RAG & DB I/O Hafifletme:** Ajan başlatılırken tetiklenen tekrarlı DB sorgularını önbelleğe (cache) alın, `capability-registry` içindeki ağır `SAVEPOINT` döngüsünü kaldırın.

### Faz B: Tam OS-Agnostik Geçiş (Agnostic Transition)
1. **B1 - Dinamik os_utils:** `os_utils.mjs` ve `os_utils.sh` içindeki tüm hardcoded `/Users/levent/...` ve `/home/levent/...` yollarını temizleyip dinamik proje kökü çözümlemesine geçirin. `os_utils.sh`'taki kırık slash siliciyi düzeltin.
2. **B2 - Cerrahi RBI Temizliği:** `tool-adapters.mjs` içindeki tüm hayalet RBI kodlarını ve hardcoded portları tamamen silin.
3. **B3 - Telif ve Residue Temizliği:** `cloud-transport.mjs` ve diğer tüm modüllerdeki Lovable, OpenWebUI kalıntılarını tamamen temizleyin.

### Faz C: Semantik ve Dinamik Dönüşüm (Semantic Freedom)
1. **C1 - Regex'ten Semantiğe Geçiş:** `intent-classifier.mjs` and `agent-bridge.mjs` içindeki niyet tespiti, ajan tetikleme regex'lerini tamamen embedding tabanlı semantik sınıflandırıcıya devredin. "LA minör gamı" gibi false-positive'leri tamamen engelleyin.
2. **C2 - Dinamik Model ve Template Yönetimi:** Modellerin kendi yerleşik şablonlarını dinamik okumasını sağlayarak manuel SQL güncellemelerine son verin.
3. **C3 - MCP Tam Entegrasyon:** MCP sunucusundaki mock kısımları (`resources/list`, `prompts/list`, OAuth) tamamen işlevsel ve güvenli hale getirin, HTTP loopback overhead'lerini kaldırın.
