import sys

content = """
## 28. Completed (Phase 28) - Multi-Turn ReAct Stability, ACL Sync & Vault V2 Integration
- **Sorun 1 (Tool Animasyonunda İsim Görünmemesi) Çözüldü:** Arayüz (), veritabanı ID'leri yerine görsel isimlerden (label) ID üretiyor (Örn: ) ve backend'e yolluyordu. Backend bu aracı bulamadığı için UI'a  dönmüyor, animasyon asılı kalıyordu. UI'ın tool şemaları ve seçim listeleri DB'deki orijinal ID'leri ( vb.) kullanacak şekilde refactor edildi. SSE stream içinde fuzzy-match destekli bir  eşleşmesiyle animasyonların arayüzde doğru isimlerle ve sürelerle (ms) çalışması sağlandı.
- **Sorun 2 (Agent Capability ACL Block) Çözüldü:** Arayüzde bir ajanın yetkileri düzenlendiğinde (), güncel tool'ların güvenlik (ACL) tablosu olan  tablosuna yazılması unutuluyordu. Ajanların tool çağrıları  motoru tarafından FAILED (0.0s) olarak engelleniyordu. Güncelleme (PUT) metoduna  sync (DELETE & INSERT) mekanizması eklendi.
- **Sorun 3 (Vault V2 URI Şeması) Çözüldü:** Arayüz (), şifre seçildiğinde değeri backend'e  şeklinde çift prefixli yolluyordu. Bu UI bug'ı silindi. Ayrıca backend'deki merkezi credential çözücü (), eski formattaki tyrolarını ve çoklu slash fazlalıklarını otomatik parse edecek şekilde regex/loop korumalı hale getirildi. Artık LLM'ler ve Tool'lar kasa şifrelerini hatasız çekiyor.
- **Sorun 4 (Model Halüsinasyonları & Context Contamination) Çözüldü:** LLM'e (Agentic Loop'ta) tool yanıtlarını geri beslerken içerik () boş diye "assistant" tool-çağrı mesajlarını (intent) silen filtre devre dışı bırakıldı. LLM'lerin sadece aracı değil, asistanın hangi amaçla çağırdığını da tarihçede görmesi sağlandı. Ayrıca araçların  array'i boş olunca LLM'in aracı "gereksiz" bulup halüsinasyona düşmesi problemi keşfedildi ve DB'de araçlara (Örn: ) boş da olsa opsiyonel parametre eklendi.
- **Dinamik Adapterler (Sıfır Node.js Editi):** Araçların test için  modunda MJS'e gömülü olması bırakıldı.  ve  araçları  ve  adapterlerine bağlanarak dinamik çalışacak şekilde (,  veya lokal  dosyaları üzerinden) DB'den güncellendi. Elara'nın "Agnostic" dışa bağımlı Tool Engine'inin sınırları test edildi.
- **Sorun 5 (UI Model Resolution & Provider Arg):** Arayüzün model  gönderme sorunu  ile çözüldü. Backend'de Advanced model ayarlarına (Parallel tool calling vb.) erişimi engelleyen  unassigned provider hatası onarıldı.

## 29. IN PROGRESS (Phase 29) - Google Gemini "Thought Signature" Parity & Local LLM Advanced Payload Debugging
- **Sorun 1 (Google Gemini "Thought Signature" API Bug):** Gemini Flash Lite 3.1 modellerine birden fazla tool (Parallel Tool Calling) iletildiğinde ve model 2 araç çağırdığında, Google'ın SSE API'si  dönerken ilk araca  imzasını ekliyor, ancak ikinci araca bunu eklemeyi atlıyor. LLM'e geri sonucu verirken "İmza eksik" (INVALID_ARGUMENT 400 Hatası) fırlatıyor.
  *Çözüm Durumu (Geçici):*  içerisine Google'a özel buffer paylaşımlı bir bypass eklendi ( aktarımı). Ayrıca stream üzerinden gelen chunk'ların network seviyesinde kopuk gelmesi durumuna karşı buffer split/concat mekanizması kuruldu. Kalıcı ve daha stabil çözüm aranacak.
- **Sonraki Adım:** Yeni bir sohbet (Clean Context) açılarak, RAG, MCP ve Tool'ların farklı LLM'ler (Claude, DeepSeek, Local Gemma) üzerindeki kararlılığı geniş çapta test edilecek.
"""

with open('.forge/knowledge/context.md', 'a', encoding='utf-8') as f:
    f.write("\n" + content + "\n")
