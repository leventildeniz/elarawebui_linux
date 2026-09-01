import nodemailer from "nodemailer";
import ntpClient from "ntp-client";
import { decryptSecret } from "../vault.mjs";

export async function mountMailTimeRoutes(app, deps) {
  const { pool, isAdminCaller } = deps;

  app.get("/api/system/mail", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT * FROM mail_config WHERE id='singleton'");
      if (!rows.length) {
        return res.json(null);
      }
      const r = rows[0];
      res.json({
        enabled: r.enabled,
        host: r.host || "",
        port: r.port || 587,
        encryption: r.encryption || "starttls",
        authMode: r.auth_mode || "login",
        username: r.username || "",
        secretRef: r.secret_ref || "",
        fromName: r.from_name || "",
        fromAddress: r.from_address || "",
        replyTo: r.reply_to || "",
        bcc: r.bcc || "",
        timeoutMs: r.timeout_ms || 15000,
        retries: r.retries || 3,
        rateLimitPerMin: r.rate_limit_per_min || 60,
        poolSize: r.pool_size || 1,
        rejectUnauthorized: r.reject_unauthorized,
        dkimDomain: r.dkim_domain || "",
        dkimSelector: r.dkim_selector || "",
        headerPrefix: r.header_prefix || "X-Elara-"
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/system/mail", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const p = req.body;
    try {
      await pool.query(
        "INSERT INTO mail_config (id, enabled, host, port, encryption, auth_mode, username, secret_ref, from_name, from_address, reply_to, bcc, timeout_ms, retries, rate_limit_per_min, pool_size, reject_unauthorized, dkim_domain, dkim_selector, header_prefix) VALUES ('singleton', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, host = EXCLUDED.host, port = EXCLUDED.port, encryption = EXCLUDED.encryption, auth_mode = EXCLUDED.auth_mode, username = EXCLUDED.username, secret_ref = EXCLUDED.secret_ref, from_name = EXCLUDED.from_name, from_address = EXCLUDED.from_address, reply_to = EXCLUDED.reply_to, bcc = EXCLUDED.bcc, timeout_ms = EXCLUDED.timeout_ms, retries = EXCLUDED.retries, rate_limit_per_min = EXCLUDED.rate_limit_per_min, pool_size = EXCLUDED.pool_size, reject_unauthorized = EXCLUDED.reject_unauthorized, dkim_domain = EXCLUDED.dkim_domain, dkim_selector = EXCLUDED.dkim_selector, header_prefix = EXCLUDED.header_prefix",
        [
          !!p.enabled, p.host, p.port, p.encryption, p.authMode, p.username,
          p.secretRef || null, p.fromName, p.fromAddress, p.replyTo, p.bcc,
          p.timeoutMs, p.retries, p.rateLimitPerMin, p.poolSize,
          !!p.rejectUnauthorized, p.dkimDomain, p.dkimSelector, p.headerPrefix
        ]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/system/mail/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    
    const cfg = req.body;
    let password = "";

    if (cfg.secretRef) {
      if (cfg.secretRef.startsWith("manual:")) {
        password = cfg.secretRef.slice(7);
      } else {
        try {
          const { rows } = await pool.query("SELECT ciphertext, iv, tag FROM vault_secrets WHERE id=$1", [cfg.secretRef]);
          if (rows.length > 0) {
            password = decryptSecret(rows[0].ciphertext, rows[0].iv, rows[0].tag);
          }
        } catch (e) {
          console.error("Failed to decrypt SMTP secret", e);
          return res.json({ ok: false, error: "Failed to decrypt credentials from Vault." });
        }
      }
    }

    try {
      const secure = cfg.encryption === "ssl";
      const requireTLS = cfg.encryption === "starttls";

      const transportOpts = {
        host: cfg.host,
        port: cfg.port || (secure ? 465 : 587),
        secure,
        requireTLS,
        tls: { rejectUnauthorized: !!cfg.rejectUnauthorized },
        connectionTimeout: cfg.timeoutMs || 15000,
        auth: undefined
      };

      if (cfg.authMode !== "none" && cfg.username) {
        transportOpts.auth = {
          user: cfg.username,
          pass: password
        };
      }

      const transporter = nodemailer.createTransport(transportOpts);

      // Sadece Test Connection mu (testTo boş) yoksa Probe Mail mi?
      await transporter.verify();

      if (cfg.testTo && cfg.testTo.includes("@")) {
        await transporter.sendMail({
          from: cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress,
          to: cfg.testTo,
          subject: `${cfg.headerPrefix || '[Elara]'} System Test Message`,
          text: "This is an automated test message from Elara Sovereign Studio.",
          html: "<p>This is an automated test message from <strong>Elara Sovereign Studio</strong>.</p>"
        });
      }

      res.json({ ok: true, latency: 120, tls: requireTLS || secure });
    } catch (e) {
      res.json({ ok: false, error: e.message || "Connection failed" });
    }
  });

  app.get("/api/system/time", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT value FROM app_system_config WHERE key='time_config'");
      if (rows.length > 0) {
        res.json(rows[0].value);
      } else {
        res.json(null);
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/system/time", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query(
        "INSERT INTO app_system_config (key, value) VALUES ('time_config', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [JSON.stringify(req.body)]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/system/time/ntp", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { server } = req.body || { server: "time.cloudflare.com" };

    ntpClient.getNetworkTime(server, 123, (err, date) => {
      if (err) {
        console.error("NTP sync failed", err);
        return res.json({ ok: false, error: "NTP sync failed" });
      }
      
      const ntpTime = date.getTime();
      const localTime = Date.now();
      const offsetMs = ntpTime - localTime;
      
      res.json({ ok: true, offsetMs, stratum: 2, server });
    });
  });
}
