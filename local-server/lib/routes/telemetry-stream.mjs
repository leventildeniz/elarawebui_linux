export function mountTelemetryStreamRoute(app, pool) {
  app.get("/api/telemetry/stream", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders();

    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const { exec } = await import("node:child_process");
    const util = await import("node:util");
    const execAsync = util.promisify(exec);

    let prevCpus = os.cpus();
    let tickCount = 0;
    
    let prevNet = { rx: 0, tx: 0, ts: Date.now() };
    let prevDisk = { read: 0, write: 0, ts: Date.now() };

    const interval = setInterval(async () => {
      try {
        const cpus = os.cpus();
        const coreLoads = cpus.map((core, i) => {
          const prev = prevCpus[i];
          const totalDiff = Object.values(core.times).reduce((a,b)=>a+b, 0) - Object.values(prev.times).reduce((a,b)=>a+b, 0);
          const idleDiff = core.times.idle - prev.times.idle;
          return totalDiff === 0 ? 0 : Math.max(0, Math.round(100 - (100 * idleDiff / totalDiff)));
        });
        const avgCpu = coreLoads.reduce((a,b)=>a+b, 0) / coreLoads.length;
        prevCpus = cpus;

        const totalRamGb = os.totalmem() / (1024**3);
        const freeRamGb = os.freemem() / (1024**3);
        const usedRamGb = totalRamGb - freeRamGb;

        let dbConns = 0, dbQps = 0;
        try {
          const c = await pool.query("SELECT count(*)::int AS conns FROM pg_stat_activity");
          dbConns = c.rows[0]?.conns || 0;
        } catch(e) {}

        // OS Sensors: Network & Disk (Linux /proc interfaces fallback to 0 on Windows/Mac if unavailable)
        let netRx = 0, netTx = 0;
        let diskRead = 0, diskWrite = 0;
        const nowMs = Date.now();
        const elapsedSec = Math.max(0.1, (nowMs - prevNet.ts) / 1000);

        try {
          const netDev = await fs.readFile("/proc/net/dev", "utf8");
          let rx = 0, tx = 0;
          for (const line of netDev.split("\n").slice(2)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 9 && parts[0] !== "lo:") {
              rx += parseInt(parts[1], 10) || 0;
              tx += parseInt(parts[9], 10) || 0;
            }
          }
          if (prevNet.rx) {
            netRx = Math.max(0, Math.round(((rx - prevNet.rx) / elapsedSec) / (1024 * 1024))); // MB/s
            netTx = Math.max(0, Math.round(((tx - prevNet.tx) / elapsedSec) / (1024 * 1024))); // MB/s
          }
          prevNet = { rx, tx, ts: nowMs };
        } catch(e) {}

        try {
          const diskStats = await fs.readFile("/proc/diskstats", "utf8");
          let readSectors = 0, writeSectors = 0;
          for (const line of diskStats.split("\n")) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 14 && (parts[2].startsWith("nvme") || parts[2].startsWith("sd"))) {
              readSectors += parseInt(parts[5], 10) || 0;
              writeSectors += parseInt(parts[9], 10) || 0;
            }
          }
          if (prevDisk.read) {
             // 512 bytes per sector approx
             diskRead = Math.max(0, Math.round(((readSectors - prevDisk.read) * 512 / elapsedSec) / (1024 * 1024))); 
             diskWrite = Math.max(0, Math.round(((writeSectors - prevDisk.write) * 512 / elapsedSec) / (1024 * 1024)));
          }
          prevDisk = { read: readSectors, write: writeSectors, ts: nowMs };
        } catch(e) {}

        // OS Sensors: GPU DCGM/SMI check
        let gpu = 0, vram = 0, gpuTemp = 0;
        try {
          const { stdout } = await execAsync("nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits");
          const parts = stdout.split(",");
          if (parts.length >= 4) {
             gpu = parseInt(parts[0], 10);
             const memUsed = parseInt(parts[1], 10);
             const memTotal = parseInt(parts[2], 10) || 1;
             vram = Math.round((memUsed / memTotal) * 100);
             gpuTemp = parseInt(parts[3], 10);
          }
        } catch(e) {}

        let inventory = {
          agents: { total: 0, active: 0 },
          workflows: { total: 0, active: 0 },
          orchestrators: { total: 0, active: 0 },
          skills: { total: 0, active: 0 },
          tools: { total: 0, active: 0 },
          packs: { total: 0, active: 0 },
          mcp: { total: 0, active: 0 },
          users: { total: 0, active: 0 },
        };

        try {
          const resCounts = await pool.query(`
            SELECT
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when enabled=true and live=true then 1 end)) FROM agents WHERE id != 'agt.forge_master' AND squad != 'System' AND id NOT LIKE 'sys.%') as agents,
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when status='live' then 1 end)) FROM workflows) as workflows,
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when status='live' then 1 end)) FROM orchestrations) as orchestrations,
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when enabled=true then 1 end)) FROM skills) as skills,
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when enabled=true then 1 end)) FROM adapters) as adapters,
              (SELECT jsonb_build_object('total', count(*), 'active', count(*)) FROM capability_packs) as packs,
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when enabled=true then 1 end)) FROM mcp_clients) as mcp,
              (SELECT jsonb_build_object('total', count(*), 'active', count(case when locked=false and status='active' then 1 end)) FROM app_users) as users
          `);
          
          if (resCounts.rows.length > 0) {
            const r = resCounts.rows[0];
            inventory.agents = r.agents || inventory.agents;
            inventory.workflows = r.workflows || inventory.workflows;
            inventory.orchestrators = r.orchestrations || inventory.orchestrators;
            inventory.skills = r.skills || inventory.skills;
            inventory.tools = r.adapters || inventory.tools;
            inventory.packs = r.packs || inventory.packs;
            inventory.mcp = r.mcp || inventory.mcp;
            inventory.users = r.users || inventory.users;
          }
        } catch(e) {}

        tickCount++;

        const payload = {
          tick: tickCount,
          host: {
            cpu: Math.round(avgCpu),
            cores: coreLoads,
            gpu, vram, gpuTemp,
            ram: Number(usedRamGb.toFixed(1)),
            ramTotalGb: Number(totalRamGb.toFixed(1)),
            swap: 0,
            diskRead, diskWrite,
            netRx, netTx, netErrors: 0,
            dbConns: dbConns,
            dbPool: pool.totalCount || 10,
            dbQps: 0,
            dbLagMs: 0,
            sessions: 1,
            loadAvg: os.loadavg().map(x => Number(x.toFixed(2))),
            uptimeSec: Math.round(os.uptime()),
          },
          inventory
        };

        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) {}
    }, 2000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  });
}
