// lib/migrate.mjs — schema migration orchestrator (extracted from server.mjs,
// Block E.2 Tur 2, 2026-05-30).
//
// Davranış orijinal server.mjs migrate() ile bire bir aynı. Tüm deps açıkça
// import edilir (capability-registry, runtime-registry, brand, audit-chain).
// Yeni "schema/" ara katmanı YOK — Plan B: ensure*'lar kendi domain
// modüllerine gidecek; migrate() sadece schema.sql + seed/self-heal'i çalıştırır.

import fs from "node:fs";
import path from "node:path";
import { syncCapabilitiesFromSources } from "./capability-registry.mjs";
import {
  RUNTIME_PROVIDER_PRESETS,
  RUNTIME_PROVIDER_CFG,
  defaultRuntimeProviderConfig,
  runtimeBase,
  safeRuntimeModel,
  resolveProvider,
} from "./runtime-registry.mjs";
import { brandSync } from "./brand.mjs";
import { installAuditChain } from "./audit-chain.mjs";
import { ensureMetaForgeAgent } from "./meta-forge/seed.mjs";

// schema.sql, local-server/schema.sql — bu modül local-server/lib/ altında,
// dolayısıyla ../schema.sql.
const SCHEMA_SQL_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "schema.sql"
);

export async function runMigration({ pool, env = process.env } = {}) {
  if (!pool) throw new Error("runMigration: pool required");
  let client = null;
  try {
    const dim = Math.max(64, Math.min(4096, Number(env.EMBED_DIM) || 1024));
    const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
    client = await pool.connect();
    // Aynı session'da SET → schema.sql içindeki current_setting('app.embed_dim') bunu görür.
    await client.query(`SET app.embed_dim = '${dim}'`);
    await client.query(sql);
    // DB-wide kalıcı set (sonradan açılan bağlantılar için).
    try {
      const dbn = await client.query(`SELECT current_database() AS d`);
      const dbName = dbn.rows[0]?.d;
      if (dbName) await client.query(`ALTER DATABASE "${dbName.replace(/"/g, '""')}" SET app.embed_dim = '${dim}'`);
    } catch { /* yetki yoksa yut */ }
    console.log(`[migrate] schema synced (embed_dim=${dim})`);

    try {
      const seededForge = await ensureMetaForgeAgent(client);
      if (seededForge?.id) console.log(`[migrate] meta-forge agent ready (${seededForge.status} · ${seededForge.agent_path})`);
    } catch (e) { console.warn("[migrate] meta-forge agent seed skipped:", e.message); }

    // Faz 3 — Capabilities tablosunu mevcut skills/tools/agents'ten doldur.
    try {
      const counts = await syncCapabilitiesFromSources();
      console.log(`[capabilities] sync ok: skills=${counts.skills} tools=${counts.tools} agents=${counts.agents}`);
    } catch (e) {
      console.warn(`[capabilities] sync skipped: ${e.message}`);
    }

    // --- Default model seed (brand-aware): if models table is empty, seal a
    // single default row tagged with the active brand persona so the chat is
    // usable on first boot without a manual model registration step.
    try {
      const c = await client.query(`SELECT COUNT(*)::int AS n FROM models`);
      if ((c.rows[0]?.n ?? 0) === 0) {
        const seedId   = safeRuntimeModel() || RUNTIME_PROVIDER_PRESETS.mlx.model;
        const seedBase = runtimeBase() || RUNTIME_PROVIDER_PRESETS.mlx.baseUrl;
        if (!seedId) {
          // 2026-06-04 — no Qwen phantom seed. Operator must register a model
          // explicitly from /system-engine using the runtime's /v1/models ID.
          console.log("[migrate] no default model seeded — register one in /system-engine.");
        } else {
          const _seedProv = resolveProvider(RUNTIME_PROVIDER_CFG.provider);
          const seedProvider = _seedProv === "legacy" ? "Legacy HTTP"
                              : _seedProv === "mlx" ? "MLX"
                              : (new RegExp(process.env.LEGACY_PORT || "11434").test(seedBase) ? "Legacy HTTP" : "MLX");
          await client.query(
            `INSERT INTO models(id, model_name, provider, base_url, context_length,
               system_prompt, params, is_default, status, source, is_system, updated_at)
             VALUES ($1,$2,$3,$4,32768,'',$5::jsonb,true,'ready','seed',true,now())
             ON CONFLICT (id) DO NOTHING`,
            [seedId, seedId, seedProvider, seedBase, JSON.stringify([])]
          );
          console.log(`[migrate] seeded default model "${seedId}" (${seedProvider} · ${seedBase})`);
        }
      }
      const renameTo = safeRuntimeModel() || RUNTIME_PROVIDER_PRESETS.mlx.model;
      if (renameTo) {
        await client.query(
          `UPDATE models SET model_name=$1, updated_at=now()
            WHERE id=$1 AND (source='seed' OR model_name='' OR model_name IS NULL OR model_name IN ($2,$3))`,
          [renameTo, brandSync().persona_name || "ELARA", brandSync().app_name || "AI OS"]
        ).catch(() => {});
      }
    } catch (e) { console.warn("[migrate] default model seed skipped:", e.message); }

    // 2026-05-30 — Self-heal: any model row whose id looks like a filesystem
    // path (legacy local_path leak) is demoted from default and marked invalid
    // so chat/runtime never picks it. Operator must re-register with a slug.
    try {
      const heal = await client.query(
        `UPDATE models SET is_default=false, status='invalid', updated_at=now()
          WHERE id ~ '^[/~.]' OR id ~ '^[A-Za-z]:[\\\\/]'
          RETURNING id`
      );
      if (heal.rowCount) console.warn(`[migrate] demoted ${heal.rowCount} path-like model id(s): ${heal.rows.map(r=>r.id).join(", ")}`);
    } catch (e) { console.warn("[migrate] path-like model self-heal skipped:", e.message); }

    try {
      const seeded = defaultRuntimeProviderConfig();
      await client.query(
        `INSERT INTO app_settings(key, value, updated_at)
         VALUES ('runtime.provider', $1::jsonb, now())
         ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify(seeded)]
      );
    } catch (e) { console.warn("[migrate] runtime settings seed skipped:", e.message); }

    // --- Hafıza temizliği: CASCADE cleanup of orphan chunks ------------------
    // Boot'ta default OFF — her restart'ta knowledge_chunks tam taraması
    // RAM/CPU patlatıyordu (PID 2400 DELETE FROM knowledge_chunks 50sn+).
    // Manuel: BOOT_ORPHAN_CHUNK_SWEEP=1 ile aç veya /api/knowledge/cleanup endpoint'ini kullan.
    if (env.BOOT_ORPHAN_CHUNK_SWEEP === "1") {
      try {
        await client.query("SET LOCAL statement_timeout = '60s'");
        await client.query(`
          DELETE FROM knowledge_chunks c
           WHERE NOT EXISTS (
             SELECT 1 FROM knowledge_files f
              WHERE f.id = c.file_id
                 OR (f.root = c.root AND f.path = c.path)
           )
        `);
      } catch (e) { console.warn("[migrate] orphan chunk sweep skipped:", e.message); }
    }

    // Faz 11.1 — vault_audit hash-chain trigger'ı + eski satır backfill'i.
    // pool'a basıyoruz: migrate'in aborted transaction'ı bu çağrıyı etkilemesin.
    try {
      await installAuditChain(pool);
      console.log("[migrate] vault_audit hash-chain ready (trigger + backfill)");
    } catch (e) { console.warn("[migrate] audit-chain install skipped:", e.message); }
  } catch (e) { console.error("[migrate] failed:", e.message); }
  finally { try { client?.release(); } catch {} }
}
