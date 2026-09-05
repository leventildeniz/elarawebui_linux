// Metrics + hardware sampler subsystem (extracted from server.mjs, T-2026-05-30).
// Owns: macOS hardware probes, hallucination tracker, embed queue cache,
// metrics frame builder + cache + SSE stream + history ring + debug endpoint.
import os from "node:os";
import { execFile } from "node:child_process";

export function installMetrics({ app, pool, sseBegin, execAsync }) {
  const IS_DARWIN = os.platform() === "darwin";

  async function sysctl(key) {
    const out = await execAsync("/usr/sbin/sysctl", ["-n", key]);
    return out.trim();
  }

  let HW_INFO_CACHE = null;
  async function probeHardwareInfo() {
    if (HW_INFO_CACHE) return HW_INFO_CACHE;
    const totalRamBytes = os.totalmem();
    const cpuCores = Math.max(1, os.cpus().length);
    let model = (os.cpus()[0]?.model || "Unknown CPU");
    let perfCores = 0, effCores = 0, gpuCores = 0, brand = "", machine = (os.machine && os.machine()) || "";
    if (IS_DARWIN) {
      const [b, p, e, m, ioreg] = await Promise.all([
        sysctl("machdep.cpu.brand_string"),
        sysctl("hw.perflevel0.physicalcpu"),
        sysctl("hw.perflevel1.physicalcpu"),
        sysctl("hw.model"),
        execAsync("/bin/sh", ["-c", "/usr/sbin/ioreg -l | /usr/bin/grep -E 'gpu-core-count|GPUCoreCount' | /usr/bin/head -1 | /usr/bin/awk -F'=' '{print $2}' | /usr/bin/tr -d ' '"], 1500),
      ]);
      if (b) { brand = b; model = b; }
      if (p) perfCores = Number(p) || 0;
      if (e) effCores = Number(e) || 0;
      if (m) machine = m;
      const g = parseInt(ioreg.trim(), 10);
      if (Number.isFinite(g) && g > 0) gpuCores = g;
    }
    HW_INFO_CACHE = {
      platform: os.platform(), arch: os.arch(), hostname: os.hostname(),
      model: model || brand || "Unknown", machine,
      cpuCores, cpuPerformance: perfCores, cpuEfficiency: effCores, gpuCores,
      totalRamBytes,
      totalRamGb: Math.round(totalRamBytes / 1024 / 1024 / 1024),
      pageSizeBytes: 16384,
    };
    return HW_INFO_CACHE;
  }

  async function sampleMacRam(pageSize) {
    const out = await execAsync("/usr/bin/vm_stat", [], 1200);
    if (!out) return null;
    const m = {};
    for (const line of out.split("\n")) {
      const mt = line.match(/^"?(.+?)"?:\s+(\d+)\.?$/);
      if (mt) m[mt[1].trim()] = Number(mt[2]);
    }
    const active     = (m["Pages active"] || 0) * pageSize;
    const wired      = (m["Pages wired down"] || 0) * pageSize;
    const compressed = (m["Pages occupied by compressor"] || 0) * pageSize;
    const used = active + wired + compressed;
    if (used <= 0) return null;
    return { usedBytes: used, activeBytes: active, wiredBytes: wired, compressedBytes: compressed };
  }

  async function sampleMacCpu() {
    const out = await execAsync("/usr/bin/top", ["-l", "1", "-n", "0"], 1500);
    if (!out) return null;
    const line = out.split("\n").find(l => l.includes("CPU usage"));
    if (!line) return null;
    const u = /([\d.]+)%\s*user/.exec(line)?.[1];
    const s = /([\d.]+)%\s*sys/.exec(line)?.[1];
    if (u == null || s == null) return null;
    const user = Number(u), sys = Number(s);
    return { user, sys, total: Math.max(0, Math.min(100, user + sys)) };
  }

  let GPU_FAILED = false;
  let GPU_FAILED_REASON = null;
  async function sampleMacGpu() {
    if (GPU_FAILED) return null;
    const out = await execAsync("/usr/bin/powermetrics", ["--samplers", "gpu_power", "-i", "200", "-n", "1"], 1200);
    if (!out) { GPU_FAILED = true; GPU_FAILED_REASON = "root_required"; return null; }
    const m = /GPU Active residency:\s+([\d.]+)%/.exec(out);
    if (!m) { GPU_FAILED = true; GPU_FAILED_REASON = "parse_failed"; return null; }
    return { active: Number(m[1]) };
  }

  async function sampleMlxRss() {
    const out = await execAsync("/bin/sh", ["-c", "/bin/ps -axo rss=,command= | /usr/bin/awk 'tolower($0) ~ /mlx|lm_studio|legacy/ { rss+=$1 } END { print rss+0 }'"], 1500);
    const kb = Number(String(out).trim()) || 0;
    if (kb <= 0) return null;
    return kb * 1024;
  }

  let LAST_FRAME = null;
  let metricsInFlight = null;
  const METRICS_HISTORY = [];
  const METRICS_HISTORY_MAX = 720;
  function pushMetricsHistory(frame) {
    if (!frame) return;
    METRICS_HISTORY.push(frame);
    if (METRICS_HISTORY.length > METRICS_HISTORY_MAX) METRICS_HISTORY.shift();
  }

  // --- Hallucination tracker (in-memory rolling window) ---
  const RECENT_CHATS = [];
  const RECENT_CHATS_MAX = 40;
  const HEDGE_PATTERNS = /\b(bilmiyorum|emin değilim|tahmin|sanırım|olabilir|bildiğim kadar|kesin değil|i don'?t know|not sure|might be|i think)\b/i;
  function recordChatSample(sample) {
    RECENT_CHATS.push({ ...sample, ts: Date.now() });
    if (RECENT_CHATS.length > RECENT_CHATS_MAX) RECENT_CHATS.shift();
  }
  function computeHallucinationPct() {
    if (RECENT_CHATS.length === 0) return 0;
    let score = 0;
    for (const c of RECENT_CHATS) {
      let s = 0;
      if (!c.ragUsed) s += 1.5;
      if (c.hedged) s += 1.0;
      score += Math.min(s, 2.0);
    }
    return Math.min(100, Math.round((score / (RECENT_CHATS.length * 2)) * 100));
  }
  function computeLiveLatencyMs() {
    if (RECENT_CHATS.length === 0) return 0;
    const lats = RECENT_CHATS.map((c) => Number(c.latencyMs)).filter((n) => Number.isFinite(n) && n >= 0);
    if (lats.length === 0) return 0;
    const sum = lats.reduce((a, b) => a + b, 0);
    return Math.round(sum / lats.length);
  }
  function computeLiveTps() {
    if (RECENT_CHATS.length === 0) return 0;
    const cutoff = Date.now() - 60_000;
    const recent = RECENT_CHATS.filter((c) => Number(c.ts || 0) >= cutoff).length;
    return +(recent / 60).toFixed(2);
  }

  // Embed pending queue (5s cache).
  let _embedQueueCache = { ts: 0, value: 0 };
  async function computeEmbedPendingQueue() {
    const now = Date.now();
    if (now - _embedQueueCache.ts < 5000) return _embedQueueCache.value;
    try {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM knowledge_chunks WHERE embedding_status = 'pending'"
      );
      _embedQueueCache = { ts: now, value: Number(rows?.[0]?.n || 0) };
    } catch {
      _embedQueueCache = { ts: now, value: 0 };
    }
    return _embedQueueCache.value;
  }

  async function buildMetricsFrame() {
    try {
      const info = await probeHardwareInfo();
      let cpuPct = null, ramPct = null, ramUsedGb = null, mlxPct = null, mlxUsedGb = null, gpuPct = null;
      if (IS_DARWIN) {
        const [cpu, ram, gpu, mlx] = await Promise.all([
          sampleMacCpu(), sampleMacRam(info.pageSizeBytes), sampleMacGpu(), sampleMlxRss(),
        ]);
        if (cpu) cpuPct = +cpu.total.toFixed(1);
        if (ram && info.totalRamBytes > 0) {
          ramUsedGb = +(ram.usedBytes / 1024 / 1024 / 1024).toFixed(2);
          ramPct = +((ram.usedBytes / info.totalRamBytes) * 100).toFixed(1);
        }
        if (gpu) gpuPct = +gpu.active.toFixed(1);
        if (typeof mlx === "number" && info.totalRamBytes > 0) {
          mlxUsedGb = +(mlx / 1024 / 1024 / 1024).toFixed(2);
          mlxPct = +((mlx / info.totalRamBytes) * 100).toFixed(1);
        }
      } else {
        const totalMem = os.totalmem() || 0;
        const freeMem = os.freemem() || 0;
        if (totalMem > 0) {
          ramPct = +(((totalMem - freeMem) / totalMem) * 100).toFixed(1);
          ramUsedGb = +(((totalMem - freeMem) / 1024 / 1024 / 1024)).toFixed(2);
        }
        const load = os.loadavg()[0];
        if (Number.isFinite(load) && info.cpuCores > 0) {
          cpuPct = Math.min(100, +((load / info.cpuCores) * 100).toFixed(1));
        }
      }
      let agentTelemetry = [];
      try {
        const { rows } = await pool.query(
          "SELECT id, name, status, last_active, calls, success, meta FROM agents WHERE id != 'agt.forge_master' AND squad != 'System' AND id NOT LIKE 'sys.%' ORDER BY name ASC"
        );
        const now = Date.now();
        agentTelemetry = rows.map((r) => {
          const lastMs = r.last_active ? new Date(r.last_active).getTime() : 0;
          const ageSec = lastMs ? Math.round((now - lastMs) / 1000) : null;
          const tps = ageSec !== null && ageSec < 60 ? Math.max(0, Number(r.calls || 0) / Math.max(ageSec, 1)) : 0;
          const calls = Number(r.calls || 0);
          const success = Number(r.success || 0);
          const errors = Math.max(0, calls - success);
          const meta = (r.meta && typeof r.meta === "object") ? r.meta : {};
          const runMs = Number.isFinite(Number(meta.lastRunMs)) ? Number(meta.lastRunMs) : 0;
          const stalenessMs = ageSec !== null ? ageSec * 1000 : null;
          const isLive = stalenessMs !== null && stalenessMs < 5 * 60 * 1000;
          const isArmed = ["active", "armed"].includes(String(r.status || "").toLowerCase());
          return {
            id: r.name || r.id,
            tps: +tps.toFixed(2),
            latency: runMs,
            staleness: stalenessMs,
            last_active: r.last_active || null,
            last_run_ok: meta.lastRunOk ?? null,
            errors,
            status: r.status || "idle",
            armed: isArmed,
            live: isLive,
          };
        });
      } catch { /* table may be cold */ }

      const frame = {
        ts: Date.now(),
        cpu: cpuPct, ram: ramPct, ramUsedGb, ramTotalGb: info.totalRamGb,
        gpu: gpuPct, local: mlxPct, mlxUsedGb,
        gpuUnavailableReason: gpuPct == null ? (GPU_FAILED_REASON || (IS_DARWIN ? "unavailable" : "non_darwin")) : null,
        tps: computeLiveTps(),
        queue: await computeEmbedPendingQueue(),
        latency: computeLiveLatencyMs(),
        agents: agentTelemetry,
        hallucination: computeHallucinationPct(),
        hardware: {
          model: info.model, machine: info.machine,
          cpuCores: info.cpuCores, cpuPerformance: info.cpuPerformance, cpuEfficiency: info.cpuEfficiency,
          gpuCores: info.gpuCores, totalRamGb: info.totalRamGb,
        },
      };
      LAST_FRAME = frame;
      pushMetricsHistory(frame);
      return frame;
    } catch (e) {
      console.warn("[metrics] frame build failed:", e?.message || e);
      const fallback = {
        ts: Date.now(),
        cpu: null, ram: null, ramUsedGb: null, ramTotalGb: null,
        gpu: null, local: null, mlxUsedGb: null,
        gpuUnavailableReason: "frame_error",
        tps: 0, queue: 0, latency: 0,
        agents: [], hallucination: 0,
        hardware: null,
        error: String(e?.message || e),
      };
      LAST_FRAME = fallback;
      return fallback;
    }
  }

  async function getMetricsFrame(maxAgeMs = 1000) {
    if (LAST_FRAME && Date.now() - Number(LAST_FRAME.ts || 0) < maxAgeMs) return LAST_FRAME;
    if (metricsInFlight) return metricsInFlight;
    metricsInFlight = buildMetricsFrame().finally(() => { metricsInFlight = null; });
    return metricsInFlight;
  }

  // --- Routes ---
  app.get("/api/system/info", async (_req, res) => {
    try { res.json(await probeHardwareInfo()); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/metrics/snapshot", async (_req, res) => {
    try { res.json(await getMetricsFrame(1000)); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/metrics/history", (req, res) => {
    const minutes = Math.max(1, Math.min(30, Number(req.query.minutes) || 10));
    const cutoff = Date.now() - minutes * 60_000;
    res.json(METRICS_HISTORY.filter(f => Number(f?.ts || 0) >= cutoff));
  });

  app.get("/api/metrics/debug", async (_req, res) => {
    const out = { ts: new Date().toISOString(), isDarwin: IS_DARWIN,
      platform: os.platform(), arch: os.arch(), node: process.version,
      env: { USER: process.env.USER || null, HOME: process.env.HOME || null, PATH: process.env.PATH || null } };
    try { out.hwInfo = await probeHardwareInfo(); } catch (e) { out.hwInfo = { error: String(e?.message || e) }; }
    const time = async (fn) => { const t0 = Date.now();
      try { const v = await fn(); return { ms: Date.now() - t0, ok: true, value: v ?? null }; }
      catch (e) { return { ms: Date.now() - t0, ok: false, error: String(e?.message || e) }; } };
    const rawExec = async (cmd, args, timeoutMs = 1500) => new Promise((resolve) => {
      const t0 = Date.now();
      execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ms: Date.now() - t0, ok: !err, code: err?.code ?? null,
          signal: err?.signal ?? null, error: err ? String(err.message || err) : null,
          stdout: String(stdout || "").slice(0, 4000), stderr: String(stderr || "").slice(0, 2000) });
      });
    });
    out.raw = {
      top:          await rawExec("/usr/bin/top", ["-l", "1", "-n", "0"], 1500),
      vm_stat:      await rawExec("/usr/bin/vm_stat", [], 1200),
      powermetrics: await rawExec("/usr/bin/powermetrics", ["--samplers", "gpu_power", "-i", "200", "-n", "1"], 1500),
      mlx_ps:       await rawExec("/bin/sh", ["-c", "/bin/ps -axo rss=,command= | /usr/bin/awk 'tolower($0) ~ /mlx|lm_studio|legacy/ { rss+=$1 } END { print rss+0 }'"], 1500),
    };
    out.parsed = {
      cpu: await time(() => sampleMacCpu()),
      ram: await time(async () => sampleMacRam((await probeHardwareInfo()).pageSizeBytes)),
      gpu: await time(() => sampleMacGpu()),
      local: await time(() => sampleMlxRss()),
    };
    out.gpuFailedSticky = GPU_FAILED;
    try {
      const q = await pool.query("SELECT id, name, status, last_active, calls, success FROM agents WHERE id != 'agt.forge_master' AND squad != 'System' AND id NOT LIKE 'sys.%' ORDER BY name ASC");
      out.agentsQuery = {
        ok: true, rowCount: q.rowCount,
        withLastActive: q.rows.filter(r => r.last_active).length,
        byStatus: q.rows.reduce((m, r) => ((m[r.status || "null"] = (m[r.status || "null"] || 0) + 1), m), {}),
        sample: q.rows.slice(0, 6).map(r => ({ name: r.name, status: r.status, last_active: r.last_active, calls: r.calls, success: r.success })),
      };
    } catch (e) { out.agentsQuery = { ok: false, error: String(e?.message || e) }; }
    out.lastFrame = LAST_FRAME;
    res.json(out);
  });

  const METRICS_TICK_MS = Math.max(1000, Number(process.env.METRICS_TICK_MS) || 5000);
  void buildMetricsFrame().catch(() => {});
  setInterval(() => { void getMetricsFrame(METRICS_TICK_MS).catch(() => {}); }, METRICS_TICK_MS).unref?.();

  app.get("/api/metrics/stream", (req, res) => {
    const sse = sseBegin(req, res);
    let alive = true;
    (async () => {
      if (!alive) return;
      try {
        const frame = LAST_FRAME ?? await getMetricsFrame(0);
        if (alive) sse.send(frame);
      } catch {
        const totalGb = Math.round(os.totalmem() / 1024 / 1024 / 1024);
        sse.send({
          ts: Date.now(),
          cpu: null, ram: null, ramUsedGb: null, ramTotalGb: totalGb,
          gpu: null, local: null, mlxUsedGb: null,
          tps: 0, queue: 0, latency: 0, agents: [], hallucination: 0,
          hardware: null, _initial: true,
        });
      }
    })();
    const tick = async () => {
      if (!alive) return;
      try {
        const frame = await getMetricsFrame(METRICS_TICK_MS);
        sse.send(frame);
      } catch { /* skip frame */ }
    };
    const id = setInterval(() => { void tick(); }, METRICS_TICK_MS);
    req.on("close", () => { alive = false; clearInterval(id); });
  });

  return {
    recordChatSample, HEDGE_PATTERNS,
    getMetricsFrame, buildMetricsFrame, probeHardwareInfo,
  };
}
