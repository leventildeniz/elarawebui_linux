// local-server/lib/routes/infra.mjs
// Enterprise HA Cluster & Infrastructure Hub — Database, Redis, RabbitMQ & Storage Management with Vault Integration

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import Redis from "ioredis";
import amqp from "amqplib";
import { getRedisCacheStats, initRedisCache } from "../infra/redis-cache.mjs";
import { getRabbitBrokerStats, initRabbitBroker } from "../infra/rabbitmq-broker.mjs";
import { getSecretAllFields } from "../vault.mjs";

export async function mountInfraRoutes(app, deps) {
  const { pool, isAdminCaller, resolveActor } = deps;

  // Resolves a secret from PostgreSQL vault_secrets (AES-256-GCM decrypted)
  async function resolveVaultSecret(ref) {
    if (!ref || typeof ref !== "string") return null;
    let clean = ref.trim();
    if (clean.startsWith("vault://")) clean = clean.slice("vault://".length);
    if (clean.startsWith("raw://")) return { kind: "raw", fields: { raw: clean.slice("raw://".length) } };

    let scope = "global";
    let name = clean;
    if (clean.includes(":")) {
      const parts = clean.split(":");
      scope = parts[0];
      name = parts.slice(1).join(":");
    } else if (clean.includes(".")) {
      const parts = clean.split(".");
      scope = parts[0];
      name = parts.slice(1).join(".");
    }

    try {
      const sec = await getSecretAllFields(pool, scope, name);
      if (sec && sec.fields) {
        return {
          scope,
          name,
          kind: sec.kind,
          fields: sec.fields,
          meta: sec.meta || {},
        };
      }
    } catch (err) {
      console.warn(`[resolveVaultSecret] Failed resolving ${scope}:${name}:`, err.message);
    }
    return null;
  }

  // Mask sensitive database or broker credentials in connection URIs for UI safe display
  function maskUri(raw) {
    if (!raw || typeof raw !== "string") return "";
    try {
      const u = new URL(raw);
      if (u.password) u.password = "••••••••";
      return u.toString();
    } catch {
      return raw.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:••••••••@");
    }
  }

  // Helper to safely unmask candidate URIs using stored URI passwords if candidate has '******' or '••••••••'
  function resolveCandidateUri(candidate, stored) {
    if (!candidate || typeof candidate !== "string") return candidate || "";
    if (!candidate.includes("******") && !candidate.includes("••••••••")) return candidate;
    try {
      const candUrl = new URL(candidate);
      if (stored) {
        try {
          const storedUrl = new URL(stored);
          if (candUrl.password === "******" || candUrl.password === "••••••••") {
            candUrl.password = storedUrl.password || "";
          }
        } catch {}
      }
      return candUrl.toString();
    } catch {
      return candidate;
    }
  }

  // Resolve Database URI from configuration or Vault
  async function resolveDatabaseUri(config = {}) {
    const { authMode = "vault", vaultRef, targetHost, connectionString } = config;
    if (authMode === "vault" && vaultRef) {
      const sec = await resolveVaultSecret(vaultRef);
      if (sec && sec.fields) {
        if (sec.fields.connection_string) {
          return sec.fields.connection_string;
        }
        const u = encodeURIComponent(sec.fields.username || "sovereign");
        const p = encodeURIComponent(sec.fields.password || "");
        const host = (targetHost || "localhost:5432/elara_db").replace(/^postgres:\/\//, "");
        return `postgres://${u}:${p}@${host}`;
      }
    }
    return connectionString || process.env.DATABASE_URL || "postgres://sovereign:sovereign@127.0.0.1:5432/elara_db";
  }

  // Resolve Redis URI from configuration or Vault
  async function resolveRedisUri(config = {}) {
    const { authMode = "direct", vaultRef, targetHost, uri } = config;
    if (authMode === "vault" && vaultRef) {
      const sec = await resolveVaultSecret(vaultRef);
      if (sec && sec.fields) {
        if (sec.fields.uri || sec.fields.connection_string) {
          return sec.fields.uri || sec.fields.connection_string;
        }
        const p = encodeURIComponent(sec.fields.password || sec.fields.api_key || sec.fields.token || "");
        const host = (targetHost || "127.0.0.1:6379").replace(/^redis:\/\//, "");
        return p ? `redis://:${p}@${host}` : `redis://${host}`;
      }
    }
    return uri || process.env.REDIS_URL || "redis://127.0.0.1:6379";
  }

  // Resolve RabbitMQ URI from configuration or Vault
  async function resolveRabbitmqUri(config = {}) {
    const { authMode = "direct", vaultRef, targetHost, uri } = config;
    if (authMode === "vault" && vaultRef) {
      const sec = await resolveVaultSecret(vaultRef);
      if (sec && sec.fields) {
        if (sec.fields.uri || sec.fields.connection_string) {
          return sec.fields.uri || sec.fields.connection_string;
        }
        const u = encodeURIComponent(sec.fields.username || "guest");
        const p = encodeURIComponent(sec.fields.password || "guest");
        const host = (targetHost || "127.0.0.1:5672").replace(/^amqp:\/\//, "");
        return `amqp://${u}:${p}@${host}`;
      }
    }
    return uri || process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672";
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

  // GET /api/infra/overview — Global cluster & infrastructure health overview (SuperAdmin only)
  app.get("/api/infra/overview", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
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

      // 2. Fetch saved app_settings for redis, rabbitmq, storage and db
      const settingsRows = await pool.query(
        "SELECT key, value FROM app_settings WHERE key IN ('infra.redis', 'infra.rabbitmq', 'infra.storage', 'infra.db')"
      ).catch(() => ({ rows: [] }));

      const settingsMap = {};
      for (const r of settingsRows.rows) {
        settingsMap[r.key] = r.value;
      }

      const dbConfig = settingsMap["infra.db"] || {};
      const redisConfig = settingsMap["infra.redis"] || {};
      const rabbitmqConfig = settingsMap["infra.rabbitmq"] || {};
      const storageConfig = settingsMap["infra.storage"] || {};

      const resolvedDbUri = await resolveDatabaseUri(dbConfig);
      const resolvedRedisUri = await resolveRedisUri(redisConfig);
      const resolvedRabbitUri = await resolveRabbitmqUri(rabbitmqConfig);

      const redisStats = getRedisCacheStats();
      const rabbitStats = getRabbitBrokerStats();

      res.json({
        ok: true,
        database: {
          status: dbLatency >= 0 ? "healthy" : "offline",
          authMode: dbConfig.authMode || (dbConfig.vaultRef ? "vault" : "direct"),
          vaultRef: dbConfig.vaultRef || "",
          targetHost: dbConfig.targetHost || "localhost:5432/elara_db",
          activeUri: maskUri(resolvedDbUri),
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
          authMode: redisConfig.authMode || (redisConfig.vaultRef ? "vault" : "direct"),
          vaultRef: redisConfig.vaultRef || "",
          targetHost: redisConfig.targetHost || "127.0.0.1:6379",
          mode: redisStats.mode,
          activeUri: maskUri(resolvedRedisUri),
          semanticCache: redisConfig.semanticCache !== false,
          ttlSeconds: redisConfig.ttlSeconds || 86400,
          hitRate: redisStats.hitRate,
          hits: redisStats.hits,
          misses: redisStats.misses,
        },
        rabbitmq: {
          enabled: !!rabbitmqConfig.enabled,
          authMode: rabbitmqConfig.authMode || (rabbitmqConfig.vaultRef ? "vault" : "direct"),
          vaultRef: rabbitmqConfig.vaultRef || "",
          targetHost: rabbitmqConfig.targetHost || "127.0.0.1:5672",
          mode: rabbitStats.mode,
          activeUri: maskUri(resolvedRabbitUri),
          prefetch: rabbitmqConfig.prefetch || 10,
          published: rabbitStats.published,
          completed: rabbitStats.completed,
          failed: rabbitStats.failed,
        },
        storage: {
          mode: storageConfig.mode || "local",
          authMode: storageConfig.authMode || (storageConfig.vaultRef ? "vault" : "direct"),
          vaultRef: storageConfig.vaultRef || "",
          localPath: storageConfig.localPath || "./uploads",
          s3Endpoint: storageConfig.s3?.endpoint || "",
          s3Bucket: storageConfig.s3?.bucket || "elara-knowledge",
          s3Region: storageConfig.s3?.region || "us-east-1",
          s3AccessKey: storageConfig.authMode === "vault" ? "" : (storageConfig.s3?.accessKey || ""),
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/db/test — Real probe for candidate PostgreSQL connection
  app.post("/api/infra/db/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { authMode, vaultRef, targetHost, connectionString } = req.body || {};

    try {
      const storedRow = await pool.query("SELECT value FROM app_settings WHERE key='infra.db'").catch(() => ({ rows: [] }));
      const storedConfig = storedRow.rows[0]?.value || {};

      let resolvedUri;
      if (authMode === "vault" && vaultRef) {
        resolvedUri = await resolveDatabaseUri({ authMode: "vault", vaultRef, targetHost });
      } else {
        const candidate = connectionString || storedConfig.connectionString || process.env.DATABASE_URL;
        resolvedUri = resolveCandidateUri(candidate, storedConfig.connectionString || process.env.DATABASE_URL);
      }

      const t0 = performance.now();
      const testClient = new pg.Client({
        connectionString: resolvedUri,
        connectionTimeoutMillis: 3000,
      });

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
      res.status(400).json({
        ok: false,
        latencyMs: 0,
        error: `Connection failed: ${err.message}`,
      });
    }
  });

  // POST /api/infra/db/save — Save database configuration
  app.post("/api/infra/db/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { authMode, vaultRef, targetHost, connectionString } = req.body || {};

    try {
      const storedRow = await pool.query("SELECT value FROM app_settings WHERE key='infra.db'").catch(() => ({ rows: [] }));
      const storedConfig = storedRow.rows[0]?.value || {};

      const payload = {
        authMode: authMode || "vault",
        vaultRef: vaultRef || "",
        targetHost: targetHost || "localhost:5432/elara_db",
      };

      if (authMode === "direct") {
        payload.connectionString = resolveCandidateUri(connectionString, storedConfig.connectionString || process.env.DATABASE_URL);
      }

      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.db', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify(payload)]
      );
      res.json({ ok: true, message: "Database cluster configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/redis/test — Test Redis connectivity & RESP ping
  app.post("/api/infra/redis/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { authMode, vaultRef, targetHost, uri } = req.body || {};

    try {
      let resolvedUri;
      if (authMode === "vault" && vaultRef) {
        resolvedUri = await resolveRedisUri({ authMode: "vault", vaultRef, targetHost });
      } else {
        const storedRow = await pool.query("SELECT value FROM app_settings WHERE key='infra.redis'").catch(() => ({ rows: [] }));
        const storedUri = storedRow.rows[0]?.value?.uri || process.env.REDIS_URL || "redis://127.0.0.1:6379";
        resolvedUri = resolveCandidateUri(uri, storedUri);
      }

      const u = new URL(resolvedUri);
      const host = u.hostname || "127.0.0.1";
      const port = Number(u.port) || 6379;

      const t0 = performance.now();
      const testClient = new Redis(resolvedUri, {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
      });

      await testClient.connect();
      const pong = await testClient.ping();
      const latencyMs = Math.round(performance.now() - t0);
      await testClient.quit().catch(() => {});

      if (pong === "PONG") {
        res.json({
          ok: true,
          latencyMs,
          message: `Redis node (${host}:${port}) reachable. Latency: ${latencyMs}ms (PONG)`,
        });
      } else {
        res.json({
          ok: true,
          latencyMs,
          message: `Redis node (${host}:${port}) responded: ${pong}`,
        });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: `Redis connection failed: ${err.message}` });
    }
  });

  // POST /api/infra/redis/save — Save Redis configuration
  app.post("/api/infra/redis/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { enabled, authMode, vaultRef, targetHost, uri, semanticCache, ttlSeconds } = req.body || {};

    try {
      const storedRow = await pool.query("SELECT value FROM app_settings WHERE key='infra.redis'").catch(() => ({ rows: [] }));
      const storedConfig = storedRow.rows[0]?.value || {};

      const payload = {
        enabled: !!enabled,
        authMode: authMode || "direct",
        vaultRef: vaultRef || "",
        targetHost: targetHost || "127.0.0.1:6379",
        uri: authMode === "vault" ? "" : resolveCandidateUri(uri, storedConfig.uri || process.env.REDIS_URL || "redis://127.0.0.1:6379"),
        semanticCache: semanticCache !== false,
        ttlSeconds: Number(ttlSeconds) || 86400,
      };

      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.redis', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify(payload)]
      );

      await initRedisCache(pool);

      res.json({ ok: true, message: "Redis caching configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/rabbitmq/test — Test RabbitMQ AMQP handshake
  app.post("/api/infra/rabbitmq/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { authMode, vaultRef, targetHost, uri } = req.body || {};

    try {
      let resolvedUri;
      if (authMode === "vault" && vaultRef) {
        resolvedUri = await resolveRabbitmqUri({ authMode: "vault", vaultRef, targetHost });
      } else {
        const storedRow = await pool.query("SELECT value FROM app_settings WHERE key='infra.rabbitmq'").catch(() => ({ rows: [] }));
        const storedUri = storedRow.rows[0]?.value?.uri || process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672";
        resolvedUri = resolveCandidateUri(uri, storedUri);
      }

      const u = new URL(resolvedUri);
      const host = u.hostname || "127.0.0.1";
      const port = Number(u.port) || 5672;

      const t0 = performance.now();
      const conn = await amqp.connect(resolvedUri, { timeout: 3000 });
      const ch = await conn.createChannel();
      await ch.close();
      await conn.close();
      const latencyMs = Math.round(performance.now() - t0);

      res.json({
        ok: true,
        latencyMs,
        message: `RabbitMQ broker (${host}:${port}) AMQP handshake successful. Latency: ${latencyMs}ms`,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: `RabbitMQ connection failed: ${err.message}` });
    }
  });

  // POST /api/infra/rabbitmq/save — Save RabbitMQ configuration
  app.post("/api/infra/rabbitmq/save", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { enabled, authMode, vaultRef, targetHost, uri, prefetch } = req.body || {};

    try {
      const storedRow = await pool.query("SELECT value FROM app_settings WHERE key='infra.rabbitmq'").catch(() => ({ rows: [] }));
      const storedConfig = storedRow.rows[0]?.value || {};

      const payload = {
        enabled: !!enabled,
        authMode: authMode || "direct",
        vaultRef: vaultRef || "",
        targetHost: targetHost || "127.0.0.1:5672",
        uri: authMode === "vault" ? "" : resolveCandidateUri(uri, storedConfig.uri || process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672"),
        prefetch: Number(prefetch) || 10,
      };

      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('infra.rabbitmq', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb, updated_at=now()`,
        [JSON.stringify(payload)]
      );

      await initRabbitBroker(pool);

      res.json({ ok: true, message: "RabbitMQ task broker configuration saved." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // POST /api/infra/storage/test — Test local directory writability or S3 endpoint reachability
  app.post("/api/infra/storage/test", async (req, res) => {
    const { mode, localPath, authMode, vaultRef, s3 } = req.body || {};
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
    const { mode, localPath, authMode, vaultRef, s3 } = req.body || {};

    try {
      const payload = {
        mode: mode || "local",
        localPath: localPath || "./uploads",
        authMode: authMode || "direct",
        vaultRef: vaultRef || "",
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
