// Voice profiles (TR/EN/DE) — per-language TTS identity.
// Extracted from server.mjs.

let _deps = null;

export function initVoiceProfiles(deps) {
  // deps: { pool, createPrefixedId }
  _deps = deps;
}

function rowToVoiceProfile(r) {
  return {
    id: r.id, lang: r.lang, label: r.label,
    engine: r.engine, voiceUri: r.voice_uri,
    rate: Number(r.rate), pitch: Number(r.pitch),
    premiumProvider: r.premium_provider,
    isDefault: r.is_default,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function mountVoiceProfilesRoutes({ app }) {
  if (!_deps) throw new Error("initVoiceProfiles must be called before mountVoiceProfilesRoutes");
  const { pool, createPrefixedId } = _deps;

  app.get("/api/voice-profiles", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM voice_profiles ORDER BY lang, label");
      res.json(rows.map(rowToVoiceProfile));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/voice-profiles", async (req, res) => {
    const v = req.body ?? {};
    const id = v.id || createPrefixedId("vp_");
    try {
      await pool.query(
        `INSERT INTO voice_profiles(id,lang,label,engine,voice_uri,rate,pitch,premium_provider,is_default,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (id) DO UPDATE SET
           lang=EXCLUDED.lang, label=EXCLUDED.label, engine=EXCLUDED.engine,
           voice_uri=EXCLUDED.voice_uri, rate=EXCLUDED.rate, pitch=EXCLUDED.pitch,
           premium_provider=EXCLUDED.premium_provider, is_default=EXCLUDED.is_default,
           updated_at=now()`,
        [id, (v.lang ?? "en").toLowerCase(), v.label ?? "", v.engine ?? "local",
         v.voiceUri ?? "", Number(v.rate ?? 1), Number(v.pitch ?? 1),
         v.premiumProvider ?? "", !!v.isDefault]
      );
      if (v.isDefault) {
        await pool.query("UPDATE voice_profiles SET is_default=false WHERE lang=$1 AND id<>$2",
          [(v.lang ?? "en").toLowerCase(), id]);
      }
      const { rows } = await pool.query("SELECT * FROM voice_profiles WHERE id=$1", [id]);
      res.json({ ok: true, profile: rowToVoiceProfile(rows[0]) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/voice-profiles/:id", async (req, res) => {
    try { await pool.query("DELETE FROM voice_profiles WHERE id=$1", [req.params.id]); res.status(204).end(); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
}
