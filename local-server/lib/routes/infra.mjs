// local-server/lib/routes/infra.mjs
// Enterprise HA Cluster & Infrastructure Hub — Database, Redis, RabbitMQ & Storage Management

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export async function mountInfraRoutes(app, deps) {
  const { pool, isAdminCaller, resolveActor } = deps;

  // Mask sensitive database or broker credentials in connection URIs for UI safe display
  function maskUri(raw) {
    if (!raw || typeof raw !== "string") return "";
    try {
      const u = new URL(raw);
      if (u.password) u.password = "******";
      return u.toString();
    } catch {
      return raw.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:******@");
    }
  }

  // TCP Socket ping helper with sub-millisecond timer
  async function probeTcpSocket(host, port, timeoutMs = 2500, handshakePayload = null) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const socket = new net.Socket();
      let finished = false;

      const done = (ok, message, extra = {}) => {
        if (finished) return;
        finished = true;
        socket.destroy();
        const latencyMs = Math.round(performance.now() - t0);
        resolve({ ok, latencyMs, message, ...extra });
      };

      socket.setTimeout(timeoutMs);

      socket.once("connect", () => {
        if (handshakePayload) {
          socket.write(handshakePayload);
        } else {
          done(true, `TCP connection established to ${host}:${port}`);
        }
      });

      socket.on("data", (data) => {
        done(true, `Handshake response received from ${host}:${port} (${data.length} bytes)`);
      });

      socket.once("timeout", () => {
        done(false, `Connection timed out after ${timeoutMs}ms (${host}:${port})`);
      });

      socket.once("error", (err) => {
        done(false, `Socket error: ${err.message}`);
      });

      socket.connect(port, host);
    });
  }

  // GET /api/infra/overview — Global cluster & infrastructure health overview
  app.get("/api/infra/overview", async (req, res) => {
    try {
      // 1. Database status & active pool metrics
      let dbLatency = 0;
      let dbVersion = "unknown";
      let dbName = "elara_db";
      const t0 = performance.now();

      try {
        const q = await pool.query("SELECT current_database() as db, version() as ver");
        dbLatency = Math.round(performance.now() - t0);
        dbName = q.rows[0]?.db || dbName;
        dbVersion = (q.rows[0]?.ver || "").split(" ")[0] + " " + ((q.rows[0]?.ver || "").split(" ")[1] || "");
      } catch (err) {
        dbLatency = -1;
      }

      const activeDbUrl = process.env.DATABASE_URL || "postgres://sovereign:sovereign@127.0.0.1:5432/elara_db";

      // 2. Fetch saved app_settings for redis, rabbitmq and storage
      const settingsRows = await pool.query(
        "SELECT key, value FROM app_settings WHERE key IN ('infra.redis', 'infra.rabbitmq', 'infra.storage', 'infra.db')"
      ).catch(() => ({ rows: [] }));

      const settingsMap = {};
      for (const r of settingsRows.rows) {
        settingsMap[r.key] = r.value;
      }

      const redisConfig = settingsMap["infra.redis"] || {
        enabled: false,
        uri: process.env.REDIS_URL || "redis://127.0.0.1:6379",
        semanticCache: true,
        ttlSeconds: 86400,
      };

      const rabbitmqConfig = settingsMap["infra.rabbitmq"] || {
        enabled: false,
        uri: process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672",
        prefetch: 10,
      };

      const storageConfig = settingsMap["infra.storage"] || {
        mode: process.env.STORAGE_MODE || "local",
        localPath: process.env.UPLOAD_DIR || "./uploads",
        s3: {
          endpoint: "",
          bucket: "elara-knowledge",
          region: "us-east-1",
          accessKey: "",
          secretKey: "",
        },
      };

      res.json({
        ok: true,
        database: {
          status: dbLatency >= 0 ? "healthy" : "offline",
          activeUri: maskUri(activeDbUrl),
          databaseName: dbName,
          version: dbVersion,
          latencyMs: dbLatency,
          pool: {
            totalCount: pool.totalCount || 1,
            idleCount: pool.idleCount || 0,
            waitingCount: pool.waitingCount || 0,
          },
        },
        redis: {
          enabled: !!redisConfig.enabled,
          mode: redisConfig.enabled ? "redis-cluster" : "in-memory-fallback",
          activeUri: maskUri(redisConfig.uri),
          semanticCache: redisConfig.semanticCache !== false,
          ttlSeconds: redisConfig.ttlSeconds || 86400,
        },
        rabbitmq: {
          enabled: !!rabbitmqConfig.enabled,
          mode: rabbitmqConfig.enabled ? "amqp-broker" : "direct-sync-fallback",
          activeUri: maskUri(rabbitmqConfig.uri),
          prefetch: rabbitmqConfig.prefetch || 10,
        },
        storage: {
          mode: storageConfig.mode || "local",
          localPath: storageConfig.localPath || "./uploads",
          s3Endpoint: storageConfig.s3?.endpoint || "",
          s3Bucket: storageConfig.s3?.bucket || "elara-knowledge",
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/db/test — Real probe for candidate PostgreSQL connection
  app.post("/api/infra/db/test", async (req, res) => {
    const { connectionString } = req.body || {};
    if (!connectionString) {
      return res.status(400).json({ ok: false, error: "connectionString is required" });
    }

    const t0 = performance.now();
    const testClient = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 3000,
    });

    try {
      await testClient.connect();
      const q = await testClient.query(`
        SELECT 
          current_database() as db_name,
          version() as db_ver,
          (SELECT count(*)::int FROM information_schema.tables WHERE table_name IN ('agents', 'models', 'knowledge_chunks', 'app_users')) as core_tables
      `);
      const latencyMs = Math.round(performance.now() - t0);
      const row = q.rows[0] || {};
      await testClient.end();

      res.json({
        ok: true,
        latencyMs,
        database: row.db_name,
        version: row.db_ver ? row.db_ver.split(" ").slice(0, 2).join(" ") : "PostgreSQL",
        coreTablesFound: row.core_tables || 0,
        isSchemaReady: (row.core_tables || 0) >= 4,
        message: `Connection verified. Latency: ${latencyMs}ms, Database: ${row.db_name}`,
      });
    } catch (err) {
      await testClient.end().catch(() => {});
      const latencyMs = Math.round(performance.now() - t0);
      res.status(400).json({
        ok: false,
        latencyMs,
        error: `Connection failed: ${err.message}`,
      });
    }
  });

  // POST /api/infra/db/save — Save database configuration
  app.post("/api/infra/db/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { connectionString } = req.body || {};
    if (!connectionString) return res.status(400).json({ ok: false, error: "connectionString is required" });

    try {
      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.db', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify({ connectionString })]
      );
      res.json({ ok: true, message: "Database cluster configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/redis/test — Test Redis connectivity & RESP ping
  app.post("/api/infra/redis/test", async (req, res) => {
    const { uri } = req.body || {};
    if (!uri) return res.status(400).json({ ok: false, error: "uri is required" });

    try {
      const u = new URL(uri);
      const host = u.hostname || "127.0.0.1";
      const port = Number(u.port) || 6379;

      // Send RESP formatted *1\r\n$4\r\nPING\r\n
      const pingPayload = Buffer.from("*1\r\n$4\r\nPING\r\n");
      const result = await probeTcpSocket(host, port, 3000, pingPayload);

      if (result.ok) {
        res.json({
          ok: true,
          latencyMs: result.latencyMs,
          message: `Redis node (${host}:${port}) reachable. Latency: ${result.latencyMs}ms`,
        });
      } else {
        res.status(400).json({
          ok: false,
          latencyMs: result.latencyMs,
          error: result.message,
        });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: `Invalid Redis URI format: ${err.message}` });
    }
  });

  // POST /api/infra/redis/save — Save Redis configuration
  app.post("/api/infra/redis/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { enabled, uri, semanticCache, ttlSeconds } = req.body || {};

    try {
      const payload = {
        enabled: !!enabled,
        uri: uri || "redis://127.0.0.1:6379",
        semanticCache: semanticCache !== false,
        ttlSeconds: Number(ttlSeconds) || 86400,
      };

      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.redis', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify(payload)]
      );

      res.json({ ok: true, message: "Redis caching configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/rabbitmq/test — Test RabbitMQ AMQP handshake
  app.post("/api/infra/rabbitmq/test", async (req, res) => {
    const { uri } = req.body || {};
    if (!uri) return res.status(400).json({ ok: false, error: "uri is required" });

    try {
      const u = new URL(uri);
      const host = u.hostname || "127.0.0.1";
      const port = Number(u.port) || 5672;

      // AMQP 0-9-1 protocol header: 'AMQP\x00\x00\x09\x01'
      const amqpHeader = Buffer.from([0x41, 0x4D, 0x51, 0x50, 0x00, 0x00, 0x09, 0x01]);
      const result = await probeTcpSocket(host, port, 3000, amqpHeader);

      if (result.ok) {
        res.json({
          ok: true,
          latencyMs: result.latencyMs,
          message: `RabbitMQ broker (${host}:${port}) AMQP handshake successful. Latency: ${result.latencyMs}ms`,
        });
      } else {
        res.status(400).json({
          ok: false,
          latencyMs: result.latencyMs,
          error: result.message,
        });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: `Invalid RabbitMQ URI format: ${err.message}` });
    }
  });

  // POST /api/infra/rabbitmq/save — Save RabbitMQ configuration
  app.post("/api/infra/rabbitmq/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { enabled, uri, prefetch } = req.body || {};

    try {
      const payload = {
        enabled: !!enabled,
        uri: uri || "amqp://guest:guest@127.0.0.1:5672",
        prefetch: Number(prefetch) || 10,
      };

      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.rabbitmq', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify(payload)]
      );

      res.json({ ok: true, message: "RabbitMQ task broker configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/storage/test — Test local directory writability or S3 endpoint reachability
  app.post("/api/infra/storage/test", async (req, res) => {
    const { mode, localPath, s3 } = req.body || {};
    const t0 = performance.now();

    if (mode === "s3") {
      const endpoint = s3?.endpoint;
      if (!endpoint) return res.status(400).json({ ok: false, error: "S3 endpoint is required" });

      try {
        const u = new URL(endpoint);
        const host = u.hostname;
        const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
        const result = await probeTcpSocket(host, port, 3000);

        if (result.ok) {
          res.json({
            ok: true,
            latencyMs: result.latencyMs,
            message: `S3 Object storage endpoint (${host}:${port}) reachable. Latency: ${result.latencyMs}ms`,
          });
        } else {
          res.status(400).json({ ok: false, latencyMs: result.latencyMs, error: result.message });
        }
      } catch (err) {
        res.status(400).json({ ok: false, error: `Invalid S3 Endpoint: ${err.message}` });
      }
    } else {
      // Local disk / NFS directory verification
      const targetDir = localPath || "./uploads";
      try {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const probeFile = path.join(targetDir, `.elara_probe_${Date.now()}`);
        fs.writeFileSync(probeFile, "ok");
        fs.unlinkSync(probeFile);
        const latencyMs = Math.round(performance.now() - t0);

        res.json({
          ok: true,
          latencyMs,
          message: `Storage directory verified & writable (${targetDir}). Latency: ${latencyMs}ms`,
        });
      } catch (err) {
        res.status(400).json({ ok: false, error: `Directory write check failed: ${err.message}` });
      }
    }
  });

  // POST /api/infra/storage/save — Save Storage configuration
  app.post("/api/infra/storage/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { mode, localPath, s3 } = req.body || {};

    try {
      const payload = {
        mode: mode || "local",
        localPath: localPath || "./uploads",
        s3: s3 || {},
      };

      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.storage', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify(payload)]
      );

      res.json({ ok: true, message: "Storage configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
