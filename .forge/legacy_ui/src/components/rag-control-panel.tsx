import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Activity, RefreshCw, Wrench, Zap, Sliders, Layers, Layers3, Tag, FileWarning, MessageSquareCode, RotateCcw } from "lucide-react";
import { DatabaseAPI, KnowledgeAPI, SystemEngineAPI } from "@/lib/api-client";
void KnowledgeAPI;

import { toast } from "sonner";

type Health = Awaited<ReturnType<typeof DatabaseAPI.ragHealth>>;
type SettingsResp = Awaited<ReturnType<typeof DatabaseAPI.ragSettings>>;
type Settings = SettingsResp["settings"];
type Bounds = SettingsResp["bounds"];

const BATCH_LS_KEY = "rag.retryEmbedBatch";
const BATCH_PRESETS = [500, 1000, 2500];

// In-code default prompts — mirror of local-server/lib/system-prompts.mjs
// and agents/_shared/config_center.py defaults. Shown in UI so operators see
// the baseline text and can fork it. If the textarea content equals the
// default (trim-equal) we persist "" so backend uses the live in-code default.
const PROMPT_DEFAULTS: Record<string, string> = {
  inspectorDirective:
    "TALİMAT (cevap formatı):\n" +
    "• Yukarıdaki kaynak bloklarını DİKKATLE oku ve cevabı SADECE oradaki bilgilerle kur.\n" +
    "• KAYNAK-SORU UYUM KONTROLÜ: Aynı satıcının ürün ailesi tek satıcı sayılır — Fortinet: FortiGate/FortiOS/FortiManager/FortiAnalyzer/FortiSwitch/FortiAP/FortiClient; Cisco: ASA/Firepower/IOS/NX-OS/Nexus; Check Point: SmartConsole/Gaia/R8x; Palo Alto: PAN-OS/Panorama; Citrix: NetScaler/ADC. Yalnızca soru ile kaynaklar TAMAMEN FARKLI satıcılara aitse (örn. soru 'Cisco ASA' ama kaynaklar yalnız Fortinet/Check Point) uydurma — açıkça şunu yaz: 'Kütüphanede bu konu için doğrudan kaynak yok; kendi bilgimle özetliyorum:' ve sonra kendi bilginle cevapla. Aynı satıcının farklı ürün/sürümleri arasında bu satırı YAZMA — kaynakları normal kullan.\n" +
    "• Her ana noktayı kaynaktan çıkarılan SOMUT ayrıntıyla destekle — parametre adı, komut, değer, prosedür adımı, sayı, sürüm; jenerik özet yazma.\n" +
    "• Açıklamayı kısa madde başlarıyla geç — her madde 2-3 cümle teknik detay içersin; iki-üç yerde [Kaynak N] etiketi ile satır içi atıf yap.\n" +
    "{BRAND_LOCK}" +
    "• Cevabın EN SONUNA tek satır olarak şunu ekle (aynen, başka metin olmadan); kaynak-soru uyumsuzluğu varsa bu satırı YAZMA:\n" +
    "Kaynaklar: {SOURCES}",
  inspectorBrandLock:
    "• Yalnızca {BRAND} terminolojisini kullan; başka satıcının ürün adlarını karıştırma.\n",
  extractorSystemPrompt:
    "You extract the technical search core from user messages. Output exactly one short line — the technical question only, no greetings, no filler, no names, no thinking, no preface, no tags. " +
    "Fix obvious vendor name typos (e.g. 'checkpointtte'->'checkpoint', 'fortigatte'->'fortigate', 'paloalto'->'palo alto', 'cisocoo'->'cisco'). " +
    "Preserve version tokens exactly (R81.20, v7.4, FortiOS 7.6).",
  hydeSystemPrompt:
    "You write a short hypothetical technical passage that a real document would contain to answer the question. Output the passage only — no preface, no quotes, no list, no thinking, no tags. " +
    "Fix obvious vendor name typos when echoing them (e.g. 'checkpointtte'->'checkpoint', 'fortigatte'->'fortigate', 'paloalto'->'palo alto').",
  plannerSystemPrompt:
    "Sen bir araç planlayıcısın. Kullanıcının sorusunu okuyup, MEVCUT araçlar listesinden hangilerinin sırayla çağrılması gerektiğini belirleyeceksin.\n\n" +
    "Kurallar:\n" +
    "1. Sadece listedeki araçları kullan. Olmayan bir slug uydurma.\n" +
    "2. Hiç araç gerekmiyorsa boş steps döndür (RAG ve modelin kendi bilgisi yeterli olabilir).\n" +
    "3. En fazla {MAX_TOOLS} adım planla.\n" +
    "4. Cevabını SADECE şu JSON şemasında ver, başka hiçbir şey yazma:\n" +
    "{\n" +
    '  "reasoning": "kısa Türkçe gerekçe (1-2 cümle)",\n' +
    '  "steps": [\n' +
    '    { "slug": "araç-slug", "args": { } }\n' +
    "  ]\n" +
    "}",
  agentRagWithHitsDirective:
    "KNOWLEDGE CONTEXT — AUTHORITATIVE SOURCES BELOW. You MUST build your answer on these snippets.\n" +
    "OPENING LINE (mandatory): start your reply with ONE short sentence in the user's language stating that you consulted these sources: {SOURCES}. Do not invent source names; use only the labels listed.\n" +
    "VENDOR/TOPIC MATCH CHECK: Same-vendor product families count as the SAME vendor — Fortinet: FortiGate/FortiOS/FortiManager/FortiAnalyzer/FortiSwitch/FortiAP/FortiClient; Cisco: ASA/Firepower/IOS/NX-OS/Nexus; Check Point: SmartConsole/Gaia/R8x; Palo Alto: PAN-OS/Panorama; Citrix: NetScaler/ADC. Only when the question and snippets belong to COMPLETELY DIFFERENT vendors (e.g. question 'Cisco ASA' but snippets only Fortinet/Check Point) refuse to cite — open with: 'Kütüphanede bu konu için doğrudan kaynak yok; kendi bilgimle özetliyorum:' and answer from your own knowledge (no [#N] citations). For different products/versions of the SAME vendor, treat the snippets as relevant and cite normally.\n" +
    "PRIMARY RULE: When the snippets DO cover the question, base every concrete claim on them and cite inline like [#1], [#2]. Do NOT answer from model memory when the snippets cover the topic.\n" +
    "NO PADDING: Do NOT add an 'Ek Bilgiler' / 'Additional Information' / 'General Knowledge' trailing section. If the snippets answer the question, stop there.\n" +
    "PARTIAL COVERAGE: Only when a sub-question is NOT covered, address it inline with a brief '— snippet'lerde yok, genel bilgiden:' marker on that line.\n" +
    "NEVER fabricate vendor commands or version numbers; if uncertain, label them as general guidance.",
  agentRagNoHitsDirective:
    "KNOWLEDGE CONTEXT: library was consulted; no matching snippets for this query.\n" +
    "MANDATORY OPENING LINE (in the user's language): start your reply with one short sentence such as \"Kütüphaneme baktım, bu konuda eşleşen kaynak yok; kendi bilgimle cevaplıyorum:\" (or the equivalent in the user's language). Do NOT skip this line.\n" +
    "Then answer FULLY from your own domain knowledge — be concrete with vendor commands, syntax, defaults and procedures. Do NOT refuse, do NOT say only 'bilmiyorum'.\n" +
    "If a technical term in the question looks like a typo of a well-known standard term, answer using the correct standard term — do NOT repeat the misspelling and do NOT invent a meaning/expansion for the misspelled form.",
  agentToolsManifestFrame:
    "Available tools — call EXACTLY one tool per line using:\n" +
    "  !slug({\"key\":\"value\"})\n" +
    "Output the tool call on its own line; do not wrap it in code fences.\n" +
    "\n" +
    "{TOOLS}",
};

const THINK_OFF_PREFIX_DEFAULT = "/no_think\n";

export function RagControlPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [batch, setBatch] = useState<number>(() => {
    if (typeof window === "undefined") return 500;
    const v = Number(window.localStorage.getItem(BATCH_LS_KEY) ?? "500");
    return Number.isFinite(v) && v > 0 ? Math.min(5000, Math.max(1, Math.round(v))) : 500;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(BATCH_LS_KEY, String(batch));
  }, [batch]);

  // UI-only knob — chat debug panels (AGENT RAG DIAG + RAG DEBUG). Default OFF.
  const DEBUG_LS_KEY = "chat.showRagDebugPanels";
  const [showDebugPanels, setShowDebugPanels] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DEBUG_LS_KEY) === "1";
  });
  const toggleDebugPanels = (v: boolean) => {
    setShowDebugPanels(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEBUG_LS_KEY, v ? "1" : "0");
      window.dispatchEvent(new CustomEvent("chat:showRagDebugPanels", { detail: v }));
    }
  };



  const loadAll = async () => {
    const [h, s] = await Promise.all([
      DatabaseAPI.ragHealth().catch(() => null),
      DatabaseAPI.ragSettings().catch(() => null),
    ]);
    if (h) setHealth(h);
    if (s?.ok) { setSettings(s.settings); setBounds(s.bounds); }
  };
  useEffect(() => { loadAll(); const id = setInterval(loadAll, 15000); return () => clearInterval(id); }, []);

  const patchSetting = async (key: keyof Settings, value: number | boolean | string | string[]) => {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    const r = await DatabaseAPI.saveRagSettings({ [key]: value });
    if (!r.ok) toast.error("Settings save failed");
  };

  // 2026-06-03 — UI = tek mercii. String-valued prompt overrides bypass
  // patchSetting (which assumes numeric). Empty string ("") tells backend
  // to fall back to in-code default (lib/system-prompts.mjs).
  const patchPrompt = async (key: keyof Settings, value: string) => {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next as Settings);
    const r = await DatabaseAPI.saveRagSettings({ [key]: value } as Partial<Settings>);
    if (!r.ok) toast.error("Prompt save failed");
  };


  const runAction = async (label: string, fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r.ok) toast.success(`${label}: ${JSON.stringify({ ...r, ok: undefined }).replaceAll('"', "")}`);
      else toast.error(`${label}: ${r.error || "failed"}`);
      await loadAll();
    } finally { setBusy(null); }
  };

  const c = health?.chunks;
  const s = health?.sources;

  return (
    <Card className="glass">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">RAG Control & Health</h3>
          <Badge variant="outline" className="text-[10px] font-mono">single source of truth</Badge>
          <Button size="sm" variant="ghost" className="h-7 ml-auto" onClick={loadAll}>
            <RefreshCw className="h-3 w-3 mr-1" />Refresh
          </Button>
        </div>

        {settings && (
          <div className="rounded-md border border-border bg-card/40 p-3 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold">Auto Ingestion</Label>
                <Badge variant="outline" className={`text-[10px] font-mono ${settings.autoIngestion ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"}`}>
                  {settings.autoIngestion ? "ON · Watchers active" : "OFF · Manual sync only"}
                </Badge>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">
                OFF means disk changes never start ingestion by themselves. Sources are indexed only from explicit Add Source / Sync actions.
              </p>
            </div>
            <Switch
              checked={!!settings.autoIngestion}
              onCheckedChange={(v) => patchSetting("autoIngestion", v as unknown as number)}
            />
          </div>
        )}

        {settings && (
          <div className="rounded-md border border-border bg-card/40 p-3 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold">Auto Re-enrich on Ingest</Label>
                <Badge variant="outline" className={`text-[10px] font-mono ${(settings as Settings & { autoReEnrichOnIngest?: boolean }).autoReEnrichOnIngest ? "border-primary/40 text-primary" : "border-muted-foreground/40 text-muted-foreground"}`}>
                  {(settings as Settings & { autoReEnrichOnIngest?: boolean }).autoReEnrichOnIngest ? "ON · spawn after each ingest" : "OFF · manual from /knowledge/aliases"}
                </Badge>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">
                When ON, every successful document add (file / URL / inline text) automatically spawns brand re-enrichment + stale-marks chunks. Per-brand 409 guard prevents duplicate jobs. Default OFF.
              </p>
            </div>
            <Switch
              checked={!!(settings as Settings & { autoReEnrichOnIngest?: boolean }).autoReEnrichOnIngest}
              onCheckedChange={(v) => patchSetting("autoReEnrichOnIngest" as keyof Settings, v as unknown as number)}
            />
          </div>
        )}

        {/* Health stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
          <Stat label="Chunks" value={c?.chunks ?? "—"} />
          <Stat label="FTS NULL" value={c?.chunks_tsv_null ?? "—"} bad={(c?.chunks_tsv_null ?? 0) > 0} />
          <Stat label="Embed OK" value={c?.embedding_ok ?? "—"} />
          <Stat label="Embed Pending" value={c?.embedding_pending ?? "—"} bad={(c?.embedding_pending ?? 0) > 0} />
          <Stat label="In Progress" value={c?.embedding_in_progress ?? "—"} />
          <Stat label="Stale" value={c?.embedding_stale ?? "—"} bad={(c?.embedding_stale ?? 0) > 0} />
          <Stat label="Embed Error" value={c?.embedding_error ?? "—"} bad={(c?.embedding_error ?? 0) > 0} />
          <Stat label="Sources" value={s?.sources ?? "—"} />
          <Stat label="Parse OK" value={s?.sources_ok ?? "—"} />
          <Stat label="Parse Low" value={s?.sources_low ?? "—"} bad={(s?.sources_low ?? 0) > 0} />
        </div>
        {Array.isArray((health as any)?.recentEmbedErrors) && (health as any).recentEmbedErrors.length > 0 && (
          <details className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] font-mono">
            <summary className="cursor-pointer">Recent embed errors ({(health as any).recentEmbedErrors.length})</summary>
            <div className="mt-2 space-y-1 max-h-40 overflow-auto">
              {(health as any).recentEmbedErrors.slice(0, 10).map((e: any, i: number) => (
                <div key={i} className="truncate">
                  <span className="opacity-60">#{e.id}</span> {e.last_error}
                </div>
              ))}
            </div>
          </details>
        )}

        {(health?.warnings?.length ?? 0) > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] font-mono space-y-1">
            {health!.warnings!.map((w: string, i: number) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}

        {/* Repair actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => runAction("Repair FTS", () => DatabaseAPI.repairFts())}>
            <Wrench className="h-3 w-3 mr-1" />
            {busy === "Repair FTS" ? "Repairing…" : "Repair FTS"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => runAction(`Retry Embeddings (${batch})`, () => DatabaseAPI.retryEmbeddings(batch))}>
            <Zap className="h-3 w-3 mr-1" />
            {busy?.startsWith("Retry Embeddings") ? "Embedding…" : `Retry Embeddings (${batch})`}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={async () => {
              setBusy("Drain Errors");
              let totalWritten = 0;
              let lastRemaining: number | null = null;
              try {
                for (let i = 0; i < 3; i++) {
                  try {
                    const ws = await SystemEngineAPI.workerStatus();
                    if (ws && (ws.status === "down" || ws.status === "starting")) await new Promise(r => setTimeout(r, 2000));

                  } catch { /* ignore */ }
                  const r = await DatabaseAPI.retryEmbeddings(batch);
                  if (r.ok) {
                    totalWritten += r.written ?? 0;
                    lastRemaining = r.remaining ?? null;
                  } else {
                    toast.error(`Drain pass ${i + 1}: ${r.error || "failed"}`);
                    break;
                  }
                  if (i < 2) await new Promise(r => setTimeout(r, 1500));
                }
                toast.success(`Drain Errors: written=${totalWritten} remaining=${lastRemaining ?? "?"}`);
                await loadAll();
              } finally { setBusy(null); }
            }}>
            <Zap className="h-3 w-3 mr-1" />
            {busy === "Drain Errors" ? "Draining…" : "Drain Errors ×3"}
          </Button>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={5000}
              step={100}
              value={batch}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setBatch(Math.min(5000, Math.max(1, Math.round(v))));
              }}
              className="w-20 h-7 font-mono text-[11px] text-center"
              disabled={!!busy}
              aria-label="Embedding batch size"
            />
            {BATCH_PRESETS.map((n) => (
              <Button
                key={n}
                size="sm"
                variant={batch === n ? "secondary" : "ghost"}
                className="h-7 px-2 text-[10px] font-mono"
                disabled={!!busy}
                onClick={() => setBatch(n)}
              >
                {n}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => runAction("Dedupe Chunks", () => DatabaseAPI.dedupeChunks(false))}>
            <Layers3 className="h-3 w-3 mr-1" />
            {busy === "Dedupe Chunks" ? "Deduping…" : "Dedupe Chunks"}
          </Button>

          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => runAction("Re-derive Brands", () => DatabaseAPI.brandBackfill(false))}>
            <Tag className="h-3 w-3 mr-1" />
            {busy === "Re-derive Brands" ? "Updating…" : "Re-derive Brands"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => runAction("Reprocess Oversized HTML", () => DatabaseAPI.reprocessOversizedHtml(false))}>
            <FileWarning className="h-3 w-3 mr-1" />
            {busy === "Reprocess Oversized HTML" ? "Queuing…" : "Reprocess Oversized HTML"}
          </Button>
          {health?.embedModel && (
            <Badge variant="outline" className="text-[10px] font-mono ml-auto self-center">
              model: {health.embedModel}
            </Badge>
          )}
        </div>

        {/* Tuning */}
        {settings && bounds && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Sliders className="h-3.5 w-3.5" />Tuning · live (changes apply immediately)
            </div>
            <TuneRow
              label="Inject Threshold"
              caption="Vector probe gate. Top-1 chunk score must reach this for RAG to inject sources. Lower = more aggressive injection, higher = stricter."
              value={settings.injectThreshold}
              bounds={bounds.injectThreshold}
              onCommit={(v) => patchSetting("injectThreshold", v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Strict Probe Gate</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  If probe top-1 doesn't pass the threshold, skip RAG entirely (reranker doesn't run either). Turn off to open the FTS-only inject path — legacy behavior.
                </p>
              </div>
              <Switch
                checked={!!settings.strictProbeGate}
                onCheckedChange={(v) => patchSetting("strictProbeGate", v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Explicit Brand Filter</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  If the query explicitly mentions a library brand (e.g. "nat on checkpoint"), retrieval is locked to that brand. Turn off to let all brands compete — the brand with the most chunks will dominate.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { explicitBrandFilter?: boolean }).explicitBrandFilter !== false}
                onCheckedChange={(v) => patchSetting("explicitBrandFilter" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Similarity Threshold"
              caption="Per-chunk floor. Chunks scoring below this are dropped from the final context."
              value={settings.similarityThreshold}
              bounds={bounds.similarityThreshold}
              onCommit={(v) => patchSetting("similarityThreshold", v)}
            />
            <TuneRow
              label="Top-K"
              caption="How many chunks are injected into the model context per query."
              value={settings.topK}
              bounds={bounds.topK}
              integer
              onCommit={(v) => patchSetting("topK", v)}
            />
            <TuneRow
              label="Chunk Depth"
              caption="HNSW candidate depth (ef_search). Higher = better recall, slower retrieval."
              value={settings.chunkDepth}
              bounds={bounds.chunkDepth}
              integer
              onCommit={(v) => patchSetting("chunkDepth", v)}
            />
            <TuneRow
              label="Margin Gate"
              caption="Required gap between top-1 and top-4 scores. If the gap is too small the result set is treated as noise and skipped. 0 disables the gate."
              value={settings.marginGate}
              bounds={bounds.marginGate}
              onCommit={(v) => patchSetting("marginGate", v)}
            />
          </div>
        )}

        {/* Reranker (CrossEncoder) — optional quality layer */}
        {settings && bounds && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Layers className="h-3.5 w-3.5" />
              Reranker · CrossEncoder (optional quality pass)
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                {health?.reranker?.enabled ? `model: ${health.reranker.model}` : "disabled"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Enabled</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Toggle the cross-encoder rerank pass after hybrid retrieval. Failure → falls back to fused order.
                </p>
              </div>
              <Switch
                checked={!!settings.rerankEnabled}
                onCheckedChange={(v) => patchSetting("rerankEnabled", v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Rerank Top-N"
              caption="Number of fused candidates sent to the reranker. Higher = better recall, more latency."
              value={settings.rerankTopN}
              bounds={bounds.rerankTopN}
              integer
              onCommit={(v) => patchSetting("rerankTopN", v)}
            />
            <TuneRow
              label="Rerank Timeout (ms)"
              caption="Hard cap for the rerank HTTP call. Timeout → keeps the original fused order."
              value={settings.rerankTimeoutMs}
              bounds={bounds.rerankTimeoutMs}
              integer
              onCommit={(v) => patchSetting("rerankTimeoutMs", v)}
            />
            <TuneRow
              label="Rerank Weight"
              caption="Blend weight between rerank score (1.0 = pure rerank) and fused RRF score (0.0 = ignore reranker)."
              value={settings.rerankWeight}
              bounds={bounds.rerankWeight}
              onCommit={(v) => patchSetting("rerankWeight", v)}
            />
            {(health?.reranker?.lastMs || health?.lastRerankError) && (
              <div className="text-[10px] font-mono text-muted-foreground">
                {health?.reranker?.lastMs ? `last rerank · ${health.reranker.lastMs}ms` : ""}
                {health?.lastRerankError ? ` · ⚠ ${health.lastRerankError.kind}: ${health.lastRerankError.detail}` : ""}
              </div>
            )}
          </div>
        )}

        {/* Diversity & Confidence — vector pool caps + rerank gate + enrichment toggles */}
        {settings && bounds && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Tag className="h-3.5 w-3.5" />
              Diversity & Confidence · live
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">runtime knobs</Badge>
            </div>
            <TuneRow
              label="Rerank Min Score"
              caption="Cross-encoder top-1 confidence floor. If the rerank top-1 score is below this, RAG skips with no_confident_match. 0 = gate disabled (everything injects). Lower = more aggressive injection, higher = stricter. Recommended: 0.10."
              value={Number((settings as Settings & { rerankMinScore?: number }).rerankMinScore ?? 0.1)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).rerankMinScore) ?? { min: 0, max: 1, step: 0.01 }}
              onCommit={(v) => patchSetting("rerankMinScore" as keyof Settings, v)}
            />
            <TuneRow
              label="Margin Gate"
              caption="Minimum score gap between top-1 and top-4 results. Low margin = ambiguous answer (model can't pick a clear winner) → RAG is more conservative. Raise to be stricter; 0 disables the gate. Recommended: 0.06."
              value={Number((settings as Settings & { marginGate?: number }).marginGate ?? 0.06)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).marginGate) ?? { min: 0, max: 0.5, step: 0.01 }}
              onCommit={(v) => patchSetting("marginGate" as keyof Settings, v)}
            />
            <TuneRow
              label="Min Support Sources"
              caption="Force-keep at least N source rows in the LLM context even if their rerank score is below the floor. Higher = more citations and broader context, but possible noise from lower-quality chunks. 0 disables. Recommended: 3-4."
              value={Number((settings as Settings & { minSupportSources?: number }).minSupportSources ?? 3)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).minSupportSources) ?? { min: 0, max: 6, step: 1 }}
              integer
              onCommit={(v) => patchSetting("minSupportSources" as keyof Settings, v)}
            />
            <TuneRow
              label="Per-File Cap"
              caption="Maximum chunks any single file (file_id) can contribute to top-K. Prevents one large PDF from drowning the result set."
              value={Number((settings as Settings & { perSourceCap?: number }).perSourceCap ?? 3)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).perSourceCap) ?? { min: 1, max: 10, step: 1 }}
              integer
              onCommit={(v) => patchSetting("perSourceCap" as keyof Settings, v)}
            />
            <TuneRow
              label="Per-Brand Cap"
              caption="Maximum chunks any single brand can contribute to top-K. Per-file cap alone is not enough — a large brand spans hundreds of file_ids. Lower = more brand diversity."
              value={Number((settings as Settings & { perBrandCap?: number }).perBrandCap ?? 6)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).perBrandCap) ?? { min: 1, max: 24, step: 1 }}
              integer
              onCommit={(v) => patchSetting("perBrandCap" as keyof Settings, v)}
            />
            <TuneRow
              label="Diversity Pool"
              caption="HNSW candidate pool size. Per-file and per-brand caps are applied on top of this pool. Larger pool = better small-brand representation, slight latency cost."
              value={Number((settings as Settings & { diversityPool?: number }).diversityPool ?? 200)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).diversityPool) ?? { min: 24, max: 500, step: 1 }}
              integer
              onCommit={(v) => patchSetting("diversityPool" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Multi-Version Query Split</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When query mentions ≥2 distinct major.minor version tokens (e.g. &quot;7.4 ile 7.6 farkları&quot;, &quot;R81.10 vs R82&quot;), run an extra mini vector fetch per version with the OTHER version tokens stripped, then union into top-K. Forces balanced retrieval across both versions. Adds ~150-400ms per extra version (parallel). OFF = single embedding (current behavior).
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { multiVersionSplit?: boolean }).multiVersionSplit}
                onCheckedChange={(v) => patchSetting("multiVersionSplit" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Multi-Version Max Splits"
              caption="Hard cap on extra embed calls per turn (latency budget). 3 = up to 3 versions split in parallel; queries with more distinct versions skip the split entirely. Only used when Multi-Version Query Split is ON."
              value={Number((settings as Settings & { multiVersionMaxSplits?: number }).multiVersionMaxSplits ?? 3)}
              bounds={{ min: 2, max: 5, step: 1 }}
              integer
              onCommit={(v) => patchSetting("multiVersionMaxSplits" as keyof Settings, v)}
            />
            <TuneRow
              label="Multi-Version Per-Limit"
              caption="Rows pulled per version sub-fetch (before downstream caps + RRF). Higher = more candidates from each version, more reranker work. 6 is a balanced default."
              value={Number((settings as Settings & { multiVersionPerLimit?: number }).multiVersionPerLimit ?? 6)}
              bounds={{ min: 2, max: 12, step: 1 }}
              integer
              onCommit={(v) => patchSetting("multiVersionPerLimit" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Multi-Version Quota</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When split detects ≥2 versions, guarantees each version a fair share of the final top-6 (after RRF + reranker). Prevents the dominant-version bias from crowding the other versions out of the citation set. Requires Multi-Version Query Split ON. OFF = sort purely by RRF/rerank score.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { multiVersionQuota?: boolean }).multiVersionQuota !== false}
                disabled={!(settings as Settings & { multiVersionSplit?: boolean }).multiVersionSplit}
                onCheckedChange={(v) => patchSetting("multiVersionQuota" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Min Chunk Chars"
              caption="Minimum content length (chars) for a chunk to enter the retrieval pool. Filters out tiny page-footer / header fragments that hijack vector top-K via brand-anchored preamble. 0 = filter disabled. 100 is a safe default for PDF-heavy corpora."
              value={Number((settings as Settings & { minChunkChars?: number }).minChunkChars ?? 100)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).minChunkChars) ?? { min: 0, max: 500, step: 25 }}
              integer
              onCommit={(v) => patchSetting("minChunkChars" as keyof Settings, v)}
            />

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Use Enriched Content</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Embed worker reads the `content_enriched` column (natural-language preamble prepended to API / JSON / YAML chunks). Turning it off embeds the raw `content`; existing vectors are not affected until re-embed.
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { useEnrichedContent?: boolean }).useEnrichedContent}
                onCheckedChange={(v) => patchSetting("useEnrichedContent" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Denoise Lowercase</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Lowercase the denoised query before sending it to the reranker. Cross-encoder is case-sensitive → keep this on for deterministic ranking.
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { denoiseLowercase?: boolean }).denoiseLowercase}
                onCheckedChange={(v) => patchSetting("denoiseLowercase" as keyof Settings, v as unknown as number)}
              />
            </div>

            {/* 2026-06-26 — Product-aware retrieval filter (brand-içi product karışmasını çözer) */}
            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
              <div className="space-y-0.5 flex-1 min-w-0">
                <Label className="text-[11px]">Product Filter</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Separates products under the same brand (Fortigate→fortios/fortimanager/fortianalyzer; A10→axapi/agalaxy/ddos). <strong>off</strong>: disabled. <strong>boost</strong>: adds a small rerank bonus. <strong>hard</strong>: applies SQL WHERE product=X, so non-matching rows are excluded. Detection uses the DB DISTINCT (brand, product) catalog with a 5-minute cache.
                </p>
              </div>
              <Select
                value={String((settings as Settings & { productFilter?: string }).productFilter ?? "off")}
                onValueChange={(v) => patchSetting("productFilter" as keyof Settings, v as unknown as number)}
              >
                <SelectTrigger className="w-[110px] h-8 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">off</SelectItem>
                  <SelectItem value="boost">boost</SelectItem>
                  <SelectItem value="hard">hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TuneRow
              label="Product Filter Boost"
              caption="Bonus added to the rerank_mix score for matching product rows in boost mode. Default 0.05 — soft steering only. Not used in hard mode."
              value={Number((settings as Settings & { productFilterBoost?: number }).productFilterBoost ?? 0.05)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).productFilterBoost) ?? { min: 0, max: 0.5, step: 0.01 }}
              onCommit={(v) => patchSetting("productFilterBoost" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Product Auto-Extract</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Automatically extracts brand+product tokens from the query using the DB catalog. When off, the filter only runs on turns that are pre-tagged by agent binding.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { productAutoExtract?: boolean }).productAutoExtract !== false}
                onCheckedChange={(v) => patchSetting("productAutoExtract" as keyof Settings, v as unknown as number)}
              />
            </div>
          </div>
        )}

        {/* Behavior — chat flow flags migrated from plist env to UI (single source of truth) */}
        {settings && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Zap className="h-3.5 w-3.5" />
              Behavior · live
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">migrated from env</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Smalltalk Fast-Path</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When probe top-1 &lt; Smalltalk Probe Threshold OR semantic router flags greeting, route to a low-latency lane: tighter token cap, RAG bypass, no tool selection. Off = every turn runs the full RAG + tool pipeline.
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { smalltalkFastPath?: boolean }).smalltalkFastPath}
                onCheckedChange={(v) => patchSetting("smalltalkFastPath" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Smalltalk Probe Threshold"
              caption="Probe top-1 below this routes to the smalltalk lane (no_think, low token cap, RAG bypass). Tune up if greetings still hit query lane; tune down if real questions get downgraded to smalltalk. Default 0.50."
              value={Number((settings as Settings & { smalltalkProbeThreshold?: number }).smalltalkProbeThreshold ?? 0.5)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).smalltalkProbeThreshold) ?? { min: 0.2, max: 0.7, step: 0.01 }}
              onCommit={(v) => patchSetting("smalltalkProbeThreshold" as keyof Settings, v)}
            />
            <TuneRow
              label="Mixed-Promote Ratio"
              caption="Semantic intent router: 'Selam Elara, <teknik soru>' gibi hibrit girdilerde ragSim ≥ smallSim × this → RAG lane. Loosen (0.90) to catch short brand queries (Cloudflare WAF, Citrix NetScaler); tighten (0.95) if pure greetings leak into RAG. Default 0.92."
              value={Number((settings as Settings & { mixedPromoteRatio?: number }).mixedPromoteRatio ?? 0.92)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).mixedPromoteRatio) ?? { min: 0.50, max: 1.00, step: 0.01 }}
              onCommit={(v) => patchSetting("mixedPromoteRatio" as keyof Settings, v)}
            />
            <TuneRow
              label="Mixed-Promote Min Length"
              caption="Minimum trimmed char length for mixed-promote to fire. Shorter inputs stay smalltalk even if ragSim wins. Lower (10) catches 'cloudflare waf?' (14ch); raise (20) protects pure greetings. Default 15."
              value={Number((settings as Settings & { mixedPromoteMinLen?: number }).mixedPromoteMinLen ?? 15)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).mixedPromoteMinLen) ?? { min: 1, max: 120, step: 1 }}
              onCommit={(v) => patchSetting("mixedPromoteMinLen" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Disable Thinking on Smalltalk</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Inject Qwen `/no_think` prefix + `chat_template_kwargs.enable_thinking=false` for smalltalk turns. Drops "Selam Elara" from 15s reasoning to ~1-2s reply. Off = thinking always on (slower).
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { disableThinkOnSmalltalk?: boolean }).disableThinkOnSmalltalk}
                onCheckedChange={(v) => patchSetting("disableThinkOnSmalltalk" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Disable Thinking on Query</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Inject Qwen `/no_think` + `enable_thinking=false` for technical query turns (no RAG inject). 72B was burning ~50-60s of internal reasoning before the answer. On = fast direct answers. Off = deep reasoning (much slower TTFT).
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { disableThinkOnQuery?: boolean }).disableThinkOnQuery}
                onCheckedChange={(v) => patchSetting("disableThinkOnQuery" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Disable Thinking on RAG</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Same `/no_think` + `enable_thinking=false` for RAG-injected turns. Keeps grounded answers fast. Off = model thinks before answering with sources (slower TTFT).
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { disableThinkOnRag?: boolean }).disableThinkOnRag}
                onCheckedChange={(v) => patchSetting("disableThinkOnRag" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Intent Router Bypass</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Skip the embedding-anchor intent router (semantic smalltalk detection). On = single decision authority is `injectThreshold`. Off = router runs first, can short-circuit RAG for greetings.
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { intentRouterBypass?: boolean }).intentRouterBypass}
                onCheckedChange={(v) => patchSetting("intentRouterBypass" as keyof Settings, v as unknown as number)}
              />
            </div>
          </div>
        )}

        {/* Library Awareness · cross-brand */}
        {settings && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Layers className="h-3.5 w-3.5" />
              Library Awareness · cross-brand
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">scope + dominance</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Require Brand Mention for RAG</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  ON (default): RAG runs ONLY when the user's question mentions a brand (or alias) that exists in the library. Generic questions ("vlan nedir") or out-of-library vendors (e.g. "cisco switch" when Cisco isn't ingested) skip RAG silently and the model answers from its own knowledge — no banner, no probe cost. OFF: every question runs probe + cross-vendor guard (legacy).
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { requireBrandMentionForRag?: boolean }).requireBrandMentionForRag !== false}
                onCheckedChange={(v) => patchSetting("requireBrandMentionForRag" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Out-of-Library Fallback</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When the query mentions a vendor that is NOT in the library, inject is canceled and the model answers from its own knowledge with an amber "Out of library scope" chip. Off = no fallback, the turn returns no_confident_match.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { outOfLibraryFallback?: boolean }).outOfLibraryFallback !== false}
                onCheckedChange={(v) => patchSetting("outOfLibraryFallback" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Out-of-Library Tau Boost"
              caption="Extra bias added to the probe threshold when the matched brand is out-of-library. Raise to make off-corpus queries fall through to free-answer faster; 0 = no boost. Default 0.00."
              value={Number((settings as Settings & { outOfLibraryTauBoost?: number }).outOfLibraryTauBoost ?? 0)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).outOfLibraryTauBoost) ?? { min: 0, max: 0.5, step: 0.01 }}
              onCommit={(v) => patchSetting("outOfLibraryTauBoost" as keyof Settings, v)}
            />
            <TuneRow
              label="Cross-Brand Min Dominance"
              caption="Minimum share a single brand must hold in the top-K rows to trigger the dominant-brand lock (system prompt rule #6: use only that vendor's terminology). Lower = stricter lock fires more often. Default 0.50."
              value={Number((settings as Settings & { crossBrandMinDominance?: number }).crossBrandMinDominance ?? 0.5)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).crossBrandMinDominance) ?? { min: 0, max: 1, step: 0.05 }}
              onCommit={(v) => patchSetting("crossBrandMinDominance" as keyof Settings, v)}
            />
            <TuneRow
              label="Cross-Brand Min Top1"
              caption="Minimum top-1 vector score for the cross-brand dominance check to apply. Raise if a weak top-1 is flipping lanes; lower if real hits get cross-brand-blocked. Default 0.55."
              value={Number((settings as Settings & { crossBrandMinTop1?: number }).crossBrandMinTop1 ?? 0.55)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).crossBrandMinTop1) ?? { min: 0.30, max: 0.95, step: 0.01 }}
              onCommit={(v) => patchSetting("crossBrandMinTop1" as keyof Settings, v)}
            />
            <TuneRow
              label="Library Brand Cache TTL (ms)"
              caption="How long the DB-derived library brand list is cached. Increase to reduce DB load; decrease so newly ingested brands show up faster in out-of-library detection. Default 300000 (5 min)."
              value={Number((settings as Settings & { libraryBrandCacheTtlMs?: number }).libraryBrandCacheTtlMs ?? 300000)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).libraryBrandCacheTtlMs) ?? { min: 30000, max: 3600000, step: 30000 }}
              integer
              onCommit={(v) => patchSetting("libraryBrandCacheTtlMs" as keyof Settings, v)}
            />
            <TuneRow
              label="Library Brand Min Chunks"
              caption="Brand-mention gate'in saymak için bir brand'in DB'de en az kaç chunk'a sahip olması gerektiği. Eski auto-tag artığı / tek-satırlık mention'lardan oluşan gürültü brand'ler (örn. küçük PDF'lerde geçen 'cisco', 'huawei') library brand sayılmaz → gate match etmez → çapraz-vendor halüsinasyon kapanır. 0 = eşik kapalı (her brand sayılır). Default 100. Teşhis: GET /api/knowledge/library-brands?counts=1"
              value={Number((settings as Settings & { libraryBrandMinChunks?: number }).libraryBrandMinChunks ?? 100)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).libraryBrandMinChunks) ?? { min: 0, max: 5000, step: 10 }}
              integer
              onCommit={(v) => patchSetting("libraryBrandMinChunks" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Strip Prior Citations on Free-Answer</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When RAG is skipped (model RAG off, smalltalk, out-of-library, etc.), strip any trailing "Kaynaklar: / Sources: / References:" footer block from prior assistant messages before the model sees them. Prevents the model from mimicking that format and fabricating fake citations. Default ON.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { stripPriorCitationsOnFreeAnswer?: boolean }).stripPriorCitationsOnFreeAnswer !== false}
                onCheckedChange={(v) => patchSetting("stripPriorCitationsOnFreeAnswer" as keyof Settings, v as unknown as number)}
              />
            </div>
          </div>
        )}

        {/* Agent Delegation — Elara → relevant agent + take over on insufficient */}
        {settings && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Layers className="h-3.5 w-3.5" />
              Agent Delegation · auto-route + fallback
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">UI = single source</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Auto-Route to Agent</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When the user query is non-smalltalk and no explicit `@[script.py]` mention is present, the picker selects the best agent by score from agents.meta (rag.brands, rag.keywords, tags, description) and routes through the existing dispatch path. If no agent clears the threshold, Elara answers.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { agentAutoRoute?: boolean }).agentAutoRoute === true}
                onCheckedChange={(v) => patchSetting("agentAutoRoute" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Skip Auto-Route on Smalltalk</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When the intent classifier marks the user turn as smalltalk (greetings, thanks, self-intro), bypass auto-route so Elara answers instead of a randomly matched agent. Explicit `@[script.py]` mentions still override.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { agentAutoRouteSkipSmalltalk?: boolean }).agentAutoRouteSkipSmalltalk !== false}
                onCheckedChange={(v) => patchSetting("agentAutoRouteSkipSmalltalk" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Auto-Route Min Score"
              caption="Minimum score required for the picker to delegate. Brand match +3, keyword +2, tag/desc +1. Higher = stricter. Recommended: 1 for broad NetSec delegation."
              value={Number((settings as Settings & { agentAutoRouteMinScore?: number }).agentAutoRouteMinScore ?? 1)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).agentAutoRouteMinScore) ?? { min: 1, max: 10, step: 1 }}
              integer
              onCommit={(v) => patchSetting("agentAutoRouteMinScore" as keyof Settings, v)}
            />
            <TuneRow
              label="Agent RAG Context Budget"
              caption="Maximum RAG context characters injected into the agent prompt. Higher = more cited chunks visible to the agent, but more latency and prompt load. Recommended: 12000."
              value={Number((settings as Settings & { agentRagContextChars?: number }).agentRagContextChars ?? 12000)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).agentRagContextChars) ?? { min: 3000, max: 24000, step: 500 }}
              integer
              onCommit={(v) => patchSetting("agentRagContextChars" as keyof Settings, v)}
            />
            <TuneRow
              label="Agent Exec Timeout (ms)"
              caption="Hard cap for the local agent process. Higher gives detailed agent+RAG answers time to finish; lower fails faster. Recommended: 180000."
              value={Number((settings as Settings & { agentExecTimeoutMs?: number }).agentExecTimeoutMs ?? 180000)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).agentExecTimeoutMs) ?? { min: 30000, max: 300000, step: 5000 }}
              integer
              onCommit={(v) => patchSetting("agentExecTimeoutMs" as keyof Settings, v)}
            />
            <TuneRow
              label="Agent SSE Keep-Alive (ms)"
              caption="Heartbeat interval for the agent's SSE stream while it waits in the LOCAL queue. Without it, browser/proxy may drop idle connections (BodyStreamBuffer aborted). Set 0 to disable. Recommended: 15000."
              value={Number((settings as Settings & { agentSseKeepAliveMs?: number }).agentSseKeepAliveMs ?? 15000)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).agentSseKeepAliveMs) ?? { min: 0, max: 60000, step: 1000 }}
              integer
              onCommit={(v) => patchSetting("agentSseKeepAliveMs" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Skip RAG for Agent Smalltalk</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When the user's text to the agent classifies as smalltalk (greetings, self-intro like "introduce yourself"), the agent skips the RAG probe entirely and answers from its own system prompt. Mirrors the chat-side smalltalk lane. Default ON.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { agentSmalltalkSkipRag?: boolean }).agentSmalltalkSkipRag !== false}
                onCheckedChange={(v) => patchSetting("agentSmalltalkSkipRag" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Agent RAG Slow Warn (ms)"
              caption="Soft warning threshold for slow agent RAG probes. It does not abort retrieval, so valid library hits are still injected even if they arrive after this point. Recommended: 8000."
              value={Number((settings as Settings & { agentRagDeadlineMs?: number }).agentRagDeadlineMs ?? 8000)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).agentRagDeadlineMs) ?? { min: 2000, max: 60000, step: 500 }}
              integer
              onCommit={(v) => patchSetting("agentRagDeadlineMs" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Insufficient → Elara Fallback</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When the agent stream finishes with hits=0, a short answer, or a refusal pattern (don't know / no_confident_match / etc.), Elara steps in within the same turn and replies via free-answer. Default ON.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { agentInsufficientFallback?: boolean }).agentInsufficientFallback !== false}
                onCheckedChange={(v) => patchSetting("agentInsufficientFallback" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Insufficient Min Chars"
              caption="If the agent reply is shorter than this threshold, it counts as 'short_answer' and triggers the fallback. Default 80."
              value={Number((settings as Settings & { agentInsufficientMinChars?: number }).agentInsufficientMinChars ?? 80)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).agentInsufficientMinChars) ?? { min: 20, max: 2000, step: 10 }}
              integer
              onCommit={(v) => patchSetting("agentInsufficientMinChars" as keyof Settings, v)}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Show Fallback Banner</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When fallback kicks in, the stream gets a visible separator + "X couldn't answer, replying from my own knowledge:" line. Turn off to let Elara's answer flow silently under the agent reply. Default ON.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { agentFallbackBanner?: boolean }).agentFallbackBanner !== false}
                onCheckedChange={(v) => patchSetting("agentFallbackBanner" as keyof Settings, v as unknown as number)}
              />
            </div>
            <ManifestModeRow settings={settings} patchSetting={patchSetting} />
          </div>
        )}





        {/* Answer Safety — v16 (cross-vendor leak, think-strip, concise, custom stops) */}
        {settings && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileWarning className="h-3.5 w-3.5" />
              Answer Safety · v16
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">UI controlled</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Agent Multi-Brand</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  ON (default): Agents query the entire library — binding files, meta.rag.keywords / meta.rag.brands, and pack brand_keywords are ignored. Explicit brand mentions in the query (e.g. "checkpoint") and dominant brand lock (Rule 6) still work as-is. OFF: legacy per-agent scope (binding + keywords + pack filters).
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { agentMultiBrand?: boolean }).agentMultiBrand !== false}
                onCheckedChange={(v) => patchSetting("agentMultiBrand" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Cross-Vendor Guard</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  If the query targets one brand (e.g. A10) but 70%+ of the RAG rows come from another (e.g. Checkpoint), inject is cancelled → free-answer. Prevents cross-vendor leakage.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { crossVendorGuard?: boolean }).crossVendorGuard !== false}
                onCheckedChange={(v) => patchSetting("crossVendorGuard" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Strip &lt;think&gt; Blocks</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  &lt;think&gt;…&lt;/think&gt; blocks are stripped server-side from the model stream. Partial tags are buffered across deltas. Off = raw output reaches the UI.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { stripThinkBlocks?: boolean }).stripThinkBlocks !== false}
                onCheckedChange={(v) => patchSetting("stripThinkBlocks" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Show RAG Debug Panels (chat)</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Shows the <code>AGENT RAG DIAG</code> + <code>RAG DEBUG</code> cards under agent messages in chat. Default OFF — enable only for diagnostic sessions. UI-only knob, persisted in this browser only (localStorage).
                </p>
              </div>
              <Switch
                checked={showDebugPanels}
                onCheckedChange={toggleDebugPanels}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Expert RAG Answers</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Treats sources as the primary anchor but fills missing pieces STEP BY STEP using engineering knowledge (CLI / example / warning). Off = legacy strict "sources only" auditor tone.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { ragExpertMode?: boolean }).ragExpertMode !== false}
                onCheckedChange={(v) => patchSetting("ragExpertMode" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Concise RAG Answers</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Bans "explanation paragraphs / filler sentences / hope this helps" in RAG answers — max 8 sentences + Sources line. Default OFF; with expert mode, depth is preferred.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { ragConciseAnswers?: boolean }).ragConciseAnswers === true}
                onCheckedChange={(v) => patchSetting("ragConciseAnswers" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Strict No-Tool Rule</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  ON = a hard "DON'T EVEN WRITE agent/skill/tool NAMES" rule is added to the system prompt (legacy strict trigger ban). OFF (default) = soft mode: the model may list/introduce agent names as plain text (copy_smith, hashtag_alchemist), only avoiding the actual trigger envelopes ('!slug(...)', '@[script.py]', ```tool_call```). Leave OFF if you want introductions when the user says "list the agents" in chat.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { ragNoToolRuleStrict?: boolean }).ragNoToolRuleStrict === true}
                onCheckedChange={(v) => patchSetting("ragNoToolRuleStrict" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Auto-Dispatch Agents from Model Output</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When the model passively mentions <code>script.py</code> / an agent name in its reply, the backend auto-spawns the local Python agent. Default OFF — so passive mentions (agent intros, lists) don't block the stream. When the user writes <code>@[script.py]</code>, the frontend already spawns directly; this knob only toggles whether the backend inspects model output for agent triggers.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { autoDispatchAgentsFromModelOutput?: boolean }).autoDispatchAgentsFromModelOutput === true}
                onCheckedChange={(v) => patchSetting("autoDispatchAgentsFromModelOutput" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Inject Agent Tools Manifest (backend)</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  OFF (default) = backend agent system prompt'a <code>ELARA_AGENT_TOOLS</code> bloğu EKLEMEZ. Tool listesini operator agent prompt'una UI'dan elden yazarsın. ON = eski davranış: `# @tools:` header + action_library description otomatik enjekte (smalltalk turlarında "Suppress on Smalltalk" hâlâ geçerli).
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { injectAgentToolsManifest?: boolean }).injectAgentToolsManifest === true}
                onCheckedChange={(v) => patchSetting("injectAgentToolsManifest" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Suppress Tool Manifest on Smalltalk</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  ON = greeting/smalltalk turns do not expose tool, skill, or agent protocol hints to the model. Keeps "selam / naber" replies conversational instead of trying to call researcher/skills. (Only applies when "Inject Agent Tools Manifest" is ON.)
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { suppressToolManifestOnSmalltalk?: boolean }).suppressToolManifestOnSmalltalk !== false}
                onCheckedChange={(v) => patchSetting("suppressToolManifestOnSmalltalk" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Parse Tool Calls on Smalltalk</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  OFF = smalltalk text is never interpreted as `!skill`, `@[agent.py]`, or tool-call protocol. Leave off unless deliberately testing parser behavior.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { streamToolParseOnSmalltalk?: boolean }).streamToolParseOnSmalltalk === true}
                onCheckedChange={(v) => patchSetting("streamToolParseOnSmalltalk" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Cold Fallback → Smalltalk</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  ON = embed/LOCAL soğukken intent classifier kararsız kalırsa kısa greeting-benzeri input (≤4 token, ≤32 char, digit/path/uzun token yok) smalltalk lane'ine düşer. Manifest sızıntısı + cold-LOCAL hang engellenir. Teknik sorular etkilenmez.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { coldFallbackToSmalltalk?: boolean }).coldFallbackToSmalltalk !== false}
                onCheckedChange={(v) => patchSetting("coldFallbackToSmalltalk" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Warmup Intent Budget (ms)</Label>
              <Input
                type="number"
                min={900}
                max={15000}
                step={100}
                value={Number((settings as Settings & { warmupIntentBudgetMs?: number }).warmupIntentBudgetMs ?? 3500)}
                onChange={(e) => patchSetting("warmupIntentBudgetMs" as keyof Settings, Number(e.target.value))}
              />
              <p className="text-[10px] font-mono text-muted-foreground">
                Embed worker / LOCAL soğukken intent classifier her hat için bu süreye kadar bekler. Warm sıcakken default 900ms — buraya hiç dokunmaz. Default 3500ms.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">LOCAL Stop Sequences (CSV)</Label>
              <Input
                type="text"
                placeholder='e.g. <|im_end|>, </s>, 请提供'
                defaultValue={(((settings as Settings & { LOCALStopSequences?: string[] }).LOCALStopSequences) || []).join(", ")}
                onBlur={async (e) => {
                  const list = e.target.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 64).slice(0, 16);
                  setSettings({ ...settings, ...({ LOCALStopSequences: list } as Partial<Settings>) });
                  const r = await DatabaseAPI.saveRagSettings({ LOCALStopSequences: list } as unknown as Parameters<typeof DatabaseAPI.saveRagSettings>[0]);
                  if (!r.ok) toast.error("Stop sequences save failed");
                }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="h-7 font-mono text-[11px]"
              />
              <p className="text-[10px] font-mono text-muted-foreground">
                Comma-separated extra stop tokens. For Chinese/Korean leakage or sentinels like `&lt;|im_end|&gt;`. The 4-newline guard is always active. Max 16 entries, 64 chars each.
              </p>
            </div>
          </div>
        )}



        {/* Query Pipeline — Two-Layer LLM-native (Extractor + HyDE) */}
        {settings && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Wrench className="h-3.5 w-3.5" />
              Query Pipeline · two-layer
              <Badge variant="outline" className="text-[10px] font-mono ml-auto">extractor + HyDE</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Layer 1 · Query Extractor</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Deterministic LLM (temp 0.1, max 60, /no_think) strips greetings, names, polite filler — keeps only the technical core. SHA-256 LRU cached. Output feeds FTS + reranker + probe embedding.
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { queryExtractorEnabled?: boolean }).queryExtractorEnabled}
                onCheckedChange={(v) => patchSetting("queryExtractorEnabled" as keyof Settings, v as unknown as number)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-[11px]">Layer 2 · HyDE Expansion</Label>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Stochastic LLM (temp 0.3, max 120) writes a hypothetical technical passage and concatenates it with cleanQuery for the DENSE embedding only. FTS + reranker still see cleanQuery. Mid-band gated.
                </p>
              </div>
              <Switch
                checked={!!(settings as Settings & { queryHydeEnabled?: boolean }).queryHydeEnabled}
                onCheckedChange={(v) => patchSetting("queryHydeEnabled" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="HyDE Probe Band — Low"
              caption="HyDE fires only when probe top-1 ≥ this value. Below this the query is either smalltalk or off-corpus — HyDE wastes LOCAL time."
              value={Number((settings as Settings & { hydeProbeBandLow?: number }).hydeProbeBandLow ?? 0.50)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).hydeProbeBandLow) ?? { min: 0.30, max: 0.70, step: 0.01 }}
              onCommit={(v) => patchSetting("hydeProbeBandLow" as keyof Settings, v)}
            />
            <TuneRow
              label="HyDE Probe Band — High"
              caption="HyDE skipped when probe top-1 > this value (already strong, augmentation only adds noise). Sweet spot is the ambiguous band [Low, High]."
              value={Number((settings as Settings & { hydeProbeBandHigh?: number }).hydeProbeBandHigh ?? 0.80)}
              bounds={((bounds as Record<string, { min: number; max: number; step: number } | undefined>).hydeProbeBandHigh) ?? { min: 0.60, max: 0.95, step: 0.01 }}
              onCommit={(v) => patchSetting("hydeProbeBandHigh" as keyof Settings, v)}
            />
            <TuneRow
              label="Extractor Cache TTL (hours)"
              caption="LRU cache lifetime for extractor outputs (SHA-256 keyed). HyDE is never cached (stochastic by design)."
              value={Number((settings as Settings & { extractorCacheTTL?: number }).extractorCacheTTL ?? 24)}
              bounds={{ min: 1, max: 168, step: 1 }}
              integer
              onCommit={(v) => patchSetting("extractorCacheTTL" as keyof Settings, v)}
            />
            <TuneRow
              label="Extractor Timeout (ms)"
              caption="Hard budget for the extractor LOCAL call. Cold MPS can stall — short timeout fails fast; circuit breaker takes over on repeated failures."
              value={Number((settings as Settings & { extractorTimeoutMs?: number }).extractorTimeoutMs ?? 700)}
              bounds={{ min: 200, max: 3000, step: 50 }}
              integer
              onCommit={(v) => patchSetting("extractorTimeoutMs" as keyof Settings, v)}
            />
            <TuneRow
              label="HyDE Timeout (ms)"
              caption="Hard budget for the HyDE passage generation. Caps the worst-case probe latency in the mid-band."
              value={Number((settings as Settings & { hydeTimeoutMs?: number }).hydeTimeoutMs ?? 1200)}
              bounds={{ min: 300, max: 5000, step: 100 }}
              integer
              onCommit={(v) => patchSetting("hydeTimeoutMs" as keyof Settings, v)}
            />
            <TuneRow
              label="Breaker · Failure Threshold"
              caption="Consecutive extractor failures before circuit breaker opens (skip extractor LLM, fall back to raw query)."
              value={Number((settings as Settings & { extractorBreakerThreshold?: number }).extractorBreakerThreshold ?? 3)}
              bounds={{ min: 1, max: 10, step: 1 }}
              integer
              onCommit={(v) => patchSetting("extractorBreakerThreshold" as keyof Settings, v)}
            />
            <TuneRow
              label="Breaker · Cooldown (ms)"
              caption="How long the breaker stays open after tripping. First successful call after cooldown re-enables the extractor."
              value={Number((settings as Settings & { extractorBreakerCooldownMs?: number }).extractorBreakerCooldownMs ?? 30000)}
              bounds={{ min: 5000, max: 120000, step: 1000 }}
              integer
              onCommit={(v) => patchSetting("extractorBreakerCooldownMs" as keyof Settings, v)}
            />
            <TuneRow
              label="RAG probe deadline (ms)"
              caption="Total budget for probe + rerank + fetch. Reranker alone needs ~2500ms; sub-3000ms budgets skip real hits as deadline_*."
              value={Number((settings as Settings & { ragProbeDeadlineMs?: number }).ragProbeDeadlineMs ?? 4500)}
              bounds={{ min: 1500, max: 8000, step: 250 }}
              integer
              onCommit={(v) => patchSetting("ragProbeDeadlineMs" as keyof Settings, v)}
            />
            <TuneRow
              label="Pre-RAG deadline (ms)"
              caption="Hard cap for the entire pre-LOCAL pipeline (intent + probe + rerank + library lookup + message build). On timeout: rag.skipped(pre_rag_deadline) → free-answer fallback so the user never sees a blank screen."
              value={Number((settings as Settings & { preRagDeadlineMs?: number }).preRagDeadlineMs ?? 6000)}
              bounds={{ min: 1500, max: 15000, step: 500 }}
              integer
              onCommit={(v) => patchSetting("preRagDeadlineMs" as keyof Settings, v)}
            />


            <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Meta-Forge Lane</div>
            <div className="text-xs text-muted-foreground mb-2">
              Semantic gate that routes "create a skill / write a tool / forge an agent" prompts to the Meta-Forge orchestrator instead of RAG. Lower ratios open the lane more aggressively; too low leaks technical questions into forge_master.
            </div>
            <TuneRow
              label="Meta-Forge · Min similarity"
              caption="Minimum cosine similarity between the query and the meta_forge anchor. Below this the lane never opens regardless of dominance."
              value={Number((settings as Settings & { metaForgeIntentThreshold?: number }).metaForgeIntentThreshold ?? 0.5)}
              bounds={{ min: 0.3, max: 1, step: 0.01 }}
              onCommit={(v) => patchSetting("metaForgeIntentThreshold" as keyof Settings, v)}
            />
            <TuneRow
              label="Meta-Forge · Dominance ratio (vs smalltalk/meta/manifest)"
              caption="metaForgeSim must be ≥ ratio × each competing anchor (smalltalk, meta, agent_manifest). 0.85 = strict, 0.70 = permissive."
              value={Number((settings as Settings & { metaForgeIntentRatio?: number }).metaForgeIntentRatio ?? 0.85)}
              bounds={{ min: 0.5, max: 1, step: 0.01 }}
              onCommit={(v) => patchSetting("metaForgeIntentRatio" as keyof Settings, v)}
            />
            <TuneRow
              label="Meta-Forge · Soft ratio vs RAG"
              caption="Softer tie-break against ragSim only. Lower opens the lane for short creation prompts where RAG anchor still fires high. Default 0.75."
              value={Number((settings as Settings & { metaForgeVsRagRatio?: number }).metaForgeVsRagRatio ?? 0.75)}
              bounds={{ min: 0.5, max: 1, step: 0.01 }}
              onCommit={(v) => patchSetting("metaForgeVsRagRatio" as keyof Settings, v)}
            />

            <div className="flex items-start justify-between gap-4 py-2 border-t border-border/40 mt-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">Meta-Forge · Auto-apply approved plans</span>
                  <Badge variant="outline" className="text-[10px]">
                    {((settings as Settings & { metaForgeAutoApply?: boolean }).metaForgeAutoApply !== false) ? "ON · write to DB + disk inline" : "OFF · require admin approval card"}
                  </Badge>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  When ON, a validated ForgePlan is applied immediately (skill/tool/agent/pack written, capabilities refreshed) — the chat shows the outcome instead of an approval card. Lint / disk / DB failure falls back to a &quot;failed&quot; plan the admin UI can review + retry. Default ON.
                </p>
              </div>
              <Switch
                checked={(settings as Settings & { metaForgeAutoApply?: boolean }).metaForgeAutoApply !== false}
                onCheckedChange={(v) => patchSetting("metaForgeAutoApply" as keyof Settings, v as unknown as number)}
              />
            </div>

            <MetaForgeTelemetryChip />












            <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cold LOCAL Hardening</div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium">On-demand pre-warm</div>
                <div className="text-xs text-muted-foreground">When LOCAL has been idle past the warm-cache TTL, trigger a background warmup at chat start and surface a "Model waking" notice. Pressure-aware: skipped when recent first-token median exceeds 40s.</div>
              </div>
              <Switch
                checked={!!(settings as Settings & { LOCALColdWarmupOnDemand?: boolean }).LOCALColdWarmupOnDemand}
                onCheckedChange={(v) => patchSetting("LOCALColdWarmupOnDemand" as keyof Settings, v as unknown as number)}
              />
            </div>
            <TuneRow
              label="Cold first-token cap (ms)"
              caption="First-token timeout when LOCAL is cold (no recent activity within the warm-cache TTL). Warm requests still use the cockpit watchdog floor (60s)."
              value={Number((settings as Settings & { LOCALColdFirstTokenMs?: number }).LOCALColdFirstTokenMs ?? 120000)}
              bounds={{ min: 60000, max: 300000, step: 5000 }}
              integer
              onCommit={(v) => patchSetting("LOCALColdFirstTokenMs" as keyof Settings, v)}
            />
            <TuneRow
              label="Warm-cache TTL (ms)"
              caption="How long after the last successful first-token LOCAL is treated as warm. Older than this counts as cold, triggering pre-warm + adaptive timeout."
              value={Number((settings as Settings & { LOCALWarmCacheTtlMs?: number }).LOCALWarmCacheTtlMs ?? 600000)}
              bounds={{ min: 60000, max: 3600000, step: 30000 }}
              integer
              onCommit={(v) => patchSetting("LOCALWarmCacheTtlMs" as keyof Settings, v)}
            />

            <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeout Budgets</div>
            <div className="text-xs text-muted-foreground mb-2">
              Hierarchy: <b>HTTP socket &gt; LOCAL stream total &gt; LOCAL queue wait</b>. If broken, BrokenPipe is guaranteed (socket closes before LOCAL).
            </div>
            <TuneRow
              label="HTTP socket timeout (ms)"
              caption="Node HTTP socket idle/total timeout. Must be greater than LOCAL stream total; otherwise the client closes the socket before LOCAL finishes → BrokenPipe."
              value={Number((settings as Settings & { httpSocketTimeoutMs?: number }).httpSocketTimeoutMs ?? 180000)}
              bounds={{ min: 30000, max: 600000, step: 5000 }}
              integer
              onCommit={(v) => patchSetting("httpSocketTimeoutMs" as keyof Settings, v)}
            />
            <TuneRow
              label="LOCAL stream total (ms)"
              caption="streamFromLocalLLM total stream budget. Must be smaller than HTTP socket and greater than queue wait."
              value={Number((settings as Settings & { LOCALStreamTotalMs?: number }).LOCALStreamTotalMs ?? 120000)}
              bounds={{ min: 30000, max: 600000, step: 5000 }}
              integer
              onCommit={(v) => patchSetting("LOCALStreamTotalMs" as keyof Settings, v)}
            />
            <TuneRow
              label="LOCAL queue wait (ms)"
              caption="Chat lane queue wait ceiling. Must be smaller than stream total; otherwise the queue ends up behind the stream and stalls the socket."
              value={Number((settings as Settings & { LOCALQueueWaitMs?: number }).LOCALQueueWaitMs ?? 90000)}
              bounds={{ min: 5000, max: 300000, step: 5000 }}
              integer
              onCommit={(v) => patchSetting("LOCALQueueWaitMs" as keyof Settings, v)}
            />


            <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output Limits (LOCAL max_tokens)</div>
            <TuneRow
              label="Smalltalk max_tokens"
              caption="Hard cap for smalltalk lane. Short, friendly replies — keep low so a runaway smalltalk turn can't burn a long context."
              value={Number((settings as Settings & { LOCALSmalltalkMaxTokens?: number }).LOCALSmalltalkMaxTokens ?? 220)}
              bounds={{ min: 64, max: 4000, step: 16 }}
              integer
              onCommit={(v) => patchSetting("LOCALSmalltalkMaxTokens" as keyof Settings, v)}
            />
            <TuneRow
              label="Query max_tokens (free answer)"
              caption="Cap for free-answer / RAG-bypass technical turns. Balances completeness against runaway loops on the chat path."
              value={Number((settings as Settings & { LOCALQueryMaxTokens?: number }).LOCALQueryMaxTokens ?? 1000)}
              bounds={{ min: 256, max: 8000, step: 32 }}
              integer
              onCommit={(v) => patchSetting("LOCALQueryMaxTokens" as keyof Settings, v)}
            />
            <TuneRow
              label="RAG max_tokens (cited answer)"
              caption="Cap when chunks are injected. Needs room for the full grounded answer + citations; too low truncates mid-procedure."
              value={Number((settings as Settings & { LOCALRagMaxTokens?: number }).LOCALRagMaxTokens ?? 2000)}
              bounds={{ min: 512, max: 8000, step: 32 }}
              integer
              onCommit={(v) => patchSetting("LOCALRagMaxTokens" as keyof Settings, v)}
            />
            {/* Agent max_tokens removed from RAG panel — UI single source of truth.
                Per-agent value at /agents → select agent → Max Tokens slider. */}

            {/* Sampling (top_p / repetition_penalty / frequency_penalty) REMOVED from
                the RAG panel — sampling single source of truth is the model editor (/models → SAMPLING PRESETS). */}



            <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loop Watchdog (agent + chat)</div>
            <TuneRow
              label="Line · min chars"
              caption="Only paragraph lines this long count toward the repeat guard. Lower = stricter (catches short config headings as loops); higher = lenient."
              value={Number((settings as Settings & { loopGuardLineMinChars?: number }).loopGuardLineMinChars ?? 40)}
              bounds={{ min: 10, max: 200, step: 5 }}
              integer
              onCommit={(v) => patchSetting("loopGuardLineMinChars" as keyof Settings, v)}
            />
            <TuneRow
              label="Line · repeat threshold"
              caption="How many identical long lines before the guard trips. 6+ avoids false-positives on legit multi-scenario config blocks."
              value={Number((settings as Settings & { loopGuardLineRepeat?: number }).loopGuardLineRepeat ?? 6)}
              bounds={{ min: 3, max: 20, step: 1 }}
              integer
              onCommit={(v) => patchSetting("loopGuardLineRepeat" as keyof Settings, v)}
            />
            <TuneRow
              label="Substring · window (chars)"
              caption="Sliding window size for markdown-fragmented repeat detection. Wider = less aggressive on FortiGate/Checkpoint CLI blocks."
              value={Number((settings as Settings & { loopGuardSubstringWindow?: number }).loopGuardSubstringWindow ?? 60)}
              bounds={{ min: 20, max: 200, step: 5 }}
              integer
              onCommit={(v) => patchSetting("loopGuardSubstringWindow" as keyof Settings, v)}
            />
            <TuneRow
              label="Substring · repeat threshold"
              caption="Window repeats inside the last 2000 chars before tripping. Raise if config-heavy answers get cut as 'repeated output guard'."
              value={Number((settings as Settings & { loopGuardSubstringRepeat?: number }).loopGuardSubstringRepeat ?? 8)}
              bounds={{ min: 3, max: 20, step: 1 }}
              integer
              onCommit={(v) => patchSetting("loopGuardSubstringRepeat" as keyof Settings, v)}
            />
            <TuneRow
              label="Phrase · repeat threshold"
              caption="Tail 14-word phrase repeats in the last 200 words. Catches model paraphrase loops without choking on legit recap sentences."
              value={Number((settings as Settings & { loopGuardPhraseRepeat?: number }).loopGuardPhraseRepeat ?? 5)}
              bounds={{ min: 3, max: 20, step: 1 }}
              integer
              onCommit={(v) => patchSetting("loopGuardPhraseRepeat" as keyof Settings, v)}
            />
          </div>
        )}

        {settings && (
          <div className="space-y-3">
            <details className="rounded-md border border-border bg-card/40 group">
              <summary className="flex items-center gap-2 p-3 cursor-pointer select-none">
                <MessageSquareCode className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">Advanced · System Prompts</span>
                <Badge variant="outline" className="text-[10px] font-mono ml-auto">{
                  ([
                    ["inspectorDirective", (settings as Settings & { inspectorDirective?: string }).inspectorDirective],
                    ["inspectorBrandLock", (settings as Settings & { inspectorBrandLock?: string }).inspectorBrandLock],
                    ["extractorSystemPrompt", (settings as Settings & { extractorSystemPrompt?: string }).extractorSystemPrompt],
                    ["hydeSystemPrompt", (settings as Settings & { hydeSystemPrompt?: string }).hydeSystemPrompt],
                    ["plannerSystemPrompt", (settings as Settings & { plannerSystemPrompt?: string }).plannerSystemPrompt],
                    ["agentRagWithHitsDirective", (settings as Settings & { agentRagWithHitsDirective?: string }).agentRagWithHitsDirective],
                    ["agentRagNoHitsDirective", (settings as Settings & { agentRagNoHitsDirective?: string }).agentRagNoHitsDirective],
                    ["agentToolsManifestFrame", (settings as Settings & { agentToolsManifestFrame?: string }).agentToolsManifestFrame],
                  ] as Array<[string, string | undefined]>).filter(([k, v]) => {
                    const t = (v ?? "").trim();
                    return t.length > 0 && t !== (PROMPT_DEFAULTS[k] || "").trim();
                  }).length
                } / 8 override</Badge>
              </summary>
              <div className="p-3 pt-0 space-y-4">
                <p className="text-[10px] font-mono text-muted-foreground">
                  Defaults are shown in each box — fork the text to override globally, or hit Reset to restore. Hot-swap, no restart. Placeholders inside templates: <code className="text-foreground">{`{BRAND_LOCK}`}</code>, <code className="text-foreground">{`{SOURCES}`}</code>, <code className="text-foreground">{`{BRAND}`}</code>, <code className="text-foreground">{`{TOOLS}`}</code>, <code className="text-foreground">{`{MAX_TOOLS}`}</code>.
                </p>
                <PromptRow
                  label="RAG Inspector Directive"
                  caption="Sent with every RAG-injected turn (chat-stream + chat-orchestrate). Format rules for the answer. Includes vendor/topic match guard — won't pretend mismatched sources cover the question. Per-model override available on the Models editor."
                  value={(settings as Settings & { inspectorDirective?: string }).inspectorDirective ?? ""}
                  defaultText={PROMPT_DEFAULTS.inspectorDirective}
                  onSave={(v: string) => patchPrompt("inspectorDirective" as keyof Settings, v)}
                  rows={12}
                />
                <PromptRow
                  label="Inspector Brand-Lock Line"
                  caption="Inserted into {BRAND_LOCK} only when >=70% of retrieved chunks share one brand. Placeholder: {BRAND}."
                  value={(settings as Settings & { inspectorBrandLock?: string }).inspectorBrandLock ?? ""}
                  defaultText={PROMPT_DEFAULTS.inspectorBrandLock}
                  onSave={(v: string) => patchPrompt("inspectorBrandLock" as keyof Settings, v)}
                  rows={3}
                />
                <PromptRow
                  label="Extractor System Prompt"
                  caption="LOCAL denoise step (extractTechnicalCore). Strips greetings, fixes vendor typos, returns one-line technical core. Keep '/no_think' prefix for Qwen if you customize."
                  value={(settings as Settings & { extractorSystemPrompt?: string }).extractorSystemPrompt ?? ""}
                  defaultText={PROMPT_DEFAULTS.extractorSystemPrompt}
                  onSave={(v: string) => patchPrompt("extractorSystemPrompt" as keyof Settings, v)}
                  rows={5}
                />
                <PromptRow
                  label="HyDE System Prompt"
                  caption="Hypothetical Document Embeddings — generates a short fake passage that would answer the query (used as extra dense-vector probe). '/no_think' prefix (Engine Hints below) is auto-injected for Qwen — don't include it here."
                  value={(settings as Settings & { hydeSystemPrompt?: string }).hydeSystemPrompt ?? ""}
                  defaultText={PROMPT_DEFAULTS.hydeSystemPrompt}
                  onSave={(v: string) => patchPrompt("hydeSystemPrompt" as keyof Settings, v)}
                  rows={5}
                />
                <PromptRow
                  label="Planner System Prompt"
                  caption="Used by plan-and-execute (Faz 6 planner) when the planner LLM decides which tools to chain. Placeholder: {MAX_TOOLS}."
                  value={(settings as Settings & { plannerSystemPrompt?: string }).plannerSystemPrompt ?? ""}
                  defaultText={PROMPT_DEFAULTS.plannerSystemPrompt}
                  onSave={(v: string) => patchPrompt("plannerSystemPrompt" as keyof Settings, v)}
                  rows={10}
                />
                <div className="border-t border-border/40 pt-3 mt-1">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Engine Hints</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold">Think-Off Prefix (Qwen `/no_think`)</Label>
                  <p className="text-[10px] font-mono text-muted-foreground">Prepended to extractor + HyDE sysMsg when the model template starts with `qwen`. Default <code className="text-foreground">{"/no_think\\n"}</code>. Set empty to disable.</p>
                  <Input
                    value={(settings as Settings & { thinkOffPrefix?: string }).thinkOffPrefix ?? THINK_OFF_PREFIX_DEFAULT}
                    onChange={(e) => patchPrompt("thinkOffPrefix" as keyof Settings, e.target.value)}
                    placeholder="/no_think\n"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="border-t border-border/40 pt-3 mt-1">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Agent Prompt Layers (Python config_center)</p>
                </div>
                <PromptRow
                  label="Agent · RAG Directive (with hits)"
                  caption="Sent to the agent's Python runtime when RAG snippets were retrieved. Drives the opening line + source-citation rules. Placeholder: {SOURCES} → comma-separated label list."
                  value={(settings as Settings & { agentRagWithHitsDirective?: string }).agentRagWithHitsDirective ?? ""}
                  defaultText={PROMPT_DEFAULTS.agentRagWithHitsDirective}
                  onSave={(v: string) => patchPrompt("agentRagWithHitsDirective" as keyof Settings, v)}
                  rows={10}
                />
                <PromptRow
                  label="Agent · RAG Directive (no hits)"
                  caption="Sent when library was consulted but returned 0 snippets. Default tells the agent to open with 'Kütüphaneme baktım, bu konuda eşleşen kaynak yok; kendi bilgimle cevaplıyorum:' then answer from its own knowledge."
                  value={(settings as Settings & { agentRagNoHitsDirective?: string }).agentRagNoHitsDirective ?? ""}
                  defaultText={PROMPT_DEFAULTS.agentRagNoHitsDirective}
                  onSave={(v: string) => patchPrompt("agentRagNoHitsDirective" as keyof Settings, v)}
                  rows={6}
                />
                <PromptRow
                  label="Agent · Tool Manifest Frame"
                  caption="Header wrapped around the agent's bound tool list (only when tools exist). Placeholder: {TOOLS} → bulleted list of '!slug — description'. If you omit {TOOLS}, the list is appended at the end."
                  value={(settings as Settings & { agentToolsManifestFrame?: string }).agentToolsManifestFrame ?? ""}
                  defaultText={PROMPT_DEFAULTS.agentToolsManifestFrame}
                  onSave={(v: string) => patchPrompt("agentToolsManifestFrame" as keyof Settings, v)}
                  rows={6}
                />
              </div>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, bad }: { label: string; value: number | string; bad?: boolean }) {
  return (
    <div className={`rounded border p-2 ${bad ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-card/40"}`}>
      <div className="text-muted-foreground">{label}</div>
      <div className={`mt-1 ${bad ? "text-amber-500" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function ManifestModeRow({
  settings,
  patchSetting,
}: {
  settings: unknown;
  patchSetting: (key: never, value: never) => void;
}) {
  const s = settings as { elaraAgentManifestMode?: string; elaraAgentManifestDirectAnswer?: boolean } | null;
  const mode = String(s?.elaraAgentManifestMode || "lazy").toLowerCase();
  const directAnswer = s?.elaraAgentManifestDirectAnswer !== false;
  const [preview, setPreview] = useState<{ text: string; count: number; squads: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const setMode = (v: string) => {
    patchSetting("elaraAgentManifestMode" as never, v as never);
  };

  const loadPreview = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/agents/manifest-preview");
      const j = await r.json();
      if (j?.ok) {
        setPreview({ text: String(j.text || ""), count: Number(j.count || 0), squads: Array.isArray(j.squads) ? j.squads : [] });
        setOpen(true);
      } else {
        toast.error("Manifest preview failed", { description: String(j?.error || "unknown") });
      }
    } catch (e) {
      toast.error("Manifest preview failed", { description: String((e as Error)?.message || e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border/40 pt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-[11px]">Elara Agent Manifest ({"{AGENTS}"} placeholder)</Label>
          <p className="text-[10px] font-mono text-muted-foreground">
            Replaces <code>{"{AGENTS}"}</code> in Elara's system prompt with a live agent list (squad → slug → 1-line description) from the agents table.
            <br />
            <b>off</b>: always empty (shortest prompt).{" "}
            <b>lazy</b> (default): injected only when the user's intent is "meta" (e.g. "list your agents", "who's in your team").{" "}
            <b>always</b>: injected every turn (legacy, costs TTFT).
          </p>
        </div>
        <select
          className="h-8 rounded border border-border bg-background px-2 text-[11px] font-mono"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="off">off</option>
          <option value="lazy">lazy</option>
          <option value="always">always</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded border border-border/50 px-2 py-1">
          <Switch
            checked={directAnswer}
            onCheckedChange={(v) => patchSetting("elaraAgentManifestDirectAnswer" as never, v as never)}
          />
          <span className="text-[10px] text-muted-foreground">
            Direct answer for agent-list questions (no LOCAL warmup)
          </span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={loadPreview} disabled={loading}>
          {loading ? "Loading…" : "Preview manifest"}
        </Button>
        {preview && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {preview.count} agents · {preview.squads.length} squads
          </span>
        )}
      </div>
      {open && preview && (
        <pre className="max-h-64 overflow-auto rounded border border-border bg-card/40 p-2 text-[10px] font-mono whitespace-pre-wrap">
          {preview.text || "(empty)"}
        </pre>
      )}
    </div>
  );
}


function TuneRow({
  label, caption, value, bounds, onCommit, integer,
}: {
  label: string; caption: string; value: number;
  bounds: { min: number; max: number; step: number };
  onCommit: (v: number) => void;
  integer?: boolean;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const clamp = (v: number) => Math.min(bounds.max, Math.max(bounds.min, integer ? Math.round(v) : v));
  const commitNumber = (raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const c = clamp(v);
    setLocal(c);
    onCommit(integer ? c : Number(c.toFixed(2)));
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-[11px]">{label}</Label>
        <Input
          type="number"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={integer ? local : Number(local.toFixed(2))}
          onChange={(e) => setLocal(Number(e.target.value))}
          onBlur={(e) => commitNumber(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-20 h-7 font-mono text-[11px] text-center"
        />
      </div>
      <Slider
        min={bounds.min} max={bounds.max} step={bounds.step}
        value={[local]}
        onValueChange={([v]) => setLocal(v)}
        onValueCommit={([v]) => onCommit(integer ? v : Number(v.toFixed(2)))}
      />
      <p className="text-[10px] font-mono text-muted-foreground">{caption}</p>
    </div>
  );
}


function PromptRow({
  label, caption, value, onSave, rows = 5, defaultText = "",
}: {
  label: string;
  caption: string;
  value: string;
  onSave: (v: string) => void;
  rows?: number;
  defaultText?: string;
}) {
  // value === "" → no override → show defaultText so operator can read/fork it.
  // Treat (trimmed) equality with defaultText as "still default" → persist "".
  const initial = value && value.length > 0 ? value : defaultText;
  const [local, setLocal] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setLocal(value && value.length > 0 ? value : defaultText);
    setDirty(false);
  }, [value, defaultText]);
  const trimmedLen = local.trim().length;
  const isOverride = trimmedLen > 0 && local.trim() !== defaultText.trim();
  const handleSave = () => {
    const toSave = local.trim() === defaultText.trim() ? "" : local;
    onSave(toSave);
    setDirty(false);
  };
  const handleReset = () => {
    setLocal(defaultText);
    setDirty(false);
    onSave("");
  };
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center gap-2">
        <Label className="text-[11px] font-semibold">{label}</Label>
        <Badge variant="outline" className={`text-[10px] font-mono ${isOverride ? "border-primary/50 text-primary" : "border-muted-foreground/40 text-muted-foreground"}`}>
          {isOverride ? `OVERRIDE · ${trimmedLen} ch` : "DEFAULT"}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          {dirty && (
            <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={handleSave}>
              Save
            </Button>
          )}
          {isOverride && !dirty && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={handleReset}>
              <RotateCcw className="h-3 w-3 mr-1" />Reset to default
            </Button>
          )}
        </div>
      </div>
      <Textarea
        value={local}
        onChange={(e) => { setLocal(e.target.value); setDirty(true); }}
        rows={rows}
        className="font-mono text-[11px] resize-y"
      />
      <p className="text-[10px] font-mono text-muted-foreground">{caption}</p>
    </div>
  );
}

// Tur 4 (2026-07-03): cold-classifier + Meta-Forge lane retry telemetry chip.
// Polls /api/rag/intent-telemetry every 5s while mounted. Read-only.
type IntentTelemetry = {
  decisions: number; coldDecisions: number; warmDecisions: number;
  nullDecisions: number; forgeDecisions: number;
  forgeRetryRecovered: number; forgeRetryNoop: number; forgeRetryError: number;
  lastForgeAt: number; lastReason: string | null;
};
type IntentProbe = {
  anchorsReady: boolean;
  lastClassifySuccessAt: number;
  lastAnchorInitMs: number;
  telemetry: IntentTelemetry;
};

function MetaForgeTelemetryChip() {
  const [probe, setProbe] = useState<IntentProbe | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/rag/intent-telemetry", { credentials: "include" });
        const j = await r.json();
        if (!alive) return;
        if (j?.ok && j.probe) { setProbe(j.probe); setErr(null); }
        else setErr(String(j?.error || "no data"));
      } catch (e) { if (alive) setErr(String((e as Error)?.message || e)); }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (err) return <div className="text-[10px] text-muted-foreground mt-2">Telemetry unavailable: {err}</div>;
  if (!probe) return <div className="text-[10px] text-muted-foreground mt-2">Loading classifier telemetry…</div>;

  const t = probe.telemetry;
  const lastForge = t.lastForgeAt ? new Date(t.lastForgeAt).toLocaleTimeString() : "—";
  const anchorAgeSec = probe.lastClassifySuccessAt
    ? Math.floor((Date.now() - probe.lastClassifySuccessAt) / 1000) : null;
  return (
    <div className="mt-3 p-2 rounded-md border border-border/50 bg-muted/20 text-[11px] font-mono space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Classifier Telemetry</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>anchors: <b>{probe.anchorsReady ? "ready" : "cold"}</b></span>
        <span>init: <b>{probe.lastAnchorInitMs}ms</b></span>
        <span>last decision: <b>{anchorAgeSec != null ? `${anchorAgeSec}s ago` : "—"}</b></span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>decisions: <b>{t.decisions}</b></span>
        <span>warm: <b>{t.warmDecisions}</b></span>
        <span>cold: <b>{t.coldDecisions}</b></span>
        <span>null: <b>{t.nullDecisions}</b></span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>forge decisions: <b>{t.forgeDecisions}</b></span>
        <span>retry recovered: <b>{t.forgeRetryRecovered}</b></span>
        <span>noop: <b>{t.forgeRetryNoop}</b></span>
        <span>err: <b>{t.forgeRetryError}</b></span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>last forge: {lastForge}</span>
        {t.lastReason && <span>last reason: {t.lastReason}</span>}
      </div>
    </div>
  );
}
