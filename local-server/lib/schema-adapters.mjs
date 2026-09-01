// Adapter dictionaries schema (extracted from server.mjs)
// DI: initAdaptersSchema({ pool }) -> { ensureAdapterDictionariesSeed }

export function initAdaptersSchema({ pool }) {
  async function ensureAdapterDictionariesSeed() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS adapter_dictionaries (
        id         bigserial PRIMARY KEY,
        kind       text NOT NULL CHECK (kind IN ('category','connection','runner')),
        value      text NOT NULL,
        label      text,
        builtin    boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(kind, value)
      );
      CREATE INDEX IF NOT EXISTS idx_adapter_dict_kind ON adapter_dictionaries(kind);
    `);
    await pool.query(`
      INSERT INTO adapter_dictionaries(kind, value, label, builtin) VALUES
        ('category','cloud','Cloud',true),
        ('category','network','Network',true),
        ('category','social','Social',true),
        ('category','content','Content',true),
        ('category','ai','AI',true),
        ('category','db','DB',true),
        ('connection','rest_token','REST Token',true),
        ('connection','oauth2','OAuth 2.0',true),
        ('connection','ssh','SSH',true),
        ('connection','sql','SQL',true),
        ('connection','webhook','Webhook',true),
        ('runner','http','HTTP',true),
        ('runner','shell','Shell',true),
        ('runner','python','Python',true),
        ('runner','node','Node',true)
      ON CONFLICT (kind, value) DO NOTHING;
    `);
    try {
      await pool.query(`
        INSERT INTO adapter_dictionaries(kind, value, label, builtin)
        SELECT 'category', category, NULL, false FROM adapters
          WHERE category IS NOT NULL AND category <> ''
        UNION
        SELECT 'connection', connection_type, NULL, false FROM adapters
          WHERE connection_type IS NOT NULL AND connection_type <> ''
        UNION
        SELECT 'runner', adapter, NULL, false FROM adapters
          WHERE adapter IS NOT NULL AND adapter <> ''
        ON CONFLICT (kind, value) DO NOTHING;
      `);
    } catch (e) {
      console.warn("[boot] adapter dict backfill skipped:", String(e?.message || e).slice(0, 200));
    }
  }

  return { ensureAdapterDictionariesSeed };
}
