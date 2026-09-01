// Watchdog runtime cfg persistence — extracted from server.mjs 2026-05-30.
// DB-backed hydrate/persist for runtime.watchdog setting (incl. workerSelfHeal).

export function createWatchdogPersistence({
  pool,
  getWatchdogCfg, setWatchdogCfg,
  getWorkerSelfHealCfg, setWorkerSelfHealCfg,
  getWatchdogSnapshot, // () => { headers, firstToken, idle, cooldown, respawnMax } for log line
}) {
  async function hydrateWatchdogFromDb() {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='runtime.watchdog'");
      const v = rows[0]?.value;
      if (v && typeof v === "object") {
        setWatchdogCfg(v);
        if (v.workerSelfHeal && typeof v.workerSelfHeal === "object") {
          setWorkerSelfHealCfg(v.workerSelfHeal);
        }
        const s = getWatchdogSnapshot?.() || {};
        console.log(`[watchdog] hydrated from DB · headers=${s.headers} firstToken=${s.firstToken} idle=${s.idle} selfHealCooldown=${s.cooldown} respawnMax=${s.respawnMax}`);
      }
    } catch (e) {
      console.warn("[watchdog] hydrate skipped:", String(e?.message || e));
    }
  }

  async function persistWatchdogToDb() {
    try {
      const payload = { ...getWatchdogCfg(), workerSelfHeal: getWorkerSelfHealCfg() };
      await pool.query(
        `INSERT INTO app_settings(key, value, updated_at) VALUES ('runtime.watchdog', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify(payload)],
      );
    } catch (e) {
      console.warn("[watchdog] persist skipped:", String(e?.message || e));
    }
  }

  return { hydrateWatchdogFromDb, persistWatchdogToDb };
}
