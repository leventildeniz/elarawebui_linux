# 🗺️ ELARA PROJECT MASTER BLUEPRINT

## 1. Yüksek Seviye Mimari (High-Level Design)
ELARA, üç ana katmandan oluşan hibrit bir mimariye sahiptir:
- **Frontend (UI Layer):** React + Vite + Tailwind. Kullanıcı etkileşimi, chat arayüzü ve sistem yönetim panellerini yönetir.
- **Middleware (Orchestration Layer):** Node.js (Express). Sistemin beynidir. Kimlik doğrulama, RAG (Retrieval-Augmented Generation), Ajan Yönetimi, Model Yönlendirme ve DB erişimini sağlar.
- **Agent Layer (Execution Layer):** Python tabanlı otonom ajanlar. Spesifik görevleri (NetSec, SocialMedia vb.) yerine getiren, `execFile` ile tetiklenen izole betiklerdir.

### Veri Akış Diyagramı (Data Flow)
`Kullanıcı` $\rightarrow$ `Frontend` $\rightarrow$ `Middleware API` $\rightarrow$ `Dispatch (Karar)` $\rightarrow$ `Agent Bridge (İnfaz)` $\rightarrow$ `Python Agent` $\rightarrow$ `LLM (MLX/Gemini)` $\rightarrow$ `Middleware` $\rightarrow$ `Frontend` $\rightarrow$ `Kullanıcı`

---

## 2. Alt Seviye Tasarım (Low-Level Design)

### A. Dispatch Mekanizması (`dispatch.mjs`)
İstekleri şu öncelik sırasıyla yönlendirir:
1. **Explicit Commands:** `!slug` veya `@[tool]` kullanımı.
2. **Lexical Match:** Kelime ağırlıklarına göre (İsim: 3.0, Tag: 1.5, Desc: 1.0) en yakın yeteneği bulma.
3. **LLM Router:** Yukarıdakiler başarısız olursa isteği genel chat akışına bırakma.

### B. Agent Bridge (`agent-bridge.mjs`)
Python ajanlarını güvenli bir şekilde koşturur:
- **Tetikleme:** Model çıktısındaki "tetikliyorum: x.py" gibi ifadeleri Regex ile yakalar.
- **Güvenlik:** `execFile` kullanarak shell injection'ı önler. Sadece `allow-list` içindeki ajanları çalıştırır.
- **Enjeksiyon:** Ajanlar çalıştırılmadan önce RAG sonuçları, sistem promptları ve zaman bilgisi `env` değişkenleri üzerinden Python sürecine enjekte edilir.

### C. RAG Sistemi
- **Süreç:** Middleware, kullanıcı sorgusunu alır $\rightarrow$ DB'den ilgili parçaları (chunks) çeker $\rightarrow$ Bunları `ELARA_AGENT_RAG_CONTEXT` olarak ajana iletir.
- **Kural Seti:** Ajanlar, kaynak varsa mutlaka kaynaklara sadık kalmalı ve `[#1]` şeklinde atıf yapmalıdır.

---

## 3. Veritabanı Şeması (DB Schema)
**PostgreSQL** üzerinde çalışan merkezi bir yapı:
- `app_users` & `app_groups`: RBAC (Rol Tabanlı Erişim Kontrolü) ve kimlik yönetimi.
- `models`: LLM konfigürasyonları, transport tipleri (mlx_local, openai_compatible) ve safety ayarları.
- `agents`: Ajan kayıtları, durumları, öncelikleri ve dosya yolları.
- `chat_threads` & `chat_messages`: Sohbet geçmişi ve session yönetimi.
- `action_library`: Forge motoru için dinamik aksiyonlar ve tetikleyiciler.
- `runs`: Her bir ajan/yetenek çalışmasının detaylı izleme (trace) kayıtları.

---

## 4. API Bağlantıları ve Portlar
- **Frontend $\rightarrow$ Middleware:** `http://<host>:3005` veya `https://<host>:10443` (TLS Proxy üzerinden).
- **Middleware $\rightarrow$ Local LLM (MLX):** `http://127.0.0.1:8001/v1`.
- **Middleware $\rightarrow$ Python Agents:** `spawn` / `execFile` (Süreç bazlı iletişim).
- **Python Agents $\rightarrow$ External APIs:** Gemini API, Network Device APIs (Fortinet, Cisco vb.).

---

## 5. Dosya ve Klasör Haritası
- `src/`: Frontend kaynak kodları.
- `local-server/`: Backend (Middleware) mantığı, API rotaları ve DB migrasyonları.
- `agents/`: Python ajan ordusu ve ortak kütüphaneler (`_shared`).
- `tools/`: Araç kontratları (JSON) ve uygulama kodları.
- `mem/`: Proje kararları ve yol haritası dokümanları.

---

## 6. Güvenlik Modeli
- **Sovereign Identity:** Tüm kullanıcı verileri yerel DB'de tutulur, buluta gönderilmez.
- **Agent Isolation:** Ajanlar kısıtlı yetkilerle ve sanitize edilmiş argümanlarla çalıştırılır.
- **TLS Proxy:** LAN üzerindeki istemciler için güvenli HTTPS tüneli sağlanır.