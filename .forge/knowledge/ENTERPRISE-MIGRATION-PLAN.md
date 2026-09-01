# ELARA Sovereign Studio — Enterprise Migration & Refactor Plan

## 1. Sistemin Durumu (Where are we?)

### 1.1 Backend & DB (S.A.R.P. Refactor Sonrası)
- Mimari: Vendor-agnostic. Tüm routing HNSW ve HyDE tabanlı vektör anlambilimine (pure vector semantics) dayanıyor.
- Worker & RAG: OOM sızıntıları giderildi.
- Database: Kullanıcı, RAG dökümanları ve ajan kayıtları için temel tablolarımız var. Ancak, tablolar eski "Basit Chat" mantığıyla tasarlanmış.

### 1.2 Yeni Frontend (Lovable'dan Gelen Sovereign Studio UI)
- Durum: Mükemmel ancak tamamen "Demo" / "Mock" verilerle çalışıyor.
- Kopukluk (Gap): Yeni UI'da eski backend'in hiç bilmediği yepyeni Enterprise modüller var (Certificates, Services, User Templates vs).

## 2. Sorun Tespitleri
1. DB Şema Uyumsuzluğu: Yeni UI'ın beklediği esnek özellikler arka tarafta desteklenmiyor.
2. Kopuk API Rotaları: Frontend'deki fetch istekleri arka uçta 404 (Not Found) yiyor.
3. Mock Bağımlılığı: Frontend'i sahte verilerden aniden koparmak Type (Tip) uyuşmazlıklarına (örn: objeye karşı string) sebep oluyor.

## 3. Stratejik Yol Haritası (Master Plan)

### Phase 1: Foundation (Veritabanı ve Şema Uyumlandırması)
Frontend'in ihtiyaç duyduğu (Groups, Templates, Services, Config) modeller analiz edilerek, PostgreSQL veritabanında yeni tablolar oluşturulacak. (Bu işlemi az önce tamamladık).

### Phase 2: Auth, Identity & RBAC Entegrasyonu
Mock kullanıcı verileri hemen silinmeyecek. Önce backend'e bu UI'ın beklediği formatta (JSON) veri dönecek olan API uçları (Rotaları) yazılacak. Tip uyuşmazlıkları haritalanacak.

### Phase 3: Governance (Services, Certificates, Templates)
Yeni eklenen Enterprise arayüz modüllerinin arkaplan operasyonları bağlanacak.

### Phase 4: Core Chat & RAG (Son Aşama)
Güvenlik katmanı oturduktan sonra, en karmaşık yer olan "Sovereign Chat" ve SSE (Server-Sent Events) canlı akışları gerçek api-v2 uçlarına bağlanacak.

## 4. Geliştirme Protokolü
1. Analiz Öncesi Kod Yazma Yok: Dosyanın hangi Mock veriyi beklediği, hangi tiplerle çalıştığı analiz edilecek.
2. Kademeli Geçiş: Kökten silmek yerine sahte veriler bypass edilecek.
3. Log & Debug Kanıtı: Sadece varsayıma dayalı değil, gerçek hata loglarına göre aksiyon alınacak.
