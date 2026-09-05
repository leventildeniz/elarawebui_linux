// local-server/lib/routes/fleet-services.mjs
// Background Services Tower — Real-Time Probing & Lifecycle Management

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function mountFleetServicesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId } = deps;

  // Real-time live status prober for any service definition
  async function probeService(s) {
    let isOnline = false;
    let detail = "OFFLINE · inactive";

    // 1. Postgres Database Service Check
    if (s.key === "postgres" || s.kind === "Postgres" || s.probe?.startsWith("postgres://")) {
      try {
        await pool.query("SELECT 1");
        isOnline = true;
        detail = "ONLINE · healthy";
        return { isOnline, detail };
      } catch (err) {
        return { isOnline: false, detail: "OFFLINE · connection refused" };
      }
    }

    // 2. Systemd Service Unit Check (Linux)
    if (s.manager === "systemd" && s.unit) {
      try {
        const { stdout } = await execAsync(`systemctl is-active ${s.unit}`, { timeout: 1500 });
        const state = (stdout || "").trim().toLowerCase();
        if (state === "active") {
          isOnline = true;
          detail = "ONLINE · RUNNING · healthy";
        } else if (state === "failed") {
          isOnline = false;
          detail = "OFFLINE · failed";
        } else {
          isOnline = false;
          detail = `OFFLINE · ${state}`;
        }
      } catch (err) {
        const state = (err?.stdout || err?.stderr || "inactive").trim().toLowerCase();
        isOnline = state === "active";
        detail = isOnline ? "ONLINE · RUNNING · healthy" : `OFFLINE · ${state}`;
      }
      return { isOnline, detail };
    }

    // 3. Launchd Service Unit Check (macOS)
    if (s.manager === "launchd" && s.unit) {
      try {
        const { stdout } = await execAsync(`launchctl list ${s.unit}`, { timeout: 1500 });
        if (stdout && !stdout.includes("Could not find")) {
          isOnline = true;
          detail = "ONLINE · RUNNING · healthy";
        } else {
          isOnline = false;
          detail = "OFFLINE · inactive";
        }
      } catch {
        isOnline = false;
        detail = "OFFLINE · inactive";
      }
      return { isOnline, detail };
    }

    // 4. HTTP / REST Probe
    if (s.probe?.startsWith("http://") || s.probe?.startsWith("https://")) {
      try {
        const r = await fetch(s.probe, { signal: AbortSignal.timeout(1200) });
        isOnline = r.ok;
        detail = r.ok ? `ONLINE · HTTP ${r.status}` : `OFFLINE · HTTP ${r.status}`;
      } catch {
        isOnline = false;
        detail = "OFFLINE · unreachable";
      }
      return { isOnline, detail };
    }

    return { isOnline: !!s.online, detail: s.detail || "OFFLINE" };
  }

  // Helper to run actual OS lifecycle commands
  async function runLifecycleCommand(manager, unit, action, sudo) {
    if (!unit) return;
    let cmd = "";
    
    if (manager === "systemd") {
      cmd = `systemctl ${action} ${unit}`;
    } else if (manager === "launchd") {
      if (action === "start") cmd = `launchctl load -w ${unit}`;
      else if (action === "stop") cmd = `launchctl unload -w ${unit}`;
      else if (action === "restart") cmd = `launchctl unload ${unit} && launchctl load -w ${unit}`;
    }
    
    if (!cmd) return;
    if (sudo) cmd = `sudo ${cmd}`;
    
    console.log(`[Fleet] Executing lifecycle: ${cmd}`);
    await execAsync(cmd, { timeout: 10000 });
    return true;
  }

  app.get("/api/system/services", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT * FROM app_services ORDER BY created_at ASC");
      
      // Probe all services in parallel for real-time live accuracy
      const liveServices = await Promise.all(
        rows.map(async (s) => {
          const { isOnline, detail } = await probeService(s);
          
          // Asynchronously update DB cache if changed
          if (s.online !== isOnline || s.detail !== detail) {
            pool.query("UPDATE app_services SET online=$1, detail=$2, updated_at=now() WHERE id=$3", [isOnline, detail, s.id]).catch(() => {});
          }

          return {
            id: s.id,
            key: s.key,
            name: s.name,
            kind: s.kind,
            probe: s.probe,
            username: s.username || "",
            credential: s.credential || "",
            manager: s.manager,
            unit: s.unit || "",
            sudo: !!s.sudo,
            transport: s.transport,
            host: s.host || "",
            startCmd: s.start_cmd || "",
            stopCmd: s.stop_cmd || "",
            restartCmd: s.restart_cmd || "",
            statusCmd: s.status_cmd || "",
            online: isOnline,
            detail: detail
          };
        })
      );

      res.json(liveServices);
    } catch (e) { 
      res.status(500).json({ ok: false, error: String(e.message || e) }); 
    }
  });

  app.post("/api/system/services", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.body.id || createPrefixedId("svc.");
    const s = req.body;
    try {
      await pool.query(
        `INSERT INTO app_services 
         (id, key, name, kind, probe, username, credential, manager, unit, sudo, transport, host, start_cmd, stop_cmd, restart_cmd, status_cmd, online, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          id, s.key || id, s.name, s.kind, s.probe, s.username || "", s.credential || "",
          s.manager || "custom", s.unit || "", !!s.sudo, s.transport || "local-agent",
          s.host || "", s.startCmd || "", s.stopCmd || "", s.restartCmd || "", s.statusCmd || "",
          false, "PENDING · not probed yet"
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/system/services/:id/control", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const { action } = req.body;
    
    if (!["start", "stop", "restart"].includes(action)) {
      return res.status(400).json({ ok: false, error: "invalid action" });
    }

    try {
      const { rows } = await pool.query("SELECT * FROM app_services WHERE id=$1", [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "service not found" });

      const s = rows[0];
      await runLifecycleCommand(s.manager, s.unit, action, s.sudo);

      // Probe live result after lifecycle action
      await new Promise((r) => setTimeout(r, 600));
      const { isOnline, detail } = await probeService(s);
      
      await pool.query("UPDATE app_services SET online=$1, detail=$2, updated_at=now() WHERE id=$3", [isOnline, detail, id]);
      
      res.json({ ok: true, online: isOnline, detail });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/system/services/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const s = req.body;
    const updates = [];
    const values = [];
    let i = 1;

    if (s.name !== undefined) { updates.push(`name=$${i++}`); values.push(s.name); }
    if (s.kind !== undefined) { updates.push(`kind=$${i++}`); values.push(s.kind); }
    if (s.probe !== undefined) { updates.push(`probe=$${i++}`); values.push(s.probe); }
    if (s.username !== undefined) { updates.push(`username=$${i++}`); values.push(s.username); }
    if (s.credential !== undefined) { updates.push(`credential=$${i++}`); values.push(s.credential); }
    if (s.manager !== undefined) { updates.push(`manager=$${i++}`); values.push(s.manager); }
    if (s.unit !== undefined) { updates.push(`unit=$${i++}`); values.push(s.unit); }
    if (s.sudo !== undefined) { updates.push(`sudo=$${i++}`); values.push(s.sudo); }
    if (s.transport !== undefined) { updates.push(`transport=$${i++}`); values.push(s.transport); }
    if (s.host !== undefined) { updates.push(`host=$${i++}`); values.push(s.host); }
    if (s.startCmd !== undefined) { updates.push(`start_cmd=$${i++}`); values.push(s.startCmd); }
    if (s.stopCmd !== undefined) { updates.push(`stop_cmd=$${i++}`); values.push(s.stopCmd); }
    if (s.restartCmd !== undefined) { updates.push(`restart_cmd=$${i++}`); values.push(s.restartCmd); }
    if (s.statusCmd !== undefined) { updates.push(`status_cmd=$${i++}`); values.push(s.statusCmd); }
    if (s.online !== undefined) { updates.push(`online=$${i++}`); values.push(s.online); }
    if (s.detail !== undefined) { updates.push(`detail=$${i++}`); values.push(s.detail); }

    if (updates.length > 0) {
      updates.push(`updated_at=now()`);
      values.push(id);
      try {
        await pool.query(`UPDATE app_services SET ${updates.join(", ")} WHERE id=$${i}`, values);
        res.json({ ok: true });
      } catch (e) { 
        res.status(500).json({ ok: false, error: String(e.message || e) }); 
      }
    } else {
      res.json({ ok: true });
    }
  });

  app.delete("/api/system/services/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query("DELETE FROM app_services WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
