// Port self-heal — kendi zombilerimizi (bun/node/elara) temizle.
// Pure util, no DI. Extracted from server.mjs (Block E.2 Tur 3).
import { execSync } from "node:child_process";

export function ensurePortFree(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port}`, { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (!out) { console.log(`[boot] port ${port} temiz`); return; }
    for (const pid of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
      let comm = "";
      try { comm = execSync(`ps -o comm= -p ${pid}`, { timeout: 1000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
      const safe = /bun|node|elara/i.test(comm);
      if (!safe) { console.warn(`[boot] port ${port} pid=${pid} (${comm}) bizim değil — atlandı`); continue; }
      try { execSync(`kill -TERM ${pid}`, { timeout: 1000, stdio: "ignore" }); } catch {}
      const start = Date.now();
      while (Date.now() - start < 400) {
        try { execSync(`kill -0 ${pid}`, { timeout: 500, stdio: "ignore" }); } catch { break; }
      }
      try { execSync(`kill -0 ${pid}`, { timeout: 500, stdio: "ignore" }); execSync(`kill -KILL ${pid}`, { timeout: 1000, stdio: "ignore" }); } catch {}
      console.log(`[boot] port ${port} zombie temizlendi: pid=${pid} (${comm})`);
    }
  } catch { console.log(`[boot] port ${port} temiz`); }
}
