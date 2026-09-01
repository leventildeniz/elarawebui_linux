import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function mountPythonRoutes(app, deps) {
  const { pool, requireSession } = deps;
  const adminOnly = requireSession({ roles: ["admin", "operator"] });

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
      const { rows } = await pool.query("SELECT * FROM runtimes ORDER BY created_at DESC");
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/python/runtimes", adminOnly, async (req, res) => {
    try {
      const { id, name, version, pythonPath, venvPath, memory, egress, packages } = req.body;
      const memAuto = memory === "auto";
      const memMb = memAuto ? null : Number(memory) || 1024;
      
      const ctx = await deps.resolveActorContext(req);
      const owner_id = req.body.owner_id || req.body.ownerId || ctx.userId || req.actor || null;
      const owner_name = req.body.owner_name || req.body.ownerName || ctx.actor || req.session?.username || null;
      
      const out = await pool.query(
        `INSERT INTO runtimes (id, name, version, python_path, venv_path, memory_mb, memory_auto, packages, egress, status, owner_id, owner_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'idle', $10, $11) RETURNING *`,
        [id, name, version || '', pythonPath || '', venvPath || null, memMb, memAuto, packages || '', !!egress, owner_id, owner_name]
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/python/runtimes/:id", adminOnly, async (req, res) => {
    try {
      const existing = await pool.query("SELECT * FROM runtimes WHERE id=$1", [req.params.id]);
      if (!existing.rowCount) return res.status(404).json({ error: "not found" });
      const row = existing.rows[0];

      // Front-end'den (Zustand üzerinden) tüm model objesi geldiği için
      // SADECE eksik gönderilen (örneğin sadece status güncelleniyorsa) verileri DB'den devralalım.
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

      // --- GERÇEK ÇALIŞMA ZAMANI (RUNTIME) KURULUMU ---
      // Eğer durum "running" yapılıyorsa ve daha önce idle/error/stopped ise, VENV kurulumunu tetikle
      if (status === "running" && row.status !== "running" && venvPath && pythonPath) {
        // Fire and forget to prevent blocking the PUT request and causing race conditions
        (async () => {
          try {
            const isWin = os.platform() === "win32";
            const venvPy = path.join(venvPath, isWin ? "Scripts" : "bin", "python");
            const venvPip = path.join(venvPath, isWin ? "Scripts" : "bin", "pip");

            // 1. Venv yoksa oluştur
            if (!fs.existsSync(venvPy)) {
              console.log(`[python-runtime] 📦 Creating venv at ${venvPath} using ${pythonPath}...`);
              await execAsync(`"${pythonPath}" -m venv "${venvPath}"`);
            }

            // 2. Paketler tanımlıysa kur (eğer pip mevcutsa)
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

      const ctx = await deps.resolveActorContext(req);
      const owner_id = req.body.owner_id || req.body.ownerId || ctx.userId || req.actor || null;
      const owner_name = req.body.owner_name || req.body.ownerName || ctx.actor || req.session?.username || null;

      const out = await pool.query(
        `UPDATE runtimes SET name=$2, version=$3, python_path=$4, venv_path=$5, memory_mb=$6, memory_auto=$7, packages=$8, egress=$9, status=$10, owner_id=COALESCE(runtimes.owner_id, $11), owner_name=COALESCE(runtimes.owner_name, $12), last_error=NULL
         WHERE id=$1 RETURNING *`,
        [req.params.id, name, version, pythonPath, venvPath, memMb, memAuto, packages, !!egress, status, owner_id, owner_name]
      );
      
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/python/runtimes/:id", adminOnly, async (req, res) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM runtimes WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
