import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function mountFleetServicesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId } = deps;

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
    
    try {
      console.log(`[Fleet] Executing lifecycle: ${cmd}`);
      await execAsync(cmd);
      return true;
    } catch (e) {
      console.error(`[Fleet] Failed lifecycle command: ${cmd}`, e);
      throw e;
    }
  }

  app.get("/api/system/services", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT * FROM app_services ORDER BY created_at ASC");
      res.json(rows.map(s => ({
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
        online: !!s.online,
        detail: s.detail || ""
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
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
          false, ""
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
      const { rows } = await pool.query("SELECT manager, unit, sudo FROM app_services WHERE id=$1", [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "service not found" });

      const { manager, unit, sudo } = rows[0];
      await runLifecycleCommand(manager, unit, action, sudo);

      let isOnline = action !== "stop";
      let newDetail = action === "stop" ? "STOPPED · manual" : action === "restart" ? "restarted · healthy" : "RUNNING · healthy";
      
      await pool.query("UPDATE app_services SET online=$1, detail=$2, updated_at=now() WHERE id=$3", [isOnline, newDetail, id]);
      
      res.json({ ok: true, online: isOnline, detail: newDetail });
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
      // We removed the hacked lifecycle checking here because
      // UI now calls the /control endpoint to run systemctl.
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
