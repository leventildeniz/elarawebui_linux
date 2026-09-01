// Sovereign SIEM forwarder.
// Real UDP / TCP / TLS syslog with CEF / LEEF / JSON / RFC5424 formatters.
// Bounded in-memory queue (8k events) with backpressure drop + counter.
// Singleton config is loaded from app_siem_config and refreshed every 30s.

import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import os from "node:os";

const HOSTNAME = os.hostname();
const APP_NAME = "sovereign";

const FACILITY_MAP = {
  kern: 0, user: 1, mail: 2, daemon: 3, auth: 4, syslog: 5,
  lpr: 6, news: 7, uucp: 8, cron: 9, authpriv: 10, ftp: 11,
  local0: 16, local1: 17, local2: 18, local3: 19,
  local4: 20, local5: 21, local6: 22, local7: 23,
};
const SEVERITY_MAP = {
  debug: 7, info: 6, notice: 5, warn: 4, warning: 4,
  error: 3, err: 3, crit: 2, alert: 1, emerg: 0,
};

function pri(facility, severityLabel) {
  const f = FACILITY_MAP[String(facility || "local0").toLowerCase()] ?? 16;
  const s = SEVERITY_MAP[String(severityLabel || "info").toLowerCase()] ?? 6;
  return f * 8 + s;
}

function escapeCef(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r?\n/g, " ");
}
function escapeLeef(v) {
  return String(v ?? "").replace(/\|/g, "_").replace(/\r?\n/g, " ");
}

export function formatEvent(ev, format, facility) {
  const ts = ev.ts ? new Date(ev.ts) : new Date();
  const sev = ev.severity || "info";
  const sevNum = SEVERITY_MAP[String(sev).toLowerCase()] ?? 6;
  const name = ev.name || ev.action || "event";
  const msg = ev.message || JSON.stringify(ev.meta || {});
  const meta = ev.meta || {};
  const head = `<${pri(facility, sev)}>`;

  if (format === "JSON") {
    return JSON.stringify({
      ts: ts.toISOString(), host: HOSTNAME, app: APP_NAME,
      severity: sev, name, message: msg, ...meta,
    });
  }
  if (format === "CEF") {
    // CEF:0|Vendor|Product|Version|SignatureID|Name|Severity|Extension
    const ext = Object.entries(meta)
      .map(([k, v]) => `${escapeCef(k)}=${escapeCef(v)}`).join(" ");
    const cef = `CEF:0|Sovereign|AI-OS|1.0|${escapeCef(ev.id || name)}|${escapeCef(name)}|${Math.min(10, 10 - sevNum)}|msg=${escapeCef(msg)} ${ext}`;
    return `${head}${ts.toISOString()} ${HOSTNAME} ${cef}`;
  }
  if (format === "LEEF") {
    // LEEF:2.0|Vendor|Product|Version|EventID|^|key=value^...
    const ext = Object.entries({ msg, ...meta })
      .map(([k, v]) => `${escapeLeef(k)}=${escapeLeef(v)}`).join("\t");
    const leef = `LEEF:2.0|Sovereign|AI-OS|1.0|${escapeLeef(ev.id || name)}|\t${ext}`;
    return `${head}${ts.toISOString()} ${HOSTNAME} ${leef}`;
  }
  // RFC5424 default
  const sd = Object.keys(meta).length
    ? `[meta@32473 ${Object.entries(meta).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(" ")}]`
    : "-";
  return `${head}1 ${ts.toISOString()} ${HOSTNAME} ${APP_NAME} - ${name} ${sd} ${msg}`;
}

class SiemForwarder {
  constructor() {
    this.cfg = { enabled: false, host: "", port: 514, protocol: "udp", format: "CEF", facility: "local0" };
    this.queue = [];
    this.maxQueue = 8000;
    this.dropped = 0;
    this.sent = 0;
    this.dead = 0;
    this.lastError = null;
    this.lastSentAt = null;
    this.tcpSocket = null;
    this.tcpReady = false;
    this.connecting = false;
    this.pool = null;
    this.outboxDepth = 0;
  }

  bindPool(pool) { this.pool = pool; }

  applyConfig(next) {
    const changed = JSON.stringify(this.cfg) !== JSON.stringify(next);
    this.cfg = { ...this.cfg, ...next };
    if (changed) this.disconnectStream();
  }

  disconnectStream() {
    try { this.tcpSocket?.destroy(); } catch { /* ignore */ }
    this.tcpSocket = null;
    this.tcpReady = false;
  }

  status() {
    return {
      enabled: !!this.cfg.enabled,
      host: this.cfg.host, port: this.cfg.port,
      protocol: this.cfg.protocol, format: this.cfg.format, facility: this.cfg.facility,
      queueDepth: this.queue.length, outboxDepth: this.outboxDepth,
      dropped: this.dropped, sent: this.sent, dead: this.dead,
      lastError: this.lastError, lastSentAt: this.lastSentAt,
    };
  }

  enqueue(event) {
    if (!this.cfg.enabled || !this.cfg.host) return;
    if (this.queue.length >= this.maxQueue) {
      this.dropped++;
      const evicted = this.queue.shift();
      // Spill to outbox so we don't actually lose audit events.
      this.persist(evicted).catch(() => {});
    }
    this.queue.push(event);
    queueMicrotask(() => this.flush().catch(() => {}));
  }

  async persist(event) {
    if (!this.pool) return;
    try {
      const r = await this.pool.query(
        "INSERT INTO siem_outbox(payload) VALUES ($1::jsonb) RETURNING id",
        [JSON.stringify(event)]
      );
      if (r.rows[0]) this.outboxDepth++;
    } catch { /* outbox unavailable — drop counter already bumped */ }
  }

  async ensureStream() {
    if (this.cfg.protocol === "udp") return;
    if (this.tcpReady && this.tcpSocket && !this.tcpSocket.destroyed) return;
    if (this.connecting) return;
    this.connecting = true;
    try {
      await new Promise((resolve, reject) => {
        const onReady = () => { this.tcpReady = true; resolve(); };
        const opts = { host: this.cfg.host, port: Number(this.cfg.port) || 514 };
        const s = this.cfg.protocol === "tls"
          ? tls.connect({ ...opts, rejectUnauthorized: false }, onReady)
          : net.connect(opts, onReady);
        s.setTimeout(15_000);
        s.on("error", (e) => { this.lastError = String(e.message || e); reject(e); });
        s.on("close", () => { this.tcpReady = false; this.tcpSocket = null; });
        this.tcpSocket = s;
      });
    } finally {
      this.connecting = false;
    }
  }

  async sendOne(ev) {
    const line = formatEvent(ev, this.cfg.format, this.cfg.facility);
    if (this.cfg.protocol === "udp") {
      const sock = dgram.createSocket("udp4");
      try {
        await new Promise((resolve, reject) => sock.send(line, Number(this.cfg.port) || 514, this.cfg.host, (err) => err ? reject(err) : resolve()));
      } finally { sock.close(); }
    } else {
      await this.ensureStream();
      if (!this.tcpReady || !this.tcpSocket) throw new Error("stream not ready");
      const ok = this.tcpSocket.write(line + "\n");
      if (!ok) await new Promise((r) => this.tcpSocket.once("drain", r));
    }
    this.sent++;
    this.lastSentAt = new Date().toISOString();
  }

  async flush() {
    if (!this.cfg.enabled || !this.cfg.host) return;
    // Drain in-memory first.
    while (this.queue.length) {
      const ev = this.queue.shift();
      try { await this.sendOne(ev); }
      catch (e) {
        this.lastError = String(e.message || e);
        await this.persist(ev);
        return;
      }
    }
    // Then drain persistent outbox in small batches.
    if (!this.pool) return;
    try {
      while (true) {
        const r = await this.pool.query("SELECT id, payload FROM siem_outbox ORDER BY enqueued_at ASC LIMIT 50");
        if (!r.rows.length) break;
        for (const row of r.rows) {
          try {
            await this.sendOne(row.payload);
            await this.pool.query("DELETE FROM siem_outbox WHERE id=$1", [row.id]);
            this.outboxDepth = Math.max(0, this.outboxDepth - 1);
          } catch (e) {
            await this.pool.query("UPDATE siem_outbox SET attempts=attempts+1, last_error=$2 WHERE id=$1", [row.id, String(e.message || e)]);
            this.lastError = String(e.message || e);
            return; // back off until next tick
          }
        }
      }
    } catch { /* outbox query failed — try again later */ }
  }

  async test() {
    const original = this.cfg.enabled;
    this.cfg.enabled = true;
    try {
      this.enqueue({
        ts: new Date().toISOString(),
        severity: "info",
        name: "siem.test",
        message: `Sovereign SIEM connectivity test from ${HOSTNAME}`,
        meta: { source: "settings.test" },
      });
      await this.flush();
      return { ok: true, ...this.status() };
    } catch (e) {
      this.lastError = String(e.message || e);
      return { ok: false, error: this.lastError, ...this.status() };
    } finally {
      this.cfg.enabled = original;
    }
  }
}

export const siem = new SiemForwarder();

// Periodic config sync from app_siem_config (singleton row) + outbox depth.
export function startSiemConfigSync(pool) {
  siem.bindPool(pool);
  const sync = async () => {
    try {
      const r = await pool.query("SELECT enabled, host, port, protocol, format, facility FROM app_siem_config WHERE id=1");
      if (r.rows[0]) siem.applyConfig(r.rows[0]);
      const c = await pool.query("SELECT count(*)::int AS n FROM siem_outbox");
      siem.outboxDepth = c.rows[0]?.n || 0;
      // Opportunistic drain in case events are sitting from a previous boot.
      void siem.flush().catch(() => {});
    } catch { /* schema may be migrating — try again next tick */ }
  };
  void sync();
  setInterval(sync, 30_000).unref?.();
}
