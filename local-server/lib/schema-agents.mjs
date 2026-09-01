// Agent domain schema (extracted from server.mjs)
// DI: initAgentsSchema({ pool }) -> { ensureAgentSquadsTable }

export function initAgentsSchema({ pool }) {
  let ready = false;

  async function ensureAgentSquadsTable() {
    if (ready) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_squads (
        name        text PRIMARY KEY,
        icon        text DEFAULT 'Shield',
        color       text,
        sort_order  int  DEFAULT 100,
        created_at  timestamptz DEFAULT now()
      )
    `);
    ready = true;
  }

  return { ensureAgentSquadsTable };
}
