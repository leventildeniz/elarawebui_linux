# ELARA Core Agent Instructions & Engineering Rules

## 1. Mimari & Kapsam
- **Faz:** Yeni UI geçisi ve backend refactoring.Yeni UI in mevcut Backende uyarlanmasi.Gerekli durumlarda Backend tarafinda refactoring.
- **Standart:** Enterprise-grade, Agnostic (Linux/macOS), yüksek ölçeklenebilir (Load Balancer hazir).
- **Entegrasyon Zinciri:** UI (Vite) <--> API (api-v2.mjs) <--> Backend/Workers <--> DB (PostgreSQL). Tüm zincir uçtan uca dogrulanmalidir.
- **State Yönetimi:** Split-brain durumlarini engellemek için `store.ts` dosyalarindaki state akislari dikkatle korunmalidir.
-**Kod Temizligi ve Standartizasyon:**En önemli asamadir.Kesinlikle adim adim,acele etmeden bilinçli sekilde yapilmalidir.Temizlik ve standartizasyon UI (Vite) <--> API (api-v2.mjs) <--> Backend/Workers <--> DB (PostgreSQL) olacak sekilde tüm zincir olarak ele alinmalidir.Etki tepki hesabi yapmadan ve emin olmadan aksiyon alinmamalidir.
Kod içerisindeki Türkçe commentler ingilizce yapilmalidir.Standartizasyon yapilirken,lovable zamanindan kalma TUR,TUR-A,MLX/mlx gibi ifadeler,fonksiyonlar varsa bunlar raporlanmali ve onay sonrasi aksiyon alinmalidir.MOCK data kalmamalidir.
Gereksiz kod dosyalari versa bunlar raporlanmalidir.

## 2. Kirmizi Çizgiler (Kati Kurallar)
- **Git Yetkisi:** Açik onay olmadan ASLA `git commit`, `git restore` veya `git reset` çalistirma.
- **Sed & Regex Yasagi:** Dosyalari bozan toplu `sed` komutlari ve token/API limitlerini patlatan derin `regex` aramalari KESINLIKLE YASAKTIR.
- **Arama Kisiti:** Arama ve grep islemlerini sadece ilgili kaynak alt dizinleriyle sinirla; devasa log veya build çiktilarini tarama.
- **DB Güvenligi:** Onay almadan migration, seed veya drop script'i kosturma.
- **UI Bütünlügü:** UI bilesenlerini kafana göre yeniden tasarlama; her degisikligi ilgili buton ve akis bazinda mantiken test et.
- **Operasyon:** Hesapsiz,kitapsiz kafana göre acele ile is yapma.Bir yere müdahale ederken diger yere etkisi ne olur onu düsünerek hareket et.Çalisan sistemde bozulmasin.Heyecan istemiyorum,sakin ve soguk kanli kal.Devreye alina herhangi feature MOCK datadanda arindirilacaktir.


## 3. Aktif Context & Referans Dosyalari
Gereksiz varsayim yapma, sadece su güncel dokümanlari baz al:
- `.forge/knowledge/context.md`
- `.forge/knowledge/ELARA-Sovereign-Studio-UI-Technical-Documentation.md`
- `.forge/knowledge/v2_master_schema.sql` (Tek geçerli DB semasi,DB ye kesinlikle bakilmasi gerekebilir.Bu semanin uzerine eklemeler,gelistirmeler oldu.)


## 4. Sistem Ortami & Servisler
- **Servisler:** `elara-worker.service`, `elara-middleware.service`, `elara-vite.service`, `elara-tls-proxy.service`
- **DB:** `postgres://sovereign:sovereign@127.0.0.1:5432/elara_db`
- **API Giris:** `api-v2.mjs`

## 5. Zorunlu Imza (Kanarya Kurali)
- Her yanitinin en son satirina kesinlikle tek basina `[FENER]` yazacaksin.