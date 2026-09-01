---
name: No hidden backend prompts/directives
description: Backend'de gömülü system prompt / directive / rewrite prompt / typo map YASAK — hepsi UI'dan görünür ve düzenlenebilir olmalı; aksi UI=tek mercii kuralının ihlali
type: preference
---

# Arka tarafta gizli prompt/directive YASAK

**Kural (kullanıcı sözü, 2026-06-03):**
> "böyle arka tarafta birşeyler saklarsak problem çıkınca çözemeyiz ve UI kullanmamızın anlamı olmaz... sürekli böyle tatsız problemlerle uğraşırız."

**Why:** UI = tek mercii (core rule) ihlali. Backend'de gömülü prompt = debug edilemez kara kutu. Kullanıcı Gemma vs Qwen3 vs cloud model için direktif tonunu değiştiremiyor, sadece kod commit ile değişiyor.

**Kapsam — hiçbir aşağıdaki şey kodda gömülü kalmaz:**
1. RAG inspector directive (her madde N cümle, brand-lock, Kaynaklar: format)
2. Smalltalk system guard ("skill TETİKLEME, /no_think")
3. Free-answer prompt (library-aware in/out tonu)
4. Cross-vendor demote prompt
5. Extractor system message (typo fix, "/no_think")
6. HyDE expand prompt
7. Denoise rewrite prompt
8. Herhangi bir LLM'e giden system/user prefix metin

**How to apply:**
- Her prompt → `RAG_SETTINGS` veya `models.*` kolon, UI textarea
- Default değer kodda KALABİLİR ama "UI boş → default" şeklinde fallback olarak; UI doluysa UI kazanır
- Yeni prompt eklenirken plan-first; "küçük bir system prompt ekleyim" YASAK
- Audit refleksi: yeni LLM çağrısı görürsen, system/user metnin nereden geldiğini sor — kodda string literal varsa kırmızı bayrak

**İhlal tarihçesi:**
- 2026-06-03: 6 hat gömülü directive tespit edildi (RAG inspector × 2 hat, smalltalk guard, free-answer, extractor, HyDE, denoise). Plan: UI'ya taşınacak.
