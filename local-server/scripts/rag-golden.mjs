#!/usr/bin/env node
// Golden query suite for the RAG pipeline.
//
// Goal: replace "I think it works" with a single, repeatable PASS/FAIL run that
// captures decision, retriever, fused/coverage score, top1, and per-query top-3
// chunks. Vendor-agnostic — the "expected source" check is a SUBSTRING match
// against chunk path / brand / file_id, not a hardcoded brand classifier.
//
// Usage:
//   node local-server/scripts/rag-golden.mjs
//   ELARA_API_BASE=http://127.0.0.1:3005 node local-server/scripts/rag-golden.mjs
//   node local-server/scripts/rag-golden.mjs --json > /tmp/golden.json
//
// Exit code: 0 if all queries PASS, 1 otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ELARA_API_BASE || process.env.BASE || "http://127.0.0.1:3005";
const ENV_FILE = path.join(__dirname, "..", ".env");
const JSON_OUT = process.argv.includes("--json");

if (BASE.startsWith("https:")) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function loadAdminToken() {
  if (!fs.existsSync(ENV_FILE)) return "";
  const m = fs.readFileSync(ENV_FILE, "utf8").match(/^ADMIN_API_TOKEN=(.*)$/m);
  return m ? m[1].replace(/^['"]|['"]$/g, "").trim() : "";
}
const TOKEN = process.env.ADMIN_API_TOKEN || loadAdminToken() || "";
if (!TOKEN) {
  console.warn(`[golden] ADMIN_API_TOKEN yok (env/.env) — loopback bypass ile devam. /api/rag/* zaten guard'sız.`);
}

async function call(method, p, body) {
  const headers = { "x-admin-token": TOKEN };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(`${BASE}${p}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: r.status, json, text };
}

// Golden set. `expect` is a list of substrings; at least ONE must appear in the
// path/brand/file_id of at least ONE of the top-N returned rows. `expectSkip`
// means RAG should NOT inject. `requiresSource`: if no source in DB matches
// this substring (checked via /api/knowledge/sources), the case is reported
// as N/A instead of FAIL — the library may simply lack that vendor's docs.
const GOLDEN = [
  { q: "__self_audit__", sentinel: "self-audit" },
  { q: "api vpn server rules", sentinel: "fts" },
  { q: "citrix netscaler load balancing virtual server",
    expect: ["netscaler", "citrix", "adc"], topN: 3, requiresSource: "netscaler" },
  { q: "netscaler vpx initial config nsip",
    expect: ["netscaler", "citrix", "vpx"], topN: 3, requiresSource: "netscaler" },
  { q: "checkpoint vpn troubleshooting site to site",
    expect: ["checkpoint", "check_point", "check-point"], topN: 3, requiresSource: "checkpoint" },
  { q: "fortigate sslvpn troubleshooting tunnel down",
    expect: ["fortigate", "fortios", "forti"], topN: 3, requiresSource: "fortigate" },
  { q: "fortios rest api token curl example",
    expect: ["fortios", "fortigate", "api"], topN: 3, requiresSource: "fortios" },
  { q: "cloudflare waf rules managed ruleset",
    expect: ["cloudflare"], topN: 3, requiresSource: "cloudflare" },
  { q: "selam nasılsın", expectSkip: true },
  // Düşük güven sentinel: anlamsız sorgu skip edilmeli.
  // İki katmandan birinde elenebilir: probe (below_threshold_strict) veya rerank (no_confident_match).
  // Hangisinde elendiği threshold ayarlarına göre değişir; ikisi de doğru davranış.
  { q: "asdf qwerty zxcv lorem ipsum random tokens",
    expectSkip: true,
    expectReasons: ["below_threshold_strict", "no_confident_match", "below_threshold"] },
  // Case-variant simetri: aynı semantik soru iki farklı casing → common ≥ 5/6.
  { q: "bana CloudfalreWAF ta cok kısa ornek bir waf kuralı yazarmısın?",
    casePair: "bana Cloudflare WAF ta cok kısa ornek bir waf kuralı yazarmısın?",
    minCommon: 5, requiresSource: "cloudflare" },
];

async function sourceExists(needle) {
  if (!needle) return true;
  const r = await call("GET", `/api/knowledge/sources?search=${encodeURIComponent(needle)}&limit=1`);
  const items = r.json?.items || r.json?.sources || (Array.isArray(r.json) ? r.json : []);
  return Array.isArray(items) ? items.length > 0 : false;
}

function matches(row, needles) {
  const hay = [
    row.path, row.brand, row.file_id, row.file, row.source_path, row.source,
  ].filter(Boolean).join(" ").toLowerCase();
  return needles.some(n => hay.includes(String(n).toLowerCase()));
}

(async () => {
  // Warm worker (best-effort).
  await call("POST", "/api/system/worker/start").catch(() => {});

  const health = await call("GET", "/api/rag/health");
  const settingsProbe = await call("GET", `/api/rag/debug?q=${encodeURIComponent("ping")}`);

  const report = {
    base: BASE,
    workerStatus: health.json?.workerStatus,
    lastEmbedError: health.json?.lastEmbedError || null,
    warnings: health.json?.warnings || [],
    settings: settingsProbe.json?.settings || null,
    results: [],
    startedAt: new Date().toISOString(),
  };

  // Probe the embedder first with a real vendor query. If the worker is dead,
  // every subsequent test will report a confusing FAIL — better to early-exit
  // with one big banner pointing at the actual cause.
  const probeQ = "fortigate sslvpn troubleshooting";
  const probeR = await call("GET", `/api/rag/debug?q=${encodeURIComponent(probeQ)}`);
  const probeReason = probeR.json?.probe?.reason;
  if (probeReason === "embed_miss") {
    const banner = [
      "",
      "=========================================================================",
      "[golden] ✗ EMBED WORKER BROKEN — every query would return embed_miss",
      "=========================================================================",
      `  base           : ${BASE}`,
      `  workerStatus   : ${report.workerStatus}`,
      `  lastEmbedError : ${JSON.stringify(report.lastEmbedError)}`,
      `  probe.reason   : ${probeReason}`,
      "",
      "  This is almost always a zombi worker (port bound, model dead).",
      "  Fix:  ./local-server/scripts/middleware-restart.sh",
      "        (v2 kills the worker port too, then waits for /health)",
      "",
      "  Then re-run:  node local-server/scripts/rag-golden.mjs",
      "=========================================================================",
      "",
    ].join("\n");
    if (JSON_OUT) {
      report.summary = { passed: 0, total: GOLDEN.length, ok: false, embedBroken: true };
      process.stdout.write(JSON.stringify(report, null, 2));
    } else {
      console.error(banner);
    }
    process.exit(2);
  }

  for (const g of GOLDEN) {
    // Skip vendor cases when the library has no matching source — reports N/A.
    if (g.requiresSource && !(await sourceExists(g.requiresSource))) {
      report.results.push({
        q: g.q, pass: true, na: true,
        why: `no source matches "${g.requiresSource}" in library — N/A`,
        latencyMs: 0, decision: "n/a", reason: "missing_source",
        top: [],
      });
      continue;
    }

    const t0 = Date.now();
    if (g.sentinel === "self-audit") {
      const audit = await call("GET", "/api/rag/self-audit");
      const bad = (audit.json?.checks || []).filter(c => !c.ok);
      report.results.push({
        q: "RAG self-audit", pass: audit.json?.ok === true,
        why: bad.length ? bad.map(c => `${c.name}:${c.info}`).join("; ") : "all invariants OK",
        latencyMs: Date.now() - t0, decision: "sentinel", reason: "self-audit", top: [],
      });
      continue;
    }
    // Case-variant pair: aynı sorunun iki casing varyantını çek, common sources say.
    if (g.casePair) {
      const [r1, r2] = await Promise.all([
        call("GET", `/api/rag/debug?q=${encodeURIComponent(g.q)}`),
        call("GET", `/api/rag/debug?q=${encodeURIComponent(g.casePair)}`),
      ]);
      const ms = Date.now() - t0;
      const p1 = r1.json?.probe || {}; const p2 = r2.json?.probe || {};
      const keyOf = (row) => `${row.path || row.file || row.file_id}#${row.ord}`;
      const s1 = new Set((p1.rows || []).map(keyOf));
      const s2 = new Set((p2.rows || []).map(keyOf));
      const common = [...s1].filter(k => s2.has(k)).length;
      const need = g.minCommon || 5;
      const pass = common >= need;
      report.results.push({
        q: g.q.slice(0, 50) + " ⇄ casePair", pass,
        why: pass ? `case-symmetry common=${common}/6 ≥ ${need}` : `case-asymmetry common=${common}/6 < ${need}`,
        latencyMs: ms, decision: p1.decision, reason: p1.reason,
        top1: p1.top1, topCoverage: p1.topCoverage,
        reranker: p1.reranker || null, top: [],
      });
      continue;
    }
    const r = await call("GET", `/api/rag/debug?q=${encodeURIComponent(g.q)}`);
    const ms = Date.now() - t0;
    const p = r.json?.probe || {};
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const top = rows.slice(0, g.topN || 3);

    let pass, why;
    if (g.sentinel === "fts") {
      const chunkErr = p.ftsChunkError?.detail || p.ftsChunkError;
      const srcErr   = p.ftsSourceError?.detail || p.ftsSourceError;
      pass = Number(p.ftsRows || 0) > 0 && !p.ftsError && !chunkErr && !srcErr;
      why = pass
        ? `fts-live rows=${p.ftsRows}`
        : `fts-dead rows=${p.ftsRows || 0} chunkErr=${chunkErr || "-"} srcErr=${srcErr || "-"} err=${p.ftsError?.detail || p.ftsError || "none"}`;
    } else if (g.expectSkip) {
      const allowedReasons = Array.isArray(g.expectReasons)
        ? g.expectReasons
        : (g.expectReason ? [g.expectReason] : []);
      const reasonOk = allowedReasons.length === 0 || allowedReasons.includes(p.reason);
      pass = p.decision !== "inject" && reasonOk;
      why = pass
        ? `skipped-as-expected (${p.reason})`
        : (p.decision === "inject"
            ? `unexpected-inject (top1=${p.top1} cov=${p.topCoverage})`
            : `wrong-skip-reason got=${p.reason} want=${allowedReasons.join("|") || "(any)"}`);
    } else {
      const hit = top.find(row => matches(row, g.expect));
      pass = !!hit;
      why = pass ? `match:${(hit.path||hit.file_id||hit.brand||"").slice(0,60)}` :
                   `no top-${g.topN||3} row matches [${g.expect.join("|")}]`;
    }

    // On FAIL with a requiresSource, ask /api/rag/verify-source whether the
    // root cause is ingest (DB) or ranking. This turns the rapor satırı into a
    // single-glance answer instead of another investigation loop.
    if (!pass && g.requiresSource) {
      const v = await call("GET", `/api/rag/verify-source?needle=${encodeURIComponent(g.requiresSource)}`);
      const diag = v.json?.diagnosis;
      if (diag && diag !== "ok") {
        why += `  → ingest_broken(${diag}): ${v.json?.hint || ""}`;
      } else if (diag === "ok") {
        why += `  → ingest_ok (rerank/fusion calibration needed)`;
      }
    }

    report.results.push({
      q: g.q, pass, why, latencyMs: ms,
      decision: p.decision, reason: p.reason,
      top1: p.top1, ftsTop: p.ftsTop, ftsRows: p.ftsRows, ftsError: p.ftsError, tau: p.tau,
      topCoverage: p.topCoverage, queryTerms: p.queryTerms,
      retriever: top[0]?.retriever, coverage: top[0]?.coverage,
      fused: top[0]?.fused,
      reranker: p.reranker || null,
      top: top.map(row => ({
        score: row.score, coverage: row.coverage, fused: row.fused,
        retriever: row.retriever, brand: row.brand,
        path: row.path || row.file || row.file_id,
        ord: row.ord,
        rerank_score: row.rerank_score,
      })),
    });
  }

  const evaluated = report.results.filter(r => !r.na);
  const passed = evaluated.filter(r => r.pass).length;
  const skipped = report.results.length - evaluated.length;
  const total  = evaluated.length;
  report.summary = { passed, total, skipped, ok: passed === total };

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(report, null, 2));
    process.exit(report.summary.ok ? 0 : 1);
  }

  console.log(`[golden] base=${BASE} worker=${report.workerStatus}`);
  if (report.lastEmbedError) console.log(`[golden] lastEmbedError:`, report.lastEmbedError);
  if (report.warnings.length) console.log(`[golden] warnings: ${report.warnings.join(" | ")}`);
  // Reranker özet satırı — worker /health + middleware rerankInfo birleşimi
  const rrHealth = health.json?.reranker || {};
  const rrAny = report.results.map(r => r.reranker).find(Boolean) || {};
  const rrErr = rrAny?.lastError ? `${rrAny.lastError.kind}:${rrAny.lastError.detail}` : "none";
  console.log(`[golden] reranker: enabled=${!!rrHealth.enabled} model=${rrHealth.model || "-"} topN=${rrHealth.topN ?? "-"} timeout=${rrHealth.timeoutMs ?? "-"}ms weight=${rrHealth.weight ?? "-"} last=${rrAny.ms ?? "-"}ms used=${rrAny.used ?? "-"} err=${rrErr}`);
  console.log();
  console.log("PASS  query                                                  decision  retriever     top1   cov   fused   rerank  ms   reason");
  console.log("----  -----                                                  --------  ---------     ----   ---   -----   ------  --   ------");
  for (const r of report.results) {
    const tag = r.na ? "N/A " : (r.pass ? " OK " : "FAIL");
    const rrCell = r.top?.[0]?.rerank_score != null
      ? Number(r.top[0].rerank_score).toFixed(3)
      : "-";
    // rerank=- sebebini satır sonuna iliştir (timeout/disabled/http_error/...)
    const rrTail = (rrCell === "-" && r.reranker?.lastError && r.decision === "inject")
      ? `  ⚠ rr_err=${r.reranker.lastError.kind}`
      : "";
    console.log(
      tag.padEnd(5),
      String(r.q).slice(0, 54).padEnd(55),
      String(r.decision || "-").padEnd(9),
      String(r.retriever || "-").padEnd(13),
      String(r.top1 != null ? Number(r.top1).toFixed(3) : "-").padEnd(6),
      String(r.topCoverage != null ? Number(r.topCoverage).toFixed(2) : (r.coverage != null ? Number(r.coverage).toFixed(2) : "-")).padEnd(5),
      String(r.fused != null ? Number(r.fused).toFixed(4) : "-").padEnd(7),
      String(rrCell).padEnd(6),
      String(r.latencyMs).padEnd(4),
      r.why + rrTail,
    );
    for (const t of r.top.slice(0, 3)) {
      console.log("       ·", [
        `score=${t.score != null ? Number(t.score).toFixed(3) : "-"}`,
        `cov=${t.coverage != null ? Number(t.coverage).toFixed(2) : "-"}`,
        `rr=${t.rerank_score != null ? Number(t.rerank_score).toFixed(3) : "-"}`,
        `${t.retriever || "-"}`,
        `${t.brand || "-"}`,
        `${String(t.path || "").slice(0, 80)}#${t.ord ?? "?"}`,
      ].join("  "));
    }
  }
  console.log();
  console.log(`[golden] ${passed}/${total} passed${skipped ? `, ${skipped} N/A (missing sources)` : ""} ${passed === total ? "✓" : "✗"}`);

  // Baseline yaz: bundan sonraki run'lar buna karşı diff alabilsin.
  // (Sadece full PASS'te yazılır → bozuk baseline kaydetme.)
  if (report.summary.ok) {
    try {
      const baselineDir = "/mnt/documents";
      if (fs.existsSync(baselineDir)) {
        const baselinePath = path.join(baselineDir, "rag-golden-baseline.json");
        const slim = {
          savedAt: new Date().toISOString(),
          summary: report.summary,
          results: report.results.map(r => ({
            q: r.q, pass: r.pass, decision: r.decision, reason: r.reason,
            top1: r.top1, topCoverage: r.topCoverage,
            topPaths: (r.top || []).map(t => `${t.path}#${t.ord}`),
          })),
        };
        fs.writeFileSync(baselinePath, JSON.stringify(slim, null, 2));
        console.log(`[golden] baseline written: ${baselinePath}`);
      }
    } catch (e) {
      console.log(`[golden] baseline write failed: ${e.message}`);
    }
  }
  process.exit(report.summary.ok ? 0 : 1);
})().catch(e => { console.error("[golden] FATAL", e); process.exit(2); });
