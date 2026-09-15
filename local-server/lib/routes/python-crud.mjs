import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function mountPythonRoutes(app, deps) {
  const { pool, requireSession, resolveActorContext, buildVisibility, assertCanEdit } = deps;
  const adminOnly = requireSession({ roles: ["admin", "operator", "engineer"] });

  app.post("/api/python/detect", adminOnly, async (req, res) => {
    let p = String(req.body?.path || "").trim();
    if (!p) return res.status(400).json({ ok: false, error: "path required" });
    
    // Check if the path is just an executable name without path separators
    const isCommand = !p.includes('/') && !p.includes('\\');
    
    if (!isCommand) {
      if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) return res.status(400).json({ ok: false, error: "not a file", path: p });
      } catch (e) { return res.status(404).json({ ok: false, error: String(e.message || e), path: p }); }
    }
    
    try {
      // Use "command -v" (Linux/macOS) or "where" (Windows) to resolve path if it's a command
      let resolvedPath = p;
      if (isCommand) {
        try {
          const isWin = os.platform() === 'win32';
          const { stdout } = await execAsync(`${isWin ? 'where' : 'command -v'} ${p}`, { timeout: 1000 });
          resolvedPath = stdout.trim().split('\n')[0]; // take the first result
        } catch (e) {
          return res.status(404).json({ ok: false, error: `Command '${p}' not found in PATH`, path: p });
        }
      }

      const { stdout } = await execAsync(`"${resolvedPath}" --version`, { timeout: 2500 });
      const ver = stdout.trim();
      if (!ver) return res.status(502).json({ ok: false, error: "no version banner", path: resolvedPath });
      res.json({ ok: true, path: resolvedPath, version: ver });
    } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e), path: p }); }
  });

  app.get("/api/python/runtimes", adminOnly, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const vis = typeof buildVisibility === "function" ? buildVisibility(ctx, 1, 'owner_id') : { clause: "1=1", params: [] };
      let query = `SELECT * FROM runtimes WHERE ${vis.clause} ORDER BY created_at DESC`;

      const { rows } = await pool.query(query, vis.params);
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/python/runtimes", adminOnly, async (req, res) => {
    try {
      const id = req.body?.id || `py.sandbox.${Math.random().toString(36).slice(2, 8)}`;
      const { name, version, pythonPath, venvPath, memory, egress, packages } = req.body;
      const memAuto = memory === "auto";
      const memMb = memAuto ? null : Number(memory) || 1024;
      
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const owner_id = req.body.owner_id || req.body.ownerId || ctx.userId || req.actor || null;
      const owner_name = req.body.owner_name || req.body.ownerName || ctx.actor || req.session?.username || null;
      const tenantId = req.body.tenant_id || req.body.tenantId || (ctx.isSuperAdmin ? (req.body.tenant_id || "default") : ctx.tenantId);
      const isGlobal = ctx.isSuperAdmin ? (req.body.is_global || false) : false;
      const visibility = req.body.visibility || "private";
      const sharedWith = Array.isArray(req.body.sharedWith || req.body.shared_with) ? JSON.stringify(req.body.sharedWith || req.body.shared_with) : "[]";
      
      const out = await pool.query(
        `INSERT INTO runtimes (id, name, version, python_path, venv_path, memory_mb, memory_auto, packages, egress, status, owner_id, owner_name, tenant_id, is_global, visibility, shared_with)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'idle', $10, $11, $12, $13, $14, $15::jsonb) RETURNING *`,
        [id, name, version || '', pythonPath || '', venvPath || null, memMb, memAuto, packages || '', !!egress, owner_id, owner_name, tenantId, isGlobal, visibility, sharedWith]
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/python/runtimes/:id", adminOnly, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const existing = await pool.query("SELECT * FROM runtimes WHERE id=$1", [req.params.id]);
      if (!existing.rowCount) return res.status(404).json({ ok: false, error: "not found" });
      const row = existing.rows[0];
      if (ctx && assertCanEdit) {
        assertCanEdit(ctx, row, "python runtime");
      }

      // Fallback to existing DB values for partial updates (e.g. status-only changes)
      const name = req.body.name !== undefined ? req.body.name : row.name;
      const version = req.body.version !== undefined ? req.body.version : row.version;
      const pythonPath = req.body.pythonPath !== undefined ? req.body.pythonPath : row.python_path;
      const venvPath = req.body.venvPath !== undefined ? req.body.venvPath : row.venv_path;
      const memory = req.body.memory !== undefined ? req.body.memory : (row.memory_auto ? "auto" : row.memory_mb);
      const egress = req.body.egress !== undefined ? req.body.egress : row.egress;
      const packages = req.body.packages !== undefined ? req.body.packages : row.packages;
      const status = req.body.status !== undefined ? req.body.status : row.status;

      const memAuto = memory === "auto";
      const memMb = memAuto ? null : Number(memory) || 1024;

      // --- RUNTIME ENVIRONMENT PROVISIONING ---
      // Trigger VENV setup if transitioning to running state from idle/error/stopped
      if (status === "running" && row.status !== "running" && venvPath && pythonPath) {
        // Fire and forget to prevent blocking the PUT request and causing race conditions
        (async () => {
          try {
            const isWin = os.platform() === "win32";
            const venvPy = path.join(venvPath, isWin ? "Scripts" : "bin", "python");
            const venvPip = path.join(venvPath, isWin ? "Scripts" : "bin", "pip");

            // 1. Create venv if missing
            if (!fs.existsSync(venvPy)) {
              console.log(`[python-runtime] 📦 Creating venv at ${venvPath} using ${pythonPath}...`);
              await execAsync(`"${pythonPath}" -m venv "${venvPath}"`);
            }

            // 2. Install declared packages if pip exists
            if (packages && String(packages).trim() && fs.existsSync(venvPip)) {
              console.log(`[python-runtime] ⬇️ Installing packages: ${packages}`);
              await execAsync(`"${venvPip}" install ${packages}`);
            }
            
            console.log(`[python-runtime] ✅ Sandbox ${name} is ready!`);
          } catch (setupErr) {
            console.error(`[python-runtime] ❌ Setup failed for ${name}:`, setupErr);
            await pool.query("UPDATE runtimes SET status='error', last_error=$2 WHERE id=$1", [req.params.id, String(setupErr.message || setupErr)]);
          }
        })();
      }

      const owner_id = req.body.owner_id || req.body.ownerId || ctx?.userId || req.actor || null;
      const owner_name = req.body.owner_name || req.body.ownerName || ctx?.actor || req.session?.username || null;
      const visibility = req.body?.visibility !== undefined ? req.body.visibility : row.visibility;
      const sharedWith = req.body?.sharedWith !== undefined || req.body?.shared_with !== undefined
        ? JSON.stringify(req.body?.sharedWith || req.body?.shared_with || [])
        : JSON.stringify(row.shared_with || []);

      const out = await pool.query(
        `UPDATE runtimes SET name=$2, version=$3, python_path=$4, venv_path=$5, memory_mb=$6, memory_auto=$7, packages=$8, egress=$9, status=$10, owner_id=COALESCE(runtimes.owner_id, $11), owner_name=COALESCE(runtimes.owner_name, $12), visibility=$13, shared_with=$14::jsonb, last_error=NULL
         WHERE id=$1 RETURNING *`,
        [req.params.id, name, version, pythonPath, venvPath, memMb, memAuto, packages, !!egress, status, owner_id, owner_name, visibility, sharedWith]
      );
      
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.delete("/api/python/runtimes/:id", adminOnly, async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const existing = await pool.query("SELECT * FROM runtimes WHERE id=$1", [req.params.id]);
      if (!existing.rowCount) return res.status(404).json({ ok: false, error: "not found" });
      if (ctx && assertCanEdit) {
        assertCanEdit(ctx, existing.rows[0], "python runtime");
      }
      const { rowCount } = await pool.query("DELETE FROM runtimes WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
