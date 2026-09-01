#!/usr/bin/env bash
# measure-rag-ttft.sh — TUR R-1 ölçüm helper (read-only).
#
# chatTrace ring buffer'ını HTTP üzerinden okur:
#   GET /api/debug/chat/recent?limit=400
# (chatTrace pushLog → IN-MEMORY ring, log dosyalarına YAZILMIYOR;
#  bu yüzden eski grep tabanlı sürüm hiç traceId bulamıyordu.)
#
# Hiçbir restart / mutation / kod değişikliği YOK.
#
# Kullanım:
#   bash local-server/scripts/measure-rag-ttft.sh           # son 6 tur
#   N=12 bash local-server/scripts/measure-rag-ttft.sh      # son 12 tur
#   PORT=3005 bash local-server/scripts/measure-rag-ttft.sh
#
# Sütunlar:
#   #       — sondan geriye sıra
#   intent  — rag.intent.refined detail.kind/mode
#   inject  — rag.inject.done detail.sources
#   probeMs — rag.probe.done detail.ms
#   ttftMs  — mlx.first_token.received detail.totalMs (UI'daki "Think")
#   genMs   — mlx.stream.done detail.totalMs - ttftMs
#   chars   — mlx.stream.done detail.chars  (~ tokensOut*4)
#   ragRows — rag.probe.done detail.rows
#   notes   — brand-lock / cross-vendor-reject / cold-fb / smalltalk-bypass

set -u
N="${N:-6}"
PORT="${PORT:-3005}"
HOST="${HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/api/debug/chat/recent?limit=400"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node gerekli." >&2
  exit 1
fi

RAW=$(curl -sS --max-time 5 "$URL" 2>/dev/null || true)
if [ -z "$RAW" ]; then
  echo "ERROR: $URL boş döndü — middleware ayakta mı?" >&2
  exit 1
fi

N="$N" node --input-type=module -e '
const N = Number(process.env.N || 6);
const raw = await new Promise((r) => {
  let buf = ""; process.stdin.on("data", c => buf += c); process.stdin.on("end", () => r(buf));
});
let j;
try { j = JSON.parse(raw); } catch { console.error("ERROR: JSON parse fail"); process.exit(1); }
const traces = j?.traces || [];
if (!traces.length) { console.log("(ring buffer boş — yeni bir chat turu çevir, sonra yeniden çalıştır)"); process.exit(0); }

// Group by traceId
const byId = new Map();
for (const e of traces) {
  if (!byId.has(e.traceId)) byId.set(e.traceId, []);
  byId.get(e.traceId).push(e);
}
const ids = [...byId.keys()];
// son chat turları sonda → reverse to get newest first, then slice N, then reverse back so newest is row 1
const lastIds = ids.slice(-N);

console.log("");
console.log(`=== RAG TTFT ölçümü (son ${lastIds.length} tur · ring=${traces.length}) ===`);
console.log("");
const head = ["#","intent","reason","probeMs","extM","prepM","embM","sqlM","ftsM","vfM","hyM","rrM","gap","ttftMs","genMs","chars","rows"];
const widths = [3,22,18,7,5,5,5,5,5,5,5,5,5,7,7,7,5];
const pad = (s,w) => String(s ?? "-").padEnd(w);
console.log(head.map((h,i)=>pad(h,widths[i])).join(" "));
console.log("-".repeat(widths.reduce((a,b)=>a+b+1,0)));

const findStage = (evs, stage) => evs.find(e => e.stage === stage);

lastIds.forEach((id, idx) => {
  const evs = byId.get(id);
  const intentEv  = findStage(evs, "rag.intent.refined") || findStage(evs, "router.refined") || findStage(evs, "router.classified");
  const probeDone = findStage(evs, "rag.probe.done");
  const injectDone= findStage(evs, "rag.inject.done") || findStage(evs, "rag.injected");
  const ragSkip   = findStage(evs, "rag.skipped") || findStage(evs, "rag.probe.skip");
  const firstTok  = findStage(evs, "mlx.first_token.received");
  const streamDone= findStage(evs, "mlx.stream.done");
  const sseClosed = findStage(evs, "sse.closed");

  const kind = intentEv?.detail?.kind || intentEv?.detail?.intent || "?";
  const mode = intentEv?.detail?.mode || "?";
  const intent = `${kind}/${mode}`.slice(0,22);
  const reason = String(intentEv?.detail?.reason ?? "-").slice(0,18);

  const probeMs = probeDone?.detail?.ms ?? injectDone?.detail?.ms ?? ragSkip?.detail?.ms ?? null;
  const st = probeDone?.detail?.stages || injectDone?.detail?.stages || {};
  const extM  = st.extractorMs ?? "-";
  const prepM = st.prepMs ?? "-";
  const embM  = st.embedMs ?? "-";
  const sqlM  = st.probeSqlMs ?? "-";
  const ftsM  = st.ftsMs ?? "-";
  const vfM   = st.vectorFetchMs ?? "-";
  const hyM   = st.hydeMs ?? "-";
  const rrM   = st.rerankMs ?? probeDone?.detail?.rerankerMs ?? injectDone?.detail?.rerankerMs ?? "-";
  let gap = "-";
  if (typeof probeMs === "number") {
    const known = ["extractorMs","prepMs","embedMs","probeSqlMs","ftsMs","vectorFetchMs","hydeMs","rerankMs"]
      .reduce((a,k)=>a+(Number(st[k])||0),0);
    gap = probeMs - known;
  }
  const ttftMs = firstTok?.detail?.totalMs ?? "-";
  const totalMs = streamDone?.detail?.totalMs ?? sseClosed?.detail?.totalMs ?? null;
  const genMs = (totalMs != null && typeof ttftMs === "number") ? (totalMs - ttftMs) : "-";
  const chars = streamDone?.detail?.chars ?? sseClosed?.detail?.chars ?? "-";
  const ragRows = probeDone?.detail?.rows ?? injectDone?.detail?.hits ?? "-";

  const row = [idx+1, intent, reason, probeMs ?? "-", extM, prepM, embM, sqlM, ftsM, vfM, hyM, rrM, gap, ttftMs, genMs, chars, ragRows];
  console.log(row.map((c,i)=>pad(c,widths[i])).join(" "));
});

console.log("");
console.log("Stage kolonları (RAG probe içi · ms):");
console.log("  extM=technical-core extractor · prepM=entry→embed glue (terms+library+brand)");
console.log("  embM=query embed · sqlM=vector probe SQL (top-4) · ftsM=FTS hibrit");
console.log("  vfM=vector fetch SQL (top-24 diversity) · hyM=HyDE LLM+embed · rrM=cross-encoder rerank");
console.log("  gap=probeMs - sum(stages) → hâlâ büyükse ölçülmeyen await/SET LOCAL/connect var");
console.log("Yorum:");
console.log("  • extM >500 → cold MLX extractor (LLM-based technical core)");
console.log("  • prepM >300 → DB cache miss (libraryBrands / agentRagBrands / packFilter)");
console.log("  • hyM >800 → HyDE LLM cold + embed; bandı daralt veya kapat");
console.log("  • rrM >1000 → cross-encoder cold/MPS swap; rerankTimeoutMs düşür");
console.log("  • gap >500 → pool.connect bekliyor veya SET LOCAL / statement_timeout overhead");
console.log("");
console.log("");
' <<< "$RAW"
