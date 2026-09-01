#!/usr/bin/env node
// worker-revive.mjs — Worker neden ayağa kalkmıyor? Tek script ile cevap + komut.
//
// Auth gerektirmez. launchd loglarını okur, venv test eder, .env karşılaştırır,
// sonunda "şu komutu çalıştır" der.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const hdr = (t) => console.log(`\n━━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);
const sh = (cmd) => {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 8000 }).trim(); }
  catch (e) { return `[err] ${(e.stderr || e.message || "").toString().split("\n").slice(-3).join(" | ")}`; }
};
const verdicts = [];
const recommend = (cmd, why) => verdicts.push({ cmd, why });

function tailFile(p, n = 150) {
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p, "utf8").split(/\r?\n/);
  return buf.slice(-n).join("\n");
}

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

(async () => {
  console.log(`# WORKER REVIVE\n# repo=${REPO}\n# host=${os.hostname()}`);

  // 1. launchd logs
  hdr("1. launchd stdout/stderr (son 80 satır)");
  for (const f of ["/tmp/elara-middleware.err.log", "/tmp/elara-middleware.out.log"]) {
    console.log(`\n--- ${f} ---`);
    const t = tailFile(f, 80);
    if (t === null) { console.log("  (dosya yok)"); continue; }
    if (!t.trim()) { console.log("  (boş)"); continue; }
    console.log(t);
  }

  // 2. Worker-ilişkili satırları vurgula
  hdr("2. Worker ipuçları (otomatik vurgu)");
  const allLog = ["/tmp/elara-middleware.err.log", "/tmp/elara-middleware.out.log"]
    .map(f => tailFile(f, 600) || "").join("\n");
  const patterns = [
    { re: /circuit-breaker.*KİLİTLİ|circuit-breaker tetiklendi/i, label: "CIRCUIT-BREAKER kilitli" },
    { re: /\[exit\] code=\d+/g,                                  label: "Worker exit code" },
    { re: /ModuleNotFoundError.*['"]([^'"]+)['"]/g,             label: "Eksik Python modülü" },
    { re: /ImportError: ([^\n]+)/g,                              label: "Import hatası" },
    { re: /no python runner available/i,                         label: "Python bulunamadı" },
    { re: /Permission denied/g,                                  label: "Permission denied" },
    { re: /\[spawn\] (\S+) /g,                                   label: "Spawn komutu" },
    { re: /Address already in use|EADDRINUSE/,                   label: "Port :process.env.EMBED_WORKER_PORT || 8082 dolu" },
    { re: /Killed: 9|SIGKILL|OOM/,                               label: "OOM / SIGKILL" },
    { re: /\[suicide\][^\n]+/g,                                  label: "Self-suicide (RSS/req cap)" },
  ];
  let hitAny = false;
  for (const { re, label } of patterns) {
    const matches = allLog.match(re);
    if (matches && matches.length) {
      hitAny = true;
      console.log(`  ✦ ${label}:`);
      [...new Set(matches)].slice(0, 5).forEach(m => console.log(`      ${m.trim()}`));

      if (label === "Eksik Python modülü") {
        const mod = matches[0].match(/['"]([^'"]+)['"]/)?.[1];
        recommend(
          `cd ${REPO} && .venv/bin/pip install -r requirements-worker.txt`,
          `Python venv'de "${mod}" eksik`,
        );
      }
      if (label === "CIRCUIT-BREAKER kilitli") {
        recommend(
          `launchctl kickstart -k gui/$UID/com.elara.middleware`,
          `Çok fazla respawn → server kilitlendi. Server'ı yeniden başlat, sayaç sıfırlanır.`,
        );
      }
      if (label === "Port :process.env.EMBED_WORKER_PORT || 8082 dolu") {
        recommend(
          `lsof -ti :process.env.EMBED_WORKER_PORT || 8082 | xargs -r kill -9 && launchctl kickstart -k gui/$UID/com.elara.middleware`,
          `Port'u tutan process'i öldür, server'ı kicka.`,
        );
      }
      if (label === "Self-suicide (RSS/req cap)") {
        recommend(
          `# .env içine ekle:\nEMBED_WORKER_MAX_RSS_GB=4.0\nEMBED_WORKER_MAX_REQUESTS=20000`,
          `Worker güvenlik cap'ine çarptı, suicide ediyor. Cap'leri yükselt (respawn maliyeti azalsın).`,
        );
      }
      if (label === "Python bulunamadı") {
        recommend(
          `# .env içine ekle (gerçek yolu which python3 ile bul):\nPYTHON_BIN=/usr/bin/python3`,
          `server.mjs hiçbir python adayı bulamadı.`,
        );
      }
    }
  }
  if (!hitAny) {
    console.log("  Log'da worker ipucu yok. İhtimaller:");
    console.log("   a) Worker bu boot'ta hiç tetiklenmedi (sohbet gelmedi, lazy-spawn beklemede)");
    console.log("   b) Log /tmp dışında bir yere yazılıyor (launchd plist'i kontrol et)");
  }

  // 3. .venv testi
  hdr("3. Python venv testi");
  const venvPy = path.join(REPO, ".venv", "bin", "python");
  if (fs.existsSync(venvPy)) {
    console.log(`  venv python: ${venvPy}`);
    console.log("  versiyon: " + sh(`${venvPy} --version`));
    console.log("\n  Import testi (sentence_transformers, fastapi, uvicorn, torch):");
    const test = sh(`${venvPy} -c "import sentence_transformers, fastapi, uvicorn; print('IMPORTS OK'); import torch; print('torch', torch.__version__, 'mps', torch.backends.mps.is_available())"`);
    console.log("  " + test.replace(/\n/g, "\n  "));
    if (test.includes("ModuleNotFoundError") || test.includes("[err]")) {
      const mod = test.match(/No module named ['"]([^'"]+)['"]/)?.[1] || "(?)";
      recommend(
        `cd ${REPO} && .venv/bin/pip install -r requirements-worker.txt`,
        `venv'de import başarısız (eksik: ${mod}).`,
      );
    }
  } else {
    console.log(`  venv YOK: ${venvPy}`);
    recommend(
      `cd ${REPO} && python3 -m venv .venv && .venv/bin/pip install -r requirements-worker.txt`,
      `Hiç venv yok. server.mjs venv > uv > python3 sırası ile arıyor; venv'in olması en güvenli.`,
    );
  }

  // 4. .env env değerleri
  hdr("4. .env (worker ilgili anahtarlar)");
  const env = readEnvFile(path.join(REPO, ".env"));
  const want = ["PYTHON_BIN", "EMBED_WORKER_PORT", "MLX_EMBED_MODEL", "MLX_EMBED_BASE_URL",
                "EMBED_WORKER_MAX_RSS_GB", "EMBED_WORKER_MAX_REQUESTS", "WORKER_BOOT_TIMEOUT_MS"];
  for (const k of want) console.log(`  ${k.padEnd(28)} = ${env[k] ?? "(unset)"}`);

  // 5. Sistem python
  hdr("5. Sistem python3");
  console.log("  which python3: " + sh("which python3"));
  console.log("  versiyon     : " + sh("python3 --version 2>&1"));

  // 6. Verdikt
  hdr("✓ Önerilen aksiyon");
  if (!verdicts.length) {
    console.log("  Otomatik teşhis çıkmadı. (1)/(2) bölümlerini bana yapıştır.");
    console.log("  Ya da: sohbet penceresini açıp bir mesaj yaz — lazy-spawn tetiklensin, sonra script'i tekrar koş.");
  } else {
    verdicts.forEach((v, i) => {
      console.log(`\n  ${i + 1}. ${v.why}`);
      console.log(`     $ ${v.cmd}`);
    });
  }
  console.log("");
})();
