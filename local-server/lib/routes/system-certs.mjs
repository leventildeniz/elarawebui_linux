import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

export async function mountSystemCertsRoutes(app, deps) {
  const { isAdminCaller } = deps;
  
  // Use the absolute path to the local-server/certs directory
  const certsDir = path.resolve(process.cwd(), "certs");

  app.get("/api/system/certs/config", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ok: false, error: "admin required"});
    
    // Ensure the directory exists
    try { await fs.mkdir(certsDir, { recursive: true }); } catch (e) {}

    res.json({
      ok: true,
      certsDir,
      os: os.platform(), // 'darwin' for mac, 'linux' for linux
      active: {
        certPath: path.join(certsDir, "elara.pem"),
        keyPath: path.join(certsDir, "elara-key.pem"),
        caPath: ""
      }
    });
  });

  app.post("/api/system/certs/generate", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ok: false, error: "admin required"});
    
    const { domain, san, days, trust } = req.body;
    
    try {
      await fs.mkdir(certsDir, { recursive: true });
      
      const certPath = path.join(certsDir, `${domain}.crt`);
      const keyPath = path.join(certsDir, `${domain}.key`);
      
      // Build OpenSSL command
      let sanList = (san || "").split(",").map(s => s.trim()).filter(Boolean);
      let ext = "";
      if (sanList.length > 0) {
        const formattedSan = sanList.map(s => {
          if (s.match(/^[0-9.]+$/)) return `IP:${s}`;
          return `DNS:${s}`;
        }).join(",");
        ext = `-addext "subjectAltName=${formattedSan}"`;
      }
      
      const cmd = `openssl req -x509 -newkey rsa:4096 -sha256 -days ${days || 825} -nodes -keyout "${keyPath}" -out "${certPath}" -subj "/CN=${domain}" ${ext}`;
      
      console.log(`[Certs] Generating certificate: ${cmd}`);
      await execAsync(cmd);
      
      if (trust) {
        if (os.platform() === "darwin") {
          console.log(`[Certs] Installing to macOS keychain...`);
          await execAsync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
        } else if (os.platform() === "linux") {
          console.log(`[Certs] Installing to Linux CA store...`);
          await execAsync(`sudo cp "${certPath}" /usr/local/share/ca-certificates/${domain}.crt && sudo update-ca-certificates`);
        }
      }
      
      // Overwrite the default elara.pem for the TLS Proxy to pick up
      await fs.copyFile(certPath, path.join(certsDir, "elara.pem"));
      await fs.copyFile(keyPath, path.join(certsDir, "elara-key.pem"));

      res.json({ ok: true, certPath, keyPath });
    } catch (e) {
      console.error("[Certs] Generation failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/system/certs/validate", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ok: false, error: "admin required"});
    const { certPath, keyPath } = req.body;
    try {
      await fs.access(certPath);
      await fs.access(keyPath);
      // Basic check if files are readable and valid OpenSSL keys
      await execAsync(`openssl x509 -in "${certPath}" -noout`);
      await execAsync(`openssl rsa -in "${keyPath}" -check -noout`);
      res.json({ ok: true });
    } catch (e) {
      console.error("[Certs] Validation failed:", e);
      res.json({ ok: false, error: "Invalid certificate or key" });
    }
  });

  app.post("/api/system/certs/bind", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ok: false, error: "admin required"});
    const { certPath, keyPath } = req.body;
    try {
      await fs.copyFile(certPath, path.join(certsDir, "elara.pem"));
      await fs.copyFile(keyPath, path.join(certsDir, "elara-key.pem"));
      res.json({ ok: true });
    } catch (e) {
      console.error("[Certs] Bind failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
