---
name: meta-forge-false-positive-smalltalk
description: Meta-Forge deterministic keyword gate normal sohbeti de plan olarak yorumluyor — Tur 8 hardcore fix
type: feature
---

# Meta-Forge false-positive on smalltalk (2026-07-03 EOD)

## Belirti
Kullanıcı normal muhabbet cümleleri yazıyor:
- "Bugun artık kendi ajan,tools ve skill lerini kendin create edip çalıstırabilecek yetkilere kavustun" → plan tetiklendi (skill:self-evolution-logic, tool:capability-manager, agent:meta-architect, pack:self-evolution-kit)
- "suan konustuugmuz yazılım uzerine bugun bir feature ekledik. Artık MCP server ve client olarakta connectivity saglayabilecegiz" → plan tetiklendi (tool:mcp-connection-manager)

Her ikisi de **konuşma/anlatım** — "create/oluştur" komut niyeti YOK. Deterministic keyword gate (`isMetaForgeCreationRequest`) "create/tool/agent/skill/pack" kelimelerini görüp kilitleniyor.

## Kök neden (tahmin)
`isMetaForgeCreationRequest()` keyword gate çok cömert:
- "kavustun" / "ekledik" / "saglayabilecegiz" gibi **bildirim fiilleri** komut fiili sanılıyor
- TR imperative morfoloji ("oluştur/yap/kur") ile bildirim ("yaptık/eklendi/kavuştu") ayrımı yok
- MCP/agent/tool/skill isim geçen HER cümle plan lane'ine düşüyor

## Yarına plan (hardcore, Tur 8)
1. **Ölçüm önce:** Son 20 chat'ten kaç tanesi false-positive meta-forge tetikledi? `meta-forge-debug.sh` genişlet
2. **Gate sıkılaştır:**
   - TR imperative form whitelist: `oluştur|yap|kur|ekle|yarat|inşa et|hazırla` (fiil sonu -ma/-me kabul)
   - Bildirim/geçmiş zaman blacklist: `-dık|-dik|-tik|-tuk|-mış|-miş|kavuştu|eklendi|kuruldu`
   - "sen/biz" bildirim öznesi + past tense → SKIP
3. **İki-katmanlı karar:** keyword gate PASS → hafif LLM classifier (1s deadline) "user is requesting NEW creation? y/n" → ancak evet ise `meta_forge` lane
4. **Fallback:** false-positive'de plan otomatik `rejected` olarak silinsin (kullanıcı UI'dan onaylamazsa 5dk sonra), böylece kalabalık olmaz

## Kullanıcı sözü
> "bu normal muhabbetleride sokuyor Meta-Forge Plana .. yarın bakarız hardcore'um ben"

## Bugünkü açık items (kümülatif)
1. Bulk delete UI (`DELETE /api/meta-forge/plans/:id` + bulk endpoint)
2. Mixed content fix (HTTPS page → HTTP :3005 API)
3. `/api/vision/config` 401
4. Stream hattı simetri (`stream-turn1.sse`'de 0 partial frame)
5. **YENİ: Meta-Forge false-positive gate** (hardcore, yarın öncelik)

## Ders
Deterministic keyword gate hızlı ama TR morfoloji için yetersiz. Semantic classifier (küçük LLM, 1s deadline) mecburi ikinci katman — Tur 3-6 planındaki "deterministic gate söküp semantic'e bırak" adımı artık ertelenemez.
