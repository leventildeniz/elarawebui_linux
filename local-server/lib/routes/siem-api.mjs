// lib/routes/siem-api.mjs — Enterprise SIEM Forwarder API Routes
// Handles configuration sync, live status telemetry, and real UDP/TCP/TLS network probes.

import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";
import { siem } from "../../siem-forwarder.mjs";

export async function mountSiemRoutes(app, deps) {
  const { pool, isAdminCaller, resolveActorContext } = deps;

  const requireSuperAdmin = async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isSuperAdmin = ctx?.isSuperAdmin || (req.session?.role === "admin" && (!req.session?.tenant_id || req.session?.tenant_id === "default"));
    if (!isSuperAdmin) {
      res.status(403).json({ ok: false, error: "super_admin_required" });
      return false;
    }
    return true;
  };

  // GET /api/system/config/siem_config or /api/system/siem — Load SIEM forwarder config & status
  const getSiemConfigHandler = async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT enabled, host, port, protocol, format, facility, streams, heartbeat_sec, queue_limit, updated_at FROM app_siem_config WHERE id=1"
      );
      const row = rows[0] || {};
      const status = siem.status();
      res.json({
        ok: true,
        enabled: row.enabled ?? status.enabled,
        host: row.host || status.host || "10.255.255.1",
        port: String(row.port || status.port || "514"),
        protocol: (row.protocol || status.protocol || "udp").toLowerCase(),
        format: (row.format || status.format || "cef").toLowerCase(),
        facility: row.facility || status.facility || "local0",
        streams: Array.isArray(row.streams) ? row.streams : (status.streams || []),
        heartbeatSec: row.heartbeat_sec ?? status.heartbeatSec ?? 60,
        queueLimit: row.queue_limit ?? status.queueLimit ?? 10000,
        sealedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
        status,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  };

  app.get("/api/system/config/siem_config", getSiemConfigHandler);
  app.get("/api/system/siem", getSiemConfigHandler);

  // PUT /api/system/config/siem_config or /api/system/siem — Save SIEM forwarder config
  const saveSiemConfigHandler = async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    const b = req.body || {};
    try {
      const enabled = !!b.enabled;
      const host = String(b.host || "").trim().slice(0, 255);
      const port = Math.max(1, Math.min(65535, Number(b.port) || 514));
      const protocol = String(b.protocol || "udp").trim().toLowerCase();
      const format = String(b.format || "cef").trim().toUpperCase();
      const facility = String(b.facility || "local0").trim().toLowerCase().slice(0, 32);
      const streams = Array.isArray(b.streams) ? b.streams : [];
      const heartbeatSec = Math.max(5, Math.min(3600, Number(b.heartbeatSec) || 60));
      const queueLimit = Math.max(100, Math.min(100000, Number(b.queueLimit) || 10000));

      await pool.query(
        `INSERT INTO app_siem_config (id, enabled, host, port, protocol, format, facility, streams, heartbeat_sec, queue_limit, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           host = EXCLUDED.host,
           port = EXCLUDED.port,
           protocol = EXCLUDED.protocol,
           format = EXCLUDED.format,
           facility = EXCLUDED.facility,
           streams = EXCLUDED.streams,
           heartbeat_sec = EXCLUDED.heartbeat_sec,
           queue_limit = EXCLUDED.queue_limit,
           updated_at = now()`,
        [enabled, host, port, protocol, format, facility, streams, heartbeatSec, queueLimit]
      );

      siem.applyConfig({
        enabled,
        host,
        port,
        protocol,
        format,
        facility,
        streams,
        heartbeat_sec: heartbeatSec,
        queue_limit: queueLimit,
      });

      res.json({ ok: true, message: "SIEM forwarder configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  };

  app.put("/api/system/config/siem_config", saveSiemConfigHandler);
  app.put("/api/system/siem", saveSiemConfigHandler);

  // POST /api/system/siem/test — Real network socket reachability test probe
  app.post("/api/system/siem/test", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    const cfg = req.body || {};
    const host = String(cfg.host || "").trim();
    const port = Number(cfg.port) || 514;
    const protocol = String(cfg.protocol || "udp").toLowerCase();
    const t0 = performance.now();

    if (!host || !port) {
      return res.status(400).json({ ok: false, error: "Host and port are required" });
    }

    try {
      // 1. DNS / Hostname Resolution Check
      try {
        await dns.lookup(host);
      } catch (dnsErr) {
        return res.status(400).json({
          ok: false,
          latencyMs: Math.round(performance.now() - t0),
          error: `Unresolvable SIEM host (${host}): ${dnsErr.message}`,
        });
      }

      // 2. UDP Dispatch Probe (Connectionless Syslog)
      if (protocol === "udp") {
        const sock = dgram.createSocket("udp4");
        const pingMsg = Buffer.from("<134>1 2026-05-16T00:00:00.000Z elara sovereign - siem.probe [probe@32473 status=\"test\"] ELARA Sovereign SIEM UDP Probe\n");
        await new Promise((resolve, reject) => {
          sock.send(pingMsg, port, host, (err) => {
            sock.close();
            if (err) reject(err);
            else resolve();
          });
        });
        const latencyMs = Math.round(performance.now() - t0);
        return res.json({
          ok: true,
          protocol: "udp",
          latencyMs,
          message: `UDP datagram dispatched to ${host}:${port} (${latencyMs}ms)`,
        });
      }

      // 3. TCP / TLS Real 3-Way Socket Handshake Probe
      await new Promise((resolve, reject) => {
        let timer = null;
        let socket = null;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          if (socket) socket.destroy();
        };

        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Connection timed out after 3000ms connecting to ${host}:${port}`));
        }, 3000);

        const opts = { host, port };
        socket = protocol === "tls"
          ? tls.connect({ ...opts, rejectUnauthorized: false }, () => {
              cleanup();
              resolve();
            })
          : net.connect(opts, () => {
              cleanup();
              resolve();
            });

        socket.on("error", (err) => {
          cleanup();
          reject(err);
        });
      });

      const latencyMs = Math.round(performance.now() - t0);
      return res.json({
        ok: true,
        protocol,
        latencyMs,
        message: `TCP/TLS handshake verified with ${host}:${port} (${latencyMs}ms)`,
      });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      return res.status(400).json({
        ok: false,
        protocol,
        latencyMs,
        error: `Collector unreachable (${host}:${port}): ${err.message || String(err)}`,
      });
    }
  });
}
