import { mountTelemetryStreamRoute } from "./telemetry-stream.mjs";
// lib/routes/telemetry.mjs — /api/telemetry/* endpoints.
// Extracted from server.mjs (Tur 3, 2026-05-30). Probe helpers
// (probeHttp/probeTcp/probePing + isLoopbackHttps) live alongside since
// only this module uses them.

import net from "node:net";
import { execFile } from "node:child_process";

const LOCAL_HOSTNAMES = new Set([
  "127.0.0.1", "localhost", "0.0.0.0", "::1",
]);

function isLoopbackHttps(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (LOCAL_HOSTNAMES.has(host)) return true;
    if (host.endsWith(".local")) return true;
    return false;
  } catch { return false; }
}

export function mountTelemetryRoutes(app, deps) {
  const { pool, resolveActorContext, buildVisibility, INSECURE_LOOPBACK_AGENT } = deps;
  mountTelemetryStreamRoute(app, pool);

  async function probeHttp(url, { method = "GET", headers = {}, timeoutMs = 5000, expectStatus, expectStatuses } = {}) {
    const t0 = Date.now();
    try {
      const opts = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
      if (isLoopbackHttps(url)) opts.dispatcher = INSECURE_LOOPBACK_AGENT;
      const r = await fetch(url, opts);
      const latency = Date.now() - t0;
      const allow = Array.isArray(expectStatuses) && expectStatuses.length
        ? expectStatuses.map(Number).filter(Number.isFinite)
        : (expectStatus ? [Number(expectStatus)] : null);
      const expectedOk = allow ? allow.includes(r.status) : r.ok;
      return { ok: expectedOk, status: r.status, latency, message: `${method} ${r.status} ${r.statusText}` };
    } catch (e) {
      return { ok: false, status: 0, latency: Date.now() - t0, message: String(e.message || e) };
    }
  }

  async function probeTcp(host, port, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const sock = new net.Socket();
      let done = false;
      const finish = (ok, message) => {
        if (done) return; done = true;
        sock.destroy();
        resolve({ ok, status: ok ? 200 : 0, latency: Date.now() - t0, message });
      };
      sock.setTimeout(timeoutMs);
      sock.once("connect", () => finish(true, `tcp ${host}:${port} reachable`));
      sock.once("timeout", () => finish(false, `tcp ${host}:${port} timeout`));
      sock.once("error", (e) => finish(false, `tcp ${host}:${port} ${e.message}`));
      sock.connect(port, host);
    });
  }

  function probePing(host, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const args = process.platform === "darwin" || process.platform === "linux"
        ? ["-c", "1", "-W", String(Math.ceil(timeoutMs / 1000)), host]
        : ["-n", "1", "-w", String(timeoutMs), host];
      execFile("ping", args, { timeout: timeoutMs + 1000 }, (err, stdout) => {
        const latency = Date.now() - t0;
        if (err) return resolve({ ok: false, status: 0, latency, message: `ping ${host} failed` });
        const m = stdout.match(/time[=<]([0-9.]+)\s*ms/i);
        const rtt = m ? Number(m[1]) : latency;
        resolve({ ok: true, status: 200, latency: Math.round(rtt), message: `ping ${host} ${rtt}ms` });
      });
    });
  }

  // GET /api/telemetry/boards
  app.get("/api/telemetry/boards", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM telemetry_boards ORDER BY created_at ASC");
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        tone: r.tone || "sapphire",
        entries: r.entries || [],
        ownerId: r.owner_id,
        createdAt: new Date(r.created_at).getTime()
      })));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // POST /api/telemetry/boards
  app.post("/api/telemetry/boards", async (req, res) => {
    try {
      const b = req.body ?? {};
      const id = b.id || `tb_${Math.random().toString(36).slice(2, 9)}`;
      await pool.query(
        `INSERT INTO telemetry_boards (id, name, tone, entries, created_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, tone=EXCLUDED.tone, entries=EXCLUDED.entries`,
        [id, b.name || "Untitled board", b.tone || "sapphire", JSON.stringify(b.entries || [])]
      );
      const { rows } = await pool.query("SELECT * FROM telemetry_boards WHERE id = $1", [id]);
      const r = rows[0];
      res.json({ ok: true, board: {
        id: r.id, name: r.name, tone: r.tone || "sapphire", entries: r.entries || [],
        ownerId: r.owner_id, createdAt: new Date(r.created_at).getTime()
      }});
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // DELETE /api/telemetry/boards/:id
  app.delete("/api/telemetry/boards/:id", async (req, res) => {
    try {
      await pool.query("DELETE FROM telemetry_boards WHERE id = $1", [req.params.id]);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/telemetry/sources", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM telemetry_sources ORDER BY created_at ASC");
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        host: r.host || "",
        port: r.port || "",
        path: r.path || "",
        auth: r.auth || "none",
        credentialRef: r.credential_ref || "",
        intervalSec: Number(r.interval_sec),
        timeoutSec: Number(r.timeout_sec),
        tls: !!r.tls,
        enabled: !!r.enabled,
        labels: r.labels || "",
        lastProbe: r.last_probe || null,
        createdAt: new Date(r.created_at).getTime()
      })));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/telemetry/sources", async (req, res) => {
    try {
      const s = req.body ?? {};
      const id = s.id || `tsrc_${Math.random().toString(36).slice(2, 9)}`;
      await pool.query(
        `INSERT INTO telemetry_sources (id, name, kind, host, port, path, auth, credential_ref, interval_sec, timeout_sec, tls, enabled, labels, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, kind=EXCLUDED.kind, host=EXCLUDED.host, port=EXCLUDED.port, path=EXCLUDED.path,
           auth=EXCLUDED.auth, credential_ref=EXCLUDED.credential_ref, interval_sec=EXCLUDED.interval_sec,
           timeout_sec=EXCLUDED.timeout_sec, tls=EXCLUDED.tls, enabled=EXCLUDED.enabled, labels=EXCLUDED.labels`,
        [
          id, s.name || "Unnamed Source", s.kind || "http", s.host || "", s.port || "", s.path || "",
          s.auth || "none", s.credentialRef || null, Number(s.intervalSec || 30), Number(s.timeoutSec || 10),
          !!s.tls, !!s.enabled, s.labels || ""
        ]
      );
      
      const { rows } = await pool.query("SELECT * FROM telemetry_sources WHERE id = $1", [id]);
      const r = rows[0];
      res.json({ ok: true, source: {
        id: r.id, name: r.name, kind: r.kind, host: r.host || "", port: r.port || "", path: r.path || "",
        auth: r.auth || "none", credentialRef: r.credential_ref || "", intervalSec: Number(r.interval_sec),
        timeoutSec: Number(r.timeout_sec), tls: !!r.tls, enabled: !!r.enabled, labels: r.labels || "",
        lastProbe: r.last_probe || null, createdAt: new Date(r.created_at).getTime()
      }});
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/telemetry/sources/:id", async (req, res) => {
    try {
      await pool.query("DELETE FROM telemetry_sources WHERE id = $1", [req.params.id]);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // POST /api/telemetry/probe — universal one-shot probe
  app.post("/api/telemetry/probe", async (req, res) => {
    const { kind = "http", url = "", host = "", port = 0, headers = {}, method = "GET", expectStatus, expectStatuses, timeoutMs = 5000 } = req.body || {};
    try {
      if (kind === "http" || kind === "https" || kind === "rest_auth") {
        const target = url || (host ? `${kind === "https" ? "https" : "http"}://${host}${port ? `:${port}` : ""}` : "");
        if (!target) return res.json({ ok: false, status: 0, latency: 0, message: "url required" });
        const r = await probeHttp(target, { method, headers, timeoutMs, expectStatus, expectStatuses });
        return res.json(r);
      }
      if (kind === "tcp") {
        if (!host || !port) return res.json({ ok: false, status: 0, latency: 0, message: "host & port required" });
        return res.json(await probeTcp(host, Number(port), timeoutMs));
      }
      if (kind === "ping" || kind === "icmp") {
        const h = host || (() => { try { return new URL(url).hostname; } catch { return ""; } })();
        if (!h) return res.json({ ok: false, status: 0, latency: 0, message: "host required" });
        return res.json(await probePing(h, timeoutMs));
      }
      res.json({ ok: false, status: 0, latency: 0, message: `unknown kind: ${kind}` });
    } catch (e) {
      res.status(500).json({ ok: false, status: 0, latency: 0, message: String(e.message || e) });
    }
  });

  // GET /api/telemetry/db-pulse — PostgreSQL apex_db live vitals
  app.get("/api/telemetry/db-pulse", async (_req, res) => {
    const t0 = Date.now();
    try {
      const ping = await pool.query("SELECT 1");
      const latency = Date.now() - t0;
      let active = 0, total = 0, dbName = "", txnPerMin = 0;
      try {
        const a = await pool.query(
          "SELECT count(*)::int AS active FROM pg_stat_activity WHERE state='active' AND datname=current_database()"
        );
        active = a.rows[0]?.active ?? 0;
      } catch { /* permission */ }
      try {
        const t = await pool.query("SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname=current_database()");
        total = t.rows[0]?.total ?? 0;
      } catch { /* permission */ }
      try {
        const d = await pool.query("SELECT current_database() AS db");
        dbName = d.rows[0]?.db ?? "";
      } catch { /* */ }
      try {
        const x = await pool.query("SELECT xact_commit + xact_rollback AS txn FROM pg_stat_database WHERE datname=current_database()");
        txnPerMin = Number(x.rows[0]?.txn ?? 0);
      } catch { /* */ }
      res.json({
        ok: ping.rowCount === 1,
        latency, db: dbName,
        activeQueries: active, totalConnections: total,
        txnTotal: txnPerMin,
        poolSize: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount,
      });
    } catch (e) {
      res.status(500).json({ ok: false, latency: Date.now() - t0, message: String(e.message || e) });
    }
  });

  // GET /api/telemetry/ai-metrics — dynamic cluster AI tracking
  app.get("/api/telemetry/ai-metrics", async (req, res) => {
    try {
      // 1. Throughput & Tokens & Quality Metrics
      const tokenRes = await pool.query(`
         SELECT COALESCE(SUM(prompt_tokens + response_tokens), 0)::int as t_tokens, 
                COALESCE(SUM(latency_ms), 0)::int as t_latency, 
                COUNT(*)::int as t_requests, 
                COUNT(CASE WHEN status != 'ok' THEN 1 END)::int as errors,
                COALESCE(AVG(hallucination_score), 0)::numeric as avg_hallucination,
                COALESCE(AVG(groundedness_score), 0)::numeric as avg_groundedness,
                COALESCE(AVG(refusal_rate), 0)::numeric as avg_refusal,
                COALESCE(SUM(cache_hits), 0)::int as t_cache_hits,
                COALESCE(SUM(cost_usd), 0)::numeric as t_cost
         FROM provider_usage 
         WHERE created_at >= NOW() - INTERVAL '5 minutes'
      `);
      
      const p95Res = await pool.query(`
         SELECT COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::int as p95 
         FROM provider_usage 
         WHERE created_at >= NOW() - INTERVAL '5 minutes'
      `);

      // 2. Queue Depth (Currently Running Agents + Workflows)
      const qDepth1 = await pool.query("SELECT COUNT(*)::int as running FROM agent_runs WHERE status = 'running'");
      const qDepth2 = await pool.query("SELECT COUNT(*)::int as running FROM workflow_runs WHERE status = 'running'");
      
      // 3. Tool Errors
      const toolErrRes = await pool.query(`
         SELECT COUNT(*)::int as total, COUNT(CASE WHEN status != 'ok' THEN 1 END)::int as errors 
         FROM tool_invocations 
         WHERE started_at >= NOW() - INTERVAL '5 minutes'
      `);

      // 4. Guardrail Blocks (approvals / MCP denies)
      const guardRes = await pool.query(`
         SELECT COUNT(*)::int as blocks 
         FROM deny_events 
         WHERE at >= NOW() - INTERVAL '5 minutes'
      `);

      // Time To First Token approximation (if supported by streaming logic, falling back to latency / 4)
      const t = tokenRes.rows[0];
      const reqCount = t.t_requests || 1;
      
      const toolTotal = toolErrRes.rows[0].total || 1;
      const toolErrors = toolErrRes.rows[0].errors;

      const payload = {
        throughput: Math.round(t.t_tokens / 300), // tokens per second in 5 min window
        p95: p95Res.rows[0].p95 || 0,
        p50: t.t_requests ? Math.round(t.t_latency / t.t_requests) : 0,
        ttft: t.t_requests ? Math.round((t.t_latency / t.t_requests) * 0.25) : 0, 
        toolErrorRate: Number(((toolErrors / toolTotal) * 100).toFixed(2)),
        guardrailBlocks: guardRes.rows[0].blocks || 0,
        queueDepth: (qDepth1.rows[0].running || 0) + (qDepth2.rows[0].running || 0),
        
        // Phase 20+: Quality and Costs fetched directly from new provider_usage DB fields
        hallucination: Number(t.avg_hallucination || 0),
        groundedness: Number(t.avg_groundedness || 0),
        refusalRate: Number(t.avg_refusal || 0),
        cacheHit: t.t_requests ? Math.round((t.t_cache_hits / t.t_requests) * 100) : 0,
        costPerHour: Number((t.t_cost * 12).toFixed(2)) // 5 min interval * 12 = hourly projection
      };

      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // GET /api/telemetry/db-detail — deep PostgreSQL inspection
  app.get("/api/telemetry/db-detail", async (_req, res) => {
    const t0 = Date.now();
    const out = {
      ok: true,
      latency: 0,
      db: "",
      version: "",
      sizeBytes: 0,
      sizePretty: "",
      uptimeSec: 0,
      tables: [],
      activity: [],
      slowQueries: [],
      indexes: { total: 0, hitRatio: null },
      cacheHitRatio: null,
      deadlocks: 0,
      tempFiles: 0,
      tempBytes: 0,
      txnTotal: 0,
      tupFetched: 0,
      tupInserted: 0,
      tupUpdated: 0,
      tupDeleted: 0,
      autovacuum: "idle",
      message: "",
    };
    try {
      const meta = await pool.query(
        `SELECT current_database() AS db,
                version() AS version,
                pg_database_size(current_database()) AS size_bytes,
                pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
                EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::int AS uptime_sec`
      );
      out.db = meta.rows[0]?.db ?? "";
      out.version = (meta.rows[0]?.version ?? "").split(" on ")[0];
      out.sizeBytes = Number(meta.rows[0]?.size_bytes ?? 0);
      out.sizePretty = meta.rows[0]?.size_pretty ?? "";
      out.uptimeSec = Number(meta.rows[0]?.uptime_sec ?? 0);

      try {
        const tbl = await pool.query(`
          SELECT n.nspname AS schema,
                 c.relname AS name,
                 pg_total_relation_size(c.oid) AS bytes,
                 pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
                 COALESCE(s.n_live_tup, 0)::bigint AS rows,
                 COALESCE(s.n_dead_tup, 0)::bigint AS dead_rows,
                 COALESCE(s.seq_scan, 0)::bigint AS seq_scans,
                 COALESCE(s.idx_scan, 0)::bigint AS idx_scans,
                 COALESCE(s.n_tup_ins, 0)::bigint AS inserts,
                 COALESCE(s.n_tup_upd, 0)::bigint AS updates,
                 COALESCE(s.n_tup_del, 0)::bigint AS deletes,
                 s.last_autovacuum
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
           WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
           ORDER BY pg_total_relation_size(c.oid) DESC
           LIMIT 40`);
        out.tables = tbl.rows.map(r => ({
          schema: r.schema, name: r.name,
          bytes: Number(r.bytes), sizePretty: r.size_pretty,
          rows: Number(r.rows), deadRows: Number(r.dead_rows),
          seqScans: Number(r.seq_scans), idxScans: Number(r.idx_scans),
          inserts: Number(r.inserts), updates: Number(r.updates), deletes: Number(r.deletes),
          lastAutovacuum: r.last_autovacuum,
        }));
      } catch (e) { out.message += `tables: ${e.message}; `; }

      try {
        const act = await pool.query(`
          SELECT pid, usename, application_name, client_addr::text AS client, state,
                 EXTRACT(EPOCH FROM (now() - query_start))::int AS age_sec,
                 LEFT(query, 240) AS query, wait_event_type, wait_event
            FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
           ORDER BY query_start NULLS LAST
           LIMIT 30`);
        out.activity = act.rows;
      } catch (e) { out.message += `activity: ${e.message}; `; }

      try {
        const slow = await pool.query(`
          SELECT LEFT(query, 240) AS query,
                 calls::bigint, total_exec_time::numeric AS total_ms,
                 mean_exec_time::numeric AS mean_ms, rows::bigint
            FROM pg_stat_statements
           ORDER BY mean_exec_time DESC
           LIMIT 15`);
        out.slowQueries = slow.rows.map(r => ({
          query: r.query, calls: Number(r.calls),
          totalMs: Number(r.total_ms), meanMs: Number(r.mean_ms), rows: Number(r.rows),
        }));
      } catch { /* extension not enabled */ }

      try {
        const stats = await pool.query(`SELECT deadlocks, temp_files, temp_bytes, xact_commit + xact_rollback AS txn, tup_fetched, tup_inserted, tup_updated, tup_deleted FROM pg_stat_database WHERE datname = current_database()`);
        out.deadlocks = Number(stats.rows[0]?.deadlocks || 0);
        out.tempFiles = Number(stats.rows[0]?.temp_files || 0);
        out.tempBytes = Number(stats.rows[0]?.temp_bytes || 0);
        out.txnTotal = Number(stats.rows[0]?.txn || 0);
        out.tupFetched = Number(stats.rows[0]?.tup_fetched || 0);
        out.tupInserted = Number(stats.rows[0]?.tup_inserted || 0);
        out.tupUpdated = Number(stats.rows[0]?.tup_updated || 0);
        out.tupDeleted = Number(stats.rows[0]?.tup_deleted || 0);
      } catch (e) { out.message += `db_stats: ${e.message}; `; }

      try {
        const av = await pool.query(`SELECT count(*) as c FROM pg_stat_activity WHERE query LIKE 'autovacuum:%'`);
        out.autovacuum = Number(av.rows[0]?.c || 0) > 0 ? "active" : "idle";
      } catch (e) { out.autovacuum = "idle"; }

      try {
        const idx = await pool.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')`);
        out.indexes.total = idx.rows[0]?.n ?? 0;
        const hit = await pool.query(`
          SELECT sum(idx_blks_hit)::float / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0) AS ratio
            FROM pg_statio_user_indexes`);
        out.indexes.hitRatio = hit.rows[0]?.ratio == null ? null : Number(hit.rows[0].ratio);
        const cache = await pool.query(`
          SELECT sum(blks_hit)::float / NULLIF(sum(blks_hit) + sum(blks_read), 0) AS ratio
            FROM pg_stat_database WHERE datname = current_database()`);
        out.cacheHitRatio = cache.rows[0]?.ratio == null ? null : Number(cache.rows[0].ratio);
      } catch (e) { out.message += `indexes: ${e.message}; `; }

      out.latency = Date.now() - t0;
      res.json(out);
    } catch (e) {
      out.ok = false;
      out.latency = Date.now() - t0;
      out.message = String(e.message || e);
      res.status(500).json(out);
    }
  });

  // GET /api/telemetry/operator-usage — real provider and account usage
  app.get("/api/telemetry/operator-usage", async (req, res) => {
    try {
      const pRes = await pool.query(`
        SELECT p.id, p.name, p.base_url, p.model,
               COALESCE(SUM(u.prompt_tokens), 0)::bigint as tokens_in,
               COALESCE(SUM(u.response_tokens), 0)::bigint as tokens_out,
               COUNT(u.id)::int as requests,
               COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY u.latency_ms), 0)::int as p95,
               COUNT(NULLIF(u.status, 'ok'))::float / NULLIF(COUNT(u.id), 0) as error_rate
        FROM ai_providers p
        LEFT JOIN provider_usage u ON p.id = u.provider_id
        GROUP BY p.id
        ORDER BY p.name ASC
      `);

      const uRes = await pool.query(`
        SELECT a.id as account_id, a.username, a.display_name,
               p.id as provider_id, p.name as provider_name, p.base_url,
               COALESCE(SUM(u.prompt_tokens), 0)::bigint as tokens_in,
               COALESCE(SUM(u.response_tokens), 0)::bigint as tokens_out,
               COUNT(u.id)::int as requests,
               COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY u.latency_ms), 0)::int as p95
        FROM app_users a
        JOIN chat_threads ct ON ct.user_id = a.id
        JOIN provider_usage u ON u.thread_id = ct.id
        JOIN ai_providers p ON p.id = u.provider_id
        GROUP BY a.id, p.id
      `);

      res.json({
        ok: true,
        providers: pRes.rows.map(r => {
          const isLocal = r.base_url && (r.base_url.includes("localhost") || r.base_url.includes("127.0.0.1"));
          return {
            id: r.id,
            name: r.name || "Unknown",
            hosting: isLocal ? "local" : "cloud",
            model: r.model || "default",
            tokensIn: Number(r.tokens_in),
            tokensOut: Number(r.tokens_out),
            requests: Number(r.requests),
            costUsd: 0, // Not tracked in provider_usage currently
            p95: Number(r.p95),
            errorRate: Number((r.error_rate || 0) * 100).toFixed(2),
          };
        }),
        accounts: uRes.rows.map(r => {
          const isLocal = r.base_url && (r.base_url.includes("localhost") || r.base_url.includes("127.0.0.1"));
          return {
            accountId: r.account_id,
            providerId: r.provider_id,
            providerName: r.provider_name,
            hosting: isLocal ? "local" : "cloud",
            tokensIn: Number(r.tokens_in),
            tokensOut: Number(r.tokens_out),
            requests: Number(r.requests),
            p95: Number(r.p95),
          };
        })
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // GET /api/telemetry/agent-status — runtime status for every agent
  app.get("/api/telemetry/agent-status", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id::text, name, 'agent' as kind, stats as metrics, model_ref as meta FROM agents
        WHERE id != 'agt.forge_master' AND squad != 'System' AND id NOT LIKE 'sys.%'
        UNION ALL
        SELECT id::text, name, 'workflow' as kind, jsonb_build_object('calls', runs, 'success', runs) as metrics, 'workflow' as meta FROM workflows
        UNION ALL
        SELECT id::text, name, 'orchestrator' as kind, jsonb_build_object('calls', runs, 'success', runs) as metrics, 'orchestrator' as meta FROM orchestrations
        UNION ALL
        SELECT s.id::text, s.name, 'skill' as kind, jsonb_build_object('calls', COUNT(r.id), 'success', COUNT(CASE WHEN r.status = 'ok' THEN 1 END)) as metrics, 'skill' as meta 
        FROM skills s LEFT JOIN skill_runs r ON r.skill_id = s.id GROUP BY s.id
        UNION ALL
        SELECT a.id::text, a.name, 'tool' as kind, jsonb_build_object('calls', COUNT(t.id), 'success', COUNT(CASE WHEN t.status = 'ok' THEN 1 END)) as metrics, 'adapter' as meta 
        FROM adapters a LEFT JOIN tool_invocations t ON t.tool_id = a.id GROUP BY a.id
        UNION ALL
        SELECT c.id::text, c.name, 'tool' as kind, jsonb_build_object('calls', 0, 'success', 0) as metrics, 'mcp' as meta FROM mcp_client_servers c
      `);
      
      const out = rows.map((r) => {
        const metrics = (r.metrics && typeof r.metrics === "object") ? r.metrics : {};
        const calls = Number(metrics.calls || 0);
        const success = Number(metrics.success || 0);
        
        let runtime = "cold";
        if (calls > 0) runtime = "idle";
        
        return {
          id: r.id, name: r.name, kind: r.kind,
          runtime, calls, success, meta: r.meta || "local",
        };
      });
      res.json({ agents: out });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
