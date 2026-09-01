#!/usr/bin/env node
// worker-postmortem.mjs — bge-m3 worker neden öldü, kalıcı nasıl kalkar?
//
// 1) /api/system/worker/status — şu anki hali + lastError
// 2) :process.env.EMBED_WORKER_PORT || 8082 port sahibi (lsof) — başka process tutuyor mu?
// 3) launchd plist (com.elara.middleware) varsa KeepAlive durumu
// 4) Server'dan worker logu çek: /api/system/logs?source=worker (varsa) ya da
//    son ./logs/*.log içinden grep "[worker]"
// 5) POST /api/system/worker { action: "start" } ile manuel respawn dene → sonuç
// 6) 3 saniye sonra status tekrar oku
//
// Kullanım: node local-server/scripts/worker-postmortem.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.RAG_DEBUG_BASE || "https://elara.local:10443";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

function _loadAdminToken() {
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) return "";
  const m = fs.readFileSync(envFile, "utf8").match(/^ADMIN_API_TOKEN=(.*)$/m);
  return m ? m[1].replace(/^['"]|['"]$/g, "").trim() : "";
}
const ADMIN_TOKEN = _loadAdminToken();
const adminHeaders = ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {};

function hdr(n, t) { console.log(`\n━━━ ${n}. ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`); }
function sh(cmd) { try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch (e) { return `[err] ${e.message.split("\n")[0]}`; } }

async function getJSON(url, opts = {}) {
  try {
    const headers = { ...(opts.headers || {}), ...adminHeaders };
    const r = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(8000) });
    const t = await r.text();
    try { return { ok: r.ok, status: r.status, body: JSON.parse(t) }; }
    catch { return { ok: r.ok, status: r.status, body: t.slice(0, 500) }; }
  } catch (e) { return { ok: false, error: e.message }; }
}

(async () => {
  console.log(`# WORKER POSTMORTEM   base=${BASE}`);

  // 1
  hdr(1, "İlk status");
  const s1 = await getJSON(`${BASE}/api/system/worker/status`);
  console.log(JSON.stringify(s1, null, 2));

  // 2
  hdr(2, "Port :process.env.EMBED_WORKER_PORT || 8082 sahibi (lsof)");
  console.log(sh("lsof -nP -iTCP:process.env.EMBED_WORKER_PORT || 8082 -sTCP:LISTEN 2>/dev/null || echo '(port boş)'"));
  console.log("\nps -ef | grep -i worker.py:");
  console.log(sh("ps -ef | grep -E 'worker\\.py|uvicorn' | grep -v grep | head -20"));

  // 3
  hdr(3, "launchd plist");
  const plist = path.join(REPO, "launchd", "com.elara.middleware.plist");
  if (fs.existsSync(plist)) {
    console.log(`plist: ${plist}`);
    console.log(sh(`grep -A1 -E 'KeepAlive|RunAtLoad|StandardErrorPath|StandardOutPath|WorkingDirectory|ProgramArguments' ${plist} | head -40`));
    console.log("\nlaunchctl list | grep elara:");
    console.log(sh("launchctl list 2>/dev/null | grep -i elara || echo '(launchctl elara servisi yüklü değil)'"));
  } else {
    console.log("plist bulunamadı: " + plist);
  }

  // 4
  hdr(4, "Server tarafından tutulan worker log buffer'ı");
  const logsResp = await getJSON(`${BASE}/api/system/logs?source=worker&limit=200`);
  if (logsResp.ok && logsResp.body) {
    const arr = Array.isArray(logsResp.body) ? logsResp.body
              : Array.isArray(logsResp.body?.lines) ? logsResp.body.lines
              : Array.isArray(logsResp.body?.logs)  ? logsResp.body.logs
              : null;
    if (arr) {
      console.log(`(${arr.length} satır, son 60:)\n`);
      arr.slice(-60).forEach(l => console.log("  " + (typeof l === "string" ? l : JSON.stringify(l))));
    } else {
      console.log("Endpoint cevap verdi ama beklenmedik şekil:");
      console.log(JSON.stringify(logsResp.body).slice(0, 600));
    }
  } else {
    console.log(`/api/system/logs alınamadı (${logsResp.status || logsResp.error}). Dosya fallback:`);
    const candidates = [
      path.join(REPO, "..", "local-server.log"),
      path.join(REPO, "local-server.log"),
      "/tmp/elara-middleware.err",
      "/tmp/elara-middleware.out",
      path.join(REPO, "launchd", "stderr.log"),
      path.join(REPO, "launchd", "stdout.log"),
    ];
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        console.log(`\n--- ${f} (son 40 [worker] satırı) ---`);
        console.log(sh(`grep -E '\\[worker\\]|worker\\.py|EMBED_' ${f} | tail -40`));
      }
    }
  }

  // 5
  hdr(5, "Manuel respawn dene (POST /api/system/worker/start)");
  const respawn = await getJSON(`${BASE}/api/system/worker/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log(JSON.stringify(respawn, null, 2));

  // 6
  hdr(6, "3 sn sonra tekrar status");
  await new Promise(r => setTimeout(r, 3000));
  const s2 = await getJSON(`${BASE}/api/system/worker/status`);
  console.log(JSON.stringify(s2, null, 2));

  // Quick verdict
  hdr("✓", "Hızlı yorum");
  const final = s2.body || {};
  if (final.healthy && final.pid) {
    console.log(`  Manuel start ÇALIŞTI (pid=${final.pid}, backend=${final.backend}).`);
    console.log(`  → Sorun lifecycle: süreç başlıyor, sonra ölüyor. (4) numaralı log bloğunda "rss > cap" / "req_count >= cap" / SIGTERM / OOM ipucu aranır.`);
    console.log(`  → launchd KeepAlive AÇILMALI (3 numaralı bölüm boşsa).`);
  } else {
    console.log(`  Manuel start BAŞARISIZ. lastError: ${final.lastError || respawn.body?.lastError || "(yok)"}`);
    console.log(`  → (2) port boşsa Python yolu/permission, (4) log "no python runner" diyorsa EMBED_PYTHON env yanlış.`);
  }
})();
